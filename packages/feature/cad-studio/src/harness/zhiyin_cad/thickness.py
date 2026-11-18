"""
How thick a part is, wherever its surface is: the measure the checks for
the way a part is made and the wall requirement both read. A part is meshed
once, points are spread over its surface by area, and at each the largest
ball inside the part that touches the surface there is found, with how far
the other side lies straight in. Rays through the part, and the exact face
nearest a point of its mesh, are the instruments, here for both.
"""

import math
import time

import build123d as bd
import numpy

# How many points of a part's surface its thicknesses are measured at, and at most how many
# points of its surface stand for it when they are.
PROBES = 1500
CLOUD = 300_000
# How far, in mm, a ball measured on the exact faces may reach past them and still fit, at most.
EXACT = 1e-3
# The nominal wall is the thickness of the part's largest faces, those that hold this share of its
# surface, so ribs and bosses on it, however many, do not set it.
NOMINAL_SHARE = 0.25


class OutOfTime(Exception):
    """The build's time for these checks ran out."""


def in_time(by):
    if by is not None and time.time() > by:
        raise OutOfTime()


def tolerance(shape):
    return min(0.02, max(shape.bounding_box().diagonal, 1e-3) * 1e-3)


def _triangulation(face):
    """A face's mesh as meshing the part left it, its triangles facing out: meshing faces one by one costs far more."""
    from OCP.BRep import BRep_Tool
    from OCP.TopAbs import TopAbs_REVERSED
    from OCP.TopLoc import TopLoc_Location

    location = TopLoc_Location()
    poly = BRep_Tool.Triangulation_s(face.wrapped, location)
    if poly is None or poly.NbTriangles() == 0:
        return numpy.zeros((0, 3)), numpy.zeros((0, 3), dtype=numpy.int64)
    move = location.Transformation()
    corners = numpy.array([tuple(poly.Node(i).Transformed(move).Coord()) for i in range(1, poly.NbNodes() + 1)], dtype=float)
    order = (1, 3, 2) if face.wrapped.Orientation() == TopAbs_REVERSED else (1, 2, 3)
    triangles = numpy.array([[poly.Triangle(i).Value(k) - 1 for k in order] for i in range(1, poly.NbTriangles() + 1)], dtype=numpy.int64)
    return corners, triangles


def part_mesh(shape):
    """
    The part meshed once for the measures: each face's corners and triangles,
    in the order of shape.faces(), read at once, as finding the part's box
    afterwards takes its mesh away.
    """
    shape.mesh(tolerance(shape), 0.2)
    return [_triangulation(face) for face in shape.faces()]


def _face_mesh(mesh):
    """The part's mesh as one, with the index in shape.faces() of the face each triangle stands for."""
    corners, triangles, owners = [], [], []
    count = 0
    for index, (c, t) in enumerate(mesh):
        if not len(t):
            continue
        corners.append(c)
        triangles.append(t + count)
        owners.append(numpy.full(len(t), index))
        count += len(c)
    if not triangles:
        return numpy.zeros((0, 3)), numpy.zeros((0, 3), dtype=numpy.int64), numpy.zeros(0, dtype=numpy.int64)
    return numpy.vstack(corners), numpy.vstack(triangles), numpy.concatenate(owners)


def _spread(corners, triangles, count, seed):
    """`count` points spread over a mesh by area, each with its facet's outward normal and the index of its facet."""
    a, b, c = (corners[triangles[:, k]] for k in range(3))
    cross = numpy.cross(b - a, c - a)
    sizes = numpy.linalg.norm(cross, axis=1)
    kept = numpy.flatnonzero(sizes > 1e-12)
    if not len(kept):
        raise ValueError("its mesh has no facet large enough to measure")
    a, b, c, cross, sizes = a[kept], b[kept], c[kept], cross[kept], sizes[kept]
    rng = numpy.random.default_rng(seed)
    pick = rng.choice(len(sizes), size=count, p=sizes / sizes.sum())
    u, v = rng.random(count), rng.random(count)
    flip = u + v > 1
    u[flip], v[flip] = 1 - u[flip], 1 - v[flip]
    points = a[pick] + u[:, None] * (b[pick] - a[pick]) + v[:, None] * (c[pick] - a[pick])
    return points, cross[pick] / sizes[pick, None], kept[pick]


def on_face(face, point):
    """The point of a face's exact surface nearest `point`, with the face's outward normal there, or nothing."""
    from OCP.BRep import BRep_Tool
    from OCP.BRepGProp import BRepGProp_Face
    from OCP.gp import gp_Pnt, gp_Vec
    from OCP.ShapeAnalysis import ShapeAnalysis_Surface

    uv = ShapeAnalysis_Surface(BRep_Tool.Surface_s(face.wrapped)).ValueOfUV(gp_Pnt(*map(float, point)), 1e-7)
    at, normal = gp_Pnt(), gp_Vec()
    BRepGProp_Face(face.wrapped).Normal(uv.X(), uv.Y(), at, normal)
    n = numpy.array([normal.X(), normal.Y(), normal.Z()])
    length = numpy.linalg.norm(n)
    if length < 1e-12:
        return None
    return numpy.array([at.X(), at.Y(), at.Z()]), n / length


def rays(shape):
    from OCP.IntCurvesFace import IntCurvesFace_ShapeIntersector

    found = IntCurvesFace_ShapeIntersector()
    found.Load(shape.wrapped, 1e-6)
    return found


def first_hit(rays, start, way, after=1e-6):
    """How far along `way` from `start` the ray first meets the part, or nothing."""
    from OCP.gp import gp_Dir, gp_Lin, gp_Pnt

    rays.Perform(gp_Lin(gp_Pnt(*map(float, start)), gp_Dir(*map(float, way))), after, 1e7)
    if not rays.IsDone() or rays.NbPnt() == 0:
        return None
    hits = [rays.WParameter(i) for i in range(1, rays.NbPnt() + 1) if rays.WParameter(i) > after]
    return min(hits) if hits else None


def hits(rays, start, way):
    """Every distance along `way` from `start` at which the ray meets the part, nearest first."""
    from OCP.gp import gp_Dir, gp_Lin, gp_Pnt

    rays.Perform(gp_Lin(gp_Pnt(*map(float, start)), gp_Dir(*map(float, way))), 0.0, 1e7)
    if not rays.IsDone():
        return []
    return sorted(rays.WParameter(i) for i in range(1, rays.NbPnt() + 1))


def thicknesses(shape, count=PROBES, by=None, mesh=None):
    """
    The part's thickness at `count` points of its surface: the diameter of
    the largest ball inside it that touches the surface there, so a rib's top
    reads as the rib's width and a solid boss as its diameter. The ball is
    found among points of the surface, so it may read a little large where
    they are sparse, never small. Answers the points, their outward normals,
    their thicknesses, how far each is from the other side straight in, as a
    wall is measured, and the index in shape.faces() of the face each is on.
    """
    from scipy.spatial import cKDTree

    slack = tolerance(shape)
    corners, triangles, owners = _face_mesh(mesh if mesh is not None else part_mesh(shape))
    if not len(triangles):
        nothing = numpy.zeros(0)
        return numpy.zeros((0, 3)), numpy.zeros((0, 3)), nothing, nothing, nothing.astype(numpy.int64)
    points, normals, facets = _spread(corners, triangles, count, 1)
    through_part = rays(shape)
    # From just outside, as a facet may lie a little inside or outside the surface it stands for.
    off = 3 * slack

    def through(k, p, n):
        if k % 50 == 0:
            in_time(by)
        far = [h for h in hits(through_part, p + n * off, -n) if h > 2 * off]
        return far[0] - off if far else 0.0

    reach = numpy.array([through(k, p, n) for k, (p, n) in enumerate(zip(points, normals))])
    measured = reach > 0
    points, normals, reach, faces = points[measured], normals[measured], reach[measured], owners[facets[measured]]
    if not len(points):
        return points, normals, reach, reach, faces
    # The surface as points close enough that a ball cannot slip between them.
    spacing = max(numpy.median(reach) / 4, math.sqrt(shape.area / CLOUD))
    cloud, _, _ = _spread(corners, triangles, int(min(CLOUD, max(count, shape.area / spacing**2))), 2)
    tree = cKDTree(numpy.vstack([cloud, corners]))
    low, high = numpy.zeros(len(points)), reach / 2
    for _ in range(18):
        in_time(by)
        middle = (low + high) / 2
        nearest, _ = tree.query(points - normals * middle[:, None])
        fits = nearest >= middle - slack
        low = numpy.where(fits, middle, low)
        high = numpy.where(fits, high, middle)
    return points, normals, 2 * low, reach, faces


class Balls:
    """The largest ball inside a part touching a point of one of its faces, measured on its exact faces."""

    def __init__(self, shape):
        from OCP.BRepExtrema import BRepExtrema_DistShapeShape

        self.faces = shape.faces()
        self.slack = min(EXACT, tolerance(shape))
        self.distance = BRepExtrema_DistShapeShape()
        self.distance.LoadS2(bd.Compound(self.faces).wrapped)

    def _fits(self, p, n, diameter):
        from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeVertex
        from OCP.gp import gp_Pnt

        radius = diameter / 2
        self.distance.LoadS1(BRepBuilderAPI_MakeVertex(gp_Pnt(*map(float, p - n * radius))).Vertex())
        self.distance.Perform()
        return self.distance.IsDone() and self.distance.Value() >= radius - self.slack

    def _exact(self, face, p, n):
        found = on_face(self.faces[int(face)], p)
        return found if found is not None else (p, n)

    def over(self, face, p, n, diameter):
        """Whether a ball of `diameter` touching the face at `p` fits inside the part."""
        return self._fits(*self._exact(face, p, n), diameter)

    def largest(self, face, p, n, most, by=None):
        """The diameter of the largest ball touching the face at `p`, given one it is no larger than."""
        p, n = self._exact(face, p, n)
        low, high = 0.0, most
        for _ in range(16):
            in_time(by)
            middle = (low + high) / 2
            if self._fits(p, n, middle):
                low = middle
            else:
                high = middle
        return low


def nominal_wall(shape, thick, faces):
    """The part's nominal wall: the median thickness on its largest faces, those that hold a quarter of its surface."""
    areas = numpy.array([face.area for face in shape.faces()])
    order = numpy.argsort(-areas)
    held = numpy.cumsum(areas[order])
    largest = order[: int(numpy.searchsorted(held, NOMINAL_SHARE * held[-1])) + 1]
    on = numpy.isin(faces, largest)
    return float(numpy.median(thick[on] if on.sum() >= 10 else thick))
