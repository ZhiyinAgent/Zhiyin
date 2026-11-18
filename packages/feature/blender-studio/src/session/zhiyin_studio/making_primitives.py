"""
The primitives adding makes besides boxes, cylinders and spheres, each built at its real size and
centred on its origin: a circle of points, open or filled, a grid of faces, an icosphere, a quad
sphere and the monkey. Each lays its picture at its real proportions.
"""

import bmesh
import mathutils

from .arguments import need, positive_size, whole
from .making import centred, fitted, with_uvs
from .wording import one_of

CIRCLE_FILLS = ("none", "ngon", "fan")
# By default: a circle's points, a grid's columns, a quad sphere's quads along
# each edge; an icosphere's subdivisions, least, most and by default.
CIRCLE_POINTS = 32
GRID_COLUMNS = 10
QUAD_SPHERE_QUADS = 8
ICOSPHERE_LEVELS = (1, 8, 3)


def planar(bm, size):
    """A picture laid flat across x and y, at the shape's own proportions."""
    layer = bm.loops.layers.uv.active
    side = max(size[0], size[1])
    for face in bm.faces:
        for loop in face.loops:
            loop[layer].uv = ((loop.vert.co.x + size[0] / 2) / side, (loop.vert.co.y + size[1] / 2) / side)
    return bm


def circle(spec):
    size = positive_size(spec.get("size"), "size", (1, 1), length=2)
    segments = whole(spec.get("segments"), "segments", minimum=3, maximum=512, default=CIRCLE_POINTS)
    fill = spec.get("fill", "none")
    need(fill in CIRCLE_FILLS, f"A circle's fill is {one_of(CIRCLE_FILLS)}.")
    bm = with_uvs(bmesh.new())
    bmesh.ops.create_circle(bm, cap_ends=fill != "none", cap_tris=fill == "fan", segments=segments, radius=0.5)
    fitted(bm, (size[0], size[1], 1))
    return planar(bm, size)


def grid(spec):
    size = positive_size(spec.get("size"), "size", (1, 1), length=2)
    across = whole(spec.get("segments"), "segments", minimum=1, maximum=1000, default=GRID_COLUMNS)
    rows = whole(spec.get("rows"), "rows", minimum=1, maximum=1000, default=across)
    bm = with_uvs(bmesh.new())
    bmesh.ops.create_grid(bm, x_segments=across, y_segments=rows, size=0.5)
    fitted(bm, (size[0], size[1], 1))
    return planar(bm, size)


def icosphere(spec):
    size = positive_size(spec.get("size"), "size", (1, 1, 1))
    least, most, default = ICOSPHERE_LEVELS
    levels = whole(spec.get("subdivisions"), "subdivisions", minimum=least, maximum=most, default=default)
    bm = with_uvs(bmesh.new())
    bmesh.ops.create_icosphere(bm, subdivisions=levels, radius=0.5, calc_uvs=True)
    return to_size(bm, size)


def to_size(bm, size):
    """Centres a shape and stretches its box to a size, so it is as large as asked whatever its corners."""
    centred(bm)
    reach = [max(v.co[i] for v in bm.verts) - min(v.co[i] for v in bm.verts) for i in range(3)]
    bmesh.ops.scale(bm, vec=[size[i] / reach[i] if reach[i] > 1e-12 else 1 for i in range(3)], verts=bm.verts)
    return bm


def quad_sphere(spec):
    """A cube of quads, each side cut into rows and columns, blown out round onto a sphere."""
    size = positive_size(spec.get("size"), "size", (1, 1, 1))
    cuts = whole(spec.get("segments"), "segments", minimum=1, maximum=128, default=QUAD_SPHERE_QUADS)
    bm = with_uvs(bmesh.new())
    bmesh.ops.create_cube(bm, size=1.0)
    if cuts > 1:
        bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=cuts - 1, use_grid_fill=True)
    sides(bm)
    for vert in bm.verts:
        vert.co = vert.co.normalized() * 0.5
    return to_size(bm, size)


def sides(bm):
    """Each of a cube's six sides laid as one piece of the picture, three across and two down."""
    layer = bm.loops.layers.uv.active
    bm.normal_update()
    for face in bm.faces:
        normal = face.normal
        axis = max(range(3), key=lambda i: abs(normal[i]))
        slot = axis * 2 + (normal[axis] > 0)
        across, down = [i for i in range(3) if i != axis]
        column, row = slot % 3, slot // 3
        for loop in face.loops:
            u = loop.vert.co[across] + 0.5
            v = loop.vert.co[down] + 0.5
            loop[layer].uv = ((column + u) / 3, (row + v) / 2)


def monkey(spec):
    """Blender's monkey, Suzanne, stretched to the size asked, facing the front."""
    bm = with_uvs(bmesh.new())
    bmesh.ops.create_monkey(bm, calc_uvs=True)
    # Built facing -y, toward the front, as the scene's front looks.
    reach = [max(v.co[i] for v in bm.verts) - min(v.co[i] for v in bm.verts) for i in range(3)]
    own = mathutils.Vector(reach) / max(reach)
    size = positive_size(spec.get("size"), "size", tuple(own))
    return to_size(bm, size)


def made_of(kind, obj):
    """What a primitive is made of, counted on its mesh: its faces and points by the counts that set them."""
    mesh = obj.data
    faces, points = len(mesh.polygons), len(mesh.vertices)
    triangles = sum(1 for p in mesh.polygons if len(p.vertices) == 3)
    quads = sum(1 for p in mesh.polygons if len(p.vertices) == 4)
    if kind == "circle":
        edges = len(mesh.edges)
        if not faces:
            return f"a circle of {points} points and {edges} edges, open"
        if faces == 1:
            return f"a circle of {points} points, filled with one face"
        return f"a circle of {points - 1} points, filled with {faces} triangles round its centre"
    if kind == "icosphere":
        return f"{triangles:,} triangles, {points:,} points"
    if kind in ("quad_sphere", "grid"):
        return f"{quads:,} quads, {points:,} points"
    return f"{faces:,} faces, {points:,} points" + (f", {triangles:,} of them triangles" if triangles and quads else "")
