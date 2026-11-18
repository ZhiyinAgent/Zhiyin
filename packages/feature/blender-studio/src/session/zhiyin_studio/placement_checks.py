"""
Whether an object stands as the real thing would: not wholly inside another
object's solid, where nothing shows it unless that lets light through, and
not tipping over, its centre of mass beyond where it stands. A resting
object's centre of mass is the middle of its solid, its attached parts with
it, or of its surface where it encloses none; where it stands is every point
at which what holds it up touches it, the floor included, seen from above:
what is under it, and what it leans against. What lies on top of it holds
nothing up. An object with nothing under it, as a picture held against a
wall, stands on nothing, and so does one attached to another or going into
another's solid, as a handle's ends go into a mug: it is held by that.
"""

import mathutils
import mathutils.bvhtree
import numpy

from .geometry import bounds_of, holds, sampled, world_mesh
from .loose import meant_to_hang, pieces_of
from .material_marks import lets_light_through
from .overlaps import goes_into, measured
from .shown_mesh import held_by
from .tolerances import HELD
from .wording import length, point_text

# The most of an object's points checked for lying inside another, or touching it.
MOST_POINTS = 4000
# An object tips when its centre of mass is beyond where it stands by more than this share of its width, and this far.
TIP_SHARE, TIP_LEAST = 0.02, 1e-3
# A surface pushes an object up where it faces up by this much, and holds it from the side down to minus this.
UPRIGHT = 0.5


def _points(obj):
    shape = world_mesh(obj)
    try:
        return numpy.array([tuple(p) for p in sampled(shape.verts, MOST_POINTS)], dtype=float).reshape(-1, 3)
    finally:
        shape.free()


def wholly_inside(obj, others):
    """The objects that let no light through whose solid holds the whole of an object, by its points."""
    box = bounds_of(obj)
    if box is None:
        return []
    found, points = [], None
    for other in others:
        if other == obj or holds(obj, other) or holds(other, obj) or lets_light_through(other):
            continue
        theirs = bounds_of(other)
        if not theirs or any(theirs[0][i] > box[0][i] or theirs[1][i] < box[1][i] for i in range(3)):
            continue
        shells = measured(other).shells
        if not shells:
            continue
        if points is None:
            points = _points(obj)
        if len(points) and all(held_by(shells, mathutils.Vector(p)) for p in points[:: max(1, len(points) // 64)].tolist()):
            found.append(other)
    return found


def centre_of_mass(obj):
    """
    The middle of an object's solid, its parts' with it: of its closed
    pieces' volume, a sheet beside them weighing nothing, or, where it
    encloses none, of its surface, as a thin shell's.
    """
    pieces = pieces_of(obj)
    closed = [p.corners[p.triangles] for p in pieces if p.closed]
    if closed:
        corners = numpy.concatenate(closed)
        volumes = numpy.einsum("ij,ij->i", corners[:, 0], numpy.cross(corners[:, 1], corners[:, 2])) / 6
        if abs(volumes.sum()) > 1e-12:
            return mathutils.Vector((volumes[:, None] * corners.sum(axis=1) / 4).sum(axis=0) / volumes.sum())
    if not pieces:
        return None
    corners = numpy.concatenate([p.corners[p.triangles] for p in pieces])
    areas = numpy.linalg.norm(numpy.cross(corners[:, 1] - corners[:, 0], corners[:, 2] - corners[:, 0]), axis=1)
    if not areas.sum():
        return None
    return mathutils.Vector((areas[:, None] * corners.mean(axis=1)).sum(axis=0) / areas.sum())


def _pushed(point, normal, middle, theirs):
    """
    How a surface at a point pushes an object: its normal there turned toward
    the object's middle, or, at the object's own height, away from the middle
    of what pushes it.
    """
    way = mathutils.Vector(normal)
    toward = way.dot(middle - point)
    if abs(toward) < 1e-9:
        toward = -way.dot(theirs - point)
    return way if toward >= 0 else -way


def contacts(obj, checker):
    """
    Where what holds an object up touches it, the floor included: points, the
    names of what they touch, and whether any of them is under it. What lies
    on top of it holds nothing up; what it leans against holds it from the
    side, and stands it up only with what is under it.
    """
    shape = world_mesh(obj)
    try:
        points = numpy.array([tuple(p) for p in sampled(shape.verts, MOST_POINTS)], dtype=float).reshape(-1, 3)
        tree = mathutils.bvhtree.BVHTree.FromBMesh(shape)
    finally:
        shape.free()
    if not len(points):
        return numpy.empty((0, 3)), [], False
    floor = checker.floor()
    touching = [points[points[:, 2] <= floor + HELD]]
    names = ["the floor"] if len(touching[0]) else []
    under = bool(names)
    box = bounds_of(obj)
    middle = (box[0] + box[1]) / 2
    own = {o.as_pointer() for o in [obj, *obj.children_recursive]}
    for other in checker.others:
        theirs = bounds_of(other) if other.as_pointer() not in own else None
        if not theirs or not all(box[1][i] + HELD >= theirs[0][i] and box[0][i] - HELD <= theirs[1][i] for i in range(3)):
            continue
        shape = checker._shape(other)
        if shape is None:
            continue
        their_middle = (theirs[0] + theirs[1]) / 2
        near = shape.corners[((shape.corners >= numpy.array(box[0]) - HELD) & (shape.corners <= numpy.array(box[1]) + HELD)).all(axis=1)]
        found = [p for p in points.tolist() if shape.tree.find_nearest(p, HELD)[0] is not None]
        found += [p for p in near[:: max(1, len(near) // MOST_POINTS)].tolist() if tree.find_nearest(p, HELD)[0] is not None]
        holding, below = [], False
        for p in found:
            point = mathutils.Vector(p)
            inward = middle - point
            # Read a step into the object, so a touch on an edge of either
            # takes the face it pushes through, not the side beside it.
            within = point + inward.normalized() * 2 * HELD if inward.length > 2 * HELD else point
            hit = shape.tree.find_nearest(within, 4 * HELD)
            if hit[0] is None:
                continue
            up = _pushed(point, hit[1], middle, their_middle).z
            if up > -UPRIGHT:
                holding.append(p)
                below = below or up >= UPRIGHT
        if holding:
            touching.append(numpy.array(holding, dtype=float).reshape(-1, 3))
            names.append(other.name)
            under = under or below
    return numpy.concatenate(touching), names, under


def hull(points):
    """The corners of the smallest convex outline round points on a plane, in order round it."""
    unique = sorted({(round(x, 7), round(y, 7)) for x, y in points})
    if len(unique) < 3:
        return unique

    def turn(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower, upper = [], []
    for p in unique:
        while len(lower) >= 2 and turn(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(unique):
        while len(upper) >= 2 and turn(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def beyond(outline, point):
    """How far a point on a plane is outside an outline, and the outline's nearest point: (0, point) inside it."""
    p = mathutils.Vector(point)
    if len(outline) >= 3 and all(
        (b[0] - a[0]) * (p.y - a[1]) - (b[1] - a[1]) * (p.x - a[0]) >= 0 for a, b in zip(outline, outline[1:] + outline[:1])
    ):
        return 0.0, p
    best = None
    pairs = list(zip(outline, outline[1:] + outline[:1])) if len(outline) > 1 else [(outline[0], outline[0])]
    for a, b in pairs:
        a, b = mathutils.Vector(a), mathutils.Vector(b)
        run = b - a
        share = 0.0 if run.length_squared == 0 else max(0.0, min(1.0, (p - a).dot(run) / run.length_squared))
        nearest = a + run * share
        if best is None or (p - nearest).length < best[0]:
            best = ((p - nearest).length, nearest)
    return best


def tipping(obj, checker):
    """Which way an object resting on something would tip over, and by how far its centre of mass is beyond where it stands, or None."""
    # Attached to another, or going into one, it is held by that rather than standing.
    if meant_to_hang(obj) or goes_into(obj, checker.others):
        return None
    # Held against a wall, or with nothing under it, it stands on nothing.
    touching, names, under = contacts(obj, checker)
    if not under:
        return None
    centre = centre_of_mass(obj)
    if centre is None:
        return None
    outline = hull(touching[:, :2].tolist())
    far, nearest = beyond(outline, centre.xy)
    box = bounds_of(obj)
    width = min(box[1][0] - box[0][0], box[1][1] - box[0][1])
    if far <= max(TIP_LEAST, TIP_SHARE * width):
        return None
    way = centre.xy - nearest
    axis = 0 if abs(way.x) >= abs(way.y) else 1
    toward = ("+" if way[axis] > 0 else "-") + "xy"[axis]
    on = " and ".join(names)
    return (
        f"would tip over toward {toward}: its centre of mass, at {point_text(centre)}, is {length(far)} beyond where it"
        f" stands on {on}"
    )
