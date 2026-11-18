"""
The sheet-metal rules, read by the check a build makes of every sheet part
unasked and by the bend requirement asked to apply shop rules, so the two
never disagree. Each is from the sheet's own thickness t:

- inside radius at least t, as a tighter bend cracks the outside of most sheet;
- a flange at least 4t past its bend, the least a press brake's die holds;
- a hole's edge at least 2.5t + r from where the nearest bend starts, r that
  bend's inside radius, so the hole keeps its shape as the sheet bends;
- a hole's edge at least 2t from the sheet's cut edges;
- a relief wherever a bend ends inside the sheet, which tears there without.

These are rules of thumb of the kind fabricators' design guides publish,
not limits of a standard, and the guides differ: a hole is kept from 1.5t +
r to 3t + r from a bend, and its distance is measured here from where the
bend starts, which counts the radius twice over a guide measuring to the
other flange's inside face, so it errs safe. A shop's own figures for its
tooling come first, given to the requirement as limits in mm.

Beside the rules, the measures both read: the sheet's cut edges and how far
a hole lies from a bend and from those edges.
"""

import math

import build123d as bd

from . import forms
from .words import mm

# The rules, in thicknesses.
RADIUS_RULE = 1.0
FLANGE_RULE = 4.0
HOLE_RULE = 2.5
EDGE_RULE = 2.0


def least_radius(t):
    return RADIUS_RULE * t


def least_flange(t):
    return FLANGE_RULE * t


def least_to_bend(t, radius):
    """How far a hole's edge keeps from a bend of inside `radius` in sheet `t` thick."""
    return HOLE_RULE * t + radius


def least_to_edge(t):
    return EDGE_RULE * t


# Each rule as an answer names it.
RADIUS_WORDS = "the thickness"
FLANGE_WORDS = f"{FLANGE_RULE:g} thicknesses"
EDGE_WORDS = f"{EDGE_RULE:g} thicknesses"


def to_bend_words(radius):
    return f"{HOLE_RULE:g} thicknesses and the bend's {mm(radius)} mm radius"


def narrow(face, thickness):
    """Whether a face is a strip as wide as the sheet is thick, as its cut edges and the walls of its holes are."""
    return face.area / max(sum(e.length for e in face.edges()) / 2, 1e-9) < 1.05 * thickness


def cut_edges(shape, thickness):
    """The sheet's cut edges: flat faces as narrow as the sheet is thick."""
    return [face for face in shape.faces().filter_by(bd.GeomType.PLANE) if narrow(face, thickness)]


def to_bend(hole, bends, t, least=None):
    """
    The bend a hole lies nearest to against its limit, `least` in mm or the
    rule's for each bend: (margin, gap, least, the bend's radius), or
    nothing with no bend.
    """
    nearest = None
    for b in bends:
        gap = min(forms.distance(hole["face"], b["inside"]), forms.distance(hole["face"], b["outside"]))
        limit = least if least is not None else least_to_bend(t, b["radius"])
        if nearest is None or gap - limit < nearest[0]:
            nearest = (gap - limit, gap, limit, b["radius"])
    return nearest


def to_edge(hole, edges):
    """How far a hole lies from the nearest of the sheet's cut `edges`."""
    return min((forms.distance(hole["face"], face) for face in edges), default=math.inf)
