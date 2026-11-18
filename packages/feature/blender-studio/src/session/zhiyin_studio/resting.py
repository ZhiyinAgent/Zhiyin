"""
Setting an object down: on the floor, on whatever is under it, on one support or several, lowered
straight down until it first touches, and tilted to follow the surface it lands on when asked.
Says what it rests on and how far it was tilted.
"""

import math

import bpy
import mathutils
import mathutils.bvhtree

from .arguments import need
from .contact import gap_text
from .finding import find_object, subjects
from .geometry import bounds_of, sampled, world_mesh
from .tolerances import ALSO_RESTS_ON
from .wording import length, listed

DOWN, UP = mathutils.Vector((0, 0, -1)), mathutils.Vector((0, 0, 1))
FLOOR_NAMES = ("floor", "ground")


def raise_by(obj, height):
    """Moves an object up (or down) in the world, whatever it is attached to."""
    moved = obj.matrix_world.copy()
    moved.translation.z += height
    obj.matrix_world = moved
    bpy.context.view_layer.update()


def over(own, below):
    """Whether one box lies over another, seen from above."""
    return all(own[0][i] < below[1][i] and own[1][i] > below[0][i] for i in (0, 1))


def supports_named(obj, on):
    """
    What `on` names to rest on: a floor object under it for "floor" (none means z = 0), every
    shape under it for "below", one object, or a list of them.
    """
    held = {obj, *obj.children_recursive}
    own = bounds_of(obj)
    if on == "floor":
        return [
            o
            for o in subjects()
            if o not in held and o.name.lower() in FLOOR_NAMES and (box := bounds_of(o)) and over(own, box)
        ]
    if on == "below":
        found = [
            o
            for o in subjects()
            if o not in held
            and o.parent not in held
            and (box := bounds_of(o)) is not None
            and over(own, box)
            and box[0].z < own[0].z
        ]
        need(found, f"Nothing is below “{obj.name}” to rest it on. Give it a location over something, or rest it on the floor.")
        return found
    names = [on] if isinstance(on, str) else on
    need(
        isinstance(names, list) and names and all(isinstance(n, str) and n.strip() for n in names),
        "rest_on is “floor”, “below”, an object's name, or a list of names.",
    )
    found = [find_object(n) for n in names]
    for support in found:
        need(support != obj and support not in obj.children_recursive, f"“{obj.name}” cannot rest on itself.")
    return found


def lower_onto(obj, supports):
    """
    Lowers an object straight down onto the supports until it first touches one of them; the
    supports it rests on then, nearest first.
    """
    bpy.context.view_layer.update()
    own = bounds_of(obj)
    boxes = [(s, bounds_of(s)) for s in supports]
    for support, box in boxes:
        need(box is not None, f"“{support.name}” has no shape to rest on.")
    under = [(s, b) for s, b in boxes if over(own, b)]
    if len(supports) == 1:
        need(under, f"“{obj.name}” is not above “{supports[0].name}”. Give it a location over it first.")
    else:
        need(
            under,
            f"“{obj.name}” is not above any of {listed(f'“{s.name}”' for s in supports)}. Give it a location over them first.",
        )
    # Lifted clear of every support, then lowered until it first touches one.
    raise_by(obj, max(0.0, max(b[1].z for _, b in under) - own[0].z) + 0.001)
    lifted = bounds_of(obj)
    falling = world_mesh(obj)
    drops = []
    try:
        falling_tree = mathutils.bvhtree.BVHTree.FromBMesh(falling)
        for support, box in under:
            gap = gap_to(falling, falling_tree, support, lifted, box)
            if gap is not None:
                drops.append((gap, support))
    finally:
        falling.free()
    if len(supports) == 1:
        need(drops, f"No part of “{supports[0].name}” is below “{obj.name}”. Give it a location over it first.")
    else:
        need(drops, f"No part of {listed(f'“{s.name}”' for s in supports)} is below “{obj.name}”. Give it a location over them first.")
    drop = min(gap for gap, _ in drops)
    raise_by(obj, -drop)
    return [s for gap, s in sorted(drops, key=lambda d: d[0]) if gap - drop <= ALSO_RESTS_ON]


def gap_to(falling, falling_tree, support, lifted, box):
    """How far the lifted object can drop before it touches the support, or None when it misses it."""
    ground = world_mesh(support)
    try:
        ground_tree = mathutils.bvhtree.BVHTree.FromBMesh(ground)
        gaps = [hit[3] for p in sampled(falling.verts) if (hit := ground_tree.ray_cast(p, DOWN))[0] is not None]
        gaps += [hit[3] for p in sampled(ground.verts) if (hit := falling_tree.ray_cast(p, UP))[0] is not None]
        # Two shapes can first touch between their corners, as crossed logs
        # do: columns over where they overlap find that place.
        low = [max(lifted[0][i], box[0][i]) for i in (0, 1)]
        high = [min(lifted[1][i], box[1][i]) for i in (0, 1)]
        gaps += column_gaps(falling_tree, ground_tree, low, high, lifted[0].z - 1)
    finally:
        ground.free()
    return min(gaps) if gaps else None


def column_gap(falling_tree, ground_tree, x, y, under):
    """How far the falling shape's lowest point above (x, y) is from the ground below it, or None."""
    bottom = falling_tree.ray_cast(mathutils.Vector((x, y, under)), UP)[0]
    if bottom is None:
        return None
    return ground_tree.ray_cast(bottom, DOWN)[3]


def column_gaps(falling_tree, ground_tree, low, high, under, count=48):
    """
    The gaps in a grid of columns over the area from `low` to `high`, then in
    finer grids round the narrowest, so a meeting between corners is found
    to a fraction of a millimetre. A column never finds a gap narrower than
    the true one, so a shape is never set down into another.
    """
    gaps = []
    for _ in range(4):
        step = [(high[i] - low[i]) / (count - 1) for i in (0, 1)]
        best = None
        for i in range(count):
            for j in range(count):
                x, y = low[0] + i * step[0], low[1] + j * step[1]
                gap = column_gap(falling_tree, ground_tree, x, y, under)
                if gap is not None:
                    gaps.append(gap)
                    if best is None or gap < best[0]:
                        best = (gap, x, y)
        if best is None:
            break
        low = [best[1] - step[0], best[2] - step[1]]
        high = [best[1] + step[0], best[2] + step[1]]
        count = 9
    return gaps


def surface_under(obj, support):
    """Where the object's bottom meets the support below its middle, and which way that surface faces."""
    box = bounds_of(obj)
    middle = mathutils.Vector(((box[0].x + box[1].x) / 2, (box[0].y + box[1].y) / 2, box[0].z + 0.01))
    ground = world_mesh(support)
    try:
        tree = mathutils.bvhtree.BVHTree.FromBMesh(ground)
        hit, normal, _, _ = tree.ray_cast(middle, DOWN)
        if hit is None:
            hit, normal, _, _ = tree.find_nearest(middle)
    finally:
        ground.free()
    if normal.z < 0:
        normal = -normal
    return hit, normal.normalized()


def tilt_to(obj, support):
    """Turns the object about where it touches so its up follows the support's surface; the tilt in degrees."""
    contact, normal = surface_under(obj, support)
    up = (obj.matrix_world.to_3x3() @ UP).normalized()
    turn = up.rotation_difference(normal)
    obj.matrix_world = (
        mathutils.Matrix.Translation(contact) @ turn.to_matrix().to_4x4() @ mathutils.Matrix.Translation(-contact)
    ) @ obj.matrix_world
    bpy.context.view_layer.update()
    return math.degrees(turn.angle)


def resting_on(spec, name):
    """What a call asks an object to rest on: rest_on, or the several of rest_across, or nothing."""
    on, across = spec.get("rest_on"), spec.get("rest_across")
    need(on is None or across is None, f"“{name}” rests on what rest_on names or across what rest_across lists: give one of them.")
    if across is not None:
        need(isinstance(across, list) and across, "rest_across lists the objects to set it down across.")
        return across
    need(
        not spec.get("align_to_surface") or on is not None,
        f"align_to_surface tilts “{name}” to what it rests on: give rest_on or rest_across too.",
    )
    return on


def rest(obj, on, align=False):
    """
    Sets an object down as if lowered straight onto what `on` names: the floor, whatever is
    below it, one object or several. It lands on the first surface it meets, so a mug lands in a
    saucer's well, not at the height of its rim, and a plank on the taller of two trestles. With
    `align`, it is turned to follow the surface it landed on, then lowered again. Answers what it
    rests on, in words.
    """
    need(on is not None and on != "", "rest_on is “floor”, “below”, an object's name, or a list of names.")
    bpy.context.view_layer.update()
    own = bounds_of(obj)
    need(own is not None, f"“{obj.name}” has no shape to rest.")
    supports = supports_named(obj, on)
    if not supports:
        need(not align, f"The floor at z 0 is flat, so “{obj.name}” has nothing to tilt to; leave out align_to_surface.")
        raise_by(obj, -own[0].z)
        return f"resting on floor, gap {length(bounds_of(obj)[0].z)}"
    resting = lower_onto(obj, supports)
    said = f"resting on {listed(s.name for s in resting)}"
    if align:
        tilted = tilt_to(obj, resting[0])
        resting = lower_onto(obj, supports)
        said = f"resting on {listed(s.name for s in resting)}" + (
            f", tilted {tilted:.3g}° to follow {resting[0].name}" if tilted >= 0.05 else f", already square to {resting[0].name}"
        )
    return f"{said}, {gaps_text(obj, resting)}"


def gaps_text(obj, resting):
    """The gap measured between an object and each support it rests on, surface to surface: 0 mm where they touch."""
    gaps = [gap_text(obj, support) for support in resting]
    if len(set(gaps)) == 1:
        return gaps[0] + (" to each" if len(gaps) > 1 else "")
    return "; ".join(f"{gap} to {support.name}" for gap, support in zip(gaps, resting))
