"""
The marks a drawing puts on its views and beside them: hatching across cut faces, centre lines,
the cutting line a section is taken along, the circle and letter a detail is taken from, and the
arrow and letter that say which way an auxiliary view looks. Each mark keeps clear of what the
sheet already holds, and records the room it takes.
"""

import math

from . import dimensions, layout, sheet, views

HATCH_ANGLES = (45, 135, 60, 120, 30, 150)
# Millimetres between hatch lines on the sheet, and the closest a thin section's are.
HATCH_SPACING = 2.5
HATCH_CLOSEST = 0.7


def drawn_segments(slot):
    """A view's drawn edges, centre lines and gears' pitch circles and lines on the sheet, as segments."""
    at = lambda p: (slot.origin[0] + p[0] * slot.scale, slot.origin[1] + p[1] * slot.scale)
    view = slot.view
    segments = []
    for _, points in view.lines:
        segments += [(at(a), at(b)) for a, b in zip(points, points[1:])]
    pitch = [(None, cx, cy, r, start, end) for cx, cy, r, start, end in getattr(view, "pitch", [])]
    for _, cx, cy, r, start, end in [*view.arcs, *pitch]:
        sweep = (end - start) % 360 or 360
        steps = max(4, math.ceil(sweep / 10))
        points = [
            at((cx + r * math.cos(math.radians(start + sweep * i / steps)), cy + r * math.sin(math.radians(start + sweep * i / steps))))
            for i in range(steps + 1)
        ]
        segments += list(zip(points, points[1:]))
    segments += [(at(a), at(b)) for a, b in [*view.axes, *getattr(view, "pitch_lines", [])]]
    return segments


CENTRE_PAST = layout.CENTRE_PAST


def centre_lines(view, origin, scale):
    """
    A view's centre lines on the sheet: a cross on every round edge seen face
    on, the largest of those that share a centre, a slot's half-round ends
    included, and a line along every round face seen side on and every
    gear's pitch surface seen across its axis, each a little past what it
    marks.
    """
    at = lambda p: (origin[0] + p[0] * scale, origin[1] + p[1] * scale)
    lines = []
    marked = []
    rounds = [(cx, cy, r) for cx, cy, r, full in view.circles if full]
    rounds += [(cx, cy, r) for _, cx, cy, r, start, end in view.arcs if ((end - start) % 360 or 360) >= 179.9]
    for cx, cy, r in sorted(rounds, key=lambda c: -c[2]):
        if any(math.dist((cx, cy), m) < 1e-4 * max(1.0, r) for m in marked):
            continue
        marked.append((cx, cy))
        x, y = at((cx, cy))
        reach = r * scale + CENTRE_PAST
        lines += [((x - reach, y), (x + reach, y)), ((x, y - reach), (x, y + reach))]
    # A gear's pitch line, seen across its axis, runs past its sides as a centre line does.
    for a, b in [*view.axes, *getattr(view, "pitch_lines", [])]:
        pa, pb = at(a), at(b)
        length = math.dist(pa, pb)
        ux, uy = (pb[0] - pa[0]) / length, (pb[1] - pa[1]) / length
        lines.append(((pa[0] - ux * CENTRE_PAST, pa[1] - uy * CENTRE_PAST), (pb[0] + ux * CENTRE_PAST, pb[1] + uy * CENTRE_PAST)))
    # Lines that nearly meet on one line, as a slot's two ends or a row of holes have, run on as one.
    return views.merged_segments(lines, gap=2 * CENTRE_PAST)


def _inside(point, polygon):
    """Whether a point lies inside a polygon, by the even-odd rule."""
    x, y = point
    inside = False
    for (ax, ay), (bx, by) in zip(polygon, polygon[1:] + polygon[:1]):
        if (ay > y) != (by > y) and x < ax + (y - ay) * (bx - ax) / (by - ay):
            inside = not inside
    return inside


def _thickness(polygons):
    """
    How thick the cut faces are on the sheet, about: twice their area over
    their outline's length, which is a strip's width. A polygon inside an
    odd number of the others is a hole in them.
    """
    area = perimeter = 0.0
    for polygon in polygons:
        shoelace = sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(polygon, polygon[1:] + polygon[:1]))
        holes = sum(_inside(polygon[0], other) for other in polygons if other is not polygon)
        area += abs(shoelace) / 2 * (-1 if holes % 2 else 1)
        perimeter += sum(math.dist(a, b) for a, b in zip(polygon, polygon[1:] + polygon[:1]))
    return 2 * area / perimeter if perimeter > 0 else 0.0


def hatch(target, polygons, angle):
    """
    Thin parallel lines across the cut faces, inside them by the even-odd
    rule. A thin wall or a fin is hatched closer, as drawings may hatch a
    small section, so it still reads as cut.
    """
    spacing = min(HATCH_SPACING, max(HATCH_CLOSEST, _thickness(polygons) / 1.5))
    c, s = math.cos(math.radians(angle)), math.sin(math.radians(angle))
    # Along (c, s), stepping across by the normal (-s, c).
    across = [-p[0] * s + p[1] * c for polygon in polygons for p in polygon]
    if not across:
        return
    level = math.floor(min(across) / spacing) * spacing
    while level <= max(across):
        cuts = []
        for polygon in polygons:
            for a, b in zip(polygon, polygon[1:] + polygon[:1]):
                da, db = -a[0] * s + a[1] * c - level, -b[0] * s + b[1] * c - level
                if (da > 0) != (db > 0):
                    t = da / (da - db)
                    cuts.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
        cuts.sort(key=lambda p: p[0] * c + p[1] * s)
        for start, end in zip(cuts[0::2], cuts[1::2]):
            target.line("hatch", [start, end])
        level += spacing


def direction_mark(target, view, slots, taken):
    """
    The arrow and letter on a straight view that say which way an auxiliary
    view looks: just outside a view it is seen across, pointing the way it
    looks, where it meets nothing else, and always on the sheet.
    """
    seen = []
    for slot in slots:
        if slot.view.kind != "named" or slot.view.name == "iso":
            continue
        look2 = (view.look.dot(slot.view.right), view.look.dot(slot.view.up))
        across = math.hypot(*look2)
        if across >= 0.3:
            seen.append((across, slot, (look2[0] / across, look2[1] / across)))
    seen.sort(key=lambda one: -one[0])
    area = target.drawing_area()
    width = sheet.lettering.width(view.name, sheet.TEXT)
    candidates = []
    for _, slot, (ux, uy) in seen:
        left, bottom, right, top = slot.view.bounds()
        box = (slot.origin[0] + left * slot.scale, slot.origin[1] + bottom * slot.scale,
               slot.origin[0] + right * slot.scale, slot.origin[1] + top * slot.scale)
        # Aimed at the faces the view looks at squarely, else at the view's middle; then beside it.
        facing = getattr(view, "facing", None)
        middle = (
            (slot.origin[0] + slot.view.flat(facing)[0] * slot.scale, slot.origin[1] + slot.view.flat(facing)[1] * slot.scale)
            if facing is not None
            else ((box[0] + box[2]) / 2, (box[1] + box[3]) / 2)
        )
        for shift in (0.0, 0.25, -0.25, 0.4, -0.4):
            start = (middle[0] - uy * shift * (box[2] - box[0]), middle[1] + ux * shift * (box[3] - box[1]))
            # Where a ray from inside, going against the look, leaves the view's box.
            reach = min(
                ((box[0] if ux > 0 else box[2]) - start[0]) / -ux if abs(ux) > 1e-9 else math.inf,
                ((box[1] if uy > 0 else box[3]) - start[1]) / -uy if abs(uy) > 1e-9 else math.inf,
            )
            tip = (start[0] - ux * (reach + 3), start[1] - uy * (reach + 3))
            tail = (tip[0] - ux * 12, tip[1] - uy * 12)
            letter = (tail[0] - ux * 4, tail[1] - uy * 4 - sheet.TEXT / 2)
            candidates.append((slot.view.name, tip, tail, letter))
    if not candidates:
        return

    def boxed(candidate):
        _, tip, tail, letter = candidate
        return (letter[0] - width / 2, letter[1], letter[0] + width / 2, letter[1] + sheet.TEXT)

    def on_sheet(candidate):
        _, tip, tail, _ = candidate
        text_box = boxed(candidate)
        return all(area[0] <= x <= area[2] and area[1] <= y <= area[3] for x, y in (tip, tail, text_box[:2], text_box[2:]))

    chosen = next(
        (c for c in candidates if on_sheet(c) and taken.clear([boxed(c)], [(c[2], c[1])], own=c[0])),
        next((c for c in candidates if on_sheet(c)), None),
    )
    if chosen is None:
        # Nowhere outside a view is on the sheet: the first, moved onto it.
        name, tip, tail, letter = candidates[0]
        text_box = boxed(candidates[0])
        xs = [tip[0], tail[0], text_box[0], text_box[2]]
        ys = [tip[1], tail[1], text_box[1], text_box[3]]
        dx = max(0.0, area[0] - min(xs)) - max(0.0, max(xs) - area[2])
        dy = max(0.0, area[1] - min(ys)) - max(0.0, max(ys) - area[3])
        move = lambda p: (p[0] + dx, p[1] + dy)
        chosen = (name, move(tip), move(tail), move(letter))
    _, tip, tail, letter = chosen
    target.line("thin", [tail, tip])
    dimensions._arrow(target, tip, tail)
    target.text(view.name, letter[0], letter[1], sheet.TEXT, "centre")
    taken.texts.append(boxed(chosen))
    taken.lines.append((tail, tip))


# The length of a cutting line's thick ends, in mm on the sheet.
CUTTING_END = 6.0


def cutting_line(target, parent, slot, section_view, through, taken):
    """Where a section's plane cuts another view, with arrows the way it looks and its letter."""
    normal = section_view.look
    direction = normal.cross(parent.look)
    if direction.length < 1e-9:
        return False
    d2 = (direction.dot(parent.right), direction.dot(parent.up))
    length = math.hypot(*d2)
    d2 = (d2[0] / length, d2[1] / length)
    left, bottom, right, top = parent.bounds()
    mx, my = parent.flat(through)
    # Far enough each way to cross the whole view, however far off its middle the plane passes.
    reach = max(math.dist((mx, my), corner) for corner in ((left, bottom), (left, top), (right, bottom), (right, top))) + 1
    at = lambda p: (slot.origin[0] + p[0] * slot.scale, slot.origin[1] + p[1] * slot.scale)
    a = at((mx - d2[0] * reach, my - d2[1] * reach))
    b = at((mx + d2[0] * reach, my + d2[1] * reach))
    # Across the view's box and out past it, so its thick ends and arrows lie
    # wholly outside the view, clear of its outline.
    span = math.dist(a, b)
    ux, uy = (b[0] - a[0]) / span, (b[1] - a[1]) / span
    past = CUTTING_END + 2
    box = (slot.origin[0] + left * slot.scale - past, slot.origin[1] + bottom * slot.scale - past,
           slot.origin[0] + right * slot.scale + past, slot.origin[1] + top * slot.scale + past)
    t0, t1 = 0.0, span
    for direction, start, low, high in ((ux, a[0], box[0], box[2]), (uy, a[1], box[1], box[3])):
        if abs(direction) < 1e-12:
            if not low <= start <= high:
                return False
            continue
        enter, leave = sorted(((low - start) / direction, (high - start) / direction))
        t0, t1 = max(t0, enter), min(t1, leave)
    if t1 - t0 < 1e-9:
        return False
    p0 = (a[0] + ux * t0, a[1] + uy * t0)
    p1 = (a[0] + ux * t1, a[1] + uy * t1)
    target.line("cutting", [p0, p1])
    look2 = (normal.dot(parent.right), normal.dot(parent.up))
    for end, inward in ((p0, 1), (p1, -1)):
        tip = (end[0] + ux * inward * CUTTING_END, end[1] + uy * inward * CUTTING_END)
        target.line("cutting-ends", [end, tip])
        arrow_base = (end[0] + ux * inward * 3, end[1] + uy * inward * 3)
        arrow_tip = (arrow_base[0] + look2[0] * 7, arrow_base[1] + look2[1] * 7)
        target.line("thin", [arrow_base, arrow_tip])
        dimensions._arrow(target, arrow_tip, arrow_base)
        # Its letter outside the line's end, beside the arrow, kept clear by what comes after.
        letter = (end[0] - ux * inward * 4 + look2[0] * 4, end[1] - uy * inward * 4 + look2[1] * 4)
        target.text(section_view.name, letter[0], letter[1] - sheet.TEXT / 2, sheet.TEXT, "centre")
        width = sheet.lettering.width(section_view.name, sheet.TEXT)
        letter_box = (letter[0] - width / 2, letter[1] - sheet.TEXT / 2, letter[0] + width / 2, letter[1] + sheet.TEXT / 2)
        # The end, its arrow and its letter are one mark, which nothing placed after runs through or touches.
        taken.texts.append(dimensions._box_of([end, tip, arrow_base, arrow_tip, letter_box[:2], letter_box[2:]], margin=1.0))
        taken.lines += [(end, tip), (arrow_base, arrow_tip)]
    taken.lines.append((p0, p1))
    return True


# How far a detail's letter keeps from any line, centre to centre in mm on the sheet: about 1 mm of
# clear paper beside the thickest line. Nearer, it reads as part of the drawing.
LETTER_CLEARANCE = 1.5


def detail_mark(target, view, parent, taken):
    """
    A detail's circle on the view it is taken from, and its letter beside the
    circle where no line of that view or of the sheet comes within
    LETTER_CLEARANCE of it: just off the circle, or, where the circle lies on
    the part, further out with a thin leader to it, the nearest place clear
    of the part's lines.
    """
    cx, cy, r = view.window
    x, y = parent.origin[0] + cx * parent.scale, parent.origin[1] + cy * parent.scale
    radius = r * parent.scale
    target.arc("thin", x, y, radius)
    width = sheet.lettering.width(view.name, sheet.TEXT)
    outline = drawn_segments(parent)
    best = None
    for away in (1.5, 6.0, 12.0, 20.0, 30.0):
        for angle in (45, 135, -45, -135, 0, 180, 90, -90):
            c, s = math.cos(math.radians(angle)), math.sin(math.radians(angle))
            # The letter's nearest corner `away` off the circle, the way it lies.
            lx = x + (radius + away) * c - (width if c < -0.3 else width / 2 if abs(c) <= 0.3 else 0)
            ly = y + (radius + away) * s - (sheet.TEXT if s < -0.3 else sheet.TEXT / 2 if abs(s) <= 0.3 else 0)
            box = (lx, ly, lx + width, ly + sheet.TEXT)
            leader = [((x + radius * c, y + radius * s), (x + (radius + away - 0.5) * c, y + (radius + away - 0.5) * s))] if away > 1.5 else []
            kept = dimensions._grown(box, LETTER_CLEARANCE)
            count = taken.clashes([kept], leader, own=parent.view.name, own_box_too=False)
            count += dimensions.SPOILS_TEXT * sum(dimensions._through(a, b, kept) for a, b in outline)
            if best is None or count < best[0]:
                best = (count, box, leader)
            if count == 0:
                break
        if best[0] == 0:
            break
    _, box, leader = best
    for a, b in leader:
        target.line("thin", [a, b])
    target.text(view.name, box[0], box[1], sheet.TEXT)
    taken.texts.append(box)
    taken.lines += leader + [((x - radius, y), (x + radius, y))]
