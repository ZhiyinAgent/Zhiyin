"""
Keys as Blender keeps them: in an action, on the slot an owner uses, in its
curves. Copying an object or its data shares its action, so the copy is given
one of its own.
"""

import bpy
from bpy_extras import anim_utils

# A key's straight interpolation, by the number Blender keeps it as.
_LINEAR = bpy.types.Keyframe.bl_rna.properties["interpolation"].enum_items["LINEAR"].value

# How a key is reached from the one before it: the tools' names for
# Blender's interpolations and easings.
EASINGS = {
    "smooth": ("BEZIER", "AUTO"),
    "linear": ("LINEAR", "AUTO"),
    "ease_in": ("SINE", "EASE_IN"),
    "ease_out": ("SINE", "EASE_OUT"),
    "ease_in_out": ("SINE", "EASE_IN_OUT"),
    "constant": ("CONSTANT", "AUTO"),
    "bounce": ("BOUNCE", "EASE_OUT"),
    "elastic": ("ELASTIC", "EASE_OUT"),
    "overshoot": ("BACK", "EASE_OUT"),
}


def eased(curves, frame, easing):
    """
    Sets how each curve reaches its key at `frame` from the key before: in
    Blender a key's interpolation is how it moves on to the next one, so it is
    set on the key before.
    """
    interpolation, ease = EASINGS[easing]
    for curve in curves:
        keys = sorted(curve.keyframe_points, key=lambda k: k.co.x)
        before = [k for k in keys if k.co.x < frame - 1e-4]
        if before:
            before[-1].interpolation = interpolation
            before[-1].easing = ease


def curves_of(owner):
    """An animated owner's curves: an object's, a camera's or light's, a material's, a shape's."""
    data = getattr(owner, "animation_data", None)
    if data is None or data.action is None or data.action_slot is None:
        return []
    bag = anim_utils.action_get_channelbag_for_slot(data.action, data.action_slot)
    return list(bag.fcurves) if bag is not None else []


def fcurves_of(owner):
    """
    The F-curves keying a data block, as a script reaches them in Blender 5: Action.fcurves is gone,
    and an action holds them in the channelbag of the slot the block uses. An empty list when it is
    not animated. Given to every script by this name.
    """
    return curves_of(owner)


def own_keys(owner):
    """Gives an owner that shares its keys with what it was copied from a copy of them."""
    data = getattr(owner, "animation_data", None)
    if data is None or data.action is None:
        return
    slot = data.action_slot.identifier if data.action_slot is not None else None
    data.action = data.action.copy()
    for candidate in data.action.slots:
        if candidate.identifier == slot:
            data.action_slot = candidate


def scale_keys(owner, path, factors):
    """Multiplies every key of a vector property by `factors`, so its motion keeps its shape."""
    for curve in curves_of(owner):
        if curve.data_path != path or curve.array_index >= len(factors):
            continue
        factor = factors[curve.array_index]
        for key in curve.keyframe_points:
            key.co.y *= factor
            key.handle_left.y *= factor
            key.handle_right.y *= factor
        curve.update()


def stretch_keys(owner, path, factors, shifts):
    """Multiplies every key of a vector property by `factors`, then moves it by `shifts`, as a stretch moves a place."""
    for curve in curves_of(owner):
        if curve.data_path != path or curve.array_index >= len(factors):
            continue
        factor, shift = factors[curve.array_index], shifts[curve.array_index]
        for key in curve.keyframe_points:
            key.co.y = key.co.y * factor + shift
            key.handle_left.y = key.handle_left.y * factor + shift
            key.handle_right.y = key.handle_right.y * factor + shift
        curve.update()


def shift_keys(owner, path, by):
    """Moves every key of a vector property by `by`, so its motion keeps its shape."""
    for curve in curves_of(owner):
        if curve.data_path != path or curve.array_index >= len(by):
            continue
        step = by[curve.array_index]
        for key in curve.keyframe_points:
            key.co.y += step
            key.handle_left.y += step
            key.handle_right.y += step
        curve.update()



def key_channel(owner, path, index, frames, values):
    """
    Keys one channel of an owner at each of `frames` to the value given for
    it, straight between them, in place of the keys it had, all in one step:
    a key added on its own costs more the more keys its channel holds.
    Answers the channel's curve.
    """
    owner.keyframe_insert(path, index=index, frame=frames[0])
    curve = next(c for c in curves_of(owner) if c.data_path == path and c.array_index == index)
    points = curve.keyframe_points
    points.clear()
    points.add(len(frames))
    points.foreach_set("co", [number for pair in zip(frames, values) for number in pair])
    points.foreach_set("interpolation", [_LINEAR] * len(frames))
    curve.update()
    return curve
