"""
Dimensions as a drawing states them: each is asked for by points of the
part, found on the geometry the view shows (a corner, an end, a circle's
centre, a circle), and measured there. Its text is that measure, never a
number given, so a drawing cannot state a size its part does not have; a
number given is only checked against it.
"""

import math

from . import lettering
from .sheet import TEXT

ARROW = 3.0
ARROW_HALF = 0.5
FIRST_GAP = 8.0
STEP = 7.0
EXTENSION_GAP = 1.0
EXTENSION_PAST = 2.0


class Unmeasured(Exception):
    """A dimension that cannot be found on the part, said so the model can mend it."""


def number(value):
    """A measure as a drawing writes it: to two decimals at most, halves away from zero."""
    rounded = math.copysign(math.floor(abs(value) * 100 + 0.5) / 100, value)
    text = f"{rounded:.2f}".rstrip("0").rstrip(".")
    return "0" if text in ("-0", "") else text


def _reach(view, scale_free_size):
    """How near a point must be to the geometry to mean it: a millimetre, or a hundredth of the view."""
    left, bottom, right, top = view.bounds()
    return max(1.0, 0.01 * max(right - left, top - bottom, scale_free_size))


# How near a point given must be to what it snaps to for no other to be meant: a hundredth of a millimetre.
EXACT = 0.01
# How far an end may be found from the point given before the answer says where: a tenth of a millimetre.
SNAPPED = 0.1


def _named(view, point, flat):
    """A point of a view as the part's own coordinates, `point` moved in the view's plane to `flat`."""
    target = view.flat(point)
    moved = [
        p + right * (flat[0] - target[0]) + up * (flat[1] - target[1])
        for p, right, up in zip(point, (view.right.X, view.right.Y, view.right.Z), (view.up.X, view.up.Y, view.up.Z))
    ]
    return f"({', '.join(number(v) for v in moved)})"


def _nearest_point(view, point, what):
    """
    The corner, end or circle centre a point means: the one it is at, or the
    nearest within reach when no other is nearly as near. Between two, as a
    corner chamfered or rounded away leaves, it means neither, and is
    refused, since either would measure a length the part does not have.
    """
    target = view.flat(point)
    candidates = list(view.points) + [(cx, cy) for cx, cy, _, _ in view.circles]
    if not candidates:
        raise Unmeasured(f"the {view.name} view shows nothing to measure {what} from")
    ranked = sorted(candidates, key=lambda p: math.dist(p, target))
    best = ranked[0]
    near = math.dist(best, target)
    reach = _reach(view, 0)
    if near > reach:
        nearest = [ranked[0]] + [p for p in ranked[1:] if math.dist(p, ranked[0]) > EXACT][:1]
        raise Unmeasured(
            f"no corner, end or circle centre of the {view.name} view lies within {number(reach)} mm of "
            f"({', '.join(number(v) for v in point)}), {what}; the nearest are "
            + " and ".join(f"{_named(view, point, p)}, {number(math.dist(p, target))} mm away" for p in nearest)
        )
    if near > EXACT:
        rival = next((p for p in ranked[1:] if math.dist(p, best) > EXACT), None)
        if rival is not None and math.dist(rival, target) < 2 * near:
            raise Unmeasured(
                f"({', '.join(number(v) for v in point)}) is no corner or end of the {view.name} view, {what}, "
                f"and lies between {_named(view, point, best)} and {_named(view, point, rival)}; give the one meant"
            )
    return best


# How near two round edges' centres and radii must be to be one circle's: arcs of one come out a hair apart.
SAME_CIRCLE = 1e-4


def _turned(view, cx, cy, r):
    """How far round its circle, in degrees, the arcs a view draws on one circle reach together."""
    pieces = []
    for _, ax, ay, ar, start, end in view.arcs:
        if not _same_circle(ax, ay, ar, cx, cy, r):
            continue
        if end - start >= 360 - 1e-9:
            return 360.0
        start, length = start % 360, (end - start) % 360
        pieces += [(start, 360.0), (0.0, start + length - 360)] if start + length > 360 else [(start, start + length)]
    total, reach = 0.0, 0.0
    for start, end in sorted(pieces):
        if end > reach:
            total += end - max(start, reach)
            reach = end
    return total


def _same_circle(cx, cy, r, ox, oy, other_r):
    tolerance = SAME_CIRCLE * max(1.0, r)
    return math.dist((cx, cy), (ox, oy)) < tolerance and abs(r - other_r) < tolerance


def _shown(view, circle):
    """Whether a circle or arc of a view is drawn as a visible edge, not only a hidden one."""
    cx, cy, r, _ = circle
    return any(layer == "visible" and _same_circle(ax, ay, ar, cx, cy, r) for layer, ax, ay, ar, _, _ in view.arcs)


def _alike(view, circle):
    """
    Round edges of a view like one: the circles of its size, and, where the
    view knows which are holes, those that are holes when it is one, or pins
    and shafts when it is not.
    """
    cx, cy, r, _ = circle
    hole = next((h for rx, ry, rr, h in view.rounds if _same_circle(rx, ry, rr, cx, cy, r)), None)
    alike = []
    for c in view.circles:
        if not c[3] or abs(c[2] - r) >= SAME_CIRCLE * max(1.0, r):
            continue
        if hole is not None:
            kind = next((h for rx, ry, rr, h in view.rounds if _same_circle(rx, ry, rr, *c[:3])), None)
            if kind is not None and kind != hole:
                continue
        alike.append(c)
    return alike


def _nearest_circle(view, point, full, what):
    """
    The circle, or arc, a point is on or at the centre of. Several of
    different sizes about one centre are told apart by which the view shows
    as visible; still several, the point names none of them, and is refused.
    """
    target = view.flat(point)
    circles = [c for c in view.circles if c[3] == full]
    if full:
        # An arc round more than half its circle is measured across it too, as a diameter.
        circles += [c for c in view.circles if not c[3] and _turned(view, *c[:3]) > 180 + 1e-6]
    # The pieces a cut leaves of one circle are that circle once, the whole one kept where it is drawn.
    merged = []
    for circle in circles:
        if not any(_same_circle(*circle[:3], *other[:3]) for other in merged):
            merged.append(circle)
    circles = merged
    kind = "circle" if full else "arc"

    def distance(circle):
        cx, cy, r, _ = circle
        to_centre = math.dist((cx, cy), target)
        return min(to_centre, abs(to_centre - r))

    reach = _reach(view, 0)
    if full:
        # An arc there round half its circle or less is given by its radius: said so.
        short = [c for c in view.circles if not c[3] and c not in circles and distance(c) <= reach]
        nearer = min(circles, key=distance, default=None)
        if short and (nearer is None or distance(nearer) > reach):
            arc = min(short, key=distance)
            raise Unmeasured(
                f"the {view.name} view shows no circle there {what}, only an arc of R{number(arc[2])} round "
                f"{number(_turned(view, *arc[:3]))}°, half its circle or less, which is given by its radius: "
                "make it a radius, or measure an arc round more than half its circle"
            )
    if not circles:
        raise Unmeasured(f"the {view.name} view shows no {kind} {what}")
    best = min(circles, key=distance)
    if distance(best) > reach:
        raise Unmeasured(
            f"no {kind} of the {view.name} view passes within {number(reach)} mm of "
            f"({', '.join(number(v) for v in point)}), or has its centre there, {what}"
        )
    tied = [c for c in circles if distance(c) <= distance(best) + 1e-6]
    sizes = lambda among: sorted({round(c[2], 6) for c in among})
    if len(sizes(tied)) > 1:
        shown = [c for c in tied if _shown(view, c)]
        if len(sizes(shown)) == 1:
            return shown[0]
        named = ", ".join(f"{'Ø' if full else 'R'}{number(2 * r if full else r)}" for r in sizes(shown or tied))
        among = shown or tied
        # A point on each, across from the centre to the right as the view is seen.
        on = [
            f"{_named(view, point, (c[0] + c[2], c[1]))} for {'Ø' if full else 'R'}{number(2 * c[2] if full else c[2])}"
            for c in sorted({round(c[2], 6): c for c in among}.values(), key=lambda c: c[2])
        ]
        raise Unmeasured(
            f"({', '.join(number(v) for v in point)}) is the centre of {kind}s {named} in the {view.name} view, "
            f"{what}; give a point on the one meant: {', '.join(on)}"
        )
    return best


def _across_round(view, a, b, direction, value):
    """
    Whether a length measures across something round: a round face seen from
    its side, whose axis runs square to the length midway between its ends,
    or a circle of that size centred there.
    """
    if direction == "horizontal":
        ux, uy = 1.0, 0.0
    elif direction == "vertical":
        ux, uy = 0.0, 1.0
    else:
        length = math.dist(a, b)
        ux, uy = (b[0] - a[0]) / length, (b[1] - a[1]) / length
    middle = ((a[0] + b[0]) / 2) * ux + ((a[1] + b[1]) / 2) * uy
    tolerance = max(0.01, 1e-4 * value)
    along = lambda p: p[0] * ux + p[1] * uy
    for start, end in view.axes:
        span = math.dist(start, end)
        if span < 1e-9:
            continue
        square = abs((end[0] - start[0]) * ux + (end[1] - start[1]) * uy) / span < 1e-3
        if square and abs(along(start) - middle) < tolerance:
            return True
    return any(
        abs(along((cx, cy)) - middle) < tolerance and abs(2 * r - value) < tolerance for cx, cy, r, _ in view.circles
    )


class Measured:
    """A dimension found and measured, in the view's own millimetres, ready to be placed."""

    crowded = False
    # Its extension lines run just beside other edges of its view, where they can read as theirs.
    beside = False
    # Its lettering or lines reach past the frame, the sheet having no room for it inside.
    outside = False

    def __init__(self, spec, kind, value, text, **where):
        self.spec = spec
        self.kind = kind
        self.value = value
        self.text = text
        self.where = where
        # Each end found away from the point given: which, where, and how far.
        self.moved = []


def measure(view, spec, index):
    """One dimension, measured on the view, or why it cannot be."""
    what = f"for dimension {index + 1}"
    kind = spec["kind"]
    suffix = f" {spec['tolerance']}" if spec.get("tolerance") else ""
    if kind == "length":
        a = _nearest_point(view, spec["from"], f"its start {what}")
        b = _nearest_point(view, spec["to"], f"its end {what}")
        dx, dy = b[0] - a[0], b[1] - a[1]
        direction = spec.get("direction") or ("horizontal" if abs(dx) >= abs(dy) else "vertical")
        value = abs(dx) if direction == "horizontal" else abs(dy) if direction == "vertical" else math.hypot(dx, dy)
        if value < 1e-6:
            raise Unmeasured(f"the two ends {what} are at the same place {direction}ly in the {view.name} view")
        if spec.get("diameter") and not _across_round(view, a, b, direction, value):
            raise Unmeasured(
                f"dimension {index + 1} is written as a diameter, but no round face's axis or circle lies midway "
                f"between its ends in the {view.name} view; measure across a round face, or leave diameter out"
            )
        prefix = "Ø" if spec.get("diameter") else ""
        found = Measured(spec, "length", value, f"{prefix}{number(value)}{suffix}", a=a, b=b, direction=direction)
        # An end found away from the point given, said, so a dimension never
        # measures from somewhere other than meant without a word.
        for end, given, snapped in (("start", spec["from"], a), ("end", spec["to"], b)):
            away = math.dist(view.flat(given), snapped)
            if away > SNAPPED:
                found.moved.append({"end": end, "at": _named(view, given, snapped), "away": number(away)})
        return found
    if kind == "overall":
        direction = spec["direction"]
        a, b = _extremes(view, 0 if direction == "horizontal" else 1, what)
        value = abs(b[0] - a[0]) if direction == "horizontal" else abs(b[1] - a[1])
        return Measured(spec, "length", value, f"{number(value)}{suffix}", a=a, b=b, direction=direction)
    if kind in ("diameter", "radius"):
        if spec.get("at") is None:
            cx, cy, r, _ = _circle_of_size(view, float(spec["expect"]), kind == "diameter", what)
            # Its leader set out from the circle's right, or a radius's from its centre.
            at = (cx + r, cy) if kind == "diameter" else (cx, cy)
        else:
            cx, cy, r, _ = _nearest_circle(view, spec["at"], kind == "diameter", what)
            at = view.flat(spec["at"])
        if kind == "diameter":
            count = 1
            if spec.get("all"):
                # A hole shows a circle at each end: holes are counted by their
                # centres, and a pin of its size is no hole.
                centres = []
                for c in _alike(view, (cx, cy, r, True)):
                    if not any(math.dist(c[:2], m) < SAME_CIRCLE * max(1.0, r) for m in centres):
                        centres.append(c[:2])
                count = len(centres)
            text = f"{count}× Ø{number(2 * r)}{suffix}" if count > 1 else f"Ø{number(2 * r)}{suffix}"
            return Measured(spec, kind, 2 * r, text, centre=(cx, cy), radius=r, at=at)
        # The arc's own span, which its leader's arrow lands on.
        spans = [(start, end) for _, ax, ay, ar, start, end in view.arcs if _same_circle(ax, ay, ar, cx, cy, r)]
        return Measured(spec, kind, r, f"R{number(r)}{suffix}", centre=(cx, cy), radius=r, at=at, spans=spans)
    raise Unmeasured(f"dimension {index + 1} is a {kind}, which is length, overall, diameter or radius")


def _extremes(view, axis, what):
    """
    The two points of a view furthest apart along an axis of it, 0 across and
    1 up: every point of its lines and curves, and of its arcs their ends and
    their furthest points where they reach, never a centre, which may lie far
    from the part. A view's whole width or height is measured between them,
    with no point to give.
    """
    points = [point for _, run in view.lines for point in run]
    for _, cx, cy, r, start, end in view.arcs:
        for angle in (start, end, 0, 90, 180, 270):
            if end - start >= 360 - 1e-9 or (angle - start) % 360 <= (end - start) % 360 + 1e-9:
                radians = math.radians(angle)
                points.append((cx + r * math.cos(radians), cy + r * math.sin(radians)))
    if len(points) < 2:
        raise Unmeasured(f"the {view.name} view shows nothing to measure {what}")
    low = min(points, key=lambda p: (p[axis], p[1 - axis]))
    high = max(points, key=lambda p: (p[axis], -p[1 - axis]))
    if high[axis] - low[axis] < 1e-6:
        raise Unmeasured(f"the {view.name} view has no {'width' if axis == 0 else 'height'} {what}")
    return low, high


def _circle_of_size(view, expected, full, what):
    """
    The circle, or arc, of a view whose size is the one expected, read to the
    decimals it is written with: one drawn visible before one only hidden,
    then the highest and leftmost. None of that size is refused with the
    sizes the view has.
    """
    circles = [c for c in view.circles if c[3] == full]
    if full:
        circles += [c for c in view.circles if not c[3] and _turned(view, *c[:3]) > 180 + 1e-6]
    sized = lambda c: 2 * c[2] if full else c[2]
    mark = "Ø" if full else "R"
    matching = [c for c in circles if _matches(sized(c), expected)]
    if not matching:
        have = sorted({float(number(sized(c))) for c in circles})
        shown = ", ".join(f"{mark}{number(s)}" for s in have)
        raise Unmeasured(
            f"the {view.name} view shows no {'circle' if full else 'arc'} of {mark}{number(expected)} {what}"
            + (f"; it shows {shown}" if shown else f"; it shows no {'circle' if full else 'arc'}")
        )
    return min(matching, key=lambda c: (not _shown(view, c), -c[1], c[0]))


def _matches(value, expected):
    """Whether a measure is the number given, read to the decimals it is written with: 80 holds 80.04, 80.1 does not."""
    shown = float(number(value))
    written = repr(float(expected)).partition(".")[2].rstrip("0")
    if "e" in written:
        written = ""
    half_unit = max(0.5 * 10 ** -len(written), 0.0005)
    return abs(shown - float(expected)) <= half_unit + 1e-9


def checked(found):
    """
    A dimension whose measure differs from the number given for it, said, or
    nothing. The number is read to the decimals it is written with, as a
    drawing's is: 80 holds 80.04, and 80.1 does not.
    """
    expected = found.spec.get("expect")
    if expected is None or _matches(found.value, expected):
        return None
    return f"is {found.text} on the part, where {number(float(expected))} was expected"


def _arrow(sheet, tip, towards):
    """A filled arrowhead with its tip at `tip`, pointing from `towards` to the tip."""
    dx, dy = tip[0] - towards[0], tip[1] - towards[1]
    length = math.hypot(dx, dy) or 1.0
    ux, uy = dx / length, dy / length
    base = (tip[0] - ux * ARROW, tip[1] - uy * ARROW)
    sheet.fill(
        "thin",
        [tip, (base[0] - uy * ARROW_HALF, base[1] + ux * ARROW_HALF), (base[0] + uy * ARROW_HALF, base[1] - ux * ARROW_HALF)],
    )


def _box_of(points, margin=0.0):
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return (min(xs) - margin, min(ys) - margin, max(xs) + margin, max(ys) + margin)


def _text_box(start, angle, text):
    """The box a line of text takes, written from `start` along `angle` degrees."""
    c, s = math.cos(math.radians(angle)), math.sin(math.radians(angle))
    width = lettering.width(text, TEXT)
    along = (start[0] + c * width, start[1] + s * width)
    return _box_of([start, along, (along[0] - s * TEXT, along[1] + c * TEXT), (start[0] - s * TEXT, start[1] + c * TEXT)])


def _overlaps(a, b, margin=1.0):
    return a[0] < b[2] + margin and b[0] < a[2] + margin and a[1] < b[3] + margin and b[1] < a[3] + margin


def _crosses(a, b, c, d):
    """Whether segment ab crosses segment cd, not merely touching at an end."""

    def side(p, q, r):
        return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])

    d1, d2, d3, d4 = side(c, d, a), side(c, d, b), side(a, b, c), side(a, b, d)
    return ((d1 > 1e-9 and d2 < -1e-9) or (d1 < -1e-9 and d2 > 1e-9)) and (
        (d3 > 1e-9 and d4 < -1e-9) or (d3 < -1e-9 and d4 > 1e-9)
    )


def _places_met(a, b, segments):
    """
    How many places segment ab meets the segments, their ends included, so
    passing through a corner meets it once; ab's own start is left out.
    """
    dx, dy = b[0] - a[0], b[1] - a[1]
    places = []
    for c, d in segments:
        ex, ey = d[0] - c[0], d[1] - c[1]
        across = dx * ey - dy * ex
        if abs(across) < 1e-12:
            continue
        t = ((c[0] - a[0]) * ey - (c[1] - a[1]) * ex) / across
        u = ((c[0] - a[0]) * dy - (c[1] - a[1]) * dx) / across
        if -1e-9 <= t <= 1 + 1e-9 and -1e-9 <= u <= 1 + 1e-9:
            place = (a[0] + t * dx, a[1] + t * dy)
            if math.dist(place, a) > 0.01 and all(math.dist(place, p) > 0.01 for p in places):
                places.append(place)
    return len(places)


def _distance_to_segment(p, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    length = dx * dx + dy * dy
    t = 0.0 if length < 1e-18 else max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length))
    return math.dist(p, (a[0] + t * dx, a[1] + t * dy))


def _beside(a, b, c, d):
    """
    How far segment ab runs along segment cd, parallel and just beside it,
    in mm: an extension line there reads as that edge's. A line on the edge
    itself, continuing it, runs beside nothing, and so does a short stretch.
    """
    length = math.dist(a, b)
    if length < 1e-9 or math.dist(c, d) < 1e-9:
        return 0.0
    ux, uy = (b[0] - a[0]) / length, (b[1] - a[1]) / length
    ex, ey = d[0] - c[0], d[1] - c[1]
    if abs(ux * ey - uy * ex) > math.sin(math.radians(2)) * math.hypot(ex, ey):
        return 0.0
    away = [abs((p[0] - a[0]) * uy - (p[1] - a[1]) * ux) for p in (c, d)]
    if not all(ON_EDGE < one <= BESIDE for one in away):
        return 0.0
    along = sorted((p[0] - a[0]) * ux + (p[1] - a[1]) * uy for p in (c, d))
    run = min(along[1], length) - max(along[0], 0.0)
    return run if run > BESIDE_FOR else 0.0


def _through(a, b, box):
    """Whether segment ab passes through a box."""
    left, bottom, right, top = box
    t0, t1 = 0.0, 1.0
    dx, dy = b[0] - a[0], b[1] - a[1]
    for p, q in ((-dx, a[0] - left), (dx, right - a[0]), (-dy, a[1] - bottom), (dy, top - a[1])):
        if abs(p) < 1e-12:
            if q < 0:
                return False
            continue
        t = q / p
        if p < 0:
            t0 = max(t0, t)
        else:
            t1 = min(t1, t)
        if t0 > t1:
            return False
    return True


# How much worse than a line crossing a line it is to spoil lettering, or leave the area, and to cross a view.
SPOILS_TEXT = 10
CROSSES_VIEW = 3
# How near another view a dimension's line may run, in mm on the sheet: nearer, it reads as that view's.
VIEW_CLEARANCE = 2.0
# An extension line this near beside its own view's edge, in mm on the sheet, for this long, reads as
# that edge's; nearer than the least, it lies on the edge and continues it. Each stretch of this length
# beside an edge weighs as a crossed view.
BESIDE = 1.5
BESIDE_FOR = 2.0
ON_EDGE = 0.25
BESIDE_STRETCH = 5.0


def _grown(box, by):
    return (box[0] - by, box[1] - by, box[2] + by, box[3] + by)


class Taken:
    """
    What the sheet already holds, which each dimension placed after keeps
    clear of: the views, the text written, the lines drawn for dimensions,
    leaders and cutting planes, and the area inside the frame above the title
    block, which nothing leaves.
    """

    def __init__(self, area=None):
        self.views = []  # (box, view name)
        self.texts = []
        self.lines = []  # (a, b)
        self.area = area

    def clashes(self, texts, lines, own=None, own_box_too=True, outline=None, reaching=()):
        """
        How badly new text boxes and lines meet what is taken: lettering
        overlapped or crossed, a view covered or the area left weigh most, a
        part's edge crossed less, and a line crossing a line least, as a
        drawing too full for clear room had best keep its numbers readable.
        `outline`, their own view's edges, stands for its box where the marks
        may lie over the box but not the part, as an aligned dimension's do;
        `reaching` are lines that start on the part, as extension lines do,
        which may not cross lettering or another view. A line within a
        couple of millimetres of another view meets it, as it would read as
        that view's. Nothing met is 0.
        """
        count = 0
        for box in texts:
            count += SPOILS_TEXT * sum(_overlaps(box, t) for t in self.texts)
            count += SPOILS_TEXT * sum(_through(a, b, box) for a, b in self.lines)
            count += SPOILS_TEXT * sum(
                _overlaps(box, v, 0.5)
                for v, name in self.views
                if name != own or (own_box_too and outline is None)
            )
            if outline is not None:
                count += SPOILS_TEXT * sum(_through(a, b, box) for a, b in outline)
            count += SPOILS_TEXT * self._outside(box)
        for a, b in lines:
            count += SPOILS_TEXT * sum(_through(a, b, t) for t in self.texts)
            count += sum(_crosses(a, b, c, d) for c, d in self.lines)
            count += CROSSES_VIEW * sum(
                _through(a, b, _grown(v, VIEW_CLEARANCE)) for v, name in self.views if name != own
            )
            if outline is not None:
                count += CROSSES_VIEW * sum(_crosses(a, b, c, d) for c, d in outline)
            count += SPOILS_TEXT * self._outside(_box_of([a, b]))
        for a, b in reaching:
            count += SPOILS_TEXT * sum(_through(a, b, t) for t in self.texts)
            count += CROSSES_VIEW * sum(
                _through(a, b, _grown(v, VIEW_CLEARANCE)) for v, name in self.views if name != own
            )
        return count

    def clear(self, texts, lines, **where):
        """Whether new text boxes and lines meet nothing taken."""
        return self.clashes(texts, lines, **where) == 0

    def leaves(self, texts, lines):
        """Whether any of the text boxes or lines reaches past the area inside the frame."""
        return any(self._outside(box) for box in texts) or any(self._outside(_box_of([a, b])) for a, b in lines)

    def _outside(self, box):
        if self.area is None:
            return 0
        left, bottom, right, top = self.area
        return int(box[0] < left or box[1] < bottom or box[2] > right or box[3] > top)

    def take(self, texts, lines):
        self.texts += texts
        self.lines += lines


def _dimension_plan(fa, fb, text, outside_at_start=False, text_at=0.5):
    """
    A dimension line between two feet, as it would be drawn: its lines, its
    arrows, and its text over it, inside at `text_at` of the room there, or,
    when short, outside at one end.
    """
    span = math.dist(fa, fb)
    angle = math.degrees(math.atan2(fb[1] - fa[1], fb[0] - fa[0]))
    # Text reads from below or from the right, as ISO 129 has it.
    if angle > 90 or angle <= -90:
        fa, fb = fb, fa
        angle = math.degrees(math.atan2(fb[1] - fa[1], fb[0] - fa[0]))
    ux, uy = (fb[0] - fa[0]) / span, (fb[1] - fa[1]) / span
    nx, ny = -uy, ux
    width = lettering.width(text, TEXT)
    if span >= width + 2 * ARROW + 2:
        along = ARROW + 1 + (span - width - 2 * ARROW - 2) * text_at
        start = (fa[0] + ux * along + nx * 1.0, fa[1] + uy * along + ny * 1.0)
        lines = [(fa, fb)]
        arrows = [(fa, fb), (fb, fa)]
    elif not outside_at_start:
        out_a = (fa[0] - ux * (ARROW + 3), fa[1] - uy * (ARROW + 3))
        out_b = (fb[0] + ux * (ARROW + 3 + width + 1), fb[1] + uy * (ARROW + 3 + width + 1))
        lines = [(out_a, out_b)]
        arrows = [(fa, out_a), (fb, (fb[0] + ux * ARROW * 2, fb[1] + uy * ARROW * 2))]
        start = (fb[0] + ux * (ARROW + 2) + nx * 1.0, fb[1] + uy * (ARROW + 2) + ny * 1.0)
    else:
        out_a = (fa[0] - ux * (ARROW + 3 + width + 1), fa[1] - uy * (ARROW + 3 + width + 1))
        out_b = (fb[0] + ux * (ARROW + 3), fb[1] + uy * (ARROW + 3))
        lines = [(out_a, out_b)]
        arrows = [(fa, (fa[0] - ux * ARROW * 2, fa[1] - uy * ARROW * 2)), (fb, out_b)]
        start = (fa[0] - ux * (ARROW + 2 + width) + nx * 1.0, fa[1] - uy * (ARROW + 2 + width) + ny * 1.0)
    return {"lines": lines, "arrows": arrows, "text": (start, angle), "box": _text_box(start, angle, text)}


def _draw_plan(sheet, plan, text):
    for a, b in plan["lines"]:
        sheet.line("thin", [a, b])
    for tip, towards in plan["arrows"]:
        _arrow(sheet, tip, towards)
    start, angle = plan["text"]
    sheet.text(text, start[0], start[1], TEXT, "left", angle)


def _leader_shape(centre, radius, angle, text, reach):
    """Where a leader at `angle` out to `reach` goes: its points, its text's start and anchor, and the text's box."""
    c = math.cos(math.radians(angle))
    s = math.sin(math.radians(angle))
    on = (centre[0] + radius * c, centre[1] + radius * s)
    length = max(radius + 8, reach)
    out = (centre[0] + length * c, centre[1] + length * s)
    width = lettering.width(text, TEXT)
    right = c >= 0
    shoulder = (out[0] + (width + 2 if right else -(width + 2)), out[1])
    box = (min(out[0], shoulder[0]), out[1], max(out[0], shoulder[0]), out[1] + TEXT + 1.5)
    return on, out, shoulder, (out[0] + (1 if right else -1), out[1] + 1), "left" if right else "right", box


def _leader(sheet, shape, text):
    """A leader from its circle out to its text, its arrow on the circle pointing in along the leader."""
    on, out, shoulder, start, anchor, _ = shape
    sheet.line("thin", [on, out, shoulder])
    _arrow(sheet, on, out)
    sheet.text(text, start[0], start[1], TEXT, anchor)


# How many levels out a dimension is tried before it is drawn where it clashes least.
TRIES = 6
# Where along its line a dimension's text is tried: the middle, then towards either end.
TEXT_PLACES = (0.5, 0.2, 0.8)


def _within(angle, start, end, margin=4.0):
    """Whether an angle lies on an arc from `start` to `end` degrees, anticlockwise, a margin in from its ends."""
    sweep = (end - start) % 360 or 360
    return margin <= (angle - start) % 360 <= sweep - margin


def _side_of(found, bounds):
    """The side of its view a length goes on first: the one nearest what it measures."""
    left, bottom, right, top = bounds
    a, b = found.where["a"], found.where["b"]
    direction = found.where["direction"]
    if direction == "horizontal":
        return "below" if (a[1] + b[1]) / 2 <= (bottom + top) / 2 else "above"
    if direction == "vertical":
        return "right" if (a[0] + b[0]) / 2 >= (left + right) / 2 else "left"
    return "aligned"


OTHER_SIDE = {"below": "above", "above": "below", "left": "right", "right": "left"}


class Placer:
    """
    Places a view's dimensions round it, each further out than the last on
    its side, and each where it meets nothing the sheet already holds; one
    that finds no such place is drawn where it meets least, and marked
    crowded.
    """

    def __init__(self, sheet, origin, scale, bounds, taken, name, circles=(), outline=()):
        self.sheet = sheet
        self.origin = origin
        self.scale = scale
        self.taken = taken
        self.name = name
        self.bounds = bounds
        # The view's round edges on the sheet, which a leader passes beside, not over.
        self.circles = [(origin[0] + cx * scale, origin[1] + cy * scale, r * scale) for cx, cy, r, _ in circles]
        # Its edges on the sheet, which marks lying over its box keep off.
        self.outline = list(outline)
        left, bottom, right, top = bounds
        self.box = (origin[0] + left * scale, origin[1] + bottom * scale, origin[0] + right * scale, origin[1] + top * scale)
        self.levels = {"below": 0, "above": 0, "left": 0, "right": 0, "aligned": 0}
        self.leaders = 0

    def at(self, point):
        return (self.origin[0] + point[0] * self.scale, self.origin[1] + point[1] * self.scale)

    def _linear_plan(self, a, b, along, offset, side, outside_at_start, text, text_at):
        left, bottom, right, top = self.box
        if along == "x":
            line = bottom - offset if side == "below" else top + offset
            fa, fb = (a[0], line), (b[0], line)
            extensions = []
            for p, f in ((a, fa), (b, fb)):
                sign = 1 if f[1] > p[1] else -1
                extensions.append(((p[0], p[1] + sign * EXTENSION_GAP), (f[0], f[1] + sign * EXTENSION_PAST)))
        elif along == "y":
            line = right + offset if side == "right" else left - offset
            fa, fb = (line, a[1]), (line, b[1])
            extensions = []
            for p, f in ((a, fa), (b, fb)):
                sign = 1 if f[0] > p[0] else -1
                extensions.append(((p[0] + sign * EXTENSION_GAP, p[1]), (f[0] + sign * EXTENSION_PAST, f[1])))
        else:
            ux, uy = b[0] - a[0], b[1] - a[1]
            length = math.hypot(ux, uy)
            nx, ny = -uy / length, ux / length
            middle = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
            centre = ((left + right) / 2, (bottom + top) / 2)
            if (middle[0] - centre[0]) * nx + (middle[1] - centre[1]) * ny < 0:
                nx, ny = -nx, -ny
            fa = (a[0] + nx * offset, a[1] + ny * offset)
            fb = (b[0] + nx * offset, b[1] + ny * offset)
            extensions = [
                ((p[0] + nx * EXTENSION_GAP, p[1] + ny * EXTENSION_GAP), (f[0] + nx * EXTENSION_PAST, f[1] + ny * EXTENSION_PAST))
                for p, f in ((a, fa), (b, fb))
            ]
        plan = _dimension_plan(fa, fb, text, outside_at_start, text_at)
        plan["extensions"] = extensions
        return plan

    def place_length(self, found):
        a, b = self.at(found.where["a"]), self.at(found.where["b"])
        direction = found.where["direction"]
        first = _side_of(found, self.bounds)
        along = {"horizontal": "x", "vertical": "y"}.get(direction, "aligned")
        sides = [first] if first == "aligned" else [first, OTHER_SIDE[first]]
        # Its own side, further out each time, and the other side a level behind.
        tries = sorted(
            ((side, step) for side in sides for step in range(TRIES)),
            key=lambda one: one[1] + (0 if one[0] == first else 1),
        )
        best = None
        for side, step in tries:
            level = self.levels[side] + step
            offset = FIRST_GAP + level * STEP
            for text_at in TEXT_PLACES:
                for outside_at_start in (False, True):
                    plan = self._linear_plan(a, b, along, offset, side, outside_at_start, found.text, text_at)
                    met = self.taken.clashes(
                        [plan["box"]],
                        plan["lines"],
                        own=self.name,
                        outline=self.outline if along == "aligned" else None,
                        reaching=plan["extensions"],
                    )
                    beside = sum(_beside(p, q, c, d) for p, q in plan["extensions"] for c, d in self.outline)
                    count = met + CROSSES_VIEW * math.ceil(beside / BESIDE_STRETCH)
                    if best is None or count < best[0]:
                        best = (count, plan, side, level, met, beside)
                    if count == 0:
                        break
                if best[0] == 0:
                    break
            if best[0] == 0:
                break
        count, chosen, side, level, met, beside = best
        found.crowded = met > 0
        found.beside = beside > 0
        found.outside = self.taken.leaves([chosen["box"]], chosen["lines"] + chosen["extensions"])
        self.levels[side] = max(self.levels[side], level + 1)
        for p, q in chosen["extensions"]:
            self.sheet.line("thin", [p, q])
        _draw_plan(self.sheet, chosen, found.text)
        self.taken.take([chosen["box"]], chosen["lines"] + chosen["extensions"])

    def place_leader(self, found):
        left, bottom, right, top = self.box
        centre = self.at(found.where["centre"])
        radius = found.where["radius"] * self.scale
        spans = found.where.get("spans") or []
        if found.kind == "radius":
            at = self.at(found.where["at"])
            if math.dist(at, centre) > radius / 2 or not spans:
                angle = math.degrees(math.atan2(at[1] - centre[1], at[0] - centre[0]))
            else:
                # Given at its centre: out through the middle of its arc.
                start, end = spans[0]
                angle = start + ((end - start) % 360 or 360) / 2
            turns = (0, 15, -15, 30, -30, 45, -45, 60, -60)
        else:
            # Out the way the circle lies from the view's middle, along a diagonal.
            middle = ((left + right) / 2, (bottom + top) / 2)
            dx, dy = centre[0] - middle[0], centre[1] - middle[1]
            angle = {(True, True): 45, (False, True): 135, (False, False): 225, (True, False): 315}[(dx >= 0, dy >= 0)]
            turns = (0, 30, -30, 90, -90, 150, -150, 180)
        # The ways out: the way asked, the turns beside it, further out each
        # time. A radius's arrow lands on its own arc.
        ways = []
        for extra in (0, 8, 16, 24, 32, 40):
            for turn in turns:
                way = angle + turn
                if spans and found.kind == "radius" and not any(_within(way, s, e) for s, e in spans):
                    continue
                shape = _leader_shape(centre, radius, way, found.text, self._out_of_box(centre, way) + extra)
                on, out, _, _, _, box = shape
                if _overlaps(box, self.box, 0.5):
                    continue
                ways.append((shape, _places_met(on, out, self.outline)))
        # A way out crosses as many of its own view's lines as it must, as
        # many as the way that crosses fewest; each more runs over its view.
        fewest = min((crossed for _, crossed in ways), default=0)
        # The first whose text and lines meet nothing on the sheet.
        best = None
        for shape, crossed in ways:
            on, out, shoulder, _, _, box = shape
            count = self.taken.clashes([box], [(on, out), (out, shoulder)], own=self.name, own_box_too=False)
            count += CROSSES_VIEW * (crossed - fewest)
            # Its own circle, and one it lies inside, it cannot help crossing.
            count += sum(
                CROSSES_VIEW
                for cx, cy, r in self.circles
                if not _same_circle(cx, cy, r, centre[0], centre[1], radius)
                and math.dist((cx, cy), centre) + radius > r + SAME_CIRCLE * max(1.0, r)
                and _distance_to_segment((cx, cy), on, out) < r + 1.0
            )
            if best is None or count < best[0]:
                best = (count, shape)
            if count == 0:
                break
        if best is None:
            best = (1, _leader_shape(centre, radius, angle, found.text, self._out_of_box(centre, angle) + 48))
        count, chosen = best
        found.crowded = count > 0
        on, out, shoulder, _, _, box = chosen
        found.outside = self.taken.leaves([box], [(on, out), (out, shoulder)])
        self.taken.take([box], [(on, out), (out, shoulder)])
        self.leaders += 1
        _leader(self.sheet, chosen, found.text)

    def _out_of_box(self, start, angle):
        """How far from `start` along `angle` the view's box ends, and a little more for each leader before."""
        left, bottom, right, top = self.box
        c, s = math.cos(math.radians(angle)), math.sin(math.radians(angle))
        ends = []
        if abs(c) > 1e-9:
            ends.append(((right if c > 0 else left) - start[0]) / c)
        if abs(s) > 1e-9:
            ends.append(((top if s > 0 else bottom) - start[1]) / s)
        return max(0.0, min(ends)) + 4 + self.leaders * 3


def room(dimensions, bounds):
    """
    How far a view's dimensions reach out from it, in mm on the sheet: up and
    down, and to each side, by the most on either, with a level spare.
    """
    sides = {"below": 0, "above": 0, "left": 0, "right": 0, "aligned": 0}
    for found in dimensions:
        if found.kind == "length":
            sides[_side_of(found, bounds)] += 1
    out = lambda n: FIRST_GAP + n * STEP + TEXT + 2 if n else 0
    leaders = [found for found in dimensions if found.kind != "length"]
    # A leader ends past the view by a few millimetres more for each before it,
    # with its text beside the end.
    beyond = 4 + 3 * len(leaders)
    tall = beyond + TEXT + 2 if leaders else 0
    widest = max((lettering.width(f.text, TEXT) for f in dimensions), default=0)
    wide = beyond + widest + 4 if leaders else 0
    # A short dimension's text goes past one of its ends.
    short = widest + ARROW + 6 if sides["below"] or sides["above"] else 0
    aligned = out(sides["aligned"])
    return (
        max(out(max(sides["below"], sides["above"])), tall, aligned),
        max(out(max(sides["left"], sides["right"])), wide, short, aligned),
    )
