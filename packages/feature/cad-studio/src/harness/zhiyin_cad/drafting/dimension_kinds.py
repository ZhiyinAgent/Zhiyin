"""
The dimension kinds beyond lengths, diameters and radii: an angle between
two edges, a chamfer by its legs, a hole's callout read from the solid, and
ordinates, each a feature's distance from a datum along one direction. Each
is found on the geometry the view draws, as the others are, and its text is
the measure, never a number given; `expect` only checks it. Lengths and
ordinates are placed first round their view, angles beside their corner, and
leaders, a chamfer's and a callout's among them, last.
"""

import math

from . import dimensions, hole_reading
from .dimensions import EXACT, Measured, Unmeasured, number
from .sheet import TEXT

KINDS = ("angle", "chamfer", "hole_callout", "ordinate")
# How far apart, in degrees, two edges' directions are before they meet at an angle at all.
PARALLEL = 0.01
# A square corner, within this many degrees, as a chamfer's legs are read from.
SQUARE = 0.5


def _visible_segments(view):
    """The straight pieces of the view's visible edges, each a pair of points."""
    return [(a, b) for layer, run in view.lines if layer == "visible" for a, b in zip(run, run[1:]) if math.dist(a, b) > 1e-9]


def _foot(p, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    length = dx * dx + dy * dy
    t = max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length))
    return (a[0] + t * dx, a[1] + t * dy), t


def _edge_at(view, point, what):
    """The straight visible edge a point lies on, as its two ends and the point's foot on it; or why there is none."""
    target = view.flat(point)
    segments = _visible_segments(view)
    if not segments:
        raise Unmeasured(f"the {view.name} view shows no straight edge {what}")
    ranked = sorted(segments, key=lambda s: math.dist(_foot(target, *s)[0], target))
    best = ranked[0]
    foot, _ = _foot(target, *best)
    reach = dimensions._reach(view, 0)
    if math.dist(foot, target) > reach:
        raise Unmeasured(
            f"no straight edge of the {view.name} view passes within {number(reach)} mm of "
            f"({', '.join(number(v) for v in point)}), {what}; give a point on the edge"
        )
    if min(math.dist(foot, best[0]), math.dist(foot, best[1])) < EXACT and math.dist(best[0], best[1]) > 2 * EXACT:
        # At an edge's end: unless the next piece of the same line goes on, it is a corner, where two edges meet.
        end = best[0] if math.dist(foot, best[0]) < EXACT else best[1]
        turning = [s for s in segments if (math.dist(s[0], end) < EXACT or math.dist(s[1], end) < EXACT) and _across(s, best) > PARALLEL]
        if turning:
            raise Unmeasured(
                f"({', '.join(number(v) for v in point)}) is a corner of the {view.name} view, {what}; give a point along the edge meant"
            )
    return best, foot


def _direction(segment):
    (ax, ay), (bx, by) = segment
    length = math.hypot(bx - ax, by - ay)
    return ((bx - ax) / length, (by - ay) / length)


def _across(first, second):
    """The angle between two segments' lines, 0 to 90 degrees."""
    u, v = _direction(first), _direction(second)
    return math.degrees(math.asin(min(1.0, abs(u[0] * v[1] - u[1] * v[0]))))


def _meet(a, u, b, v):
    """Where the line through a along u meets the line through b along v."""
    across = u[0] * v[1] - u[1] * v[0]
    t = ((b[0] - a[0]) * v[1] - (b[1] - a[1]) * v[0]) / across
    return (a[0] + t * u[0], a[1] + t * u[1])


def _angle(view, spec, what, suffix):
    first, foot_a = _edge_at(view, spec["from"], f"its first edge {what}")
    second, foot_b = _edge_at(view, spec["to"], f"its second edge {what}")
    if _across(first, second) < PARALLEL:
        raise Unmeasured(
            f"the two edges {what} run side by side in the {view.name} view, so they meet at no angle; "
            "measure how far apart they are as a length"
        )
    vertex = _meet(foot_a, _direction(first), foot_b, _direction(second))
    arms = []
    for foot, segment in ((foot_a, first), (foot_b, second)):
        if math.dist(foot, vertex) < EXACT:
            # A point at the corner: the arm is the edge's far end.
            foot = max(segment, key=lambda p: math.dist(p, vertex))
        length = math.dist(foot, vertex)
        arms.append(((foot[0] - vertex[0]) / length, (foot[1] - vertex[1]) / length))
    (ux, uy), (vx, vy) = arms
    value = math.degrees(math.acos(max(-1.0, min(1.0, ux * vx + uy * vy))))
    found = Measured(spec, "angle", value, f"{number(value)}°{suffix}", vertex=vertex, arms=arms, ends=[first, second])
    return found


def _chamfer(view, spec, what, suffix):
    edge, _ = _edge_at(view, spec["at"], what)
    segments = _visible_segments(view)
    p, q = edge
    if math.dist(p, q) < 1e-6:
        raise Unmeasured(f"the edge {what} has no length")

    def neighbour(end):
        meeting = [s for s in segments if s != edge and (math.dist(s[0], end) < EXACT or math.dist(s[1], end) < EXACT)]
        meeting = [s for s in meeting if _across(s, edge) > PARALLEL]
        if not meeting:
            return None
        s = max(meeting, key=lambda s: math.dist(*s))
        far = s[1] if math.dist(s[0], end) < EXACT else s[0]
        length = math.dist(far, end)
        return ((far[0] - end[0]) / length, (far[1] - end[1]) / length)

    a, b = neighbour(p), neighbour(q)
    if a is None or b is None:
        raise Unmeasured(
            f"the edge {what} in the {view.name} view does not run between two other edges, as a chamfer does; "
            "a chamfer is given where it is seen side on, a slanted edge across a corner"
        )
    if abs(a[0] * b[1] - a[1] * b[0]) < math.sin(math.radians(PARALLEL)):
        raise Unmeasured(
            f"the edge {what} in the {view.name} view runs between two edges side by side, so it cuts no corner, as a chamfer does; "
            "a chamfer is given where it is seen side on, a slanted edge across a corner"
        )
    corner = _meet(p, a, q, b)
    legs = sorted(((math.dist(corner, p), p, a), (math.dist(corner, q), q, b)), key=lambda one: -one[0])
    (long_leg, _, along), (short_leg, _, _) = legs
    corner_angle = math.degrees(math.acos(max(-1.0, min(1.0, -(a[0] * b[0] + a[1] * b[1])))))
    # The chamfer's slope against the edge its longer leg runs along.
    slope = math.degrees(math.atan2(short_leg, long_leg)) if abs(corner_angle - 90) <= SQUARE else _across(edge, (corner, (corner[0] + along[0], corner[1] + along[1])))
    if abs(corner_angle - 90) <= SQUARE and abs(long_leg - short_leg) <= max(0.005, 1e-4 * long_leg):
        text = f"C{number(long_leg)}"
    else:
        text = f"{number(long_leg)}×{number(slope)}°"
    middle = ((p[0] + q[0]) / 2, (p[1] + q[1]) / 2)
    found = Measured(spec, "chamfer", long_leg, f"{text}{suffix}", centre=middle, radius=0.0, at=middle)
    found.said = f"{number(long_leg)} × {number(short_leg)} mm, at {number(slope)}° to its longer leg's edge" + (
        "" if abs(corner_angle - 90) <= SQUARE else f", across a corner of {number(corner_angle)}°"
    )
    return found


def _hole(view, spec, what, suffix, shapes):
    if shapes is None:
        raise Unmeasured(f"{what[4:]} is a hole callout, read from a part's solid, and a drawing of the scene has none")
    if spec.get("at") is None:
        circle = dimensions._circle_of_size(view, float(spec["expect"]), True, what)
    else:
        # A hole's circles share their centre, so a point there means the hole, whichever circle of it is taken.
        target = view.flat(spec["at"])
        centred = [c for c in view.circles if c[3] and math.dist(c[:2], target) <= dimensions._reach(view, 0)]
        circle = (
            min(centred, key=lambda c: (round(math.dist(c[:2], target), 6), c[2]))
            if centred
            else dimensions._nearest_circle(view, spec["at"], True, what)
        )
    cx, cy, r, _ = circle
    look = view.look
    origin = view.centre + view.right * cx + view.up * cy
    try:
        read = hole_reading.read(shapes, origin, look, r)
    except hole_reading.Unread as problem:
        raise Unmeasured(f"{problem} ({what})") from None
    count = 1
    if spec.get("all"):
        centres = []
        for c in dimensions._alike(view, circle):
            if any(math.dist(c[:2], m) < 1e-4 * max(1.0, r) for m in centres):
                continue
            try:
                other = hole_reading.read(shapes, view.centre + view.right * c[0] + view.up * c[1], look, c[2])
            except hole_reading.Unread:
                continue
            if other["text"] == read["text"]:
                centres.append(c[:2])
        count = max(1, len(centres))
    expected = spec.get("expect")
    if expected is not None and not dimensions._matches(read["diameter"], expected):
        raise Unmeasured(
            f"{what[4:]} is a hole drilled Ø{number(read['diameter'])} ({read['text']}) on the part, where Ø{number(float(expected))} "
            "was expected; a callout's expect is its drilled diameter"
        )
    # Its leader meets the hole's widest circle there, its mouth.
    widest = max((c for c in view.circles if math.dist(c[:2], (cx, cy)) < 1e-4 * max(1.0, r)), key=lambda c: c[2], default=circle)
    text = f"{count}× {read['text']}" if count > 1 else read["text"]
    found = Measured(dict(spec, expect=None), "hole_callout", read["diameter"], f"{text}{suffix}", centre=(cx, cy), radius=widest[2], at=view.flat(spec["at"]) if spec.get("at") else (cx + widest[2], cy))
    point = read["point"]
    found.said = f"the hole at ({', '.join(number(v) for v in (point.X, point.Y, point.Z))}): {read['said']}"
    return found


def _ordinate(view, spec, what, suffix):
    datum = dimensions._nearest_point(view, spec["from"], f"its datum {what}")
    point = dimensions._nearest_point(view, spec["to"], f"its feature {what}")
    axis = 0 if spec["direction"] == "horizontal" else 1
    value = point[axis] - datum[axis]
    found = Measured(spec, "ordinate", value, f"{number(value)}{suffix}", datum=datum, point=point, direction=spec["direction"])
    for end, given, snapped in (("datum", spec["from"], datum), ("feature", spec["to"], point)):
        away = math.dist(view.flat(given), snapped)
        if away > dimensions.SNAPPED:
            found.moved.append({"end": end, "at": dimensions._named(view, given, snapped), "away": number(away)})
    return found


def measure(view, spec, index, shapes=None):
    """One dimension of any kind, measured on the view, or why it cannot be; `shapes` are the parts' solids, for a callout."""
    kind = spec["kind"]
    if kind not in KINDS:
        return dimensions.measure(view, spec, index)
    what = f"for dimension {index + 1}"
    suffix = f" {spec['tolerance']}" if spec.get("tolerance") else ""
    if kind == "angle":
        return _angle(view, spec, what, suffix)
    if kind == "chamfer":
        return _chamfer(view, spec, what, suffix)
    if kind == "hole_callout":
        return _hole(view, spec, what, suffix, shapes)
    return _ordinate(view, spec, what, suffix)


def room(found, bounds):
    """How far a view's dimensions reach out from it, ordinates and angles with the rest."""
    across, up = dimensions.room(found, bounds)
    widest = max((dimensions.lettering.width(f.text, TEXT) for f in found if f.kind == "ordinate"), default=0)
    sides = {f.where["direction"] for f in found if f.kind == "ordinate"}
    if "horizontal" in sides:
        across = max(across, dimensions.FIRST_GAP + widest + 4)
    if "vertical" in sides:
        up = max(up, dimensions.FIRST_GAP + widest + 4)
    return across, up


def place_lines(placer, found, scale):
    """A view's lengths, shortest first, then its ordinates, then its angles."""
    lengths = [m for m in found if m.kind == "length"]
    for measured in sorted(lengths, key=lambda m: m.value * scale):
        placer.place_length(measured)
    groups = {}
    for measured in found:
        if measured.kind == "ordinate":
            key = (measured.where["datum"], measured.where["direction"])
            groups.setdefault(key, []).append(measured)
    for (datum, direction), members in groups.items():
        _place_ordinates(placer, datum, direction, members)
    for measured in found:
        if measured.kind == "angle":
            _place_angle(placer, measured)


def place_leaders(placer, found):
    """A view's leaders: diameters, radii, chamfers and callouts."""
    for measured in found:
        if measured.kind not in ("length", "ordinate", "angle"):
            placer.place_leader(measured)


def _place_ordinates(placer, datum, direction, members):
    """
    Ordinates from one datum along one direction, as a row of values on a
    line beside the view, the datum's 0 among them, each joined to its
    feature by an extension line, jogged where values stand too close to
    read apart.
    """
    left, bottom, right, top = placer.box
    horizontal = direction == "horizontal"
    side = "below" if horizontal else "left"
    features = [(None, datum)] + [(m, m.where["point"]) for m in members]
    at = [placer.at(p) for _, p in features]
    texts = ["0"] + [m.text for m in members]
    order = sorted(range(len(features)), key=lambda i: at[i][0] if horizontal else at[i][1])
    # Each value's place along the row, pushed apart to a text's height and a gap.
    pitch = TEXT + 1.5
    spots = {}
    previous = None
    for i in order:
        spot = at[i][0] if horizontal else at[i][1]
        if previous is not None and spot < previous + pitch:
            spot = previous + pitch
        spots[i] = spot
        previous = spot
    shift = (sum(at[i][0 if horizontal else 1] for i in order) - sum(spots.values())) / len(order)
    spots = {i: s + shift for i, s in spots.items()}
    best = None
    for step in range(dimensions.TRIES):
        level = placer.levels[side] + step
        offset = dimensions.FIRST_GAP + level * dimensions.STEP
        lines, boxes, words = [], [], []
        for i in order:
            p, spot = at[i], spots[i]
            if horizontal:
                line_y = bottom - offset
                jog = line_y + 2.5
                lines += [((p[0], p[1] - dimensions.EXTENSION_GAP), (p[0], jog)), ((p[0], jog), (spot, line_y))]
                width = dimensions.lettering.width(texts[i], TEXT)
                start = (spot + TEXT / 2, line_y - 1 - width)
                boxes.append((spot - TEXT / 2, start[1], spot + TEXT / 2, line_y - 1))
                words.append((texts[i], start, 90.0))
            else:
                line_x = left - offset
                jog = line_x + 2.5
                lines += [((p[0] - dimensions.EXTENSION_GAP, p[1]), (jog, p[1])), ((jog, p[1]), (line_x, spot))]
                width = dimensions.lettering.width(texts[i], TEXT)
                start = (line_x - 1 - width, spot - TEXT / 2)
                boxes.append((start[0], start[1], line_x - 1, spot + TEXT / 2))
                words.append((texts[i], start, 0.0))
        met = placer.taken.clashes(boxes, [], own=placer.name) + placer.taken.clashes([], [], own=placer.name, reaching=lines)
        if best is None or met < best[0]:
            best = (met, level, lines, boxes, words)
        if met == 0:
            break
    met, level, lines, boxes, words = best
    for measured in members:
        measured.crowded = met > 0
        measured.outside = placer.taken.leaves(boxes, lines)
    placer.levels[side] = max(placer.levels[side], level + 1)
    for a, b in lines:
        placer.sheet.line("thin", [a, b])
    for text, start, angle in words:
        placer.sheet.text(text, start[0], start[1], TEXT, "left", angle)
    placer.taken.take(boxes, lines)


def _angle_plan(vertex, arms, ends_far, radius, opposite, text):
    """An angle's arc, its extension lines and its text's box at one radius, between the edges or beyond the corner."""
    if opposite:
        arms = [(-x, -y) for x, y in arms]
    (ux, uy), (vx, vy) = arms
    start = math.degrees(math.atan2(uy, ux))
    end = math.degrees(math.atan2(vy, vx))
    sweep = (end - start) % 360
    if sweep > 180:
        start, sweep = end, 360 - sweep
    steps = max(8, math.ceil(sweep / 6))
    turn = lambda i: math.radians(start + sweep * i / steps)
    arc = [(vertex[0] + radius * math.cos(turn(i)), vertex[1] + radius * math.sin(turn(i))) for i in range(steps + 1)]
    middle = math.radians(start + sweep / 2)
    out = (vertex[0] + (radius + 1.5) * math.cos(middle), vertex[1] + (radius + 1.5) * math.sin(middle))
    width = dimensions.lettering.width(text, TEXT)
    # The text stands off the arc's middle on the side away from the corner.
    x = out[0] - width * (1 - math.cos(middle)) / 2
    y = out[1] - TEXT * (1 - math.sin(middle)) / 2
    box = (x, y, x + width, y + TEXT)
    extensions = []
    for (dx, dy), far in zip(arms, ends_far):
        # Beyond the corner each edge's line is carried out to the arc from the corner; between the edges, from past the edge's end.
        begin = dimensions.EXTENSION_GAP if opposite else far + dimensions.EXTENSION_GAP
        if radius > begin:
            extensions.append(
                (
                    (vertex[0] + dx * begin, vertex[1] + dy * begin),
                    (vertex[0] + dx * (radius + dimensions.EXTENSION_PAST), vertex[1] + dy * (radius + dimensions.EXTENSION_PAST)),
                )
            )
    return arc, list(zip(arc, arc[1:])), box, extensions


def _place_angle(placer, measured):
    """
    An angle's arc about its corner, its arrows on its two edges' lines and
    its value at its middle: between the edges near the corner where that is
    clear, else beyond the corner, where the edges' lines are carried out to
    it, as far out as it meets nothing.
    """
    vertex = placer.at(measured.where["vertex"])
    arms = measured.where["arms"]
    ends_far = [max(math.dist(placer.at(p), vertex) for p in segment) for segment in measured.where["ends"]]
    best = None
    for opposite in (False, True):
        for radius in (8.0, 11.0, 14.0, 18.0, 24.0, 30.0, 38.0):
            arc, lines, box, extensions = _angle_plan(vertex, arms, ends_far, radius, opposite, measured.text)
            met = placer.taken.clashes(
                [box], lines, own=placer.name, own_box_too=False, outline=placer.outline, reaching=extensions
            )
            if best is None or met < best[0]:
                best = (met, arc, lines, box, extensions)
            if met == 0:
                break
        if best[0] == 0:
            break
    met, arc, lines, box, extensions = best
    measured.crowded = met > 0
    measured.outside = placer.taken.leaves([box], lines + extensions)
    placer.sheet.line("thin", arc)
    for a, b in extensions:
        placer.sheet.line("thin", [a, b])
    dimensions._arrow(placer.sheet, arc[0], arc[1])
    dimensions._arrow(placer.sheet, arc[-1], arc[-2])
    placer.sheet.text(measured.text, box[0], box[1], TEXT, "left")
    placer.taken.take([box], lines + extensions)
