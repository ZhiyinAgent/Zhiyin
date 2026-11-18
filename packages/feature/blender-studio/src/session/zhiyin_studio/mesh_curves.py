"""
Curves made from points, and a Geometry Nodes modifier's inputs set by the names people see.
A curve says its kind, how long it is, where it lies, how thick its tube is, its sharp corners,
its tightest bend and where it crosses itself or its tube runs into itself. Setting inputs
says each value as Blender holds it afterwards, what it was before, a value past the input's own
range, which Blender takes without a word, and what the group's nodes warn of.
"""

import math

import bpy

from .arguments import is_number, need, number, vector, whole
from .curve_runs import runs_text
from .errors import Refused
from .finding import find_object, scene
from .geometry import world_bounds
from .reports import report
from .wording import length

KINDS = {"bezier": "BEZIER", "nurbs": "NURBS", "poly": "POLY"}
HANDLES = {"auto": "AUTO", "vector": "VECTOR", "aligned": "ALIGNED", "free": "FREE"}


def per_point(value, name, count, default):
    """One value for every point, or a value each."""
    if value is None:
        return [default] * count
    if is_number(value):
        return [float(value)] * count
    need(
        isinstance(value, (list, tuple)) and len(value) == count and all(is_number(v) for v in value),
        f"{name} must be one number or one for each of the {count} points.",
    )
    return [float(v) for v in value]


def spread(points):
    lows = [min(p[i] for p in points) for i in range(3)]
    highs = [max(p[i] for p in points) for i in range(3)]
    return ", ".join(
        f"{axis} {length(low)}" if abs(high - low) < 1e-6 else f"{axis} {length(low)} to {length(high)}"
        for axis, low, high in zip("xyz", lows, highs)
    )


def curve(
    name,
    points,
    *,
    kind="bezier",
    cyclic=False,
    handles="auto",
    order=3,
    weights=None,
    tilt=None,
    radius=None,
    depth=0,
    resolution=12,
    location=(0, 0, 0),
):
    """
    A new curve object through `points`, in the object's own space: bezier with handles of one
    kind, NURBS of an order with a weight each, or poly. Tilt is in degrees and radius scales the
    tube at each point; `depth` gives it a round tube of that radius. Says its kind, its length,
    whether it is closed, where it lies, how thick its tube is, its sharp corners, its tightest
    bend, a tube wider than that bend, and where it crosses itself.
    """
    need(isinstance(name, str) and name.strip(), "Name the curve.")
    need(bpy.data.objects.get(name) is None, f"An object named “{name}” is already there; choose another name.")
    need(kind in KINDS, f"kind must be one of {', '.join(KINDS)}.")
    need(handles in HANDLES, f"handles must be one of {', '.join(HANDLES)}.")
    need(isinstance(points, (list, tuple)), "points must be a list of [x, y, z].")
    need(len(points) >= 2, f"A curve needs at least 2 points; this has {len(points)}.")
    places = [vector(p, f"point {i + 1}") for i, p in enumerate(points)]
    count = len(places)
    rank = whole(order, "order", minimum=2, maximum=6, default=3)
    if kind == "nurbs":
        need(count >= rank, f"A NURBS curve of order {rank} needs at least {rank} points; this has {count}.")
    weighted = per_point(weights, "weights", count, 1.0)
    need(all(w > 0 for w in weighted), "Every weight must be greater than 0.")
    tilted = per_point(tilt, "tilt", count, 0.0)
    widths = per_point(radius, "radius", count, 1.0)
    need(all(w >= 0 for w in widths), "No radius may be below 0.")
    thickness = number(depth, "depth", minimum=0, default=0)
    steps = whole(resolution, "resolution", minimum=1, maximum=64, default=12)
    at = vector(location, "location")

    data = bpy.data.curves.new(name, "CURVE")
    data.dimensions = "3D"
    data.resolution_u = steps
    data.bevel_depth = thickness
    data.use_fill_caps = thickness > 0
    spline = data.splines.new(KINDS[kind])
    spline.use_cyclic_u = bool(cyclic)
    if kind == "bezier":
        spline.bezier_points.add(count - 1)
        for point, place, turn, width in zip(spline.bezier_points, places, tilted, widths):
            point.co = place
            point.handle_left_type = point.handle_right_type = HANDLES[handles]
            point.tilt = math.radians(turn)
            point.radius = width
    else:
        spline.points.add(count - 1)
        for point, place, weight, turn, width in zip(spline.points, places, weighted, tilted, widths):
            point.co = (place.x, place.y, place.z, weight)
            point.tilt = math.radians(turn)
            point.radius = width
        if kind == "nurbs":
            spline.order_u = rank
            spline.use_endpoint_u = not cyclic
    obj = bpy.data.objects.new(name, data)
    obj.location = at
    scene().collection.objects.link(obj)
    bpy.context.view_layer.update()

    long = spline.calc_length()
    if long <= 0:
        raise Refused(f"{name}'s points all lie in one place, so it has no length.")
    # A tube spans what it is drawn as; a bare curve, its points.
    bounds = world_bounds([obj]) if thickness else None
    shape = list(bounds) if bounds else [obj.matrix_world @ p for p in places]
    runs = runs_text(obj, kind, bool(cyclic), thickness * max(widths))
    report(
        f"Made {name}, a {kind} curve through {count} points, {'closed' if cyclic else 'open'}:"
        f" {length(long)} long; {spread(shape)}"
        + (f"; a tube {length(thickness * 2)} across" if thickness else "")
        + f"{runs}."
    )
    return obj


KIND_WORDS = {
    "NodeSocketFloat": "a number",
    "NodeSocketInt": "a whole number",
    "NodeSocketBool": "true or false",
    "NodeSocketVector": "three numbers",
    "NodeSocketColor": "a colour of four numbers",
    "NodeSocketString": "text",
    "NodeSocketObject": "an object",
    "NodeSocketCollection": "a collection",
    "NodeSocketMaterial": "a material",
    "NodeSocketImage": "an image",
    "NodeSocketMenu": "one of its menu's items",
    "NodeSocketRotation": "a rotation",
}
# Where each kind of input's data is found, by name. Looked up when used: opening a file
# replaces bpy.data's collections, and one kept from before crashes Blender.
DATA = {
    "NodeSocketObject": "objects",
    "NodeSocketCollection": "collections",
    "NodeSocketMaterial": "materials",
    "NodeSocketImage": "images",
}


def nodes_modifier(obj, named):
    mods = [m for m in obj.modifiers if m.type == "NODES" and m.node_group]
    need(mods, f"{obj.name} has no Geometry Nodes modifier with a node group.")
    if named is None:
        need(
            len(mods) == 1,
            f"{obj.name} has {len(mods)} Geometry Nodes modifiers: {', '.join(m.name for m in mods)}. Name one.",
        )
        return mods[0]
    found = next((m for m in mods if m.name == named), None)
    need(found, f"{obj.name} has no Geometry Nodes modifier named “{named}”: {', '.join(m.name for m in mods)}.")
    return found


def group_inputs(group):
    """The group's inputs a person can set, in their order."""
    return [
        item
        for item in group.interface.items_tree
        if item.item_type == "SOCKET" and item.in_out == "INPUT" and item.socket_type != "NodeSocketGeometry"
    ]


def shown(value):
    """A value as an answer says it."""
    if value is None:
        return "nothing"
    if isinstance(value, bpy.types.ID):
        return value.name
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float):
        return f"{value:.6g}"
    if hasattr(value, "__len__") and not isinstance(value, str):
        return "[" + ", ".join(shown(v) for v in value) + "]"
    return str(value)


def given_value(item, value):
    """`value` as the input takes it, refused in words when it is not of its kind."""
    kind = item.socket_type
    words = KIND_WORDS.get(kind, kind)
    if kind in DATA:
        if value is None or isinstance(value, bpy.types.ID):
            return value
        need(isinstance(value, str), f"{item.name} takes {words}, given by name.")
        found = getattr(bpy.data, DATA[kind]).get(value)
        need(found is not None, f"There is no {words[3:] if words.startswith('an ') else words[2:]} named “{value}”.")
        return found
    if kind == "NodeSocketInt":
        need(is_number(value) and float(value).is_integer(), f"{item.name} takes {words}, not {shown(value)}.")
        return int(value)
    if kind == "NodeSocketFloat":
        need(is_number(value), f"{item.name} takes {words}, not {shown(value)}.")
        return float(value)
    if kind == "NodeSocketBool":
        need(isinstance(value, bool), f"{item.name} takes {words}, not {shown(value)}.")
        return value
    return value


def set_inputs(obj, modifier=None, **values):
    """
    Sets a Geometry Nodes modifier's inputs by the names its group gives them: a number, a whole
    number, true or false, three numbers, an object, collection, material or image by name, or
    {'attribute': name} to read the input from an attribute. Says each value as Blender holds it
    afterwards and what it was, any value past the input's own range, and the nodes' warnings.
    """
    obj = obj if isinstance(obj, bpy.types.Object) else find_object(obj)
    need(values, "Name at least one input to set, as Size=2.")
    mod = nodes_modifier(obj, modifier)
    group = mod.node_group
    items = group_inputs(group)
    by_name = {item.name: item for item in items}
    for name in values:
        if name not in by_name:
            listed = ", ".join(f"{item.name} ({KIND_WORDS.get(item.socket_type, item.socket_type)})" for item in items)
            raise Refused(
                f"{group.name} on {obj.name} has no input named “{name}”."
                + (f" Its inputs: {listed}." if listed else " It has no inputs to set.")
            )
    said = []
    for name, value in values.items():
        item = by_name[name]
        held = getattr(mod.properties.inputs, item.identifier)
        before = (
            f"the attribute “{held.attribute_name}”" if held.type == "ATTRIBUTE" else shown(held.value)
        )
        if isinstance(value, dict):
            need(
                set(value) == {"attribute"} and isinstance(value["attribute"], str) and value["attribute"],
                f"{name}: give {{'attribute': name}} to read it from an attribute.",
            )
            need(
                "attribute_name" in held.bl_rna.properties and "ATTRIBUTE" in [
                    e.identifier for e in held.bl_rna.properties["type"].enum_items
                ],
                f"{name} cannot be read from an attribute.",
            )
            held.type = "ATTRIBUTE"
            held.attribute_name = value["attribute"]
            said.append(f"{name} from the attribute “{held.attribute_name}” (was {before})")
            continue
        taken = given_value(item, value)
        try:
            if "type" in held.bl_rna.properties:
                held.type = "VALUE"
            held.value = taken
        except (TypeError, ValueError) as error:
            raise Refused(f"{name} takes {KIND_WORDS.get(item.socket_type, item.socket_type)}: {error}") from error
        line = f"{name} {shown(held.value)} (was {before})"
        line += beyond_range(item, held.value)
        said.append(line)
    bpy.context.view_layer.update()
    obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    warned = [getattr(w, "message", str(w)) for w in mod.node_warnings]
    report(
        f"Set {group.name}'s inputs on {obj.name}: {', '.join(said)}."
        + (f" Its nodes warn: {'; '.join(warned)}." if warned else " Its nodes give no warnings.")
    )
    return mod


def beyond_range(item, value):
    """What an answer adds for a value past the input's own minimum or maximum."""
    if not is_number(value) or not hasattr(item, "min_value"):
        return ""
    if value > item.max_value:
        return f", above its maximum of {shown(float(item.max_value))}, which the group may not expect"
    if value < item.min_value:
        return f", below its minimum of {shown(float(item.min_value))}, which the group may not expect"
    return ""


FUNCTIONS = (curve, set_inputs)
