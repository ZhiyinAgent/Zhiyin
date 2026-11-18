"""
Objects kept turned toward others as either moves: aimed with an axis kept up, turned about one
of their own axes only (a turret, a hinged flap), stretched to reach what they aim at (a spring, a
ram's rod, a cable), or kept on a curve. Each is one Blender constraint, which the answer measures.
"""

import math

import bpy
import mathutils

from .animate_measures import defer, over_timeline
from .arguments import need
from .finding import find_object
from .geometry import middle_of, own_size
from .keys import curves_of
from .timeline import seconds_of, seconds_text
from .wording import length, point_text

# The name of the constraint that keeps an object aimed at another.
AIM = "Zhiyin aim"
# An aim follows its target's origin; one this many degrees off the target's middle, seen from the aimer, is said.
OFF_MIDDLE = 1.0
# A line to the target this many degrees from straight up or down leaves nothing to keep the aimer upright.
STEEP = 5.0
# A stretched part whose shape reaches behind its origin by more than this share of its length stretches both ways.
BEHIND = 0.1

# Each axis a facing names, as the way it points in the object's own terms.
AXES = {
    "x": (1, 0, 0),
    "-x": (-1, 0, 0),
    "y": (0, 1, 0),
    "-y": (0, -1, 0),
    "z": (0, 0, 1),
    "-z": (0, 0, -1),
}
LETTERS = ("x", "y", "z")


def track_axis(facing):
    return "TRACK_" + ("NEGATIVE_" if facing.startswith("-") else "") + facing[-1].upper()


def aim_one(spec, said_by_object):
    """Keeps an object, a camera or a light most often, aimed at another as either moves."""
    obj = find_object(spec.get("object"))
    target = spec.get("at")
    need(target is None or isinstance(target, str), "aim's at names an object, or is empty to stop aiming.")
    # An empty name stops it aiming, and it stays turned as it is now.
    if not target or not target.strip():
        stopped = unaim(obj)
        turned = any(c.data_path.startswith("rotation_") for c in curves_of(obj))
        if stopped == "CLAMP_TO":
            said = "is no longer kept on a curve: its own place moves it again"
        else:
            said = (
                "no longer aims at anything, and its rotation keys turn it again"
                if turned
                else "no longer aims at anything, and stays turned as it is now"
            )
            if stopped == "STRETCH_TO":
                said += ", back at its own length"
        said_by_object.setdefault(obj.name, []).append(said)
        return
    up, locked = spec.get("up"), spec.get("locked")
    stretch, on_curve = bool(spec.get("stretch")), bool(spec.get("on_curve"))
    need(up is None or up in LETTERS, "up is x, y or z.")
    need(locked is None or locked in LETTERS, "locked is x, y or z.")
    need(
        sum((locked is not None, stretch, on_curve)) <= 1,
        "Give at most one of locked, stretch and on_curve: each is a different way to follow what it aims at.",
    )
    old = obj.constraints.get(AIM)
    if old is not None:
        obj.constraints.remove(old)
    aimed = find_object(target)
    need(aimed != obj, f"“{obj.name}” cannot aim at itself.")
    facing = spec.get("facing")
    need(facing is None or facing in AXES, f"facing is one of {', '.join(AXES)}.")
    if on_curve:
        need(
            facing is None and up is None,
            "on_curve keeps an object on a curve and does not turn it: leave facing and up out.",
        )
        on_curve_one(obj, aimed, said_by_object)
        return
    if stretch:
        need(
            facing in (None, "y") and up is None,
            "Blender stretches a part along its own y axis to reach what it aims at: leave facing and up out,"
            " and lay the part's length along y.",
        )
        stretch_one(obj, aimed, said_by_object)
        return
    lens = obj.type in ("CAMERA", "LIGHT")
    need(facing is None or not lens, f"“{obj.name}” is a {obj.type.lower()}, which aims its view: leave facing out.")
    # Cameras and lights look down their own -z; anything else turns its facing axis, its front, -y, unless told.
    facing = "-z" if lens else (facing or "-y")
    if locked is not None:
        need(up is None, "A part locked to turn about one axis has no other axis to keep up: leave up out.")
        need(
            locked != facing[-1],
            f"“{obj.name}” cannot turn about its {locked} axis to point that same axis: lock another axis.",
        )
        constraint = obj.constraints.new("LOCKED_TRACK")
        constraint.name = AIM
        constraint.target = aimed
        constraint.track_axis = track_axis(facing)
        constraint.lock_axis = "LOCK_" + locked.upper()
        said_by_object.setdefault(obj.name, []).append(locked_text(obj, aimed, facing, locked, lens))
        return
    need(up is None or up != facing[-1], f"up is another axis than the one it points: {facing} points, so up is not {up}.")
    constraint = obj.constraints.new("TRACK_TO")
    constraint.name = AIM
    constraint.target = aimed
    constraint.track_axis = track_axis(facing)
    # Its top up as far as that allows: z, or y for an axis along z, unless told.
    constraint.up_axis = "UP_" + (up or ("y" if facing[-1] == "z" else "z")).upper()
    said = aim_text(obj, aimed, facing, lens)
    if up is not None:
        said += f"; its {up} axis is kept up as far as that allows"
    said_by_object.setdefault(obj.name, []).append(said)


def aim_text(obj, aimed, facing, lens):
    """
    Where the aim leaves an object pointing, measured now: the axis that
    points; the target's origin, which the aim follows, when it lies off the
    target's middle as seen from the object; a line near straight up or
    down, where nothing keeps the object upright; and, for a shape, whether
    its length runs along that axis.
    """
    bpy.context.view_layer.update()
    here = obj.matrix_world.translation
    toward = aimed.matrix_world.translation - here
    if toward.length < 1e-9:
        return f"aims its {facing} axis at {aimed.name}, whose origin is where it stands, so it points nowhere yet"
    said = f"aims {'its view' if lens else f'its {facing} axis'} at {aimed.name} wherever either moves"
    middle = middle_of(aimed) - here
    off = math.degrees(toward.angle(middle)) if middle.length > 1e-9 else 180.0
    if off > OFF_MIDDLE:
        said += f", at its origin, {point_text(aimed.matrix_world.translation)}, which lies {off:.3g}° off its middle as seen from {obj.name}"
    steep = math.degrees(toward.angle(mathutils.Vector((0, 0, 1))))
    upright = min(steep, 180 - steep)
    if upright < STEEP:
        said += (
            f"; the line to it runs {upright:.3g}° from straight {'up' if steep < 90 else 'down'}, where an aim cannot keep it"
            " upright: a small move across that line turns it round the line, up to half a turn"
        )
    size = own_size(obj) if not lens else None
    if size is not None and max(size) > 0:
        longest = max(range(3), key=lambda i: size[i])
        if longest != "xyz".index(facing[-1]) and size[longest] > 1.5 * size["xyz".index(facing[-1])]:
            said += (
                f"; its length runs along its {'xyz'[longest]} axis, across that line:"
                f" give facing {'xyz'[longest]} or -{'xyz'[longest]} to aim its length"
            )
    return said


def locked_text(obj, aimed, facing, locked, lens):
    """
    A part turned about one of its own axes only: how far its facing axis is
    off the line to what it aims at now, which that one turn cannot close.
    """
    bpy.context.view_layer.update()
    toward = aimed.matrix_world.translation - obj.matrix_world.translation
    pointing = obj.matrix_world.to_3x3().normalized() @ mathutils.Vector(AXES[facing])
    said = (
        f"turns about its own {locked} axis only, to point {'its view' if lens else f'its {facing} axis'}"
        f" toward {aimed.name} wherever either moves"
    )
    if toward.length < 1e-9:
        return said + f"; {aimed.name}'s origin is where it stands, so it points nowhere yet"
    off = math.degrees(pointing.angle(toward)) if pointing.length > 1e-9 else 0.0
    if off > OFF_MIDDLE:
        said += f"; it points {off:.3g}° off the line to {aimed.name} now, which a turn about {locked} alone cannot close"
    return said


def stretch_one(obj, aimed, said_by_object):
    """
    Stretches a part along its y axis to reach what it aims at, keeping its
    thickness, as a spring, a ram's rod or a cable keeps its ends on two
    parts; the answer gives its length at rest and over the timeline.
    """
    bpy.context.view_layer.update()
    shape = own_size(obj)
    rest = (aimed.matrix_world.translation - obj.matrix_world.translation).length
    need(rest > 1e-6, f"“{obj.name}” and {aimed.name} have their origins in one place, so there is no length to stretch to.")
    constraint = obj.constraints.new("STRETCH_TO")
    constraint.name = AIM
    constraint.target = aimed
    constraint.rest_length = rest
    constraint.volume = "NO_VOLUME"
    long_way = shape[1] if shape is not None else 0.0
    notes = []
    if shape is not None and max(shape) > 0:
        longest = max(range(3), key=lambda i: shape[i])
        if longest != 1 and shape[longest] > 1.5 * shape[1]:
            notes.append(
                f"its length runs along its {'xyz'[longest]} axis, across the stretch, which is along y:"
                " lay its shape along y so its length reaches"
            )
        low = min(c[1] for c in obj.bound_box)
        high = max(c[1] for c in obj.bound_box)
        if high - low > 1e-9 and -low > BEHIND * (high - low) and high > BEHIND * (high - low):
            notes.append(
                "its origin is not at one of its ends, so it stretches both ways from it:"
                " put its origin at the end that stays on its own part"
            )

    def measured():
        found = over_timeline(lambda: (aimed.matrix_world.translation - obj.matrix_world.translation).length)
        distances = [d for _, d in found]
        lo, hi = min(distances), max(distances)
        said = (
            f"stretches along its y axis to reach {aimed.name} wherever either moves, keeping its thickness:"
            f" {length(rest)} from its origin to {aimed.name}'s at its own length"
            + (f", {length(long_way)}" if long_way > 0 else "")
        )
        if hi - lo <= 1e-6:
            said += "; that distance stays the same over the timeline, so it does not stretch"
        else:
            at_lo = seconds_of(found[distances.index(lo)][0])
            at_hi = seconds_of(found[distances.index(hi)][0])
            said += (
                f"; over the timeline {length(lo)} apart at {seconds_text(at_lo)} to {length(hi)} at {seconds_text(at_hi)},"
                f" ×{lo / rest:.3g} to ×{hi / rest:.3g} its length"
                + (f", {length(long_way * lo / rest)} to {length(long_way * hi / rest)}" if long_way > 0 else "")
            )
        return "; ".join([said, *notes])

    defer(said_by_object, obj.name, measured)


def on_curve_one(obj, curve, said_by_object):
    """
    Keeps an object on a curve, as Blender's Clamp To does: where its own place
    falls along the curve's longest way, it is put on the curve.
    """
    need(curve.type == "CURVE", f"on_curve keeps an object on a curve; “{curve.name}” is not one.")
    # Clamp To follows the curve as a path, which a curve is not until told.
    curve.data.use_path = True
    constraint = obj.constraints.new("CLAMP_TO")
    constraint.name = AIM
    constraint.target = curve
    constraint.use_cyclic = any(spline.use_cyclic_u for spline in curve.data.splines)
    total = sum(spline.calc_length() for spline in curve.data.splines)
    # Clamp To measures across the box of the curve's points, each widened by its radius.
    reach = [
        (curve.matrix_world @ mathutils.Vector(point.co[:3]), point.radius * max(curve.matrix_world.to_scale()))
        for spline in curve.data.splines
        for point in (spline.bezier_points if spline.type == "BEZIER" else spline.points)
    ]
    need(reach, f"“{curve.name}” has no points to keep anything on.")
    lows = [min(p[i] - r for p, r in reach) for i in range(3)]
    highs = [max(p[i] + r for p, r in reach) for i in range(3)]
    axis = max(range(3), key=lambda i: highs[i] - lows[i])
    way = "xyz"[axis]
    low, high = lows[axis], highs[axis]

    def measured():
        found = over_timeline(lambda: obj.matrix_world.translation.copy())
        first, last = found[0], found[-1]
        said = (
            f"is kept on {curve.name}, a curve {length(total)} long{' round a loop' if constraint.use_cyclic else ''},"
            f" as far along it as its own place along {way} is across the curve's box that way, from {length(low)} at its start"
            f" to {length(high)} at its end"
        )
        if len(found) > 1 and (last[1] - first[1]).length > 1e-6:
            said += (
                f": from {point_text(first[1])} at {seconds_text(seconds_of(first[0]))}"
                f" to {point_text(last[1])} at {seconds_text(seconds_of(last[0]))}"
            )
        else:
            said += f": at {point_text(first[1])} over the timeline; key its place along {way} to move it along"
        return said

    defer(said_by_object, obj.name, measured)


def unaim(obj):
    """
    Takes its aim away, leaving it turned as the aim turned it. Only its turn
    changes: what its other constraints do to its place is theirs still.
    Answers the kind of aim it had, or nothing.
    """
    old = obj.constraints.get(AIM)
    if old is None:
        return None
    kind = old.type
    if kind == "CLAMP_TO":
        obj.constraints.remove(old)
        return kind
    bpy.context.view_layer.update()
    aimed = obj.matrix_world.to_quaternion()
    obj.constraints.remove(old)
    bpy.context.view_layer.update()
    unaimed = obj.matrix_world.to_quaternion()
    # Its world turn is what turns it above its own turn, then its own: so
    # its own turn becomes what makes the aimed one.
    turn = obj.matrix_basis.to_quaternion() @ unaimed.inverted() @ aimed
    if obj.rotation_mode == "QUATERNION":
        obj.rotation_quaternion = turn
    elif obj.rotation_mode == "AXIS_ANGLE":
        axis, angle = turn.to_axis_angle()
        obj.rotation_axis_angle = (angle, *axis)
    else:
        obj.rotation_euler = turn.to_euler(obj.rotation_mode, obj.rotation_euler)
    return kind
