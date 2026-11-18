"""
Moving an object until it meets another: pushed along an axis against one of the other's sides
until their surfaces meet, or a chosen point of it laid on a chosen point of the other's shape.
Says the gap measured after, 0 mm when they touch, on which side they meet, and how deep they
go into each other when they do.
"""

import bpy
import mathutils
import numpy

from .arguments import need, number
from .finding import find_object
from .geometry import has_shape
from .measure_shapes import Mesh, Shape, first_hit, into, nearest
from .placing import place_in_world
from .tolerances import TOUCH
from .wording import length, one_of, point_text

# Each side of the other object, as the axis it lies along and which way from its middle.
SIDES = {"left": (0, -1), "right": (0, 1), "front": (1, -1), "back": (1, 1), "bottom": (2, -1), "top": (2, 1)}
AXES = "xyz"
# How far past the other's box an object is set before it is pushed back against it.
CLEAR = 0.001
# The gap against leaves by default, in metres.
AGAINST_GAP = 0
# A point of the moved object, from its box in the world.
OWN_POINTS = ("bottom-centre", "top-centre", "centre", "front-centre", "back-centre", "left-centre", "right-centre", "origin")
TARGETS = ("top-centre", "nearest-surface", "nearest-vertex", "edge-midpoint", "face-centre")


def shape_of(obj):
    """An object's whole shape in the world, its parts and the instances it places with it."""
    bpy.context.view_layer.update()
    mesh = Mesh.of_object(obj)
    need(not mesh.empty, f"“{obj.name}” has no shape to move against another.")
    return Shape(mesh, label=obj.name)


def other_of(obj, spec, what):
    """The object a move goes against or onto: not the object itself, nor one of its parts."""
    other = find_object(spec.get("object"))
    need(other != obj, f"“{obj.name}” cannot be moved against itself.")
    need(other not in obj.children_recursive, f"“{other.name}” is attached to “{obj.name}”, so it moves with it: {what} needs another object.")
    need(has_shape(other), f"“{other.name}” has no shape to move against.")
    return other


def move_by(obj, shift):
    bpy.context.view_layer.update()
    place_in_world(obj, location=obj.matrix_world.translation + mathutils.Vector(shift))
    bpy.context.view_layer.update()


def side_words(i, sign):
    return f"{'+' if sign > 0 else '-'}{AXES[i]}"


def gap_text(obj, other):
    """The gap between two objects' surfaces as measured now: 0 mm when they touch, or how deep they go into each other."""
    mine, theirs = shape_of(obj), shape_of(other)
    went = into(mine, theirs)
    if went is not None:
        depth = went[0]
        return f"going {length(depth)} into it" if depth > 0 else "crossing it"
    distance = nearest(mine, theirs)[0]
    return "gap 0 mm" if distance <= TOUCH else f"gap {length(distance)}"


def push_against(obj, spec):
    """
    Pushes an object along one axis against a side of another until their surfaces meet, or
    stand `gap` apart. It is first set just past the other's box on that side, keeping where it is
    across, then moved back by the least distance a ray from either shape meets the other.
    Answers what it says of the move.
    """
    need(isinstance(spec, dict), "against is {object, side, gap}.")
    side = spec.get("side")
    need(side in SIDES, f"against side is {one_of(SIDES)}.")
    other = other_of(obj, spec, "against")
    gap = number(spec.get("gap"), "against gap", minimum=0, default=AGAINST_GAP)
    i, sign = SIDES[side]
    mine, theirs = shape_of(obj), shape_of(other)
    across = [k for k in range(3) if k != i]
    need(
        all(mine.low[k] < theirs.high[k] and mine.high[k] > theirs.low[k] for k in across),
        f"“{obj.name}” is not across from “{other.name}” along {AXES[i]}, so pushed along it it would pass it: "
        f"give it a location level with it in {' and '.join(AXES[k] for k in across)} first.",
    )
    # Set clear of the other on that side, keeping its place across.
    clear = (theirs.high[i] - mine.low[i] if sign > 0 else mine.high[i] - theirs.low[i]) + CLEAR
    shift = [0.0, 0.0, 0.0]
    shift[i] = sign * max(clear, 0.0)
    move_by(obj, shift)
    mine = shape_of(obj)
    toward = [0.0, 0.0, 0.0]
    toward[i] = -sign
    hits = [found[0] for found in (first_hit(mine, [theirs], toward), first_hit(theirs, [mine], [-v for v in toward])) if found]
    need(
        hits,
        f"Pushed along {side_words(i, -sign)}, no part of “{obj.name}” meets “{other.name}”: give it a location level with it first.",
    )
    travel = min(hits) - gap
    toward[i] = -sign * travel
    move_by(obj, toward)
    # The surfaces were met where a ray from a point found them: a meeting between
    # those points can lie nearer, and the shape is backed out of it.
    went = into(shape_of(obj), theirs)
    if went is not None and went[0] > 0:
        back = [0.0, 0.0, 0.0]
        back[i] = sign * went[0]
        move_by(obj, back)
    return f"pushed against {other.name}'s {side} side ({side_words(i, sign)}), {gap_text(obj, other)}"


def own_point(obj, which):
    """A point of the moved object, by its box in the world, or its origin."""
    bpy.context.view_layer.update()
    if which == "origin":
        return obj.matrix_world.translation.copy()
    shape = shape_of(obj)
    low, high = mathutils.Vector(shape.low), mathutils.Vector(shape.high)
    middle = (low + high) / 2
    place = {
        "bottom-centre": (middle.x, middle.y, low.z),
        "top-centre": (middle.x, middle.y, high.z),
        "centre": tuple(middle),
        "front-centre": (middle.x, low.y, middle.z),
        "back-centre": (middle.x, high.y, middle.z),
        "left-centre": (low.x, middle.y, middle.z),
        "right-centre": (high.x, middle.y, middle.z),
    }[which]
    return mathutils.Vector(place)


def target_point(theirs, which, start):
    """A point of the other's shape: where a ray down through its middle meets its top, or its surface, corner, edge middle or face middle nearest `start`."""
    if which == "top-centre":
        middle = (theirs.low + theirs.high) / 2
        above = mathutils.Vector((middle[0], middle[1], theirs.high[2] + 1))
        hit, normal, _, _ = theirs.surface.ray_cast(above, mathutils.Vector((0, 0, -1)))
        if hit is None:
            hit, normal, _, _ = theirs.surface.find_nearest(mathutils.Vector((middle[0], middle[1], theirs.high[2])))
        return hit, normal
    if which == "nearest-surface":
        hit, normal, _, _ = theirs.surface.find_nearest(start)
        return hit, normal
    if which == "nearest-vertex":
        candidates = theirs.verts
    else:
        corners = [numpy.array(face) for face in theirs.mesh.polygons]
        if which == "edge-midpoint":
            candidates = numpy.concatenate([(theirs.verts[c] + theirs.verts[numpy.roll(c, -1)]) / 2 for c in corners])
        else:
            candidates = numpy.array([theirs.verts[c].mean(axis=0) for c in corners])
    index = int(numpy.argmin(numpy.linalg.norm(candidates - numpy.array(start), axis=1)))
    point = mathutils.Vector(candidates[index])
    _, normal, _, _ = theirs.surface.find_nearest(point)
    return point, normal


def facing_words(normal, theirs, point):
    """Which way the other's surface faces where the point was laid: the axis it most faces, away from its middle."""
    if normal is None:
        return ""
    way = mathutils.Vector(normal)
    middle = mathutils.Vector((theirs.low + theirs.high) / 2)
    if way.dot(point - middle) < 0:
        way = -way
    i = max(range(3), key=lambda k: abs(way[k]))
    return f", on its side facing {side_words(i, 1 if way[i] > 0 else -1)}"


def move_onto(obj, spec):
    """
    Moves an object so a point of it, by its box or its origin, lies on a point of another's
    shape: the top of its middle, or the surface, corner, edge middle or face middle nearest that
    point. Answers what it says of the move.
    """
    need(isinstance(spec, dict), "to is {object, point, by}.")
    which = spec.get("point")
    need(which in TARGETS, f"to point is {one_of(TARGETS)}.")
    by = spec.get("by", "bottom-centre")
    need(by in OWN_POINTS, f"to by is {one_of(OWN_POINTS)}.")
    other = other_of(obj, spec, "to")
    theirs = shape_of(other)
    start = own_point(obj, by)
    target, normal = target_point(theirs, which, start)
    need(target is not None, f"“{other.name}” has no surface to move “{obj.name}” onto.")
    move_by(obj, target - start)
    # A corner or an edge's middle faces several ways; a face, one.
    facing = facing_words(normal, theirs, target) if which in ("top-centre", "nearest-surface", "face-centre") else ""
    return f"moved so its {by} is on {other.name}'s {which} at {point_text(target)}{facing}, {gap_text(obj, other)}"
