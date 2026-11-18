"""
Chains of bones that reach: an IK constraint on a chain's last bone, for a target, its bend held
toward a pole by the pole angle that keeps the pose it has; or Spline IK along a curve. A target
or a pole not in the scene is made, an empty attached to the armature. Each chain says its bones,
its length and what it reaches for, and whether, as set, it keeps the pose it had.
"""

import math

import bpy
import mathutils

from .arguments import need, whole
from .errors import Refused
from .finding import find_object, link, scene
from .rig_bind_timeline import Chain, Spline
from .timeline import seconds_of, seconds_text
from .wording import length, point_text
from .wording import listed as in_words

# A chain whose joints lie this share of its length off the line from its root to its tip is straight.
STRAIGHT = 1e-4
# The most bones a pose bone's names are listed by.
LISTED = 12
# The bones of a chain that reaches for a target by default, the last included.
TARGET_CHAIN = 2


def armature_with(bone, named, at):
    """The armature named, else the one armature that has a bone of that name."""
    if named is not None:
        arm = find_object(named, {"ARMATURE"})
        need(
            bone in arm.pose.bones,
            f"{arm.name} has no bone named “{bone}”; it has {in_words([b.name for b in arm.pose.bones][:LISTED])}.",
        )
        return arm
    armatures = [o for o in scene().objects if o.type == "ARMATURE"]
    holders = [o for o in armatures if bone in o.pose.bones]
    if len(holders) == 1:
        return holders[0]
    if holders:
        raise Refused(f"Name {at}.armature: {in_words(o.name for o in holders)} each have a bone named “{bone}”.")
    listed = " ".join(f"{o.name} has {in_words([b.name for b in o.pose.bones][:LISTED])}." for o in armatures if o.pose.bones)
    raise Refused(f"No armature has a bone named “{bone}”." + (f" {listed}" if listed else " The scene has no bones."))


def up_to_root(bone):
    found = [bone]
    while found[-1].parent is not None:
        found.append(found[-1].parent)
    return found


def made_empty(name, place, arm, size):
    """An empty at a place in the world, attached to the armature so it moves with it."""
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_type = "PLAIN_AXES"
    obj.empty_display_size = size
    link(obj, arm.users_collection[0] if arm.users_collection else None)
    obj.parent = arm
    obj.matrix_parent_inverse = arm.matrix_world.inverted()
    obj.matrix_basis = mathutils.Matrix.Translation(place)
    return obj


def object_or_made(name, place, arm, size):
    """The object named, or an empty made at a place; and whether it was made."""
    found = bpy.data.objects.get(name)
    if found is not None and found.name in scene().objects:
        need(found != arm, f"{arm.name} cannot reach for itself: name an object or a new empty.")
        return found, False
    return made_empty(name, place, arm, size), True


def off_line(points, joint):
    """How far one joint lies off the line from the chain's root to its tip."""
    root, tip = points[0], points[-1]
    axis = tip - root
    along = (points[joint] - root).dot(axis) / max(axis.length_squared, 1e-12)
    return points[joint] - root - axis * along


def bend_of(points):
    """Which interior joint bends the chain most, and how far it lies off the line from its root to its tip."""
    best, off = None, mathutils.Vector()
    for joint in range(1, len(points) - 1):
        side = off_line(points, joint)
        if side.length > off.length:
            best, off = joint, side
    return best, off


def pole_angle(arm, chain, pole_world):
    """The pole angle that leaves the chain's plane as it is: from its first bone's x axis to the pole, about the bone."""
    to_local = arm.matrix_world.inverted()
    first, last = chain[0], chain[-1]
    pole = to_local @ pole_world
    normal = (last.tail - first.head).cross(pole - first.head)
    need(normal.length > 1e-9, f"{arm.name}'s chain to {last.name} points straight at its pole: put the pole off to the side it bends.")
    projected = normal.cross(first.tail - first.head)
    x_axis = first.matrix.to_3x3() @ mathutils.Vector((1, 0, 0))
    angle = x_axis.angle(projected)
    if x_axis.cross(projected).angle(first.tail - first.head) < 1:
        angle = -angle
    return angle


def pose_kept(arm, chain, before):
    """How far, in degrees, the chain's bones now turn from where they were."""
    bpy.context.view_layer.update()
    return max(
        math.degrees((arm.matrix_world @ b.matrix).to_quaternion().rotation_difference(before[b.name].to_quaternion()).angle)
        for b in chain
    )


def replaced(bone):
    """Removes the chain constraints a bone has, saying so."""
    earlier = [c for c in bone.constraints if c.type in ("IK", "SPLINE_IK")]
    if not earlier:
        return ""
    kinds = in_words(sorted({"IK" if c.type == "IK" else "Spline IK" for c in earlier}))
    for c in earlier:
        bone.constraints.remove(c)
    return f" It replaces the {kinds} {bone.name} had."


def chain_words(chain, total):
    names = chain[0].name if len(chain) == 1 else f"{chain[0].name} to {chain[-1].name}"
    return f"a chain of {len(chain)} bone{'s' if len(chain) != 1 else ''}, {names}, {length(total)} long"


def reach(item, at):
    """Sets one chain reaching; its lines, and what the timeline is to check of it."""
    need(isinstance(item, dict) and isinstance(item.get("bone"), str), f"{at} names a bone.")
    target_name, curve_name, pole_name = item.get("target"), item.get("curve"), item.get("pole")
    need((target_name is None) != (curve_name is None), f"Give exactly one of {at}.target and {at}.curve.")
    need(curve_name is None or pole_name is None, f"{at} lies along a curve, which holds its bend: it takes no pole.")
    arm = armature_with(item["bone"], item.get("armature"), at)
    bone = arm.pose.bones[item["bone"]]
    above = up_to_root(bone)
    depth = len(above)
    count = whole(item.get("chain"), f"{at}.chain", minimum=1, default=depth if curve_name else min(TARGET_CHAIN, depth))
    need(
        count <= depth,
        f"{bone.name} has {depth} bone{'s' if depth != 1 else ''} up to its root, {above[-1].name} to {bone.name}: {at}.chain is at most {depth}.",
    )
    stretch = item.get("stretch", False)
    need(isinstance(stretch, bool), f"{at}.stretch is true or false.")
    chain = list(reversed(above[:count]))
    bpy.context.view_layer.update()
    before = {b.name: (arm.matrix_world @ b.matrix).copy() for b in chain}
    points = [arm.matrix_world @ b.head for b in chain] + [arm.matrix_world @ bone.tail]
    total = sum((b - a).length for a, b in zip(points, points[1:]))
    again = replaced(bone)
    if curve_name is not None:
        return along_curve(arm, bone, chain, total, find_object(curve_name, {"CURVE"}), stretch, again)
    target, made = object_or_made(target_name, points[-1], arm, total * 0.1)
    words = f"it reaches for {target.name}" + (f", made, an empty at the tip {point_text(points[-1])}" if made else "")
    constraint = bone.constraints.new("IK")
    constraint.target = target
    constraint.chain_count = count
    constraint.use_stretch = stretch
    if stretch:
        for b in chain:
            b.ik_stretch = max(b.ik_stretch, 0.1)
    joint, off = bend_of(points)
    straight = off.length <= STRAIGHT * total
    if pole_name is not None:
        pole_words = with_pole(arm, chain, constraint, pole_name, points, joint, off, total, before, at)
    elif joint is not None:
        pole_words = "no pole, so nothing holds the side it bends to"
        if straight:
            pole_words += ", and it lies straight, so it may bend either way"
    else:
        pole_words = None
    parts = [f"{chain_words(chain, total)} from {point_text(points[0])}", words]
    parts += [pole_words] if pole_words else []
    parts.append("stretching past their length to reach" if stretch else "no stretch")
    lines = [f"IK on {bone.name} of {arm.name}: " + "; ".join(parts) + "." + again + followed_already(chain, arm)]
    turned = pose_kept(arm, chain, before)
    moment = seconds_text(seconds_of(scene().frame_current))
    if turned < 0.01:
        lines.append(f"As set, at {moment} the chain keeps its pose, within 0.01°.")
    else:
        lines.append(f"As set, at {moment} the chain turns up to {turned:.3g}° from the pose it had, reaching for {target.name}.")
    rest_side = rest_bend(arm, chain, joint)
    return lines, Chain(arm, chain, target, total, joint, rest_side)


def with_pole(arm, chain, constraint, pole_name, points, joint, off, total, before, at):
    """Holds the chain's bend toward a pole, made where it bends when not in the scene; the words saying so."""
    need(joint is not None, f"{at} is a chain of one bone, which has no bend for a pole.")
    pole_at = points[joint] + off.normalized() * total if off.length > STRAIGHT * total else None
    found = bpy.data.objects.get(pole_name)
    if found is None or found.name not in scene().objects:
        need(
            pole_at is not None,
            f"The chain to {chain[-1].name} lies straight, so it has no side to bend to: place {at}.pole yourself, or bend the chain first.",
        )
    pole, made = object_or_made(pole_name, pole_at, arm, total * 0.1)
    constraint.pole_target = pole
    constraint.pole_angle = kept_pole_angle(arm, chain, constraint, before, pole_angle(arm, chain, pole.matrix_world.translation))
    words = f"its bend points to {pole.name}" + (f", made at {point_text(pole_at)} on the side it bends" if made else "")
    return words + f", the pole angle {math.degrees(constraint.pole_angle):.3g}°"


def kept_pole_angle(arm, chain, constraint, before, guess):
    """
    The pole angle that turns the chain least from the pose it had: the one worked out from the
    first bone's x axis where it keeps the pose, else the best of every 5° refined to a hundredth.
    """

    def turned(angle):
        constraint.pole_angle = angle
        return pose_kept(arm, chain, before)

    if turned(guess) < 0.01:
        return guess
    best = min((math.radians(d) for d in range(-180, 180, 5)), key=turned)
    low, high = best - math.radians(5), best + math.radians(5)
    golden = (math.sqrt(5) - 1) / 2
    while high - low > math.radians(0.01):
        a, b = high - golden * (high - low), low + golden * (high - low)
        if turned(a) < turned(b):
            high = b
        else:
            low = a
    return min((guess, best, (low + high) / 2), key=turned)


def followed_already(chain, arm):
    """Words naming the chain's bones that follow constraints of their own besides IK, which decide where they go."""
    held = {}
    for b in chain:
        for c in b.constraints:
            if c.type not in ("IK", "SPLINE_IK") and not c.mute:
                held.setdefault(b.name, set()).add(c.type.replace("_", " ").title())
    if not held:
        return ""
    kinds = in_words(sorted(set().union(*held.values())))
    said = f" {in_words(list(held))} already follow{'s' if len(held) == 1 else ''} constraints of {'its' if len(held) == 1 else 'their'} own ({kinds}), which the IK works with."
    if arm.data.get("rig_id") is not None:
        said += " A rig Rigify generated reaches with its own IK controls, as its foot and hand IK bones, not with IK on its deforming bones."
    return said


def rest_bend(arm, chain, joint):
    """Which way the chain bends at rest, in the space of the bone it hangs from; nothing when it is straight."""
    if joint is None:
        return None
    space = chain[0].parent.bone.matrix_local.inverted() if chain[0].parent else mathutils.Matrix()
    points = [space @ b.bone.head_local for b in chain] + [space @ chain[-1].bone.tail_local]
    total = sum((b - a).length for a, b in zip(points, points[1:]))
    off = off_line(points, joint)
    return off.normalized() if off.length > STRAIGHT * total else None


def along_curve(arm, bone, chain, total, curve, stretch, again):
    """Spline IK along a curve, from its start: the chain kept to its length, or each bone stretched to fit."""
    constraint = bone.constraints.new("SPLINE_IK")
    constraint.target = curve
    constraint.chain_count = len(chain)
    constraint.y_scale_mode = "FIT_CURVE" if stretch else "BONE_ORIGINAL"
    constraint.xz_scale_mode = "NONE"
    bpy.context.view_layer.update()
    spline = Spline(arm, chain, curve, total)
    long = spline.curve_length()
    head = f"Spline IK on {bone.name} of {arm.name}: {chain_words(chain, total)}, along {curve.name}, {length(long)} long, from its start; "
    if stretch:
        ratio = long / total
        head += f"each bone {'stretches' if ratio >= 1 else 'shrinks'} to fit the whole curve, to {ratio:.4g}× its length."
    elif total < long:
        head += f"each bone keeps its length, so the chain covers the first {total / long * 100:.3g}% of the curve."
    else:
        head += f"each bone keeps its length, so the chain runs {length(total - long)} past the curve's end."
    spline.stretching = stretch
    return [head + again], spline
