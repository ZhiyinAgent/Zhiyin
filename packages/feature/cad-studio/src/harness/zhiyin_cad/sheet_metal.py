"""
Sheet metal, which build123d does not make: a flat outline of a given
thickness folded along lines, as a press brake folds it, with its flat
pattern. The outline is drawn as the bent part's overall sizes read: each
length runs to the outside of the bends, where the outside faces of the two
flats either side would meet (the mould line), so a channel drawn 40 mm wide
with two 20 mm flanges is 40 mm across and 20 mm tall outside. The flat
pattern is that outline less what each bend takes up: its two setbacks
(the outside faces' tangent lengths, tan(angle / 2) × (r + t)) less its bend
allowance, the arc of the neutral layer, (r + K t) × angle.

K, where the neutral layer lies as a share of the thickness from the inside
face, follows DIN 6935: K = (0.65 + 0.5 log10(r / t)) / 2 up to r / t = 5,
and 0.5 beyond. It is a rule for air bending steel; a shop's own K, from a
test bend on its tooling, is truer, and `k=` takes it.

Bends are parts of the outline folded about a segment of a line:

- bend: a line across the outline, from edge to edge, folded by its angle.
- flange: a strip `length` long added along an edge of the outline, then
  folded by its angle along that edge.
- hem: a strip added along an edge and folded back flat over the sheet,
  `length` measured from the fold's outside.
- jog: two opposite bends a step apart, the side of the line holding less of
  the outline raised by `offset`.

A bend whose sheet goes on past its end, as a flange narrower than the edge
it stands on, would tear there: a relief a thickness wide is cut into the
sheet beside each such end, reaching a thickness past where the bend starts.
Where two bends meet at a corner of a flat, the square both would bend is
cut away, a corner relief.
"""

import math

import build123d as bd
import numpy
from OCP.gp import gp_Ax1, gp_Dir, gp_Pnt, gp_Trsf, gp_Vec
from OCP.TopLoc import TopLoc_Location
from OCP.TopoDS import TopoDS

from . import notes
from .words import mm as _mm

# Lengths closer than this, in mm, are the same.
NEAR = 1e-4
# The steepest a bend or a flange may be folded, in degrees; a hem is folded 180.
STEEPEST = 135.0
# The least flat a jog's step leaves between its two bends, in mm.
LEAST_STEP = 0.01
KINDS = ("bend", "flange", "hem", "jog")


class SheetRefused(ValueError):
    """A sheet that cannot be folded as asked, with why."""


def din_k(radius, thickness):
    """
    DIN 6935's neutral layer, as a share of the thickness from the inside
    face: (0.65 + 0.5 log10(r / t)) / 2 up to r / t = 5, 0.5 beyond.
    """
    ratio = radius / thickness
    if ratio > 5:
        return 0.5
    return (0.65 + 0.5 * math.log10(ratio)) / 2


def _point(value, what):
    try:
        x, y = (float(v) for v in tuple(value)[:2])
    except Exception:  # noqa: BLE001 - said in the script's terms
        raise SheetRefused(f"{what} is a point (x, y) on the outline.") from None
    return numpy.array([x, y])


def _outline_face(outline):
    """The outline as one flat face in XY: points (x, y), or a Face or Sketch drawn there."""
    if isinstance(outline, (bd.Face, bd.Sketch)):
        faces = outline.faces()
        if len(faces) != 1:
            raise SheetRefused(f"the outline is {len(faces)} faces: give one, holes cut into it.")
        face = faces[0]
        box = face.bounding_box()
        if box.max.Z - box.min.Z > NEAR:
            raise SheetRefused("the outline lies in the XY plane.")
        return _upward(face)
    points = [tuple(_point(p, "each point of the outline")) for p in outline]
    if len(points) < 3:
        raise SheetRefused("the outline is three points (x, y) or more, or a Face.")
    return _polygon(points)


def _faces(shape):
    return [] if shape is None else [f for f in shape.faces() if f.area > NEAR]


def _upward(face):
    """A flat face in XY turned to face +z, so it rises as it is extruded."""
    if face.normal_at().Z < 0:
        return bd.Face(TopoDS.Face(face.wrapped.Reversed()))
    return face


def _polygon(points):
    return _upward(bd.Face(bd.Wire.make_polygon([(float(p[0]), float(p[1])) for p in points], close=True)))


def _rectangle(origin, along, across, u0, u1, s0, s1):
    return _polygon([origin + along * u + across * s for u, s in ((u0, s0), (u1, s0), (u1, s1), (u0, s1))])


def _area(shape):
    return sum(f.area for f in _faces(shape))


def _inside(shape, point):
    """Whether a point (x, y) lies in a flat shape's faces."""
    at = bd.Vector(float(point[0]), float(point[1]), 0.0)
    return any(face.distance_to(at) < 1e-7 for face in _faces(shape))


def _union(faces):
    """
    Flat faces in XY joined into as few as they make: raised into solids,
    fused and cleaned, so faces meeting along part of an edge become one,
    and their floors taken.
    """
    solids = [bd.extrude(face, amount=1.0) for face in faces]
    joined = solids[0].fuse(*solids[1:]).clean() if len(solids) > 1 else solids[0]
    tops = [f.moved(bd.Location((0, 0, -1))) for f in joined.faces() if abs(f.center().Z - 1) < 1e-6 and f.normal_at().Z > 0.5]
    return tops[0] if len(tops) == 1 else bd.Sketch(tops)


class _Line:
    """A bend's segment on the outline: its start, its direction, its length and the side s > 0."""

    def __init__(self, start, end, what):
        self.start = start
        span = end - start
        self.length = float(numpy.linalg.norm(span))
        if self.length < NEAR:
            raise SheetRefused(f"{what} runs between two different points.")
        self.along = span / self.length
        self.across = numpy.array([self.along[1], -self.along[0]])

    def s(self, point):
        return float((numpy.asarray(point)[:2] - self.start) @ self.across)

    def u(self, point):
        return float((numpy.asarray(point)[:2] - self.start) @ self.along)

    def at(self, u, s=0.0):
        return self.start + self.along * u + self.across * s


class _Bend:
    """One fold: its line, its angle (up above zero), its inside radius and what it takes up."""

    def __init__(self, number, kind, line, angle, radius, thickness, k):
        self.number, self.kind, self.line = number, kind, line
        self.angle, self.radius = angle, radius
        turn = math.radians(abs(angle))
        self.k = din_k(radius, thickness) if k is None else k
        # The setback each side: how far each flat stops short of the mould line.
        self.setback = (radius + thickness) if kind == "hem" else math.tan(turn / 2) * (radius + thickness)
        self.allowance = (radius + self.k * thickness) * turn

    def band(self):
        """What the bend takes of the outline: the strip a setback either side of its segment."""
        return _rectangle(self.line.start, self.line.along, self.line.across, 0.0, self.line.length, -self.setback, self.setback)


def _trsf_rotation(point, axis, degrees):
    trsf = gp_Trsf()
    trsf.SetRotation(gp_Ax1(gp_Pnt(*point), gp_Dir(*axis)), math.radians(degrees))
    return trsf


def _trsf_shift(vector):
    trsf = gp_Trsf()
    trsf.SetTranslation(gp_Vec(*vector))
    return trsf


def _times(first, second):
    """The transform that applies `second`, then `first`."""
    return first.Multiplied(second)


class _Fold:
    """How a bend moves the flat beyond it, seen from the flat before it: the side that moves and the transform."""

    def __init__(self, bend, toward, thickness):
        self.bend = bend
        line = bend.line
        self.toward = toward
        self.out = line.across * toward
        v = bend.setback
        foot = line.start - self.out * v
        up = bend.angle > 0
        self.axis_point = (float(foot[0]), float(foot[1]), thickness + bend.radius if up else -bend.radius)
        out3 = numpy.array([self.out[0], self.out[1], 0.0])
        self.axis = tuple(float(v) for v in numpy.cross(out3, [0.0, 0.0, 1.0]))
        self.trsf = _times(_trsf_rotation(self.axis_point, self.axis, bend.angle), _trsf_shift((-2 * v * self.out[0], -2 * v * self.out[1], 0.0)))
        # In the flat pattern the far side moves back by what the bend saves.
        self.flat_shift = -(2 * v - bend.allowance) * self.out

    def zone(self, u0, u1, thickness):
        """The bend's material between u0 and u1 along its line, bent, in the frame of the flat before it."""
        line = self.bend.line
        corners = []
        for u, z in ((u0, 0.0), (u1, 0.0), (u1, thickness), (u0, thickness)):
            p = line.at(u) - self.out * self.bend.setback
            corners.append((float(p[0]), float(p[1]), z))
        face = bd.Face(bd.Wire.make_polygon(corners, close=True))
        return bd.revolve(face, axis=bd.Axis(self.axis_point, self.axis), revolution_arc=self.bend.angle)

    def flat_zone(self, u0, u1):
        line = self.bend.line
        s0 = -self.bend.setback * self.toward
        s1 = (-self.bend.setback + self.bend.allowance) * self.toward
        return _rectangle(line.start, line.along, line.across, u0, u1, min(s0, s1), max(s0, s1))


def _spans_on(face, line, s):
    """The stretches along a line, u0 to u1, where a face's edges lie on the line s."""
    spans = []
    for edge in face.edges():
        a, b = edge.position_at(0), edge.position_at(1)
        if abs(line.s(tuple(a)) - s) < 1e-3 and abs(line.s(tuple(b)) - s) < 1e-3 and edge.geom_type == bd.GeomType.LINE:
            ua, ub = sorted((line.u(tuple(a)), line.u(tuple(b))))
            if ub - ua > NEAR:
                spans.append((ua, ub))
    return spans


def _overlaps(first, second):
    found = []
    for a0, a1 in first:
        for b0, b1 in second:
            lo, hi = max(a0, b0), min(a1, b1)
            if hi - lo > NEAR:
                found.append((lo, hi))
    found.sort()
    joined = []
    for lo, hi in found:
        if joined and lo <= joined[-1][1] + NEAR:
            joined[-1] = (joined[-1][0], max(joined[-1][1], hi))
        else:
            joined.append((lo, hi))
    return joined


def _where(p):
    return f"({_mm(p[0])}, {_mm(p[1])})"


def _strip(line, length, blank, what):
    """A strip `length` long along a segment of the outline's edge, on the side away from the outline."""
    middle = line.at(line.length / 2)
    probe = min(0.01, line.length / 10)
    plus, minus = _inside(blank, line.at(line.length / 2, probe)), _inside(blank, line.at(line.length / 2, -probe))
    if plus == minus:
        raise SheetRefused(f"{what} runs along no edge of the outline at {_where(middle)}: give two points on one of its edges.")
    outward = -1.0 if plus else 1.0
    s0, s1 = sorted((0.0, outward * length))
    return _rectangle(line.start, line.along, line.across, 0.0, line.length, s0, s1)


def _jog_offset_line(line, toward, angle, radius, thickness, k, offset, number):
    """The second line of a jog: as far beyond the first as raises the far side by `offset`."""
    first = _Bend(number, "jog", line, angle, radius, thickness, k)
    out = line.across * toward

    def rise(distance):
        start = line.start + out * distance
        second = _Bend(number, "jog", _Line(start, start + line.along * line.length, "a jog"), -angle, radius, thickness, k)
        trsf = _times(_Fold(first, toward, thickness).trsf, _Fold(second, toward, thickness).trsf)
        far = line.start + out * (distance + 10 * (radius + thickness) + 10)
        p = gp_Pnt(float(far[0]), float(far[1]), 0.0).Transformed(trsf)
        return p.Z()

    base, slope = rise(0.0), rise(1.0) - rise(0.0)
    if abs(slope) < 1e-9:
        raise SheetRefused(f"jog {number} at {angle:g}° raises nothing: give it an angle between 0 and {STEEPEST:g}°.")
    distance = (offset - base) / slope
    least = 2 * first.setback + LEAST_STEP
    if distance < least:
        raise SheetRefused(
            f"jog {number} cannot step {_mm(offset)} mm with two {abs(angle):g}° bends of {_mm(radius)} mm inside radius in {_mm(thickness)} mm sheet: "
            f"its bends meet; the least step it makes is {_mm(base + slope * least)} mm."
        )
    start = line.start + out * distance
    return _Line(start, start + line.along * line.length, f"jog {number}")


def _area_beside(blank, line, side):
    """How much of the outline lies on one side of a line's whole length."""
    far = 1e6
    half = _rectangle(line.start - line.along * far, line.along, line.across, 0.0, 2 * far, 0.0, side * far)
    return _area(blank & half)


def sheet(outline, thickness, bends=(), radius=None, k=None, relief=True, fixed=None):
    """
    Sheet metal folded from a flat outline: answers the bent part, with the
    flat pattern as `.flat`, a solid `thickness` thick lying in XY where the
    outline lies, to show as a part of its own and draw from the top to a
    .dxf for cutting, and its bend lines as `.bend_lines`, each
    {"from", "to", "angle", "radius"} on the flat pattern.

    outline: points (x, y) in order, or a Face or Sketch in XY, holes and all,
    sized to the outside of the bends. thickness: the sheet's, in mm.
    bends: each a dict:
      {"line": ((x1, y1), (x2, y2)), "angle": 90} folds the outline about the
        line drawn across it, edge to edge, angle up above zero (toward +z,
        the side the sheet is thick toward) and down below;
      {"kind": "flange", "edge": ((x1, y1), (x2, y2)), "length": 20, "angle": 90}
        adds a strip `length` long along that stretch of an edge and folds it;
      {"kind": "hem", "edge": (...), "length": 8} adds one and folds it back
        flat, 180°, length from the fold's outside;
      {"kind": "jog", "line": (...), "offset": 5, "angle": 90} steps the side
        of the line holding less of the outline up by offset (down below zero).
      Each may give its own "radius". radius: every bend's inside radius,
      the thickness when left out (a hem's half of it). k: the neutral layer's
      share of the thickness from the inside, DIN 6935's when left out.
    relief: True cuts a relief a thickness wide and reaching a thickness past
      the bend where a bend ends inside the sheet; (width, depth) sizes it;
      False cuts none, and the answer names where the sheet would tear.
    fixed: a point (x, y) on the flat that stays where the outline lies; the
      largest flat when left out.
    """
    t = float(thickness)
    if not t > 0:
        raise SheetRefused("thickness is a number above 0, in mm.")
    blank = _outline_face(outline)
    if relief is True:
        relief_size = (t, t)
    elif relief:
        relief_size = tuple(float(v) for v in relief)
    else:
        relief_size = None
    asked = []
    for number, given in enumerate(bends, start=1):
        if not isinstance(given, dict):
            raise SheetRefused(f"bend {number} is a dict, such as {{'line': ((0, 20), (50, 20)), 'angle': 90}}.")
        kind = given.get("kind", "bend")
        if kind not in KINDS:
            raise SheetRefused(f"bend {number} is of the kind {kind}: a kind is one of {', '.join(KINDS)}.")
        key = "edge" if kind in ("flange", "hem") else "line"
        ends = given.get(key)
        if ends is None or len(ends) != 2:
            raise SheetRefused(f"bend {number}, a {kind}, gives {key}: two points (x, y).")
        line = _Line(_point(ends[0], f"bend {number}'s {key}"), _point(ends[1], f"bend {number}'s {key}"), f"bend {number}'s {key}")
        angle = 180.0 if kind == "hem" else float(given.get("angle", 90))
        if kind != "hem" and not 0 < abs(angle) <= STEEPEST:
            raise SheetRefused(f"bend {number} is folded {angle:g}°: a fold is between 0 and {STEEPEST:g}° either way; a fold back flat is a hem.")
        r = float(given.get("radius", radius if radius is not None else (t / 2 if kind == "hem" else t)))
        if not r > 0:
            raise SheetRefused(f"bend {number}'s inside radius is a number above 0, in mm.")
        if kind in ("flange", "hem"):
            length = float(given.get("length", 0))
            if kind == "hem" and length <= r + t:
                raise SheetRefused(f"hem {number} is {_mm(length)} mm long: a hem reaches past its fold's round, more than {_mm(r + t)} mm.")
            if length <= 0:
                raise SheetRefused(f"flange {number} gives its length, above 0, in mm.")
            blank = _union([*_faces(blank), _strip(line, length, blank, f"bend {number}'s edge")])
        asked.append((number, kind, line, angle, r, given))
    found = []
    for number, kind, line, angle, r, given in asked:
        if kind == "jog":
            offset = float(given.get("offset", 0))
            if abs(offset) < NEAR:
                raise SheetRefused(f"jog {number} gives its offset, the step in mm, up above zero.")
            far = 1.0 if _area_beside(blank, line, 1.0) < _area_beside(blank, line, -1.0) else -1.0
            turn = math.copysign(abs(angle), offset)
            found.append(_Bend(number, "jog", line, turn, r, t, k))
            found.append(_Bend(number, "jog", _jog_offset_line(line, far, turn, r, t, k, offset, number), -turn, r, t, k))
        else:
            found.append(_Bend(number, kind, line, angle, r, t, k))
    return _folded(blank, t, found, relief_size, fixed)


def _folded(blank, t, bends, relief_size, fixed):
    flats = blank
    for bend in bends:
        flats = flats - bend.band()
    panels = _faces(flats)
    if not panels:
        raise SheetRefused("the bends take the whole outline: draw it larger, or the bends fewer or tighter.")
    # Each bend's stretches joining two flats, from the flats' edges along its two sides.
    joins = []
    for bend in bends:
        line, v = bend.line, bend.setback
        for i, one in enumerate(panels):
            for j, other in enumerate(panels):
                for lo, hi in _overlaps(_spans_on(one, line, -v), _spans_on(other, line, v)):
                    if i == j:
                        raise SheetRefused(
                            f"bend {bend.number} from {_where(line.at(0))} to {_where(line.at(line.length))} does not part the sheet: run its line from edge to edge, or cut the outline to where it ends."
                        )
                    joins.append((bend, i, j, lo, hi))
    unjoined = [b for b in bends if not any(one[0] is b for one in joins)]
    if unjoined:
        b = unjoined[0]
        raise SheetRefused(f"bend {b.number} from {_where(b.line.at(0))} to {_where(b.line.at(b.line.length))} joins no two flats: its line runs along no part of the outline.")
    if fixed is not None:
        held = _point(fixed, "fixed")
        root = next((i for i, p in enumerate(panels) if _inside(p, held)), None)
        if root is None:
            raise SheetRefused(f"fixed {_where(held)} lies on no flat of the sheet.")
    else:
        root = max(range(len(panels)), key=lambda i: panels[i].area)
    place = {root: gp_Trsf()}
    shift = {root: numpy.zeros(2)}
    parent_of = {}
    order = [root]
    # Each stretch of a bend: the bend, the flat it hangs from, the flat it moves, its ends along the line and its fold.
    zones = []
    for here in order:
        for bend, i, j, lo, hi in joins:
            if here not in (i, j):
                continue
            there, toward = (j, 1.0) if here == i else (i, -1.0)
            if there in place:
                if parent_of.get(here, (None, None))[0] == there:
                    continue
                if parent_of.get(there, (None, None))[0] == here and parent_of[there][1].bend is bend:
                    zones.append((bend, here, there, lo, hi, parent_of[there][1]))
                    continue
                raise SheetRefused(f"the bends join the flats in a ring at {bend.kind} {bend.number}: a sheet folds as a tree, each flat hanging from one bend.")
            fold = _Fold(bend, toward, t)
            place[there] = _times(place[here], fold.trsf)
            shift[there] = shift[here] + fold.flat_shift
            parent_of[there] = (here, fold)
            zones.append((bend, here, there, lo, hi, fold))
            order.append(there)
    loose = [i for i in range(len(panels)) if i not in place]
    if loose:
        middle = panels[loose[0]].center()
        raise SheetRefused(f"a flat at ({_mm(middle.X)}, {_mm(middle.Y)}) joins the rest by no bend: the outline is in pieces.")
    reliefs, tears = _reliefs(panels, zones, relief_size, t)
    pieces, flat_faces = [], []
    for i, panel in enumerate(panels):
        cut = panel
        for one in reliefs.get(i, []):
            cut = cut - one
        for face in _faces(cut):
            pieces.append(("flat", bd.extrude(face, amount=t).moved(bd.Location(TopLoc_Location(place[i])))))
            flat_faces.append(face.moved(bd.Location((float(shift[i][0]), float(shift[i][1]), 0))))
    lines = []
    for bend, here, _, lo, hi, fold in zones:
        pieces.append(("bend", fold.zone(lo, hi, t).moved(bd.Location(TopLoc_Location(place[here])))))
        flat_faces.append(fold.flat_zone(lo, hi).moved(bd.Location((float(shift[here][0]), float(shift[here][1]), 0))))
        middle = (-bend.setback + bend.allowance / 2) * fold.toward
        a = bend.line.at(lo, middle) + shift[here]
        b = bend.line.at(hi, middle) + shift[here]
        lines.append({"bend": bend, "from": (float(a[0]), float(a[1])), "to": (float(b[0]), float(b[1])), "angle": bend.angle, "radius": bend.radius})
    clashes = _clashes(pieces)
    solids = [shape for _, shape in pieces]
    joined = solids[0].fuse(*solids[1:]).clean() if len(solids) > 1 else solids[0]
    part = bd.Part(joined.solids())
    flat = bd.Part(bd.extrude(_union(flat_faces), amount=t).solids())
    part.flat = flat
    part.bend_lines = [{key: one[key] for key in ("from", "to", "angle", "radius")} for one in lines]
    _say(part, flat, t, bends, lines, reliefs, tears, clashes)
    return part


def _reliefs(panels, zones, size, t):
    """
    The reliefs each flat needs, as faces to cut from it, and the bend ends
    left without one: a bend whose flat goes on past its end, beside the bend,
    would tear there.
    """
    cuts, tears = {}, []
    for bend, here, there, lo, hi, fold in zones:
        line = bend.line
        for end, outward in ((lo, -1.0), (hi, 1.0)):
            for index, side in ((here, -fold.toward), (there, fold.toward)):
                probe = line.at(end + outward * min(0.05, t / 4), side * bend.setback / 2)
                if not _inside(panels[index], probe):
                    continue
                where = line.at(end)
                if size is None:
                    tears.append((bend, where))
                    continue
                width, depth = size
                reach = bend.setback + depth
                u0, u1 = sorted((end, end + outward * width))
                s0, s1 = sorted((0.0, side * reach))
                cuts.setdefault(index, []).append(_rectangle(line.start, line.along, line.across, u0, u1, s0, s1))
    return cuts, tears


def _clashes(pieces):
    """Where two folded flats or bends of the sheet lie in each other, as flanges meeting at a corner with no gap do."""
    found = []
    boxes = [shape.bounding_box() for _, shape in pieces]
    for i in range(len(pieces)):
        for j in range(i + 1, len(pieces)):
            a, b = boxes[i], boxes[j]
            if any(tuple(a.max)[k] < tuple(b.min)[k] or tuple(b.max)[k] < tuple(a.min)[k] for k in range(3)):
                continue
            shared = pieces[i][1] & pieces[j][1]
            volume = shared.volume if shared is not None else 0.0
            if volume > 1e-3:
                found.append((volume, shared.center()))
    return found


def _say(part, flat, t, bends, lines, reliefs, tears, clashes):
    box = flat.bounding_box()
    radii = sorted({b.radius for b in bends})
    ks = sorted({round(b.k, 3) for b in bends})
    said = [
        f"sheet: {_mm(t)} mm thick, {len(lines)} {'bend' if len(lines) == 1 else 'bends'}"
        + (f", inside radius {' and '.join(_mm(r) for r in radii)} mm, K {' and '.join(f'{k:g}' for k in ks)}" if bends else "")
        + f"; the flat pattern is {_mm(box.max.X - box.min.X)} × {_mm(box.max.Y - box.min.Y)} mm, from ({_mm(box.min.X)}, {_mm(box.min.Y)}) to ({_mm(box.max.X)}, {_mm(box.max.Y)})"
        + f"; the part is {' × '.join(_mm(v) for v in tuple(part.bounding_box().size))} mm, {'a valid solid' if part.is_valid else 'not a valid solid'}."
    ]
    if lines:
        said.append(
            "Bend lines on the flat pattern: "
            + "; ".join(
                f"{one['bend'].kind} {one['bend'].number} {_where(one['from'])} to {_where(one['to'])}, {'up' if one['angle'] > 0 else 'down'} {abs(one['angle']):g}°, allowance {_mm(one['bend'].allowance)} mm"
                for one in lines
            )
            + "."
        )
    count = sum(len(one) for one in reliefs.values())
    if count:
        said.append(f"{count} {'relief' if count == 1 else 'reliefs'} cut where a bend ends inside the sheet.")
    for bend, where in tears[:4]:
        said.append(f"{bend.kind} {bend.number} ends inside the sheet at {_where(where)} with no relief, where the sheet tears as it bends.")
    for volume, at in clashes[:4]:
        said.append(
            f"Two folded flats of the sheet run into each other by {_mm(volume)} mm³ at ({_mm(at.X)}, {_mm(at.Y)}, {_mm(at.Z)}), as flanges meeting at a corner do: draw one of them shorter there by the thickness and a gap."
        )
    said.append("Show part.flat as a part of its own, apart from the bent part, and draw its top view to a .dxf with cad_draw for cutting.")
    notes.say(" ".join(said))
