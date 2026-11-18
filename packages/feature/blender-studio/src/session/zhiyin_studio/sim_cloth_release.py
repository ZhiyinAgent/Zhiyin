"""
Pins that let go: a cloth's pinned points held until a time, then left to move freely. A vertex weight
step placed just before the cloth sets the pin group's weights to nothing once its mask, keyed with
no easing, turns from 0 to 1 at the frame the pins let go; the cloth reads the weights it is given,
so from that frame no point is held. Setting a cloth up again replaces the step, and a cloth set up
without a release has none.
"""

import math

from bpy_extras import anim_utils

from .arguments import need, number
from .finding import scene
from .timeline import frame_of, seconds_of, seconds_text

# The step's name, by which it is found again.
RELEASE = "Pins let go"
MASK = f'modifiers["{RELEASE}"].mask_constant'


def _channelbag(obj):
    data = obj.animation_data
    if data is None or data.action is None or data.action_slot is None:
        return None
    return anim_utils.action_get_channelbag_for_slot(data.action, data.action_slot)


def _curves(obj):
    bag = _channelbag(obj)
    return [c for c in bag.fcurves if c.data_path == MASK] if bag is not None else []


def unrelease(obj):
    """Removes the step that lets the pins go, and its keys, so a step made again starts with none."""
    for step in [m for m in obj.modifiers if m.type == "VERTEX_WEIGHT_MIX" and m.name == RELEASE]:
        obj.modifiers.remove(step)
    bag = _channelbag(obj)
    for curve in _curves(obj):
        bag.fcurves.remove(curve)


def release_frame(obj):
    """The frame from which the cloth's pins hold nothing, or None when they hold throughout."""
    if not any(m.type == "VERTEX_WEIGHT_MIX" and m.name == RELEASE and m.show_viewport for m in obj.modifiers):
        return None
    keys = [k.co.x for c in _curves(obj) for k in c.keyframe_points if k.co.y >= 0.5]
    return round(min(keys)) if keys else None


def release(obj, cloth, group, seconds):
    """Lets the pin group go at a time on the timeline, the line saying when."""
    room = scene()
    end = f"{seconds_text(seconds_of(room.frame_end))} (frame {room.frame_end})"
    given = number(seconds, "pinned.release")
    frame = math.ceil(frame_of(given) - 1e-6)
    need(
        room.frame_start < frame <= room.frame_end,
        f"pinned.release is after the timeline's start and by its end, {end}.",
    )
    step = obj.modifiers.new(RELEASE, "VERTEX_WEIGHT_MIX")
    step.vertex_group_a = group
    step.default_weight_b = 0.0
    step.mix_mode = "SET"
    step.mix_set = "A"
    steps = list(obj.modifiers)
    obj.modifiers.move(steps.index(step), steps.index(cloth))
    step.mask_constant = 0.0
    step.keyframe_insert("mask_constant", frame=frame - 1)
    step.mask_constant = 1.0
    step.keyframe_insert("mask_constant", frame=frame)
    for curve in _curves(obj):
        for key in curve.keyframe_points:
            key.interpolation = "CONSTANT"
    return f"they let go at {seconds_text(seconds_of(frame))} (frame {frame}) and move freely from then on"
