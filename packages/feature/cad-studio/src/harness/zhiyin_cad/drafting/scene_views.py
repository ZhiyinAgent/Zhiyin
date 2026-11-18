"""
The views of a drawing of a Blender scene, from the lines Blender's Line Art
found of it (ADR 0022): the same views the parts' exact shapes give, so a
scene is laid out, dimensioned and written as a part is.

Line Art gives each view as strokes, runs of points along the edges it found,
seen or behind. Its strokes go round corners and back on themselves, and an
edge often comes twice, or in pieces; a round edge comes as the many short
straight sides of the mesh it was modelled with. Each stroke is cut at its
corners into straight runs, which become lines, and turning runs, which
become an arc or a circle when they lie on one. Lines on one line are joined,
arcs of one circle are joined, and what is behind is left out where it lies
under what is seen. A mesh knows no round faces, so a scene's views have no
centre lines along round faces seen side on, and do not tell holes from pins.
"""

import math

import build123d as bd

from . import nearby, revolved, views

# A turn sharper than this, in degrees, is a corner: a round edge modelled
# with as few as twelve sides turns less at each.
CORNER = 31.0
# Points turning less than this, in degrees, run straight on.
STRAIGHT = 0.5
# How far a point may lie from a line or circle and be on it: Line Art's
# points are the mesh's own, kept to the thousandth of a millimetre.
NEAR = 0.01
# A round edge's points lie on its circle to within this share of its radius:
# a sphere's outline is the mesh's, which lies a little inside the sphere.
ROUND = 0.01
# Circles fitted to one edge's pieces agree to within this share of their
# radius; two edges a chamfer or a wall apart, as a table top's, do not.
SAME_CIRCLE = 0.0002
# Lines shorter than this many times NEAR are slivers left where Line Art
# split an edge at what passes in front of it, not edges.
SLIVER = 5


def _turn(a, b, c):
    """How far a run turns at b, in degrees, and which way: positive is anticlockwise."""
    u = (b[0] - a[0], b[1] - a[1])
    v = (c[0] - b[0], c[1] - b[1])
    return math.degrees(math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1]))


def _deduped(points, near):
    kept = []
    for point in points:
        point = (float(point[0]), float(point[1]))
        if not kept or math.dist(kept[-1], point) > near:
            kept.append(point)
    return kept


def _pieces(points, near):
    """A stroke cut at its corners into runs that go one way."""
    points = _deduped(points, near)
    if len(points) < 2:
        return []
    pieces, current = [], [points[0], points[1]]
    for c in points[2:]:
        if abs(_turn(current[-2], current[-1], c)) > CORNER:
            pieces.append(current)
            current = [current[-1]]
        current.append(c)
    pieces.append(current)
    return pieces


def _off_line(points):
    a, b = points[0], points[-1]
    length = math.dist(a, b)
    if length < 1e-12:
        return max(math.dist(a, p) for p in points)
    return max(abs((p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])) / length for p in points)


def _fit_circle(points):
    """The circle nearest a run of points, by least squares, as (cx, cy, r), or nothing."""
    n = len(points)
    mx = sum(p[0] for p in points) / n
    my = sum(p[1] for p in points) / n
    suu = suv = svv = suuu = svvv = suvv = svuu = 0.0
    for x, y in points:
        u, v = x - mx, y - my
        suu += u * u
        suv += u * v
        svv += v * v
        suuu += u * u * u
        svvv += v * v * v
        suvv += u * v * v
        svuu += v * u * u
    det = suu * svv - suv * suv
    if abs(det) < 1e-18:
        return None
    bu = (suuu + suvv) / 2
    bv = (svvv + svuu) / 2
    uc = (bu * svv - bv * suv) / det
    vc = (bv * suu - bu * suv) / det
    cx, cy = mx + uc, my + vc
    r = math.sqrt(uc * uc + vc * vc + (suu + svv) / n)
    return cx, cy, r


def _on_circle(points, near):
    """The circle a turning run lies on, if it turns one way and lies on one."""
    if len(points) < 4:
        return None
    turns = [_turn(a, b, c) for a, b, c in zip(points, points[1:], points[2:])]
    if any(t > 0 for t in turns) and any(t < 0 for t in turns):
        return None
    circle = _fit_circle(points)
    if circle is None:
        return None
    cx, cy, r = circle
    if r > 1e6 or r < near:
        return None
    off = max(abs(math.dist((cx, cy), p) - r) for p in points)
    if off <= max(near, ROUND * r):
        return cx, cy, r, sum(turns) > 0, off
    return None


def _runs(piece):
    """
    A run that goes one way, split where it goes from straight on to turning
    or back, at the point where it changes, which both runs share. A turning
    run may so begin or end with a straight side tangent to it.
    """
    if len(piece) < 3:
        return [piece]
    bends = [abs(_turn(a, b, c)) >= STRAIGHT for a, b, c in zip(piece, piece[1:], piece[2:])]
    runs, start = [], 0
    for index in range(1, len(bends)):
        if bends[index] != bends[index - 1]:
            runs.append(piece[start : index + 2])
            start = index + 1
    runs.append(piece[start:])
    return [run for run in runs if len(run) >= 2]


def _round_part(run, near):
    """
    The circle a turning run lies on, with the straight sides at its ends that
    do not, as (circle, sides); or nothing. The whole run when its points lie
    on the circle; else whichever of its ends left off brings the rest nearest
    one, so a short flat after a fillet stays a flat and the fillet keeps its
    radius.
    """
    found = []
    for first, last in ((0, 0), (1, 0), (0, 1), (1, 1)):
        middle = run[first : len(run) - last]
        circle = _on_circle(middle, near)
        if circle is None:
            continue
        sides = ([(run[0], run[1])] if first else []) + ([(run[-2], run[-1])] if last else [])
        if not first and not last and circle[4] <= near:
            return circle[:4], middle, sides
        found.append((circle[4], circle[:4], middle, sides))
    if not found:
        return None
    _, circle, middle, sides = min(found, key=lambda one: one[0])
    return circle, middle, sides


class _Found:
    """What one view's strokes come to on one layer: straight segments, arcs and runs that are neither."""

    def __init__(self):
        self.segments = []
        self.arcs = []  # (cx, cy, r, start°, end°)
        self.runs = []


def _read(strokes, near):
    found = {"visible": _Found(), "hidden": _Found()}
    for layer, points in strokes:
        if layer not in found:
            continue
        into = found[layer]
        for piece in _pieces(points, near):
            for run in _runs(piece):
                if len(run) == 2 or _off_line(run) <= near:
                    if math.dist(run[0], run[-1]) > near:
                        into.segments.append((run[0], run[-1]))
                    continue
                round_part = _round_part(run, near)
                if round_part is None:
                    into.runs.append(run)
                    continue
                (cx, cy, r, anticlockwise), run, sides = round_part
                into.segments += sides
                first = math.degrees(math.atan2(run[0][1] - cy, run[0][0] - cx)) % 360
                last = math.degrees(math.atan2(run[-1][1] - cy, run[-1][0] - cx)) % 360
                turned = sum(abs(_turn(a, b, c)) for a, b, c in zip(run, run[1:], run[2:]))
                # A run back to where it began, having turned all the way, is the whole circle.
                if math.dist(run[0], run[-1]) <= near and turned > 300:
                    into.arcs.append((cx, cy, r, 0.0, 360.0))
                else:
                    into.arcs.append((cx, cy, r, first, last) if anticlockwise else (cx, cy, r, last, first))
    return found


def view_of(name, data, centre):
    """One view of the scene, as the drafting's views are, from what Blender found of it."""
    view = views.View(name, data["look"], data["up"], centre)
    xs = [p[0] for _, points in data["lines"] for p in points] or [0.0]
    ys = [p[1] for _, points in data["lines"] for p in points] or [0.0]
    near = max(NEAR, 1e-6 * max(max(xs) - min(xs), max(ys) - min(ys)))
    found = _read(data["lines"], near)

    seen = views.merged_segments(found["visible"].segments, tolerance=near)
    behind = views.merged_segments(views.uncovered(views.merged_segments(found["hidden"].segments, tolerance=near), seen, near), tolerance=near)

    edges = lambda segments: [[a, b] for a, b in segments if math.dist(a, b) > SLIVER * near]
    view.lines = [("visible", points) for points in edges(seen)] + [("hidden", points) for points in edges(behind)]
    view.lines += [(layer, run) for layer in ("visible", "hidden") for run in found[layer].runs]
    # Arcs fitted to different strokes of one circle come a hair apart.
    view.arcs = views.arcs_uncovered(
        [("visible", *arc) for arc in found["visible"].arcs] + [("hidden", *arc) for arc in found["hidden"].arcs], near, SAME_CIRCLE
    )
    views._join_arc_pieces(view)
    view.circles = []
    listed = nearby.Places(1e-6)
    for layer, cx, cy, r, start, end in view.arcs:
        full = ((end - start) % 360 or 360) >= 359.9
        if not any(math.dist(c[:2], (cx, cy)) < 1e-6 and abs(c[2] - r) < 1e-6 and c[3] == full for c in listed.near((cx, cy))):
            view.circles.append((cx, cy, r, full))
            listed.add((cx, cy), view.circles[-1])
    views._merge_arcs(view)
    # What a dimension can reach: every end, every arc's ends and every centre.
    for _, points in view.lines:
        view.points += [points[0], points[-1]]
    for _, cx, cy, r, start, end in view.arcs:
        if ((end - start) % 360 or 360) < 359.9:
            view.points += [
                (cx + r * math.cos(math.radians(angle)), cy + r * math.sin(math.radians(angle))) for angle in (start, end)
            ]
        view.points.append((cx, cy))
    # A cut face's outline and its holes' are hatched together, by the even-odd rule.
    cut = {}
    for index, polygon in data.get("cut") or []:
        cut.setdefault(index, []).append([(float(x), float(y)) for x, y in polygon])
    view.cut = sorted(cut.items())
    return view


class Scene:
    """What a drawing of a Blender scene is drawn from: the lines Blender found of each view."""

    def __init__(self, lines):
        self.names = list(lines["names"])
        self.centre = tuple(lines["centre"])
        self.found = lines["views"]

    def lines_found(self, spec):
        """How many lines Blender found of a view, or nothing when it drew no such view."""
        data = self.found.get(spec.get("view") or spec.get("section") or spec.get("auxiliary"))
        return len(data["lines"]) if data else None

    def view(self, spec):
        """A straight, angled, auxiliary or section view, as asked; or why it cannot be made."""
        name = spec.get("view") or spec.get("section") or spec.get("auxiliary")
        if "section" in spec:
            unknown = [one for one in spec.get("uncut") or [] if one not in self.names]
            if unknown:
                raise ValueError(
                    f"section {name} leaves {', '.join(unknown)} whole, which the drawing does not show; "
                    f"it shows {', '.join(self.names)}"
                )
        data = self.found.get(name)
        if data is None:
            raise ValueError(f"Blender drew no {name} view")
        if spec.get("hidden") is False:
            # Blender is asked for none; any it found anyway are left out.
            data = {**data, "lines": [stroke for stroke in data["lines"] if stroke[0] != "hidden"]}
        view = view_of(name, data, self.centre)
        if "section" in spec and spec.get("revolved"):
            unknown = [one for one in spec["revolved"] if one not in self.names]
            if unknown:
                raise ValueError(
                    f"section {name} revolves {', '.join(unknown)}, which the drawing does not show; "
                    f"it shows {', '.join(self.names)}"
                )
            faces = [(tuple(t[0:3]), tuple(t[3:6]), tuple(t[6:9])) for t in data.get("revolved") or []]
            revolved.turn_into(view, faces, spec["axis"]["through"], spec["axis"]["along"])
        if "section" in spec and not view.cut:
            # Blender cuts none of the objects a section leaves whole, so
            # with some left whole it cannot tell which the plane passes.
            through = ", ".join(f"{v:g}" for v in spec["through"])
            raise ValueError(
                f"section {name}'s plane through ({through}) cuts no object it does not leave whole; "
                "put it through another, or cut the ones it leaves whole"
                if spec.get("uncut")
                else f"section {name}'s plane through ({through}) cuts no object: it lies beside them; put it through one"
            )
        if "auxiliary" in spec:
            view.facing = bd.Vector(*data["facing"]) if data.get("facing") else None
        return view

    def profile(self, view):
        """A straight or auxiliary view's DXF: what is seen of the scene from it, its visible edges."""
        seen = views.View(view.name, view.look, view.up, view.centre)
        seen.lines = [(layer, points) for layer, points in view.lines if layer == "visible"]
        seen.arcs = [arc for arc in view.arcs if arc[0] == "visible"]
        return seen
