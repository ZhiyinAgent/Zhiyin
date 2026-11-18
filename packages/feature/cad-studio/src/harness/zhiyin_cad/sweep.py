"""
A sweep of a mechanism through its positions: how near each pair of parts
that move with respect to each other comes over every position checked, the
listed ones and the steps between them, so a near miss between two
positions shows as well as a clash at one. Found on the parts' meshes at
each position, and measured exactly at the position where each pair comes
nearest, with the two points it is between.
"""

import time

import numpy

from . import motion, nearness
from .words import mm as _mm
from .words import point

# Pairs further apart than this at every position, in mm, are no near miss.
REACH = 5.0
# At most how many pairs the answer names, the nearest first.
PAIRS = 4
# Below this, in mm, a part has not moved.
STILL = 1e-6


def _moving(at_each):
    """The names of the parts that move, or change shape, from the first position to another."""
    first = motion.corners(at_each[0][1])
    moving = set()
    for _, parts in at_each[1:]:
        for name, points in motion.corners(parts).items():
            before = first.get(name)
            if before is None or before.shape != points.shape or numpy.abs(before - points).max() > STILL:
                moving.add(name)
    return moving


def _exact(a, b):
    """The least distance between two solids, measured exactly, with the two points; None when the kernel finds none."""
    from OCP.BRepExtrema import BRepExtrema_DistShapeShape

    found = BRepExtrema_DistShapeShape()
    found.SetMultiThread(True)
    found.LoadS1(a.wrapped)
    found.LoadS2(b.wrapped)
    found.Perform()
    if not found.IsDone() or found.NbSolution() == 0:
        return None
    p, q = found.PointOnShape1(1), found.PointOnShape2(1)
    return found.Value(), numpy.array([p.X(), p.Y(), p.Z()]), numpy.array([q.X(), q.Y(), q.Z()])


def nearest(at_each, by=None):
    """
    The nearest each pair of parts that move with respect to each other
    comes over the positions `at_each`, each its arguments and its parts:
    the pairs within REACH, the nearest first, each with the gap in mm, the
    point midway between the two nearest points, and the index of the
    position; how many pairs were followed; and how many positions were
    measured before `by`, a time, ran out.
    """
    moving = _moving(at_each)
    names = [name for name, _ in at_each[0][1]]
    pairs = [(a, b) for i, a in enumerate(names) for b in names[i + 1 :] if a in moving or b in moving]
    best = {}
    measured = 0
    for index, (_, parts) in enumerate(at_each):
        if by is not None and time.time() > by:
            break
        found = dict(parts)
        surfaces = {}
        for a, b in pairs:
            if a not in found or b not in found:
                continue
            for name in (a, b):
                if name not in surfaces:
                    surfaces[name] = nearness.Surface(found[name])
            near = nearness.nearest(surfaces[a], surfaces[b], REACH)
            if near is not None and ((a, b) not in best or near[0] < best[(a, b)][0]):
                best[(a, b)] = (near[0], index)
        measured += 1
    listed = []
    for (a, b), (gap, index) in best.items():
        found = dict(at_each[index][1])
        exact = _exact(found[a], found[b])
        if exact is not None:
            gap, p, q = exact
        else:
            p = q = numpy.array(tuple(found[a].center()))
        listed.append({"first": a, "second": b, "gap": float(gap), "at": [float(v) for v in (p + q) / 2], "position": index})
    listed.sort(key=lambda one: one["gap"])
    return {"pairs": listed[:PAIRS], "followed": len(pairs), "measured": measured, "of": len(at_each)}


def _arguments(given):
    return " ".join(given) or "no arguments"


def said(at_each, steps, by=None):
    """
    The sweep in words: how near each pair of moving parts comes, the
    nearest first, where and at which position, a step between two listed
    positions named as that step of the move between them.
    """
    found = nearest(at_each, by)
    listed = (len(at_each) - 1) // steps + 1
    head = f"Swept through {found['of']} positions, each move between the {listed} listed cut into {steps} steps"
    if found["measured"] < found["of"]:
        head += f", the time running out after {found['measured']}"
    if not found["followed"]:
        return f"{head}: no part moves from one position to another."
    pairs = f"{found['followed']} {'pair' if found['followed'] == 1 else 'pairs'} of parts that move with respect to each other"
    if not found["pairs"]:
        return f"{head}: of the {pairs}, none comes within {REACH:g} mm."

    def one_said(one):
        index = one["position"]
        at = f"at {_arguments(at_each[index][0])}"
        start = index // steps * steps
        if index % steps and start + steps < len(at_each):
            at += f", step {index % steps} of {steps} from {_arguments(at_each[start][0])} to {_arguments(at_each[start + steps][0])}"
        where = point(one["at"])
        if one["gap"] <= 1e-6:
            return f"{one['first']} and {one['second']} touch or overlap {at}, at {where}"
        return f"{one['first']} and {one['second']} come {_mm(one['gap'])} mm apart {at}, at {where}"

    return f"{head}: of the {pairs}, those coming nearest: {'; '.join(one_said(one) for one in found['pairs'])}."
