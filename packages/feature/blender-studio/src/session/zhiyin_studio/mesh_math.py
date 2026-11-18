"""
Geometry worked out on plain arrays and vectors, with nothing of Blender's, so every measure asks
it the same way: which points and triangles join into pieces, whether triangles close a shape, how
far a point is from a segment, and points spread evenly over triangles by area.
"""

import math

import numpy

# Steps of the plastic number's sequence in the unit square, 1/p and 1/p² for p the plastic number:
# each next point falls in the largest gap the ones before it leave.
SPREAD = (0.7548776662466927, 0.5698402909980532)


def point_labels(count, pairs):
    """For each of `count` points, the least index among the points joined to it through `pairs`, each two indices."""
    labels = numpy.arange(count)
    pairs = numpy.asarray(pairs, dtype=numpy.int64).reshape(-1, 2)
    if not len(pairs):
        return labels
    # Each point takes the least label of those it is paired with, and then
    # the label its label has, until no label changes.
    while True:
        least = numpy.minimum(labels[pairs[:, 0]], labels[pairs[:, 1]])
        before = labels.copy()
        numpy.minimum.at(labels, pairs[:, 0], least)
        numpy.minimum.at(labels, pairs[:, 1], least)
        labels = labels[labels]
        if (labels == before).all():
            return labels


def joined_points(count, pairs):
    """The groups of `count` points joined through `pairs`, each as a list of its indices, by their least index."""
    labels = point_labels(count, pairs)
    order = numpy.argsort(labels, kind="stable")
    return [group.tolist() for group in numpy.split(order, numpy.flatnonzero(numpy.diff(labels[order])) + 1) if len(group)]


def pieces(corners, triangles):
    """
    The separate pieces of a mesh's triangles, each joined to the next by a shared corner: for
    each, its own corners and its triangles numbered by them.
    """
    if not len(triangles):
        return []
    labels = point_labels(len(corners), triangles[:, [0, 1, 1, 2]])
    owner = labels[triangles[:, 0]]
    found = []
    for label in numpy.unique(owner):
        own = triangles[owner == label]
        used = numpy.unique(own)
        place = numpy.full(len(corners), -1, dtype=numpy.int64)
        place[used] = numpy.arange(len(used))
        found.append((corners[used], place[own]))
    return found


def closed(triangles):
    """Whether triangles close a shape: every edge is shared by exactly two of them."""
    edges = numpy.sort(triangles[:, [0, 1, 1, 2, 2, 0]].reshape(-1, 2), axis=1)
    _, counts = numpy.unique(edges, axis=0, return_counts=True)
    return bool(len(counts)) and bool((counts == 2).all())


def to_segment(point, a, b):
    """
    How far a point is from the nearest point of the segment from a to b; from a, when they are
    one point. The three are vectors of one kind: Blender's or arrays.
    """
    way = b - a
    span = way.dot(way)
    # Under a nanometre long, a segment is its first point.
    share = 0.0 if span < 1e-18 else min(max((point - a).dot(way) / span, 0.0), 1.0)
    off = point - (a + way * share)
    return math.sqrt(off.dot(off))


def evenly(items, most):
    """At most about `most` of some items, taken at an even step through them, the first always."""
    return items[:: max(1, len(items) // most)]


def spread_over(triangles, count):
    """
    Where `count` points spread evenly by area over triangles fall, the triangles given as an array
    of their three corners: for each, the triangle it is on and its shares u and v of the way along
    the triangle's second and third sides. The same each time: the plastic number's sequence lays
    them, so no two fall together. None when the triangles have no area.
    """
    if not len(triangles):
        return None
    a, b, c = triangles[:, 0], triangles[:, 1], triangles[:, 2]
    areas = numpy.linalg.norm(numpy.cross(b - a, c - a), axis=1)
    total = float(areas.sum())
    if total <= 0:
        return None
    picks = numpy.minimum(
        numpy.searchsorted(numpy.cumsum(areas), (numpy.arange(count) + 0.5) / count * total), len(triangles) - 1
    )
    steps = numpy.arange(count)
    u, v = (steps * SPREAD[0]) % 1, (steps * SPREAD[1]) % 1
    over = u + v > 1
    u[over], v[over] = 1 - u[over], 1 - v[over]
    return picks, u, v


def spread(triangles, count):
    """`count` points spread evenly by area over triangles, given as an array of their three corners, as spread_over lays them."""
    found = spread_over(triangles, count)
    if found is None:
        return numpy.zeros((0, 3))
    picks, u, v = found
    a, b, c = triangles[:, 0], triangles[:, 1], triangles[:, 2]
    return a[picks] + (b - a)[picks] * u[:, None] + (c - a)[picks] * v[:, None]
