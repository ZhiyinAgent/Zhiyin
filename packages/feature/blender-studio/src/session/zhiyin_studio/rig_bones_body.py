"""
A body mesh as a ready rig is fitted to it: its points turned into the body's own upright frame (x across
to its left, its front toward -y, z up from its lowest point), and cut by planes into sections, each a
closed outline of the surface, so its widths can be read along its height or along a limb.
"""

import math

import mathutils
import numpy

from .arguments import need
from .geometry import shapes_of
from .mesh_math import point_labels
from .shown_mesh import triangles_of

# Which way the body faces, as the turn about z that brings that way to -y.
FACING = {"-y": 0.0, "+y": math.pi, "+x": -math.pi / 2, "-x": math.pi / 2}


class Island:
    """One closed outline where a plane cuts the surface, or several that overlap, as separate parts do."""

    def __init__(self, points, u, v):
        self.points = points
        self.low, self.high = points.min(axis=0), points.max(axis=0)
        self.centre = (self.low + self.high) / 2
        self.u, self.v = u, v
        spans = [float(numpy.ptp(points @ axis)) for axis in (u, v)]
        self.wide, self.deep = spans
        # How thick it is across, as the side of a square of its box's area.
        self.across = math.sqrt(max(spans[0], 1e-9) * max(spans[1], 1e-9))

    def spans(self, axis, value):
        """Whether its box reaches across `value` along a world axis (0 x, 1 y, 2 z)."""
        return self.low[axis] < value < self.high[axis]


def merged(islands):
    """Islands whose boxes overlap taken as one: the parts of a body made of overlapping pieces."""
    islands = list(islands)
    joined = True
    while joined and len(islands) > 1:
        joined = False
        for i in range(len(islands)):
            for j in range(i + 1, len(islands)):
                a, b = islands[i], islands[j]
                if (a.low <= b.high + 1e-9).all() and (b.low <= a.high + 1e-9).all():
                    islands[i] = Island(numpy.vstack([a.points, b.points]), a.u, a.v)
                    del islands[j]
                    joined = True
                    break
            if joined:
                break
    return islands


class Body:
    """A mesh object's evaluated surface in its own upright frame, with the turn and place back to the world."""

    def __init__(self, obj, facing):
        need(obj.type == "MESH", f"“{obj.name}” is a {obj.type.lower()}; a ready rig is fitted to a mesh.")
        need(facing in FACING, "facing is -y, +y, +x or -x: the way the body's front looks.")
        corners, triangles = triangles_of(shapes_of(obj))
        need(len(triangles) >= 8, f"“{obj.name}” has too few faces to fit a rig to.")
        self.turn = mathutils.Matrix.Rotation(FACING[facing], 3, "Z")
        turned = corners @ numpy.array(self.turn).T
        low, high = turned.min(axis=0), turned.max(axis=0)
        shift = numpy.array([(low[0] + high[0]) / 2, (low[1] + high[1]) / 2, low[2]])
        self.points = turned - shift
        # Where the frame's origin is in the world: the middle of the body's box at its lowest point.
        self.origin = self.turn.inverted() @ mathutils.Vector(shift.tolist())
        self.facing = facing
        self.height = float(self.points[:, 2].max())
        self.length = float(numpy.ptp(self.points[:, 1]))
        self.width = float(numpy.ptp(self.points[:, 0]))
        need(self.height > 1e-4, f"“{obj.name}” is flat: a ready rig needs a body with height.")
        edges = numpy.sort(triangles[:, [0, 1, 1, 2, 2, 0]].reshape(-1, 2), axis=1)
        self.edges, inverse = numpy.unique(edges, axis=0, return_inverse=True)
        self.triangle_edges = inverse.reshape(-1, 3)

    def world(self, point):
        """A point of the body's frame in the world."""
        return self.turn.inverted() @ mathutils.Vector(point) + self.origin

    def matrix(self):
        """The body's frame as an object's place and turn in the world."""
        return mathutils.Matrix.Translation(self.origin) @ self.turn.inverted().to_4x4()

    def cut(self, normal, offset):
        """The islands where the plane of points p with p·normal = offset cuts the surface."""
        normal = numpy.asarray(normal, dtype=float)
        normal = normal / numpy.linalg.norm(normal)
        offset = offset + 1e-7 * max(self.height, 1.0)
        along = self.points @ normal - offset
        a, b = along[self.edges[:, 0]], along[self.edges[:, 1]]
        crossing = (a * b) < 0
        if not crossing.any():
            return []
        index = numpy.full(len(self.edges), -1, dtype=numpy.int64)
        ids = numpy.nonzero(crossing)[0]
        index[ids] = numpy.arange(len(ids))
        share = (a[ids] / (a[ids] - b[ids]))[:, None]
        start, end = self.points[self.edges[ids, 0]], self.points[self.edges[ids, 1]]
        points = start + (end - start) * share
        cut = crossing[self.triangle_edges]
        # A triangle the plane crosses is crossed at two of its edges, which join the outline there.
        rows = cut.sum(axis=1) == 2
        pairs = numpy.sort(numpy.where(cut[rows], index[self.triangle_edges[rows]], -1), axis=1)[:, 1:]
        labels = point_labels(len(ids), pairs)
        u, v = plane_axes(normal)
        return merged(Island(points[labels == label], u, v) for label in numpy.unique(labels))

    def level(self, height):
        """The islands where a level plane at a height cuts the body."""
        return self.cut((0, 0, 1), height)


def plane_axes(normal):
    """Two directions across a plane: for a level one, x and y."""
    normal = numpy.asarray(normal, dtype=float)
    helper = numpy.array([1.0, 0.0, 0.0]) if abs(normal[0]) < 0.9 else numpy.array([0.0, 1.0, 0.0])
    u = numpy.cross(normal, numpy.cross(helper, normal))
    u /= numpy.linalg.norm(u)
    return u, numpy.cross(normal, u)
