"""
A design's requirements, checked on the parts a build shows: each of a fixed
kind, measured here on the exact solids or their meshes, never by code the
model writes. Each answers whether it holds, what was measured, the limit,
and the margin: how far the part is inside the limit, or, below zero, past
it. A requirement whose parts the build did not show is said unchecked.
"""

import math

import numpy
from build123d import CenterOf, Vector
from OCP.gp import gp_Dir, gp_Lin, gp_Pnt
from OCP.IntCurvesFace import IntCurvesFace_ShapeIntersector

from . import fit, patterns, requirements_gears
from . import requirements_making as making
from . import requirements_sheet as sheet
from . import requirements_smooth as smooth
from . import requirements_strength as strength
from . import requirements_walls as walls
from .unchecked import Unchecked as _Unchecked
from .words import listed as _listed
from .words import mm as _mm
from .words import point as _at

# Densities in g/cm³.
DENSITIES = {
    "PLA": 1.24,
    "PETG": 1.27,
    "ABS": 1.04,
    "ASA": 1.07,
    "nylon": 1.14,
    "TPU": 1.21,
    "resin": 1.18,
    "aluminium": 2.70,
    "steel": 7.85,
    "stainless steel": 8.00,
    "cast iron": 7.20,
    "brass": 8.50,
    "copper": 8.96,
    "titanium": 4.43,
    "wood": 0.60,
}
# How finely a part is meshed for its overhangs and drafts, in mm, and how small a facet counts.
MESH = 0.05
SPECK = 0.01
# Corners closer than this, in mm, are one corner of a part's mesh.
WELD = 1e-5
# How finely a surface past an overhang limit, and the edges holding it up,
# are sampled to find how far it reaches, in mm, and at most how many points
# a surface is sampled at.
REACH_STEP = 0.25
REACH_POINTS = 200_000
# How many points of a part's surface its walls are measured at, and how
# many times a finer grid is measured around the thinnest.
WALL_POINTS = 600
NEAR_ROUNDS = 4
# A wall thinner than this is the kernel meeting the face it starts on.
WALL_START = 1e-4
# How near a size given as one number must be, in mm: the answer says sizes to a hundredth.
EXACT = 0.01
# How far above the bed, in mm, a clearance's bed limit holds when it gives no height.
BED_HEIGHT = 0.5


def _parts(parts, asked, what):
    """The shown parts a field names, by name or pattern; unchecked when it names none shown."""
    names = [name for name, _ in parts]
    given = asked if isinstance(asked, list) else [asked]
    try:
        chosen = patterns.expanded(given, names, what)
    except ValueError as problem:
        raise _Unchecked(str(problem)) from None
    missing = [name for name in chosen if name not in names]
    if missing:
        raise _Unchecked(f"{', '.join(missing)} {'is' if len(missing) == 1 else 'are'} not shown in this build")
    found = dict(parts)
    return [(name, found[name]) for name in chosen]


def _box(shapes):
    boxes = [shape.bounding_box() for _, shape in shapes]
    low = numpy.array([min(b.min.X for b in boxes), min(b.min.Y for b in boxes), min(b.min.Z for b in boxes)])
    high = numpy.array([max(b.max.X for b in boxes), max(b.max.Y for b in boxes), max(b.max.Z for b in boxes)])
    return high - low


def _size(parts, asked):
    worst = None
    for name, shape in _parts(parts, asked["part"], "part"):
        size = _box([(name, shape)])
        margins = []
        for limit, sign in ((asked.get("max"), 1), (asked.get("min"), -1)):
            for axis, bound in enumerate(limit or []):
                if bound is not None:
                    margins.append((sign * (bound - size[axis]), "xyz"[axis], f"{'at most' if sign > 0 else 'at least'} {_mm(bound)}"))
        for axis, bound in enumerate(asked.get("range") or []):
            if isinstance(bound, list):
                margins.append((min(size[axis] - bound[0], bound[1] - size[axis]), "xyz"[axis], f"{_mm(bound[0])} to {_mm(bound[1])} mm"))
            elif bound is not None:
                # A single size holds within what the answer says of it.
                margins.append((EXACT - abs(size[axis] - bound), "xyz"[axis], f"{_mm(bound)} mm"))
        margin = min(margins)
        if worst is None or margin[0] < worst[0][0]:
            worst = (margin, name, size)
    (margin, axis, limit), name, size = worst
    return {
        "margin": margin,
        "unit": "mm",
        "measured": f"{name} is {' × '.join(_mm(v) for v in size)} mm, {_mm(size['xyz'.index(axis)])} along {axis} where {limit} is asked",
    }


def _fits(parts, asked):
    shapes = _parts(parts, asked.get("parts") or [name for name, _ in parts], "parts")
    size = _box(shapes)
    box = numpy.array(asked["box"], dtype=float)
    turned = asked.get("turned", True)
    held, room = (numpy.sort(size), numpy.sort(box)) if turned else (size, box)
    margin = float((room - held).min())
    return {
        "margin": margin,
        "unit": "mm",
        "measured": f"{'the parts are' if len(shapes) > 1 else f'{shapes[0][0]} is'} {' × '.join(_mm(v) for v in size)} mm, for a box of {' × '.join(_mm(v) for v in box)} mm{', turned to fit' if turned else ''}",
    }


def _hole(parts, asked):
    from .measure import holes_in

    diameter, tolerance, count = asked["diameter"], asked["tolerance"], asked.get("count", 1)
    worst = None
    for name, shape in _parts(parts, asked["part"], "part"):
        holes = holes_in(shape)
        near = sorted((abs(h["diameter"] - diameter), h["diameter"], h["count"]) for h in holes)
        within = [one for one in near if one[0] <= tolerance + 1e-9]
        found = sum(one[2] for one in within)
        if found < count:
            # Short of holes it fails, with no margin: no distance to a size limit says what is missing.
            sizes = ", ".join(f"{one[2]}× Ø{_mm(one[1])}" for one in near[:4])
            said = f"{name} has {found} of the {count} {'hole' if count == 1 else 'holes'} of Ø{_mm(diameter)} ± {_mm(tolerance)} asked" + (f"; its holes are {sizes}" if sizes else "; it has no round hole")
            return {"margin": None, "unit": "", "holds": False, "measured": said}
        margin = tolerance - max(one[0] for one in within)
        if worst is None or margin < worst["margin"]:
            said = f"{name} has {found} {'hole' if found == 1 else 'holes'} of Ø{', Ø'.join(_mm(one[1]) for one in within)}"
            worst = {"margin": margin, "unit": "mm", "measured": said}
    return worst


def _clearance(parts, asked, every=()):
    first = _parts(parts, asked["between"][0], "between")
    second = _parts(parts, asked["between"][1], "between")
    nearest = None
    for at, placed in [(None, parts), *every]:
        found = dict(placed)
        for a, _ in first:
            for b, _ in second:
                if a == b or a not in found or b not in found:
                    continue
                gap = fit.gap(found[a], found[b])
                if gap is None:
                    continue
                if nearest is None or gap < nearest[0]:
                    nearest = (gap, a, b, at)
    if nearest is None:
        raise _Unchecked("it names no two different parts")
    gap, a, b, at = nearest
    where = f" at the position {at}" if at else ""
    said = f"{a} comes {_mm(gap)} mm from {b}{where}" if gap > 0 else f"{a} touches or overlaps {b}{where}"
    margin = gap - asked["min"]
    if asked.get("bed") is not None:
        bed_margin, bed_said = _near_bed(parts, asked, first, second, every)
        said += f"; {bed_said}"
        if bed_margin is not None:
            margin = min(margin, bed_margin)
    return {"margin": margin, "unit": "mm", "measured": said}


def _near_bed(parts, asked, first, second, every):
    """
    The least clearance between the parts within `height` of the bed, the
    lowest of every part shown along `up`, where a printer's first layers
    spread: its margin to the bed limit and its words, the margin None when
    neither part reaches that low.
    """
    from build123d import Align, Box, Plane

    up = _unit(asked.get("up", [0, 0, 1]))
    height = asked.get("height", BED_HEIGHT)
    limit = asked["bed"]
    nearest = None
    for at, placed in [(None, parts), *every]:
        found = dict(placed)
        corners = numpy.array([[c.X, c.Y, c.Z] for _, shape in placed for c in (shape.bounding_box().min, shape.bounding_box().max)])
        reach = float(numpy.ptp(corners, axis=0).max()) * 4 + 1000
        bed = min(float((numpy.array([tuple(v) for v in shape.tessellate(MESH, 0.2)[0]]) @ up).min()) for _, shape in placed)
        slab = Plane(origin=tuple(up * bed), z_dir=tuple(up)) * Box(reach, reach, height, align=(Align.CENTER, Align.CENTER, Align.MIN))
        low = {}
        for a, b in ((a, b) for a, _ in first for b, _ in second if a != b and a in found and b in found):
            for name in (a, b):
                if name not in low:
                    cut = found[name] & slab
                    low[name] = cut if cut.volume > 0 else None
            if low[a] is None or low[b] is None:
                continue
            gap = fit.gap(low[a], low[b])
            if gap is not None and (nearest is None or gap < nearest[0]):
                nearest = (gap, a, b, at)
    band = f"within {_mm(height)} mm of the bed"
    if nearest is None:
        return None, f"neither reaches {band}"
    gap, a, b, at = nearest
    where = f" at the position {at}" if at else ""
    comes = f"{a} comes {_mm(gap)} mm from {b}{where}" if gap > 0 else f"{a} touches or overlaps {b}{where}"
    return gap - limit, f"{band}, {comes}, where at least {_mm(limit)} mm is asked"


def _separate(parts, asked, overlaps):
    names = {name for name, _ in _parts(parts, asked.get("parts") or [name for name, _ in parts], "parts")}
    clashing = [one for one in overlaps if one["first"] in names and one["second"] in names]
    if not clashing:
        return {"margin": None, "unit": "", "measured": "no two of them overlap"}
    return {
        "margin": None,
        "unit": "",
        "holds": False,
        "measured": "; ".join(f"{one['first']} overlaps {one['second']} by {_mm(one['volume'])} mm³" for one in clashing[:5]),
    }


# Steps of a low-discrepancy sequence in the unit square, spreading points over a triangle evenly.
_SPREAD = (0.7548776662466927, 0.5698402909980532)


def _surface_samples(shape, count):
    """
    `count` points spread over a part's faces by their area, each with the
    face's outward normal there; a face too small for a point of its own
    has none.
    """
    samples = []
    faces = list(shape.faces())
    areas = [face.area for face in faces]
    total = sum(areas) or 1.0
    exact = [count * area / total for area in areas]
    shares = [int(value) for value in exact]
    # The points left over go to the faces nearest another, largest share first.
    for i in sorted(range(len(faces)), key=lambda i: exact[i] - shares[i], reverse=True)[: count - sum(shares)]:
        shares[i] += 1
    for face, share in zip(faces, shares):
        if not share:
            continue
        try:
            corners, triangles = face.tessellate(MESH * 4, 0.3)
        except Exception:  # noqa: BLE001 - a face the kernel cannot mesh gives no points
            continue
        if not triangles:
            continue
        corners = numpy.array([tuple(c) for c in corners], dtype=float)
        a, b, c = (corners[numpy.array(triangles)[:, k]] for k in range(3))
        sizes = numpy.linalg.norm(numpy.cross(b - a, c - a), axis=1)
        reach = numpy.cumsum(sizes) / (sizes.sum() or 1.0)
        for i in range(share):
            k = min(int(numpy.searchsorted(reach, (i + 0.5) / share)), len(sizes) - 1)
            u, v = (0.5 + i * _SPREAD[0]) % 1, (0.5 + i * _SPREAD[1]) % 1
            root = u**0.5
            middle = (1 - root) * a[k] + root * (1 - v) * b[k] + root * v * c[k]
            try:
                point = face.closest_points(Vector(*(float(v) for v in middle)))[0]
                normal = face.normal_at(point)
            except Exception:  # noqa: BLE001
                continue
            samples.append((point, normal))
    return samples


# At most how many places a failing wall check names, the thinnest first.
WALL_PLACES = 8
# How many of a point's nearest points a thin one is joined to, when they are thin too.
NEIGHBOURS = 10


def _thin_places(name, points, thicknesses, limit, spacing):
    """
    The places of a part whose walls are under `limit`, from the thickness
    measured at each of its points: a thin point joins the thin points among
    its nearest, so a thick wall between two thin spots keeps them apart.
    Each place is its thinnest point, its extent and how many points it holds.
    """
    points = numpy.array([tuple(p) for p in points], dtype=float)
    thicknesses = numpy.array(thicknesses, dtype=float)
    thin = numpy.flatnonzero(thicknesses < limit)
    if not len(thin):
        return []
    group = {int(i): int(i) for i in thin}

    def root(i):
        while group[i] != i:
            group[i] = group[group[i]]
            i = group[i]
        return i

    for i in thin:
        distances = numpy.linalg.norm(points - points[i], axis=1)
        for j in numpy.argsort(distances)[1 : NEIGHBOURS + 1]:
            if int(j) in group:
                group[root(int(i))] = root(int(j))
    places = {}
    for i in thin:
        places.setdefault(root(int(i)), []).append(int(i))
    # A point or two at a place's edge, its nearest points on the walls beside
    # it, joins the place when a thin point of it lies within two spacings.
    for key, members in sorted(places.items(), key=lambda item: len(item[1])):
        if len(members) >= 3:
            continue
        others = [int(i) for i in thin if root(int(i)) != key]
        if not others:
            continue
        near = min(others, key=lambda j: min(numpy.linalg.norm(points[j] - points[m]) for m in members))
        if min(numpy.linalg.norm(points[near] - points[m]) for m in members) <= 2 * spacing:
            group[key] = root(near)
            places.setdefault(root(near), []).extend(members)
            places[key] = []
    places = {key: members for key, members in places.items() if members}
    found = []
    for members in places.values():
        k = min(members, key=lambda m: thicknesses[m])
        spread = points[members]
        found.append({"part": name, "thickness": float(thicknesses[k]), "at": points[k], "size": spread.max(axis=0) - spread.min(axis=0), "points": len(members)})
    return found


def _thinnest(parts, asked):
    worst = None
    places = []
    shown = _parts(parts, asked["part"], "part")
    for name, shape in shown:
        rays = IntCurvesFace_ShapeIntersector()
        rays.Load(shape.wrapped, 1e-6)

        def thickness_at(point, normal):
            inward = gp_Dir(-normal.X, -normal.Y, -normal.Z)
            rays.Perform(gp_Lin(gp_Pnt(point.X, point.Y, point.Z), inward), WALL_START, 1e7)
            if not rays.IsDone():
                return None
            hits = [rays.WParameter(i) for i in range(1, rays.NbPnt() + 1) if rays.WParameter(i) > WALL_START]
            return min(hits) if hits else None

        thinnest = None
        points, thicknesses = [], []
        for point, normal in _surface_samples(shape, WALL_POINTS):
            thickness = thickness_at(point, normal)
            if thickness is not None:
                points.append(point)
                thicknesses.append(thickness)
                if thinnest is None or thickness < thinnest[0]:
                    thinnest = (thickness, point)
        if thinnest is None:
            continue
        spacing = (shape.area / WALL_POINTS) ** 0.5
        places += _thin_places(name, points, thicknesses, asked["min"], spacing)
        # Around the thinnest point, a grid on the surface, finer each round
        # and centred on the thinnest found so far, finds how thin it gets
        # between the points first measured.
        near = [face for face in shape.faces() if face.distance_to(thinnest[1]) <= spacing]
        closer = 0
        step = spacing / 2
        for _ in range(NEAR_ROUNDS):
            centre = thinnest[1]
            normal = min(near, key=lambda face: face.distance_to(centre)).normal_at(centre)
            first = normal.cross(Vector(1, 0, 0) if abs(normal.X) < 0.9 else Vector(0, 1, 0)).normalized()
            second = normal.cross(first)
            for i in range(-2, 3):
                for j in range(-2, 3):
                    if not i and not j:
                        continue
                    wanted = centre + first * (i * step) + second * (j * step)
                    face = min(near, key=lambda face: face.distance_to(wanted))
                    try:
                        point = face.closest_points(wanted)[0]
                        thickness = thickness_at(point, face.normal_at(point))
                    except Exception:  # noqa: BLE001 - a point the kernel cannot place is not measured
                        continue
                    if thickness is not None:
                        closer += 1
                        if thickness < thinnest[0]:
                            thinnest = (thickness, point)
            step /= 2
        if thinnest[0] < asked["min"] and thinnest[0] < min(thicknesses):
            # The thinner spot found is its place's thinnest, or a place of its own.
            own = [one for one in places if one["part"] == name]
            p = numpy.array(tuple(thinnest[1]))
            nearest = min(own, key=lambda one: numpy.linalg.norm(one["at"] - p), default=None)
            if nearest is not None and numpy.linalg.norm(nearest["at"] - p) <= 2 * spacing:
                nearest.update(thickness=thinnest[0], at=p)
            else:
                places.append({"part": name, "thickness": thinnest[0], "at": p, "size": numpy.zeros(3), "points": 1})
        margin = thinnest[0] - asked["min"]
        if worst is None or margin < worst["margin"]:
            p = thinnest[1]
            worst = {
                "margin": margin,
                "unit": "mm",
                "measured": f"{name}'s thinnest wall is {_mm(thinnest[0])} mm, at {_at(p)}, measured at {len(points)} points over its faces, about {_mm(spacing)} mm apart, and {closer} more near its thinnest",
            }
    if worst is None:
        raise _Unchecked("no wall of it could be measured")
    if places:
        places.sort(key=lambda one: one["thickness"])
        named = len(shown) > 1

        def place(one):
            p, size = one["at"], one["size"]
            where = f"{one['part']}: " if named else ""
            extent = f" over {' × '.join(_mm(v) for v in size)} mm ({one['points']} points)" if one["points"] > 1 else " (1 point)"
            return f"{where}{_mm(one['thickness'])} mm at {_at(p)}{extent}"

        listed = ", ".join(place(one) for one in places[:WALL_PLACES])
        more = len(places) - WALL_PLACES
        worst["measured"] += (
            f"; walls under {_mm(asked['min'])} mm in {len(places)} {'place' if len(places) == 1 else 'places'}: {listed}"
            + (f", and {more} more {'place' if more == 1 else 'places'}" if more > 0 else "")
        )
    return worst


def _wall(parts, asked):
    """
    A part's wall: its thinnest, measured straight in, and how it spreads
    about its nominal, its thickest section and the share of its surface
    outside a band. Each limit asked has its margin; the requirement's is the
    one furthest past its limit, or nearest it, as a share of the limit.
    """
    found = []
    if asked.get("min") is not None:
        thin = _thinnest(parts, asked)
        found.append(([(thin["margin"], thin["unit"], asked["min"])], thin["measured"]))
    if any(asked.get(key) is not None for key in ("max", "ratio", "band")):
        for name, shape in _parts(parts, asked["part"], "part"):
            found.append(walls.spread(name, shape, asked))
    margins = [one for listed, _ in found for one in listed]
    if not margins:
        raise _Unchecked("no wall of it could be measured")
    margin, unit, _ = min(margins, key=lambda one: one[0] / one[2])
    return {"margin": margin, "unit": unit, "measured": "; ".join(said for _, said in found)}


def _facets(shape):
    """A part's mesh: each facet's middle, outward normal and three corners."""
    corners, triangles = shape.tessellate(MESH, 0.2)
    corners = numpy.array([tuple(c) for c in corners], dtype=float).reshape(-1, 3)
    triangles = numpy.array(triangles, dtype=numpy.int64).reshape(-1, 3)
    a, b, c = (corners[triangles[:, k]] for k in range(3))
    cross = numpy.cross(b - a, c - a)
    area = numpy.linalg.norm(cross, axis=1) / 2
    keep = area > SPECK
    return (a + b + c)[keep] / 3, cross[keep] / (2 * area[keep, None]), numpy.stack((a, b, c), axis=1)[keep]


def _side_of(corners, heights, parting, below):
    """The middle of the part of a facet on one side of the parting: below it, or above."""
    inside = [p for p, h in zip(corners, heights) if (h <= parting if below else h >= parting)]
    for i in range(3):
        j = (i + 1) % 3
        if (heights[i] - parting) * (heights[j] - parting) < 0:
            t = (parting - heights[i]) / (heights[j] - heights[i])
            inside.append(corners[i] + t * (corners[j] - corners[i]))
    return numpy.mean(inside, axis=0)


def _unit(vector):
    vector = numpy.array(vector, dtype=float)
    return vector / numpy.linalg.norm(vector)


def _welded(shape):
    """
    A part's mesh with the corners its faces share joined into one, so
    facets on either side of an edge between two faces meet: its corners and
    triangles.
    """
    corners, triangles = shape.tessellate(MESH, 0.2)
    corners = numpy.array([tuple(c) for c in corners], dtype=float).reshape(-1, 3)
    triangles = numpy.array(triangles, dtype=numpy.int64).reshape(-1, 3)
    keys = numpy.round(corners / WELD).astype(numpy.int64)
    _, first, joined = numpy.unique(keys, axis=0, return_index=True, return_inverse=True)
    return corners[first], joined.reshape(-1)[triangles]


def _grid(steps):
    """Barycentric weights of a triangular grid `steps` to a side, each row (b, c)."""
    rows = [(i / steps, j / steps) for i in range(steps + 1) for j in range(steps + 1 - i)]
    return numpy.array(rows, dtype=float)


def _hanging_surfaces(shape, up, limit):
    """
    The steepest facet facing down, off the bed, and each surface steeper
    than `limit` degrees from upright: its area, its middle, and how far its
    farthest point lies from an edge held up from below, infinite when none
    is. An edge is held up when it lies on the bed or the surface beside it
    goes on downward from it, as a wall under a ceiling or the lower part of
    a hole does.
    """
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components
    from scipy.spatial import cKDTree

    corners, triangles = _welded(shape)
    a, b, c = (corners[triangles[:, k]] for k in range(3))
    cross = numpy.cross(b - a, c - a)
    area = numpy.linalg.norm(cross, axis=1) / 2
    solid = area > SPECK
    normals = numpy.zeros_like(cross)
    normals[solid] = cross[solid] / (2 * area[solid, None])
    middles = (a + b + c) / 3
    heights = corners @ up
    bed = float(heights.min())
    down = normals @ up
    angles = numpy.degrees(numpy.arcsin(numpy.clip(-down, 0, 1)))
    facing = solid & (down < -1e-6) & (middles @ up > bed + 0.1)
    steepest = (0.0, None)
    if facing.any():
        k = int(numpy.flatnonzero(facing)[angles[facing].argmax()])
        steepest = (float(angles[k]), middles[k])
    past = facing & (angles > limit + 1e-6)
    if not past.any():
        return steepest, []

    # Each facet's three edges, the facets sharing an edge side by side once sorted.
    sides = numpy.stack([triangles[:, [0, 1]], triangles[:, [1, 2]], triangles[:, [2, 0]]], axis=1).reshape(-1, 2)
    owner = numpy.repeat(numpy.arange(len(triangles)), 3)
    _, edge = numpy.unique(numpy.sort(sides, axis=1), axis=0, return_inverse=True)
    edge = edge.reshape(-1)
    order = numpy.argsort(edge, kind="stable")
    paired = edge[order[1:]] == edge[order[:-1]]
    one, other = owner[order[:-1]][paired], owner[order[1:]][paired]
    joined = past[one] & past[other]
    links = coo_matrix((numpy.ones(int(joined.sum())), (one[joined], other[joined])), shape=(len(triangles),) * 2)
    _, label = connected_components(links, directed=False)

    beside = {}
    for k in numpy.flatnonzero(numpy.isin(edge, numpy.unique(edge[past[owner]]))):
        beside.setdefault(int(edge[k]), []).append(int(owner[k]))

    def held(p, q, facets):
        if heights[p] <= bed + 0.1 and heights[q] <= bed + 0.1:
            return True
        start, along = corners[p], corners[q] - corners[p]
        along = along / (numpy.linalg.norm(along) or 1.0)
        for f in facets:
            away = middles[f] - start
            away = away - (away @ along) * along
            size = numpy.linalg.norm(away)
            if size > 0 and away @ up < -0.05 * size:
                return True
        return False

    surfaces = []
    for region in numpy.unique(label[past]):
        members = numpy.flatnonzero(past & (label == region))
        inside = set(members.tolist())
        edges = []
        for f in members:
            for p, q in ((0, 1), (1, 2), (2, 0)):
                i, j = int(triangles[f, p]), int(triangles[f, q])
                around = [g for g in beside.get(int(edge[3 * f + p]), []) if g != f]
                if any(g in inside for g in around):
                    continue
                if held(i, j, around):
                    edges.append((i, j))
        total = float(area[members].sum())
        middle = (middles[members] * area[members, None]).sum(axis=0) / total
        if not edges:
            surfaces.append((float("inf"), total, middle))
            continue
        lining = []
        for i, j in edges:
            length = numpy.linalg.norm(corners[j] - corners[i])
            t = numpy.linspace(0, 1, max(2, int(numpy.ceil(length / REACH_STEP)) + 1))[:, None]
            lining.append(corners[i] + t * (corners[j] - corners[i]))
        # Points over the surface, finer than the step, coarser past a limit on their count.
        step = max(REACH_STEP, (total / REACH_POINTS) ** 0.5)
        points = []
        for f in members:
            p0, p1, p2 = a[f], b[f], c[f]
            longest = max(numpy.linalg.norm(p1 - p0), numpy.linalg.norm(p2 - p1), numpy.linalg.norm(p0 - p2))
            steps = max(1, int(numpy.ceil(longest / step)))
            steps += steps % 2
            w = _grid(steps)
            points.append(p0 + w[:, :1] * (p1 - p0) + w[:, 1:] * (p2 - p0))
        reach, _ = cKDTree(numpy.concatenate(lining)).query(numpy.concatenate(points))
        surfaces.append((float(reach.max()), total, middle))
    surfaces.sort(key=lambda one: -one[0])
    return steepest, surfaces


def _overhang(parts, asked):
    up = _unit(asked.get("up", [0, 0, 1]))
    limit = asked["max"]
    bridge = asked.get("bridge", 0)
    allowed = bridge / 2
    asked_bridge = f"a bridge of {_mm(bridge)} mm, {_mm(allowed)} mm from either side, is asked" if bridge > 0 else "no bridge is asked"
    worst = None
    for name, shape in _parts(parts, asked["part"], "part"):
        (angle, at), surfaces = _hanging_surfaces(shape, up, limit)
        if not surfaces:
            margin = limit - angle
            place = f", at {_at(at)}" if at is not None else ""
            rank = (2, margin)
            result = {"margin": margin, "unit": "°", "measured": f"{name} overhangs at most {_mm(angle)}° from upright{place}, its bed below it"}
        else:
            reach, total, middle = surfaces[0]
            holds = reach <= allowed + 1e-9
            free = reach == float("inf")
            farthest = f"{_mm(round(reach, 1))} mm from an edge held up from below"
            count = len(surfaces)
            if holds:
                said = f"{name}'s {count} surface{'s' if count > 1 else ''} steeper than {_mm(limit)}° from upright {'are' if count > 1 else 'is'} bridged, the farthest point {farthest}, where {asked_bridge}"
            else:
                one = f"{_mm(round(total))} mm² at {_at(middle)}"
                if count == 1:
                    whose = "held up from below at no edge" if free else f"whose farthest point is {farthest}"
                    said = f"{name} has a surface steeper than {_mm(limit)}° from upright, {one}, {whose}, where {asked_bridge}"
                else:
                    whose = "is held up from below at no edge" if free else f"has its farthest point {farthest}"
                    said = f"{name} has {count} surfaces steeper than {_mm(limit)}° from upright; the one reaching farthest, {one}, {whose}, where {asked_bridge}"
            rank = (1 if holds else 0, -reach)
            result = {"margin": None, "unit": "", "holds": holds, "measured": said}
        if worst is None or rank < worst[0]:
            worst = (rank, result)
    return worst[1]


def _draft(parts, asked):
    """
    The least draft of any face toward the way its half of the mould leaves
    it. The mould splits at `parting`, a height along the pull, or, given
    none, at the part's lowest, so all of it is pulled one way: faces above
    the parting leave along the pull, those below against it. A face leaning
    back from its half's way, at any angle, is an undercut, its draft below
    zero. A face crossing the parting is in both halves, so unless it lies
    along the pull it leans back from one of them. Faces lying flat on the
    parting, as a base on the mould plate, are where the halves meet and
    need none.
    """
    pull = _unit(asked.get("pull", [0, 0, 1]))
    parted = asked.get("parting")
    worst = None
    for name, shape in _parts(parts, asked["part"], "part"):
        middles, normals, corners = _facets(shape)
        heights = corners @ pull
        low, high = heights.min(axis=1), heights.max(axis=1)
        parting = float(low.min()) if parted is None else float(parted)
        along = normals @ pull
        # Each facet's half: above the parting it leaves along the pull, below it
        # against; one crossing the parting must leave both ways.
        above, below = low >= parting - 1e-6, high <= parting + 1e-6
        facing = numpy.where(above, along, numpy.where(below, -along, -numpy.abs(along)))
        facing = numpy.clip(facing, -1, 1)
        facing[numpy.abs(facing) < 1e-9] = 0.0
        on_parting = (numpy.abs(along) > 1 - 1e-6) & (numpy.abs(middles @ pull - parting) < 0.01)
        checked = numpy.flatnonzero(~on_parting)
        crossing = None
        if not len(checked):
            angle, at = 90.0, None
        else:
            angles = numpy.degrees(numpy.arcsin(facing[checked]))
            # Of the facets leaning furthest, one wholly in its half is named before one crossing the parting.
            least = checked[angles <= angles.min() + 1e-6]
            whole = least[above[least] | below[least]]
            k = int(whole[0] if len(whole) else least[0])
            # Adding 0.0 turns a -0.0 into a plain 0.
            angle, at = float(numpy.degrees(numpy.arcsin(facing[k]))) + 0.0, middles[k]
            if angle < 0 and not above[k] and not below[k]:
                # Where it leans back: below the parting when it faces along the pull.
                crossing = "below" if along[k] > 0 else "above"
                at = _side_of(corners[k], heights[k], parting, crossing == "below")
        margin = angle - asked["min"]
        if worst is None or margin < worst["margin"]:
            place = f", at {_at(at)}" if at is not None else ""
            split = f", the mould parted at {_mm(parting)} mm along the pull" if parted is not None else ""
            if angle < 0:
                said = f"{name} has an undercut, a face with {_mm(angle)}° of draft, leaning back from the way its half of the mould leaves it{place}{split}"
                if crossing:
                    said += f"; the face crosses the parting and leans back from the way the half {crossing} it leaves; part the mould where the walls turn from leaning one way to the other"
            else:
                said = f"{name}'s steepest wall has {_mm(angle)}° of draft along the pull{place}{split}"
            worst = {"margin": margin, "unit": "°", "measured": said}
    return worst


def _mass(parts, asked):
    shapes = _parts(parts, asked.get("parts") or [name for name, _ in parts], "parts")
    density = asked.get("density") or DENSITIES[asked["material"]]
    grams = sum(shape.volume for _, shape in shapes) * density / 1000
    margins = []
    if asked.get("max") is not None:
        margins.append((asked["max"] - grams, f"at most {_mm(asked['max'])} g"))
    if asked.get("min") is not None:
        margins.append((grams - asked["min"], f"at least {_mm(asked['min'])} g"))
    margin, limit = min(margins)
    what = asked.get("material") or f"{_mm(density)} g/cm³"
    return {"margin": margin, "unit": "g", "measured": f"{_mm(grams)} g in {what}, where {limit} is asked"}


def _footprint(shapes, up):
    """
    Where the parts stand: the outline round every point of theirs on the
    bed, their lowest along `up`, in two directions square to it, as a list
    of corners; and those directions.
    """
    from scipy.spatial import ConvexHull, QhullError

    first = numpy.cross(up, [1.0, 0.0, 0.0] if abs(up[0]) < 0.9 else [0.0, 1.0, 0.0])
    first /= numpy.linalg.norm(first)
    second = numpy.cross(up, first)
    corners = numpy.concatenate([numpy.array([tuple(v) for v in shape.tessellate(MESH, 0.2)[0]]) for _, shape in shapes])
    heights = corners @ up
    on_bed = corners[heights <= heights.min() + MESH]
    flat = numpy.stack((on_bed @ first, on_bed @ second), axis=1)
    try:
        hull = ConvexHull(flat)
        outline = flat[hull.vertices]
    except QhullError:
        # Points on one line, or one point: what the parts stand on has no area.
        outline = flat[[flat[:, 0].argmin(), flat[:, 0].argmax()]] if numpy.ptp(flat[:, 0]) > numpy.ptp(flat[:, 1]) else flat[[flat[:, 1].argmin(), flat[:, 1].argmax()]]
    return outline, first, second


def _inside_by(point, outline):
    """How far a point lies inside an outline's edge, or, below zero, outside it."""
    nearest = math.inf
    for i in range(len(outline)):
        a, b = outline[i], outline[(i + 1) % len(outline)]
        along = b - a
        t = float(numpy.clip((point - a) @ along / (along @ along or 1.0), 0, 1))
        nearest = min(nearest, float(numpy.linalg.norm(point - (a + t * along))))
    if len(outline) < 3:
        return -nearest
    path = outline.tolist()
    inside = False
    for i in range(len(path)):
        (x1, y1), (x2, y2) = path[i], path[(i + 1) % len(path)]
        if (y1 > point[1]) != (y2 > point[1]) and point[0] < x1 + (point[1] - y1) * (x2 - x1) / (y2 - y1):
            inside = not inside
    return nearest if inside else -nearest


def _balance(parts, asked):
    """
    Where the centre of mass of the parts lies: within `tolerance` of the
    point `at`, any of its numbers null for anywhere along that axis, and,
    with `footprint`, over what the parts stand on, so they do not tip. Each
    part is as dense as `materials` gives it, by name or pattern, which then
    names every part; without it, all are as dense.
    """
    shapes = _parts(parts, asked.get("parts") or [name for name, _ in parts], "parts")
    given = asked.get("materials") or {}
    density = {}
    for key, value in given.items():
        for name, _ in _parts(shapes, key, "materials"):
            density[name] = value if isinstance(value, (int, float)) else DENSITIES[value]
    missing = [name for name, _ in shapes if given and name not in density]
    if missing:
        raise _Unchecked(f"materials gives no material for {', '.join(missing)}")
    weights = [(name, shape, shape.volume * density.get(name, 1.0)) for name, shape in shapes]
    total = sum(weight for _, _, weight in weights)
    if total <= 0:
        raise _Unchecked("the parts have no volume")
    centre = sum((numpy.array(tuple(shape.center(CenterOf.MASS))) * weight for _, shape, weight in weights), numpy.zeros(3)) / total
    names = [name for name, _ in shapes]
    grams = f", {_mm(total / 1000)} g," if given else ","
    said = [f"the centre of mass of {_listed(names)}{grams} is at {_at(centre)}"]
    margins = []
    if asked.get("at") is not None:
        target = asked["at"]
        off = [centre[k] - target[k] for k in range(3) if target[k] is not None]
        distance = float(numpy.linalg.norm(off))
        margins.append(asked["tolerance"] - distance)
        point = ", ".join("any" if v is None else _mm(v) for v in target)
        said.append(f"{_mm(distance)} mm from ({point}), where within {_mm(asked['tolerance'])} mm is asked")
    if asked.get("footprint"):
        up = _unit(asked.get("up", [0, 0, 1]))
        outline, first, second = _footprint(shapes, up)
        inside = _inside_by(numpy.array([centre @ first, centre @ second]), outline)
        margins.append(inside)
        said.append(
            f"{_mm(inside)} mm inside the edge of what {'they stand' if len(names) > 1 else 'it stands'} on"
            if inside >= 0
            else f"{_mm(-inside)} mm outside the edge of what {'they stand' if len(names) > 1 else 'it stands'} on, so {'they tip' if len(names) > 1 else 'it tips'}"
        )
    return {"margin": min(margins), "unit": "mm", "measured": ", ".join(said)}


def _of_part(check):
    """A kind measured on the parts its `part` names alone."""
    return lambda parts, asked, _: check(_parts(parts, asked["part"], "part"), asked)


# Each kind the CAD studio measures, by its name in a requirements file, as the tools list them:
# what measures it, given the parts shown, the requirement and the build's other measures.
KINDS = {
    "size": lambda parts, asked, _: _size(parts, asked),
    "fits": lambda parts, asked, _: _fits(parts, asked),
    "hole": lambda parts, asked, _: _hole(parts, asked),
    "clearance": lambda parts, asked, build: _clearance(parts, asked, build["every"]),
    "mesh": lambda parts, asked, _: requirements_gears.mesh(_parts(parts, asked["between"][0], "between"), _parts(parts, asked["between"][1], "between"), asked),
    "separate": lambda parts, asked, build: _separate(parts, asked, build["overlaps"]),
    "wall": lambda parts, asked, _: _wall(parts, asked),
    "overhang": lambda parts, asked, _: _overhang(parts, asked),
    "draft": lambda parts, asked, _: _draft(parts, asked),
    "mass": lambda parts, asked, _: _mass(parts, asked),
    "insert": lambda parts, asked, _: fit.inserted(parts, asked),
    "balance": lambda parts, asked, _: _balance(parts, asked),
    "corner": _of_part(making.corner),
    "ribs": _of_part(making.ribs),
    "undercut": _of_part(making.undercut),
    "void": _of_part(making.void),
    "bend": _of_part(sheet.bend),
    "smooth": lambda parts, asked, build: smooth.smooth(_parts(parts, asked["part"], "part"), asked, build["named"]),
    "stress": _of_part(strength.stress),
    "strain": _of_part(strength.strain),
}


def checked(parts, requirements, overlaps, every=(), named=None):
    """
    Each requirement checked on the parts shown: whether it holds, what was
    measured and the margin. `every` holds the parts at each other position
    checked, by its arguments, for clearances. `named` holds each part as
    shown with its named surfaces, as indexes into its faces, by its name.
    """
    build = {"overlaps": overlaps, "every": every, "named": named or {}}
    found = []
    for asked in requirements:
        kind = asked["check"]
        try:
            if kind not in KINDS:
                raise _Unchecked(f"no check is of the kind {kind}")
            result = KINDS[kind](parts, asked, build)
        except _Unchecked as why:
            found.append({"id": asked["id"], "holds": None, "why": str(why)})
            continue
        except Exception as problem:  # noqa: BLE001 - the kernel's own errors, said for this requirement
            found.append({"id": asked["id"], "holds": None, "why": f"it could not be measured: {str(problem).strip() or type(problem).__name__}"})
            continue
        margin = result["margin"]
        holds = bool(result.get("holds", True if margin is None else margin >= -1e-9))
        found.append(
            {
                "id": asked["id"],
                "holds": holds,
                "measured": result["measured"],
                **({"margin": round(float(margin), 4), "unit": result["unit"]} if margin is not None else {}),
            }
        )
    return found
