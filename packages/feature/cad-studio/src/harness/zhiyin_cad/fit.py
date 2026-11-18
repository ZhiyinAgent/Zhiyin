"""
Whether a part goes into its place along a way without meeting the parts it
goes into or past: an axle through its bores, a lid onto its box, a pin into
its hole, a drawer into its slot. The part starts clear of them, or as far
out as the travel asked, and moves along the way to where the script showed
it.

Where it would first meet one is found on the parts' meshes, as an exploded
view finds a way out: from every corner of each mesh and points along its
edges, a ray along the way the part moves against the other; the first that
enters the other's surface is where they meet. A part that only touches
another, or slides along it, does not meet it. How far it would go into it
is the thickness of the material they would share, cut exactly by the
kernel at positions past where they meet. How near it passes is measured
square to the way, between points of the two meshes that pass each other as
it goes, so a pin's clearance in its bore is what it reads, never the gap
above a seat it comes down onto. At its place, whether it touches or
overlaps each part is measured exactly.
"""

import build123d as bd
import numpy
from OCP.BRepExtrema import BRepExtrema_DistShapeShape
from scipy.spatial import cKDTree

from .explode import CHUNK, _basis, _Mesh
from .words import mm as _mm
from .words import point as _point
from .words import way as _way

# How much further out than clear of the parts it goes into a part starts, in mm.
START = 1.0
# How far apart the points along the meshes' edges lie for the clearance on the way, in mm.
STEP = 0.1
# How far to the side of the way the clearance is looked for, in mm, at least.
REACH = 2.0
# How far past where it meets the shared material is cut, in mm: a thin wall's
# or a short head's overlap is found near the start, a broad one further on.
PAST = (0.2, 0.5, 1.0, 2.0, 5.0)
# Shared material smaller than this, in mm³, is the kernel's own error.
SPECK = 1e-6


def gap(a, b):
    """
    The least distance between two shapes, measured exactly, the kernel's
    search shared among the processor's threads; None when it finds none.
    """
    found = BRepExtrema_DistShapeShape()
    found.SetMultiThread(True)
    found.LoadS1(a.wrapped if hasattr(a, "wrapped") else a)
    found.LoadS2(b.wrapped if hasattr(b, "wrapped") else b)
    found.Perform()
    return found.Value() if found.IsDone() else None


def _entries(facing, points, tolerance):
    """
    How far each point goes along the facing's way before it enters one of
    its triangles, lying in its shadow further than `tolerance` from its
    edges, as `_Facing.entered` asks; infinite for one that enters none.
    """
    found = numpy.full(len(points), numpy.inf)
    if facing.empty or not len(points):
        return found
    flat = facing.flat(points)
    near = numpy.flatnonzero(numpy.all((flat >= facing.low - tolerance) & (flat <= facing.high + tolerance), axis=1))
    for begin in range(0, len(near), CHUNK):
        chosen = near[begin : begin + CHUNK]
        p3, p2 = points[chosen], flat[chosen]
        at = numpy.floor((p2 - facing.low) / facing.cell).astype(numpy.int64)
        valid = (at[:, 0] >= 0) & (at[:, 1] >= 0) & (at[:, 0] < facing.columns)
        keys = numpy.where(valid, at[:, 1] * facing.columns + at[:, 0], -1)
        depth = p3 @ facing.way
        starts = numpy.searchsorted(facing.sorted, keys * facing.span, side="left")
        short = numpy.minimum(facing.furthest - (depth - tolerance), facing.span - 1)
        counts = numpy.where(valid & (short >= 0), numpy.searchsorted(facing.sorted, keys * facing.span + short, side="right") - starts, 0)
        total = int(counts.sum())
        if not total:
            continue
        which = numpy.repeat(numpy.arange(len(chosen)), counts)
        taken = facing.triangle[numpy.repeat(starts, counts) + numpy.arange(total) - numpy.repeat(numpy.cumsum(counts) - counts, counts)]
        p = p2[which]
        pa, pb, pc = facing.fa[taken], facing.fb[taken], facing.fc[taken]
        twice = (pb[:, 0] - pa[:, 0]) * (pc[:, 1] - pa[:, 1]) - (pb[:, 1] - pa[:, 1]) * (pc[:, 0] - pa[:, 0])
        sign = numpy.sign(twice)
        hit = numpy.ones(len(p), dtype=bool)
        for (q, r), length in zip(((pb, pc), (pc, pa), (pa, pb)), facing.edges):
            part = ((q[:, 0] - p[:, 0]) * (r[:, 1] - p[:, 1]) - (q[:, 1] - p[:, 1]) * (r[:, 0] - p[:, 0])) * sign
            hit &= part / length[taken] > tolerance
        if not hit.any():
            continue
        which, taken = which[hit], taken[hit]
        distance = numpy.einsum("ij,ij->i", facing.n[taken], facing.a[taken] - p3[which]) / facing.denominator[taken]
        ahead = distance >= -tolerance
        numpy.minimum.at(found, chosen[which[ahead]], numpy.maximum(distance[ahead], 0.0))
    return found


def _meets(mover, other, way, travel):
    """
    Where the mover, starting `travel` back from its place and moving along
    `way` to it, first meets the other: how far short of its place, and the
    point on the other where they meet; None when it reaches its place
    without meeting it.
    """
    tolerance = 2 * max(mover.tolerance, other.tolerance)
    back = travel * way
    ours = numpy.concatenate([mover.corners, mover.edge_points]) - back
    theirs = numpy.concatenate([other.corners, other.edge_points])
    # The mover's points into the other's surface, and the other's, moving against it, into the mover's as it starts.
    forward = _entries(other.facing(way), ours, tolerance)
    backward = _entries(mover.facing(-way), theirs + back, tolerance)
    first = min(float(forward.min(initial=numpy.inf)), float(backward.min(initial=numpy.inf)))
    if first > travel - 1e-9:
        return None
    if forward.min(initial=numpy.inf) <= backward.min(initial=numpy.inf):
        k = int(forward.argmin())
        where = ours[k] + first * way
    else:
        where = theirs[int(backward.argmin())]
    return travel - first, where


def _sampled(mesh, low, high, levels, way, u, v):
    """
    Points of a mesh's corners and along its edges, STEP apart, whose
    shadow along the way lies within `low` and `high` and whose height
    along it within `levels`: each as its shadow and its height.
    """
    corners, triangles = mesh.corners, mesh.triangles
    flat = numpy.stack([corners @ u, corners @ v], axis=1)
    height = corners @ way
    keep = numpy.all((flat >= low) & (flat <= high), axis=1) & (height >= levels[0]) & (height <= levels[1])
    edges = numpy.unique(numpy.sort(numpy.concatenate([triangles[:, [0, 1]], triangles[:, [1, 2]], triangles[:, [2, 0]]]), axis=1), axis=0)
    start, end = flat[edges[:, 0]], flat[edges[:, 1]]
    rising, falling = height[edges[:, 0]], height[edges[:, 1]]
    # An edge whose box of shadow and heights meets the ones asked.
    near = (
        numpy.all(numpy.minimum(start, end) <= high, axis=1)
        & numpy.all(numpy.maximum(start, end) >= low, axis=1)
        & (numpy.minimum(rising, falling) <= levels[1])
        & (numpy.maximum(rising, falling) >= levels[0])
    )
    start, end, rising, falling = start[near], end[near], rising[near], falling[near]
    length = numpy.sqrt(((end - start) ** 2).sum(axis=1) + (falling - rising) ** 2)
    counts = numpy.maximum(numpy.ceil(length / STEP).astype(numpy.int64) - 1, 0)
    which = numpy.repeat(numpy.arange(len(counts)), counts)
    offsets = numpy.arange(int(counts.sum())) - numpy.repeat(numpy.cumsum(counts) - counts, counts)
    share = ((offsets + 1) / (counts[which] + 1))[:, None] if len(which) else numpy.empty((0, 1))
    shadows = numpy.concatenate([flat[keep], start[which] + (end[which] - start[which]) * share])
    heights = numpy.concatenate([height[keep], rising[which] + (falling[which] - rising[which]) * share[:, 0]])
    return shadows, heights


def _passing(mover, other, way, travel, reach):
    """
    The least distance square to the way between a point of the mover and
    a point of the other it passes as it moves `travel` along `way` out of
    its place, and the other's point; None when none passes within `reach`.
    """
    u, v = _basis(way)
    tolerance = 2 * max(mover.tolerance, other.tolerance)

    def span(mesh):
        flat = numpy.stack([mesh.corners @ u, mesh.corners @ v], axis=1)
        height = mesh.corners @ way
        return flat.min(axis=0), flat.max(axis=0), float(height.min()), float(height.max())

    low, high, bottom, top = span(mover)
    # The other's points the mover's shadow passes near, at heights it passes.
    theirs, at = _sampled(other, low - reach, high + reach, (bottom + tolerance, top + travel), way, u, v)
    if not len(theirs):
        return None
    ours, level = _sampled(mover, theirs.min(axis=0) - reach, theirs.max(axis=0) + reach, (float(at.min()) - travel, float(at.max()) - tolerance), way, u, v)
    if not len(ours):
        return None
    best = None
    # Each of the other's points against the mover's nearest, and each of the mover's against the other's: a pair counts when the mover's point reaches the other's height on the way.
    for queried, heights, against, their_heights, flip in ((theirs, at, ours, level, False), (ours, level, theirs, at, True)):
        tree = cKDTree(against)
        distance, index = tree.query(queried, k=min(16, len(against)), distance_upper_bound=reach)
        distance, index = distance.reshape(len(queried), -1), index.reshape(len(queried), -1)
        found = numpy.isfinite(distance)
        rows, columns = numpy.nonzero(found)
        if not len(rows):
            continue
        rise = their_heights[index[rows, columns]] - heights[rows]
        rise = -rise if not flip else rise
        # The other's height less the mover's, for the pair.
        passes = (rise > tolerance) & (rise <= travel)
        if not passes.any():
            continue
        rows, columns = rows[passes], columns[passes]
        k = int(distance[rows, columns].argmin())
        nearest = float(distance[rows[k], columns[k]])
        if best is None or nearest < best[0]:
            point = queried[rows[k]] if not flip else against[index[rows[k], columns[k]]]
            height = heights[rows[k]] if not flip else their_heights[index[rows[k], columns[k]]]
            best = (nearest, point[0] * u + point[1] * v + height * way)
    return best


def _shared(first, second):
    """The volume two shapes share and how thick it is, solid by solid where their boxes meet."""
    from .measure import _depth, boxes_meet

    pieces = []
    for x in first.solids() or [first]:
        for y in second.solids() or [second]:
            # The kernel's quick boxes, which hold the solids, only to pass over pairs far apart.
            if not boxes_meet(x.bounding_box(optimal=False), y.bounding_box(optimal=False)):
                continue
            common = x.intersect(y)
            if common is None:
                continue
            pieces += [piece for piece in (common if isinstance(common, list) else [common]) if piece.volume > SPECK]
    if not pieces:
        return 0.0, 0.0
    return sum(piece.volume for piece in pieces), _depth(pieces)


def _span(box, way):
    """The least and most of a box's corners along a way."""
    corners = numpy.array([[x, y, z] for x in (box.min.X, box.max.X) for y in (box.min.Y, box.max.Y) for z in (box.min.Z, box.max.Z)])
    along = corners @ way
    return float(along.min()), float(along.max())


def _shadows(first, second, way):
    """Whether two boxes' shadows along a way overlap."""
    u, v = _basis(way)
    for axis in (u, v):
        a, b = _span(first, axis), _span(second, axis)
        if a[1] < b[0] or b[1] < a[0]:
            return False
    return True


def _into(shape, other, way, short):
    """
    How far into the other the mover would go: the thickest material they
    would share, cut at each of PAST beyond where they meet, up to its
    place, until it grows no thicker.
    """
    deepest = 0.0
    for further in PAST:
        if further > short + 1e-9:
            break
        at = short - further
        moved = shape.moved(bd.Location(tuple(float(c) for c in -at * way)))
        _, depth = _shared(moved, other)
        if deepest > 0 and depth < deepest:
            break
        deepest = max(deepest, depth)
    return deepest


def _one(name, shape, others, asked, way):
    """The check of one part going in: its result, and a rank, the worst lowest."""
    least = asked.get("min", 0)
    out = -way
    # The parts whose shadow along the way meets the mover's: only they can be in
    # its way. The kernel's quick boxes hold the parts, so none is passed over.
    box = shape.bounding_box(optimal=False)
    in_way = [(n, s) for n, s in others if _shadows(box, s.bounding_box(optimal=False), out)]
    meshes = {}

    def mesh(key, value):
        if key not in meshes:
            meshes[key] = _Mesh(value)
        return meshes[key]

    mover = mesh(name, shape) if in_way else None
    # Clear of them when its lowest corner along the way out passes their highest: the meshes' corners lie on the parts.
    low = float((mover.corners @ out).min()) if in_way else 0.0
    clear = max((float((mesh(n, s).corners @ out).max()) for n, s in in_way), default=low) - low
    travel = float(asked["travel"]) if asked.get("travel") is not None else max(0.0, clear) + START
    met = None
    for other_name, other in in_way:
        found = _meets(mover, mesh(other_name, other), way, travel)
        if found is not None and (met is None or found[0] > met[0]):
            met = (*found, other_name, other)
    names = ", ".join(n for n, _ in others[:4]) + (f" and {len(others) - 4} more" if len(others) > 4 else "")
    words = f"{name} cannot go in along {_way(way)}"
    if met is not None:
        short, where, other_name, other = met
        depth = _into(shape, other, way, short)
        if depth <= 0:
            said = f"{words}: {_mm(short)} mm short of its place it meets {other_name} at {_point(where)}"
            return {"margin": None, "unit": "", "holds": False, "measured": said}, (0, -float("inf"))
        place = "as it reaches its place" if short < 0.005 else f"{_mm(short)} mm short of its place"
        said = f"{words}: {place} it meets {other_name} at {_point(where)}, and would go {_mm(depth)} mm into it"
        return {"margin": -depth - least, "unit": "mm", "measured": said}, (0, -depth - least)
    # At its place: what it touches, and what it overlaps by less than the meshes find.
    touching = []
    for other_name, other in in_way:
        distance = gap(shape, other)
        if distance is None or distance > 1e-6:
            continue
        volume, depth = _shared(shape, other)
        if volume > SPECK:
            said = f"{words}: at its place it overlaps {other_name}, {_mm(depth)} mm into it"
            return {"margin": -depth - least, "unit": "mm", "measured": said}, (0, -depth - least)
        touching.append(other_name)
    reach = max(REACH, 2 * least)
    nearest = None
    for other_name, other in in_way:
        found = _passing(mover, mesh(other_name, other), out, travel, reach)
        if found is not None and (nearest is None or found[0] < nearest[0]):
            nearest = (found[0], other_name)
    said = f"{name} goes in along {_way(way)} from {_mm(travel)} mm out without meeting {names}"
    if nearest is not None:
        said += f"; it passes {nearest[1]} {_mm(nearest[0])} mm apart at the least"
    else:
        said += f"; nothing comes within {_mm(reach)} mm of it to the side on the way"
    if touching:
        said += f", and sits against {'it' if nearest is not None and touching == [nearest[1]] else ', '.join(touching)} at its place"
    if nearest is None:
        holds = reach >= least
        return {"margin": None, "unit": "", "holds": holds, "measured": said}, (1, reach - least)
    margin = nearest[0] - least
    return {"margin": margin, "unit": "mm", "measured": said}, (1 if margin >= 0 else 0, margin)


def inserted(parts, asked):
    """
    An insert requirement checked on the parts shown: each part it names
    going into its place along `along`, from clear of the parts `into`
    names, or of every other part, or from `travel` out. The worst is said.
    """
    from .requirements import _parts, _Unchecked

    way = numpy.array(asked["along"], dtype=float)
    way /= numpy.linalg.norm(way)
    movers = _parts(parts, asked["part"], "part")
    named = _parts(parts, asked["into"], "into") if asked.get("into") else None
    worst = None
    for name, shape in movers:
        others = [(n, s) for n, s in (named if named is not None else parts) if n != name]
        if not others:
            continue
        result, rank = _one(name, shape, others, asked, way)
        if worst is None or rank < worst[0]:
            worst = (rank, result)
    if worst is None:
        raise _Unchecked("it names no part to go into another")
    return worst[1]
