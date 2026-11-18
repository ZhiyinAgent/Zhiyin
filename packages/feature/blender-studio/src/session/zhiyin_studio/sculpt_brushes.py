"""
What each sculpt brush does to a point under its stroke, weighted by the falloff from the stroke
and freed by the mask: draw raises along the surface's facing under the stroke, clay builds up to
a level above it, crease cuts a groove and draws its sides in, inflate swells along each point's
own normal, grab carries points by a distance, flatten lays them onto the surface's middle plane,
pinch draws them toward the stroke, and smooth moves them toward their neighbours. Every brush
but smooth moves a point by where it stood alone, so a point added under the stroke afterwards
lands where the stroke would have put it.
"""

import numpy

# The brushes that move by a distance in metres, by a fraction of their full effect, or by a vector.
BY_DEPTH = ("draw", "clay", "crease", "inflate")
BY_STRENGTH = ("crease", "smooth", "flatten", "pinch")
BY_VECTOR = ("grab",)
BRUSHES = ("draw", "clay", "crease", "inflate", "grab", "smooth", "flatten", "pinch")
# The falloff each brush takes when none is given.
FALLOFF = {"crease": "sharp"}
# How many times smooth moves the points under it toward their neighbours.
SMOOTH_ROUNDS = 3


class Under:
    """What the brushes need of the points under a stroke: where they stood, how they faced, their weights."""

    def __init__(self, points, normals, weights, reach, frames, copies):
        self.points = points
        self.normals = normals
        self.weights = weights
        self.reach = reach
        self.copies = copies
        middles = numpy.zeros_like(points)
        facings = numpy.zeros_like(points)
        for c, (centres, ups) in enumerate(frames):
            mine = reach.copy == c
            middles[mine] = centres[reach.step[mine]]
            facings[mine] = ups[reach.step[mine]]
        self.middles = middles
        self.facings = facings


def along(vectors, directions):
    """Each vector's part along its direction."""
    return (vectors * directions).sum(axis=1)


def across(vectors, directions):
    """Each vector less its part along its direction."""
    return vectors - along(vectors, directions)[:, None] * directions


def moves(brush, under, depth, strength, by):
    """How far each point under the stroke moves, in the world, for every brush but smooth."""
    w = under.weights[:, None]
    up = under.facings
    if brush == "draw":
        return depth * w * up
    if brush == "inflate":
        return depth * w * under.normals
    if brush == "clay":
        # A level `depth` above the surface's middle: what lies short of it is built up to it.
        short = -along(under.points - (under.middles + depth * up), up)
        short = numpy.where(numpy.sign(short) == numpy.sign(depth), short, 0.0)
        return w * short[:, None] * up
    if brush == "crease":
        inward = across(under.reach.nearest - under.points, up)
        return depth * w * up + strength * w * inward
    if brush == "flatten":
        return -strength * w * along(under.points - under.middles, up)[:, None] * up
    if brush == "pinch":
        return strength * w * across(under.reach.nearest - under.points, up)
    if brush == "grab":
        turned = numpy.array([numpy.array(copy.turn @ by) for copy in under.copies])
        return w * turned[under.reach.copy]
    raise ValueError(brush)


def smoothed(shape, positions, weights, strength):
    """The points moved toward their neighbours' mean, a share `strength` of the way by their weights, each round."""
    found = positions.copy()
    rim = shape.open_points()
    for _ in range(SMOOTH_ROUNDS):
        mean = shape.neighbour_mean(found)
        step = strength * weights[:, None] * (mean - found)
        step[rim] = 0
        found = found + step
    return found
