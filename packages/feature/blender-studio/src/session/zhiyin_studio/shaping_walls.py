"""
Wall thickness: a solidify step, simple or complex, grown inward by default so the outside keeps
its size, even at corners, with or without a rim, its shell and rim kept in vertex groups and given
materials of their own when asked. The answer gives the walls' thickness as measured between the
two shells, at its thinnest and thickest.
"""

from mathutils.bvhtree import BVHTree

from .arguments import need, number, whole
from .geometry import flat_axis
from .scales import scene_scale
from .shaping_measure import Measure, evaluated_mesh
from .wording import length, one_of, volume_text

MODES = {"simple": "EXTRUDE", "complex": "NON_MANIFOLD"}
# The vertex group a measure marks the new shell with, when the call names none.
SHELL = "zhiyin shell"
# Which way a wall grows, -1 inward to 1 outward: least, most and by default.
WALL_OFFSET = (-1, 1, -1)


def wall_thickness(obj, modifier):
    """
    How thick the walls are, thinnest and thickest, in the world: from each face of the shape's
    own surface to the shell grown from it, those faces told apart by the shell's vertex group.
    """
    named = modifier.shell_vertex_group
    added = None
    if not named:
        added = obj.vertex_groups.new(name=SHELL)
        modifier.shell_vertex_group = added.name
    group = obj.vertex_groups[modifier.shell_vertex_group].index
    try:
        bm = evaluated_mesh(obj, world=True)
        try:
            layer = bm.verts.layers.deform.active
            if layer is None:
                return None

            def shell(v):
                return v[layer].get(group, 0.0) > 0.5

            grown = [f for f in bm.faces if all(shell(v) for v in f.verts)]
            own = [f for f in bm.faces if not any(shell(v) for v in f.verts)]
            if not grown or not own:
                return None
            tree = BVHTree.FromPolygons([v.co[:] for v in bm.verts], [[v.index for v in f.verts] for f in grown])
            gaps = []
            # From each face's middle: a corner's nearest wall lies across the corner, not through it.
            for face in own:
                found = tree.find_nearest(face.calc_center_median())
                if found[0] is not None:
                    gaps.append(found[3])
        finally:
            bm.free()
    finally:
        if added is not None:
            modifier.shell_vertex_group = ""
            obj.vertex_groups.remove(added)
    return (min(gaps), max(gaps)) if gaps else None


def named_group(obj, op, key):
    """A vertex group the solidify step fills, made when the object has none of that name."""
    name = op.get(key)
    if name is None:
        return ""
    need(isinstance(name, str) and name.strip(), f"{key} names a vertex group.")
    if obj.vertex_groups.get(name) is None:
        obj.vertex_groups.new(name=name)
    return name


def give_thickness(obj, op):
    thickness = number(op.get("thickness"), "thickness", minimum=1e-7)
    before = Measure(obj)
    modifier = obj.modifiers.new("Solidify", "SOLIDIFY")
    mode = op.get("mode", "simple")
    need(mode in MODES, f"A solidify's mode is {one_of(MODES)}.")
    modifier.solidify_mode = MODES[mode]
    # As thick as the scene has it: a flat sheet across its flat side, else at its narrowest.
    reach = scene_scale(obj)
    axis = flat_axis(obj.data) if obj.type == "MESH" else None
    modifier.thickness = thickness / (reach[axis] if axis is not None else min(reach))
    least, most, default = WALL_OFFSET
    modifier.offset = number(op.get("wall_offset"), "wall_offset", minimum=least, maximum=most, default=default)
    for key in ("even", "rim", "rim_only"):
        need(op.get(key) is None or isinstance(op.get(key), bool), f"{key} is true or false.")
    # Walls as thick as asked at corners too, not thinned along slanted normals.
    even = op.get("even", True)
    modifier.use_even_offset = even
    if mode == "complex":
        modifier.nonmanifold_thickness_mode = "EVEN" if even else "FIXED"
    modifier.use_rim = op.get("rim", True)
    modifier.use_rim_only = bool(op.get("rim_only"))
    modifier.shell_vertex_group = named_group(obj, op, "shell_group")
    modifier.rim_vertex_group = named_group(obj, op, "rim_group")
    if op.get("material_offset") is not None:
        modifier.material_offset = whole(op.get("material_offset"), "material_offset", minimum=-32767, maximum=32767)
    if op.get("rim_material_offset") is not None:
        modifier.material_offset_rim = whole(op.get("rim_material_offset"), "rim_material_offset", minimum=-32767, maximum=32767)
    after = Measure(obj)
    said = f"walls {length(thickness)} thick"
    if axis is not None:
        made = after.size[axis]
        if abs(made - thickness) > 0.01 * thickness:
            said += f", though the sheet is now {length(made)} thick"
    elif before.shape.closed and before.shape.volume and after.shape.volume is not None:
        said += (
            f", hollow inside and sealed, so it looks as before: its volume went from {volume_text(before.shape.volume)}"
            f" to {volume_text(after.shape.volume)}"
        )
    if mode == "complex":
        said += ", by the complex method"
    if modifier.use_rim_only:
        said += ", only its rim kept"
    elif not modifier.use_rim:
        said += ", its rim left open"
    measured = None if modifier.use_rim_only else wall_thickness(obj, modifier)
    if measured is not None:
        thinnest, thickest = measured
        said += (
            f"; its walls measure {length(thinnest)} thick throughout"
            if thickest - thinnest <= 1e-6
            else f"; its walls measure {length(thinnest)} to {length(thickest)} thick"
        )
    for key, field in (("shell_group", "shell"), ("rim_group", "rim")):
        if op.get(key):
            said += f", its {field} in the vertex group {op[key]}"
    if op.get("material_offset"):
        said += f", its new shell taking the material {modifier.material_offset:+d} slots on"
    if op.get("rim_material_offset"):
        said += f", its rim the material {modifier.material_offset_rim:+d} slots on"
    return said
