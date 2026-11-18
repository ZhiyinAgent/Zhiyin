"""
Values driven live by others, as Blender's drivers drive them: any animatable value of an object,
its bones, shapes, steps or material, set at every moment from named variables, each a value of
another object or bone, the distance between two, or the turn between two; averaged, summed, the
least, the most, or by a formula. Every driver is one Blender works out without Python, so a scene
runs the same wherever it is opened; one that would need Python is refused.
"""

import math
import re

import bpy

from .animate_measures import defer, over_timeline
from .arguments import need
from .drivers import SIMPLE
from .finding import find_object
from .follow import LONGEST_FORMULA
from .formulas import in_tool_units
from .keys import curves_of
from .timeline import seconds_of, seconds_text

KINDS = {"value": "SINGLE_PROP", "distance": "LOC_DIFF", "turn_between": "ROTATION_DIFF"}
COMBINE = {"average": "AVERAGE", "sum": "SUM", "min": "MIN", "max": "MAX"}
NAMES = "abcdefgh"
EULERS = ("XYZ", "XZY", "YXZ", "YZX", "ZXY", "ZYX")


class Place:
    """A value by its path from an object: the data block holding it, its path there, its index, and its units."""

    def __init__(self, block, full, index, angle, holder, name, note=""):
        self.block, self.full, self.index, self.angle = block, full, index, angle
        self.holder, self.name, self.note = holder, name, note

    def read(self):
        value = self.block.path_resolve(self.full)
        return float(value[self.index] if self.index >= 0 else value)


def place_of(obj, path, whose):
    """
    Finds the value a path names from an object, as Blender writes it:
    pose.bones["Jaw"].rotation_euler[0], data.shape_keys.key_blocks["Smile"].value,
    modifiers["Bend"].angle, or a custom value such as ["open"]; a custom value
    not there yet is made, at 0.
    """
    need(isinstance(path, str) and path.strip(), f"{whose} path names a value, such as modifiers[\"Bend\"].angle.")
    text = path.strip()
    index = -1
    found = re.fullmatch(r"(.*)\[(\d+)\]", text)
    if found:
        text, index = found.group(1), int(found.group(2))
    custom = re.fullmatch(r"(.*)\[[\"']([^\"']+)[\"']\]", text)
    try:
        if custom:
            head, key = custom.group(1), custom.group(2)
            holder = obj.path_resolve(head) if head else obj
            if isinstance(holder, bpy.types.bpy_struct) and not isinstance(holder, bpy.types.bpy_prop_collection) and hasattr(holder, "keys"):
                note = ""
                if key not in holder.keys():
                    holder[key] = 0.0
                    note = f"{key} made, at 0"
                need(isinstance(holder[key], (int, float)) and index < 0, f"{path} is not a number Blender can drive.")
                prefix = holder.path_from_id() if not isinstance(holder, bpy.types.ID) else ""
                return Place(holder.id_data, f'{prefix}["{key}"]', -1, False, holder, key, note)
        head, _, name = text.rpartition(".")
        holder = obj.path_resolve(head) if head else obj
    except ValueError:
        need(False, f"{path} is not a value of {obj.name}: write its path as Blender does, such as modifiers[\"Bend\"].angle.")
    prop = holder.bl_rna.properties.get(name) if hasattr(holder, "bl_rna") else None
    need(prop is not None, f"{path} is not a value of {obj.name}: {name} is not one of its properties.")
    need(prop.type in ("FLOAT", "INT", "BOOLEAN") and prop.is_animatable, f"{path} is not a number Blender can drive.")
    size = prop.array_length if getattr(prop, "is_array", False) else 0
    if size:
        need(0 <= index < size, f"{path} holds {size} values: name one, such as {text}[0].")
    else:
        need(index < 0, f"{path} is a single value: leave out [{index}].")
    note = ""
    # A turn driven as angles takes only on a part turned by angles.
    if name == "rotation_euler" and getattr(holder, "rotation_mode", "XYZ") not in EULERS:
        holder.rotation_mode = "XYZ"
        note = "its rotation set to XYZ angles so the driven turn takes"
    return Place(holder.id_data, holder.path_from_id(name), index, prop.unit == "ROTATION", holder, name, note)


def target_of(spec, whose, prefix):
    """An object, and its bone when one is named, for a variable's end."""
    obj = find_object(spec.get(prefix or "object"))
    bone = spec.get(f"{prefix}_bone" if prefix else "bone")
    if bone is not None:
        need(obj.type == "ARMATURE", f"{whose}: {obj.name} is a {obj.type.lower()}, which has no bones.")
        need(obj.pose.bones.get(bone) is not None, f"{whose}: {obj.name} has no bone named “{bone}”.")
    return obj, bone


def end_text(obj, bone):
    return f"{obj.name}'s bone {bone}" if bone else obj.name


def variable(driver, spec, i):
    """Adds one variable to a driver; answers its name, whether it is an angle, and what it reads in words."""
    whose = f"drive's variables[{i}]"
    need(isinstance(spec, dict), f"{whose} names its kind and the object it reads.")
    kind = spec.get("kind", "value")
    need(kind in KINDS, f"{whose} kind is value, distance or turn_between.")
    name = spec.get("name") or NAMES[i]
    need(isinstance(name, str), f"{whose} name is a word, such as d.")
    var = driver.variables.new()
    var.name = name
    need(var.is_name_valid and name != "frame", f"{whose} name {name} is not a name Blender takes: use letters, such as d or angle.")
    var.type = KINDS[kind]
    obj, bone = target_of(spec, whose, None)
    if kind == "value":
        path = spec.get("path")
        need(isinstance(path, str) and path.strip(), f"{whose} is a value: give its path, such as location[2].")
        full = f'pose.bones["{bone}"].{path.strip()}' if bone else path.strip()
        place = place_of(obj, full, whose)
        target = var.targets[0]
        target.id_type = "OBJECT"
        target.id = obj
        # Read from the object, however deep the value lies.
        target.data_path = full
        return name, place.angle, f"{end_text(obj, bone)}'s {path.strip()}"
    need(spec.get("path") is None, f"{whose} is a {kind.replace('_', ' ')}: leave path out.")
    to, to_bone = target_of(spec, whose, "to")
    need((obj, bone) != (to, to_bone), f"{whose} measures from {end_text(obj, bone)} to itself.")
    for target, (one, its_bone) in zip(var.targets, ((obj, bone), (to, to_bone))):
        target.id = one
        if its_bone:
            target.bone_target = its_bone
    words = "the distance from" if kind == "distance" else "the turn between"
    joint = "to" if kind == "distance" else "and"
    return name, kind == "turn_between", f"{words} {end_text(obj, bone)} {joint} {end_text(to, to_bone)}"


def combined(how, names):
    """A combination of the variables written as a formula, for variables of other units than the value."""
    if how == "sum":
        return " + ".join(names)
    if how in ("min", "max"):
        return f"{how}({', '.join(names)})" if len(names) > 1 else names[0]
    return f"({' + '.join(names)}) / {len(names)}" if len(names) > 1 else names[0]


def drive_one(spec, said_by_object):
    """Drives one value from its variables, refused in words where Blender could not work it out without Python."""
    need(isinstance(spec, dict), "Each of drive names an object, the path of its value and the variables it reads.")
    obj = find_object(spec.get("object"))
    place = place_of(obj, spec.get("path"), "drive's")
    index = max(place.index, 0)
    need(
        not any(c.data_path == place.full and c.array_index == index for c in curves_of(place.block)),
        f"{obj.name}'s {spec['path']} is keyed; clear its keys first, since a driver sets it at every moment.",
    )
    variables = spec.get("variables")
    need(isinstance(variables, list) and 1 <= len(variables) <= len(NAMES), f"drive's variables lists 1 to {len(NAMES)} variables.")
    formula, how = spec.get("formula"), spec.get("combine")
    need(formula is None or how is None, "Give combine or a formula, not both.")
    need(how is None or how in COMBINE, "combine is average, sum, min or max.")
    if formula is not None:
        need(isinstance(formula, str) and formula.strip(), "A formula is written as text, such as d * 2.")
        need(
            len(formula) <= LONGEST_FORMULA,
            f"A formula is at most {LONGEST_FORMULA} characters, and this one has {len(formula)}: shorten it.",
        )
    place.block.driver_remove(place.full, place.index)
    curve = place.block.driver_add(place.full, place.index)
    driver = curve.driver
    try:
        made = [variable(driver, item, i) for i, item in enumerate(variables)]
        names = [name for name, _, _ in made]
        need(len(set(names)) == len(names), "Each variable has a name of its own.")
        angles = {name for name, angle, _ in made if angle}
        if formula is None and all(angle == place.angle for _, angle, _ in made):
            driver.type = COMBINE[how or "average"]
            written = (how or "average") if len(made) > 1 else ""
        else:
            driver.type = "SCRIPTED"
            source = formula if formula is not None else combined(how or "average", names)
            driver.expression = in_tool_units(source, angles, place.angle, SIMPLE)
            written = f"by {formula}" if formula is not None else ((how or "average") if len(made) > 1 else "")
            need(
                driver.is_simple_expression,
                f"{obj.name}'s {spec['path']} would be driven by {formula}, which needs Python, and this Blender runs"
                f" no Python in a driver. {SIMPLE}",
            )
        bpy.context.view_layer.update()
        need(driver.is_valid, f"Blender cannot work out the driver of {obj.name}'s {spec['path']}: check each variable's object, bone and path.")
    except Exception:
        place.block.driver_remove(place.full, place.index)
        raise
    reads = "; ".join(f"{name}, {words}" for name, _, words in made) if len(made) > 1 or formula else made[0][2]
    shared = [m.name for m in bpy.data.materials if m.node_tree is not None and m.node_tree == place.block]
    path = spec["path"]

    def measured():
        found = over_timeline(place.read)
        values = [shown(place, v) for _, v in found]
        lo, hi = min(values), max(values)
        said = (
            f"its {path} is driven by {reads}" + (f", {written}" if written else "")
            + ", which Blender works out without Python"
            + (f", in every object with {shared[0]}" if shared else "")
            + (f"; {place.note}" if place.note else "")
            + f": {figure(values[0], place)} at {seconds_text(seconds_of(found[0][0]))}"
        )
        if hi - lo > 1e-9:
            said += (
                f", from {figure(lo, place)} at {seconds_text(seconds_of(found[values.index(lo)][0]))}"
                f" to {figure(hi, place)} at {seconds_text(seconds_of(found[values.index(hi)][0]))} over the timeline"
            )
        else:
            said += ", the same over the timeline"
        held = limits(place)
        held = None if held is None else (shown(place, held[0]), shown(place, held[1]))
        if held is not None and (lo <= held[0] + 1e-6 or hi >= held[1] - 1e-6):
            said += f", which Blender holds within {figure(held[0], place)} to {figure(held[1], place)}"
        return said

    defer(said_by_object, obj.name, measured)


def shown(place, value):
    """A value in the tools' units, angles in degrees, without the arithmetic left past a millionth."""
    return round(math.degrees(value) if place.angle else value, 6) + 0.0


def figure(value, place):
    return f"{value:.4g}°" if place.angle else f"{value:.4g}"


def limits(place):
    """The range Blender holds a driven value in, when it holds it: a shape's slider, or a property's own bounds."""
    holder = place.holder
    if isinstance(holder, bpy.types.ShapeKey) and place.name == "value":
        return holder.slider_min, holder.slider_max
    prop = holder.bl_rna.properties.get(place.name) if hasattr(holder, "bl_rna") else None
    if prop is None or prop.type not in ("FLOAT", "INT"):
        return None
    low, high = prop.hard_min, prop.hard_max
    if low < -1e30 and high > 1e30:
        return None
    return low, high
