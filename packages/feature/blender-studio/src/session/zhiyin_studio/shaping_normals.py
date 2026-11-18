"""
How a shape shades: smooth all over, flat, smooth with edges sharper than an angle kept sharp by
Blender's Smooth by Angle step, kept last so the edges later steps make are shaded by it too, or
only those edges marked sharp; weighted normals that keep large faces flat; triangulating that
keeps the shading; and the hard-surface stack of all of them with a bevel that hardens its normals.
Each answer says how many faces shade flat and the share of the surface they cover, before and after.
"""

import math

import bmesh
import bpy

from .arguments import need, number, whole
from .shaping_bevel import round_edges
from .shaping_measure import evaluated_mesh, flat_shading, shading_text
from .wording import one_of

SHADINGS = ("by_angle", "smooth", "flat", "mark_sharp")
WEIGHTINGS = {"face_area": "FACE_AREA", "corner_angle": "CORNER_ANGLE", "both": "FACE_AREA_WITH_ANGLE"}
QUAD_SPLITS = {
    "beauty": "BEAUTY",
    "fixed": "FIXED",
    "alternate": "FIXED_ALTERNATE",
    "shortest_diagonal": "SHORTEST_DIAGONAL",
    "longest_diagonal": "LONGEST_DIAGONAL",
}


SMOOTH_BY_ANGLE = "Smooth by Angle"
# A weighted normal's weight, least, most and by default; the fewest points of a face triangulated.
WEIGHT = (1, 100, 50)
MIN_VERTICES = 4
# How smoothing shades, weighted normals weigh and triangles split quads, unless the call says.
SHADING, WEIGHTING, QUADS = "by_angle", "face_area", "beauty"


def smoothing_steps(obj):
    return [m for m in obj.modifiers if m.type == "NODES" and m.node_group is not None and m.node_group.name.startswith(SMOOTH_BY_ANGLE)]


def kept_local(step):
    """The step's node group as the scene's own, so the file keeps it without Blender's asset library."""
    linked = step.node_group
    if linked.library is None:
        return
    library = linked.library
    own = next((g for g in bpy.data.node_groups if g.library is None and g.name == linked.name), None)
    if own is None:
        step.node_group = linked.make_local()
    else:
        step.node_group = own
        if linked.users == 0:
            bpy.data.node_groups.remove(linked)
    # Linking the asset leaves the asset file named as a library, more than once; one nothing comes from is dropped.
    # Removing one may remove the others it holds, so each is looked for afresh.
    path = library.filepath
    while True:
        linked_from = {i.library for i in bpy.data.all_ids if i.library is not None}
        unused = next((lib for lib in bpy.data.libraries if lib.filepath == path and lib not in linked_from), None)
        if unused is None:
            break
        bpy.data.libraries.remove(unused)


def smooth_by_angle(obj, angle):
    """
    Smooths with Blender's Smooth by Angle step, kept last, keeping edges sharper than the angle
    sharp; how many of its edges, as its steps leave it, are kept so.
    """
    with bpy.context.temp_override(active_object=obj, object=obj, selected_objects=[obj], selected_editable_objects=[obj]):
        done = bpy.ops.object.shade_auto_smooth(use_auto_smooth=True, angle=math.radians(angle))
    steps = smoothing_steps(obj)
    need("FINISHED" in done and steps, f"Blender could not add its Smooth by Angle step to “{obj.name}”.")
    step = steps[-1]
    kept_local(step)
    step.use_pin_to_last = True
    bm = evaluated_mesh(obj)
    try:
        sharp = sum(1 for edge in bm.edges if not edge.smooth and edge.is_manifold)
    finally:
        bm.free()
    return sharp


def unsmoothed(obj):
    """Removes the Smooth by Angle steps, which would shade over what is set on the faces; the words for it, or nothing."""
    steps = smoothing_steps(obj)
    for step in steps:
        obj.modifiers.remove(step)
    return f", its {SMOOTH_BY_ANGLE} step removed" if steps else ""


def kept_sharp_text(sharp, angle):
    return f"its {edges_word(sharp)} sharper than {angle:g}° kept sharp" if sharp else f"no edge sharper than {angle:g}°"


def by_angle_text(sharp, angle):
    return (
        f"smoothed, {kept_sharp_text(sharp, angle)}, by a {SMOOTH_BY_ANGLE} step kept last,"
        " so the edges later steps make are shaded by the same angle"
    )


def edges_word(count):
    return f"{count} {'edge' if count == 1 else 'edges'}"


def shade(obj, faces_smooth, mark):
    """Sets every face smooth or flat, and marks sharp the edges `mark` picks; how many it marked."""
    bm = bmesh.new()
    try:
        bm.from_mesh(obj.data)
        for face in bm.faces:
            face.smooth = faces_smooth
        marked = 0
        for edge in bm.edges:
            edge.smooth = not mark(edge)
            marked += not edge.smooth
        bm.to_mesh(obj.data)
    finally:
        bm.free()
    obj.data.update()
    return marked


def sharper_than(limit):
    return lambda edge: edge.is_manifold and edge.calc_face_angle(0) > limit


def smooth_faces(obj, op):
    shading = op.get("shading", SHADING)
    need(shading in SHADINGS, f"smooth's shading is {one_of(SHADINGS)}.")
    angle = number(op.get("angle"), "smooth angle", minimum=0, maximum=180, default=30)
    if shading == "by_angle":
        return by_angle_text(smooth_by_angle(obj, angle), angle)
    before = flat_shading(obj)
    removed = unsmoothed(obj)
    if shading == "smooth":
        shade(obj, True, lambda edge: False)
        return f"smoothed all over, no edge kept sharp{removed}: {shading_text(before, flat_shading(obj))}"
    if shading == "flat":
        shade(obj, False, lambda edge: False)
        return f"shaded flat{removed}: {shading_text(before, flat_shading(obj))}"
    limit = math.radians(angle)
    bm = bmesh.new()
    try:
        bm.from_mesh(obj.data)
        marked = 0
        for edge in bm.edges:
            edge.smooth = not sharper_than(limit)(edge)
            marked += not edge.smooth
        bm.to_mesh(obj.data)
    finally:
        bm.free()
    obj.data.update()
    return f"{edges_word(marked)} sharper than {angle:g}° marked sharp and the rest not, its faces' shading kept{removed}: {shading_text(before, flat_shading(obj))}"


def weighted_normals(obj, op, before=None):
    """Weighted normals; `before` is the shading said as before, when it is from earlier than this step."""
    just_before = flat_shading(obj)
    before = before or just_before
    weighting = op.get("weighting", WEIGHTING)
    need(weighting in WEIGHTINGS, f"weighted_normals' weighting is {one_of(WEIGHTINGS)}.")
    modifier = obj.modifiers.new("WeightedNormal", "WEIGHTED_NORMAL")
    modifier.mode = WEIGHTINGS[weighting]
    least, most, default = WEIGHT
    modifier.weight = whole(op.get("weight"), "weighted_normals weight", minimum=least, maximum=most, default=default)
    for key in ("keep_sharp", "face_influence"):
        need(op.get(key) is None or isinstance(op.get(key), bool), f"{key} is true or false.")
    modifier.keep_sharp = op.get("keep_sharp", True)
    modifier.use_face_influence = bool(op.get("face_influence"))
    after = flat_shading(obj)
    said = f"normals weighted by {weighting.replace('_', ' ')} at {modifier.weight}"
    if modifier.keep_sharp:
        said += ", sharp edges kept"
    if modifier.use_face_influence:
        said += ", by the faces' strength"
    said += f": {shading_text(before, after)}"
    if just_before[0] == just_before[1]:
        said += "; it was flat-shaded all over, so weighted normals change nothing until it is smoothed"
    return said


def triangulate(obj, op):
    before = flat_shading(obj)
    split = op.get("quads", QUADS)
    need(split in QUAD_SPLITS, f"triangulate's quads is {one_of(QUAD_SPLITS)}.")
    modifier = obj.modifiers.new("Triangulate", "TRIANGULATE")
    modifier.quad_method = QUAD_SPLITS[split]
    modifier.min_vertices = whole(
        op.get("min_vertices"), "min_vertices", minimum=MIN_VERTICES, maximum=10000, default=MIN_VERTICES
    )
    need(op.get("keep_normals") is None or isinstance(op.get("keep_normals"), bool), "keep_normals is true or false.")
    modifier.keep_custom_normals = op.get("keep_normals", True)
    after = flat_shading(obj)
    said = f"triangulated, from {before[1]:,} faces to {after[1]:,} triangles"
    kept = abs(after[2] - before[2]) <= 0.005
    said += ", its shading kept" if kept else f", its shading changed: {shading_text(before, after)}"
    return said


def hard_surface(obj, op):
    """Sharp edges by angle, a bevel hardening its normals, weighted normals keeping them, and triangles if asked."""
    before = flat_shading(obj)
    angle = number(op.get("angle"), "hard_surface angle", minimum=0, maximum=180, default=30)
    smoothed = f"smoothed by a {SMOOTH_BY_ANGLE} step kept last, {kept_sharp_text(smooth_by_angle(obj, angle), angle)}"
    bevel = {key: op[key] for key in ("width", "segments", "width_type", "profile", "miter_outer", "clamp") if key in op}
    rounded = round_edges(obj, {**bevel, "angle": angle, "harden_normals": True, "face_strength": "affected"})
    # Said once for the whole stack, below.
    rounded = rounded.split(", normals hardened")[0]
    weighted = weighted_normals(obj, {"weight": op.get("weight"), "keep_sharp": True, "face_influence": True}, before)
    said = f"hard surface: {smoothed}; {rounded}; {weighted}"
    if op.get("triangulate"):
        said += "; " + triangulate(obj, {"keep_normals": True})
    return said
