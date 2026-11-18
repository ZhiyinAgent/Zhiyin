"""
Shapes as measuring takes them, in world space: an object's evaluated mesh, its own or with its
parts, an instance it places, or a copy of a mesh placed anew by a matrix. Each has its surface,
its closed shells, points over it, and the same surface a hair inside, so shapes that only touch
do not go into each other. Between two: the nearest points, how deep one goes into the other and
where, and what a ray from one meets.
"""

import bmesh
import bpy
import mathutils
import mathutils.bvhtree
import numpy

from .finding import subjects
from .geometry import SHAPE_TYPES, add_part, copies_of, evaluated_graph, shapes_of
from .mesh_math import spread
from .shown_mesh import Shell, is_inside, joined_faces, nearest_between, shown_bmesh
from .tolerances import INSET, THIN_SHARE
from .wording import point_text

# Points of a shape measured, at most: its corners, and its faces' middles.
MOST_POINTS = 6000
# Points spread over a surface by area to find where two come nearest, besides its corners.
SPREAD_POINTS = 4000
# A point behind a face it crosses lies within this cosine of straight behind it.
BEHIND = 0.9


def _groups(bm):
    """The faces of each closed shell of a mesh, joined by shared edges; a piece with an open edge is none."""
    return [
        [face.index for face in group]
        for group in joined_faces(bm)
        if all(edge.is_manifold for face in group for edge in face.edges)
    ]


# What a Mesh holds as arrays: those taken as they are when meshes are joined, and those that
# number its points, faces or parts, counted on from the meshes before.
AS_THEY_ARE = ("verts", "normals", "centres", "facing", "centre_steps")
NUMBERED = {"triangles": "verts", "centre_faces": "faces", "triangle_faces": "faces", "vert_parts": "parts", "face_parts": "parts"}


class Mesh:
    """
    A mesh's points, faces and closed shells, in the space it was read in, ready to place. It is
    one part, or the parts of an object joined, each part's points and faces numbered as its own,
    so each part is moved in by its own thickness.
    """

    def __init__(self, bm):
        bm.normal_update()
        bm.verts.index_update()
        bm.faces.index_update()
        self.verts = numpy.array([tuple(v.co) for v in bm.verts], dtype=float).reshape(-1, 3)
        self.normals = numpy.array([tuple(v.normal) for v in bm.verts], dtype=float).reshape(-1, 3)
        self.polygons = [[v.index for v in face.verts] for face in bm.faces]
        step = max(1, len(bm.faces) // MOST_POINTS)
        faces = list(bm.faces)[::step]
        self.centres = numpy.array([tuple(f.calc_center_median()) for f in faces], dtype=float).reshape(-1, 3)
        self.facing = numpy.array([tuple(f.normal) for f in faces], dtype=float).reshape(-1, 3)
        # The face each middle is of, and how many faces it stands for.
        self.centre_faces = numpy.arange(0, len(bm.faces), step, dtype=int)
        self.centre_steps = numpy.full(len(self.centre_faces), step, dtype=int)
        loop_triangles = bm.calc_loop_triangles()
        self.triangles = numpy.array(
            [[loop.vert.index for loop in triangle] for triangle in loop_triangles], dtype=int
        ).reshape(-1, 3)
        self.triangle_faces = numpy.array([triangle[0].face.index for triangle in loop_triangles], dtype=int)
        self.groups = _groups(bm)
        self.parts = 1
        self.vert_parts = numpy.zeros(len(self.verts), dtype=int)
        self.face_parts = numpy.zeros(len(self.polygons), dtype=int)

    @property
    def empty(self):
        return not self.polygons

    @classmethod
    def read(cls, bm):
        """A mesh read from a bmesh, which is freed."""
        try:
            return cls(bm)
        finally:
            bm.free()

    @classmethod
    def joined(cls, meshes):
        """Meshes as one, each a part of its own."""
        if not meshes:
            return cls.read(bmesh.new())
        joined = cls.__new__(cls)
        joined.polygons, joined.groups = [], []
        start = {"verts": 0, "faces": 0, "parts": 0}
        held = {name: [] for name in (*AS_THEY_ARE, *NUMBERED)}
        for mesh in meshes:
            joined.polygons += [[i + start["verts"] for i in polygon] for polygon in mesh.polygons]
            joined.groups += [[face + start["faces"] for face in group] for group in mesh.groups]
            for name, values in held.items():
                value = getattr(mesh, name)
                values.append(value + start[NUMBERED[name]] if name in NUMBERED else value)
            start["verts"] += len(mesh.verts)
            start["faces"] += len(mesh.polygons)
            start["parts"] += mesh.parts
        for name, values in held.items():
            setattr(joined, name, numpy.concatenate(values))
        joined.parts = start["parts"]
        return joined

    @classmethod
    def of_object(cls, obj, to=None):
        """An object's evaluated shape, each of its parts' and the instances each places, in the world or by `to`."""
        depsgraph = evaluated_graph()
        meshes = []
        for part in shapes_of(obj):
            bm = bmesh.new()
            add_part(bm, part, depsgraph)
            if to is not None:
                bmesh.ops.transform(bm, matrix=to, verts=list(bm.verts))
            meshes.append(cls.read(bm))
        return cls.joined(meshes)

    @classmethod
    def of_own(cls, obj):
        """An object's own evaluated shape, without its parts or instances, in the world."""
        return cls.read(shown_bmesh(obj) if obj.type in SHAPE_TYPES else bmesh.new())

    @classmethod
    def of_data(cls, mesh):
        """A mesh datablock in its own space."""
        bm = bmesh.new()
        bm.from_mesh(mesh)
        return cls.read(bm)


class Shape:
    """
    A Mesh placed in the world by `matrix`, measured there. Its points, and its surface a hair
    inside, are moved in by INSET, or a closed part thinner than that, as a label or lettering, by
    THIN_SHARE of its thickness: by more, its points would come out the far side. Each part is moved
    in by its own measure, so lettering attached to a jar is still a thin sheet.
    """

    def __init__(self, mesh, matrix=None, label=""):
        self.label = label
        self.mesh = mesh
        if matrix is None:
            matrix = mathutils.Matrix.Identity(4)
        self.matrix = matrix
        turn = numpy.array(matrix.to_3x3(), dtype=float)
        shift = numpy.array(matrix.translation, dtype=float)
        bend = numpy.linalg.inv(turn) if abs(numpy.linalg.det(turn)) > 1e-18 else numpy.eye(3)

        def placed(points):
            return points @ turn.T + shift

        def facing(normals):
            found = normals @ bend
            size = numpy.linalg.norm(found, axis=1, keepdims=True)
            return found / numpy.where(size > 0, size, 1)

        self.verts = placed(mesh.verts)
        self.low = self.verts.min(axis=0) if len(self.verts) else numpy.zeros(3)
        self.high = self.verts.max(axis=0) if len(self.verts) else numpy.zeros(3)
        a, b, c = (self.verts[mesh.triangles[:, i]] - self.low for i in range(3))
        self._areas = numpy.linalg.norm(numpy.cross(b - a, c - a), axis=1) / 2
        self.area = float(self._areas.sum())
        insets = self._part_insets(numpy.einsum("ij,ij->i", a, numpy.cross(b, c)) / 6)
        step = max(1, len(self.verts) // MOST_POINTS)
        self.centres = placed(mesh.centres)
        self.facing = facing(mesh.facing)
        self.points = numpy.concatenate([self.verts[::step], self.centres])
        normals = numpy.concatenate([facing(mesh.normals)[::step], self.facing])
        vert_insets = insets[mesh.vert_parts]
        # How far each point was moved in.
        self.point_insets = numpy.concatenate([vert_insets[::step], insets[mesh.face_parts[mesh.centre_faces]]])
        self.moved = self.points - normals * self.point_insets[:, None]
        moved_verts = self.verts - facing(mesh.normals) * vert_insets[:, None]
        self.surface = mathutils.bvhtree.BVHTree.FromPolygons(self.verts.tolist(), mesh.polygons)
        self.inner = mathutils.bvhtree.BVHTree.FromPolygons(moved_verts.tolist(), mesh.polygons)
        self._shells = None
        self._near = None

    def _part_insets(self, volumes):
        """
        How far each part is moved in: a hair, or for a closed part THIN_SHARE of its thickness,
        which twice its volume over its area is, when that is less. `volumes` is each triangle's
        signed volume, which over a closed part sums to the part's.
        """
        mesh = self.mesh
        if not len(mesh.triangles):
            return numpy.full(mesh.parts, INSET)
        in_shell = numpy.zeros(len(mesh.polygons), dtype=bool)
        for group in mesh.groups:
            in_shell[group] = True
        triangle_parts = mesh.face_parts[mesh.triangle_faces]
        area = numpy.bincount(triangle_parts, self._areas, minlength=mesh.parts)
        volume = numpy.abs(numpy.bincount(triangle_parts, volumes, minlength=mesh.parts))
        open_part = numpy.bincount(mesh.face_parts, ~in_shell, minlength=mesh.parts) > 0
        thin = THIN_SHARE * 2 * volume / numpy.where(area > 0, area, 1)
        return numpy.where(open_part | (area <= 0), INSET, numpy.minimum(INSET, thin))

    def face_samples(self):
        """The middles of its faces as measured, each with the way it faces and the area it stands for."""
        faces = numpy.bincount(self.mesh.triangle_faces, self._areas, minlength=len(self.mesh.polygons))
        return self.centres, self.facing, faces[self.mesh.centre_faces] * self.mesh.centre_steps

    @property
    def middle(self):
        return (self.low + self.high) / 2

    @property
    def shells(self):
        if self._shells is None:
            corners = self.verts.tolist()
            self._shells = []
            for group in self.mesh.groups:
                used = sorted({i for face in group for i in self.mesh.polygons[face]})
                where = {i: k for k, i in enumerate(used)}
                self._shells.append(
                    Shell([corners[i] for i in used], [[where[i] for i in self.mesh.polygons[face]] for face in group])
                )
        return self._shells

    def near_points(self):
        """Its corners, and points spread over its faces by area, where it may come nearest another."""
        if self._near is None:
            step = max(1, len(self.verts) // SPREAD_POINTS)
            spread_over = spread(self.verts[self.mesh.triangles], SPREAD_POINTS) if len(self.mesh.triangles) else numpy.zeros((0, 3))
            self._near = numpy.concatenate([self.verts[::step], spread_over])
        return self._near


def box_gap(one, other):
    """How far apart two shapes' boxes are: a distance they cannot come nearer than."""
    apart = numpy.maximum(one.low - other.high, other.low - one.high)
    return float(numpy.linalg.norm(numpy.maximum(apart, 0)))


def boxes_meet(one, other, margin=0.0):
    return bool(numpy.all(one.low <= other.high + margin) and numpy.all(other.low <= one.high + margin))


def _inside_depth(one, other):
    """
    How deep the deepest of one shape's points lies inside the other's closed shells, and where;
    (0, None) when none does. A point counts when it is inside once moved in, and lies deeper than
    it was moved, measured from where it is on the surface.
    """
    deepest, where = 0.0, None
    for shell in other.shells:
        low, high = numpy.array(shell.low), numpy.array(shell.high)
        within = numpy.nonzero(((one.moved >= low) & (one.moved <= high)).all(axis=1))[0]
        for index in within:
            if not is_inside(shell.tree, mathutils.Vector(one.moved[index])):
                continue
            point = mathutils.Vector(one.points[index])
            found = shell.tree.find_nearest(point)
            if found[0] is not None and found[3] > max(deepest, one.point_insets[index]):
                deepest, where = found[3], point
    return deepest, where


def _through_depth(one, other, crossed):
    """
    How far one shape reaches through the faces of the other it crosses: on whichever side
    of them it reaches less far, so a stone sunk into open ground is said as sunk, whichever
    way the ground's faces point. Its points as far from the other's box as it is large are
    measured, so a stone sunk into flat ground is measured below it.
    """
    sides = [(0.0, None), (0.0, None)]
    reach = one.high - one.low + INSET
    within = numpy.nonzero(((one.points >= other.low - reach) & (one.points <= other.high + reach)).all(axis=1))[0]
    for index in within:
        point = mathutils.Vector(one.points[index])
        location, normal, face, distance = other.surface.find_nearest(point)
        if location is None or face not in crossed or distance <= 0:
            continue
        way = (point - location) / distance
        cosine = way.dot(normal)
        if abs(cosine) >= BEHIND:
            side = 0 if cosine < 0 else 1
            if distance > sides[side][0]:
                sides[side] = (distance, point)
    found = [side for side in sides if side[1] is not None]
    return min(found, key=lambda side: side[0]) if len(found) == 2 else (0.0, None)


def into(one, other):
    """
    Whether two shapes go into each other: None when they do not, else how deep, 0 when
    their surfaces cross where no depth is measured, and the deepest place.
    """
    if not boxes_meet(one, other):
        return None
    depths = [_inside_depth(one, other), _inside_depth(other, one)]
    deepest = max(depths, key=lambda found: found[0])
    if deepest[1] is not None:
        return deepest
    pairs = one.inner.overlap(other.inner)
    if not pairs:
        return None
    through = max(
        _through_depth(one, other, {j for _, j in pairs}),
        _through_depth(other, one, {i for i, _ in pairs}),
        key=lambda found: found[0],
    )
    if through[1] is not None:
        return through
    i, _ = pairs[0]
    face = one.mesh.polygons[i]
    return 0.0, mathutils.Vector(one.verts[face].mean(axis=0))


def nearest(one, other):
    """
    Where two surfaces come nearest: the distance and the points on each, from each one's
    corners and points spread over its faces.
    """
    return nearest_between(*((shape.near_points(), shape.low, shape.high, shape.surface) for shape in (one, other)))


def first_hit(one, others, way):
    """
    What a ray along `way` from any point of one shape meets first among others, and how
    far: (distance, start, hit, the shape met), or None when it meets none.
    """
    best = None
    way = mathutils.Vector(way)
    for point in one.near_points():
        start = mathutils.Vector(point)
        for other in others:
            hit, _, _, distance = other.surface.ray_cast(start, way)
            if hit is not None and (best is None or distance < best[0]):
                best = (distance, start, hit, other)
    return best


def instance_shapes(obj, meshes):
    """
    Each instance an object places, as a shape of its own, read from what Blender evaluated:
    labelled by what it copies and where it stands. `meshes` keeps each copied mesh read once.
    """
    shapes = []
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for instance in depsgraph.object_instances:
        if not instance.is_instance or instance.parent is None or instance.parent.original != obj:
            continue
        copied = instance.object
        if copied.type not in SHAPE_TYPES:
            continue
        key = (copied.data or copied).as_pointer()
        if key not in meshes:
            data = bpy.data.meshes.new_from_object(copied, preserve_all_data_layers=False, depsgraph=depsgraph)
            try:
                meshes[key] = Mesh.of_data(data)
            finally:
                bpy.data.meshes.remove(data)
        shapes.append((copied.original.name, instance.matrix_world.copy(), meshes[key]))
    return shapes


class SceneShapes:
    """
    The shown objects' shapes but those left out: each object's own shape, its parts being
    objects of their own, and each instance an object places as a shape of its own.
    """

    def __init__(self, left_out):
        self.found = []
        self.objects = self.instances = 0
        meshes = {}
        for obj in subjects():
            if left_out(obj):
                continue
            own = Mesh.of_own(obj)
            if not own.empty:
                self.found.append(Shape(own, label=obj.name))
                self.objects += 1
            if copies_of(obj):
                for source, matrix, mesh in instance_shapes(obj, meshes):
                    shape = Shape(mesh, matrix)
                    shape.label = f"an instance of {source} placed by {obj.name} at {point_text(shape.middle)}"
                    self.found.append(shape)
                    self.instances += 1

    def said(self):
        objects = f"{self.objects:,} other object{'s' if self.objects != 1 else ''}"
        if not self.instances:
            return f"Measured against {objects}."
        return f"Measured against {objects} and {self.instances:,} instance{'s' if self.instances != 1 else ''}."
