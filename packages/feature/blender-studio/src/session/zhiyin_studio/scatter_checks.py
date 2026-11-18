"""
What a scatter's copies go into: before a copy is kept, whether it would go into an object the
scatter keeps clear; once all are placed, each copy's shape against the objects near it, the
surface, the items and the other copies included, measured on the shapes, never their boxes.
"""

import time

import numpy

from . import budget
from .measure_shapes import Mesh, SceneShapes, Shape, boxes_meet, into
from .wording import length, listed

# How long the copies may be checked for going into others, in seconds; the rest are said unchecked.
SECONDS = 60
# How many of the deepest are named.
MOST_NAMED = 3


class KeptClear:
    """The objects no copy may go into."""

    def __init__(self, objects):
        self.shapes = [Shape(Mesh.of_object(obj), label=obj.name) for obj in objects]

    def blocks(self, item, matrix, point, reach):
        """Whether a copy at `matrix`, within `reach` of `point`, would go into any of them."""
        low, high = numpy.array(point) - reach, numpy.array(point) + reach
        near = [s for s in self.shapes if numpy.all(low <= s.high) and numpy.all(s.low <= high)]
        if not near:
            return False
        copy = Shape(item.mesh, matrix)
        return any(into(copy, shape) is not None for shape in near)


def into_text(copies, left_out, evaluated=None):
    """
    What the copies go into, as an answer says it: `copies` are (label, shape) pairs, and
    `left_out` says which scene objects are the copies themselves. With `evaluated`, the
    count of instances Blender evaluated, the line says it measured those.
    """
    others = SceneShapes(left_out).found
    deadline = time.monotonic() + budget.share(SECONDS)
    lows = numpy.array([shape.low for _, shape in copies]).reshape(-1, 3)
    highs = numpy.array([shape.high for _, shape in copies]).reshape(-1, 3)
    deepest = {}
    groups = {}
    unchecked = 0

    def went(index, what, depth, group):
        if index not in deepest or depth > deepest[index][1]:
            deepest[index] = (what, depth)
        groups.setdefault(group, set()).add(index)

    for i, (_, shape) in enumerate(copies):
        if time.monotonic() > deadline:
            unchecked = len(copies) - i
            break
        for other in others:
            found = into(shape, other) if boxes_meet(shape, other) else None
            if found is not None:
                went(i, other.label, found[0], other.label)
        later = slice(i + 1, None)
        meeting = numpy.nonzero(numpy.all(lows[later] <= shape.high, axis=1) & numpy.all(highs[later] >= shape.low, axis=1))[0]
        for k in (int(m) + i + 1 for m in meeting):
            found = into(shape, copies[k][1])
            if found is not None:
                went(i, copies[k][0], found[0], "other copies")
                went(k, copies[i][0], found[0], "other copies")
    measured = (
        f", measured on the {evaluated:,} instance{'s' if evaluated != 1 else ''} Blender evaluated" if evaluated is not None else ""
    )
    if not deepest:
        text = f"No copy goes into another object{measured}."
    else:
        count = len(deepest)
        shares = [f"{len(held):,} into {what}" for what, held in sorted(groups.items(), key=lambda g: -len(g[1]))]
        ranked = sorted(deepest.items(), key=lambda one: -one[1][1])[:MOST_NAMED]
        named = [
            f"{copies[i][0]} goes {length(depth)} into {what}" if depth else f"{copies[i][0]} goes into {what}"
            for i, (what, depth) in ranked
        ]
        text = (
            f"{count:,} cop{'ies go' if count != 1 else 'y goes'} into another object{measured}: "
            f"{', '.join(shares)}. Deepest: {listed(named)}."
        )
    if unchecked:
        text += f" {unchecked:,} copies were not checked for going into others, for want of time."
    return text
