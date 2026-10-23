"""Modelling operations on an object: cutting, joining, rounding, repeating.

Each operation is a modifier, so it stays editable until applied. A cutter
described in the call becomes its own object in the Cutters collection, never
rendered, so a hole can be moved or resized later.
"""

import math

import bmesh
import bpy
import mathutils

from .common import (
    CUTTERS,
    collection,
    find_object,
    length,
    need,
    number,
    one_of,
    positive_size,
    rotation,
    size_text,
    unused_name,
    vector,
    whole,
)
from .objects import attach, bevel_width, cube, cylinder, mesh_from, placed, smooth, sphere

CUTTER_SHAPES = {"box": cube, "cube": cube, "cylinder": cylinder, "sphere": sphere}


CUTTER_TAKES = {"cylinder": ("diameter", "depth", "size"), "box": ("size",), "cube": ("size",), "sphere": ("diameter", "size")}


def cutter(spec, target):
    need(isinstance(spec, dict), "A cutter is described by its shape, size and location.")
    shape = spec.get("shape", "cylinder")
    need(shape in CUTTER_SHAPES, "A cutter's shape is box, cylinder or sphere.")
    unused = sorted(set(spec) - {"shape", "location", "rotation", "segments"} - set(CUTTER_TAKES[shape]))
    need(not unused, f"A {shape} cutter takes {', '.join(CUTTER_TAKES[shape])}, not {', '.join(unused)}.")
    size = spec.get("size")
    if size is None and shape == "cylinder":
        diameter = number(spec.get("diameter"), "cutter diameter", minimum=1e-7)
        depth = number(spec.get("depth"), "cutter depth", minimum=1e-7)
        size = [diameter, diameter, depth]
    elif size is None and shape == "sphere" and spec.get("diameter") is not None:
        diameter = number(spec.get("diameter"), "cutter diameter", minimum=1e-7)
        size = [diameter] * 3
    # Never a default: a cutter of the wrong size takes the wrong part away.
    need(size is not None, f"A {shape} cutter needs its size, [x, y, z] in metres.")
    size = list(positive_size(size, "cutter size"))
    built = CUTTER_SHAPES[shape]({"size": size, "segments": spec.get("segments")})
    index = 1
    while bpy.data.objects.get(f"{target.name} cutter {index}"):
        index += 1
    name = f"{target.name} cutter {index}"
    obj = bpy.data.objects.new(name, mesh_from(built, name))
    collection(CUTTERS, hide_render=True).objects.link(obj)
    obj.location = vector(spec.get("location"), "cutter location")
    obj.rotation_euler = rotation(spec.get("rotation"))
    obj.display_type = "WIRE"
    obj.hide_render = True
    # Attached where it is, so the hole moves, turns and is copied with its object.
    attach(obj, target)
    return obj, size


def boolean(obj, spec):
    operation = spec.get("operation", "difference")
    need(operation in ("difference", "union", "intersect"), "A boolean's operation is difference, union or intersect.")
    if spec.get("cutter") is not None:
        other, size = cutter(spec["cutter"], obj)
        shape = spec["cutter"].get("shape", "cylinder")
        what = (
            f"a {length(size[0])} round hole, {length(size[2])} deep"
            if shape == "cylinder" and operation == "difference"
            else f"a {shape} {operation}, {size_text(size)}"
        )
    else:
        other = find_object(spec.get("with"), {"MESH"})
        need(other != obj, "An object cannot be combined with itself.")
        what = f"{operation} with {other.name}"
        if not spec.get("keep_visible"):
            other.hide_render = True
            other.display_type = "WIRE"
    modifier = obj.modifiers.new(f"Boolean {other.name}", "BOOLEAN")
    modifier.operation = operation.upper()
    modifier.object = other
    modifier.solver = "EXACT"
    return what


def mirror_middle(obj, across):
    """The middle of an object's shape, where a mirror sees it: in its own space, or the space of the object it is mirrored around."""
    bpy.context.view_layer.update()
    to_mirror = across.matrix_world.inverted() @ obj.matrix_world if across else mathutils.Matrix.Identity(4)
    corners = [to_mirror @ mathutils.Vector(c) for c in obj.bound_box]
    return [(min(c[i] for c in corners) + max(c[i] for c in corners)) / 2 for i in range(3)]


def apply_modifiers(obj):
    """Bakes the modifiers into the mesh, and removes cutters nothing else uses."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    mesh = bpy.data.meshes.new_from_object(evaluated)
    used = [m.object for m in obj.modifiers if m.type == "BOOLEAN" and m.object is not None]
    old = obj.data
    obj.modifiers.clear()
    obj.data = mesh
    mesh.name = obj.name
    if old.users == 0:
        bpy.data.meshes.remove(old)
    for other in used:
        still_used = any(
            m.type == "BOOLEAN" and m.object == other for o in bpy.data.objects if o != other for m in o.modifiers
        )
        if not still_used and any(c.name == CUTTERS for c in other.users_collection):
            bpy.data.objects.remove(other)


def round_edges(obj, op):
    width = bevel_width(obj, op.get("width"))
    modifier = obj.modifiers.new("Bevel", "BEVEL")
    modifier.width = width
    modifier.segments = whole(op.get("segments"), "bevel segments", maximum=32, default=3)
    modifier.limit_method = "ANGLE"
    modifier.angle_limit = math.radians(number(op.get("angle"), "bevel angle", minimum=0, maximum=180, default=30))
    return f"edges rounded by {length(modifier.width)}"


def repeat(obj, op):
    modifier = obj.modifiers.new("Array", "ARRAY")
    modifier.count = whole(op.get("count"), "array count", minimum=2, maximum=1000)
    modifier.use_relative_offset = False
    modifier.use_constant_offset = True
    modifier.constant_offset_displace = vector(op.get("offset"), "array offset")
    return f"repeated {modifier.count} times"


def mirror(obj, op):
    axes = op.get("axes", ["x"])
    need(isinstance(axes, list) and axes and all(a in ("x", "y", "z") for a in axes), "mirror axes are x, y or z.")
    across = find_object(op["across"]) if op.get("across") else None
    middle = mirror_middle(obj, across)
    modifier = obj.modifiers.new("Mirror", "MIRROR")
    used = [a in axes for a in ("x", "y", "z")]
    modifier.use_axis = used
    modifier.use_clip = True
    modifier.mirror_object = across
    # A shape reaching across the mirror would overlap its own image,
    # counted twice; the part across is cut away, keeping the side the
    # shape mostly lies on.
    modifier.use_bisect_axis = used
    modifier.use_bisect_flip_axis = [u and middle[i] < 0 for i, u in enumerate(used)]
    return f"mirrored across {', '.join(axes)}"


def give_thickness(obj, op):
    modifier = obj.modifiers.new("Solidify", "SOLIDIFY")
    modifier.thickness = number(op.get("thickness"), "thickness", minimum=1e-7)
    modifier.offset = number(op.get("offset"), "solidify offset", minimum=-1, maximum=1, default=-1)
    # Walls as thick as asked at corners too, not thinned along slanted normals.
    modifier.use_even_offset = True
    return f"walls {length(modifier.thickness)} thick"


def subdivide(obj, op):
    modifier = obj.modifiers.new("Subdivision", "SUBSURF")
    modifier.levels = whole(op.get("levels"), "subdivision levels", minimum=1, maximum=5, default=2)
    modifier.render_levels = modifier.levels
    return f"subdivided {modifier.levels} times"


def smooth_faces(obj, op):
    smooth(obj, number(op.get("angle"), "smooth angle", minimum=0, maximum=180, default=30))
    return "smoothed"


def remove_modifier(obj, op):
    name = op.get("modifier")
    found = obj.modifiers.get(name) if isinstance(name, str) else None
    need(found is not None, f"“{obj.name}” has no modifier named “{name}”. It has: {', '.join(m.name for m in obj.modifiers) or 'none'}.")
    obj.modifiers.remove(found)
    return f"{name} removed"


# Each kind of operation: given the object and the operation, it answers what was done.
OPERATIONS = {
    "boolean": boolean,
    "bevel": round_edges,
    "array": repeat,
    "mirror": mirror,
    "solidify": give_thickness,
    "subdivision": subdivide,
    "smooth": smooth_faces,
    "remove": remove_modifier,
}


def shape_objects(args, scene_file):
    obj = find_object(args.get("object"), {"MESH"})
    operations = args.get("operations")
    need(isinstance(operations, list) and operations, "operations must list at least one operation.")
    done = []
    for op in operations:
        need(isinstance(op, dict) and isinstance(op.get("kind"), str), "Each operation has a kind.")
        need(op["kind"] in OPERATIONS, f"An operation's kind is {one_of(OPERATIONS)}.")
        done.append(OPERATIONS[op["kind"]](obj, op))
    if args.get("apply"):
        apply_modifiers(obj)
        done.append("applied")
    return f"{obj.name}: {'; '.join(done)}. Now {placed(obj)}."
