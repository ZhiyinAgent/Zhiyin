"""
An exploded view of an assembly, worked out from its parts. Parts are taken
out one at a time, each along a way it is free to leave by: the axis of its
own round faces, as a bolt leaves its hole or a valve its guide, an axis of
its inertia, as a coil spring's, or an axis of the assembly. A way is free
when, moved along it as far as it goes, the part meets none of the parts
still in place. That is found on the parts' meshes: from every corner of
the part, and points along its edges, a ray along the way, and from every
corner and edge point of each part in its path, a ray back the other way;
a ray that enters another part's surface ahead of where it starts stops
the part. A part that only touches another, or slides along it, is not
stopped by it, and a part pressed into another is stopped only where it
would enter it again. When no part is free alone, the smallest set that is
free together comes out as one, a part with all that stops it.

Of the parts free at each turn, the one that clears the parts left soonest
is taken out first, so an assembly comes apart from the outside in; a part
mostly round about an axis of its own leaves along it when it can. Each is
moved out past the parts it sits on, in or against, and further by a share
of its own size; a part taken out earlier is moved further out wherever one
taken out after it would pass through where it lies. The assembly sequence
is the reverse: each part goes in, in turn, along the way it came out.
"""

import time

import numpy
from OCP.BRepTools import BRepTools

# How closely a part's mesh keeps to it: a share of its size, within these bounds, in mm.
MESH_SHARE = 2e-4
FINEST, COARSEST = 0.02, 0.2
# How far round, in radians, a facet may turn: finely, so a pin fits its hole on the meshes as it does on the
# part; coarsely for a part so finely detailed, as many coils of wire, that its fine mesh would hold more
# facets than MOST_FACETS, about the angles' ratio squared times its coarse one's.
FINE_ANGLE, COARSE_ANGLE = 0.2, 0.5
MOST_FACETS = 300_000
# How far apart the points along a mesh's edges lie: a share of the part's size, at least this, in mm.
EDGE_SHARE = 1e-2
EDGE_STEP = 0.5
# A triangle more nearly side on than this to a way is one a part slides along, never one it meets.
SIDE_ON = 1e-6
# How many of a part's own round-face axes are tried as ways out, besides the six of the axes.
OWN_AXES = 3
# A part whose round faces about one axis make this share of its surface is mostly round about it.
ROUNDED = 0.6
# Two axes this near in direction are one.
SAME_AXIS = 0.999
# How far beyond what it passes each part is moved, as a share of its own size along its way, by default.
SPREAD = 0.5
# The least a part is moved past what it passes, in mm.
LEAST_GAP = 2.0
# How many rounds of moving parts taken out earlier further out are tried before the layout is given up as crowded.
PUSHES = 50
# Parts this near another, in mm, sit on, in or against it.
NEIGHBOUR = 1.0
# How far round a part's shadow, as a share of its size, the parts it sits in are looked for: a pocket's walls.
GROWN = 0.5
# The most parts that come out together, as a head with its valves.
UNIT_MOST = 24

AXES = [numpy.array(v, dtype=float) for v in ((0, 0, 1), (0, 0, -1), (1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0))]


class _Mesh:
    """A part's surface as triangles facing outward, with the points rays are cast from."""

    def __init__(self, shape):
        box = shape.bounding_box()
        size = max(box.diagonal, 1e-6)
        self.tolerance = min(COARSEST, max(FINEST, size * MESH_SHARE))
        corners, triangles = shape.tessellate(self.tolerance, COARSE_ANGLE)
        if len(triangles) * (COARSE_ANGLE / FINE_ANGLE) ** 2 <= MOST_FACETS:
            # The kernel keeps a mesh fine enough in deflection whatever its angle: cleared, it meshes anew.
            BRepTools.Clean_s(shape.wrapped)
            corners, triangles = shape.tessellate(self.tolerance, FINE_ANGLE)
        BRepTools.Clean_s(shape.wrapped)
        self.corners = numpy.array([tuple(c) for c in corners], dtype=float).reshape(-1, 3)
        self.triangles = numpy.array(triangles, dtype=numpy.int64).reshape(-1, 3)
        a, b, c = (self.corners[self.triangles[:, k]] for k in range(3))
        self.a, self.b, self.c = a, b, c
        self.normals = numpy.cross(b - a, c - a)
        self.low = self.corners.min(axis=0) if len(self.corners) else numpy.zeros(3)
        self.high = self.corners.max(axis=0) if len(self.corners) else numpy.zeros(3)
        self.edge_points = _along_edges(self.corners, self.triangles, max(EDGE_STEP, size * EDGE_SHARE))
        self._facing = {}

    def facing(self, way):
        """Its triangles facing against a way, gridded, made once for each way."""
        key = tuple(numpy.round(way, 9))
        if key not in self._facing:
            self._facing[key] = _Facing(self, way)
        return self._facing[key]


def _along_edges(corners, triangles, step):
    """Points along each edge of the mesh no further apart than `step`, its ends left out."""
    if not len(triangles):
        return numpy.empty((0, 3))
    edges = numpy.concatenate([triangles[:, [0, 1]], triangles[:, [1, 2]], triangles[:, [2, 0]]])
    edges = numpy.unique(numpy.sort(edges, axis=1), axis=0)
    start, end = corners[edges[:, 0]], corners[edges[:, 1]]
    counts = numpy.ceil(numpy.linalg.norm(end - start, axis=1) / step).astype(int) - 1
    chosen = counts > 0
    if not chosen.any():
        return numpy.empty((0, 3))
    start, end, counts = start[chosen], end[chosen], counts[chosen]
    which = numpy.repeat(numpy.arange(len(counts)), counts)
    offsets = numpy.arange(counts.sum()) - numpy.repeat(numpy.cumsum(counts) - counts, counts)
    share = (offsets + 1) / (counts[which] + 1)
    return start[which] + (end[which] - start[which]) * share[:, None]


def _basis(way):
    """Two directions square to a way and to each other."""
    other = numpy.array((1.0, 0, 0)) if abs(way[0]) < 0.9 else numpy.array((0, 1.0, 0))
    u = numpy.cross(way, other)
    u /= numpy.linalg.norm(u)
    return u, numpy.cross(way, u)


class _Facing:
    """
    The triangles of a mesh a point moving along a way can enter, those
    facing against it, with a grid of their shadows along it, so a point is
    tested only against the triangles whose shadow it lies in.
    """

    def __init__(self, mesh, way):
        self.way = way
        self.u, self.v = _basis(way)
        lengths = numpy.linalg.norm(mesh.normals, axis=1)
        facing = mesh.normals @ way < -SIDE_ON * numpy.maximum(lengths, 1e-30)
        self.empty = not facing.any()
        if self.empty:
            return
        self.a, self.n = mesh.a[facing], mesh.normals[facing]
        self.fa, self.fb, self.fc = self.flat(mesh.a[facing]), self.flat(mesh.b[facing]), self.flat(mesh.c[facing])
        self.denominator = self.n @ way
        low = numpy.minimum(numpy.minimum(self.fa, self.fb), self.fc)
        high = numpy.maximum(numpy.maximum(self.fa, self.fb), self.fc)
        self.low, self.high = low.min(axis=0), high.max(axis=0)
        # Cells the size of the middling triangle's shadow: a few large triangles span many cells, and no cell holds many small ones. Larger where that would make too many.
        spans = high - low
        cell = max(float(numpy.median(numpy.maximum(spans[:, 0], spans[:, 1]))), 1e-3)
        while True:
            first = numpy.floor((low - self.low) / cell).astype(numpy.int64)
            last = numpy.floor((high - self.low) / cell).astype(numpy.int64)
            if (last - first + 1).prod(axis=1).sum() <= 4_000_000:
                break
            cell *= 2
        self.cell = cell
        self.columns = int(last[:, 0].max()) + 2
        widths = last - first + 1
        count = widths.prod(axis=1)
        triangle = numpy.repeat(numpy.arange(len(count)), count)
        within = numpy.arange(count.sum()) - numpy.repeat(numpy.cumsum(count) - count, count)
        keys = (first[triangle, 1] + within // widths[triangle, 0]) * self.columns + first[triangle, 0] + within % widths[triangle, 0]
        # Within a cell, the triangles reaching furthest along the way first,
        # as one sorted run: a cell's key times a span longer than any reach,
        # and how far short of the furthest each reaches.
        reach = numpy.maximum(numpy.maximum(mesh.a[facing] @ way, mesh.b[facing] @ way), mesh.c[facing] @ way)
        self.furthest = float(reach.max())
        self.span = 2 * (self.furthest - float(reach.min())) + 1
        order = numpy.lexsort((-reach[triangle], keys))
        self.triangle = triangle[order]
        self.sorted = keys[order] * self.span + (self.furthest - reach[self.triangle])
        # Each edge's length, for how far inside a triangle a point lies.
        self.edges = [numpy.maximum(numpy.linalg.norm(q - r, axis=1), 1e-30) for q, r in ((self.fb, self.fc), (self.fc, self.fa), (self.fa, self.fb))]

    def flat(self, points):
        return numpy.stack([points @ self.u, points @ self.v], axis=-1)

    def entered(self, points, way, tolerance):
        """
        Whether any point, moved along the way, enters a triangle: lies in its
        shadow further than `tolerance` from its edges, as a round part's
        corners on its true surface lie outside the chords of a hole's mesh it
        fits, and meets it ahead of where it starts.
        """
        if self.empty or not len(points):
            return False
        flat = self.flat(points)
        inside = numpy.all((flat >= self.low - tolerance) & (flat <= self.high + tolerance), axis=1)
        if not inside.any():
            return False
        points, flat = points[inside], flat[inside]
        for begin in range(0, len(points), CHUNK):
            if self._entered(points[begin : begin + CHUNK], flat[begin : begin + CHUNK], tolerance):
                return True
        return False

    def _entered(self, points, flat, tolerance):
        at = numpy.floor((flat - self.low) / self.cell).astype(numpy.int64)
        valid = (at[:, 0] >= 0) & (at[:, 1] >= 0) & (at[:, 0] < self.columns)
        keys = numpy.where(valid, at[:, 1] * self.columns + at[:, 0], -1)
        # Only the triangles of its cell that reach at least as far along the way as the point starts.
        depth = points @ self.way
        starts = numpy.searchsorted(self.sorted, keys * self.span, side="left")
        short = numpy.minimum(self.furthest - (depth - tolerance), self.span - 1)
        counts = numpy.where(valid & (short >= 0), numpy.searchsorted(self.sorted, keys * self.span + short, side="right") - starts, 0)
        total = int(counts.sum())
        if not total:
            return False
        which = numpy.repeat(numpy.arange(len(points)), counts)
        taken = self.triangle[numpy.repeat(starts, counts) + numpy.arange(total) - numpy.repeat(numpy.cumsum(counts) - counts, counts)]
        p = flat[which]
        pa, pb, pc = self.fa[taken], self.fb[taken], self.fc[taken]
        twice = (pb[:, 0] - pa[:, 0]) * (pc[:, 1] - pa[:, 1]) - (pb[:, 1] - pa[:, 1]) * (pc[:, 0] - pa[:, 0])
        # Twice the area each edge makes with the point, signed as the triangle's: over the edge's length, how far inside it the point lies.
        sign = numpy.sign(twice)
        hit = numpy.ones(len(p), dtype=bool)
        for (q, r), length in zip(((pb, pc), (pc, pa), (pa, pb)), self.edges):
            part = ((q[:, 0] - p[:, 0]) * (r[:, 1] - p[:, 1]) - (q[:, 1] - p[:, 1]) * (r[:, 0] - p[:, 0])) * sign
            hit &= part / length[taken] > tolerance
        if not hit.any():
            return False
        which, taken = which[hit], taken[hit]
        distance = numpy.einsum("ij,ij->i", self.n[taken], self.a[taken] - points[which]) / self.denominator[taken]
        return bool((distance >= -tolerance).any())


# How many points are tested against a grid at once.
CHUNK = 5000


def _blocked(mover, other, way):
    """Whether `mover`, moved along `way` as far as it goes, meets `other`: a point of it enters `other`, or a point of `other` enters it."""
    tolerance = 2 * max(mover.tolerance, other.tolerance)
    # The corners first: most ways that are blocked are found by them, and only a free way needs the points along the edges too.
    ahead, back = other.facing(way), mover.facing(-way)
    return (
        ahead.entered(mover.corners, way, tolerance)
        or back.entered(other.corners, -way, tolerance)
        or ahead.entered(mover.edge_points, way, tolerance)
        or back.entered(other.edge_points, -way, tolerance)
    )


def _own_axes(shape):
    """The axes of a part's round faces, each with the area of its round faces about it, most first, each axis once."""
    found = []
    for face in shape.faces():
        try:
            kind = face.geom_type.name
        except Exception:  # noqa: BLE001 - a face the kernel cannot name has no axis
            continue
        if kind not in ("CYLINDER", "CONE"):
            continue
        try:
            axis = face.axis_of_rotation
        except Exception:  # noqa: BLE001
            continue
        if axis is None:
            continue
        direction = numpy.array(tuple(axis.direction), dtype=float)
        direction /= numpy.linalg.norm(direction)
        area = face.area
        for one in found:
            if abs(float(one[0] @ direction)) > SAME_AXIS:
                one[1] += area
                break
        else:
            found.append([direction, area])
    found.sort(key=lambda one: -one[1])
    return found


def _principal_axes(shape):
    """A part's axes of inertia, as a coil spring's along its coil: a way out where its faces have no axis of their own."""
    from OCP.BRepGProp import BRepGProp
    from OCP.GProp import GProp_GProps

    props = GProp_GProps()
    try:
        BRepGProp.VolumeProperties_s(shape.wrapped, props)
        principal = props.PrincipalProperties()
        axes = (principal.FirstAxisOfInertia(), principal.SecondAxisOfInertia(), principal.ThirdAxisOfInertia())
        moments = principal.Moments()
    except Exception:  # noqa: BLE001 - a shape with no volume has no axes of inertia
        return []
    found = []
    for k, axis in enumerate(axes):
        # An axis sharing its moment with another is any of a plane's, as a sphere's or a cube's are: no way of its own.
        others = [moments[j] for j in range(3) if j != k]
        if any(abs(moments[k] - other) <= 1e-6 * max(abs(moments[k]), 1e-12) for other in others):
            continue
        direction = numpy.array((axis.X(), axis.Y(), axis.Z()), dtype=float)
        length = numpy.linalg.norm(direction)
        if length > 1e-9:
            found.append(direction / length)
    return found


def _ways(shape):
    """
    The ways a part is tried out along, each both ways: its own round faces'
    axes, most of its round surface first, then its axes of inertia, then
    the three axes, each way once. Answers them with how many of them are
    the part's own, for a part mostly round about them, as a pin, a valve or
    a shaft is, which leaves along them when it can.
    """
    ways = []
    own = _own_axes(shape)[:OWN_AXES]
    surface = sum(face.area for face in shape.faces()) or 1.0
    preferred = 0
    for k, axis in enumerate([direction for direction, _ in own] + _principal_axes(shape) + AXES[::2]):
        if any(abs(float(axis @ known)) > SAME_AXIS for known in ways):
            continue
        ways += [axis, -axis]
        if k < len(own) and own[k][1] >= ROUNDED * surface:
            preferred = len(ways)
    return ways, preferred


def _key(way):
    return tuple(numpy.round(way, 6))


def _span(low, high, way):
    """The least and most of a box's corners along a way."""
    corners = numpy.array([[x, y, z] for x in (low[0], high[0]) for y in (low[1], high[1]) for z in (low[2], high[2])])
    along = corners @ way
    return float(along.min()), float(along.max())


def _shadows_meet(first, second, way):
    """Whether two boxes' shadows along a way overlap."""
    u, v = _basis(way)
    for axis in (u, v):
        a, b = _span(*first, axis), _span(*second, axis)
        if a[1] < b[0] or b[1] < a[0]:
            return False
    return True


def _boxes_near(first, second, reach):
    return bool(numpy.all(first[0] <= second[1] + reach) and numpy.all(second[0] <= first[1] + reach))


class _OutOfTime(Exception):
    """The build's time ran out before the parts were worked out."""


class _Assembly:
    def __init__(self, parts, deadline=None):
        self.deadline = deadline
        self.names = [name for name, _ in parts]
        self.shapes = dict(parts)
        self.meshes = {name: _Mesh(shape) for name, shape in parts}
        self.ways = {}
        self.stopped = {}
        self.paths = {}

    def box(self, names):
        """The box round one part, or round several together."""
        names = [names] if isinstance(names, str) else list(names)
        return (
            numpy.min([self.meshes[name].low for name in names], axis=0),
            numpy.max([self.meshes[name].high for name in names], axis=0),
        )

    def ways_of(self, name):
        if name not in self.ways:
            self.ways[name] = _ways(self.shapes[name])
        return self.ways[name][0]

    def own_ways(self, name):
        """How many of a part's ways, the first, are along the axes it is mostly round about."""
        self.ways_of(name)
        return self.ways[name][1]

    def path(self, name, way):
        """The parts whose boxes lie in a part's path along a way, nearest first."""
        key = (name, _key(way))
        if key not in self.paths:
            box = self.box(name)
            start = _span(*box, way)[0]
            found = []
            for other in self.names:
                if other == name:
                    continue
                theirs = self.box(other)
                low, high = _span(*theirs, way)
                if high < start or not _shadows_meet(box, theirs, way):
                    continue
                found.append((low, other))
            self.paths[key] = [other for _, other in sorted(found)]
        return self.paths[key]

    def blocks(self, name, other, way):
        """Whether `other` stops `name` going along a way: found once, on their meshes."""
        pair = (name, other, _key(way))
        if pair not in self.stopped:
            if self.deadline is not None and time.time() > self.deadline:
                raise _OutOfTime
            self.stopped[pair] = _blocked(self.meshes[name], self.meshes[other], way)
        return self.stopped[pair]

    def stopper(self, name, way, left):
        """The first of the parts `left` that stops a part going along a way, or nothing when none does."""
        for other in self.path(name, way):
            if other in left and self.blocks(name, other, way):
                return other
        return None

    def unit(self, anchor, way, left, movable, most):
        """
        The part with every part that stops it, and every part that stops
        those, going along a way together: none when one of them may not
        move, or when they come to more than `most`.
        """
        unit, frontier = {anchor}, [anchor]
        while frontier:
            member = frontier.pop()
            path = [other for other in self.path(member, way) if other in left and other not in unit]
            # The parts that may not move first: one of them stopping the member ends the search at once.
            for other in sorted(path, key=lambda one: one in movable):
                if not self.blocks(member, other, way):
                    continue
                if other not in movable or len(unit) >= most:
                    return None
                unit.add(other)
                frontier.append(other)
        return unit

    def clearing(self, names, way, left):
        """How far parts go along a way before they are past every part left in their path, by boxes: the outermost first."""
        box = self.box(names)
        start = _span(*box, way)[0]
        furthest = start
        for other in left:
            if other in names:
                continue
            theirs = self.box(other)
            if _shadows_meet(box, theirs, way):
                furthest = max(furthest, _span(*theirs, way)[1])
        return furthest - start

    def past_neighbours(self, names, way, left):
        """
        How far parts go along a way before they are past the parts they sit
        on, in or against: the furthest along the way any corner of those
        reaches within the parts' own shadow, grown by half its size each
        side, so the walls of a pocket count and the far side of a large part
        does not.
        """
        box = self.box(names)
        corners = numpy.concatenate([self.meshes[name].corners for name in names])
        start = float((corners @ way).min())
        u, v = _basis(way)
        flat = numpy.stack([corners @ u, corners @ v], axis=1)
        low, high = flat.min(axis=0), flat.max(axis=0)
        grown = (high - low) * GROWN
        low, high = low - grown, high + grown
        furthest = start
        for other in left:
            if other in names or not _boxes_near(box, self.box(other), NEIGHBOUR):
                continue
            mesh = self.meshes[other]
            theirs = numpy.concatenate([mesh.corners, mesh.edge_points])
            shadow = numpy.stack([theirs @ u, theirs @ v], axis=1)
            within = numpy.all((shadow >= low) & (shadow <= high), axis=1)
            if within.any():
                furthest = max(furthest, float((theirs[within] @ way).max()))
        return max(0.0, furthest - start)


def worked_out(parts, moving, staying, spread=SPREAD, deadline=None):
    """
    How the parts come apart: those in `moving` taken out in turn, those in
    `staying` kept where they are. A part nothing frees alone comes out with
    the parts that stop it, as a cylinder head with its valves. Answers the
    order, each part's way and how far it goes, and the parts kept in with
    why.
    """
    assembly = _Assembly(parts, deadline)
    left = set(assembly.names)
    order = []
    movable = {name for name in assembly.names if name in moving and name not in staying}
    waiting = [name for name in assembly.names if name in movable]
    ran_out = False
    while waiting:
        best = None
        try:
            for name in waiting:
                free = [(index, way) for index, way in enumerate(assembly.ways_of(name)) if assembly.stopper(name, way, left - {name}) is None]
                if not free:
                    continue
                # Along its own axis when that is free, as a valve leaves along its stem; the part out first is the one that clears the rest soonest.
                own = [one for one in free if one[0] < assembly.own_ways(name)]
                travel, index, way = min((round(assembly.clearing([name], way, left), 6), index, way) for index, way in (own or free))
                rank = (travel, assembly.names.index(name), index)
                if best is None or rank < best[0]:
                    best = (rank, [name], way)
            if best is None:
                # No part comes out alone: the smallest set that comes out together.
                for name in waiting:
                    for index, way in enumerate(assembly.ways_of(name)):
                        unit = assembly.unit(name, way, left, set(waiting), UNIT_MOST)
                        if unit is None or len(unit) < 2:
                            continue
                        members = sorted(unit, key=assembly.names.index)
                        rank = (len(unit), round(assembly.clearing(members, way, left), 6), index, assembly.names.index(name))
                        if best is None or rank < best[0]:
                            best = (rank, members, way)
        except _OutOfTime:
            ran_out = True
            break
        if best is None:
            break
        _, members, way = best
        low, high = assembly.box(members)
        size = _span(low, high, way)
        distance = assembly.past_neighbours(members, way, left) + max(LEAST_GAP, spread * (size[1] - size[0]))
        # Named by its largest part by volume, the others with it.
        anchor = max(members, key=lambda name: _volume(assembly.shapes[name]))
        order.append({"part": anchor, "with": [name for name in members if name != anchor], "members": members, "way": way, "distance": distance})
        for name in members:
            waiting.remove(name)
            left.discard(name)
    crowded = _spread_clear(assembly, order)
    kept = []
    for name in waiting:
        if ran_out:
            kept.append({"part": name, "why": "not worked out in the time the build has"})
            continue
        stops = {}
        for way in assembly.ways_of(name):
            # Each way was found blocked, so no part is tested again.
            other = assembly.stopper(name, way, left - {name})
            if other is not None:
                stops[other] = stops.get(other, 0) + 1
        said = ", ".join(f"{other} ({count} {'way' if count == 1 else 'ways'})" for other, count in sorted(stops.items(), key=lambda item: -item[1]))
        kept.append({"part": name, "why": f"every way out is blocked, by {said}" if said else "no way out was found"})
    offsets = {name: one["way"] * one["distance"] for one in order for name in one["members"]}
    return {
        "order": [
            {
                "part": one["part"],
                **({"with": one["with"]} if one["with"] else {}),
                "way": [round(float(v), 4) for v in one["way"]],
                "distance": round(float(one["distance"]), 2),
            }
            for one in order
        ],
        "kept": kept,
        "staying": [name for name in assembly.names if name in staying],
        "crowded": crowded,
        "offsets": offsets,
        "members": [one["members"] for one in order],
    }


def _spread_clear(assembly, order):
    """
    Moves parts taken out earlier further along their ways until none lies
    where a part taken out after it passes; answers the pairs left crossing
    when that does not settle.
    """
    def final(one):
        low, high = assembly.box(one["members"])
        shift = one["way"] * one["distance"]
        return low + shift, high + shift

    def swept(one):
        low, high = assembly.box(one["members"])
        end_low, end_high = final(one)
        return numpy.minimum(low, end_low), numpy.maximum(high, end_high)

    def meet(first, second):
        return bool(numpy.all(first[0] <= second[1]) and numpy.all(second[0] <= first[1]))

    for _ in range(PUSHES):
        moved = False
        for k, later in enumerate(order):
            path = swept(later)
            for earlier in order[:k]:
                lies = final(earlier)
                if not meet(path, lies):
                    continue
                needed = _past(lies, path, earlier["way"])
                if needed is None:
                    continue
                earlier["distance"] += needed
                moved = True
        if not moved:
            return []
    return [
        [earlier["part"], later["part"]]
        for k, later in enumerate(order)
        for earlier in order[:k]
        if meet(swept(later), final(earlier))
    ]


def _past(lies, path, way):
    """How much further along `way` a box lying at `lies` must go to be clear of the box `path`, or nothing if it cannot."""
    best = None
    for axis in range(3):
        step = float(way[axis])
        if abs(step) < 0.05:
            continue
        if step > 0:
            needed = (path[1][axis] + LEAST_GAP - lies[0][axis]) / step
        else:
            needed = (lies[1][axis] - path[0][axis] + LEAST_GAP) / -step
        if needed > 0 and (best is None or needed < best):
            best = needed
    return best


def placed(parts, offsets):
    """The parts moved out as worked out, the rest where they are."""
    import build123d as bd

    return [(name, shape.moved(bd.Location(tuple(float(v) for v in offsets[name]))) if name in offsets else shape) for name, shape in parts]


def sequence(parts, worked):
    """
    The assembly sequence, as positions for the motion file: every part out
    at the first, then each going in, in the reverse of the order they came
    out, the last with all in. Answers the positions and each part's corners
    at each, and its corners as built.
    """
    from . import motion

    built = motion.corners(parts)
    taken = worked["members"]
    named = [one["part"] for one in worked["order"]]
    offsets = worked["offsets"]
    positions, at_each = [], []
    inside = set()
    for step in range(len(taken) + 1):
        if step:
            inside.update(taken[-step])
        positions.append(["all out"] if step == 0 else [f"{named[-step]} in" if len(taken[-step]) == 1 else f"{named[-step]} and {len(taken[-step]) - 1} with it in"])
        at_each.append({name: corners + (0 if name in inside or name not in offsets else offsets[name]) for name, corners in built.items()})
    return positions, at_each, built


def _volume(shape):
    try:
        return float(shape.volume)
    except Exception:  # noqa: BLE001 - a shape with no volume is the smallest
        return 0.0
