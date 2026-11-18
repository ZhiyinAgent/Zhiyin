"""
Parts moved as the CAD placed them: a motion file the CAD studio writes
holds, for each part that moves, how its build at each position is moved
from its build at the first, measured from the part itself. Each object
brought in from the model is keyed at every frame through those positions,
smoothly between them, so what the CAD checked is what the video shows.
"""

import json
import math
import os

import bpy
import mathutils
from bpy_extras import anim_utils

from .arguments import is_number, need
from .errors import Refused
from .follow import followers, unfollow
from .keys import curves_of, key_channel
from .timeline import START, frame_of, frames_from, moment, seconds_of

# What a model brought in marks on its group and on each of its parts.
MODEL = "zhiyin_model"
PLACED = "zhiyin_placed"
TRANSFORMS = ("location", "rotation_euler", "scale")


def mark_model(group, parts):
    """Marks a model brought in, so a CAD motion finds its frame and each part's place in it as brought in."""
    group[MODEL] = True
    for obj in parts:
        obj[PLACED] = [value for row in obj.matrix_local for value in row]


def _matrix(values, scale=1.0):
    need(isinstance(values, list) and len(values) == 16 and all(is_number(v) for v in values), "A motion file's placement is 16 numbers.")
    matrix = mathutils.Matrix([values[0:4], values[4:8], values[8:12], values[12:16]])
    for row in range(3):
        matrix[row][3] *= scale
    return matrix


def _model_of(obj):
    """The model group an object was brought in with, or nothing."""
    up = obj.parent
    while up is not None and not up.get(MODEL):
        up = up.parent
    return up


def _unkeyed(obj):
    """Removes an object's keys of its place, turn and size, and what it follows."""
    if followers(obj):
        unfollow(obj)
    data = obj.animation_data
    if data is None or data.action is None or data.action_slot is None:
        return
    bag = anim_utils.action_get_channelbag_for_slot(data.action, data.action_slot)
    for curve in [c for c in bag.fcurves if c.data_path in TRANSFORMS] if bag is not None else []:
        bag.fcurves.remove(curve)


def _smooth(samples, at, cycle):
    """
    A value between evenly spaced samples, `at` counted in samples, through
    each of them: a cubic through its neighbours, which for a cycle run on
    past its ends as the cycle repeats.
    """
    count = len(samples)

    def sample(k):
        if cycle:
            # samples[-1] closes the cycle: it is the first, carried on by a turn.
            span = count - 1
            laps, k = divmod(k, span)
            return samples[k] + laps * (samples[-1] - samples[0])
        return samples[min(max(k, 0), count - 1)]

    k = math.floor(at)
    t = at - k
    p0, p1, p2, p3 = sample(k - 1), sample(k), sample(k + 1), sample(k + 2)
    return 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t * t * t)


def _straight(samples, at):
    """A value between evenly spaced samples, `at` counted in samples, on the straight line between the two it lies between."""
    k = min(math.floor(at), len(samples) - 2)
    t = at - k
    return samples[k] + (samples[k + 1] - samples[k]) * t


# The values whose keys move an object on its own, relative to what it is attached to.
OWN_MOTION = (
    "location",
    "rotation_euler",
    "rotation_quaternion",
    "rotation_axis_angle",
    "scale",
    "delta_location",
    "delta_rotation_euler",
    "delta_rotation_quaternion",
    "delta_scale",
)


def _moves_by_itself(obj):
    """How an object moves on its own, relative to what it is attached to, or nothing."""
    if any(curve.data_path in OWN_MOTION for curve in curves_of(obj)):
        return "by keys of its own"
    if followers(obj):
        return "by following another"
    if len(obj.constraints):
        return "by a constraint"
    return None


def _carrier(obj, model, worlds):
    """
    Where what a part is attached to is at each position, from its carrier up
    to the model's group: on a part this call keys, at that part's placements;
    on what stays put on the model, where it is now. Or why it cannot be said:
    a link in the way moves on its own, and the two motions would add up.
    """
    through, up, fixed = [], obj.parent, mathutils.Matrix.Identity(4)
    while up is not None and up != model:
        if up.name in worlds:
            return [placed @ fixed for placed in worlds[up.name]]
        how = _moves_by_itself(up)
        if how:
            way = f"through {', '.join(through)} " if through else ""
            return f"attached {way}to {up.name}, which moves {how}"
        through.append(up.name)
        fixed = up.matrix_local @ fixed
        up = up.parent
    return None


def key_motion(spec, said_by_object):
    """Keys every part of a CAD motion file found in the scene; answers the time its keys reach."""
    need(isinstance(spec, dict), "cad_motion names its file, from and to.")
    path = spec.get("file")
    need(isinstance(path, str) and os.path.isfile(path), "cad_motion's file is a motion file cad_build wrote, with positions and a .json export.")
    with open(path, encoding="utf-8") as given:
        try:
            motion = json.load(given)
        except ValueError:
            raise Refused(f"{spec.get('file')} is not a motion file cad_build wrote.") from None
    need(isinstance(motion, dict) and isinstance(motion.get("parts"), dict) and isinstance(motion.get("positions"), list), f"{spec.get('file')} is not a motion file cad_build wrote.")
    count = len(motion["positions"])
    need(count >= 2, f"{spec.get('file')} holds one position: a motion needs two or more.")
    start = moment(spec.get("from"), "from", default=START)
    end = moment(spec.get("to"), "to")
    need(end > start, "to comes after from.")
    cycle = bool(spec.get("cycle"))
    # An assembly sequence: each part goes straight from one position to the next, and waits there.
    straight = motion.get("straight") is True
    missing, refused, keyed = [], [], []
    # Parents before the parts attached to them, so each is placed on its parent as moved.
    found = {}
    for name, moves in motion["parts"].items():
        obj = bpy.data.objects.get(name)
        if obj is None or obj.name not in bpy.context.scene.objects:
            missing.append(name)
            continue
        found[name] = (obj, [_matrix(m, 0.001) for m in moves])
    depth = lambda obj: 0 if obj.parent is None else 1 + depth(obj.parent)
    # The first and last keys at the very start and end, a part frame where
    # either falls between two, so a cycle repeats at exactly its length.
    frames = frames_from(frame_of(start), frame_of(end))
    span = count if cycle else count - 1
    shares = [min(max((seconds_of(f) - start) / (end - start) * span, 0.0), float(span)) for f in frames]
    # The placements of each part this call keys; a part refused has none.
    worlds = {}
    for name, (obj, moves) in sorted(found.items(), key=lambda item: depth(item[1][0])):
        model = _model_of(obj)
        if model is None:
            refused.append(f"{name}, which was not brought in from a model file")
            continue
        need(len(moves) == count, f"{spec.get('file')} gives {name} {len(moves)} placements for {count} positions.")
        # Keyed on its parent's axes: the model's, or a part's it is attached to, as that part moves.
        carrier = _carrier(obj, model, worlds)
        if isinstance(carrier, str):
            refused.append(f"{name}, {carrier}")
            continue
        # Where it was brought in, in the model's frame: kept from then, or
        # where it is now, for a part brought in before that was kept.
        rest = _matrix(list(obj[PLACED])) if obj.get(PLACED) is not None else model.matrix_world.inverted() @ obj.matrix_world
        world = [model.matrix_world @ move @ rest for move in moves]
        worlds[obj.name] = world
        bases = [((carrier[k] if carrier else obj.parent.matrix_world) @ obj.matrix_parent_inverse).inverted() @ world[k] for k in range(count)]
        _unkeyed(obj)
        obj.rotation_mode = "XYZ"
        samples, euler = [], None
        for basis in bases + ([bases[0]] if cycle else []):
            location, turn, size = basis.decompose()
            euler = turn.to_euler("XYZ", euler) if euler is not None else turn.to_euler("XYZ")
            samples.append(mathutils.Vector((*location, *euler, *size)))
        values = [_straight(samples, at) if straight else _smooth(samples, at, cycle) for at in shares]
        for channel, transform in enumerate(TRANSFORMS):
            for axis in range(3):
                curve = key_channel(obj, transform, axis, frames, [value[channel * 3 + axis] for value in values])
                if cycle:
                    repeat = curve.modifiers.new("CYCLES")
                    repeat.mode_before = "NONE"
                    repeat.mode_after = "REPEAT_OFFSET"
        keyed.append(name)
    said = said_by_object.setdefault(os.path.basename(path), [])
    if keyed:
        said.append(
            f"{len(keyed)} {'part' if len(keyed) == 1 else 'parts'} keyed at every frame from {start:g} s to {end:g} s through its {count} positions"
            + (", as a cycle that runs on" if cycle else "")
            + f": {', '.join(keyed[:30])}{' and more' if len(keyed) > 30 else ''}"
        )
    if missing:
        said.append(f"not in the scene, so not keyed: {', '.join(missing[:30])}")
    if refused:
        said.append(f"not keyed: {'; '.join(refused[:10])}")
    for name, why in (motion.get("unfitted") or {}).items():
        said.append(f"{name} changes shape between positions in a way no move, turn and stretch gives ({why}), so it was not keyed")
    need(keyed, f"No part of {spec.get('file')} was keyed: " + "; ".join(said))
    if straight:
        said.append(part_order(worlds, count, start, end))
    return end


# Each step of an assembly sequence named in its order, up to this many; the rest are counted.
STEPS_SAID = 12
# A part that moves less than this between two positions, and turns less, waits.
STILL_MOVE, STILL_TURN = 1e-5, math.radians(0.01)


def part_order(worlds, count, start, end):
    """The order an assembly sequence puts its parts in: at each step, which parts move, how far and when."""
    span = (end - start) / (count - 1)
    steps = []
    for k in range(count - 1):
        moving = []
        for name, world in worlds.items():
            shift = (world[k + 1].translation - world[k].translation).length
            turn = world[k].to_quaternion().rotation_difference(world[k + 1].to_quaternion()).angle
            if shift > STILL_MOVE or min(turn, 2 * math.pi - turn) > STILL_TURN:
                moving.append(f"{name} {shift * 1000:.4g} mm" if shift > STILL_MOVE else f"{name} turning")
        when = f"{start + k * span:g} s to {start + (k + 1) * span:g} s"
        steps.append(f"{when}: {', '.join(moving)}" if moving else f"{when}: nothing moves")
    more = len(steps) - STEPS_SAID
    return "the parts go in this order, one step to each position: " + "; ".join(steps[:STEPS_SAID]) + (f"; and {more} more steps" if more > 0 else "")
