"""
Rounding edges: a bevel step, its width read as an offset, a width, a depth, an absolute or a
share of the edge, limited to edges sharper than an angle, by weight, an attribute or a vertex
group, or none, with its profile, miters, clamping and normals. The answer names how many edges
it rounds, measured on the shape as its steps leave it, and refuses a bevel that rounds none.
"""

import math

import bpy

from .arguments import need, number, whole
from .making import bevel_width
from .shaping_measure import Measure, evaluated_mesh, flat_shading, shading_text, sharp_edges
from .wording import length, one_of

WIDTH_TYPES = {"offset": "OFFSET", "width": "WIDTH", "depth": "DEPTH", "percent": "PERCENT", "absolute": "ABSOLUTE"}
LIMITS = ("angle", "none", "weight", "attribute", "vertex_group")
OUTER_MITERS = {"sharp": "MITER_SHARP", "patch": "MITER_PATCH", "arc": "MITER_ARC"}
INNER_MITERS = {"sharp": "MITER_SHARP", "arc": "MITER_ARC"}
FACE_STRENGTHS = {"none": "FSTR_NONE", "new": "FSTR_NEW", "affected": "FSTR_AFFECTED", "all": "FSTR_ALL"}
# The edge weight Blender bevels by when no attribute is named.
BEVEL_WEIGHT = "bevel_weight_edge"
# A bevel's profile, least and most; its segments and the angle past which an edge is rounded, by default.
PROFILE = (0, 1)
SEGMENTS = 3
ANGLE = 30
# Which edges a bevel rounds, and how its width is read, unless the call says.
LIMIT, WIDTH_TYPE = "angle", "offset"


def plural(count, word):
    return f"{count:,} {word}" if count == 1 else f"{count:,} {word}s"


def weighted_edges(obj, name):
    """How many of the mesh's own edges carry a weight above 0 in an edge attribute, refusing one it lacks."""
    attribute = obj.data.attributes.get(name)
    if attribute is None or attribute.domain != "EDGE" or attribute.data_type != "FLOAT":
        held = [a.name for a in obj.data.attributes if a.domain == "EDGE" and a.data_type == "FLOAT" and not a.name.startswith(".")]
        need(
            False,
            f"“{obj.name}” has no edge weight named “{name}” to bevel by; its edge weights: {', '.join(held) or 'none'}."
            " Give its edges a weight first, as a script can with zhiyin.pick and an attribute.",
        )
    return sum(1 for item in attribute.data if item.value > 0)


def grouped_edges(obj, name):
    """How many of the mesh's own edges have both points in a vertex group, refusing a group it lacks."""
    group = obj.vertex_groups.get(name) if isinstance(name, str) else None
    need(
        group is not None,
        f"“{obj.name}” has no vertex group named “{name}”; it has: {', '.join(g.name for g in obj.vertex_groups) or 'none'}.",
    )
    held = {v.index for v in obj.data.vertices if any(g.group == group.index and g.weight > 0 for g in v.groups)}
    return sum(1 for e in obj.data.edges if e.vertices[0] in held and e.vertices[1] in held)


def rounded_count(obj, op):
    """
    How many edges a bevel rounds by its limit, measured before it is added, refusing one that
    rounds none; how they are chosen, and the bevel's settings that choose them.
    """
    limit = op.get("limit", LIMIT)
    need(limit in LIMITS, f"A bevel's limit is {one_of(LIMITS)}.")
    if limit == "angle":
        angle = number(op.get("angle"), "bevel angle", minimum=0, maximum=180, default=ANGLE)
        # Measured on the shape as its steps so far leave it: a bevel rounds the edges sharper than its angle.
        count, sharpest = sharp_edges(obj, math.radians(angle))
        need(
            count,
            f"The bevel rounds nothing on “{obj.name}”: none of its edges is sharper than {angle:g}°, the bevel's angle;"
            f" its sharpest is {sharpest:.3g}°. Give an angle below that.",
        )
        return count, "", {"limit_method": "ANGLE", "angle_limit": math.radians(angle)}
    if limit == "none":
        bm = evaluated_mesh(obj)
        try:
            count = sum(1 for e in bm.edges if e.is_manifold and e.calc_face_angle(0.0) > 1e-6)
        finally:
            bm.free()
        return count, ", every edge where faces meet at an angle", {"limit_method": "NONE"}
    if limit == "vertex_group":
        name = op.get("vertex_group")
        count = grouped_edges(obj, name)
        need(count, f"The bevel rounds nothing on “{obj.name}”: no edge has both its points in the vertex group “{name}”.")
        return count, f", those in the vertex group {name}", {"limit_method": "VGROUP", "vertex_group": name}
    name = BEVEL_WEIGHT if limit == "weight" else op.get("attribute")
    need(isinstance(name, str) and name, "A bevel limited by attribute names the edge attribute in attribute.")
    count = weighted_edges(obj, name)
    need(count, f"The bevel rounds nothing on “{obj.name}”: none of its edges has a weight above 0 in “{name}”.")
    return count, f", those weighted in {name}", {"limit_method": "WEIGHT", "edge_weight": name}


def set_width(obj, op, modifier):
    """A bevel's width, as its width type reads it; the words saying it."""
    kind = op.get("width_type", WIDTH_TYPE)
    need(kind in WIDTH_TYPES, f"A bevel's width_type is {one_of(WIDTH_TYPES)}.")
    modifier.offset_type = WIDTH_TYPES[kind]
    if kind == "percent":
        share = number(op.get("width"), "bevel width", minimum=1e-6, maximum=100)
        modifier.width_pct = share
        return f"by {share:g}% of each edge's neighbours"
    # Given and said as the scene has it.
    modifier.width = bevel_width(obj, op.get("width"))
    said = {"offset": "", "width": " across", "depth": " deep", "absolute": " along each edge"}[kind]
    return f"by {length(float(op['width']))}{said}"


def round_edges(obj, op):
    shading = flat_shading(obj) if op.get("harden_normals") else None
    count, chosen, limited = rounded_count(obj, op)
    modifier = obj.modifiers.new("Bevel", "BEVEL")
    for field, value in limited.items():
        setattr(modifier, field, value)
    by = set_width(obj, op, modifier)
    modifier.segments = whole(op.get("segments"), "bevel segments", maximum=32, default=SEGMENTS)
    said = f"{plural(count, 'edge')} rounded {by}{chosen}"
    if op.get("profile") is not None:
        modifier.profile = number(op.get("profile"), "bevel profile", minimum=PROFILE[0], maximum=PROFILE[1])
        shape = "round" if abs(modifier.profile - 0.5) < 1e-6 else "squarer" if modifier.profile > 0.5 else "hollowed in"
        said += f", profile {modifier.profile:g} ({shape})"
    for key, choices, field in (("miter_outer", OUTER_MITERS, "miter_outer"), ("miter_inner", INNER_MITERS, "miter_inner")):
        if op.get(key) is not None:
            need(op[key] in choices, f"A bevel's {key} is {one_of(choices)}.")
            setattr(modifier, field, choices[op[key]])
            said += f", {op[key]} {'outer' if key == 'miter_outer' else 'inner'} miters"
    if op.get("face_strength") is not None:
        need(op["face_strength"] in FACE_STRENGTHS, f"A bevel's face_strength is {one_of(FACE_STRENGTHS)}.")
        modifier.face_strength_mode = FACE_STRENGTHS[op["face_strength"]]
        said += f", face strength set on {op['face_strength']} faces for weighted normals"
    clamp = op.get("clamp", True)
    need(isinstance(clamp, bool), "clamp is true or false.")
    modifier.use_clamp_overlap = clamp
    said += clamp_text(obj, modifier, clamp)
    if op.get("harden_normals"):
        modifier.harden_normals = True
        said += f", normals hardened: {shading_text(shading, flat_shading(obj))}"
    return said


def clamp_text(obj, modifier, clamp):
    """Whether clamping held the bevel back where it would cross itself, measured against the bevel unclamped."""
    if not clamp:
        return ", unclamped, so where bevels meet it may cross itself"
    held = Measure(obj)
    modifier.use_clamp_overlap = False
    loose = Measure(obj)
    modifier.use_clamp_overlap = True
    bpy.context.view_layer.update()
    if held.alike(loose):
        return ""
    return ", held back where it would overlap itself"
