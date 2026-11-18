"""
Moving a shape's points by something outside it: a displace step by a noise, Voronoi, clouds or
workspace picture texture, along its normals, an axis or the picture's colours, held to the faces
facing up, those facing sideways or a vertex group; and a shrinkwrap step onto another object's
surface, by the nearest point, a projection or the nearest corner. The answers measure what moved:
how far the points went and how the size grew, edges too long for the pattern to show on, and how
far the wrapped points still lie from the surface.
"""

import os

import bpy
from mathutils.bvhtree import BVHTree

from .arguments import need, number
from .finding import find_object
from .scales import scene_scale
from .shaping_measure import Measure, evaluated_mesh
from .soundness import mesh_of
from .tolerances import TOUCH
from .wording import length, one_of, size_text

TEXTURES = {"noise": "NOISE", "voronoi": "VORONOI", "clouds": "CLOUDS", "image": "IMAGE"}
DIRECTIONS = {"normal": "NORMAL", "x": "X", "y": "Y", "z": "Z", "custom_normal": "CUSTOM_NORMAL", "rgb_to_xyz": "RGB_TO_XYZ"}
SPACES = {"local": "LOCAL", "global": "GLOBAL"}
WRAPS = {
    "nearest_surface": "NEAREST_SURFACEPOINT",
    "project": "PROJECT",
    "nearest_vertex": "NEAREST_VERTEX",
    "target_normal": "TARGET_PROJECT",
}
WRAP_MODES = {
    "on_surface": "ON_SURFACE",
    "outside": "OUTSIDE",
    "above_surface": "ABOVE_SURFACE",
    "inside": "INSIDE",
    "outside_surface": "OUTSIDE_SURFACE",
}
# A shape with fewer points than this has few to move: a displace shows as a few corners moved.
FEW_POINTS = 100
# The faces a displace's mask holds, by the way they face in the world.
MASKS = {"top": "facing up", "sides": "facing sideways"}
# A face faces up when its normal leans less than 45° from straight up, and sideways when less than 45° from level.
MASK_SLOPE = 0.7071
# The texture's value a displacement does not move: least, most and by default.
MIDLEVEL = (0, 1, 0.5)
# A displace's texture and way, and a shrinkwrap's wrap and mode, unless the call says.
TEXTURE, DIRECTION, WRAP, WRAP_MODE = "clouds", "normal", "nearest_surface", "on_surface"


def world_points(obj):
    bm = evaluated_mesh(obj, world=True)
    try:
        return [v.co.copy() for v in bm.verts]
    finally:
        bm.free()


def vertex_group(obj, op):
    name = op.get("vertex_group")
    if name is None:
        return ""
    need(
        obj.vertex_groups.get(name) is not None,
        f"“{obj.name}” has no vertex group named “{name}”; it has: {', '.join(g.name for g in obj.vertex_groups) or 'none'}.",
    )
    return name


def texture_for(obj, op):
    kind = op.get("texture", TEXTURE)
    need(kind in TEXTURES, f"A displace's texture is {one_of(TEXTURES)}.")
    texture = bpy.data.textures.new(f"{obj.name} displace", TEXTURES[kind])
    if kind == "image":
        path = op.get("image")
        need(isinstance(path, str) and path, "A displace by an image names the workspace picture in image.")
        picture = bpy.data.images.load(path, check_existing=True)
        need(picture.size[0] > 0 and picture.size[1] > 0, f"{os.path.basename(path)} could not be read as a picture.")
        texture.image = picture
        return texture, f"the picture {os.path.basename(path)}"
    if kind == "noise":
        need(
            op.get("texture_size") is None,
            "noise moves each point by its own random amount and has no size: for a pattern of a size, give texture clouds or voronoi.",
        )
        return texture, kind
    if op.get("texture_size") is not None:
        size = number(op.get("texture_size"), "texture_size", minimum=1e-6)
        texture.noise_scale = size / max(scene_scale(obj))
        return texture, f"{kind} {length(size)} across"
    return texture, kind


def pattern_size(obj, texture):
    """How wide a texture's pattern is in the world, in metres, or nothing for one with no size of its own."""
    if not hasattr(texture, "noise_scale"):
        return None
    return texture.noise_scale * max(scene_scale(obj))


def facing_group(obj, mask):
    """
    A vertex group of the points on faces facing up ("top") or to the side ("sides") in the world,
    each weighted by the share of its faces' area that faces that way; its name and how many points
    it holds.
    """
    turn = obj.matrix_world.to_3x3().inverted_safe().transposed()
    shares = {}
    for face in obj.data.polygons:
        up = (turn @ face.normal).normalized().z
        if (up > MASK_SLOPE) if mask == "top" else (abs(up) < MASK_SLOPE):
            for v in face.vertices:
                shares[v] = shares.get(v, 0.0) + face.area
    totals = {}
    for face in obj.data.polygons:
        for v in face.vertices:
            totals[v] = totals.get(v, 0.0) + face.area
    name = f"{obj.name} displace {mask}"
    old = obj.vertex_groups.get(name)
    if old is not None:
        obj.vertex_groups.remove(old)
    group = obj.vertex_groups.new(name=name)
    for v, area in shares.items():
        group.add([v], area / totals[v] if totals[v] > 0 else 1.0, "REPLACE")
    return name, len(shares)


def masked(obj, op):
    """The vertex group a displace is held to, from mask top or sides or a group named, and the words saying so."""
    mask, named = op.get("mask"), op.get("vertex_group")
    need(mask is None or named is None, "A displace takes mask or vertex_group, not both: mask also names a vertex group.")
    if mask in MASKS:
        name, count = facing_group(obj, mask)
        need(count, f"“{obj.name}” has no faces {MASKS[mask]}, so a {mask} mask holds nothing.")
        return name, f", on the faces {MASKS[mask]} ({count:,} points)"
    group = vertex_group(obj, {"vertex_group": mask if mask is not None else named})
    return group, f", within the vertex group {group}" if group else ""


def density_text(obj, size, group):
    """A warning when the edges a displace moves are longer than its pattern is wide, so the pattern falls between its points."""
    bm = evaluated_mesh(obj, world=True)
    try:
        # The shape's steps carry its vertex groups onto the points they make.
        layer = bm.verts.layers.deform.active if group else None
        index = obj.vertex_groups[group].index if group else None

        def moves(v):
            return layer is None or v[layer].get(index, 0.0) > 0

        edges = sorted(e.calc_length() for e in bm.edges if (not group or layer is not None) and all(moves(v) for v in e.verts))
    finally:
        bm.free()
    if not edges:
        return ""
    middle = edges[len(edges) // 2]
    if middle <= size:
        return ""
    return (
        f"; its edges are {length(middle)} long (median), longer than the pattern's {length(size)}, so the pattern"
        f" falls between its points: subdivide it until its edges are under {length(size / 2)}, or give a larger texture_size"
    )


def displace(obj, op):
    before = Measure(obj)
    was = world_points(obj)
    texture, called = texture_for(obj, op)
    modifier = obj.modifiers.new("Displace", "DISPLACE")
    modifier.texture = texture
    if op.get("texture") == "image":
        modifier.texture_coords = "UV"
    strength = number(op.get("strength"), "displace strength", default=0.01)
    reach = scene_scale(obj)
    modifier.strength = strength / (sum(reach) / 3)
    least, most, default = MIDLEVEL
    modifier.mid_level = number(op.get("midlevel"), "midlevel", minimum=least, maximum=most, default=default)
    direction = op.get("direction", DIRECTION)
    need(direction in DIRECTIONS, f"A displace's direction is {one_of(DIRECTIONS)}.")
    modifier.direction = DIRECTIONS[direction]
    space = op.get("space", "local")
    need(space in SPACES, f"A displace's space is {one_of(SPACES)}.")
    modifier.space = SPACES[space]
    group, held_to = masked(obj, op)
    modifier.vertex_group = group
    now = world_points(obj)
    after = Measure(obj)
    moved = [(a - b).length for a, b in zip(now, was)]
    most = max(moved, default=0.0)
    said = f"displaced by {called}, {length(abs(strength))} at full strength along {direction.replace('_', ' ')}{held_to}"
    if most <= 1e-6:
        return said + ": no point moved, as the texture is at its midlevel wherever the points are"
    said += f": its points moved up to {length(most)} (mean {length(sum(moved) / len(moved))})"
    said += f", its size from {size_text(before.size)} to {size_text(after.size)}"
    size = pattern_size(obj, texture)
    if len(now) < FEW_POINTS:
        said += f"; it has only {len(now)} points to move: subdivide it first for detail"
    elif size is not None:
        modifier.show_viewport = False
        try:
            said += density_text(obj, size, group)
        finally:
            modifier.show_viewport = True
    return said


def shrinkwrap(obj, op):
    target = find_object(op.get("target"), {"MESH"})
    need(target != obj, "An object cannot be wrapped onto itself.")
    modifier = obj.modifiers.new(f"Shrinkwrap {target.name}", "SHRINKWRAP")
    modifier.target = target
    wrap = op.get("wrap", WRAP)
    need(wrap in WRAPS, f"A shrinkwrap's wrap is {one_of(WRAPS)}.")
    modifier.wrap_method = WRAPS[wrap]
    mode = op.get("wrap_mode", WRAP_MODE)
    need(mode in WRAP_MODES, f"A shrinkwrap's wrap_mode is {one_of(WRAP_MODES)}.")
    if wrap != "nearest_vertex":
        modifier.wrap_mode = WRAP_MODES[mode]
    standoff = number(op.get("standoff"), "standoff", default=0)
    modifier.offset = standoff / max(scene_scale(obj))
    axes = op.get("project_axes") or []
    need(isinstance(axes, list) and all(a in ("x", "y", "z") for a in axes), "project_axes lists x, y or z.")
    if wrap == "project":
        for axis in ("x", "y", "z"):
            setattr(modifier, f"use_project_{axis}", axis in axes)
        need(op.get("both_ways") is None or isinstance(op.get("both_ways"), bool), "both_ways is true or false.")
        modifier.use_positive_direction = True
        modifier.use_negative_direction = bool(op.get("both_ways"))
    modifier.vertex_group = vertex_group(obj, op)
    points = world_points(obj)
    surface = mesh_of(target)
    try:
        tree = BVHTree.FromBMesh(surface)
    finally:
        surface.free()
    gaps = [abs(tree.find_nearest(p)[3] - abs(standoff)) for p in points]
    # A wrapped point within TOUCH of where it should be is on it.
    on = sum(1 for g in gaps if g <= TOUCH)
    said = f"wrapped onto {target.name} by {wrap.replace('_', ' ')}"
    if wrap == "project":
        said += f" along {', '.join(axes)}" if axes else " along its normals"
    if wrap != "nearest_vertex" and mode != "on_surface":
        said += f", {mode.replace('_', ' ')}"
    if standoff:
        said += f", {length(standoff)} off it"
    said += f": {on:,} of its {len(points):,} points lie {'on it' if not standoff else 'at that distance'}"
    away = [g for g in gaps if g > TOUCH]
    if away:
        said += f"; the other {len(away):,} stay up to {length(max(away))} from it (mean {length(sum(away) / len(away))})"
    if modifier.vertex_group:
        said += f", only the vertex group {modifier.vertex_group} moving"
    return said
