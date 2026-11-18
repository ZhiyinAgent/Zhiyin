"""
Measuring how far one shape strays from another, as after a remesh, retopology, wrap or sculpt:
points spread evenly over each surface, by area, with every corner, are measured to the other
surface, both ways, so a part one shape lacks counts as much as a part it adds. Said in the
world's lengths: the most, the mean, what 95% of the surface lies within, and where the most is.
"""

import math

import bpy
import numpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

from .errors import Refused
from .mesh_math import spread
from .picking import mesh_object
from .reports import report
from .soundness import mesh_of
from .wording import length, point_text

# How many points are spread over each surface, besides its corners.
SPREAD = 20000
# The most corners of each surface measured; past it they are taken evenly.
CORNERS = 20000


def surface_points(bm, count=SPREAD):
    """Points spread over a surface by area, as evenly as a fixed sequence lays them, and its corners."""
    corners = numpy.array([v.co[:] for v in bm.verts], dtype=numpy.float64).reshape(-1, 3)
    if len(corners) > CORNERS:
        corners = corners[:: math.ceil(len(corners) / CORNERS)]
    triangles = numpy.array(
        [[t[i].vert.co[:] for i in range(3)] for t in bm.calc_loop_triangles()], dtype=numpy.float64
    ).reshape(-1, 3, 3)
    return numpy.concatenate([corners, spread(triangles, count)])


def distances(points, tree):
    """How far each point lies from a surface."""
    found = numpy.empty(len(points))
    for i, point in enumerate(points):
        nearest = tree.find_nearest(Vector(point))
        found[i] = nearest[3] if nearest[0] is not None else math.inf
    return found


class Deviation:
    """How far two surfaces in the world stray from each other, measured both ways."""

    def __init__(self, before, after):
        need_faces = [bm for bm in (before, after) if not bm.faces]
        if need_faces:
            raise Refused("A deviation is measured between surfaces, and one of the shapes has no faces.")
        trees = BVHTree.FromBMesh(before), BVHTree.FromBMesh(after)
        on_before, on_after = surface_points(before), surface_points(after)
        from_before = distances(on_before, trees[1])
        from_after = distances(on_after, trees[0])
        gaps = numpy.concatenate([from_before, from_after])
        worst = int(numpy.argmax(gaps))
        self.most = float(gaps[worst])
        self.mean = float(gaps.mean())
        self.within = float(numpy.percentile(gaps, 95))
        # Where the most is, and on which surface: the earlier shape's or the later one's.
        self.on_first = worst < len(from_before)
        self.at = Vector(on_before[worst] if self.on_first else on_after[worst - len(from_before)])

    def words(self, first, second):
        """The deviation in an answer's words, naming the two shapes."""
        where = first if self.on_first else second
        return (
            f"up to {length(self.most)} (mean {length(self.mean)}, 95% within {length(self.within)}),"
            f" most at {point_text(self.at)} on {where}"
        )


def snapshot(obj):
    """An object's shape as it shows now, in the world, kept to measure a later shape against."""
    bpy.context.view_layer.update()
    return mesh_of(obj)


def deviation_between(a, b):
    """
    How far mesh object `b` strays from mesh object `a`, both as they show: a Deviation with the
    most, mean and 95th percentile in metres, and where the most is. For blender_measure.
    """
    bpy.context.view_layer.update()
    first, second = mesh_of(a), mesh_of(b)
    try:
        return Deviation(first, second)
    finally:
        first.free()
        second.free()


def deviation_text(a, b):
    """One line of how far `b` strays from `a`, as an answer says it."""
    return f"{b.name} strays from {a.name} by {deviation_between(a, b).words(a.name, b.name)}."


def deviation(a, b):
    """
    How far mesh object `b` strays from `a`, as after a remesh, retopology, decimate, wrap or
    sculpt: points spread evenly over each surface and its corners, measured to the other both
    ways. Returns the most, mean and 95th percentile in metres and where the most is; says them.
    """
    first, second = mesh_object(a, "deviation"), mesh_object(b, "deviation")
    if first == second:
        raise Refused("A deviation is measured between two objects; both are the same.")
    found = deviation_between(first, second)
    report(f"Deviation of {second.name} from {first.name}: {found.words(first.name, second.name)}.")
    return {"most": found.most, "mean": found.mean, "within_95": found.within, "at": tuple(found.at)}


FUNCTIONS = (deviation,)
