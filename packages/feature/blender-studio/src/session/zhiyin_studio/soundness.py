"""
Whether a shape holds together as the real thing does: closed where it is a
solid, not crossing itself, and a tube's ends on what they join. Each fault
is said with where it is and how large, and whether the object's own steps
make it, so it is found and fixed before a picture shows it.

Holes are told for a CAD part and for any mesh that is closed but for a few
gaps; a sheet, such as a floor, a cloth or a label, is open by its nature, and
its outline, however fine its faces, is no hole. Crossings
are told for a CAD part and for what an object's steps make: a shape a
script joined from overlapping pieces crosses itself and looks whole.
"""

import time

import bmesh
import bpy
import mathutils
from mathutils.bvhtree import BVHTree

from .geometry import bounds_of, welded
from .model_shapes import is_cad_part
from .shown_mesh import held_by, joined_faces, shells, shown_bmesh
from .wording import length, point_text

# A tube's two ends, in its own space, and its radius.
TUBE_ENDS, TUBE_RADIUS = "zhiyin_tube_ends", "zhiyin_tube_radius"
# A mesh whose open edges are fewer than this share of all its edges is a closed shape with gaps,
# unless they enclose this share of its piece's surface or more, as a sheet's outline does.
GAPPED, OUTLINE = 0.05, 0.25
# The most faces a shape has to be checked for crossings.
MOST_FACES = 400_000
# Crossings this close together are one place, in metres.
PLACE = 0.01
# How many holes and places are said; the rest are counted.
SAID = 3


def mesh_of(obj, steps=True):
    """An object's shape in world space, its corners in the same place joined: with its steps, or as it is without them."""
    bm = shown_bmesh(obj, steps, depsgraph=bpy.context.evaluated_depsgraph_get())
    welded(bm, list(bm.verts))
    return bm


def holes(bm, open_edges=None):
    """Each loop of open edges, of all or of those given, widest first, as (width, centre)."""
    open_edges = [e for e in bm.edges if e.is_boundary] if open_edges is None else open_edges
    seen, found = set(), []
    for start in open_edges:
        if start in seen:
            continue
        loop, stack = [], [start]
        while stack:
            edge = stack.pop()
            if edge in seen:
                continue
            seen.add(edge)
            loop.append(edge)
            for vert in edge.verts:
                stack += [e for e in vert.link_edges if e.is_boundary and e not in seen]
        points = list({v for e in loop for v in e.verts})
        centre = sum((v.co for v in points), mathutils.Vector()) / len(points)
        step = max(1, len(points) // 60)
        some = points[::step]
        width = max(((a.co - b.co).length for a in some for b in some), default=0.0)
        found.append((width, centre))
    return sorted(found, key=lambda hole: -hole[0])


def crossing_places(bm):
    """Where the shape's own faces cross each other, as the middle of each place, most crossed first."""
    copy = bm.copy()
    try:
        bmesh.ops.triangulate(copy, faces=list(copy.faces))
        copy.faces.ensure_lookup_table()
        tree = BVHTree.FromBMesh(copy)
        faces = copy.faces
        places = {}
        for i, j in tree.overlap(tree):
            if i >= j or set(faces[i].verts) & set(faces[j].verts):
                continue
            middle = (faces[i].calc_center_median() + faces[j].calc_center_median()) / 2
            key = tuple(round(v / PLACE) for v in middle)
            count, total = places.get(key, (0, mathutils.Vector()))
            places[key] = (count + 1, total + middle)
        return [total / count for count, total in sorted(places.values(), key=lambda p: -p[0])]
    finally:
        copy.free()


def gap_edges(bm):
    """
    The open edges of a shape's pieces that are closed but for gaps: not of a
    sheet, whose open edges are its outline and enclose OUTLINE of its surface
    or more, as a floor's, a cloth's or a bowl's rim does, where a closed
    shape's gaps enclose little.
    """
    bm.faces.index_update()
    piece = {face.index: group[0].index for group in joined_faces(bm) for face in group}
    areas, enclosed, edges = {}, {}, {}
    for face in bm.faces:
        areas[piece[face.index]] = areas.get(piece[face.index], 0.0) + face.calc_area()
    for edge in bm.edges:
        if not edge.is_boundary:
            continue
        face = edge.link_faces[0]
        loop = next(lp for lp in face.loops if lp.edge == edge)
        # Half the cross of each open edge's ends, the way its face runs, sums to the area its loops enclose.
        key = piece[face.index]
        enclosed[key] = enclosed.get(key, mathutils.Vector()) + loop.vert.co.cross(loop.link_loop_next.vert.co) / 2
        edges.setdefault(key, []).append(edge)
    return [edge for key, way in enclosed.items() if way.length < OUTLINE * areas[key] for edge in edges[key]]


def faults(bm, gapped_only, crossings):
    """The holes worth telling and the crossing places of a shape, as lists."""
    if not gapped_only:
        found_holes = holes(bm)
    elif 0 < sum(1 for e in bm.edges if e.is_boundary) < GAPPED * len(bm.edges):
        gaps = gap_edges(bm)
        found_holes = holes(bm, gaps) if gaps else []
    else:
        found_holes = []
    found_crossings = crossing_places(bm) if crossings and len(bm.faces) <= MOST_FACES else []
    return found_holes, found_crossings


def fault_text(found_holes, found_crossings):
    said = []
    if found_holes:
        widest = [f"{length(width)} across at {point_text(centre)}" for width, centre in found_holes[:SAID]]
        rest = len(found_holes) - SAID
        said.append(
            f"{len(found_holes)} {'hole' if len(found_holes) == 1 else 'holes'} in its surface"
            + (", the widest " if len(found_holes) > 1 else ", ")
            + ", ".join(widest)
            + (f" and {rest} more" if rest > 0 else "")
        )
    if found_crossings:
        where = ", ".join(point_text(p) for p in found_crossings[:SAID])
        count = len(found_crossings)
        said.append(f"its faces cross each other in {count} {'place' if count == 1 else 'places'}, such as at {where}")
    return said


def soundness_text(obj):
    """
    What is unsound about a mesh object, in words, with whether its steps make
    it: nothing when it is sound, or when nothing about it is worth telling.
    """
    if obj.type != "MESH":
        return None
    cad = is_cad_part(obj)
    stepped = any(m.show_viewport for m in obj.modifiers)
    bm = mesh_of(obj)
    try:
        found = faults(bm, gapped_only=not cad, crossings=cad or stepped)
    finally:
        bm.free()
    if not any(found):
        return None
    said = fault_text(*found)
    if stepped:
        base = mesh_of(obj, steps=False)
        try:
            before = faults(base, gapped_only=not cad, crossings=True)
        finally:
            base.free()
        if not any(before):
            said.append("its steps make these: without them it has none")
        elif len(before[0]) < len(found[0]) or len(before[1]) < len(found[1]):
            said.append("its steps make some of these: without them, " + "; ".join(fault_text(*before)))
        else:
            said.append("they are in its shape before its steps")
    return "; ".join(said)


class Sound:
    """Soundness told for many objects in the time a description has, naming those left unchecked."""

    def __init__(self, seconds):
        self.deadline = time.time() + seconds
        self.unchecked = []

    def text(self, obj):
        if obj.type != "MESH":
            return None
        if time.time() > self.deadline:
            self.unchecked.append(obj.name)
            return None
        return soundness_text(obj)


# ---- tube ends ------------------------------------------------------------------------------


def tube_ends(obj):
    """A tube's open ends in world space, with its radius: a tube added as one, or a curve drawn with thickness."""
    if obj.type == "MESH" and obj.data.get(TUBE_ENDS) is not None:
        ends = [obj.matrix_world @ mathutils.Vector(p) for p in obj.data[TUBE_ENDS]]
        radius = float(obj.data.get(TUBE_RADIUS, 0.0)) * max(obj.matrix_world.to_scale())
        return ends, radius
    if obj.type == "CURVE" and (obj.data.bevel_depth > 0 or obj.data.bevel_object is not None):
        ends = []
        for spline in obj.data.splines:
            if spline.use_cyclic_u:
                continue
            points = spline.bezier_points if spline.type == "BEZIER" else spline.points
            if len(points) < 2:
                continue
            for point in (points[0], points[-1]):
                ends.append(obj.matrix_world @ mathutils.Vector(point.co[:3]))
        return ends, obj.data.bevel_depth * max(obj.matrix_world.to_scale())
    return [], 0.0


def ends_text(obj, others):
    """Each end of a tube that meets nothing, where it is: a hose or a cable ends on or in what it joins."""
    ends, radius = tube_ends(obj)
    if not ends:
        return None
    reach = max(radius * 1.5, 0.002)
    depsgraph = bpy.context.evaluated_depsgraph_get()
    candidates = [o for o in others if o != obj and o.type == "MESH" and o not in obj.children_recursive and obj not in o.children_recursive]
    loose = []
    for end in ends:
        met = False
        for other in candidates:
            box = bounds_of(other)
            if box is None or any(end[i] < box[0][i] - reach or end[i] > box[1][i] + reach for i in range(3)):
                continue
            evaluated = other.evaluated_get(depsgraph)
            local = other.matrix_world.inverted() @ end
            hit, where, _, _ = evaluated.closest_point_on_mesh(local)
            if hit and (other.matrix_world @ where - end).length <= reach:
                met = True
                break
            if hit and inside(other, end):
                met = True
                break
        if not met:
            loose.append(end)
    if not loose:
        return None
    where = " and ".join(point_text(p) for p in loose)
    return f"its {'end' if len(loose) == 1 else 'ends'} at {where} {'meets' if len(loose) == 1 else 'meet'} nothing"


def inside(other, point):
    bm = mesh_of(other)
    try:
        return held_by(shells(bm), point)
    finally:
        bm.free()
