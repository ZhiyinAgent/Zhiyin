"""
Parts a section draws turned into its plane about an axis, as a drawing of a
turbine shows each row of blades whole from hub to tip, rather than the thin
slivers a plane through the row would cut: the convention for blades, spokes
and ribs, which are drawn unhatched.

Each point of a part is turned about the axis into the plane: it keeps how
far along the axis it lies and how far from it, and lands on both sides of
the axis, as the parts round it would. A part's faces, as triangles, so turn
into flat shapes whose union is what the part shows; its outline is where
that union ends, and what lies behind the plane inside it is hidden. A
row's alike blades turn into one shape, drawn once.
"""

import math

from . import views

# Points of the turned shapes closer than this share of their extent are one.
SAME = 1e-7
# A shape's triangle thinner than this share of the extent, squared, has no area.
FLAT = 1e-12
# How finely an edge, and a line that may lie behind the shapes, is followed, as a share of the extent.
STEP = 1 / 400


class Turned:
    """The shapes of parts turned into a section's plane: what they cover, and where that ends."""

    def __init__(self, triangles, through, along, view):
        d = _unit(along)
        look = (view.look.X, view.look.Y, view.look.Z)
        e = _unit(_cross(look, d))
        o = through
        self.origin = view.flat(o)
        self.along = (_dot(d, _vec(view.right)), _dot(d, _vec(view.up)))
        self.out = (_dot(e, _vec(view.right)), _dot(e, _vec(view.up)))
        turned = set()
        for triangle in triangles:
            flat = []
            for p in triangle:
                v = (p[0] - o[0], p[1] - o[1], p[2] - o[2])
                a = _dot(v, d)
                r = math.sqrt(max(0.0, _dot(v, v) - a * a))
                flat.append((a, r))
            turned.add(tuple(sorted(flat)))
        ays = [p for t in turned for p in t]
        self.extent = max(
            max((p[0] for p in ays), default=0) - min((p[0] for p in ays), default=0),
            max((p[1] for p in ays), default=0) - min((p[1] for p in ays), default=0),
            1e-9,
        )
        same = SAME * self.extent
        rounded = {tuple((round(a / same), round(r / same)) for a, r in t) for t in turned}
        self.triangles = [tuple((a * same, r * same) for a, r in t) for t in rounded]
        self.size = self.extent / 256
        self.cells = {}
        for index, t in enumerate(self.triangles):
            if abs(_area(t)) <= FLAT * self.extent**2:
                continue
            for cell in self._cells_of(t):
                self.cells.setdefault(cell, []).append(index)

    def _cells_of(self, t):
        xs, ys = [p[0] for p in t], [p[1] for p in t]
        size = self.size
        return [
            (i, j)
            for i in range(math.floor(min(xs) / size), math.floor(max(xs) / size) + 1)
            for j in range(math.floor(min(ys) / size), math.floor(max(ys) / size) + 1)
        ]

    def covers(self, a, r):
        """Whether the point (a, r) of the plane, along the axis and out from it, lies on a turned shape."""
        cell = (math.floor(a / self.size), math.floor(r / self.size))
        return any(_inside((a, r), self.triangles[i]) for i in self.cells.get(cell, ()))

    def covers_view(self, point):
        """Whether a point of the view lies on a turned shape, on either side of the axis."""
        w = (point[0] - self.origin[0], point[1] - self.origin[1])
        a = w[0] * self.along[0] + w[1] * self.along[1]
        s = w[0] * self.out[0] + w[1] * self.out[1]
        return self.covers(a, abs(s))

    def outline(self):
        """Where the turned shapes end, as segments of (a, r): an edge with them on one side only, or, flat, on neither."""
        edges = set()
        for t in self.triangles:
            for p, q in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0])):
                if p != q:
                    edges.add((p, q) if p < q else (q, p))
        off = 1e-6 * self.extent
        step = self.extent * STEP
        found = []
        for p, q in edges:
            length = math.dist(p, q)
            n = (-(q[1] - p[1]) / length, (q[0] - p[0]) / length)
            pieces = max(1, math.ceil(length / step))
            for k in range(pieces):
                s, e = k / pieces, (k + 1) / pieces
                m = (p[0] + (q[0] - p[0]) * (s + e) / 2, p[1] + (q[1] - p[1]) * (s + e) / 2)
                left = self.covers(m[0] + n[0] * off, m[1] + n[1] * off)
                right = self.covers(m[0] - n[0] * off, m[1] - n[1] * off)
                if left != right or not (left or right):
                    found.append(
                        ((p[0] + (q[0] - p[0]) * s, p[1] + (q[1] - p[1]) * s), (p[0] + (q[0] - p[0]) * e, p[1] + (q[1] - p[1]) * e))
                    )
        return views.merged_segments(found, tolerance=SAME * self.extent * 10)

    def to_view(self, a, r):
        """Where (a, r) lies in the view, on the side of the axis that r's sign says."""
        return (
            self.origin[0] + a * self.along[0] + r * self.out[0],
            self.origin[1] + a * self.along[1] + r * self.out[1],
        )


def turn_into(view, triangles, through, along):
    """
    Draws the parts whose faces are `triangles` turned into a section view's
    plane about the axis through `through` along `along`, both sides of it:
    their outline in sight, and every line behind it hidden where they cover it.
    """
    if not triangles:
        return
    turned = Turned(triangles, through, along, view)
    step = turned.extent * STEP
    kept = []
    for layer, points in view.lines:
        run = []
        for a, b in zip(points, points[1:]):
            pieces = max(1, math.ceil(math.dist(a, b) / step))
            for k in range(pieces):
                s, e = k / pieces, (k + 1) / pieces
                start = (a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s)
                end = (a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e)
                if turned.covers_view(((start[0] + end[0]) / 2, (start[1] + end[1]) / 2)):
                    if len(run) >= 2:
                        kept.append((layer, run))
                    run = []
                    continue
                if not run:
                    run = [start]
                run.append(end)
        if len(run) >= 2:
            kept.append((layer, _straightened(run)))
    outline = [
        [turned.to_view(p[0], side * p[1]), turned.to_view(q[0], side * q[1])]
        for p, q in turned.outline()
        for side in (1, -1)
    ]
    view.lines = kept + [("visible", segment) for segment in outline]
    # Centre lines and round edges behind them are hidden as their edges are.
    view.axes = [
        (start, end)
        for a, b in view.axes
        for start, end in _pieces_clear(turned, a, b, step)
    ]
    view.arcs = [arc for arc in view.arcs if not turned.covers_view(_arc_middle(arc))]
    view.circles = [c for c in view.circles if not (c[3] and turned.covers_view(c[:2]) and turned.covers_view((c[0] + c[2], c[1])))]
    # What a dimension can reach: what is still in sight, and the turned outline's corners.
    view.points = [point for point in view.points if not turned.covers_view(point)] + [
        point for segment in outline for point in segment
    ]


def _pieces_clear(turned, a, b, step):
    """The stretches of the segment ab that no turned shape covers."""
    pieces = max(1, math.ceil(math.dist(a, b) / step))
    clear, start = [], None
    for k in range(pieces + 1):
        t = k / pieces
        point = (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
        middle = None if k == pieces else (a[0] + (b[0] - a[0]) * (t + 0.5 / pieces), a[1] + (b[1] - a[1]) * (t + 0.5 / pieces))
        if middle is not None and not turned.covers_view(middle):
            start = start or point
        elif start is not None:
            clear.append((start, point))
            start = None
    return clear


def _arc_middle(arc):
    _, cx, cy, r, start, end = arc
    middle = math.radians(start + ((end - start) % 360 or 360) / 2)
    return (cx + r * math.cos(middle), cy + r * math.sin(middle))


def _straightened(run):
    """A run of pieces with the points between pieces of one straight line left out."""
    out = [run[0]]
    for point in run[1:]:
        if len(out) >= 2 and abs(_turn(out[-2], out[-1], point)) < 1e-9:
            out[-1] = point
        else:
            out.append(point)
    return out


def _turn(a, b, c):
    return (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])


def _inside(point, t):
    x, y = point
    (ax, ay), (bx, by), (cx, cy) = t
    d1 = (x - bx) * (ay - by) - (ax - bx) * (y - by)
    d2 = (x - cx) * (by - cy) - (bx - cx) * (y - cy)
    d3 = (x - ax) * (cy - ay) - (cx - ax) * (y - ay)
    negative = d1 < 0 or d2 < 0 or d3 < 0
    positive = d1 > 0 or d2 > 0 or d3 > 0
    return not (negative and positive)


def _area(t):
    (ax, ay), (bx, by), (cx, cy) = t
    return ((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2


def _vec(v):
    return (v.X, v.Y, v.Z)


def _dot(u, v):
    return u[0] * v[0] + u[1] * v[1] + u[2] * v[2]


def _cross(u, v):
    return (u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0])


def _unit(v):
    length = math.sqrt(_dot(v, v))
    return (v[0] / length, v[1] / length, v[2] / length)
