"""
Parts that move with others, as a mechanism's do: a value of one object, its
place, turn or scale along one axis, set at every moment from a value of
another, at a ratio or by a formula. A pulley turns at a ratio of the shaft
that drives it; a piston's height is a formula of its crank's angle.

Each is a Blender driver of the simple kind, which Blender works out without
Python: so a scene that follows runs the same in any Blender it is opened in,
and a formula can do nothing but arithmetic, as formulas checks.
"""

import math

import bpy
import mathutils

from .arguments import is_number, need
from .finding import find_object
from .formulas import FOLLOWED, SIMPLE, in_tool_units, worked_out
from .keys import curves_of, key_channel
from .wording import point_text

# The tools' names for an object's own values, and the axes along them.
VALUES = {"place": "location", "turn": "rotation_euler", "scale": "scale"}
AXES = ("x", "y", "z")
LONGEST_FORMULA = 500
# The followed value is multiplied by this when a call gives no ratio.
RATIO = 1.0


def value_text(value, axis):
    return f"{value} {'around' if value == 'turn' else 'along'} {axis}"


def _channel(spec, whose):
    need(isinstance(spec, dict), f"{whose} names an object, a value and an axis.")
    value, axis = spec.get("value"), spec.get("axis")
    need(value in VALUES, f"{whose} value is place, turn or scale.")
    need(axis in AXES, f"{whose} axis is x, y or z.")
    return find_object(spec.get("object")), value, axis


def followers(obj):
    """The values of an object that follow another, as (driver curve, value, axis)."""
    data = obj.animation_data
    found = []
    for curve in data.drivers if data is not None else []:
        for value, path in VALUES.items():
            if curve.data_path == path:
                found.append((curve, value, AXES[curve.array_index]))
    return found


def _source(curve):
    """The object a driver follows, and its value and axis, or nothing."""
    for variable in curve.driver.variables:
        if variable.name != FOLLOWED or not variable.targets:
            continue
        target = variable.targets[0]
        path, _, index = target.data_path.partition("[")
        for value, own in VALUES.items():
            if own == path and index[:1].isdigit():
                return target.id, value, AXES[int(index[0])]
    return None


def _moves_with(obj, start):
    """Whether `start` moves with `obj`: it follows it, or follows something that does."""
    seen, waiting = set(), [start]
    while waiting:
        current = waiting.pop()
        if current == obj:
            return True
        if current.name in seen:
            continue
        seen.add(current.name)
        for curve, _, _ in followers(current):
            source = _source(curve)
            if source is not None and source[0] is not None:
                waiting.append(source[0])
    return False


def need_unfollowed(obj, path, what):
    """Refuses a key on a value of `obj` that follows another's, which the key could not move."""
    for curve, value, axis in followers(obj):
        if curve.data_path == path:
            source = _source(curve)
            leader = source[0].name if source is not None and source[0] is not None else "another object"
            need(False, f"{obj.name}'s {value_text(value, axis)} follows {leader}; clear {obj.name} first to key its {what}.")


def follow_one(spec, said_by_object):
    need(isinstance(spec, dict), "Each of follow names an object, a value, an axis and what it follows.")
    obj, value, axis = _channel(spec, "follow's")
    source, source_value, source_axis = _channel(spec.get("from"), "follow's from")
    formula, ratio, offset = spec.get("formula"), spec.get("ratio"), spec.get("offset")
    need(formula is None or (ratio is None and offset is None), "Give ratio and offset, or a formula, not both.")
    need(source != obj, f"{obj.name} cannot follow itself; its values follow another part's.")
    need(not _moves_with(obj, source), f"{obj.name} cannot follow {source.name}, which already moves with {obj.name}.")
    path, index = VALUES[value], AXES.index(axis)
    need(
        not any(c.data_path == path and c.array_index == index for c in curves_of(obj)),
        f"{obj.name}'s {value_text(value, axis)} is keyed; clear its keys first, since following sets it at every moment.",
    )
    if formula is None:
        ratio = RATIO if ratio is None else ratio
        offset = 0.0 if offset is None else offset
        need(is_number(ratio) and is_number(offset), "ratio and offset are numbers.")
        written = f"{float(ratio)!r}*{FOLLOWED} + {float(offset)!r}"
        how = (f", times {ratio:g}" if ratio != 1 else "") + (f", plus {offset:g}" if offset else "")
    else:
        need(isinstance(formula, str) and formula.strip(), "A formula is written as text, such as 2*v + 10.")
        need(
            len(formula) <= LONGEST_FORMULA,
            f"A formula is at most {LONGEST_FORMULA} characters, and this one has {len(formula)}. Shorten it, such as"
            " by writing each number no longer than it needs, or key the motion at the times it needs instead.",
        )
        written = formula
        how = f", by {formula}"
    # Followed and following turns are read and set as plain angles, which
    # a part brought in from a model file may not use yet; its pose stays.
    for part, its_value in ((obj, value), (source, source_value)):
        if its_value == "turn" and part.rotation_mode not in ("XYZ", "XZY", "YXZ", "YZX", "ZXY", "ZYX"):
            part.rotation_mode = "XYZ"
    obj.driver_remove(path, index)
    driver = obj.driver_add(path, index).driver
    driver.type = "SCRIPTED"
    variable = driver.variables.new()
    variable.name = FOLLOWED
    variable.type = "SINGLE_PROP"
    variable.targets[0].id_type = "OBJECT"
    variable.targets[0].id = source
    variable.targets[0].data_path = f"{VALUES[source_value]}[{AXES.index(source_axis)}]"
    # Followed and following turns are the tools' degrees, Blender's radians.
    driver.expression = in_tool_units(written, {FOLLOWED} if source_value == "turn" else set(), value == "turn", SIMPLE)
    if driver.is_simple_expression:
        said_by_object.setdefault(obj.name, []).append(
            f"its {value_text(value, axis)} follows {source.name}'s {value_text(source_value, source_axis)}{how}"
            + measured_from(obj, value)
        )
        return None
    # Blender follows only a short formula live; a longer one is worked out
    # here at every frame and keyed, once the call's other motion is set.
    obj.driver_remove(path, index)
    return Keyed(obj, value, axis, source, source_value, source_axis, worked_out(written), how)


class Keyed:
    """A formula too long for Blender to follow live, keyed at every frame of the timeline instead."""

    def __init__(self, obj, value, axis, source, source_value, source_axis, work, how):
        self.obj, self.value, self.axis = obj, value, axis
        self.source, self.source_value, self.source_axis = source, source_value, source_axis
        self.work, self.how = work, how

    def followed(self):
        """The value followed now, in the tools' units: a turn in degrees."""
        evaluated = self.source.evaluated_get(bpy.context.evaluated_depsgraph_get())
        got = getattr(evaluated, VALUES[self.source_value])[AXES.index(self.source_axis)]
        return math.degrees(got) if self.source_value == "turn" else got

    def own(self, result):
        """A result in Blender's units: a turn in radians."""
        return math.radians(result) if self.value == "turn" else result

    def set(self, result):
        getattr(self.obj, VALUES[self.value])[AXES.index(self.axis)] = self.own(result)


def key_formulas(keyed, said_by_object, seconds_of):
    """
    Keys each formula at every frame of the timeline, in the order given, so
    one may follow a value another keys; refused, with the moment, where a
    formula cannot be worked out, before any key is set.
    """
    if not keyed:
        return
    s = bpy.context.scene
    frames = range(s.frame_start, s.frame_end + 1)
    leaders = {k.source.name for k in keyed}
    values = {id(k): [] for k in keyed}
    kept = s.frame_current
    try:
        for frame in frames:
            s.frame_set(frame)
            for k in keyed:
                try:
                    result = k.work(k.followed())
                except (ValueError, ZeroDivisionError, OverflowError) as error:
                    need(
                        False,
                        f"{k.obj.name}'s formula cannot be worked out at {seconds_of(frame):g} s ({error}): "
                        "keep sqrt, asin, acos and division to values they take.",
                    )
                values[id(k)].append(result)
                k.set(result)
                if k.obj.name in leaders:
                    # A formula after it follows this value at this frame.
                    bpy.context.view_layer.update()
    finally:
        s.frame_set(kept)
    for k in keyed:
        # Straight between frames, as a formula worked out at each one is.
        key_channel(k.obj, VALUES[k.value], AXES.index(k.axis), list(frames), [k.own(result) for result in values[id(k)]])
        said_by_object.setdefault(k.obj.name, []).append(
            f"its {value_text(k.value, k.axis)} follows {k.source.name}'s {value_text(k.source_value, k.source_axis)}{k.how}"
            + measured_from(k.obj, k.value)
            + f", keyed at each of the {len(frames)} frames from {seconds_of(frames[0]):g} s to {seconds_of(frames[-1]):g} s, "
            "since the formula is too long for Blender to follow live: it follows the motion as it is keyed now, "
            "so set it again after changing that motion or the timeline"
        )



def measured_from(obj, value):
    """
    Where an attached part's place counts from: its attachment's terms, not
    the world's, so a formula written in world heights is off by the
    difference, which the answer gives.
    """
    if value != "place" or obj.parent is None:
        return ""
    zero = obj.parent.matrix_world @ obj.matrix_parent_inverse @ mathutils.Vector((0, 0, 0))
    return f", in {obj.parent.name}'s terms, where place (0, 0, 0) is at {point_text(zero)} in the world"


def described(obj):
    """What an object's values follow, for the scene's description."""
    said = []
    for curve, value, axis in followers(obj):
        source = _source(curve)
        if source is not None and source[0] is not None:
            said.append(f"{value_text(value, axis)} follows {source[0].name}'s {value_text(source[1], source[2])}")
    return said


def unfollow(obj):
    """Stops each value of an object following another, leaving it as it is now; says whether any did."""
    following = [curve for curve, _, _ in followers(obj) if _source(curve) is not None]
    if not following:
        return False
    bpy.context.view_layer.update()
    now = {path: list(getattr(obj, path)) for path in VALUES.values()}
    for curve in following:
        obj.animation_data.drivers.remove(curve)
    for path, values in now.items():
        setattr(obj, path, values)
    return True
