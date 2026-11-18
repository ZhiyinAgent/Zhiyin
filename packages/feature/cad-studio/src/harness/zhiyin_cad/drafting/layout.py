"""
Where each view goes on the sheet, and at what scale: the six named views in
first- or third-angle projection round the front, lined up with it, and
every other view (the angled one, sections, details, views along a
direction) on the same grid, level with the view it belongs to; packed into
the room left beside them only when that grid does not fit. The scale is the largest of ISO 5455's
that fits them all, with their dimensions, or the one asked for.
"""

from fractions import Fraction

from . import lettering
from .sheet import TEXT

# Where each view sits, by column and row from the front.
PLACES = {
    "third": {"front": (0, 0), "top": (0, 1), "bottom": (0, -1), "right": (1, 0), "left": (-1, 0), "back": (2, 0)},
    "first": {"front": (0, 0), "top": (0, -1), "bottom": (0, 1), "right": (-1, 0), "left": (1, 0), "back": (2, 0)},
}

SCALES = [
    Fraction(50),
    Fraction(20),
    Fraction(10),
    Fraction(5),
    Fraction(2),
    Fraction(1),
    *(Fraction(1, n) for n in (2, 5, 10, 20, 50, 100, 200, 500, 1000)),
]

GAP = 12.0
# How far a centre line runs past what it marks, in mm on the sheet.
CENTRE_PAST = 3.0
# Room under a view for its name, as sections and details carry one.
NAME_ROOM = TEXT + 4


def scale_text(scale):
    """A scale as a drawing writes it, 1:5 or 13:50: a detail's is its sheet's times its own, carried as a float."""
    scale = Fraction(scale).limit_denominator(1000)
    return f"{scale.numerator}:{scale.denominator}"


def parse_scale(text):
    """A scale as a drawing writes it, 1:2 or 5:1."""
    left, _, right = str(text).partition(":")
    value = Fraction(int(left), int(right))
    if value <= 0:
        raise ValueError
    return value


def label_of(slot, scale):
    """The name written under a section, a detail or a view along a direction: one at a scale of its own with it."""
    label = slot.view.label
    if slot.view.kind == "detail" or slot.magnify != 1:
        label += f" ({scale_text(float(scale) * slot.magnify)})"
    return label


class Slot:
    """
    A view to place: its own bounds, how much larger it is drawn, the room
    round it, and the circles of details marked on it, which it makes room
    for too.
    """

    def __init__(self, view, magnify, room_x, room_y, named):
        self.view = view
        self.magnify = magnify
        self.room_x = room_x
        self.room_y = room_y
        self.named = named
        self.marks = []  # (cx, cy, radius) in the view's own millimetres
        self.origin = None
        self.scale = None

    def footprint(self, scale):
        left, bottom, right, top = self.view.bounds()
        for cx, cy, r in self.marks:
            left, bottom, right, top = min(left, cx - r), min(bottom, cy - r), max(right, cx + r), max(top, cy + r)
        s = float(scale) * self.magnify
        # Centre lines run a little past the view.
        past = CENTRE_PAST if self.view.circles or self.view.axes or self.view.arcs else 0.0
        half_w = max(abs(left), abs(right)) * s + max(self.room_y, past)
        half_h = max(abs(bottom), abs(top)) * s + max(self.room_x, past)
        width = 2 * half_w
        # Its name is no wider than the room it is given.
        if self.named:
            width = max(width, lettering.width(label_of(self, scale), TEXT) + 2)
        return width, 2 * half_h + (NAME_ROOM if self.named else 0)


def _extent(slot, scale):
    """A slot's half width, and how far it reaches above and below its view's middle, its name below it."""
    width, height = slot.footprint(scale)
    name = NAME_ROOM if slot.named else 0.0
    half = (height - name) / 2
    return width / 2, half, half + name


def _anchor(slot, cells, by_view):
    """The cell of the view a slot belongs beside: a section's the view it looks as, a detail's its parent's."""
    if slot.view.kind == "section":
        return next((cell for other, cell in cells.items() if other.view.name == getattr(slot.view, "looks_as", None)), None)
    if slot.view.kind == "detail":
        parent = by_view.get(slot.view.parent.name)
        return cells.get(parent)
    if slot.view.kind == "auxiliary":
        return next((cell for other, cell in cells.items() if other.view.name == "front"), None)
    return None


def _cells(slots, projection, outward):
    """
    Each slot's cell on a grid round the front, so every view is level with
    those in its row and centred over those in its column. The named views
    take their places by the projection; a section takes the place of the
    view it looks as when that view is not drawn; every other view goes
    beside the view it belongs to, `outward` to the right of its row or
    below in its column, and the angled view in an empty corner, the rightmost.
    """
    places = PLACES[projection]
    cells, taken = {}, {}
    for slot in slots:
        if slot.view.name in places and slot.magnify == 1 and not slot.named:
            cells[slot] = taken[places[slot.view.name]] = places[slot.view.name]
    for slot in slots:
        place = places.get(getattr(slot.view, "looks_as", None))
        if slot not in cells and slot.view.kind == "section" and place is not None and place not in taken:
            cells[slot] = taken[place] = place
    by_view = {slot.view.name: slot for slot in slots}
    rest = [slot for slot in slots if slot not in cells]
    # Sections and views along a direction first, then details beside the
    # views they enlarge, and the angled view last, into whatever corner is left.
    for slot in sorted(rest, key=lambda s: {"section": 0, "auxiliary": 0, "detail": 1}.get(s.view.kind, 2)):
        columns = [c for c, _ in taken] or [0]
        rows = [r for _, r in taken] or [0]
        anchor = _anchor(slot, cells, by_view)
        if anchor is not None:
            c, r = anchor
            step = (1, 0) if outward == "right" else (0, -1)
            cell = (c + step[0], r + step[1])
            while cell in taken:
                cell = (cell[0] + step[0], cell[1] + step[1])
        else:
            corners = sorted(
                ((c, r) for c in range(min(columns), max(columns) + 1) for r in range(min(rows), max(rows) + 1) if (c, r) not in taken),
                key=lambda cell: (-cell[0], -cell[1]),
            )
            if corners:
                cell = corners[0]
            elif outward == "right":
                cell = (max(columns) + 1, max(rows))
            else:
                cell = (max(columns), min(rows) - 1)
        cells[slot] = taken[cell] = cell
    return cells


def _aligned(slots, projection, scale, room_w, room_h, outward):
    """Every view on one grid at a scale, if it fits: its columns' half widths, its rows' reach up and down."""
    cells = _cells(slots, projection, outward)
    halves, above, below = {}, {}, {}
    for slot, (column, row) in cells.items():
        half, up, down = _extent(slot, scale)
        halves[column] = max(halves.get(column, 0.0), half)
        above[row] = max(above.get(row, 0.0), up)
        below[row] = max(below.get(row, 0.0), down)
    width = sum(2 * h for h in halves.values()) + GAP * (len(halves) - 1)
    height = sum(above.values()) + sum(below.values()) + GAP * (len(above) - 1)
    if width > room_w or height > room_h:
        return None
    return cells, halves, above, below, (width, height)


def _meets(a, b):
    """Whether two boxes (x, y, width, height) overlap."""
    return a[0] < b[0] + b[2] and b[0] < a[0] + a[2] and a[1] < b[1] + b[3] and b[1] < a[1] + a[3]


def _without(rooms, corner):
    """Free rooms (x, y, width, height), each that reaches into the corner cut to the parts of it beside and above the corner."""
    if corner is None:
        return rooms
    kept = (corner[0], corner[1], corner[2] - corner[0], corner[3] - corner[1])
    out = []
    for room in rooms:
        if not _meets(room, kept):
            out.append(room)
            continue
        x, y, w, h = room
        out += [one for one in ((x, y, kept[0] - x, h), (x, y, w, kept[1] - y)) if one[2] > 0 and one[3] > 0]
    return out


# How many places across and down a view is tried at, to find the emptiest.
TRIED_PLACES = 40


def _emptiest(w, h, room_w, room_h, boxes):
    """
    Where a box `w` by `h` stands most in the middle of the empty room it
    has among `boxes`, each (x, y, width, height) measured as a plan is, and
    the room's edges, where its balloons and dimensions go: of the places a
    GAP clear of each box, the one whose nearer side across and nearer side
    up stand furthest from what is beside, above and below it, taken
    together, so it leaves no large room empty on one side of it; then the
    one furthest from the nearest box or edge. Its top left and how far it
    stands from the nearest box, or None when it fits nowhere.
    """
    best = None
    for i in range(TRIED_PLACES + 1):
        x = (room_w - w) * i / TRIED_PLACES
        for j in range(TRIED_PLACES + 1):
            y = (room_h - h) * j / TRIED_PLACES
            gaps = []
            # How far it is to what stands beside it, left and right, and above and below.
            left, right, above, below = x, room_w - x - w, y, room_h - y - h
            for bx, by, bw, bh in boxes:
                dx = max(bx - (x + w), x - (bx + bw), 0.0)
                dy = max(by - (y + h), y - (by + bh), 0.0)
                gaps.append(max(dx, dy) if not (dx and dy) else (dx * dx + dy * dy) ** 0.5)
                if not dy and dx:
                    left, right = (min(left, dx), right) if bx < x else (left, min(right, dx))
                elif not dx and dy:
                    above, below = (min(above, dy), below) if by < y else (above, min(below, dy))
            gap = min(gaps, default=float("inf"))
            score = (min(left, right) * min(above, below), sorted(gaps + [x, y, room_w - x - w, room_h - y - h]))
            if gap >= GAP and (best is None or score > best[0]):
                best = (score, x, y, gap)
    return None if best is None else best[1:]


def _angled(slot):
    """Whether a slot holds the angled view, which lines up with no other."""
    return slot.view.kind == "named" and slot.view.name == "iso"


def _plan(slots, projection, scale, room_w, room_h, corner=None, first="top", angled_last=True):
    """
    Where everything goes at a scale, if it fits: the grid round the front,
    and the rest beside it or below, all clear of `corner`, a box measured
    as the plan is; each in the highest room it fits, or with `first` left,
    the leftmost.
    """
    places = PLACES[projection]
    grid, extra = {}, []
    for slot in slots:
        if slot.view.name in places and slot.magnify == 1 and not slot.named:
            grid[places[slot.view.name]] = slot
        else:
            extra.append(slot)
    columns, rows = {}, {}
    for (column, row), slot in grid.items():
        width, height = slot.footprint(scale)
        columns[column] = max(columns.get(column, 0), width)
        rows[row] = max(rows.get(row, 0), height)
    grid_w = sum(columns.values()) + GAP * max(0, len(columns) - 1)
    grid_h = sum(rows.values()) + GAP * max(0, len(rows) - 1)
    if grid_w > room_w or grid_h > room_h:
        return None
    if grid and corner is not None and _meets((0.0, 0.0, grid_w, grid_h), (corner[0], corner[1], corner[2] - corner[0], corner[3] - corner[1])):
        return None
    # The rest packed into the room left beside and below the grid, the
    # largest first, each taking the first space it fits and leaving what
    # is right of it and below it; measured from the area's top left, down.
    free = _without(
        [(grid_w + GAP, 0.0, room_w - grid_w - GAP, room_h), (0.0, grid_h + GAP, grid_w, room_h - grid_h - GAP)]
        if grid
        else [(0.0, 0.0, room_w, room_h)],
        corner,
    )
    placed = {}
    # The angled view, which lines up with no other, last: where it stands
    # furthest from the rest, so no quarter of the sheet is left empty.
    angled = [i for i, slot in enumerate(extra) if _angled(slot)] if angled_last else []
    order = sorted(
        (i for i in range(len(extra)) if i not in angled), key=lambda i: -extra[i].footprint(scale)[0] * extra[i].footprint(scale)[1]
    )
    for index in angled:
        w, h = extra[index].footprint(scale)
        if not any(w <= fw and h <= fh for _, _, fw, fh in free):
            order.append(index)
    for index in order:
        w, h = extra[index].footprint(scale)
        free.sort(key=(lambda r: (r[1], r[0])) if first == "top" else (lambda r: (r[0], r[1])))
        for k, (fx, fy, fw, fh) in enumerate(free):
            if w <= fw and h <= fh:
                placed[index] = (fx, fy, w, h)
                del free[k]
                # What is left right of it and below it, and of any other room it overlaps.
                taken = (fx, fy, w + GAP, h + GAP)
                free = [room for room in free if not _meets(room, taken)] + _without(
                    [room for room in free if _meets(room, taken)], (fx, fy, fx + w + GAP, fy + h + GAP)
                )
                free += [(fx + w + GAP, fy, fw - w - GAP, h), (fx, fy + h + GAP, fw, fh - h - GAP)]
                break
        else:
            return None
    clearance = None
    for index in angled:
        if index in placed:
            continue
        w, h = extra[index].footprint(scale)
        others = [(0.0, 0.0, grid_w, grid_h)] if grid else []
        others += list(placed.values())
        if corner is not None:
            others.append((corner[0], corner[1], corner[2] - corner[0], corner[3] - corner[1]))
        spot = _emptiest(w, h, room_w, room_h, others)
        if spot is None:
            # Packed with the others, it may still find room.
            return _plan(slots, projection, scale, room_w, room_h, corner, first, angled_last=False)
        placed[index] = (spot[0], spot[1], w, h)
        clearance = spot[2]
    if clearance is not None:
        # Placed against the whole room, the plan takes all of it.
        return grid, columns, rows, extra, placed, (room_w, room_h), clearance
    width = max([grid_w] + [x + w for x, _, w, _ in placed.values()])
    height = max([grid_h] + [y + h for _, y, _, h in placed.values()])
    return grid, columns, rows, extra, placed, (width, height), None


def _box(slot, scale):
    """The room a placed slot takes on the sheet, its name included."""
    half, up, down = _extent(slot, scale)
    x, y = slot.origin
    return (x - half, y - down, x + half, y + up)


def _clear_of(slots, scale, corner):
    """Whether no placed slot reaches into the corner kept clear."""
    if corner is None:
        return True
    return not any(
        box[0] < corner[2] and box[2] > corner[0] and box[1] < corner[3] and box[3] > corner[1] for box in (_box(s, scale) for s in slots)
    )


def _middles(area, corner, size):
    """
    Where a block of views `size` across and up may have its middle: the
    middle of the area, then of the room above the corner kept clear, of the
    room beside it, and the area's top left, top right and bottom left.
    """
    left, bottom, right, top = area
    width, height = size
    found = [((left + right) / 2, (bottom + top) / 2)]
    if corner is not None:
        found += [
            ((left + right) / 2, (corner[3] + top) / 2),
            ((left + corner[0]) / 2, (bottom + top) / 2),
            (left + width / 2, top - height / 2),
            (right - width / 2, top - height / 2),
            (left + width / 2, bottom + height / 2),
        ]
    return found


def arrange(slots, projection, area, asked=None, corner=None):
    """
    Places every slot, setting where its view's middle goes and its scale,
    each clear of `corner`, a box kept for a title block and its parts list.
    Returns the scale, or None when even the smallest does not fit.
    """
    left, bottom, right, top = area
    room_w, room_h = right - left, top - bottom
    for scale in [asked] if asked is not None else SCALES:
        for outward in ("right", "below"):
            aligned = _aligned(slots, projection, scale, room_w, room_h, outward)
            if not aligned:
                continue
            width, height = aligned[4]
            for x, y in _middles(area, corner, (width, height)):
                if x - width / 2 < left - 1e-6 or x + width / 2 > right + 1e-6 or y - height / 2 < bottom - 1e-6 or y + height / 2 > top + 1e-6:
                    continue
                _place_aligned(aligned, x, y, scale)
                if _clear_of(slots, scale, corner):
                    if corner is not None:
                        _fill(slots, scale, area, corner)
                    return scale
        # Round a parts list's corner, the views packed highest first or
        # leftmost first, whichever fills the room more evenly: the larger of
        # the shares of its width and of its height they leave unused; with
        # the angled view set in the emptiest room left, the plan where it
        # stands furthest from the rest.
        plans = [_plan(slots, projection, scale, room_w, room_h, _in_plan(area, corner), first) for first in (("top", "left") if corner else ("top",))]
        plans = [one for one in plans if one]
        plan = min(plans, key=lambda one: (-(one[6] or 0.0), max(1 - one[5][0] / room_w, 1 - one[5][1] / room_h))) if plans else None
        if plan:
            break
    else:
        return None
    width, height = plan[5]
    # In the middle of the room, or else at its top left, where the plan keeps clear of the corner.
    for x0, y_top in ((left + (room_w - width) / 2, top - (room_h - height) / 2), (left, top)):
        _place_plan(plan, x0, y_top, scale)
        if _clear_of(slots, scale, corner):
            break
    if corner is not None:
        _fill(slots, scale, area, corner)
    elif plan[6] is not None:
        # The angled view set again in the emptiest room the rest leave.
        for slot in slots:
            if _angled(slot):
                _set_apart(slot, slots, scale, area, corner)
    return scale


def _set_apart(slot, slots, scale, area, corner):
    """Places a slot where it stands furthest from the other slots, the corner and the area's edges; False when it fits nowhere."""
    left, _, _, top = area
    others = [(box[0] - left, top - box[3], box[2] - box[0], box[3] - box[1]) for box in (_box(s, scale) for s in slots if s is not slot)]
    kept = _in_plan(area, corner)
    if kept is not None:
        others.append((kept[0], kept[1], kept[2] - kept[0], kept[3] - kept[1]))
    w, h = slot.footprint(scale)
    spot = _emptiest(w, h, area[2] - area[0], area[3] - area[1], others)
    if spot is None:
        return False
    _place(slot, left + spot[0] + w / 2, top - spot[1] - h / 2, scale)
    return True


# The most the views of a sheet with a parts list are spread apart, as a share of how far apart they were.
SPREAD = 1.6
# How many shares up to SPREAD, and how many places across the room, a spread tries along each axis.
SPREAD_STEPS = 6
SHIFT_STEPS = 12


def _gap(low_a, high_a, low_b, high_b):
    """How far apart two spans are along one axis; less than nothing where they overlap."""
    return max(low_b - high_a, low_a - high_b)


def _fill(slots, scale, area, corner):
    """
    The views of a sheet with a parts list spread into the room it leaves,
    then the angled view, which lines up with none, set apart where it
    stands furthest from the rest; where it then fits nowhere, it is spread
    with the rest and set apart from where that leaves it.
    """
    angled = [slot for slot in slots if _angled(slot)]
    placed = {slot: slot.origin for slot in slots}
    _spread([slot for slot in slots if slot not in angled], scale, area, corner)
    if all(_set_apart(slot, slots, scale, area, corner) for slot in angled):
        return
    for slot, origin in placed.items():
        slot.origin = origin
    _spread(slots, scale, area, corner)
    for slot in angled:
        _set_apart(slot, slots, scale, area, corner)


def _spread(slots, scale, area, corner):
    """
    Views spread apart into the room a parts list leaves: along each axis
    their distances from one another grown by one share, up to SPREAD, and
    all of them moved alike, so that the narrowest gap between two views, a
    view and the corner, or the outermost views and the area's edges is as
    wide as it can be, then the next narrowest. Each axis is stretched as a
    whole, so views in a row stay level and those in a column stay in it,
    and no two come closer than they were.
    """
    if not slots:
        return
    boxes = [_box(slot, scale) for slot in slots]
    count = len(boxes)

    def moves(k):
        """Along axis `k`, 0 across and 1 up: each way to spread, how far each view moves and the gaps that leaves."""
        other = 1 - k
        lows, highs = [box[k] for box in boxes], [box[k + 2] for box in boxes]
        middles = [(low + high) / 2 for low, high in zip(lows, highs)]
        start = min(lows)
        # Views side by side along this axis keep their gap along it; views
        # in neither the same row nor the same column stand apart either way.
        beside = [
            (i, j)
            for i in range(count)
            for j in range(i + 1, count)
            if boxes[i][other] < boxes[j][other + 2] and boxes[j][other] < boxes[i][other + 2]
        ]
        found = [[0.0] * count]
        for step in range(SPREAD_STEPS + 1):
            share = 1 + (SPREAD - 1) * step / SPREAD_STEPS
            grown = [(middle - start) * (share - 1) for middle in middles]
            low = min(one + d for one, d in zip(lows, grown))
            high = max(one + d for one, d in zip(highs, grown))
            spare = (area[k + 2] - area[k]) - (high - low)
            if spare < -1e-9:
                break
            for place in range(SHIFT_STEPS + 1):
                shift = area[k] - low + spare * place / SHIFT_STEPS
                found.append([d + shift for d in grown])
        out = []
        for moved in found:
            gaps = [min(one + d for one, d in zip(lows, moved)) - area[k], area[k + 2] - max(one + d for one, d in zip(highs, moved))]
            if min(gaps) < -1e-9:
                continue
            gaps += [_gap(lows[i] + moved[i], highs[i] + moved[i], lows[j] + moved[j], highs[j] + moved[j]) for i, j in beside]
            out.append((moved, gaps))
        return out

    best = None
    for across, gaps_x in moves(0):
        for up, gaps_y in moves(1):
            kept = _from_corner(boxes, across, up, corner)
            if kept is None:
                continue
            gaps = sorted(gaps_x + gaps_y + kept)
            if best is None or gaps > best[0]:
                best = (gaps, across, up)
    if best is None:
        return
    for slot, dx, dy in zip(slots, best[1], best[2]):
        slot.origin = (slot.origin[0] + dx, slot.origin[1] + dy)


def _from_corner(boxes, across, up, corner):
    """How far each box, moved, stands from the corner kept clear; None when one reaches into it."""
    if corner is None:
        return []
    found = []
    for box, dx, dy in zip(boxes, across, up):
        apart_x = _gap(box[0] + dx, box[2] + dx, corner[0], corner[2])
        apart_y = _gap(box[1] + dy, box[3] + dy, corner[1], corner[3])
        if apart_x < 0 and apart_y < 0:
            return None
        found.append((apart_x**2 + apart_y**2) ** 0.5 if apart_x > 0 and apart_y > 0 else max(apart_x, apart_y))
    return found


def _in_plan(area, corner):
    """The corner kept clear as a plan measures: across from the area's left, down from its top."""
    if corner is None:
        return None
    left, _, _, top = area
    return (corner[0] - left, top - corner[3], corner[2] - left, top - corner[1])


def _place_plan(plan, x0, y_top, scale):
    """Every slot of a plan, its top left at (x0, y_top)."""
    grid, columns, rows, extra, placed, _, _ = plan
    # The grid's columns left to right, its rows top to bottom.
    column_x, x = {}, x0
    for column in sorted(columns):
        column_x[column] = x + columns[column] / 2
        x += columns[column] + GAP
    row_y, y = {}, y_top
    for row in sorted(rows, reverse=True):
        row_y[row] = y - rows[row] / 2
        y -= rows[row] + GAP
    for (column, row), slot in grid.items():
        slot.origin = (column_x[column], row_y[row])
        slot.scale = float(scale)
    for index, (x, y, w, h) in placed.items():
        _place(extra[index], x0 + x + w / 2, y_top - y - h / 2, scale)


def _place_aligned(plan, x_middle, y_middle, scale):
    """Every slot at its cell's middle, the grid in the middle of the room."""
    cells, halves, above, below, (width, height) = plan
    column_x, x = {}, x_middle - width / 2
    for column in sorted(halves):
        column_x[column] = x + halves[column]
        x += 2 * halves[column] + GAP
    row_y, y = {}, y_middle + height / 2
    for row in sorted(above, reverse=True):
        row_y[row] = y - above[row]
        y -= above[row] + below[row] + GAP
    for slot, (column, row) in cells.items():
        slot.origin = (column_x[column], row_y[row])
        slot.scale = float(scale) * slot.magnify


def _place(slot, x, y_middle, scale):
    """A slot's view in the middle of its footprint, above the room for its name."""
    slot.origin = (x, y_middle + (NAME_ROOM / 2 if slot.named else 0))
    slot.scale = float(scale) * slot.magnify
