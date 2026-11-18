"""
An armature's bones keyed over time: turned in degrees about their own axes from their rest,
moved along them, or reaching for a point with their IK target; and poses saved on the armature by
name, keyed by name. The answer gives each keyed bone's tip in the world at its key, measured once
the call's other motion is set.
"""

import math

import bpy
import mathutils

from .animate_measures import defer
from .arguments import is_number, need, vector
from .finding import find_object
from .keys import EASINGS, curves_of, eased
from .timeline import back_to, frame_of, go_to, moment, now, seconds_text
from .wording import length, point_text

# Where an armature keeps the poses saved on it by name.
POSES = "zhiyin_poses"
# What a bone key may set.
BONE_FIELDS = {"object", "at", "bone", "rotation", "location", "reach", "easing"}
POSE_FIELDS = {"object", "at", "pose", "easing"}
# A tip this far from the point it reaches for is short of it.
REACHED = 0.001
# The most bones of a pose whose tips are said.
TIPS_SAID = 6


def armature_of(spec):
    obj = find_object(spec.get("object"))
    need(obj.type == "ARMATURE", f"“{obj.name}” is a {obj.type.lower()}; bones and poses are an armature's.")
    return obj


def bone_of(obj, name):
    need(isinstance(name, str) and name.strip(), "bone names one of the armature's bones.")
    bone = obj.pose.bones.get(name)
    if bone is None:
        names = [b.name for b in obj.pose.bones][:40]
        need(False, f"{obj.name} has no bone named “{name}”. Its bones: {', '.join(names) or 'none'}.")
    return bone


def turn_path(bone):
    """The property a bone's turn is keyed on, as its own rotation mode keeps it."""
    if bone.rotation_mode == "QUATERNION":
        return "rotation_quaternion"
    if bone.rotation_mode == "AXIS_ANGLE":
        return "rotation_axis_angle"
    return "rotation_euler"


def turn_bone(bone, degrees):
    """Turns a bone about its own axes from its rest, in its own rotation mode."""
    euler = mathutils.Euler([math.radians(d) for d in degrees], "XYZ")
    if bone.rotation_mode == "QUATERNION":
        bone.rotation_quaternion = euler.to_quaternion()
    elif bone.rotation_mode == "AXIS_ANGLE":
        axis, angle = euler.to_quaternion().to_axis_angle()
        bone.rotation_axis_angle = (angle, *axis)
    else:
        # Angles as given, so a turn past half a turn stays one.
        bone.rotation_euler = euler if bone.rotation_mode == "XYZ" else euler.to_matrix().to_euler(bone.rotation_mode, bone.rotation_euler)
    return turn_path(bone)


def unconnected(bone, what):
    """Refuses to move a bone joined to the one before it, which Blender moves only by turning."""
    need(
        not (bone.bone.use_connect and bone.parent is not None),
        f"{bone.name} is connected to {bone.parent.name if bone.parent else 'its parent'}, so it moves only by turning:"
        f" key its rotation, or {what}.",
    )


def key_bone_value(obj, bone, path, frame, easing):
    full = bone.path_from_id(path)
    driven = obj.animation_data.drivers if obj.animation_data else []
    need(
        not any(c.data_path == full for c in driven),
        f"{obj.name}'s bone {bone.name}'s {path.replace('_euler', '').replace('_', ' ')} is driven; clear {obj.name} to key it.",
    )
    bone.keyframe_insert(path, frame=frame)
    eased([c for c in curves_of(obj) if c.data_path == full], frame, easing)


def ik_of(obj, bone):
    """A bone's IK constraint, refused in words when it has none or it reaches for nothing."""
    ik = next((c for c in bone.constraints if c.type == "IK"), None)
    if ik is None:
        with_ik = [b.name for b in obj.pose.bones if any(c.type == "IK" for c in b.constraints)]
        need(
            False,
            f"{obj.name}'s bone {bone.name} has no IK constraint to reach with"
            + (f"; its bones with one: {', '.join(with_ik[:8])}" if with_ik else "")
            + ". Give it one with blender_rig, or key its rotation.",
        )
    need(ik.target is not None, f"{bone.name}'s IK constraint has no target to move: give it one with blender_rig.")
    return ik


def reach_for(obj, bone, point, frame, easing):
    """
    Puts a bone's IK target at a point in the world and keys it there: a bone
    of an armature by its head, any other object by its origin. Answers what
    was moved, in words.
    """
    ik = ik_of(obj, bone)
    target = ik.target
    if target.type == "ARMATURE" and ik.subtarget:
        held = target.pose.bones.get(ik.subtarget)
        need(held is not None, f"{bone.name}'s IK target bone {ik.subtarget} is not in {target.name}.")
        unconnected(held, "reach with an unconnected target bone")
        placement = held.matrix.copy()
        placement.translation = target.matrix_world.inverted() @ point
        held.matrix = placement
        bpy.context.view_layer.update()
        key_bone_value(target, held, "location", frame, easing)
        return f"{target.name}'s bone {held.name}"
    from .follow import need_unfollowed

    need_unfollowed(target, "location", "place")
    placement = target.matrix_world.copy()
    placement.translation = point
    target.matrix_world = placement
    bpy.context.view_layer.update()
    target.keyframe_insert("location", frame=frame)
    eased([c for c in curves_of(target) if c.data_path == "location"], frame, easing)
    return target.name


def key_bone(spec, said_by_object):
    """Keys one bone, or a saved pose on every bone it holds, and answers its time."""
    obj = armature_of(spec)
    at = moment(spec.get("at"), "at")
    easing = spec.get("easing", "smooth")
    need(easing in EASINGS, f"easing is one of {', '.join(EASINGS)}.")
    frame = frame_of(at)
    if spec.get("pose") is not None:
        need(spec.get("bone") is None, "A key gives a bone or a pose, not both.")
        extra = sorted(set(k for k in spec if spec[k] is not None) - POSE_FIELDS)
        need(not extra, f"A pose key sets its bones from the pose alone; leave out {', '.join(extra)}.")
        key_pose(obj, spec["pose"], at, frame, easing, said_by_object)
        return at
    extra = sorted(set(k for k in spec if spec[k] is not None) - BONE_FIELDS)
    need(not extra, f"A bone key sets rotation, location or reach; leave out {', '.join(extra)}.")
    bone = bone_of(obj, spec.get("bone"))
    said = []
    if spec.get("rotation") is not None:
        degrees = vector(spec["rotation"], "rotation")
        key_bone_value(obj, bone, turn_bone(bone, degrees), frame, easing)
        said.append("turned (" + ", ".join(f"{d:g}°" for d in degrees) + ") from its rest")
    if spec.get("location") is not None:
        unconnected(bone, f"move {bone.parent.name if bone.parent else 'its parent'}")
        bone.location = vector(spec["location"], "location")
        key_bone_value(obj, bone, "location", frame, easing)
        said.append(f"moved {point_text(bone.location)} along its own axes from its rest")
    reach = None
    if spec.get("reach") is not None:
        reach = vector(spec["reach"], "reach")
        moved = reach_for(obj, bone, reach, frame, easing)
        said.append(f"reaching for {point_text(reach)}, where its IK target {moved} is keyed")
    need(said, f"The key at {seconds_text(at)} for {obj.name}'s bone {bone.name} sets nothing: give rotation, location or reach.")
    how = "" if easing == "smooth" else f", reached {easing.replace('_', ' ')}"
    name = bone.name

    def measured():
        tip = tip_at(obj, name, at)
        text = f"{name} at {seconds_text(at)}: {', '.join(said)}{how}, its tip at {point_text(tip)}"
        if reach is not None and (tip - reach).length > REACHED:
            text += f", {length((tip - reach).length)} from the point it reaches for"
        return text

    defer(said_by_object, obj.name, measured)
    return at


def tip_at(obj, name, at):
    """A bone's tip in the world at a moment, as its keys, constraints and drivers pose it."""
    kept = now()
    try:
        go_to(at)
        bpy.context.view_layer.update()
        return obj.matrix_world @ obj.pose.bones[name].tail
    finally:
        back_to(kept)


def saved_poses(obj):
    """The poses saved on an armature, as plain values: bone names to their rotation and location."""
    poses = obj.get(POSES)
    return poses.to_dict() if poses is not None else {}


def key_pose(obj, name, at, frame, easing, said_by_object):
    """Keys every bone a saved pose holds as the pose has it."""
    need(isinstance(name, str) and name.strip(), "pose names a pose saved on the armature.")
    poses = saved_poses(obj)
    need(
        name in poses,
        f"{obj.name} has no pose named “{name}”"
        + (f"; its poses: {', '.join(poses)}" if poses else "; save one with poses first")
        + ".",
    )
    names = []
    for bone_name, held in poses[name].items():
        bone = bone_of(obj, bone_name)
        key_bone_value(obj, bone, turn_bone(bone, list(held["rotation"])), frame, easing)
        if not (bone.bone.use_connect and bone.parent is not None):
            bone.location = list(held["location"])
            key_bone_value(obj, bone, "location", frame, easing)
        names.append(bone_name)
    how = "" if easing == "smooth" else f", reached {easing.replace('_', ' ')}"

    def measured():
        tips = [f"{bone_name}'s tip at {point_text(tip_at(obj, bone_name, at))}" for bone_name in names[:TIPS_SAID]]
        more = len(names) - TIPS_SAID
        return (
            f"pose {name} at {seconds_text(at)}{how}, its {len(names)} {'bone' if len(names) == 1 else 'bones'}: "
            + ", ".join(tips)
            + (f" and {more} more" if more > 0 else "")
        )

    defer(said_by_object, obj.name, measured)


def held_now(bone):
    """A bone's turn in degrees about its own axes from its rest, and its place along them, as it stands."""
    turn = [math.degrees(a) for a in bone.matrix_basis.to_euler("XYZ")]
    return [round(a, 4) + 0.0 for a in turn], [round(v, 6) + 0.0 for v in bone.location]


def save_pose(spec, said_by_object):
    """Saves a pose on an armature by name: the bones given, or every bone out of its rest now."""
    obj = armature_of(spec)
    name = spec.get("name")
    need(isinstance(name, str) and name.strip(), "Each pose has a name, to key it by.")
    given = spec.get("bones")
    held = {}
    if given is not None:
        need(isinstance(given, list) and given, "A pose's bones list each bone it turns or moves.")
        for item in given:
            need(isinstance(item, dict), "Each of a pose's bones names a bone, with its rotation and location.")
            bone = bone_of(obj, item.get("bone"))
            rotation = vector(item.get("rotation"), "rotation", default=(0, 0, 0))
            location = vector(item.get("location"), "location", default=(0, 0, 0))
            if location.length > 0:
                unconnected(bone, f"move {bone.parent.name if bone.parent else 'its parent'} in the pose")
            held[bone.name] = {"rotation": list(rotation), "location": list(location)}
    else:
        bpy.context.view_layer.update()
        for bone in obj.pose.bones:
            turn, place = held_now(bone)
            if any(abs(a) > 1e-3 for a in turn) or any(abs(v) > 1e-6 for v in place):
                held[bone.name] = {"rotation": turn, "location": place}
        need(held, f"{obj.name} stands in its rest pose now, so there is nothing to save: give the pose's bones.")
    poses = saved_poses(obj)
    poses[name] = held
    obj[POSES] = poses
    described = []
    for bone_name, values in list(held.items())[:TIPS_SAID]:
        parts = [f"{bone_name} turned (" + ", ".join(f"{a:g}°" for a in values["rotation"]) + ")"]
        if any(is_number(v) and abs(v) > 1e-9 for v in values["location"]):
            parts.append(f"moved {point_text(values['location'])}")
        described.append(" ".join(parts))
    more = len(held) - TIPS_SAID
    said_by_object.setdefault(obj.name, []).append(
        f"pose {name} saved with {len(held)} {'bone' if len(held) == 1 else 'bones'}"
        + ("" if given is not None else ", as it stands now")
        + ": "
        + ", ".join(described)
        + (f" and {more} more" if more > 0 else "")
    )
