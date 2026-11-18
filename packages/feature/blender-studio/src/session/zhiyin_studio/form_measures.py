"""
How far each mesh is from a block-out, measured on its shape as evaluated rather than on the tool
that made it: the meshes still as blender_add_objects made them, the meshes with sharp edges, where
faces meet at a corner with nothing rounding it, and the parts pushed into the object they belong
to with its material, where the real thing is often one piece. A description, a render and a look
each give these lines, so they are read however a model checks its work.
"""

import math
import time

import numpy

from . import budget
from .as_added import as_added_text
from .finding import is_backdrop
from .geometry import evaluated_graph
from .measure_shapes import Mesh, Shape, into
from .wording import length

# Faces that turn by this much or more meet at a corner; a rounding or a chamfer splits a corner
# into turns smaller than this, and the sides of a cylinder of more than six sides turn by less.
CORNER = math.radians(60)
# Faces narrower than this across an edge are too thin for a rounding to show: a sheet's rim.
THIN = 0.001
# Less sharp edge than this in all is a stray corner, not an object's edges.
STRAY = 0.01
# The most corners of a mesh measured; a mesh with more is dense enough to be modelled.
MOST_LOOPS = 400_000
# The most seconds the measures take, the rest named unmeasured.
SECONDS = 3.0
# The most objects a line names.
NAMED = 40


def sharp_length(obj, depsgraph):
    """The length of an object's sharp edges in the world, on its evaluated mesh; None when it is too dense to measure."""
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    try:
        loops = len(mesh.loops)
        if loops > MOST_LOOPS:
            return None
        if not loops:
            return 0.0
        points = numpy.empty(len(mesh.vertices) * 3)
        mesh.vertices.foreach_get("co", points)
        place = numpy.array(evaluated.matrix_world)
        world = points.reshape(-1, 3) @ place[:3, :3].T + place[:3, 3]
        corner_of = numpy.empty(loops, dtype=numpy.int64)
        mesh.loops.foreach_get("vertex_index", corner_of)
        edge_of = numpy.empty(loops, dtype=numpy.int64)
        mesh.loops.foreach_get("edge_index", edge_of)
        faces = len(mesh.polygons)
        starts = numpy.empty(faces, dtype=numpy.int64)
        mesh.polygons.foreach_get("loop_start", starts)
        totals = numpy.empty(faces, dtype=numpy.int64)
        mesh.polygons.foreach_get("loop_total", totals)
        face_of = numpy.repeat(numpy.arange(faces), totals)
        following = starts[face_of] + (numpy.arange(loops) - starts[face_of] + 1) % totals[face_of]
        # Each face's area and the way it points, from the sum of its sides' cross products.
        swept = numpy.zeros((faces, 3))
        numpy.add.at(swept, face_of, numpy.cross(world[corner_of], world[corner_of[following]]))
        twice_area = numpy.linalg.norm(swept, axis=1)
        pointing = swept / numpy.maximum(twice_area, 1e-18)[:, None]
        # The edges two faces share, each with the faces either side.
        counted = numpy.bincount(edge_of, minlength=len(mesh.edges))
        order = numpy.argsort(edge_of, kind="stable")
        first = numpy.searchsorted(edge_of[order], numpy.arange(len(mesh.edges)))
        shared = numpy.nonzero(counted == 2)[0]
        if not len(shared):
            return 0.0
        one, other = face_of[order[first[shared]]], face_of[order[first[shared] + 1]]
        ends = numpy.empty(len(mesh.edges) * 2, dtype=numpy.int64)
        mesh.edges.foreach_get("vertices", ends)
        ends = ends.reshape(-1, 2)[shared]
        long = numpy.linalg.norm(world[ends[:, 0]] - world[ends[:, 1]], axis=1)
        across = numpy.minimum(twice_area[one], twice_area[other]) / 2 / numpy.maximum(long, 1e-12)
        turned = (pointing[one] * pointing[other]).sum(axis=1) <= math.cos(CORNER)
        sharp = turned & (across >= THIN) & (twice_area[one] > 1e-18) & (twice_area[other] > 1e-18)
        return float(long[sharp].sum())
    finally:
        evaluated.to_mesh_clear()


def shares_material(obj, other):
    mine = {slot.material for slot in obj.material_slots if slot.material is not None}
    return bool(mine & {slot.material for slot in other.material_slots if slot.material is not None})


def named(items):
    return ", ".join(items[:NAMED]) + (f" and {len(items) - NAMED} more" if len(items) > NAMED else "")


def form_lines(objects):
    """The lines on the meshes among `objects` that are still a block-out, or none."""
    meshes = [o for o in objects if o.type == "MESH"]
    if not meshes:
        return []
    lines = []
    still = as_added_text(meshes)
    if still:
        lines.append(still)
    deadline = time.time() + budget.share(SECONDS)
    depsgraph = evaluated_graph()
    sharp, pushed, unmeasured = [], [], []
    for obj in meshes:
        if time.time() > deadline:
            unmeasured.append(obj.name)
            continue
        edges = None if is_backdrop(obj) else sharp_length(obj, depsgraph)
        if edges is not None and edges >= STRAY:
            sharp.append(f"{obj.name} {length(edges)}")
        parent = obj.parent
        if parent is not None and parent.type == "MESH" and shares_material(obj, parent):
            found = into(Shape(Mesh.of_own(obj)), Shape(Mesh.of_own(parent)))
            if found is not None:
                pushed.append(f"{obj.name} {length(found[0])} into {parent.name}" if found[0] else f"{obj.name} into {parent.name}")
    if sharp:
        lines.append(
            f"Sharp edges, where neighbouring faces turn by {math.degrees(CORNER):.0f}° or more with nothing rounding them "
            f"({len(sharp)} of {len(meshes)} meshes); most made things' edges are rounded, if only slightly, "
            f"and catch the light: {named(sharp)}."
        )
    if pushed:
        lines.append(
            f"Pushed into the object they belong to, with its material: {named(pushed)}. Where the real thing is one "
            "piece, as a teapot and its spout are, model it as one surface: grow the part from the body's faces in a "
            "script (zhiyin.extrude, bridge), or unite the two with a boolean and round the seam."
        )
    if unmeasured:
        lines.append(f"Not measured for sharp edges and pushed-in parts, for want of time: {named(unmeasured)}.")
    return lines
