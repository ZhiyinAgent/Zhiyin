"""
Saint-Venant torsion of a plane section that is not round, by Prandtl's
stress function φ solved with finite elements on the section itself.

∇²φ = −2 inside the section, φ = 0 on its outer boundary and a constant on
each hole's, the constant fixed by the hole's circulation, ∮ ∂φ/∂n ds = 2 ×
the hole's area (Timoshenko & Goodier, Theory of Elasticity, §115). The
torsion constant is J = 2∫φ dA + 2 Σ c·A for each hole's constant c and
area A, and the shear under a torque T is T·|∇φ| / J, highest on the
boundary, where |∇φ| is φ's slope across it. With the shear modulus and the
twist per length taken out of φ, J is in mm⁴, and T in N·mm gives MPa.

The section is drawn as polygons with points about a spacing apart and a
triangular lattice of points inside, finer about each small round its
material wraps, as a fillet in an inner corner or a small hole, where shear
gathers; OCC's BRepMesh joins them into triangles, solved as linear
elements. Tying a hole's boundary to one unknown and loading it with twice
the hole's area makes the circulation hold. The slope across the boundary
is read from the boundary points' reactions over their share of it, a few
points together, much closer to the true slope than the elements' own
constant gradients. The highest shear is then solved again with points four
times finer about it, until it changes by no more than SETTLED. At a sharp
inner corner, as a keyway's, the shear has no finite peak: the points
within two spacings of one are left out, and the result says how far that
is.
"""

import math

import numpy
from OCP.BRep import BRep_Builder, BRep_Tool
from OCP.BRepAdaptor import BRepAdaptor_Curve
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeFace, BRepBuilderAPI_MakePolygon, BRepBuilderAPI_MakeVertex
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.BRepTools import BRepTools_WireExplorer
from OCP.GCPnts import GCPnts_AbscissaPoint
from OCP.GeomAbs import GeomAbs_Circle
from OCP.gp import gp_Pln, gp_Pnt
from OCP.IMeshTools import IMeshTools_Parameters
from OCP.TopAbs import TopAbs_INTERNAL, TopAbs_REVERSED
from OCP.TopLoc import TopLoc_Location

# About how many points a section is solved on.
NODES = 4000
# The fewest spacings across a section's mean thickness, twice its area over its perimeter.
ACROSS = 6
# The most points of the even spacing, whatever the section.
MOST = 20000
# How far a boundary turns at a point, toward the material, to be a sharp inner corner.
SHARP = math.radians(30)
# How many spacings from a sharp inner corner the shear is not read.
CLEAR = 2.0
# How many boundary points either side a point's slope is averaged with.
WINDOW = 2
# A round the material wraps, smaller than this many spacings, is solved finer.
SMALL_ROUND = 4.0
# How many points across a small round's radius.
ROUND_POINTS = 6
# How fast the spacing grows away from where it is finer, per unit of distance.
GRADE = 0.25
# How little the highest shear may change, solved finer about it, to be settled.
SETTLED = 0.005
# How many times the highest shear is solved finer about it at most.
REFINE = 3


class Unsolved(Exception):
    """A section the solve cannot take, with why."""


class _Sizes:
    """The spacing wanted at each point: `even` everywhere, finer near each source, growing by GRADE away from it."""

    def __init__(self, even, centres=(), fines=()):
        self.even = even
        self.centres = numpy.array(centres, dtype=float).reshape(-1, 2)
        self.fines = numpy.minimum(numpy.array(fines, dtype=float).reshape(-1), even)

    def __call__(self, points):
        points = numpy.asarray(points, dtype=float).reshape(-1, 2)
        if not len(self.centres):
            return numpy.full(len(points), self.even)
        out = numpy.empty(len(points))
        for k in range(0, len(points), 4000):
            gaps = numpy.linalg.norm(points[k : k + 4000, None, :] - self.centres[None], axis=2)
            out[k : k + 4000] = numpy.minimum(self.even, numpy.min(self.fines[None] + GRADE * gaps, axis=1))
        return out

    def more(self, centres, fines):
        return _Sizes(self.even, numpy.concatenate([self.centres, numpy.array(centres, dtype=float).reshape(-1, 2)]), numpy.concatenate([self.fines, fines]))

    def finest(self):
        return float(self.fines.min()) if len(self.fines) else self.even


def _flat(points, origin, u, w):
    rel = numpy.asarray(points, dtype=float) - origin
    return numpy.stack([rel @ u, rel @ w], axis=1)


def _wire(wire, face, even, origin, u, w):
    """
    A wire's edges in order, each as many points along it, close together,
    in the section's own (u, w), with its circle's centre and radius when it
    is an arc of one.
    """
    edges = []
    explorer = BRepTools_WireExplorer(wire, face)
    while explorer.More():
        edge = explorer.Current()
        if not BRep_Tool.Degenerated_s(edge):
            curve = BRepAdaptor_Curve(edge)
            first, last = curve.FirstParameter(), curve.LastParameter()
            count = min(max(math.ceil(32 * GCPnts_AbscissaPoint.Length_s(curve) / even), 16), 4000)
            params = numpy.linspace(first, last, count + 1)
            if explorer.Orientation() == TopAbs_REVERSED:
                params = params[::-1]
            points = []
            for t in params:
                p = curve.Value(float(t))
                points.append((p.X(), p.Y(), p.Z()))
            circle = None
            if curve.GetType() == GeomAbs_Circle:
                c = curve.Circle()
                circle = (_flat([(c.Location().X(), c.Location().Y(), c.Location().Z())], origin, u, w)[0], c.Radius())
            edges.append((_flat(points, origin, u, w), circle))
        explorer.Next()
    return edges


def _loop(edges, sizes):
    """A wire's points in order, each edge cut where the spacing wanted puts them, its vertices among them."""
    out = []
    for dense, _ in edges:
        steps = numpy.linalg.norm(numpy.diff(dense, axis=0), axis=1)
        along = numpy.concatenate([[0.0], numpy.cumsum(steps)])
        wanted = sizes(dense)
        # How many spacings in, at each dense point.
        counted = numpy.concatenate([[0.0], numpy.cumsum(steps * 2 / (wanted[1:] + wanted[:-1]))])
        n = max(1, math.ceil(counted[-1] - 1e-9))
        at = numpy.interp(numpy.arange(n) * counted[-1] / n, counted, along)
        out.append(numpy.stack([numpy.interp(at, along, dense[:, 0]), numpy.interp(at, along, dense[:, 1])], axis=1))
    loop = numpy.concatenate(out)
    keep = numpy.linalg.norm(loop - numpy.roll(loop, 1, axis=0), axis=1) > sizes.finest() * 1e-6
    return loop[keep]


def _signed_area(loop):
    x, y = loop[:, 0], loop[:, 1]
    return 0.5 * float(numpy.sum(x * numpy.roll(y, -1) - numpy.roll(x, -1) * y))


def _segments(loops):
    starts = numpy.concatenate(loops)
    ends = numpy.concatenate([numpy.roll(loop, -1, axis=0) for loop in loops])
    return starts, ends


def _inside(points, loops):
    """Which points lie inside the section, by the even-odd rule over all its loops."""
    starts, ends = _segments(loops)
    inside = numpy.zeros(len(points), dtype=bool)
    for k in range(0, len(points), 2000):
        p = points[k : k + 2000, None, :]
        a, b = starts[None], ends[None]
        crosses = (a[..., 1] > p[..., 1]) != (b[..., 1] > p[..., 1])
        with numpy.errstate(divide="ignore", invalid="ignore"):
            x = a[..., 0] + (p[..., 1] - a[..., 1]) * (b[..., 0] - a[..., 0]) / (b[..., 1] - a[..., 1])
        inside[k : k + 2000] = (numpy.sum(crosses & (p[..., 0] < x), axis=1) % 2) == 1
    return inside


def _clear(points, loops, distances):
    """Which points lie further than their distance from every boundary segment."""
    starts, ends = _segments(loops)
    along = ends - starts
    lengths = numpy.maximum(numpy.sum(along**2, axis=1), 1e-30)
    clear = numpy.zeros(len(points), dtype=bool)
    for k in range(0, len(points), 1000):
        p = points[k : k + 1000, None, :]
        t = numpy.clip(numpy.sum((p - starts[None]) * along[None], axis=2) / lengths[None], 0, 1)
        nearest = starts[None] + t[..., None] * along[None]
        clear[k : k + 1000] = numpy.min(numpy.sum((p - nearest) ** 2, axis=2), axis=1) > distances[k : k + 1000] ** 2
    return clear


def _lattice(loops, sizes):
    """
    Triangular lattices of points inside the section, each half its spacing
    clear of the boundary: the even spacing where that is wanted, and each
    half as fine again where the spacing wanted is that fine.
    """
    low, high = loops[0].min(axis=0), loops[0].max(axis=0)
    found = []
    spacing = sizes.even
    while True:
        if spacing < sizes.even:
            # Only about the sources finer than this level's coarsest.
            reach = numpy.maximum((1.5 * spacing - sizes.fines) / GRADE, 0)
            near = reach > 0
            if not numpy.any(near):
                break
            box_low = numpy.maximum(low, numpy.min(sizes.centres[near] - reach[near, None], axis=0))
            box_high = numpy.minimum(high, numpy.max(sizes.centres[near] + reach[near, None], axis=0))
        else:
            box_low, box_high = low, high
        rows = numpy.arange(box_low[1], box_high[1] + spacing, spacing * math.sqrt(3) / 2)
        columns = numpy.arange(box_low[0], box_high[0] + spacing, spacing)
        x = columns[None, :] + (numpy.arange(len(rows)) % 2)[:, None] * spacing / 2
        y = numpy.broadcast_to(rows[:, None], x.shape)
        points = numpy.stack([x.ravel(), y.ravel()], axis=1)
        wanted = sizes(points)
        level = (wanted >= 0.75 * spacing) if spacing >= sizes.even else ((wanted >= 0.75 * spacing) & (wanted < 1.5 * spacing))
        points, wanted = points[level], wanted[level]
        inside = _inside(points, loops)
        points, wanted = points[inside], wanted[inside]
        found.append(points[_clear(points, loops, wanted / 2)])
        if 0.75 * spacing <= sizes.finest():
            break
        spacing /= 2
    return numpy.concatenate(found) if found else numpy.zeros((0, 2))


def _polygon(loop):
    make = BRepBuilderAPI_MakePolygon()
    for x, y in loop:
        make.Add(gp_Pnt(float(x), float(y), 0.0))
    make.Close()
    return make.Wire()


def _mesh(loops, inner):
    """The section's triangles: its points as (n, 2) and its triangles as (m, 3) indexes."""
    maker = BRepBuilderAPI_MakeFace(gp_Pln(), _polygon(loops[0]), True)
    for hole in loops[1:]:
        maker.Add(_polygon(hole))
    if not maker.IsDone():
        raise Unsolved("its outline could not be made into a face to solve on")
    face = maker.Face()
    builder = BRep_Builder()
    for x, y in inner:
        vertex = BRepBuilderAPI_MakeVertex(gp_Pnt(float(x), float(y), 0.0)).Vertex()
        # The vertex's place on the face, which the mesher reads it by.
        builder.UpdateVertex(vertex, float(x), float(y), face, 1e-7)
        builder.Add(face, vertex.Oriented(TopAbs_INTERNAL))
    params = IMeshTools_Parameters()
    params.InternalVerticesMode = True
    params.Deflection = 1.0
    params.Angle = 0.5
    BRepMesh_IncrementalMesh(face, params).Perform()
    triangulation = BRep_Tool.Triangulation_s(face, TopLoc_Location())
    if triangulation is None or triangulation.NbTriangles() == 0:
        raise Unsolved("its outline could not be divided into triangles")
    nodes = numpy.array([[triangulation.Node(i).X(), triangulation.Node(i).Y()] for i in range(1, triangulation.NbNodes() + 1)])
    triangles = numpy.array([triangulation.Triangle(i).Get() for i in range(1, triangulation.NbTriangles() + 1)]) - 1
    return nodes, triangles


def _boundary(triangles):
    """The edges only one triangle has, as (k, 2) node indexes."""
    edges = numpy.concatenate([triangles[:, [0, 1]], triangles[:, [1, 2]], triangles[:, [2, 0]]])
    ordered = numpy.sort(edges, axis=1)
    unique, counts = numpy.unique(ordered, axis=0, return_counts=True)
    return unique[counts == 1]


def _rings(edges):
    """The boundary's points in order round each of its loops."""
    beside = {}
    for a, b in edges.tolist():
        beside.setdefault(a, []).append(b)
        beside.setdefault(b, []).append(a)
    if any(len(two) != 2 for two in beside.values()):
        raise Unsolved("its boundary touches itself")
    rings, seen = [], set()
    for start in beside:
        if start in seen:
            continue
        ring, previous, here = [start], None, start
        seen.add(start)
        while True:
            a, b = beside[here]
            following = b if a == previous else a
            if following == start:
                break
            ring.append(following)
            seen.add(following)
            previous, here = here, following
        rings.append(numpy.array(ring))
    return rings


def _conjugate(apply, load, diagonal):
    """K x = load by conjugate gradients, preconditioned by K's diagonal."""
    x = numpy.zeros_like(load)
    r = load.copy()
    z = r / diagonal
    p = z.copy()
    rz = float(r @ z)
    goal = 1e-11 * float(numpy.linalg.norm(load))
    for _ in range(10 * len(load) + 100):
        q = apply(p)
        step = rz / float(p @ q)
        x += step * p
        r -= step * q
        if float(numpy.linalg.norm(r)) < goal:
            return x
        z = r / diagonal
        rz, before = float(r @ z), rz
        p = z + (rz / before) * p
    raise Unsolved("its torsion solve did not settle")


def _turns(loop):
    """How far the loop turns at each of its points, below zero toward the material."""
    before = loop - numpy.roll(loop, 1, axis=0)
    after = numpy.roll(loop, -1, axis=0) - loop
    return numpy.arctan2(before[:, 0] * after[:, 1] - before[:, 1] * after[:, 0], numpy.sum(before * after, axis=1))


def _oriented(loops):
    """The outer loop anticlockwise and each hole clockwise, so the material lies to the left of each."""
    outer = loops[0] if _signed_area(loops[0]) > 0 else loops[0][::-1]
    return [outer] + [hole if _signed_area(hole) < 0 else hole[::-1] for hole in loops[1:]]


def _piece(wires, sizes):
    """A piece of section solved with the spacing wanted: its torsion constant, highest slope and where, whether it has sharp inner corners, and its number of points."""
    loops = _oriented([_loop(edges, sizes) for edges in wires])
    if len(loops[0]) < 3:
        raise Unsolved("its outline is too small to solve on")
    nodes, triangles = _mesh(loops, _lattice(loops, sizes))
    a, b, c = (nodes[triangles[:, k]] for k in range(3))
    areas = 0.5 * ((b[:, 0] - a[:, 0]) * (c[:, 1] - a[:, 1]) - (b[:, 1] - a[:, 1]) * (c[:, 0] - a[:, 0]))
    flip = areas < 0
    triangles[flip] = triangles[flip][:, [0, 2, 1]]
    areas = numpy.abs(areas)
    if numpy.any(areas <= 0):
        raise Unsolved("its triangles include one of no area")
    xy = nodes[triangles]
    bs = numpy.stack([xy[:, 1, 1] - xy[:, 2, 1], xy[:, 2, 1] - xy[:, 0, 1], xy[:, 0, 1] - xy[:, 1, 1]], axis=1)
    cs = numpy.stack([xy[:, 2, 0] - xy[:, 1, 0], xy[:, 0, 0] - xy[:, 2, 0], xy[:, 1, 0] - xy[:, 0, 0]], axis=1)
    stiffness = (bs[:, :, None] * bs[:, None, :] + cs[:, :, None] * cs[:, None, :]) / (4 * areas[:, None, None])
    count = len(nodes)
    loads = numpy.bincount(triangles.ravel(), numpy.repeat(2 * areas / 3, 3), minlength=count)

    edges = _boundary(triangles)
    on = numpy.unique(edges)
    # Each boundary point's loop: the nearest, the outer one first.
    starts, ends = _segments(loops)
    sizes_of = numpy.cumsum([0] + [len(loop) for loop in loops])
    owner = numpy.searchsorted(sizes_of, numpy.arange(len(starts)), side="right") - 1
    loop_of = numpy.empty(len(on), dtype=int)
    along = ends - starts
    lengths = numpy.maximum(numpy.sum(along**2, axis=1), 1e-30)
    for k in range(0, len(on), 500):
        p = nodes[on[k : k + 500]][:, None, :]
        t = numpy.clip(numpy.sum((p - starts[None]) * along[None], axis=2) / lengths[None], 0, 1)
        gaps = numpy.sum((p - (starts[None] + t[..., None] * along[None])) ** 2, axis=2)
        loop_of[k : k + 500] = owner[numpy.argmin(gaps, axis=1)]

    # Unknowns: each inner point its own, each hole's boundary one, the outer boundary held at 0.
    unknown = numpy.full(count, -1)
    inner = numpy.setdiff1d(numpy.arange(count), on)
    unknown[inner] = numpy.arange(len(inner))
    for hole in range(1, len(loops)):
        unknown[on[loop_of == hole]] = len(inner) + hole - 1
    total = len(inner) + len(loops) - 1
    if total == 0:
        raise Unsolved("it is too thin to solve on at this spacing")
    held = unknown >= 0
    load = numpy.bincount(unknown[held], loads[held], minlength=total)
    for hole in range(1, len(loops)):
        load[len(inner) + hole - 1] += 2 * abs(_signed_area(loops[hole]))

    def full(x):
        return numpy.where(held, x[numpy.maximum(unknown, 0)], 0.0)

    def times(values):
        each = numpy.einsum("eij,ej->ei", stiffness, values[triangles])
        return numpy.bincount(triangles.ravel(), each.ravel(), minlength=count)

    def apply(x):
        out = times(full(x))
        return numpy.bincount(unknown[held], out[held], minlength=total)

    corner_nodes = held[triangles.ravel()]
    diagonal = numpy.bincount(unknown[triangles.ravel()][corner_nodes], numpy.einsum("eii->ei", stiffness).ravel()[corner_nodes], minlength=total)
    phi = _conjugate(apply, load, diagonal)
    constant = float(phi @ load)

    # The slope across the boundary at each boundary point: the reactions of
    # the points within WINDOW of it along the boundary over their share of
    # it, which evens out the scatter a single point's reaction has.
    reaction = numpy.abs(times(full(phi)) - loads)
    sides = numpy.linalg.norm(nodes[edges[:, 0]] - nodes[edges[:, 1]], axis=1)
    share = numpy.bincount(edges.ravel(), numpy.repeat(sides / 2, 2), minlength=count)
    slopes = numpy.zeros(count)
    for ring in _rings(edges):
        summed = sum(numpy.roll(reaction[ring], k) for k in range(-WINDOW, WINDOW + 1))
        spread = sum(numpy.roll(share[ring], k) for k in range(-WINDOW, WINDOW + 1))
        slopes[ring] = summed / spread
    slopes = slopes[on]

    # Sharp inner corners: a loop's points where it turns toward the material by more than SHARP.
    corners = numpy.concatenate([loop[_turns(loop) < -SHARP] for loop in loops])
    counted = numpy.ones(len(on), dtype=bool)
    for corner in corners:
        counted &= numpy.linalg.norm(nodes[on] - corner, axis=1) > CLEAR * sizes.even
    if not numpy.any(counted):
        raise Unsolved("its shear could not be read clear of its sharp inner corners")
    k = int(numpy.argmax(numpy.where(counted, slopes, -1.0)))
    return constant, float(slopes[k]), nodes[on][k], bool(len(corners)), count


def _spacing(face):
    """The even spacing a face is solved at: about NODES points, at least ACROSS across its mean thickness, at most MOST."""
    area = face.area
    perimeter = sum(edge.length for edge in face.edges())
    by_count = math.sqrt(2 * area / (math.sqrt(3) * NODES))
    by_thickness = 2 * area / perimeter / ACROSS
    least = math.sqrt(2 * area / (math.sqrt(3) * MOST))
    return max(min(by_count, by_thickness), least)


def _small_rounds(wires, loops, even):
    """Where the spacing is finer from the start: along each small round the material wraps, its radius over ROUND_POINTS."""
    centres, fines = [], []
    for edges in wires:
        for dense, circle in edges:
            if circle is None:
                continue
            middle, radius = circle
            # The material wraps a round whose centre lies outside it, as a fillet in an inner corner or a hole.
            if radius < SMALL_ROUND * even and not _inside(middle[None], loops)[0]:
                picks = dense[numpy.linspace(0, len(dense) - 1, min(len(dense), 32)).astype(int)]
                centres += list(picks)
                fines += [max(radius / ROUND_POINTS, even / 32)] * len(picks)
    return centres, fines


def section(faces, origin, u, w):
    """
    The torsion of a section of plane faces, each piece twisted with the
    others: its torsion constant J in mm⁴, its highest shear per N·mm of
    torque in MPa and the point it is at, how far about its sharp inner
    corners was left out (None with none), how many points its last solve
    had, and how much its highest shear changed the last time it was solved
    finer about it.
    """
    origin = numpy.asarray(origin, dtype=float)
    pieces = []
    for face in faces:
        even = _spacing(face)
        wires = [_wire(face.outer_wire().wrapped, face.wrapped, even, origin, u, w)]
        wires += [_wire(wire.wrapped, face.wrapped, even, origin, u, w) for wire in face.inner_wires()]
        sizes = _Sizes(even)
        sizes = sizes.more(*_small_rounds(wires, _oriented([_loop(edges, sizes) for edges in wires]), even))
        solved = _piece(wires, sizes)
        change = math.inf
        for _ in range(REFINE):
            sizes = sizes.more([solved[2]], [sizes([solved[2]])[0] / 4])
            again = _piece(wires, sizes)
            change = abs(again[1] - solved[1]) / again[1]
            solved = again
            if change <= SETTLED:
                break
        pieces.append((*solved, even, change))
    constant = sum(piece[0] for piece in pieces)
    top = max(pieces, key=lambda piece: piece[1])
    at = top[2]
    return {
        "J": constant,
        "per_torque": top[1] / constant,
        "at": origin + at[0] * numpy.asarray(u) + at[1] * numpy.asarray(w),
        "sharp": max((CLEAR * piece[5] for piece in pieces if piece[3]), default=None),
        "points": sum(piece[4] for piece in pieces),
        "change": top[6],
    }
