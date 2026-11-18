"""
How a curve runs, measured on the points Blender draws it through: its tightest bend and where,
its sharp corners, and where it crosses itself or, drawn as a tube, runs into itself.
"""

import math

import bpy
from mathutils.kdtree import KDTree

from .finding import scene
from .wording import length, point_text

# A turn sharper than this at a point the curve is given, in degrees, is a corner.
CORNER = 1.0
# A bare curve crosses itself where two of its pieces come nearer than this share of its size.
TOUCH = 1e-5


def drawn_points(obj):
    """The world points Blender draws a curve object through, in order along it, without its tube."""
    bare = obj.data.copy()
    bare.bevel_depth = 0
    bare.extrude = 0
    bare.bevel_object = None
    bare.taper_object = None
    holder = bpy.data.objects.new(f"{obj.name} drawn", bare)
    holder.matrix_world = obj.matrix_world.copy()
    scene().collection.objects.link(holder)
    try:
        bpy.context.view_layer.update()
        evaluated = holder.evaluated_get(bpy.context.evaluated_depsgraph_get())
        mesh = evaluated.to_mesh()
        try:
            places = [holder.matrix_world @ v.co for v in mesh.vertices]
            links = {}
            for edge in mesh.edges:
                a, b = edge.vertices
                links.setdefault(a, []).append(b)
                links.setdefault(b, []).append(a)
        finally:
            evaluated.to_mesh_clear()
    finally:
        bpy.data.objects.remove(holder)
        bpy.data.curves.remove(bare)
    if not places:
        return []
    start = next((i for i, near in links.items() if len(near) == 1), 0)
    order, seen, at = [start], {start}, start
    while True:
        onward = [n for n in links.get(at, []) if n not in seen]
        if not onward:
            break
        at = onward[0]
        seen.add(at)
        order.append(at)
    return [places[i] for i in order]


def corners(obj, kind, cyclic):
    """The world places of the points a curve turns sharply at: every turning point of a poly curve, and bezier points whose handles do not line up."""
    spline = obj.data.splines[0]
    matrix = obj.matrix_world
    found = []
    if kind == "bezier":
        given = list(spline.bezier_points)
        for point in given if cyclic else given[1:-1]:
            before, after = point.co - point.handle_left, point.handle_right - point.co
            if before.length > 1e-12 and after.length > 1e-12 and math.degrees(before.angle(after)) > CORNER:
                found.append(matrix @ point.co)
        return found
    if kind == "nurbs" and spline.order_u > 2:
        return []
    places = [matrix @ p.co.xyz for p in spline.points]
    count = len(places)
    for i in range(count) if cyclic else range(1, count - 1):
        before, after = places[i] - places[i - 1], places[(i + 1) % count] - places[i]
        if before.length > 1e-12 and after.length > 1e-12 and math.degrees(before.angle(after)) > CORNER:
            found.append(places[i])
    return found


def bend_radius(a, b, c):
    """The radius of the circle through three points, or nothing when they lie in a line."""
    crossed = (b - a).cross(c - a).length
    if crossed <= 1e-15:
        return None
    return (b - a).length * (c - b).length * (c - a).length / (2 * crossed)


def tightest_bend(points, cyclic, sharp):
    """The least bend radius over the drawn points and where, leaving out the sharp corners."""
    count = len(points)
    best = None
    for i in range(count) if cyclic else range(1, count - 1):
        at = points[i]
        if any((at - corner).length <= 1e-7 for corner in sharp):
            continue
        radius = bend_radius(points[i - 1], at, points[(i + 1) % count])
        if radius is not None and (best is None or radius < best[0]):
            best = (radius, at)
    return best


def segment_gap(p, q, r, s):
    """How near two segments, p to q and r to s, come, and how far along each that is, as shares of it."""
    d1, d2, w = q - p, s - r, p - r
    a, e, b, c, f = d1.dot(d1), d2.dot(d2), d1.dot(d2), d1.dot(w), d2.dot(w)
    under = a * e - b * b
    t = 0.0 if under <= 1e-18 else min(1.0, max(0.0, (b * f - c * e) / under))
    u = (b * t + f) / e if e > 1e-18 else 0.0
    if u < 0 or u > 1:
        u = min(1.0, max(0.0, u))
        t = min(1.0, max(0.0, (b * u - c) / a)) if a > 1e-18 else 0.0
    return ((p + d1 * t) - (r + d2 * u)).length, t, u


def crossings(points, cyclic, tube):
    """
    Where a curve crosses itself, or with a tube of radius `tube` runs into itself: pieces of it
    nearer than the tube is wide that it reached by going round, not by running on. The places,
    one for each run of such pieces.
    """
    segments = [(points[i], points[i + 1]) for i in range(len(points) - 1)]
    if cyclic and len(points) > 2:
        segments.append((points[-1], points[0]))
    if len(segments) < 3:
        return []
    along = [0.0]
    for p, q in segments:
        along.append(along[-1] + (q - p).length)
    total = along[-1]
    size = max((p - points[0]).length for p in points) or 1.0
    near = 2 * tube if tube else TOUCH * size
    longest = max((q - p).length for p, q in segments)
    middles = KDTree(len(segments))
    for i, (p, q) in enumerate(segments):
        middles.insert((p + q) / 2, i)
    middles.balance()
    hits = []
    for i, (p, q) in enumerate(segments):
        for _, j, _ in middles.find_range((p + q) / 2, longest + near):
            if j <= i + 1 or (cyclic and i == 0 and j == len(segments) - 1):
                continue
            r, s = segments[j]
            gap, t, u = segment_gap(p, q, r, s)
            if gap >= near:
                continue
            apart = abs((along[j] + u * (along[j + 1] - along[j])) - (along[i] + t * (along[i + 1] - along[i])))
            if cyclic:
                apart = min(apart, total - apart)
            # A tube's pieces a little apart along it always come that near; it runs into itself only where it went round.
            if tube and (apart <= 4 * tube or gap >= apart / 2):
                continue
            hits.append((along[i] + t * (along[i + 1] - along[i]), p + (q - p) * t))
    hits.sort(key=lambda hit: hit[0])
    places, last = [], None
    for at, where in hits:
        if last is None or at - last > 2 * near + longest:
            places.append(where)
        last = at
    return places


def runs_text(obj, kind, cyclic, tube):
    """What an answer adds of how a curve runs: its corners, its tightest bend, whether its tube folds, and where it crosses itself."""
    points = drawn_points(obj)
    if len(points) < 2:
        return ""
    sharp = corners(obj, kind, cyclic)
    said = []
    if sharp:
        said.append(
            f"1 sharp corner, at {point_text(sharp[0])}"
            if len(sharp) == 1
            else f"{len(sharp)} sharp corners, the first at {point_text(sharp[0])}"
        )
    bend = tightest_bend(points, cyclic, sharp)
    if bend:
        said.append(f"its tightest bend is {length(bend[0])} in radius, at {point_text(bend[1])}")
        if tube > bend[0]:
            said.append(f"its tube, {length(tube)} in radius, is wider than that bend, so it folds into itself there")
    elif not sharp:
        said.append("it runs straight")
    crossed = crossings(points, cyclic, tube)
    what = "its tube runs into itself" if tube else "it crosses itself"
    if not crossed:
        said.append(f"{'its tube does not run into itself' if tube else 'it does not cross itself'}")
    elif len(crossed) == 1:
        said.append(f"{what} at 1 place, at {point_text(crossed[0])}")
    else:
        said.append(f"{what} at {len(crossed)} places, the first at {point_text(crossed[0])}")
    return "; " + "; ".join(said)
