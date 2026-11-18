"""
The views of a drawing, in the part's own millimetres, flat: what the eye sees
of the exact shapes from each side, with the edges behind them, worked out by
OpenCASCADE's hidden-line removal. Every view of a drawing is centred on the
same point of the part, so views side by side line up as projection needs.
"""

import math

import build123d as bd
from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.BRepLib import BRepLib
from OCP.BRepTools import BRepTools
from OCP.gp import gp_Ax1, gp_Ax2
from OCP.HLRAlgo import HLRAlgo_Projector
from OCP.HLRBRep import HLRBRep_Algo, HLRBRep_HLRToShape
from OCP.TopAbs import TopAbs_EDGE
from OCP.TopExp import TopExp_Explorer

from . import nearby

# Where each named view looks from, as the direction it looks in and its up.
NAMED = {
    "front": ((0, 1, 0), (0, 0, 1)),
    "back": ((0, -1, 0), (0, 0, 1)),
    "top": ((0, 0, -1), (0, 1, 0)),
    "bottom": ((0, 0, 1), (0, -1, 0)),
    "right": ((-1, 0, 0), (0, 0, 1)),
    "left": ((1, 0, 0), (0, 0, 1)),
    "iso": ((-1, 1, -1), (0, 0, 1)),
}
# How far apart, in mm, hidden-line removal's lines may lie and be in the same place.
SAME_PLACE = 1e-4


def _plain(value):
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, bd.Vector):
        return {"vector": [value.X, value.Y, value.Z]}
    if isinstance(value, tuple):
        return {"tuple": [_plain(one) for one in value]}
    if isinstance(value, list):
        return [_plain(one) for one in value]
    if isinstance(value, View):
        return {"view": value.as_data()}
    if hasattr(value, "item") and not hasattr(value, "__len__"):
        # A numpy number.
        return _plain(value.item())
    raise TypeError(f"a view holds a {type(value).__name__}, which does not cross between runs")


def _unplain(value):
    if isinstance(value, list):
        return [_unplain(one) for one in value]
    if isinstance(value, dict):
        if "vector" in value:
            return bd.Vector(*value["vector"])
        if "tuple" in value:
            return tuple(_unplain(one) for one in value["tuple"])
        if "view" in value:
            return View.from_data(value["view"])
    return value


class View:
    """One view's lines, arcs, cut faces and the points a dimension can reach."""

    def __init__(self, name, look, up, centre):
        self.name = name
        self.look = bd.Vector(look).normalized()
        given_up = bd.Vector(up)
        self.right = self.look.cross(given_up).normalized()
        self.up = self.right.cross(self.look).normalized()
        self.centre = bd.Vector(centre)
        self.lines = []  # (layer, [(x, y), ...])
        self.arcs = []  # (layer, cx, cy, radius, start°, end°)
        self.cut = []  # (part index, [polygon, ...]) for hatching
        self.circles = []  # (cx, cy, radius, full)
        self.points = []  # (x, y)
        self.axes = []  # ((x0, y0), (x1, y1)) centre lines of round faces seen side on
        self.rounds = []  # (cx, cy, radius, hole) round faces seen end on, a hole's hollow
        self.pitch = []  # (cx, cy, radius, start°, end°) gears' pitch circles seen along their axes
        self.pitch_lines = []  # ((x0, y0), (x1, y1)) gears' pitch surfaces seen across their axes
        self.label = None  # a section's or detail's letter

    def as_data(self):
        """
        The view as plain JSON data, to hand to another run: a vector as its
        coordinates and a tuple marked as one, so it reads back as it was.
        Anything else raises TypeError.
        """
        return {key: _plain(value) for key, value in self.__dict__.items()}

    @classmethod
    def from_data(cls, data):
        """A view as `as_data` gave it."""
        view = cls.__new__(cls)
        view.__dict__.update({key: _unplain(value) for key, value in data.items()})
        return view

    def flat(self, point):
        """A point of the part where this view shows it."""
        offset = bd.Vector(point) - self.centre
        return (offset.dot(self.right), offset.dot(self.up))

    def bounds(self):
        window = getattr(self, "window", None)
        if window is not None:
            r = window[2]
            return (-r, -r, r, r)
        xs, ys = [], []
        for _, points in self.lines:
            xs += [p[0] for p in points]
            ys += [p[1] for p in points]
        for _, cx, cy, r, start, end in self.arcs:
            for angle in _sweep_angles(start, end):
                xs.append(cx + r * math.cos(math.radians(angle)))
                ys.append(cy + r * math.sin(math.radians(angle)))
        if not xs:
            return (0.0, 0.0, 0.0, 0.0)
        return (min(xs), min(ys), max(xs), max(ys))


def _sweep_angles(start, end):
    """The ends of an arc, and every quarter it passes, for its bounds."""
    sweep = (end - start) % 360 or 360
    angles = [start, start + sweep]
    quarter = math.ceil(start / 90) * 90
    while quarter < start + sweep:
        angles.append(quarter)
        quarter += 90
    return angles


def _angle(cx, cy, point):
    return math.degrees(math.atan2(point[1] - cy, point[0] - cx)) % 360


def _add_edge(view, edge, layer):
    """One projected edge as a line, an arc or a run of points."""
    start, end = edge.start_point(), edge.end_point()
    if edge.length < 1e-6:
        return
    a, b = (start.X, start.Y), (end.X, end.Y)
    if edge.geom_type == bd.GeomType.LINE:
        view.lines.append((layer, [a, b]))
        view.points += [a, b]
        return
    if edge.geom_type == bd.GeomType.CIRCLE:
        centre = edge.arc_center
        cx, cy, r = centre.X, centre.Y, edge.radius
        if edge.is_closed:
            view.arcs.append((layer, cx, cy, r, 0.0, 360.0))
            view.circles.append((cx, cy, r, True))
        else:
            mid = edge.position_at(0.5)
            s, m, e = _angle(cx, cy, a), _angle(cx, cy, (mid.X, mid.Y)), _angle(cx, cy, b)
            # Counter-clockwise from start to end when the middle lies between them that way.
            if (m - s) % 360 <= (e - s) % 360:
                view.arcs.append((layer, cx, cy, r, s, e))
            else:
                view.arcs.append((layer, cx, cy, r, e, s))
            view.circles.append((cx, cy, r, False))
            view.points += [a, b]
        view.points.append((cx, cy))
        return
    count = max(8, min(400, math.ceil(edge.length / 0.5)))
    samples = [(p.X, p.Y) for p in edge.positions([i / count for i in range(count + 1)])]
    # A curve that is a circle seen face on, as a hole through a round shaft
    # shows, is drawn and measured as one.
    ring = _circle_through(samples)
    if ring is not None:
        cx, cy, r = ring
        closed = math.dist(a, b) < 1e-6 * max(1.0, r)
        if closed:
            view.arcs.append((layer, cx, cy, r, 0.0, 360.0))
            view.circles.append((cx, cy, r, True))
        else:
            s, m, e = _angle(cx, cy, a), _angle(cx, cy, samples[len(samples) // 2]), _angle(cx, cy, b)
            view.arcs.append((layer, cx, cy, r, s, e) if (m - s) % 360 <= (e - s) % 360 else (layer, cx, cy, r, e, s))
            view.circles.append((cx, cy, r, False))
            view.points += [a, b]
        view.points.append((cx, cy))
        return
    # A curve seen edge on, as a hole's circle from the side, is the line it
    # keeps to, so it is joined and covered as a line is.
    line = _straight(samples)
    view.lines.append((layer, list(line) if line is not None else samples))
    view.points += [a, b]


def _straight(points):
    """The segment a run of points keeps to, from end to end of it, or nothing when it bends."""
    first = points[0]
    far = max(points, key=lambda p: math.dist(p, first))
    other = max(points, key=lambda p: math.dist(p, far))
    length = math.dist(far, other)
    if length < 1e-9:
        return None
    ux, uy = (other[0] - far[0]) / length, (other[1] - far[1]) / length
    if any(abs((p[0] - far[0]) * uy - (p[1] - far[1]) * ux) > SAME_PLACE for p in points):
        return None
    return far, other


def _circle_through(points):
    """The circle a run of points lies on, if they lie on one, as (cx, cy, r)."""
    if len(points) < 5:
        return None
    p, q, r = points[0], points[len(points) // 3], points[2 * len(points) // 3]
    d = 2 * (p[0] * (q[1] - r[1]) + q[0] * (r[1] - p[1]) + r[0] * (p[1] - q[1]))
    if abs(d) < 1e-12:
        return None
    sq = lambda v: v[0] ** 2 + v[1] ** 2
    cx = (sq(p) * (q[1] - r[1]) + sq(q) * (r[1] - p[1]) + sq(r) * (p[1] - q[1])) / d
    cy = (sq(p) * (r[0] - q[0]) + sq(q) * (p[0] - r[0]) + sq(r) * (q[0] - p[0])) / d
    radius = math.dist((cx, cy), p)
    if radius < 1e-6 or radius > 1e6:
        return None
    tolerance = max(1e-4, 1e-4 * radius)
    # A run that keeps to its chord, as a sliver of an edge does, lies on any
    # vast circle as well as on its line: it is straight, not an arc.
    (ax, ay), (bx, by) = points[0], points[-1]
    chord = math.hypot(bx - ax, by - ay)
    if chord > 0 and max(abs((bx - ax) * (y - ay) - (by - ay) * (x - ax)) / chord for x, y in points) <= tolerance:
        return None
    if all(abs(math.dist((cx, cy), point) - radius) <= tolerance for point in points):
        return cx, cy, radius
    return None


# How many sections through a part's depth its cutting profile is the union of.
PROFILE_SECTIONS = 32


def profile(name, shapes, look, up, centre):
    """
    What a part fills at some depth along a view, as a laser or a waterjet
    cuts it from a sheet: the union of its sections through its whole depth,
    so its outline is its widest and a hole is only where it goes right
    through, at its narrowest, a countersink's or a chamfer's slope left out.
    Lines, arcs and circles stay so.
    """
    view = View(name, look, up, centre)
    direction = view.look
    depths = [bd.Vector(v).dot(direction) for shape in shapes for v in shape.vertices()]
    low, high = min(depths), max(depths)
    faces = []
    for index in range(PROFILE_SECTIONS):
        depth = low + (high - low) * (index + 0.5) / PROFILE_SECTIONS
        plane = bd.Plane(origin=direction * depth, z_dir=direction)
        for shape in shapes:
            for face in bd.section(shape, plane).faces():
                faces.append(face.moved(bd.Location(direction * (low - depth))))
    if not faces:
        return view
    whole = faces[0].fuse(*faces[1:]).clean() if len(faces) > 1 else faces[0]
    far = max(whole.bounding_box(optimal=False).diagonal, 1.0) * 10
    seen, _, _ = _project(whole, view.centre - view.look * far, view.up, view.centre)
    for edge in seen:
        _add_edge(view, edge, "visible")
    _join_arc_pieces(view)
    _merge_arcs(view)
    return view


def _join_arc_pieces(view):
    """
    Arcs of one circle on one layer, as hidden-line removal gives a hidden
    circle in halves beside the whole, joined into as few as cover the same
    turn, so a hidden circle's dashes run on unbroken.
    """
    groups = {}
    for layer, cx, cy, r, start, end in view.arcs:
        key = (layer, round(cx, 4), round(cy, 4), round(r, 4))
        groups.setdefault(key, (cx, cy, r, []))[3].append((start % 360, (end - start) % 360 or 360))
    joined = []
    for (layer, _, _, _), (cx, cy, r, pieces) in groups.items():
        spans = []
        for start, sweep in pieces:
            end = start + sweep
            spans += [(start, 360.0), (0.0, end - 360)] if end > 360 else [(start, end)]
        spans.sort()
        merged = []
        for start, end in spans:
            if merged and start <= merged[-1][1] + 1e-6:
                merged[-1][1] = max(merged[-1][1], end)
            else:
                merged.append([start, end])
        if sum(end - start for start, end in merged) >= 359.9:
            joined.append((layer, cx, cy, r, 0.0, 360.0))
            continue
        # A span ending at 360 and one starting at 0 are one, across 0.
        if len(merged) > 1 and merged[0][0] <= 1e-6 and merged[-1][1] >= 360 - 1e-6:
            first = merged.pop(0)
            merged[-1][1] = 360 + first[1]
        joined += [(layer, cx, cy, r, start, end % 360 if end > 360 else end) for start, end in merged]
    view.arcs = joined


def _merge_arcs(view):
    """
    Arcs of one circle that go all the way round together, as a hole made in
    halves shows, are that circle too.
    """
    groups = {}
    for _, cx, cy, r, start, end in view.arcs:
        key = (round(cx, 4), round(cy, 4), round(r, 4))
        groups.setdefault(key, []).append((start % 360, (end - start) % 360 or 360))
    whole = nearby.Places(1e-4)
    for circle in view.circles:
        if circle[3]:
            whole.add(circle[:2], circle)
    for (cx, cy, r), arcs in groups.items():
        if any(math.dist(c[:2], (cx, cy)) < 1e-4 and abs(c[2] - r) < 1e-4 for c in whole.near((cx, cy))):
            continue
        pieces = []
        for start, sweep in arcs:
            end = start + sweep
            pieces += [(start, 360.0), (0.0, end - 360)] if end > 360 else [(start, end)]
        pieces.sort()
        covered, reach = 0.0, 0.0
        for start, end in pieces:
            if end > reach:
                covered += end - max(start, reach)
                reach = end
        if covered >= 359.9:
            view.circles.append((cx, cy, r, True))
            whole.add((cx, cy), view.circles[-1])


def _edges(compound):
    """The edges of one of hidden-line removal's results, ready to be read as build123d's."""
    if compound.IsNull():
        return []
    found = []
    explorer = TopExp_Explorer(compound, TopAbs_EDGE)
    while explorer.More():
        edge = bd.Edge(bd.downcast(explorer.Current()))
        BRepLib.BuildCurves3d_s(edge.wrapped, 1e-6)
        found.append(edge)
        explorer.Next()
    return found


def _project(whole, origin, up, look_at):
    """
    The edges seen from `origin` looking at `look_at`, as hidden-line removal
    finds them: sharp edges and outlines seen and behind, and, apart, where
    two faces meet smoothly, as a fillet meets a flat face, seen.
    """
    algorithm = HLRBRep_Algo()
    algorithm.Add(whole.wrapped)
    direction = (bd.Vector(origin) - bd.Vector(look_at)).normalized()
    frame = gp_Ax2()
    frame.SetAxis(gp_Ax1(bd.Vector(origin).to_pnt(), direction.to_dir()))
    frame.SetYDirection(bd.Vector(up).normalized().to_dir())
    algorithm.Projector(HLRAlgo_Projector(frame))
    algorithm.Update()
    algorithm.Hide()
    shapes = HLRBRep_HLRToShape(algorithm)
    seen = _edges(shapes.VCompound()) + _edges(shapes.OutLineVCompound())
    behind = _edges(shapes.HCompound()) + _edges(shapes.OutLineHCompound())
    return seen, behind, _edges(shapes.Rg1LineVCompound())


def projected(name, shapes, look, up, centre, hidden=True):
    """
    A view of the shapes from `look`, its hidden edges dashed if asked. Where
    faces meet smoothly the edge is drawn thin, as ISO 128 draws an imaginary
    line of intersection, and not at all behind.
    """
    view = View(name, look, up, centre)
    whole = shapes[0] if len(shapes) == 1 else bd.Compound(children=list(shapes))
    far = max(whole.bounding_box(optimal=False).diagonal, 1.0) * 10
    seen, behind, smooth = _project(whole, view.centre - view.look * far, view.up, view.centre)
    for edge in seen:
        _add_edge(view, edge, "visible")
    for edge in smooth:
        _add_edge(view, edge, "thin")
    if hidden:
        for edge in behind:
            _add_edge(view, edge, "hidden")
        straight = [points for layer, points in view.lines if layer == "hidden" and len(points) == 2]
        seen = [tuple(points) for layer, points in view.lines if layer == "visible" and len(points) == 2]
        view.lines = [(layer, points) for layer, points in view.lines if not (layer == "hidden" and len(points) == 2)]
        view.lines += [("hidden", list(segment)) for segment in uncovered(merged_segments(straight), seen, SAME_PLACE)]
        view.arcs = arcs_uncovered(view.arcs, SAME_PLACE)
    _join_arc_pieces(view)
    _merge_arcs(view)
    _add_axes(view, shapes, seen_only=not hidden)
    return view


def _is_hole(face, axis):
    """Whether a round face is a hole's, its hollow inside it, and not a pin's or a shaft's."""
    point = face.position_at(0.5, 0.5)
    direction = axis.direction.normalized()
    offset = point - axis.position
    radial = offset - direction * offset.dot(direction)
    return radial.length > 1e-9 and face.normal_at(point).dot(radial) < 0


def _add_axes(view, shapes, seen_only=False):
    """
    Centre lines of round faces seen from their side: holes, pins, shafts
    and a turned part's tapers, which go at least half way round; a fillet's
    quarter turn has none. In a view that draws no hidden edges, as a
    section, only those whose sides it draws. Cylinders seen end on are
    kept, with whether each is a hole.
    """
    for shape in shapes:
        for face in shape.faces():
            if face.geom_type not in (bd.GeomType.CYLINDER, bd.GeomType.CONE):
                continue
            cylinder = face.geom_type == bd.GeomType.CYLINDER
            u0, u1, _, _ = BRepTools.UVBounds_s(face.wrapped)
            if u1 - u0 < math.pi - 1e-6:
                continue
            axis = face.axis_of_rotation
            direction = axis.direction.normalized()
            if abs(abs(direction.dot(view.look)) - 1) < 1e-6:
                if not cylinder:
                    continue
                cx, cy = view.flat(axis.position)
                view.rounds.append((cx, cy, _cylinder_radius(face), _is_hole(face, axis)))
                continue
            if abs(direction.dot(view.look)) > 1e-6:
                continue
            along = [(bd.Vector(v) - axis.position).dot(direction) for v in face.vertices()]
            if not along:
                continue
            ends = [axis.position + direction * t for t in (min(along), max(along))]
            a, b = view.flat(ends[0]), view.flat(ends[1])
            if seen_only and cylinder and not _sides_drawn(view, a, b, _cylinder_radius(face)):
                continue
            if math.dist(a, b) > 1e-6:
                view.axes = merged_segments(view.axes + [(a, b)])


def _cylinder_radius(face):
    """A cylindrical face's radius, a trimmed one's too, for which build123d gives none."""
    return BRepAdaptor_Surface(face.wrapped).Cylinder().Radius()


def _sides_drawn(view, a, b, radius):
    """Whether the view draws, as a visible line, a side of a round face whose axis runs from a to b."""
    length = math.dist(a, b)
    if length < 1e-9:
        return False
    ux, uy = (b[0] - a[0]) / length, (b[1] - a[1]) / length
    tolerance = max(1e-3, 1e-3 * radius)
    for layer, points in view.lines:
        if layer != "visible":
            continue
        for p, q in zip(points, points[1:]):
            dx, dy = q[0] - p[0], q[1] - p[1]
            span = math.hypot(dx, dy)
            if span < 1e-9 or abs(dx * uy - dy * ux) / span > 1e-3:
                continue
            if abs(abs((p[0] - a[0]) * uy - (p[1] - a[1]) * ux) - radius) <= tolerance:
                return True
    return False


def merged_segments(segments, tolerance=1e-4, gap=0.0):
    """
    Straight segments with the pieces that lie on one line and overlap or
    meet, or come within `gap` of meeting, joined into one, so a line found
    twice, or in halves running opposite ways, is drawn once and its dashes
    run on unbroken.
    """
    segments = [(tuple(a), tuple(b)) for a, b in segments]
    # Two that join come within this of each other somewhere along them.
    kept = nearby.Segments(segments, gap + 2 * tolerance)
    for number, (a, b) in enumerate(segments):
        # Each joins the first kept before it that it meets, as often as it meets one.
        joined = True
        while joined:
            joined = False
            for other in kept.near(a, b):
                made = _joined(a, b, *kept.segment(other), tolerance, gap)
                if made is not None:
                    a, b = made
                    kept.remove(other)
                    joined = True
                    break
        kept.add(number, a, b)
    return [kept.segment(number) for number in sorted(kept.kept)]


def _joined(a, b, c, d, tolerance, gap):
    """The one segment ab and cd make, when ab lies along cd and meets or overlaps it; else nothing."""
    length = math.dist(c, d)
    if length < 1e-12:
        return None
    ux, uy = (d[0] - c[0]) / length, (d[1] - c[1]) / length
    off = lambda p: abs((p[0] - c[0]) * uy - (p[1] - c[1]) * ux)
    if off(a) > tolerance or off(b) > tolerance:
        return None
    along = lambda p: (p[0] - c[0]) * ux + (p[1] - c[1]) * uy
    lo, hi = sorted((along(a), along(b)))
    if lo > length + gap + tolerance or hi < -gap - tolerance:
        return None
    start, end = min(0.0, lo), max(length, hi)
    return (c[0] + ux * start, c[1] + uy * start), (c[0] + ux * end, c[1] + uy * end)


# Where a visible and a hidden line fall in the same place, only the visible
# one is drawn (ISO 128): a hole's far circle under its near one, a plate's
# bottom outline under its top.


def uncovered(hidden, visible, near):
    """Hidden segments with the lengths that lie under visible ones, within `near` of them, taken out."""
    # A visible segment that takes any length out of a hidden one comes within `near` of it.
    seen = nearby.Segments(visible, near)
    for number, (c, d) in enumerate(visible):
        seen.add(number, tuple(c), tuple(d))
    out = []
    for a, b in hidden:
        length = math.dist(a, b)
        if length <= near:
            continue
        ux, uy = (b[0] - a[0]) / length, (b[1] - a[1]) / length
        along = lambda p: (p[0] - a[0]) * ux + (p[1] - a[1]) * uy
        off = lambda p: abs((p[0] - a[0]) * uy - (p[1] - a[1]) * ux)
        pieces = [(0.0, length)]
        for c, d in (seen.segment(n) for n in seen.near(a, b)):
            if off(c) > near or off(d) > near:
                continue
            lo, hi = sorted((along(c), along(d)))
            pieces = [p for piece in pieces for p in ((piece[0], min(piece[1], lo)), (max(piece[0], hi), piece[1])) if p[1] - p[0] > near]
        out += [((a[0] + ux * s, a[1] + uy * s), (a[0] + ux * e, a[1] + uy * e)) for s, e in pieces]
    return out


def _turn_of(start, end):
    """An arc's turn as (from, to) degrees, to after from, all the way round for a circle."""
    sweep = (end - start) % 360 or 360
    return start % 360, start % 360 + sweep


def _turns_left(turn, taken):
    """What is left of a turn once the turns `taken` are taken out of it."""
    pieces = [turn]
    for t_lo, t_hi in taken:
        for offset in (-360, 0, 360):
            a, b = t_lo + offset, t_hi + offset
            pieces = [p for piece in pieces for p in ((piece[0], min(piece[1], a)), (max(piece[0], b), piece[1])) if p[1] - p[0] > 1e-3]
    return pieces


def arcs_uncovered(arcs, near, share=0.0):
    """
    The arcs, each (layer, cx, cy, radius, start°, end°), with the turn of
    each hidden arc that a visible arc of its circle covers taken out. Arcs
    whose centres and radii agree to within `near`, or `share` of the radius
    when that is more, are put on one circle. A circle is (…, 0, 360).
    """
    circles = nearby.Places(max([max(near, share * arc[3]) for arc in arcs], default=near))
    placed = []
    for layer, cx, cy, r, start, end in arcs:
        tolerance = max(near, share * r)
        match = next(
            (c for c in circles.near((cx, cy)) if math.dist(c[:2], (cx, cy)) <= tolerance and abs(c[2] - r) <= tolerance),
            None,
        )
        if match is None:
            match = (cx, cy, r)
            circles.add((cx, cy), match)
        placed.append((layer, match, start, end))
    covered = {}
    for layer, circle, start, end in placed:
        if layer == "visible":
            covered.setdefault(circle, []).append(_turn_of(start, end))
    out = []
    for layer, circle, start, end in placed:
        turns = _turns_left(_turn_of(start, end), covered.get(circle, [])) if layer == "hidden" else [(start, end)]
        out += [
            (layer, *circle, 0.0, 360.0) if ((hi - lo) % 360 or 360) >= 359.9 else (layer, *circle, lo % 360, hi % 360)
            for lo, hi in turns
        ]
    return out


def _on_plane(face, normal, through):
    """Whether a face is flat and lies in the plane through `through` square to `normal`."""
    return (
        face.geom_type == bd.GeomType.PLANE
        and abs(abs(face.normal_at().dot(normal)) - 1) <= 1e-6
        and abs((face.center() - bd.Vector(through)).dot(normal)) <= 1e-6
    )


def section(name, shapes, look, up, centre, through, whole=(), turned=(), plain=()):
    """
    A section: what lies beyond a plane through `through`, square to the look,
    with the faces the plane cuts kept to be hatched. Edges behind are not
    drawn, as a section shows them. Parts whose places are in `whole`, as a
    shaft or a pin cut along its length, are drawn whole and not hatched;
    those in `turned` are left to be drawn turned into the plane. The shapes
    in `plain`, as a gear's band of teeth, are cut and drawn but not hatched.
    """
    plane = bd.Plane(origin=through, z_dir=look)
    kept = []
    cut = []
    # Parts whose cut the kernel gives back broken, left out of the section.
    broken = []
    for index, shape in enumerate(shapes):
        if index in turned:
            continue
        if index in whole:
            kept.append(shape)
            continue
        try:
            part = shape.split(plane, keep=bd.Keep.TOP)
        except Exception:
            part = None
        # A part the plane parts into pieces comes back as a list of them.
        if isinstance(part, list):
            pieces = [piece for piece in part if piece is not None]
            part = bd.Compound(children=pieces) if pieces else None
        if part is not None and part.solids():
            # A part the plane only touches, on a face, is kept whole and not cut.
            parted = part.volume < shape.volume * (1 - 1e-9) - 1e-9
            # A cut through a part that folds through itself, or whose faces
            # cross, comes back as no valid solid, its faces wrong or missing:
            # drawn, it would show what is not there.
            if not part.is_valid:
                if parted:
                    broken.append(index)
                    continue
                part = shape
            kept.append(part)
            if parted:
                cut.append((index, part))
    normal = bd.Vector(look).normalized()
    if not cut and broken:
        raise ValueError(
            f"section {name}'s plane through ({', '.join(f'{v:g}' for v in through)}) cuts only parts whose cut the kernel gives back broken, "
            "as a part that folds through itself or whose faces cross gives; put it through another part, or name them in uncut"
        )
    if not cut and whole:
        raise ValueError(
            f"section {name}'s plane through ({', '.join(f'{v:g}' for v in through)}) cuts only parts it leaves whole; "
            "put it through another part, or cut them"
        )
    if not cut:
        touched = any(_on_plane(face, normal, through) for part in kept for face in part.faces())
        raise ValueError(
            f"section {name}'s plane through ({', '.join(f'{v:g}' for v in through)}) cuts no part: "
            + (
                "it lies on a face of the part, and passes through none of it; put it through the part"
                if touched
                else "it lies beside them; put it through the part"
            )
        )
    for shape in plain:
        try:
            part = shape.split(plane, keep=bd.Keep.TOP)
        except Exception:
            continue
        pieces = [piece for piece in part if piece is not None] if isinstance(part, list) else [part] if part is not None else []
        kept += [piece for piece in pieces if piece.solids() and piece.is_valid]
    view = projected(name, kept, look, up, centre, hidden=False)
    view.broken = broken
    # Each part hatched by its place among the parts, so alike in every section.
    for index, part in cut:
        polygons = []
        for face in part.faces():
            if not _on_plane(face, normal, through):
                continue
            for wire in [face.outer_wire(), *face.inner_wires()]:
                # Where the plane runs along a line two walls touch on, the cut
                # face holds a slit: an open wire that encloses nothing.
                if not wire.is_closed:
                    continue
                polygon = []
                for edge in wire.order_edges() if hasattr(wire, "order_edges") else wire.edges():
                    count = max(2, min(200, math.ceil(edge.length / 0.5)))
                    polygon += [view.flat(p) for p in edge.positions([i / count for i in range(count + 1)])]
                if len(polygon) > 2:
                    polygons.append(polygon)
        if polygons:
            view.cut.append((index, polygons))
    if not view.cut:
        raise ValueError(
            f"section {name}'s plane through ({', '.join(f'{v:g}' for v in through)}) cuts no part: "
            "it lies beside them; put it through the part"
        )
    return view


def broken_said(name, parts):
    """Why section `name` leaves out `parts`, the kernel's cut of each broken, and what draws them."""
    them = len(parts) > 1
    listed = parts[0] if not them else f"{', '.join(parts[:-1])} and {parts[-1]}"
    return (
        f"Section {name} leaves out {listed}: the kernel's cut of {'them' if them else 'it'} along its plane is not a valid solid, "
        "as a cut through a part that folds through itself or whose faces cross comes back. "
        f"Name {'them' if them else 'it'} in uncut to draw {'them' if them else 'it'} whole, or check how {'they were' if them else 'it was'} made."
    )


def _clip_segment(a, b, cx, cy, r):
    """The part of a segment inside a circle, or nothing."""
    dx, dy = b[0] - a[0], b[1] - a[1]
    fx, fy = a[0] - cx, a[1] - cy
    qa = dx * dx + dy * dy
    qb = 2 * (fx * dx + fy * dy)
    qc = fx * fx + fy * fy - r * r
    if qa < 1e-18:
        return [a, b] if qc <= 0 else None
    disc = qb * qb - 4 * qa * qc
    if disc <= 0:
        return None
    root = math.sqrt(disc)
    t0, t1 = max(0.0, (-qb - root) / (2 * qa)), min(1.0, (-qb + root) / (2 * qa))
    if t0 >= t1:
        return None
    return [(a[0] + dx * t0, a[1] + dy * t0), (a[0] + dx * t1, a[1] + dy * t1)]


def _clip_run(points, cx, cy, r):
    """A run of points cut to the circle, as the runs left inside it."""
    runs, current = [], []
    for a, b in zip(points, points[1:]):
        inside = _clip_segment(a, b, cx, cy, r)
        if inside is None:
            if len(current) > 1:
                runs.append(current)
            current = []
            continue
        if current and math.dist(current[-1], inside[0]) < 1e-9:
            current.append(inside[1])
        else:
            if len(current) > 1:
                runs.append(current)
            current = list(inside)
        if math.dist(inside[1], b) > 1e-9:
            runs.append(current)
            current = []
    if len(current) > 1:
        runs.append(current)
    return runs


def _inside_arc(ax, ay, r, start, end, cx, cy, radius):
    """
    The parts of an arc inside a circle, as arcs (start°, end°): the whole
    arc where it lies inside, nothing where it lies outside.
    """
    d = math.dist((ax, ay), (cx, cy))
    if d + r <= radius + 1e-9:
        return [(start, end)]
    if d >= r + radius or d + radius <= r:
        return []
    # The arc of the circle inside the window, round the way to the window's middle.
    toward = math.degrees(math.atan2(cy - ay, cx - ax))
    half = math.degrees(math.acos(max(-1.0, min(1.0, (r * r + d * d - radius * radius) / (2 * r * d)))))
    window = ((toward - half) % 360, 2 * half)
    sweep = (end - start) % 360 or 360
    pieces = []
    for a0, a1 in ((start % 360, start % 360 + sweep),):
        for offset in (-360, 0, 360):
            w0, w1 = window[0] + offset, window[0] + window[1] + offset
            lo, hi = max(a0, w0), min(a1, w1)
            if hi - lo > 1e-6:
                pieces.append((lo % 360, (lo % 360) + (hi - lo)))
    return pieces


def _clip_polygon(polygon, cx, cy, radius, sides=180):
    """A polygon cut to a circle, by the circle's many sides, which are all convex."""
    window = [(cx + radius * math.cos(2 * math.pi * i / sides), cy + radius * math.sin(2 * math.pi * i / sides)) for i in range(sides)]
    out = list(polygon)
    for a, b in zip(window, window[1:] + window[:1]):
        inside = lambda p: (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= 0
        given, out = out, []
        for p, q in zip(given, given[1:] + given[:1]):
            if inside(q):
                if not inside(p):
                    out.append(_meet(p, q, a, b))
                out.append(q)
            elif inside(p):
                out.append(_meet(p, q, a, b))
        if not out:
            return []
    return out


def _meet(p, q, a, b):
    """Where line pq crosses line ab."""
    x1, y1, x2, y2, x3, y3, x4, y4 = *p, *q, *a, *b
    d = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
    if abs(d) < 1e-18:
        return q
    t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / d
    return (x1 + t * (x2 - x1), y1 + t * (y2 - y1))


def detail(name, parent, at, radius):
    """What lies inside a circle of another view, to be drawn larger: its lines cut to it, its arcs kept as arcs."""
    cx, cy = parent.flat(at)
    view = View(name, parent.look, parent.up, parent.centre)
    # Drawn round the window's middle, which is where the detail is placed.
    moved = lambda p: (p[0] - cx, p[1] - cy)
    for layer, points in parent.lines:
        for run in _clip_run(points, cx, cy, radius):
            view.lines.append((layer, [moved(p) for p in run]))
    for layer, ax, ay, r, start, end in parent.arcs:
        for s, e in _inside_arc(ax, ay, r, start, end, cx, cy, radius):
            view.arcs.append((layer, ax - cx, ay - cy, r, s, e))
    view.points = [moved(p) for p in parent.points if math.dist(p, (cx, cy)) <= radius]
    # A circle wholly inside is one still; one the window cuts is an arc of it.
    view.circles = []
    for c in parent.circles:
        d = math.dist(c[:2], (cx, cy))
        if d + c[2] <= radius + 1e-6:
            view.circles.append((c[0] - cx, c[1] - cy, c[2], c[3]))
        elif d < c[2] + radius and d + radius > c[2]:
            view.circles.append((c[0] - cx, c[1] - cy, c[2], False))
    for index, polygons in parent.cut:
        clipped = [[moved(p) for p in _clip_polygon(polygon, cx, cy, radius)] for polygon in polygons]
        clipped = [polygon for polygon in clipped if len(polygon) > 2]
        if clipped:
            view.cut.append((index, clipped))
    view.axes = [
        (moved(run[0]), moved(run[1])) for a, b in parent.axes for run in [_clip_segment(a, b, cx, cy, radius)] if run
    ]
    view.rounds = [
        (rx - cx, ry - cy, r, hole) for rx, ry, r, hole in parent.rounds if math.dist((rx, ry), (cx, cy)) + r <= radius + 1e-6
    ]
    view.pitch = [
        (px - cx, py - cy, r, s, e)
        for px, py, r, start, end in getattr(parent, "pitch", [])
        for s, e in _inside_arc(px, py, r, start, end, cx, cy, radius)
    ]
    view.pitch_lines = [
        (moved(run[0]), moved(run[1])) for a, b in getattr(parent, "pitch_lines", []) for run in [_clip_segment(a, b, cx, cy, radius)] if run
    ]
    if not (view.lines or view.arcs or view.circles or view.cut):
        raise ValueError(
            f"detail {name}'s circle round ({', '.join(f'{v:g}' for v in at)}) holds nothing of the {parent.name} "
            "view; put it on the part"
        )
    view.centre = parent.centre + parent.right * cx + parent.up * cy
    view.window = (cx, cy, radius)
    view.parent = parent
    return view
