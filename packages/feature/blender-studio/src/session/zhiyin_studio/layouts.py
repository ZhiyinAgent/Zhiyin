"""
How the shapes adding makes lay out their picture, once built at their size:
each face flat in the picture at its real proportions, a round side unrolled
in one piece and each flat face on its own, every piece at one scale, packed
apart into the picture's square without turning any over. A sphere keeps
Blender's layout by longitude and latitude, which a picture made for a globe
expects.
"""

import math

import bmesh
import mathutils
import numpy

# The room left between pieces, as a share of the picture's side.
GAP = 1 / 64
# How many shelf widths are tried when packing the pieces.
WIDTHS = 48
# A face is level, a cap or a box's top, when its points' heights differ by less than this share of its size.
LEVEL = 1e-6


def frame(normal):
    """The picture's two ways across a face facing `normal`: upright on a wall, and on a level face along x."""
    normal = normal.normalized()
    up = mathutils.Vector((0, 0, 1)) if abs(normal.z) < 0.9 else mathutils.Vector((0, 1 if normal.z > 0 else -1, 0))
    v = (up - normal * up.dot(normal)).normalized()
    # Across, then up, turn the way the face's corners run, so the face is not turned over in the picture.
    return v.cross(normal), v


def flat(face):
    """Each corner of a face, flat at its real size, in its frame."""
    u, v = frame(face.normal)
    return {loop: mathutils.Vector((loop.vert.co.dot(u), loop.vert.co.dot(v))) for loop in face.loops}


def placed_against(corners, known):
    """A face's flat corners turned and moved, without mirroring, so two corners sit where `known` puts them."""
    (first, at_first), (second, at_second) = known
    own = corners[second] - corners[first]
    wanted = at_second - at_first
    turn = math.atan2(wanted.y, wanted.x) - math.atan2(own.y, own.x)
    rotation = mathutils.Matrix.Rotation(turn, 2)
    return {loop: at_first + rotation @ (point - corners[first]) for loop, point in corners.items()}


def unrolled(faces):
    """
    A ring of faces, as a round shape's side, unrolled flat in one piece: each
    face laid against the one before it along the edge they share, so every
    face keeps its size and the ring opens at one seam.
    """
    ring = set(faces)
    start = faces[0]
    laid = flat(start)
    seen, face = {start}, start
    while True:
        step = next(
            (
                (edge, other)
                for edge in face.edges
                for other in edge.link_faces
                if other in ring and other not in seen
            ),
            None,
        )
        if step is None:
            return laid
        edge, after = step
        before = {loop.vert: laid[loop] for loop in face.loops}
        own = flat(after)
        by_point = {loop.vert: loop for loop in after.loops}
        known = [(by_point[vert], before[vert]) for vert in edge.verts]
        laid.update(placed_against(own, known))
        seen.add(after)
        face = after


def packed(bm, pieces):
    """
    Writes each piece's flat corners into the layout at one scale, packed in
    shelves into the picture's square with room between them, the widest
    first: the scale that fits is the one that leaves the least room unused.
    """
    layer = bm.loops.layers.uv.verify()
    boxes = []
    for piece in pieces:
        low = mathutils.Vector((min(p.x for p in piece.values()), min(p.y for p in piece.values())))
        high = mathutils.Vector((max(p.x for p in piece.values()), max(p.y for p in piece.values())))
        boxes.append((piece, low, high - low))
    boxes.sort(key=lambda b: -b[2].y)
    widest = max(b[2].x for b in boxes)
    total = sum(b[2].x for b in boxes)
    gap = 0.0
    for _ in range(2):
        best = None
        for step in range(WIDTHS + 1):
            width = widest + (total + gap * len(boxes) - widest) * step / WIDTHS
            places, side = _shelves(boxes, width, gap)
            if best is None or side < best[1]:
                best = (places, side)
        gap = GAP * best[1]
    places, side = best
    for (piece, low, _), at in zip(boxes, places):
        for loop, point in piece.items():
            loop[layer].uv = (point - low + at) / side


def _shelves(boxes, width, gap):
    """Where each box goes, shelf by shelf no wider than `width`, and the side of the square that holds them."""
    places, x, y, shelf, reach = [], 0.0, 0.0, 0.0, 0.0
    for _, _, size in boxes:
        if x > 0 and x + size.x > width + 1e-12:
            x, y, shelf = 0.0, y + shelf + gap, 0.0
        places.append(mathutils.Vector((x, y)))
        reach = max(reach, x + size.x)
        x += size.x + gap
        shelf = max(shelf, size.y)
    return places, max(reach, y + shelf)


def level(face):
    """Whether a face lies level, as a cap or a box's top or bottom."""
    heights = [v.co.z for v in face.verts]
    size = max((v.co - face.verts[0].co).length for v in face.verts)
    return max(heights) - min(heights) <= LEVEL * max(size, 1e-9)


def lay_faces(bm):
    """Each face its own piece, as a box's and a plane's."""
    bm.normal_update()
    packed(bm, [flat(face) for face in bm.faces])


def lay_round(bm):
    """A cylinder's or a cone's side unrolled in one piece, and each cap on its own."""
    bm.normal_update()
    caps = [face for face in bm.faces if level(face)]
    side = [face for face in bm.faces if face not in set(caps)]
    pieces = [flat(face) for face in caps]
    if side:
        pieces.append(unrolled(side))
    packed(bm, pieces)


# The most faces of a shape whose layout is laid again on a resize: the shapes adding makes have few.
MOST_RELAID = 5000
# How near a layout's corners are to adding's for the layout to be adding's own.
SAME_PLACE = 1e-5


def _laid(mesh, lay):
    """The layout `lay` gives a mesh, as a list of its corners' places in the picture."""
    bm = bmesh.new()
    try:
        bm.from_mesh(mesh)
        lay(bm)
        layer = bm.loops.layers.uv.active
        return [tuple(loop[layer].uv) for face in bm.faces for loop in face.loops]
    finally:
        bm.free()


def own_layout(obj):
    """
    How adding laid out a shape's picture, when its layout is still the one
    adding laid at its present proportions: nothing for a layout the person or
    a script made, or one a change of shape left behind.
    """
    if obj.type != "MESH" or obj.data.uv_layers.active is None or not 0 < len(obj.data.polygons) <= MOST_RELAID:
        return None
    mesh = obj.data
    values = numpy.empty(len(mesh.loops) * 2, dtype=numpy.float64)
    mesh.uv_layers.active.uv.foreach_get("vector", values)
    held = values.reshape(-1, 2)
    for lay in (lay_faces, lay_round):
        laid = numpy.array(_laid(mesh, lay), dtype=numpy.float64).reshape(-1, 2)
        if laid.shape == held.shape and numpy.abs(laid - held).max() <= SAME_PLACE:
            return lay
    return None


def lay_again(obj, lay):
    """Lays a shape's picture out again as adding did, at its shape's proportions now; whether that changed its layout."""
    mesh = obj.data
    bm = bmesh.new()
    try:
        bm.from_mesh(mesh)
        before = [tuple(loop[bm.loops.layers.uv.active].uv) for face in bm.faces for loop in face.loops]
        lay(bm)
        layer = bm.loops.layers.uv.active
        after = [tuple(loop[layer].uv) for face in bm.faces for loop in face.loops]
        if numpy.abs(numpy.array(before) - numpy.array(after)).max() <= SAME_PLACE:
            return False
        bm.to_mesh(mesh)
        mesh.update()
        return True
    finally:
        bm.free()
