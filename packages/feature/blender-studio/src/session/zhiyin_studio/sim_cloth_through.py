"""
Whether a baked cloth went through what it meets. A cloth's point that steps past a thin wall or plate
between two steps of the simulation is not inside it at any frame, so points inside say nothing of
it; the sheet still does. At each frame, an edge of the cloth that runs into a closed collider
through one face and out through a face turned the other way joins a point on one side of it to a
point on the other: the cloth goes through it there. Each collider gone through is said with the
frames, the most edges at once, how many of the cloth's points those edges join, and the fix: room
where the cloth starts squeezed between two colliders, else more steps a frame, from how far its
points moved in one step against how far it keeps from the collider.
"""

import math

import mathutils
import mathutils.bvhtree
import numpy

from .finding import scene
from .shown_mesh import shown_bmesh
from .sim_cloth_release import release_frame
from .sim_cloth_setup import MOST_GIVEN_STEPS
from .timeline import fps, seconds_of, seconds_text
from .wording import length

# An edge's way in and way out face apart by more than this (120°): it went through, rather than
# across a corner, which a fold over an edge cuts.
OPPOSITE = -0.5
# A point within the collision distance of two colliders lying on opposite sides of it is squeezed.
FACING = -0.5
# Steps a frame enough that no point moves more than two thirds of what it keeps in one step.
SPARE = 1.5
# The colliders said in full; the rest are named.
NAMED = 3
# Blender's least collision thickness on a collider.
THINNEST = 0.001


def collider_objects(cloth):
    """The meshes this cloth meets: every one with collision, or those of the collection it meets only."""
    step = next(m for m in cloth.modifiers if m.type == "CLOTH")
    only = step.collision_settings.collection
    found = only.all_objects if only is not None else scene().objects
    return [
        o
        for o in found
        if o != cloth and o.type == "MESH" and o.collision is not None and o.collision.use and any(m.type == "COLLISION" for m in o.modifiers)
    ]


def pinned_points(cloth, group):
    """The cloth's points its pin group holds, at least half weight, by their place."""
    found = cloth.vertex_groups.get(group) if group else None
    if found is None:
        return set()
    index = found.index
    return {v.index for v in cloth.data.vertices for g in v.groups if g.group == index and g.weight >= 0.5}


class Surface:
    """A collider's evaluated surface in the world at one frame, and whether it is closed."""

    def __init__(self, obj, depsgraph):
        self.obj = obj
        self.matrix = obj.matrix_world.copy()
        bm = shown_bmesh(obj, depsgraph=depsgraph)
        try:
            self.closed = bool(bm.edges) and all(e.is_manifold for e in bm.edges)
            corners = numpy.array([tuple(v.co) for v in bm.verts]) if bm.verts else numpy.zeros((1, 3))
            self.tree = mathutils.bvhtree.BVHTree.FromBMesh(bm)
        finally:
            bm.free()
        self.low, self.high = corners.min(axis=0), corners.max(axis=0)
        # A shape that deforms is read anew each frame; one that only moves, when it moves.
        self.deforms = bool(obj.data.shape_keys) or any(m.type != "COLLISION" for m in obj.modifiers)

    def current(self, depsgraph):
        if self.deforms or self.obj.matrix_world != self.matrix:
            return Surface(self.obj, depsgraph)
        return self


def goes_through(tree, a, b):
    """Whether the straight edge a→b enters the surface through one face and leaves through one turned the other way."""
    way = b - a
    total = way.length
    if total < 1e-9:
        return False
    way /= total
    start, gone, entered = a, 0.0, None
    for _ in range(16):
        hit, normal, _, distance = tree.ray_cast(start, way, total - gone)
        if hit is None:
            return False
        if way.dot(normal) < 0:
            entered = normal
        elif entered is not None and entered.dot(normal) < OPPOSITE:
            return True
        else:
            entered = None
        step = 1e-6 + 1e-6 * hit.length
        gone += distance + step
        start = hit + way * step
    return False


def crosses(tree, a, b):
    """Whether the straight edge a→b crosses the surface: for an open one, as a floor of one face, that is going through it."""
    way = b - a
    total = way.length
    if total < 1e-9:
        return False
    return tree.ray_cast(a, way / total, total)[0] is not None


class Sheet:
    """
    A cloth's faces and edges, to find at a frame the edges that go through
    the surfaces near it: in through one face of a closed one and out
    through a face turned the other way, or across an open one.
    """

    def __init__(self, cloth):
        self.faces = [tuple(p.vertices) for p in cloth.data.polygons]
        self.face_edges = [tuple(p.edge_keys) for p in cloth.data.polygons]

    def through(self, points, surfaces, before=None):
        """
        Each surface some edge goes through at these points, with those
        edges; and, given where the points were the frame `before`, each
        open surface a point's way since crossed, as a flat sheet moved
        straight through a floor does between two frames, each such point
        as an edge from itself to itself.
        """
        low, high = points.min(axis=0), points.max(axis=0)
        if before is not None:
            low, high = numpy.minimum(low, before.min(axis=0)), numpy.maximum(high, before.max(axis=0))
        near = [s for s in surfaces if (s.low <= high).all() and (s.high >= low).all()]
        if not near:
            return []
        tree = mathutils.bvhtree.BVHTree.FromPolygons([tuple(p) for p in points], self.faces)
        found = []
        for surface in near:
            test = goes_through if surface.closed else crosses
            edges = {e for face, _ in tree.overlap(surface.tree) for e in self.face_edges[face]}
            gone = [(i, j) for i, j in edges if test(surface.tree, mathutils.Vector(points[i]), mathutils.Vector(points[j]))]
            if before is not None and not surface.closed:
                inside = numpy.all((numpy.minimum(points, before) <= surface.high) & (numpy.maximum(points, before) >= surface.low), axis=1)
                gone += [(int(i), int(i)) for i in numpy.nonzero(inside)[0] if crosses(surface.tree, mathutils.Vector(before[i]), mathutils.Vector(points[i]))]
            if gone:
                found.append((surface, gone))
        return found


class Passage:
    """Where the cloth went through one collider: at which frames, how many edges, which points, how fast."""

    def __init__(self):
        self.frames, self.points, self.speed = {}, set(), 0.0
        # The points that went through it while the cloth's pins held.
        self.held = set()
        # Whether points crossed it on their way between frames, not only edges at a frame.
        self.paths = False

    def words(self, total):
        """When, the most edges at once and how many of the cloth's total points they join."""
        frames = sorted(self.frames)
        most = max(frames, key=lambda f: self.frames[f])
        when = (
            f"at {seconds_text(seconds_of(frames[0]))}"
            if len(frames) == 1
            else f"from {seconds_text(seconds_of(frames[0]))} to {seconds_text(seconds_of(frames[-1]))}"
        )
        share = len(self.points) / total
        return (
            f"{when} (frames {frames[0]}–{frames[-1]}), as many as {self.frames[most]} of its {'edges and points' if self.paths else 'edges'} at {seconds_text(seconds_of(most))},"
            f" joining {len(self.points):,} of its {total:,} points ({f'{share:.1%}' if share >= 0.001 else 'under 0.1%'})"
        )


class Through:
    """One cloth over a bake's frames: the colliders it went through."""

    def __init__(self, cloth):
        self.cloth = cloth
        step = next(m for m in cloth.modifiers if m.type == "CLOTH")
        self.distance = step.collision_settings.distance_min
        self.steps = step.settings.quality
        self.pinned = pinned_points(cloth, step.settings.vertex_group_mass)
        # The frame from which the pins hold nothing, if they let go.
        self.released = release_frame(cloth)
        self.sheet = Sheet(cloth)
        self.objects = collider_objects(cloth)
        self.surfaces = None
        self.before = None
        self.passages = {}
        self.squeezed = {}

    def keeps(self, obj):
        """How far the cloth rests off a collider: its own distance and the collider's outer thickness."""
        return self.distance + obj.collision.thickness_outer

    def see(self, frame, points, depsgraph):
        if not numpy.isfinite(points).all():
            self.before = None
            return
        if self.surfaces is None:
            self.surfaces = [Surface(o, depsgraph) for o in self.objects]
            self.squeezed = self.squeezes(points)
        else:
            self.surfaces = [s.current(depsgraph) for s in self.surfaces]
        for surface, through in self.sheet.through(points, self.surfaces, self.before):
            passage = self.passages.setdefault(surface.obj.name, Passage())
            passage.frames[frame] = len(through)
            passage.paths = passage.paths or any(i == j for i, j in through)
            ends = sorted({k for edge in through for k in edge})
            passage.points.update(ends)
            if self.released is None or frame < self.released:
                passage.held.update(ends)
            if self.before is not None:
                moved = numpy.linalg.norm(points[ends] - self.before[ends], axis=1)
                passage.speed = max(passage.speed, float(moved.max()) * fps())
        self.before = points

    def squeezes(self, points):
        """At the start: for each pair of colliders, how many points lie within what the cloth keeps from both, one on each side."""
        nearest = {}
        for surface in self.surfaces:
            keep = self.keeps(surface.obj)
            inside = numpy.all((points >= surface.low - keep) & (points <= surface.high + keep), axis=1)
            for i in numpy.nonzero(inside)[0]:
                hit = surface.tree.find_nearest(mathutils.Vector(points[i]), keep)
                if hit[0] is not None:
                    nearest.setdefault(int(i), []).append((surface.obj.name, hit[0] - mathutils.Vector(points[i])))
        found = {}
        for close in nearest.values():
            for x, (a, way_a) in enumerate(close):
                for b, way_b in close[x + 1 :]:
                    if way_a.length > 1e-9 and way_b.length > 1e-9 and way_a.normalized().dot(way_b.normalized()) < FACING:
                        pair = tuple(sorted((a, b)))
                        found[pair] = found.get(pair, 0) + 1
        return found

    def fault(self):
        """What the cloth went through, and what would stop it; None when it went through nothing."""
        if not self.passages:
            return None
        total = len(self.cloth.data.vertices)
        said = []
        gone = sorted(self.passages.items(), key=lambda item: -len(item[1].points))
        for name, passage in gone[:NAMED]:
            said.append(f"it went through {name} {passage.words(total)}")
        if len(gone) > NAMED:
            rest = [name for name, _ in gone[NAMED:]]
            said.append(f"and through {len(rest)} more, fewer of its points each: {', '.join(rest)}")
        return "; ".join(said) + ": " + self.fix()

    def fix(self):
        # Pins carry the cloth through only while they hold: once let go, the points are free.
        carried = [name for name, passage in self.passages.items() if len(passage.held & self.pinned) * 2 > len(passage.points)]
        if carried:
            names = ", ".join(carried)
            return f"its pinned points carry it through {names}, as pins follow what holds them and no collider stops them: move them clear of it"
        names = set(self.passages)
        squeezed = {pair: count for pair, count in self.squeezed.items() if names & set(pair)}
        if squeezed:
            (a, b), count = max(squeezed.items(), key=lambda item: item[1])
            pair = [self.cloth_collider(a), self.cloth_collider(b)]
            room = sum(self.keeps(o) for o in pair)
            others = len(squeezed) - 1
            thinner = (
                " or give them less thickness (colliders.thickness)"
                if any(o.collision.thickness_outer > THINNEST * 1.01 for o in pair)
                else ""
            )
            also = f" (and between {others} other pair{'s' if others != 1 else ''} of colliders)" if others else ""
            return (
                f"it starts squeezed, {count:,} of its points within what it keeps from both {a} and {b} on either side{also},"
                f" so each pushes it into the other and more steps do not help. Leave at least {length(room)} between them,"
                f" what it keeps from each,{thinner} and bake again"
            )
        name, passage = max(self.passages.items(), key=lambda item: item[1].speed)
        keep = self.keeps(self.cloth_collider(name))
        per_step = passage.speed / (fps() * self.steps)
        needed = min(MOST_GIVEN_STEPS, math.ceil(SPARE * passage.speed / (fps() * keep)))
        if per_step > keep / SPARE and needed > self.steps:
            return (
                f"its points there moved up to {passage.speed:.3g} m/s, {length(per_step)} in each of its {self.steps} steps a frame,"
                f" against the {length(keep)} it keeps from {name}, so they stepped past it. Give cloth.steps {needed}"
                f" (bake time grows in step), or a slower pull"
            )
        return (
            f"its points there moved at most {length(per_step)} in each of its {self.steps} steps a frame, within the {length(keep)}"
            " it keeps, so it was forced through: give the motion more time, or a stiffer fabric"
        )

    def cloth_collider(self, name):
        return next(o for o in self.objects if o.name == name)
