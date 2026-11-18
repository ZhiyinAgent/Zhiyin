"""
Modelling operations on an object: cutting, joining, rounding, repeating, mirroring, thickening,
subdividing, shading, remeshing, displacing, wrapping, and a curve's geometry.

Each operation but a remesh is a modifier, so it stays editable until applied. A cutter described
in the call becomes its own object in the Cutters collection, never rendered, so a hole can be
moved or resized later. Each says what it did, measured on the shape before and after it, and an
input its kind does not take is refused, naming the kinds that take it.
"""

import bpy

from .aiming import keeps_focus
from .arguments import need
from .finding import CUTTERS, find_object
from .glass import lets_light_through_sheets
from .mesh_checks import wall_text
from .model_shapes import is_cad_part
from .placing import placed
from .shaping_array import repeat
from .shaping_bevel import round_edges
from .shaping_boolean import boolean
from .shaping_curve import curve_geometry
from .shaping_deform import displace, shrinkwrap
from .shaping_measure import Measure
from .shaping_mirror import mirror
from .shaping_normals import hard_surface, smooth_faces, triangulate, weighted_normals
from .shaping_remesh import remesh
from .shaping_subdivide import subdivide
from .shaping_walls import give_thickness
from .wood import lays_grain
from .wording import one_of, size_text


def apply_modifiers(obj):
    """Bakes the modifiers into the mesh, and removes cutters and helpers nothing else uses."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    mesh = bpy.data.meshes.new_from_object(evaluated)
    used = [m.object for m in obj.modifiers if m.type == "BOOLEAN" and m.object is not None]
    used += [m.offset_object for m in obj.modifiers if m.type == "ARRAY" and m.offset_object is not None]
    old = obj.data
    obj.modifiers.clear()
    obj.data = mesh
    mesh.name = obj.name
    if old.users == 0:
        bpy.data.meshes.remove(old)
    for other in used:
        unused_helper(other)


def unused_helper(other):
    """Removes a cutter or a helper of the Cutters collection that no step of any object uses."""
    still_used = any(
        getattr(m, "object", None) == other or getattr(m, "offset_object", None) == other
        for o in bpy.data.objects
        if o != other
        for m in o.modifiers
    )
    if not still_used and any(c.name == CUTTERS for c in other.users_collection):
        bpy.data.objects.remove(other)


def remove_modifier(obj, op):
    name = op.get("modifier")
    found = obj.modifiers.get(name) if isinstance(name, str) else None
    need(found is not None, f"“{obj.name}” has no modifier named “{name}”. It has: {', '.join(m.name for m in obj.modifiers) or 'none'}.")
    before = Measure(obj)
    helper = found.offset_object if found.type == "ARRAY" else None
    obj.modifiers.remove(found)
    if helper is not None:
        unused_helper(helper)
    after = Measure(obj)
    said = f"{name} removed, from {before.faces:,} faces to {after.faces:,}"
    if any(abs(a - b) > 1e-6 for a, b in zip(after.size, before.size)):
        said += f", its size from {size_text(before.size)} to {size_text(after.size)}"
    return said


# Each kind of operation: given the object and the operation, it answers what was done.
OPERATIONS = {
    "boolean": boolean,
    "bevel": round_edges,
    "array": repeat,
    "mirror": mirror,
    "solidify": give_thickness,
    "subdivision": subdivide,
    "smooth": smooth_faces,
    "remesh": remesh,
    "weighted_normals": weighted_normals,
    "triangulate": triangulate,
    "hard_surface": hard_surface,
    "displace": displace,
    "shrinkwrap": shrinkwrap,
    "curve": curve_geometry,
    "remove": remove_modifier,
}

BEVEL_TAKES = ("width", "segments", "angle", "width_type", "limit", "vertex_group", "attribute", "profile")
BEVEL_TAKES += ("miter_outer", "miter_inner", "clamp", "harden_normals", "face_strength")

# What each kind takes besides its kind.
TAKES = {
    "boolean": ("operation", "with", "collection", "cutter", "keep_visible", "solver", "self_intersection", "hole_tolerant"),
    "bevel": BEVEL_TAKES,
    "array": (
        "count",
        "offset",
        "relative",
        "offset_object",
        "fit",
        "length",
        "curve",
        "curve_axis",
        "merge",
        "start_cap",
        "end_cap",
        "around",
    ),
    "mirror": ("axes", "across", "clip", "merge", "bisect", "flip", "mirror_u", "mirror_v"),
    "solidify": (
        "thickness",
        "wall_offset",
        "mode",
        "even",
        "rim",
        "rim_only",
        "shell_group",
        "rim_group",
        "material_offset",
        "rim_material_offset",
    ),
    "subdivision": ("levels", "render_levels", "scheme", "crease", "angle", "edges", "boundary", "uv_smooth", "limit_surface"),
    "smooth": ("shading", "angle"),
    "remesh": ("method", "voxel_size", "adaptivity", "keep_attributes", "faces", "edge_length", "keep_sharp", "keep_boundary", "symmetry", "seed"),
    "weighted_normals": ("weighting", "weight", "keep_sharp", "face_influence"),
    "triangulate": ("quads", "min_vertices", "keep_normals"),
    "hard_surface": ("width", "segments", "angle", "width_type", "profile", "miter_outer", "clamp", "weight", "triangulate"),
    "displace": ("texture", "image", "texture_size", "strength", "midlevel", "direction", "space", "vertex_group", "mask"),
    "shrinkwrap": ("target", "wrap", "wrap_mode", "standoff", "project_axes", "both_ways", "vertex_group"),
    "curve": (
        "bevel_mode",
        "depth",
        "resolution",
        "curve_resolution",
        "bevel_object",
        "profile_preset",
        "extrude",
        "curve_offset",
        "taper_object",
        "taper_mode",
        "fill",
        "caps",
        "twist",
        "twist_smooth",
    ),
    "remove": ("modifier",),
}

# What each step that changes a shape does to it, said when a CAD part's is refused.
CHANGES_SHAPE = {
    "boolean": "cutting or joining",
    "bevel": "rounding",
    "array": "repeating",
    "mirror": "mirroring",
    "solidify": "thickening",
    "subdivision": "subdividing",
    "remesh": "remeshing",
    "hard_surface": "rounding",
    "displace": "displacing",
    "shrinkwrap": "wrapping",
}


def refuse_cad_change(obj, kind):
    """A CAD part's shape changes in the CAD, where it is designed, checked and drawn."""
    if kind not in CHANGES_SHAPE or not is_cad_part(obj):
        return
    how = "round its edges in the CAD with round_edges" if kind in ("bevel", "hard_surface") else "change it in the CAD"
    need(
        False,
        f"“{obj.name}” is a part from the CAD studio, so {CHANGES_SHAPE[kind]} it here would leave its shape "
        f"apart from the design, its checks and its drawings, and a bevel or subdivision tears the joins of its mesh. "
        f"Instead, {how}, export it again, and give it the new shape with blender_edit_objects shapes_from, "
        "which keeps its place, materials and motion.",
    )


def check_takes(op):
    """Refuses an input the operation's kind does not take, which would otherwise be dropped without a word."""
    unused = sorted(set(op) - {"kind"} - set(TAKES[op["kind"]]))
    if not unused:
        return
    whose = "; ".join(
        f"{key} is for {', '.join(k for k, takes in TAKES.items() if key in takes) or 'no kind'}" for key in unused
    )
    need(False, f"A {op['kind']} step takes {', '.join(TAKES[op['kind']])}; {whose}.")


def check_object(obj, kind):
    """A curve takes its geometry's settings; a mesh takes every other step."""
    if obj.type == "CURVE":
        need(kind == "curve", f"“{obj.name}” is a curve, which takes curve steps; a {kind} step is for a mesh.")
    else:
        need(kind != "curve", f"“{obj.name}” is a mesh; a curve step sets a curve's geometry, such as a path's.")


@keeps_focus
@lets_light_through_sheets
@lays_grain
def shape_objects(args, scene_file):
    obj = find_object(args.get("object"), {"MESH", "CURVE"})
    operations = args.get("operations")
    need(isinstance(operations, list) and operations, "operations must list at least one operation.")
    done = []
    for op in operations:
        need(isinstance(op, dict) and isinstance(op.get("kind"), str), "Each operation has a kind.")
        need(op["kind"] in OPERATIONS, f"An operation's kind is {one_of(OPERATIONS)}.")
        check_takes(op)
        check_object(obj, op["kind"])
        refuse_cad_change(obj, op["kind"])
    for op in operations:
        done.append(OPERATIONS[op["kind"]](obj, op))
    if args.get("apply"):
        need(obj.type == "MESH", f"“{obj.name}” is a curve, whose settings stay editable: apply is for a mesh.")
        apply_modifiers(obj)
        done.append("applied")
    # Its holes and crossing faces follow with the checks of the change.
    wall = wall_text(obj) if obj.type == "MESH" else ""
    return f"{obj.name}: {'; '.join(done)}. Now {placed(obj)}.{wall}"
