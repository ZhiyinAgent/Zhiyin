"""
The centre line of a bent tube, a pipe's or a hose's: straight runs between
its points, each corner bent round with an arc. A bend of radius r turning
by an angle takes r·tan(angle / 2) of the run on each side of its corner, so
a corner gets the bend asked for when its runs are long enough, and
otherwise the widest they allow; a run between two corners is shared by
both. A tube bent tighter than just over its own radius folds through
itself, which the kernel's check passes, so a path that cannot be bent
wider than that is not made, and what it lacks is said.
"""

import math

import build123d as bd

# Points closer than this, in mm, are one point; a turn smaller than this, in radians, is none.
SAME_POINT = 1e-6
NO_TURN = 1e-6


class Unbendable(Exception):
    """
    A path that cannot be bent wider than the tube's fold limit. `why` says
    so in words; for a corner short of room, `room` is the bend it has room
    for, `run` the run too short for even the tightest bend, and `lacking`
    how many mm that run lacks.
    """

    def __init__(self, why, room=None, run=None, lacking=None):
        super().__init__(why)
        self.why, self.room, self.run, self.lacking = why, room, run, lacking


def fold_limit(diameter):
    """The tightest a tube `diameter` mm across bends without folding through itself: just over its radius."""
    return math.ceil(float(diameter) / 2 * 1.02 * 10) / 10


def where(vector):
    """A point as the answer writes it, to a tenth of a millimetre."""
    return "(" + ", ".join(f"{round(v, 1) + 0:g}" for v in (vector.X, vector.Y, vector.Z)) + ")"


def down(value):
    """A length to a tenth of a millimetre, never more than it is: what there is room for."""
    return f"{math.floor(value * 10 + 1e-4) / 10:g}"


def up(value):
    """A length to a tenth of a millimetre, never less than it is: what is needed."""
    return f"{math.ceil(value * 10 - 1e-4) / 10:g}"


def _cleaned(points):
    """The points without repeats, and without those a straight run passes through."""
    kept = []
    for point in points:
        if not kept or (point - kept[-1]).length > SAME_POINT:
            kept.append(point)
    straight = kept[:1]
    for index in range(1, len(kept) - 1):
        before = (kept[index] - straight[-1]).normalized()
        after = (kept[index + 1] - kept[index]).normalized()
        if before.dot(after) < math.cos(NO_TURN):
            straight.append(kept[index])
    if len(kept) > 1:
        straight.append(kept[-1])
    return straight


def bent(points, bend, limit, keep=(0.0, 0.0)):
    """
    The path through `points` as (wire, [(corner, radius)]), each corner
    bent with `bend` mm, or with None as wide as its runs allow, but never
    wider than its runs allow; `keep` is how much of the first and the last
    run stays straight, as a hose's ends in their ports. Raises Unbendable
    when a corner has no room for a bend of `limit` mm, or turns right back
    on itself, or the path made bends tighter than that anywhere.
    """
    points = _cleaned(points)
    if len(points) < 2:
        raise Unbendable("its points all lie in one place")
    runs = [(points[i + 1] - points[i]).length for i in range(len(points) - 1)]
    corners = range(1, len(points) - 1)
    turn = {}
    for i in corners:
        before = (points[i] - points[i - 1]).normalized()
        after = (points[i + 1] - points[i]).normalized()
        angle = math.acos(max(-1.0, min(1.0, before.dot(after))))
        if angle > math.pi - 1e-3:
            raise Unbendable(f"it turns right back on itself at {where(points[i])}")
        turn[i] = math.tan(angle / 2)
    # The straight each run has for the bends at its ends.
    room = [max(length, 0.0) for length in runs]
    room[0] = max(room[0] - keep[0], 0.0)
    room[-1] = max(room[-1] - keep[1], 0.0)
    radius = {i: float("inf") if bend is None else float(bend) for i in corners}
    if turn:
        radius[1] = min(radius[1], room[0] / turn[1])
        last = len(points) - 2
        radius[last] = min(radius[last], room[-1] / turn[last])
    # A run between two corners is shared: where both want more than it has,
    # each gets an equal radius, or what the other leaves when it takes less.
    for _ in range(len(points)):
        changed = False
        for i in range(1, len(points) - 2):
            j = i + 1
            if radius[i] * turn[i] + radius[j] * turn[j] <= room[i] * (1 + 1e-9):
                continue
            fair = room[i] / (turn[i] + turn[j])
            if radius[i] < fair:
                radius[j] = (room[i] - radius[i] * turn[i]) / turn[j]
            elif radius[j] < fair:
                radius[i] = (room[i] - radius[j] * turn[j]) / turn[i]
            else:
                radius[i] = radius[j] = fair
            changed = True
        if not changed:
            break
    for i in corners:
        if radius[i] < limit:
            raise _short(points, runs, turn, keep, i, radius[i], limit)
    edges, start = [], points[0]
    for i in corners:
        before = (points[i] - points[i - 1]).normalized()
        after = (points[i + 1] - points[i]).normalized()
        cut = radius[i] * turn[i]
        enter, leave = points[i] - before * cut, points[i] + after * cut
        if (enter - start).length > SAME_POINT:
            edges.append(bd.Edge.make_line(start, enter))
        inward = (after - before).normalized()
        centre = points[i] + inward * (radius[i] / math.cos(math.atan(turn[i])))
        edges.append(bd.Edge.make_three_point_arc(enter, centre - inward * radius[i], leave))
        start = leave
    if (points[-1] - start).length > SAME_POINT:
        edges.append(bd.Edge.make_line(start, points[-1]))
    path = bd.Wire(edges)
    # What was made is measured, not trusted: the kernel's own curvature, along the whole path.
    least = tightest(path)
    if least < limit * (1 - 1e-3):
        raise Unbendable(f"its path bends at {down(least)} mm somewhere", room=least)
    return path, [(points[i], radius[i]) for i in corners]


def _short(points, runs, turn, keep, i, got, limit):
    """Why corner `i` cannot be bent: the run beside it shortest for even the tightest bend, and how much it lacks."""
    sides = []
    for k, neighbour in ((i - 1, i - 1), (i, i + 1)):
        need = limit * turn[i] + (limit * turn[neighbour] if neighbour in turn else 0.0)
        need += (keep[0] if k == 0 else 0.0) + (keep[1] if k == len(runs) - 1 else 0.0)
        sides.append((runs[k] - need, k, need))
    spare, k, need = min(sides)
    return Unbendable(
        f"the corner at {where(points[i])} has room for a bend of only {down(got)} mm",
        room=got,
        run=f"the run from {where(points[k])} to {where(points[k + 1])} is {down(runs[k])} mm and needs at least {up(need)} mm",
        lacking=-spare,
    )


def tightest(wire):
    """The tightest bend along the path, from the kernel's curvature of each edge, in mm; infinite for a straight path."""
    from OCP.BRepAdaptor import BRepAdaptor_Curve
    from OCP.BRepLProp import BRepLProp_CLProps

    least = float("inf")
    for edge in wire.edges():
        curve = BRepAdaptor_Curve(edge.wrapped)
        props = BRepLProp_CLProps(curve, 2, 1e-7)
        first, last = curve.FirstParameter(), curve.LastParameter()
        for step in range(41):
            props.SetParameter(first + (last - first) * step / 40)
            if props.IsTangentDefined() and props.Curvature() > 1e-12:
                least = min(least, 1 / props.Curvature())
    return least
