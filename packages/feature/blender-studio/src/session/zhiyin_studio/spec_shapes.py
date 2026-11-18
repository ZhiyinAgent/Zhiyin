"""
The measures a scene's spec is checked with, on each part's evaluated mesh in world space, in
millimetres: its points, how thick and wide its material is, how near two shapes come, the
pieces that hold together, its outline, the faces drawn and where it falls in the camera's frame.
"""

import math

import mathutils
import mathutils.bvhtree
import numpy
from bpy_extras.object_utils import world_to_camera_view

from . import tolerances
from .finding import is_helper, scene
from .geometry import SHAPE_TYPES, evaluated_graph, has_shape, shapes_mesh, shapes_of
from .mesh_math import SPREAD, evenly, spread
from .shown_mesh import is_inside, joined_faces, nearest_between

MM = 1000.0
# Points of a part's surface its thickness and width are measured at, spread by area.
SECTION_POINTS = 800
# Ways across the material a width is measured along, through each point's middle.
ACROSS = 12
# How far from its surface a ray starts, in metres, so it does not meet its own face.
RAY_START = 1e-6
# How far behind a point a ray to another shape starts, in metres, so a face of it level with the point is met.
BEHIND = 1e-5
# Corners of a shape measured for how near it comes to another, at most, and as many points
# again spread over its surface by area, so faces that meet away from any corner are found.
NEAR_POINTS = 4000
# Shapes nearer than this, in mm, touch.
TOUCH = tolerances.TOUCH * MM
# The most pieces a joined requirement tells apart.
MOST_PIECES = 5000
# Two faces at most this far from parallel, as the cosine of their angle, face each other across the material.
FACING = 0.5
# Ways a point is looked out of, level, for the walls round it.
AROUND = 8
# Points of a part measured for whether it lies inside another, at most.
INSIDE_POINTS = 2000
# How far toward a triangle's edges its points go, as a share of the way from its middle.
INNER = 0.9


class Unchecked(Exception):
    """A requirement that cannot be measured on this scene, with why."""


class Surface:
    """
    A shape's surface in world space, in metres: its corners, its triangles and the tree they
    are found in; its box in mm.
    """

    points = numpy.zeros((0, 3))
    tree = None
    closed = False
    _low = _high = _near = None

    def triangles(self):
        """The surface's triangles, as an array of their three corners."""
        raise NotImplementedError

    def low(self):
        if self._low is None:
            self._low = self.points.min(axis=0) * MM
        return self._low

    def high(self):
        if self._high is None:
            self._high = self.points.max(axis=0) * MM
        return self._high

    def sampled(self, most=NEAR_POINTS):
        return evenly(self.points, most)

    def near_points(self):
        """Its corners, at most NEAR_POINTS of them, and NEAR_POINTS more spread over its surface by area."""
        if self._near is None:
            self._near = numpy.concatenate([self.sampled(), spread(self.triangles(), NEAR_POINTS)])
        return self._near


def _corners_of(loop_triangles):
    return numpy.array(
        [[tuple(loop.vert.co) for loop in triangle] for triangle in loop_triangles], dtype=float
    ).reshape(-1, 3, 3)


class Shape(Surface):
    """One part's evaluated shape, with the copies it places, in world space: its mesh, points and surface."""

    def __init__(self, obj):
        self.name = obj.name
        # A part's own shape; a group, such as an imported model, is the shape of its parts.
        bm = shapes_mesh([obj] if has_shape(obj) else [p for p in shapes_of(obj) if p != obj])
        bm.normal_update()
        bm.verts.index_update()
        bm.faces.index_update()
        self.bm = bm
        self.points = numpy.array([tuple(v.co) for v in bm.verts], dtype=float).reshape(-1, 3)
        self.tree = mathutils.bvhtree.BVHTree.FromBMesh(bm) if bm.faces else None
        self.closed = bool(bm.edges) and all(e.is_manifold for e in bm.edges)
        self._sections = None
        self._triangles = None

    def free(self):
        self.bm.free()

    @property
    def empty(self):
        return not len(self.points)

    def triangles(self):
        if self._triangles is None:
            self._triangles = _corners_of(self.bm.calc_loop_triangles())
        return self._triangles

    def sections(self, check=None):
        """
        How thick and how wide the material is at points spread over the surface by area, in mm:
        straight in from the surface to the far side, and the narrowest way across through the
        middle of that, square to it. The thinner of the two is the thickness there, the other
        the width, so a bar reads the same from any of its sides.
        """
        if self._sections is None:
            self._sections = _sections(self.bm, self.tree, self.closed, check)
        return self._sections


def _sides(bm):
    """Each face's side as the shape's outside: -1 for a closed piece whose faces point into it."""
    side = {}
    for group in joined_faces(bm):
        volume = 0.0
        for face in group:
            corners = [v.co for v in face.verts]
            for i in range(1, len(corners) - 1):
                volume += corners[0].dot(corners[i].cross(corners[i + 1]))
        for face in group:
            side[face.index] = -1.0 if volume < 0 else 1.0
    return side


def _ray(tree, start, way):
    """How far a ray goes before it meets the surface, and the normal of the face it meets; None when it meets none."""
    hit, normal, _, distance = tree.ray_cast(start + way * RAY_START, way)
    return None if hit is None else (distance + RAY_START, normal)


def _straight_in(tree, point, inward, closed):
    """
    How far it is straight through the material from a surface point, and the way in. On a
    closed shape the way in is the one whose middle lies inside the solid, so a face turned
    inward is measured from its own side, not across the hollow it faces.
    """
    for way in (inward, -inward):
        found = _ray(tree, point, way)
        if found is None or found[0] <= 2 * RAY_START:
            continue
        if not closed or is_inside(tree, point + way * (found[0] / 2)):
            return found[0], way
    return None


def _sections(bm, tree, closed, check=None):
    if tree is None:
        return None
    side = _sides(bm)
    triangles = bm.calc_loop_triangles()
    corners = [(t[0].vert.co, t[1].vert.co, t[2].vert.co, t[0].face) for t in triangles]
    areas = numpy.array([mathutils.geometry.area_tri(a, b, c) for a, b, c, _ in corners])
    total = float(areas.sum()) if len(areas) else 0.0
    if total <= 0:
        return None
    picks = numpy.searchsorted(numpy.cumsum(areas), (numpy.arange(SECTION_POINTS) + 0.5) / SECTION_POINTS * total)
    thin, wide, where = [], [], []
    for i, k in enumerate(picks):
        if check is not None and i % 50 == 0:
            check()
        a, b, c, face = corners[min(int(k), len(corners) - 1)]
        u, v = (i * SPREAD[0]) % 1, (i * SPREAD[1]) % 1
        if u + v > 1:
            u, v = 1 - u, 1 - v
        # Kept off the triangle's edges, where a ray runs along a face rather than through the material.
        centre = (a + b + c) / 3
        point = centre + (a + (b - a) * u + (c - a) * v - centre) * INNER
        inward = -face.normal * side[face.index]
        if inward.length < 0.5:
            continue
        found = _straight_in(tree, point, inward, closed)
        if found is None:
            continue
        through, inward = found
        middle = point + inward * (through / 2)
        first = inward.orthogonal().normalized()
        second = inward.cross(first)
        chords = []
        for step in range(ACROSS):
            angle = math.pi * step / ACROSS
            way = first * math.cos(angle) + second * math.sin(angle)
            ahead, behind = _ray(tree, middle, way), _ray(tree, middle, -way)
            # Across the material is from one side to the side facing it: a line that cuts
            # off a corner leaves by two faces at an angle, and says nothing of its width.
            # A middle on the surface itself, as at a fold, meets it at once either way.
            if (
                ahead is not None
                and behind is not None
                and min(ahead[0], behind[0]) > 2 * RAY_START
                and abs(ahead[1].dot(behind[1])) >= FACING
            ):
                chords.append(ahead[0] + behind[0])
        across = min(chords) if chords else None
        thin.append(min(through, across) if across is not None else through)
        wide.append(max(through, across) if across is not None else None)
        where.append(tuple(point))
    if not thin:
        return None
    return {
        "thin": numpy.array(thin) * MM,
        "wide": numpy.array([w for w in wide if w is not None]) * MM,
        "where": numpy.array(where) * MM,
    }


def gap(first, second, enough=None):
    """
    How near two shapes come, surface to surface, in mm: 0 when they touch, cross or one is
    inside the other; otherwise as nearest_between finds it. Measuring stops once two points
    come within `enough` mm.
    """
    if first.tree is None or second.tree is None:
        return None
    if first.tree.overlap(second.tree):
        return 0.0
    for one, other in ((first, second), (second, first)):
        if len(one.points) and other.closed and is_inside(other.tree, mathutils.Vector(one.points[0])):
            return 0.0
    found = nearest_between(
        *((shape.near_points(), shape.low() / MM, shape.high() / MM, shape.tree) for shape in (first, second)),
        enough=None if enough is None else enough / MM,
    )
    return None if found is None else max(0.0, found[0] * MM)


def box_gap(first, second):
    """How far apart two shapes' boxes are, in mm: a gap they cannot come nearer than."""
    apart = numpy.maximum(first.low() - second.high(), second.low() - first.high())
    return float(numpy.linalg.norm(numpy.maximum(apart, 0)))


def box_gaps(firsts, seconds):
    """How far apart each of some shapes' boxes is from each of others', in mm, as rows by the first and columns by the second."""
    lows = [numpy.array([s.low() for s in group]).reshape(-1, 3) for group in (firsts, seconds)]
    highs = [numpy.array([s.high() for s in group]).reshape(-1, 3) for group in (firsts, seconds)]
    apart = numpy.maximum(lows[0][:, None, :] - highs[1][None, :, :], lows[1][None, :, :] - highs[0][:, None, :])
    return numpy.linalg.norm(numpy.maximum(apart, 0), axis=2)


class Piece(Surface):
    """One connected piece of a part's mesh, as a shape of its own."""

    def __init__(self, name, faces, triangles):
        self.name = name
        corners, polygons, index = [], [], {}
        for face in faces:
            polygon = []
            for v in face.verts:
                if v.index not in index:
                    index[v.index] = len(corners)
                    corners.append(v.co.copy())
                polygon.append(index[v.index])
            polygons.append(polygon)
        self.points = numpy.array([tuple(c) for c in corners], dtype=float).reshape(-1, 3)
        self.tree = mathutils.bvhtree.BVHTree.FromPolygons(corners, polygons)
        self.closed = all(len(e.link_faces) == 2 for face in faces for e in face.edges)
        self._faces = [face.index for face in faces]
        self._of_faces = triangles

    def triangles(self):
        return _corners_of([t for face in self._faces for t in self._of_faces.get(face, ())])


def pieces(shape, check=None):
    """A shape's connected pieces; None when it has more than MOST_PIECES."""
    bm = shape.bm
    triangles = {}
    for triangle in bm.calc_loop_triangles():
        triangles.setdefault(triangle[0].face.index, []).append(triangle)
    found = []

    def starting():
        if check is not None and len(found) % 100 == 0:
            check()

    for group in joined_faces(bm, by_corners=True, starting=starting):
        found.append(Piece(shape.name, group, triangles))
        if len(found) > MOST_PIECES:
            return None
    return found


def held(groups, pieces_found, check=None):
    """
    Joins the pieces that touch or go into one another into groups, in `groups`, each piece's
    group by its index: pieces are taken in order along x, so only those whose boxes meet are
    measured against each other.
    """
    order = sorted(range(len(pieces_found)), key=lambda i: pieces_found[i].low()[0])
    lows = [pieces_found[i].low()[0] for i in order]
    highs = [pieces_found[i].high()[0] for i in order]
    for at, i in enumerate(order):
        if check is not None and at % 100 == 0:
            check()
        for later in range(at + 1, len(order)):
            if lows[later] - highs[at] > TOUCH:
                break
            j = order[later]
            if groups.root(i) == groups.root(j) or box_gap(pieces_found[i], pieces_found[j]) > TOUCH:
                continue
            apart = gap(pieces_found[i], pieces_found[j], enough=TOUCH)
            if apart is not None and apart <= TOUCH:
                groups.join(i, j)


def nearest_apart(groups, pieces_found, check=None):
    """How near the two nearest pieces of different groups come, in mm: pieces whose boxes are farther apart than the nearest found are never measured."""
    order = sorted(range(len(pieces_found)), key=lambda i: pieces_found[i].low()[0])
    nearest = None
    for at, i in enumerate(order):
        if check is not None and at % 100 == 0:
            check()
        for later in range(at + 1, len(order)):
            j = order[later]
            if nearest is not None and pieces_found[j].low()[0] - pieces_found[i].high()[0] >= nearest:
                break
            if groups.root(i) == groups.root(j):
                continue
            if nearest is not None and box_gap(pieces_found[i], pieces_found[j]) >= nearest:
                continue
            apart = gap(pieces_found[i], pieces_found[j])
            if apart is not None and (nearest is None or apart < nearest):
                nearest = apart
    return nearest


class Groups:
    """Which group each of a number of things is in, joined two at a time."""

    def __init__(self, count):
        self.parent = list(range(count))

    def root(self, i):
        while self.parent[i] != i:
            self.parent[i] = self.parent[self.parent[i]]
            i = self.parent[i]
        return i

    def join(self, i, j):
        self.parent[self.root(i)] = self.root(j)


def walled_in(trees, point):
    """
    Whether a point is walled in by shapes together: level, every way out meets one of them,
    and so does the way down, as in a room, its walls and floor one shape or several, or a mug.
    """

    def meets(way):
        return any(_ray(tree, point, way) is not None for tree in trees)

    if not meets(mathutils.Vector((0, 0, -1))):
        return False
    return all(
        meets(mathutils.Vector((math.cos(2 * math.pi * step / AROUND), math.sin(2 * math.pi * step / AROUND), 0)))
        for step in range(AROUND)
    )


def inside_of(outers, shape, check=None):
    """
    How a shape lies in others taken together, in mm: the farthest any point of it outside them
    is from their nearest surface, with that point, or, below 0 when none is outside, how near
    the nearest comes to their surface, with no point. A point is inside when it is in one's
    solid, or walled in by them, as a sofa in a room or coffee in a mug, never in the notch
    outside an L-shaped room.
    """
    trees = [outer.tree for outer in outers]
    outside, nearest = None, None
    for at, point in enumerate(shape.sampled(INSIDE_POINTS)):
        if check is not None and at % 20 == 0:
            check()
        where = mathutils.Vector(point)
        distance = min(
            (found[3] * MM for tree in trees if (found := tree.find_nearest(where))[0] is not None), default=0.0
        )
        if any(outer.closed and is_inside(outer.tree, where) for outer in outers) or walled_in(trees, where):
            nearest = distance if nearest is None else min(nearest, distance)
        elif outside is None or distance > outside[0]:
            outside = (distance, tuple(point))
    return outside if outside is not None else (-(nearest or 0.0), None)


def resting_gap(part, support, check=None):
    """
    How far a part's surface is above a support's, straight up and down, at the nearest, in mm:
    below 0 where one goes into the other, as deep as it goes; None when no point of either lies
    over or under the other. Both ways are measured, from points of the part down to the
    support and from points of the support up to the part, so a top resting on legs narrower
    than it rests on them though none of its corners is over a leg.
    """
    least = None
    for one, other, way in ((part, support, -1.0), (support, part, 1.0)):
        found = _vertical(one, other, way, check)
        if found is not None and (least is None or found < least):
            least = found
    return least


def _vertical(one, other, way, check):
    """The least way `one`'s surface is from `other`'s, from its points along z by `way`: 1 up, -1 down; below 0 where a point is inside `other`."""
    points = one.near_points()
    low, high = other.low() / MM, other.high() / MM
    over = (
        (points[:, 0] >= low[0])
        & (points[:, 0] <= high[0])
        & (points[:, 1] >= low[1])
        & (points[:, 1] <= high[1])
        & ((points[:, 2] >= low[2]) if way < 0 else (points[:, 2] <= high[2]))
    )
    toward = mathutils.Vector((0, 0, way))
    least = None
    for at, point in enumerate(points[over]):
        if check is not None and at % 500 == 0:
            check()
        where = mathutils.Vector(point)
        if other.closed and low[2] <= point[2] <= high[2] and is_inside(other.tree, where):
            # Inside the other: as deep as the way back out to its surface.
            back = _met(other.tree, where, -toward)
            apart = -back if back is not None else 0.0
        else:
            apart = _met(other.tree, where, toward)
            if apart is None:
                continue
        if least is None or apart < least:
            least = apart
    return None if least is None else least * MM


def _met(tree, where, way):
    """How far along `way` from a point a shape's surface is met, in metres, from a little behind the point, so a face level with it is met at 0."""
    hit = tree.ray_cast(where - way * BEHIND, way)
    return None if hit[0] is None else hit[3] - BEHIND


def drawn(objects=None):
    """
    The faces Blender draws, with every instance counted, and how many of them instances place:
    of the objects given, the copies they place included, or of the whole scene.
    """
    depsgraph = evaluated_graph()
    wanted = None if objects is None else {o.as_pointer() for o in objects}
    counted, faces, placed, by_instance = {}, 0, 0, 0
    for instance in depsgraph.object_instances:
        shown = instance.object
        if shown.type not in SHAPE_TYPES:
            continue
        owner = (instance.parent if instance.is_instance else instance.object).original
        if is_helper(owner) or owner.hide_render or (wanted is not None and owner.as_pointer() not in wanted):
            continue
        key = shown.name
        if key not in counted:
            if shown.type == "MESH":
                counted[key] = len(shown.data.polygons)
            else:
                mesh = shown.to_mesh()
                counted[key] = len(mesh.polygons) if mesh is not None else 0
                shown.to_mesh_clear()
        faces += counted[key]
        if instance.is_instance:
            placed += 1
            by_instance += counted[key]
    return faces, placed, by_instance


def in_frame(shape, camera):
    """
    Where a shape's points fall in the camera's frame: the nearest any comes to the frame's edge,
    as a share of the frame, below 0 past it, with which edge; or None when a point is behind
    the camera.
    """
    s = scene()
    worst = None
    for point in shape.sampled(5000):
        x, y, depth = world_to_camera_view(s, camera, mathutils.Vector(point))
        if depth <= 0:
            return None
        for share, edge in ((x, "left"), (1 - x, "right"), (y, "bottom"), (1 - y, "top")):
            if worst is None or share < worst[0]:
                worst = (share, edge)
    return worst
