"""
The bend requirement: a part bent from sheet, its bends found on its exact
faces as two rounds on one axis a sheet's thickness apart, checked against
limits in millimetres or against the sheet-metal rules, each from the
sheet's own thickness, which the unasked check of a sheet part reads too.
"""

import math

import build123d as bd

from . import forms
from . import sheet_rules as rules_of
from .unchecked import Unchecked
from .words import mm as _mm
from .words import point as _at

# How far past a bend's end, as a share of the thickness and at most in mm, the sheet is looked for.
RELIEF_PROBE_SHARE = 0.25
RELIEF_PROBE_MOST = 0.1


def bend_ends(shape, bend):
    """
    The four corners of a bend where it meets its flats at its two ends,
    each with whether sheet goes on past the end there, beside the bend, at
    the middle of its thickness: where it does, the bend has no relief.
    """
    face = bend["inside"]
    axis = bend["axis"].normalized()
    _, foot, _ = forms.cylinder(face)
    corners = [face.position_at(a, b) for a in (0.0, 1.0) for b in (0.0, 1.0)]
    middle = sum((c for c in corners), bd.Vector()) * 0.25
    step = min(RELIEF_PROBE_SHARE * bend["thickness"], RELIEF_PROBE_MOST)
    found = []
    for corner in corners:
        along = (corner - foot).dot(axis)
        radial = (corner - foot) - axis * along
        if radial.length < 1e-9:
            continue
        mid = foot + axis * along + radial.normalized() * (bend["radius"] + bend["thickness"] / 2)
        out = axis if (corner - middle).dot(axis) > 0 else -axis
        probe = mid + out * step
        found.append((corner, shape.is_inside(probe)))
    return found


def _clause(text, margin, rules):
    if not rules or margin is None:
        return text
    return f"{text}: {_mm(margin)} mm to spare" if margin >= -1e-9 else f"{text}: {_mm(-margin)} mm short"


def _part(name, shape, asked):
    rules = bool(asked.get("rules"))
    bends = forms.bends(shape)
    if not bends:
        raise Unchecked(f"{name} has no bend: a bend here is a pair of cylindrical faces on one axis, a sheet's thickness apart")
    t = max(b["thickness"] for b in bends)
    said = [f"{name} is sheet {_mm(t)} mm thick with {len(bends)} {'bend' if len(bends) == 1 else 'bends'}"]
    margins = []

    def limit(field, rule, words):
        if asked.get(field) is not None:
            return asked[field], ""
        if rules:
            return rule, f" ({words})"
        return None, ""

    least, why = limit("radius", rules_of.least_radius(t), rules_of.RADIUS_WORDS)
    if least is not None:
        tightest = min(bends, key=lambda b: b["radius"])
        margin = tightest["radius"] - least
        margins.append(margin)
        said.append(
            _clause(
                f"the tightest inside radius is {_mm(tightest['radius'])} mm, at {_at(tightest['inside'].position_at(0.5, 0.5))}, where at least {_mm(least)} mm{why} is asked",
                margin,
                rules,
            )
        )
    least, why = limit("flange", rules_of.least_flange(t), rules_of.FLANGE_WORDS)
    if least is not None:
        flanges = forms.flanges(shape, bends)
        if flanges:
            shortest, place = min(flanges, key=lambda one: one[0])
            margin = shortest - least
            margins.append(margin)
            said.append(_clause(f"the shortest flange runs {_mm(shortest)} mm past its bend, at {_at(place)}, where at least {_mm(least)} mm{why} is asked", margin, rules))
        else:
            said.append("no flat runs from a bend")
    holes = None
    if asked.get("hole") is not None or rules:
        holes = forms.hole_walls(shape)
        if holes:
            nearest = None
            for hole in holes:
                found = rules_of.to_bend(hole, bends, t, asked.get("hole"))
                if nearest is None or found[0] < nearest[0]:
                    nearest = (*found, hole["at"])
            margin, gap, least, r, place = nearest
            why = "" if asked.get("hole") is not None else f" ({rules_of.to_bend_words(r)})"
            margins.append(margin)
            said.append(_clause(f"the nearest hole is {_mm(gap)} mm from a bend, at {_at(place)}, where at least {_mm(least)} mm{why} is asked", margin, rules))
        else:
            said.append("it has no round hole")
    least, why = limit("edge", rules_of.least_to_edge(t), rules_of.EDGE_WORDS)
    if least is not None:
        holes = forms.hole_walls(shape) if holes is None else holes
        cut = rules_of.cut_edges(shape, t)
        if holes and cut:
            gap, place = min(((rules_of.to_edge(hole, cut), hole["at"]) for hole in holes), key=lambda one: one[0])
            margin = gap - least
            margins.append(margin)
            said.append(_clause(f"the nearest hole is {_mm(gap)} mm from an edge, at {_at(place)}, where at least {_mm(least)} mm{why} is asked", margin, rules))
        elif not holes and asked.get("hole") is None and not rules:
            said.append("it has no round hole")
    torn = []
    if asked.get("reliefs") or rules:
        ends = [corner for b in bends for corner, goes_on in bend_ends(shape, b) if goes_on]
        # A bend's two faces meet the same sheet at each end: one place each.
        for corner in ends:
            if not any((corner - other).length < 3 * t for other in torn):
                torn.append(corner)
        if torn:
            places = ", ".join(_at(p) for p in torn[:4]) + (f" and {len(torn) - 4} more" if len(torn) > 4 else "")
            said.append(f"{len(torn)} {'bend end lies' if len(torn) == 1 else 'bend ends lie'} inside the sheet with no relief, at {places}, where the sheet tears as it bends")
        else:
            said.append("every bend ends at the sheet's edge or a relief")
    holds = not torn
    margin = min(margins) if margins and holds else None
    rank = margin if margin is not None else (-math.inf if not holds else math.inf)
    return rank, {"margin": margin, "unit": "mm" if margin is not None else "", "holds": holds and (margin is None or margin >= -1e-9), "measured": "; ".join(said)}


def bend(parts, asked):
    """
    Each part's bends checked against the limits asked: radius, flange,
    hole and edge in mm, reliefs present, or, with rules, every one of them
    from the sheet's thickness. The part furthest past a limit answers.
    """
    worst = None
    for name, shape in parts:
        rank, result = _part(name, shape, asked)
        if worst is None or rank < worst[0]:
            worst = (rank, result)
    return worst[1]
