"""
Whether two solids' surfaces come within a reach of each other, found on
their meshes: quick where the exact measure is slow, as on curved faces. A
yes holds to within the mesh's tolerance, as every point measured lies on
a surface or that near it; a no is not sure, and the exact measure has the
last word.

A point is measured only to the triangles that can lie within the reach of
it. A small triangle lies in a ball round its middle, so one within the
reach of a point has its middle within the reach and that ball's radius; a
point among the many small triangles of a curved face is measured to those
round it alone. A large one, as a flat face or a long cylinder is meshed
in, has points in rows over it, so one within the reach of a point has one
of those within the reach and the distance its rows leave between them.
"""

import copy

import numpy
from OCP.BRep import BRep_Tool
from OCP.TopLoc import TopLoc_Location
from scipy.spatial import cKDTree

# How closely a surface's mesh keeps to it, and how far apart the points
# sampled over each triangle lie, in millimetres.
MESH_TOLERANCE = 0.02
SPACING = 8.0
# How many points are measured to the triangles round them at once: the
# nearest few first, as they most often settle it, then more at a time.
FIRST_BATCH = 50
BATCH = 2000
# The largest radius, in mm, of each group of small triangles, those found
# by their middles; a larger one is found by points in rows over it, ROWS mm
# apart, each point of it within COVER times that of one of them.
SIZES = (0.25, 1.0, 2.0)
ROWS = 1.5
COVER = 1.12


def _meshed(solid):
    """The solid's mesh at MESH_TOLERANCE, as build123d meshes it: its corners and its triangles, by their corners' places among them."""
    solid.mesh(MESH_TOLERANCE, 0.2)
    corners, triangles, offset = [], [], 0
    for face in solid.faces():
        where = TopLoc_Location()
        poly = BRep_Tool.Triangulation_s(face.wrapped, where)
        if poly is None:
            raise ValueError("a face of the solid could not be divided into triangles")
        trsf = where.Transformation()
        place = numpy.array([[trsf.Value(r, c) for c in range(1, 5)] for r in range(1, 4)])
        nodes = numpy.array([(p.X(), p.Y(), p.Z()) for p in (poly.Node(i) for i in range(1, poly.NbNodes() + 1))], dtype=float).reshape(-1, 3)
        corners.append(nodes @ place[:, :3].T + place[:, 3])
        triangles.append(numpy.array([(t.Value(1), t.Value(2), t.Value(3)) for t in poly.Triangles()], dtype=numpy.int64).reshape(-1, 3) - 1 + offset)
        offset += len(nodes)
    if not corners:
        return numpy.zeros((0, 3)), numpy.zeros((0, 3), dtype=numpy.int64)
    return numpy.concatenate(corners), numpy.concatenate(triangles)


def _radii(a, b, c):
    """The middle of each triangle (a, b, c), and the radius of the ball round it that holds the triangle."""
    middles = (a + b + c) / 3
    return middles, numpy.sqrt(numpy.max([((one - middles) ** 2).sum(axis=1) for one in (a, b, c)], axis=0)) if len(a) else numpy.zeros(0)


def _rows(a, b, c, apart):
    """
    Points over each triangle (a, b, c), with the triangle each lies on: in
    rows parallel to its longest side, no further than `apart` from row to
    row nor along a row, so a long sliver has about as many points as it is
    long. Every point of a triangle lies within COVER times `apart` of one.
    """
    points, owners = [], []
    for index, corners in enumerate(zip(a, b, c)):
        sides = [numpy.linalg.norm(corners[(k + 1) % 3] - corners[k]) for k in range(3)]
        k = int(numpy.argmax(sides))
        # Turned so that the longest side runs from p to q, r opposite it.
        p, q, r = corners[k], corners[(k + 1) % 3], corners[(k + 2) % 3]
        height = numpy.linalg.norm(numpy.cross(q - p, r - p)) / max(sides[k], 1e-12)
        rows = max(1, int(numpy.ceil(height / apart)))
        for t in numpy.arange(rows + 1) / rows:
            start, end = p + (r - p) * t, q + (r - q) * t
            along = max(1, int(numpy.ceil(sides[k] * (1 - t) / apart)))
            points.append(start + (end - start) * (numpy.arange(along + 1) / along)[:, None])
            owners.append(numpy.full(along + 1, index))
    return numpy.concatenate(points), numpy.concatenate(owners)


class _Triangles:
    """
    A mesh's triangles, found near a point as the module says: those up to
    the last of SIZES grouped by size, each group's middles in a tree; the
    larger by points in rows over them, ROWS apart. Built once, and shared
    by every move of the mesh.
    """

    def __init__(self, corners, triangles):
        a, b, c = (corners[triangles[:, k]] for k in range(3))
        self.corners = (a, b, c)
        middles, radii = _radii(a, b, c)
        self.groups = []
        low = -1.0
        for high in SIZES:
            chosen = numpy.nonzero((radii > low) & (radii <= high))[0]
            if len(chosen):
                self.groups.append((cKDTree(middles[chosen]), chosen, float(radii[chosen].max())))
            low = high
        large = numpy.nonzero(radii > low)[0]
        self.large = None
        if len(large):
            spread, owners = _rows(a[large], b[large], c[large], ROWS)
            self.large = (cKDTree(spread), large[owners])

    def near(self, points, reach):
        """Each point's index with each triangle that may lie within `reach` of it, as two arrays."""
        which, triangle = [], []
        for tree, chosen, radius in self.groups:
            found = tree.query_ball_point(points, reach + radius)
            counts = numpy.fromiter((len(f) for f in found), dtype=numpy.int64, count=len(found))
            if counts.sum():
                which.append(numpy.repeat(numpy.arange(len(points)), counts))
                triangle.append(chosen[numpy.concatenate([numpy.asarray(f, dtype=numpy.int64) for f in found if f])])
        if self.large is not None:
            # Each large triangle once, however many of its points are near.
            tree, owners = self.large
            found = tree.query_ball_point(points, reach + COVER * ROWS)
            counts = numpy.fromiter((len(f) for f in found), dtype=numpy.int64, count=len(found))
            if counts.sum():
                count = len(self.corners[0])
                pairs = numpy.unique(
                    numpy.repeat(numpy.arange(len(points)), counts) * count + owners[numpy.concatenate([numpy.asarray(f, dtype=numpy.int64) for f in found if f])]
                )
                which.append(pairs // count)
                triangle.append(pairs % count)
        if not which:
            return numpy.zeros(0, dtype=numpy.int64), numpy.zeros(0, dtype=numpy.int64)
        return numpy.concatenate(which), numpy.concatenate(triangle)


class Surface:
    """A solid's surface as triangles, with points spread over them no further apart than SPACING."""

    def __init__(self, solid):
        self.corners, self.triangles = _meshed(solid)
        self.low, self.high = self.corners.min(axis=0), self.corners.max(axis=0)
        points = [self.corners]
        a, b, c = (self.corners[self.triangles[:, k]] for k in range(3))
        longest = numpy.maximum.reduce([numpy.linalg.norm(b - a, axis=1), numpy.linalg.norm(c - b, axis=1), numpy.linalg.norm(a - c, axis=1)])
        steps = numpy.ceil(longest / SPACING).astype(int)
        # Each triangle split into steps² alike ones, a point at each of their corners.
        for count in numpy.unique(steps[steps > 1]):
            chosen = numpy.nonzero(steps == count)[0]
            u, v = numpy.array([(i, j) for i in range(count + 1) for j in range(count + 1 - i)], dtype=float).T / count
            for start in range(0, len(chosen), max(1, 200000 // len(u))):
                some = chosen[start : start + max(1, 200000 // len(u))]
                spread = a[some, None, :] + u[None, :, None] * (b[some] - a[some])[:, None, :] + v[None, :, None] * (c[some] - a[some])[:, None, :]
                points.append(spread.reshape(-1, 3))
        self.points = numpy.concatenate(points)
        # Where the mesh lies now, from where it was made: points are taken
        # back there to be looked up in the trees, which a move leaves as they are.
        self._rotation, self._offset = numpy.eye(3), numpy.zeros(3)
        # The trees, made when first needed, by this surface or any move of it.
        self._trees = {}

    def moved(self, rotation, offset):
        """The same surface turned by `rotation`, a 3 x 3 matrix, then moved by `offset`: as the solid moved so."""
        other = copy.copy(self)
        other.corners = self.corners @ rotation.T + offset
        other.points = self.points @ rotation.T + offset
        other.low, other.high = other.corners.min(axis=0), other.corners.max(axis=0)
        other._rotation = rotation @ self._rotation
        other._offset = rotation @ self._offset + offset
        return other

    def _made(self, points):
        """Points taken back to where the mesh was made, by the move that brought it here."""
        return (points - self._offset) @ self._rotation

    def nearest_points(self, points, reach):
        """How far each point lies from its nearest sampled point, infinite beyond `reach`."""
        if "points" not in self._trees:
            self._trees["points"] = cKDTree(self._made(self.points))
        distances, _ = self._trees["points"].query(self._made(points), distance_upper_bound=reach)
        return distances

    def triangles_near(self, points, reach):
        """Each point's index with each triangle that may lie within `reach` of it, as two arrays."""
        if "triangles" not in self._trees:
            self._trees["triangles"] = _Triangles(self._made(self.corners), self.triangles)
        return self._trees["triangles"].near(self._made(points), reach)

    def gaps(self, points, which, triangle):
        """The distance from each point `points[which]` to its triangle, from triangles_near, with the point of the triangle nearest it."""
        a, b, c = (one[triangle] for one in self._trees["triangles"].corners)
        made = self._made(points[which])
        closest = _closest_on_triangles(made, a, b, c)
        return numpy.linalg.norm(closest - made, axis=1), closest @ self._rotation.T + self._offset

    def within(self, low, high, reach):
        """Its points inside a box grown by `reach`."""
        inside = numpy.all((self.points >= low - reach) & (self.points <= high + reach), axis=1)
        return self.points[inside]


def _closest_on_triangles(p, a, b, c):
    """The point of each triangle (a, b, c) nearest each point p, row by row (Ericson's closest point)."""
    ab, ac, ap = b - a, c - a, p - a
    d1, d2 = numpy.einsum("ij,ij->i", ab, ap), numpy.einsum("ij,ij->i", ac, ap)
    bp = p - b
    d3, d4 = numpy.einsum("ij,ij->i", ab, bp), numpy.einsum("ij,ij->i", ac, bp)
    cp = p - c
    d5, d6 = numpy.einsum("ij,ij->i", ab, cp), numpy.einsum("ij,ij->i", ac, cp)
    va, vb, vc = d3 * d6 - d5 * d4, d5 * d2 - d1 * d6, d1 * d4 - d3 * d2
    with numpy.errstate(divide="ignore", invalid="ignore"):
        denominator = va + vb + vc
        v = numpy.where(denominator != 0, vb / denominator, 0.0)
        w = numpy.where(denominator != 0, vc / denominator, 0.0)
        result = a + ab * v[:, None] + ac * w[:, None]
        # On an edge or a corner where the face's inside does not reach.
        on_bc = (va <= 0) & ((d4 - d3) >= 0) & ((d5 - d6) >= 0)
        t = numpy.where(on_bc, (d4 - d3) / ((d4 - d3) + (d5 - d6)), 0.0)
        result = numpy.where(on_bc[:, None], b + (c - b) * t[:, None], result)
        on_ac = (vb <= 0) & (d2 >= 0) & (d6 <= 0)
        t = numpy.where(on_ac, d2 / (d2 - d6), 0.0)
        result = numpy.where(on_ac[:, None], a + ac * t[:, None], result)
        on_ab = (vc <= 0) & (d1 >= 0) & (d3 <= 0)
        t = numpy.where(on_ab, d1 / (d1 - d3), 0.0)
        result = numpy.where(on_ab[:, None], a + ab * t[:, None], result)
    result = numpy.where(((d6 >= 0) & (d5 <= d6))[:, None], c, result)
    result = numpy.where(((d3 >= 0) & (d4 <= d3))[:, None], b, result)
    result = numpy.where(((d1 <= 0) & (d2 <= 0))[:, None], a, result)
    return result


def _batches(count):
    """The batches of `count` points, as (start, end): FIRST_BATCH, then each four times the last, to BATCH."""
    start, size = 0, FIRST_BATCH
    while start < count:
        yield start, min(count, start + size)
        start, size = start + size, min(BATCH, size * 4)


def _reaches(points, surface, reach):
    """Whether any of `points` lies within `reach` of `surface`'s triangles."""
    if not len(points):
        return False
    distances = surface.nearest_points(points, reach + SPACING)
    if (distances <= reach).any():
        return True
    # Points near a sampled point but not that near it: measured to the
    # triangles round it, the nearest first, a batch at a time.
    finite = numpy.isfinite(distances)
    near = points[finite][numpy.argsort(distances[finite])]
    for start, end in _batches(len(near)):
        batch = near[start:end]
        which, triangle = surface.triangles_near(batch, reach)
        if len(which) and (surface.gaps(batch, which, triangle)[0] <= reach).any():
            return True
    return False


def near(a, b, reach):
    """Whether surfaces `a` and `b` are found within `reach` of each other; False when not found, which the exact measure settles."""
    if not (numpy.all(a.low - reach <= b.high) and numpy.all(b.low - reach <= a.high)):
        return False
    return _reaches(a.within(b.low, b.high, reach), b, reach) or _reaches(b.within(a.low, a.high, reach), a, reach)


def _closest_from(points, surface, reach):
    """
    The least distance from `points` to `surface`'s triangles within `reach`,
    with the point it is from and the point of the surface it is to; None
    when none of them is that near. The nearest by sampled points are measured
    first, and the rest only while a sample still lies near enough to beat it.
    """
    if not len(points):
        return None
    distances = surface.nearest_points(points, reach + SPACING)
    finite = numpy.isfinite(distances)
    if not finite.any():
        return None
    points, distances = points[finite], distances[finite]
    order = numpy.argsort(distances)
    points, distances = points[order], distances[order]
    best = None
    for start, end in _batches(len(points)):
        bound = reach if best is None else min(reach, best[0])
        if distances[start] > bound + SPACING:
            break
        batch = points[start:end]
        which, triangle = surface.triangles_near(batch, bound)
        if not len(which):
            continue
        gaps, closest = surface.gaps(batch, which, triangle)
        k = int(gaps.argmin())
        if gaps[k] <= reach and (best is None or gaps[k] < best[0]):
            best = (float(gaps[k]), batch[which[k]], closest[k])
    return best


def nearest(a, b, reach):
    """
    How near surfaces `a` and `b` come on their meshes, within `reach`: the
    distance, the point of `a` and the point of `b`; None when they come no
    nearer than `reach`. Each mesh keeps to MESH_TOLERANCE of its surface.
    """
    if not (numpy.all(a.low - reach <= b.high) and numpy.all(b.low - reach <= a.high)):
        return None
    one = _closest_from(a.within(b.low, b.high, reach), b, reach)
    other = _closest_from(b.within(a.low, a.high, reach), a, reach)
    if other is not None:
        other = (other[0], other[2], other[1])
    found = [f for f in (one, other) if f is not None]
    return min(found, key=lambda f: f[0]) if found else None
