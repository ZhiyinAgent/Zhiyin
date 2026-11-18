"""
An overhang requirement measured on a mesh, as the CAD studio measures it on a part: the steepest
face facing down off the bed, and each surface steeper than the limit from upright, with its area,
its middle, and how far its farthest point lies from an edge held up from below. An edge is held
up when it lies on the bed or the surface beside it goes on downward from it, as a wall under a
ceiling or the lower part of a hole does. Lengths are in millimetres.
"""

import mathutils.kdtree
import numpy

# A face smaller than this, in mm², is a speck that faces nowhere.
SPECK = 0.01
# How near the bed, in mm, a point lies on it.
BED = 0.1
# How finely a surface past the limit, and the edges holding it up, are sampled, in mm, and at most how many points.
REACH_STEP = 0.25
REACH_POINTS = 200_000
# How many rounds faces past the limit are joined into surfaces in, at most.
MOST_ROUNDS = 500


def _grid(steps):
    """Barycentric weights of a triangular grid `steps` to a side, each row (b, c)."""
    rows = [(i / steps, j / steps) for i in range(steps + 1) for j in range(steps + 1 - i)]
    return numpy.array(rows, dtype=float)


def _labels(count, one, other):
    """Each face's surface, as the lowest index of the faces joined to it through the pairs given."""
    labels = numpy.arange(count)
    for _ in range(MOST_ROUNDS):
        least = numpy.minimum(labels[one], labels[other])
        joined = labels.copy()
        numpy.minimum.at(joined, one, least)
        numpy.minimum.at(joined, other, least)
        joined = joined[joined]
        if numpy.array_equal(joined, labels):
            break
        labels = joined
    return labels


def hanging_surfaces(shape, up, limit, check):
    """The steepest face facing down off the bed, as (degrees, middle), and each surface past `limit`, farthest first."""
    triangles = numpy.array([[loop.vert.index for loop in t] for t in shape.bm.calc_loop_triangles()], dtype=numpy.int64).reshape(-1, 3)
    corners = shape.points * 1000
    a, b, c = (corners[triangles[:, k]] for k in range(3))
    cross = numpy.cross(b - a, c - a)
    area = numpy.linalg.norm(cross, axis=1) / 2
    solid = area > SPECK
    normals = numpy.zeros_like(cross)
    normals[solid] = cross[solid] / (2 * area[solid, None])
    middles = (a + b + c) / 3
    heights = corners @ up
    bed = float(heights.min()) if len(heights) else 0.0
    down = normals @ up
    angles = numpy.degrees(numpy.arcsin(numpy.clip(-down, 0, 1)))
    facing = solid & (down < -1e-6) & (middles @ up > bed + BED)
    steepest = (0.0, None)
    if facing.any():
        k = int(numpy.flatnonzero(facing)[angles[facing].argmax()])
        steepest = (float(angles[k]), middles[k])
    past = facing & (angles > limit + 1e-6)
    if not past.any():
        return steepest, []
    sides = numpy.stack([triangles[:, [0, 1]], triangles[:, [1, 2]], triangles[:, [2, 0]]], axis=1).reshape(-1, 2)
    owner = numpy.repeat(numpy.arange(len(triangles)), 3)
    _, edge = numpy.unique(numpy.sort(sides, axis=1), axis=0, return_inverse=True)
    edge = edge.reshape(-1)
    order = numpy.argsort(edge, kind="stable")
    paired = edge[order[1:]] == edge[order[:-1]]
    one, other = owner[order[:-1]][paired], owner[order[1:]][paired]
    joined = past[one] & past[other]
    label = _labels(len(triangles), one[joined], other[joined])
    beside = {}
    for k in numpy.flatnonzero(numpy.isin(edge, numpy.unique(edge[past[owner]]))):
        beside.setdefault(int(edge[k]), []).append(int(owner[k]))

    def held(p, q, faces):
        if heights[p] <= bed + BED and heights[q] <= bed + BED:
            return True
        start, along = corners[p], corners[q] - corners[p]
        along = along / (numpy.linalg.norm(along) or 1.0)
        for f in faces:
            away = middles[f] - start
            away = away - (away @ along) * along
            size = numpy.linalg.norm(away)
            if size > 0 and away @ up < -0.05 * size:
                return True
        return False

    surfaces = []
    for region in numpy.unique(label[past]):
        check()
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
        lining = numpy.concatenate(lining)
        tree = mathutils.kdtree.KDTree(len(lining))
        for index, point in enumerate(lining):
            tree.insert(point, index)
        tree.balance()
        step = max(REACH_STEP, (total / REACH_POINTS) ** 0.5)
        reach = 0.0
        for f in members:
            p0, p1, p2 = a[f], b[f], c[f]
            longest = max(numpy.linalg.norm(p1 - p0), numpy.linalg.norm(p2 - p1), numpy.linalg.norm(p0 - p2))
            steps = max(1, int(numpy.ceil(longest / step)))
            steps += steps % 2
            w = _grid(steps)
            for point in p0 + w[:, :1] * (p1 - p0) + w[:, 1:] * (p2 - p0):
                reach = max(reach, tree.find(point)[2])
        surfaces.append((float(reach), total, middle))
    surfaces.sort(key=lambda found: -found[0])
    return steepest, surfaces


def _mm(value):
    return f"{round(float(value), 2):g}"


def overhang(run, asked):
    """The part that overhangs worst past the limit, or the steepest when none does, in the words the CAD studio uses."""
    up = numpy.array(asked.get("up", [0, 0, 1]), dtype=float)
    up = up / numpy.linalg.norm(up)
    limit = asked["max"]
    bridge = asked.get("bridge", 0)
    allowed = bridge / 2
    asked_bridge = f"a bridge of {_mm(bridge)} mm, {_mm(allowed)} mm from either side, is asked" if bridge > 0 else "no bridge is asked"
    worst = None
    for obj, shape in run.shapes_named(asked["part"], "part"):
        (angle, at), surfaces = hanging_surfaces(shape, up, limit, run.check)
        name = obj.name
        if not surfaces:
            margin = limit - angle
            place = f", at ({', '.join(_mm(v) for v in at)})" if at is not None else ""
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
                one = f"{_mm(round(total))} mm² at ({', '.join(_mm(v) for v in middle)})"
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
