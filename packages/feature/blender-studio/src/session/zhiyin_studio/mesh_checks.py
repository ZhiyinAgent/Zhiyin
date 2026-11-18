"""
What is wrong with a shape's faces and points, as a modeller checks a mesh:
points left lying on others unjoined, faces with no area or lying on another,
faces turned into a closed shape or against the rest of an open one, edges more than two faces share, points
and edges on no face, faces of more than four sides that are not flat, as a look judges them,
faces of four sides folded across both diagonals, and flat areas that smooth shading draws as
curved. Each fault is counted, with one place it is at. Measured on the shape with its steps, in
the world. Which faces point inward, which edges more than two faces share, what lies on no face
and the thinnest wall are measured as a look counts them. A shape's faces are also counted by
their sides.
"""

import math

import bmesh
import bpy
import mathutils
import mathutils.kdtree
import numpy

from .geometry import evaluated_graph
from .look_counts import islands, loose_parts, shared_edges, thinnest_wall, turned_round, warped_by
from .shown_mesh import array, shown_data
from .soundness import MOST_FACES, mesh_of
from .wording import area_text, length, point_text

# Points nearer than this lie in the same place, in metres: a hundredth of a millimetre.
SAME = 1e-5
# A face has no area below this share of the square of its object's size, and below this area.
FLAT_SHARE, FLAT_AREA = 1e-8, 1e-10
# A face of four sides folds when the halves either diagonal splits it into turn from each other by more than this, in degrees.
FOLD = 20
# Faces lie in one plane when their normals turn less than half a degree apart.
COPLANAR = math.cos(math.radians(0.5))
# How many rounds faces in one plane are joined in, at most.
MOST_ROUNDS = 200
# A flat area is checked for its shading when it covers this share of the surface, and this many square metres.
AREA_SHARE, AREA_LEAST = 0.05, 1e-6
# A flat area shades as if curved when a corner's normal leans from it by more than this, in degrees.
LEAN = 2
# Smooth shading leans a flat area that way only across an edge where a face turns from it by about 30° or more, past which Blender's own smoothing by angle keeps an edge sharp.
BEND = 29.5
# The marks Blender keeps on edges as attributes, and how each is said.
EDGE_MARKS = (
    ("crease_edge", "creased"),
    ("bevel_weight_edge", "bevel-weighted"),
    ("sharp_edge", "marked sharp"),
    ("uv_seam", "marked as seams"),
    ("freestyle_edge", "marked for Freestyle lines"),
)


class Mesh:
    """An object's evaluated shape in the world as arrays: points, edges, faces and their triangles."""

    def __init__(self, obj):
        with shown_data(obj) as mesh:
            mesh.calc_loop_triangles()
            self.points = array(mesh.vertices, "co", 3, float)
            matrix = obj.matrix_world
            self.points = self.points @ numpy.array(matrix.to_3x3()).T + numpy.array(matrix.translation)
            self.mirrored = matrix.to_3x3().determinant() < 0
            self.edges = array(mesh.edges, "vertices", 2, numpy.int64)
            self.loop_points = array(mesh.loops, "vertex_index", 1, numpy.int64).ravel()
            self.loop_edges = array(mesh.loops, "edge_index", 1, numpy.int64).ravel()
            self.starts = array(mesh.polygons, "loop_start", 1, numpy.int64).ravel()
            self.sides = array(mesh.polygons, "loop_total", 1, numpy.int64).ravel()
            self.triangles = array(mesh.loop_triangles, "vertices", 3, numpy.int64)
            self.owners = array(mesh.loop_triangles, "polygon_index", 1, numpy.int64).ravel()
            # Each face's and each corner's normal as Blender shades them, in the object's own space.
            self.own_facing = array(mesh.polygons, "normal", 3, float)
            self.corner_normals = array(mesh.corner_normals, "vector", 3, float)
            self.sharp_edges = _flags(mesh, "sharp_edge", len(self.edges))
            self.flat_faces = _flags(mesh, "sharp_face", len(self.sides))
        self.size = float(numpy.linalg.norm(numpy.ptp(self.points, axis=0))) if len(self.points) else 0.0
        corners = self.points[self.triangles] if len(self.triangles) else numpy.empty((0, 3, 3))
        crossed = numpy.cross(corners[:, 1] - corners[:, 0], corners[:, 2] - corners[:, 0]) if len(corners) else numpy.empty((0, 3))
        # Each face's area and the way it faces, from its triangles, turned back where a negative scale mirrors it.
        self.areas = numpy.bincount(self.owners, numpy.linalg.norm(crossed, axis=1) / 2, len(self.sides))
        facing = numpy.zeros((len(self.sides), 3))
        numpy.add.at(facing, self.owners, crossed)
        self.facing = -facing if self.mirrored else facing
        self.centres = numpy.zeros((len(self.sides), 3))
        if len(self.sides):
            self.centres = numpy.add.reduceat(self.points[self.loop_points], self.starts, axis=0) / self.sides[:, None]
        self.face_counts = numpy.bincount(self.loop_edges, minlength=len(self.edges))


def _flags(mesh, key, count):
    """A true-or-false attribute of the mesh, false where it has none."""
    values = numpy.zeros(count, dtype=bool)
    attribute = mesh.attributes.get(key)
    if attribute is not None and len(attribute.data) == count:
        attribute.data.foreach_get("value", values)
    return values


def unjoined(mesh):
    """The points on open edges that lie on another point, unjoined, and one of them."""
    open_points = numpy.unique(mesh.edges[mesh.face_counts == 1])
    if len(open_points) < 2:
        return 0, None
    tree = mathutils.kdtree.KDTree(len(open_points))
    for index in open_points.tolist():
        tree.insert(mesh.points[index], index)
    tree.balance()
    found = [index for index in open_points.tolist() if len(tree.find_range(mesh.points[index], SAME)) > 1]
    return len(found), (mesh.points[found[0]] if found else None)


def doubled(mesh):
    """The faces lying on another face with the same corners, and one of them."""
    if not len(mesh.sides):
        return 0, None
    grid = numpy.round(mesh.points / SAME).astype(numpy.int64)
    corners = grid[mesh.loop_points]
    # A face's corners as a key whatever order they come in: their sum and sum of squares, and how many.
    sums = numpy.add.reduceat(corners, mesh.starts, axis=0)
    squares = numpy.add.reduceat(corners * corners, mesh.starts, axis=0)
    keys = numpy.concatenate([sums, squares, mesh.sides[:, None]], axis=1)
    _, first, counts = numpy.unique(keys, axis=0, return_index=True, return_counts=True)
    twice = first[counts > 1]
    if not len(twice):
        return 0, None
    return int(counts[counts > 1].sum()), mesh.centres[twice[0]]


def without_area(mesh):
    """The faces with no area, and one of them."""
    least = min(FLAT_AREA, FLAT_SHARE * mesh.size * mesh.size)
    flat = numpy.nonzero(mesh.areas <= least)[0]
    return len(flat), (mesh.centres[flat[0]] if len(flat) else None)


def warped(mesh):
    """The faces of more than four sides that are not flat, the most a corner lies off one's plane, and where."""
    count, worst, where = 0, 0.0, None
    for face in numpy.nonzero(mesh.sides > 4)[0].tolist():
        start, sides = int(mesh.starts[face]), int(mesh.sides[face])
        corners = mesh.points[mesh.loop_points[start : start + sides]]
        normal = mesh.facing[face]
        if not numpy.linalg.norm(normal):
            continue
        normal = normal / numpy.linalg.norm(normal)
        off = float(numpy.abs((corners - mesh.centres[face]) @ normal).max())
        reach = float(numpy.linalg.norm(corners - mesh.centres[face], axis=1).max())
        if warped_by(off, reach):
            count += 1
            if off > worst:
                worst, where = off, mesh.centres[face]
    return count, worst, where


def _angles(a, b):
    """The angle between each pair of rows of `a` and `b`, in degrees; 0 where either has no length."""
    lengths = numpy.linalg.norm(a, axis=1) * numpy.linalg.norm(b, axis=1)
    cosines = numpy.einsum("ij,ij->i", a, b) / numpy.where(lengths > 0, lengths, 1)
    return numpy.where(lengths > 0, numpy.degrees(numpy.arccos(numpy.clip(cosines, -1, 1))), 0.0)


def folded(mesh):
    """The faces of four sides that fold past FOLD across both diagonals, the most one folds, and where."""
    quads = numpy.nonzero(mesh.sides == 4)[0]
    if not len(quads):
        return 0, 0.0, None
    p0, p1, p2, p3 = (mesh.points[mesh.loop_points[mesh.starts[quads] + k]] for k in range(4))
    one_way = _angles(numpy.cross(p1 - p0, p2 - p0), numpy.cross(p2 - p0, p3 - p0))
    other_way = _angles(numpy.cross(p1 - p0, p3 - p0), numpy.cross(p2 - p1, p3 - p1))
    folds = numpy.minimum(one_way, other_way)
    bent = numpy.nonzero(folds > FOLD)[0]
    if not len(bent):
        return 0, 0.0, None
    worst = bent[numpy.argmax(folds[bent])]
    return len(bent), float(folds[worst]), mesh.centres[quads[worst]]


def loop_faces_of(mesh):
    """The face each corner belongs to."""
    total = int(mesh.sides.sum())
    within = numpy.arange(total) - numpy.repeat(numpy.cumsum(mesh.sides) - mesh.sides, mesh.sides)
    faces = numpy.empty(len(mesh.loop_points), dtype=numpy.int64)
    faces[numpy.repeat(mesh.starts, mesh.sides) + within] = numpy.repeat(numpy.arange(len(mesh.sides)), mesh.sides)
    return faces


def edge_faces(mesh, loop_faces):
    """The edges two faces share, and those two faces of each."""
    order = numpy.argsort(mesh.loop_edges, kind="stable")
    first = numpy.searchsorted(mesh.loop_edges[order], numpy.arange(len(mesh.edges)))
    shared = numpy.nonzero(mesh.face_counts == 2)[0]
    return shared, loop_faces[order[first[shared]]], loop_faces[order[first[shared] + 1]]


def flat_areas(mesh, a, b):
    """Each face's flat area, as the lowest index of the faces lying in one plane with it, joined by the edges faces a and b share."""
    facing = mesh.own_facing
    level = (numpy.einsum("ij,ij->i", facing[a], facing[b]) > COPLANAR) & (a != b)
    a, b = a[level], b[level]
    labels = numpy.arange(len(mesh.sides))
    for _ in range(MOST_ROUNDS):
        least = numpy.minimum(labels[a], labels[b])
        joined = labels.copy()
        numpy.minimum.at(joined, a, least)
        numpy.minimum.at(joined, b, least)
        joined = joined[joined]
        if numpy.array_equal(joined, labels):
            break
        labels = joined
    return labels


def bent_flats(mesh):
    """
    The flat areas larger than AREA_SHARE of the surface whose corners shade leaning from them past
    LEAN, as smooth shading across an edge where a face meets them at BEND or more draws them; the
    most one leans, its area, and where. A facet of a curved surface, whose neighbours turn from it
    little, is meant to shade so.
    """
    if not len(mesh.sides) or len(mesh.corner_normals) != len(mesh.loop_points):
        return 0, 0.0, 0.0, None
    loop_faces = loop_faces_of(mesh)
    shared, a, b = edge_faces(mesh, loop_faces)
    labels = flat_areas(mesh, a, b)
    smooth = ~mesh.sharp_edges[shared] & ~mesh.flat_faces[a] & ~mesh.flat_faces[b]
    steep = smooth & (_angles(mesh.own_facing[a], mesh.own_facing[b]) >= BEND)
    turned = numpy.zeros(len(mesh.sides), dtype=bool)
    turned[labels[a[steep]]] = True
    turned[labels[b[steep]]] = True
    leans = _angles(mesh.corner_normals, mesh.own_facing[loop_faces])
    area_of = numpy.bincount(labels, mesh.areas, len(mesh.sides))
    leaning = numpy.zeros(len(mesh.sides))
    numpy.maximum.at(leaning, labels[loop_faces], leans)
    large = max(AREA_SHARE * float(mesh.areas.sum()), AREA_LEAST)
    bent = numpy.nonzero((area_of >= large) & (leaning > LEAN) & turned)[0]
    if not len(bent):
        return 0, 0.0, 0.0, None
    worst = bent[numpy.argmax(leaning[bent])]
    corners = numpy.nonzero(labels[loop_faces] == worst)[0]
    corner = corners[numpy.argmax(leans[corners])]
    return len(bent), float(leaning[worst]), float(area_of[worst]), mesh.points[mesh.loop_points[corner]]


def edge_marks_text(obj):
    """How many of a mesh's own edges are creased, bevel-weighted, sharp, seams and Freestyle lines, as Blender's edge attributes keep them."""
    attributes = obj.data.attributes
    said = []
    for key, words in EDGE_MARKS:
        attribute = attributes.get(key)
        if attribute is None or attribute.domain != "EDGE" or attribute.data_type not in ("FLOAT", "BOOLEAN"):
            continue
        values = numpy.zeros(len(attribute.data), dtype=numpy.float32 if attribute.data_type == "FLOAT" else bool)
        attribute.data.foreach_get("value", values)
        count = int(numpy.count_nonzero(values))
        if count:
            said.append(f"{count:,} {'edge' if count == 1 else 'edges'} {words}")
    return ", ".join(said)


def wall_text(obj):
    """A closed shape's thinnest wall and where, as a look measures it, in a sentence; nothing for an open or too large one."""
    bm = mesh_of(obj)
    try:
        if not bm.faces or len(bm.faces) > MOST_FACES:
            return ""
        if obj.matrix_world.determinant() < 0:
            bmesh.ops.reverse_faces(bm, faces=list(bm.faces))
        bm.normal_update()
        pieces = islands(bm)
        if not any(closed for _, closed in pieces):
            return ""
        _, _, outward = turned_round(bm, pieces)
        wall = thinnest_wall(bm, pieces, outward)
    finally:
        bm.free()
    return f" Its thinnest wall is {length(wall[0])}, at {point_text(wall[1])}." if wall is not None else ""


def face_kinds_text(obj):
    """A shape's faces by their sides as it shows: quads, triangles and faces of more than four sides, with where."""
    data = obj.evaluated_get(evaluated_graph()).data
    if not isinstance(data, bpy.types.Mesh) or not len(data.polygons):
        return "no faces"
    sides = array(data.polygons, "loop_total", 1, numpy.int64).ravel()
    centres = array(data.polygons, "center", 3, float)
    matrix = obj.matrix_world

    def at(index):
        return point_text(matrix @ mathutils.Vector(centres[index]))

    quads = int((sides == 4).sum())
    triangles = numpy.nonzero(sides == 3)[0]
    many = numpy.nonzero(sides > 4)[0]
    said = [f"{quads:,} {'quad' if quads == 1 else 'quads'}"]
    if len(triangles):
        said.append(f"{len(triangles):,} {'triangle' if len(triangles) == 1 else 'triangles'}, as at {at(triangles[0])}")
    if len(many):
        largest = many[numpy.argmax(sides[many])]
        said.append(
            f"{len(many):,} of more than four sides, the largest of {int(sides[largest])} at {at(largest)}"
        )
    if not len(triangles) and not len(many):
        said.append("no triangles or faces of more than four sides")
    return ", ".join(said)


def _counted(found, one, many):
    return f"{len(found)} {one if len(found) == 1 else many}"


def _middle(faces):
    return sum((f.calc_center_median() for f in faces), mathutils.Vector()) / len(faces)


def turned_faults(obj):
    """The faces pointing into a closed piece or against the rest of an open one, the edges more than two faces share and what lies on no face."""
    bm = mesh_of(obj)
    try:
        if not bm.faces:
            return []
        # A mirrored object is drawn with its faces turned to match; so it is measured.
        if obj.matrix_world.determinant() < 0:
            bmesh.ops.reverse_faces(bm, faces=list(bm.faces))
        bm.normal_update()
        said = []
        inward, against, _ = turned_round(bm, islands(bm))
        if inward:
            largest = max(inward, key=lambda f: f.calc_area())
            said.append(f"{_counted(inward, 'face points', 'faces point')} into its shape, the largest at {point_text(largest.calc_center_median())}")
        if against:
            said.append(f"{_counted(against, 'face faces', 'faces face')} against the rest of its piece, as at {point_text(_middle(against))}")
        shared = shared_edges(bm)
        if shared:
            middle = (shared[0].verts[0].co + shared[0].verts[1].co) / 2
            said.append(f"{_counted(shared, 'edge is', 'edges are')} shared by more than two faces, as at {point_text(middle)}")
        points, edges = loose_parts(bm)
        if points or edges:
            parts = [_counted(found, word, word + "s") for found, word in ((points, "point"), (edges, "edge")) if found]
            where = points[0].co if points else (edges[0].verts[0].co + edges[0].verts[1].co) / 2
            said.append(f"{' and '.join(parts)} on no face, as at {point_text(where)}")
        return said
    finally:
        bm.free()


def mesh_faults(obj):
    """What is wrong with an object's faces and points, each in words with one place, or an empty list."""
    mesh = Mesh(obj)
    if len(mesh.sides) > MOST_FACES:
        return [f"its {len(mesh.sides):,} faces are more than the {MOST_FACES:,} its faces are checked to"]
    said = []
    # Blender lays a curve's caps on its sides' ends without joining them, as every curve has them.
    count, where = unjoined(mesh) if obj.type != "CURVE" else (0, None)
    if count:
        said.append(f"{count} points lie on others without being joined to them, so its surface is open along them, as at {point_text(where)}")
    count, where = doubled(mesh)
    if count:
        said.append(f"{count} faces lie on one another with the same corners, as at {point_text(where)}")
    count, where = without_area(mesh)
    if count:
        said.append(f"{count} {'face has' if count == 1 else 'faces have'} no area, as at {point_text(where)}")
    said += turned_faults(obj)
    count, worst, where = warped(mesh)
    if count:
        said.append(
            f"{count} {'face' if count == 1 else 'faces'} of more than four sides {'is' if count == 1 else 'are'} not flat,"
            f" a corner up to {length(worst)} off its plane at {point_text(where)}"
        )
    count, worst, where = folded(mesh)
    if count:
        said.append(
            f"{count} {'face' if count == 1 else 'faces'} of four sides {'folds' if count == 1 else 'fold'} more than {FOLD}° across"
            f" both diagonals, up to {worst:.0f}° at {point_text(where)}, so {'it shades and splits' if count == 1 else 'they shade and split'}"
            " into triangles unevenly"
        )
    count, lean, area, where = bent_flats(mesh)
    if count:
        said.append(
            f"{count} flat {'area shades' if count == 1 else 'areas shade'} as if curved, smooth shading leaning its corners"
            f" up to {lean:.0f}° off a flat area of {area_text(area)} at {point_text(where)}: keep its edges sharp"
            " with a smooth step by angle, or weight its normals by face area"
        )
    return said
