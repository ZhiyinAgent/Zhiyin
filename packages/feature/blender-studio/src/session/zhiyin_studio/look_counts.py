"""
The counts a look gives with its pictures, each of what a mesh can have that a picture shows
only from some side: open edges, faces pointing inward, faces of more than four sides, pieces and
loose points, the thinnest wall, and the faces a script left selected. As the checks after a
change judge them, open edges are a fault only where they are holes, not a sheet's outline, and
a face of more than four sides only where it is not flat.
"""

import bmesh
import mathutils
import mathutils.bvhtree

from .measure_shapes import Mesh, Shape, into
from .model_shapes import is_cad_part
from .shown_mesh import WAYS_OUT, crossings, joined_faces, on_surface
from .soundness import MOST_FACES, faults, mesh_of
from .wording import length

# Faces of a closed piece a ray is sent from to find which way is out of it.
PIECE_SAMPLES = 9
# The most closed pieces of one mesh measured for passing into each other.
MOST_PIECES = 24

# Faces a wall is measured through, at most, spread over the mesh.
WALL_SAMPLES = 3000
# How far inside a face a ray starts, so it does not meet the face itself.
RAY_START = 1e-6
# A ray leaves a wall through a face that faces the way it goes, at least this much.
LEAVING = 0.3
# How far from an object's middle, as a share of its half size, a place lies on one side.
SIDE = 0.35
# A face of more than four sides is flat when no corner lies off its plane by more than this share of its size, and this far.
WARP_SHARE, WARP_LEAST = 0.01, 1e-5


def warped_by(off, reach):
    """Whether a face whose corners lie up to `off` from its plane, `reach` from its middle, is not flat."""
    return off > max(WARP_SHARE * reach, WARP_LEAST)


def not_flat(face):
    """Whether a face's corners lie off its plane."""
    middle = face.calc_center_median()
    normal = face.normal
    if not normal.length:
        return False
    off = max(abs((v.co - middle).dot(normal)) for v in face.verts)
    return warped_by(off, max((v.co - middle).length for v in face.verts))


def side_words(low, high, point):
    """Where a point lies on an object's box, as a person points at it: on the left side, at the top, or in the middle."""
    middle = (low + high) / 2
    half = [max((high[i] - low[i]) / 2, 1e-9) for i in range(3)]
    offset = [(point[i] - middle[i]) / half[i] for i in range(3)]
    axis = max(range(3), key=lambda i: abs(offset[i]))
    if abs(offset[axis]) < SIDE:
        return "in the middle"
    names = (("on the left side", "on the right side"), ("at the front", "at the back"), ("at the bottom", "at the top"))
    return names[axis][offset[axis] > 0]


def islands(bm):
    """The mesh's pieces, each as its faces, and whether every edge of it joins two faces."""
    bm.faces.index_update()
    return [
        (group, all(len(edge.link_faces) == 2 for face in group for edge in face.edges)) for group in joined_faces(bm)
    ]


def passing_into(obj, pieces):
    """
    How many of a mesh's closed pieces pass into another of the same material, as joining two meshes
    leaves them, and the deepest: (0, None) when none does or there are too many pieces to measure.
    """
    closed = [group for group, whole in pieces if whole]
    if len(closed) < 2 or len(closed) > MOST_PIECES:
        return 0, None
    slots = [slot.material for slot in obj.material_slots]
    shaped = []
    for group in closed:
        used = {slots[f.material_index] for f in group if f.material_index < len(slots)} - {None}
        alone, made = bmesh.new(), {}
        for face in group:
            for vert in face.verts:
                if vert not in made:
                    made[vert] = alone.verts.new(vert.co)
            try:
                alone.faces.new([made[v] for v in face.verts])
            except ValueError:
                # A face over the same points twice adds nothing to the piece's shape.
                continue
        shaped.append((used, Shape(Mesh.read(alone))))
    passing, deepest = set(), None
    for i, (used, one) in enumerate(shaped):
        for j in range(i + 1, len(shaped)):
            other_used, other = shaped[j]
            if not used & other_used:
                continue
            found = into(one, other)
            if found is not None:
                passing |= {i, j}
                deepest = max(deepest or 0.0, found[0])
    return len(passing), deepest


def points_out(tree, face, normal):
    """Whether a face's side `normal` faces out of the solid: a ray from it that way crosses the surface an even number of times."""
    start = on_surface(tree, face) + normal * RAY_START
    votes = [crossings(tree, start, (normal + way * 0.01).normalized()) % 2 == 0 for way in WAYS_OUT[:3]]
    return sum(votes) >= 2


def turned_round(bm, pieces):
    """
    The faces pointing the wrong way, and the way each face should point. In
    a closed piece, those pointing inward: Blender's own recalculation turns
    each piece's faces one way, and rays from a few of its faces say which
    way is out of the solid, so the inside of a hollow shell points into the
    hollow. In an open piece, which has no inside, those facing against most
    of their piece.
    """
    copy = bm.copy()
    try:
        copy.faces.ensure_lookup_table()
        bmesh.ops.recalc_face_normals(copy, faces=list(copy.faces))
        copy.normal_update()
        outward = {face.index: copy.faces[face.index].normal.copy() for face in bm.faces}
    finally:
        copy.free()
    tree = mathutils.bvhtree.BVHTree.FromBMesh(bm)
    inward, against = [], []
    for group, closed in pieces:
        if closed:
            tried = group[:: max(1, len(group) // PIECE_SAMPLES)][:PIECE_SAMPLES]
            out = sum(points_out(tree, face, outward[face.index]) for face in tried) * 2 >= len(tried)
            if not out:
                for face in group:
                    outward[face.index] = -outward[face.index]
        flipped = [face for face in group if face.normal.dot(outward[face.index]) < 0]
        if closed:
            inward += flipped
        else:
            kept = [face for face in group if face not in set(flipped)]
            against += flipped if len(flipped) <= len(kept) else kept
    return inward, against, outward


def thinnest_wall(bm, pieces, outward):
    """
    The thinnest wall of the closed pieces, and where: from faces spread over
    them, a ray goes straight in and meets the far side of the wall.
    """
    faces = [face for group, closed in pieces if closed for face in group if face.calc_area() > 0]
    if not faces:
        return None
    tree = mathutils.bvhtree.BVHTree.FromBMesh(bm)
    step = max(1, len(faces) // WALL_SAMPLES)
    thinnest = None
    for face in faces[::step]:
        way = -outward[face.index]
        start = on_surface(tree, face) + way * RAY_START
        hit, normal, index, distance = tree.ray_cast(start, way)
        if hit is None or index == face.index:
            continue
        # The far side faces out, the way the ray goes; a face across the
        # inside of a fold faces back at it.
        if outward.get(index, normal).dot(way) < LEAVING:
            continue
        if thinnest is None or distance < thinnest[0]:
            thinnest = (distance + RAY_START, face.calc_center_median())
    return thinnest


def shared_edges(bm):
    """The edges joining more than two faces, as a fin or a wall inside a shape makes."""
    return [e for e in bm.edges if len(e.link_faces) > 2]


def loose_parts(bm):
    """The points on no edge and the edges on no face."""
    return [v for v in bm.verts if not v.link_edges], [e for e in bm.edges if not e.link_faces]


def selected_faces(obj):
    """The faces of an object's own mesh a script left selected, as a count, and their heights in the world."""
    mesh = obj.data
    picked = [face for face in mesh.polygons if face.select]
    if not picked or len(picked) == len(mesh.polygons):
        return len(picked), len(mesh.polygons), None
    heights = [(obj.matrix_world @ mesh.vertices[v].co).z for face in picked for v in face.vertices]
    return len(picked), len(mesh.polygons), (min(heights), max(heights))


def counts(obj):
    """What a look says of one object's mesh: each count with where, as words, and whether any is a fault."""
    bm = mesh_of(obj)
    try:
        # A mirrored object is drawn with its faces turned to match; so it is counted.
        if obj.matrix_world.determinant() < 0:
            bmesh.ops.reverse_faces(bm, faces=list(bm.faces))
        if not bm.faces:
            return f"{obj.name}: no faces", False
        bm.normal_update()
        low = mathutils.Vector([min(v.co[i] for v in bm.verts) for i in range(3)])
        high = mathutils.Vector([max(v.co[i] for v in bm.verts) for i in range(3)])
        where = lambda faces: side_words(low, high, sum((f.calc_center_median() for f in faces), mathutils.Vector()) / len(faces))  # noqa: E731
        pieces = islands(bm)
        open_edges = sum(1 for e in bm.edges if len(e.link_faces) == 1)
        shared = len(shared_edges(bm))
        loose_points, loose_edges = (len(found) for found in loose_parts(bm))
        said = []
        faulty = False
        if open_edges or shared:
            faulty = faulty or bool(shared) or bool(faults(bm, gapped_only=not is_cad_part(obj), crossings=False)[0])
            said.append(
                f"open, {open_edges} open edges"
                + (f" and {shared} edges joining more than two faces" if shared else "")
            )
        else:
            said.append("closed, 0 open edges")
        inward, against, outward = turned_round(bm, pieces) if len(bm.faces) <= MOST_FACES else ([], [], None)
        if inward:
            faulty = True
            said.append(f"{len(inward)} faces pointing inward, {where(inward)}")
        if against:
            faulty = True
            said.append(f"{len(against)} faces facing against the rest of their piece, {where(against)}")
        if outward is not None and not inward and not against:
            said.append("no faces pointing inward")
        many = [face for face in bm.faces if len(face.verts) > 4]
        if many:
            bent = sum(1 for face in many if not_flat(face))
            faulty = faulty or bool(bent)
            largest = max(many, key=lambda f: len(f.verts))
            said.append(
                f"{len(many)} faces of more than 4 sides, the largest {len(largest.verts)} sides"
                f" {side_words(low, high, largest.calc_center_median())}, "
                + (f"{bent} not flat" if bent else "all flat")
            )
        else:
            said.append("no faces of more than 4 sides")
        said.append(
            f"{len(pieces)} {'piece' if len(pieces) == 1 else 'pieces'}"
            + (
                f", {loose_points} loose points and {loose_edges} loose edges"
                if loose_points or loose_edges
                else ", no loose points or edges"
            )
        )
        faulty = faulty or bool(loose_points or loose_edges)
        passing, deepest = passing_into(obj, pieces) if len(bm.faces) <= MOST_FACES else (0, None)
        if passing:
            said.append(
                f"{passing} closed pieces of one material passing into each other"
                + (f" by up to {length(deepest)}" if deepest else "")
                + ", as two meshes joined into one leave them"
            )
        wall =thinnest_wall(bm, pieces, outward) if outward is not None else None
        if wall is not None:
            said.append(f"thinnest wall {length(wall[0])}, {side_words(low, high, wall[1])}")
        elif not any(closed for _, closed in pieces):
            said.append("no wall to measure: no piece is closed")
        if obj.type == "MESH":
            picked, total, heights = selected_faces(obj)
            if heights is not None:
                said.append(f"selected: {picked} of {total} faces, from {length(heights[0])} to {length(heights[1])} high")
        return f"{obj.name}: " + "; ".join(said), faulty
    finally:
        bm.free()
