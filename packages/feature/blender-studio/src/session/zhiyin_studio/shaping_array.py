"""
Repeating a shape: an array step a constant step apart, a multiple of its own size, or as an object
is from it, so many times or as many as fill a length or a curve, round an axis or along a curve,
with its copies joined where they meet and capped at its ends. The answer gives how many copies it
made, how far apart and turned they are, and the gap between neighbours or how far each goes into
the next, measured on the copies Blender made.
"""

import math

import bpy
import mathutils
from mathutils.bvhtree import BVHTree

from .arguments import need, number, vector, whole
from .finding import CUTTERS, collection, find_object
from .mesh_math import to_segment
from .placing import attach
from .scales import scene_scale
from .shaping_curve import centreline
from .shaping_measure import Measure, evaluated_mesh
from .wording import length, one_of, point_text

FITS = {"count": "FIXED_COUNT", "length": "FIT_LENGTH", "curve": "FIT_CURVE"}
AXES = {"x": (1, 0, 0), "y": (0, 1, 0), "z": (0, 0, 1)}
DEFORM_AXES = {"x": "POS_X", "y": "POS_Y", "z": "POS_Z"}
# The degrees copies round an axis spread over by default.
AROUND = 360


def copies_of(obj, modifier, base_points):
    """The copies an array makes, each a list of world points, measured with its joining turned off."""
    merging, capped = modifier.use_merge_vertices, (modifier.start_cap, modifier.end_cap)
    modifier.use_merge_vertices = False
    modifier.start_cap = modifier.end_cap = None
    deform = [m for m in obj.modifiers if m.type == "CURVE" and m.name.startswith("Array along")]
    shown = [m.show_viewport for m in deform]
    for m in deform:
        m.show_viewport = False
    try:
        bm = evaluated_mesh(obj, world=True)
        try:
            points = [v.co.copy() for v in bm.verts]
        finally:
            bm.free()
    finally:
        modifier.use_merge_vertices = merging
        modifier.start_cap, modifier.end_cap = capped
        for m, was in zip(deform, shown):
            m.show_viewport = was
        bpy.context.view_layer.update()
    if not base_points:
        return []
    return [points[i : i + base_points] for i in range(0, len(points) - base_points + 1, base_points)]


def centre(points):
    return sum(points, mathutils.Vector()) / len(points)


def turn_between(first, second):
    """How far one copy is turned from the one before, in degrees, from matching points."""
    middle_one, middle_two = centre(first), centre(second)
    for a, b in zip(first, second):
        one, two = a - middle_one, b - middle_two
        if one.length > 1e-9 and two.length > 1e-9:
            return math.degrees(one.angle(two))
    return 0.0


def neighbours_text(first, second, faces):
    """The gap between two neighbouring copies, or how far one goes into the other."""
    one = BVHTree.FromPolygons([p[:] for p in first], faces)
    two = BVHTree.FromPolygons([p[:] for p in second], faces)
    if one.overlap(two):
        return "each going into the next"
    gap = min(one.find_nearest(p)[3] for p in second)
    gap = min(gap, min(two.find_nearest(p)[3] for p in first))
    return f"{length(gap)} between neighbours" if gap > 1e-6 else "each touching the next"


def straight_gap(step, before):
    """The gap between copies a straight step apart, from the shape's reach along the step."""
    way = step.normalized()
    along = [p.dot(way) for p in before.shape.points]
    gap = step.length - (max(along) - min(along)) if along else 0.0
    if gap > 1e-6:
        return f", {length(gap)} between them"
    if gap >= -1e-6:
        return ", each touching the next"
    return f", each going {length(-gap)} into the next"


def turner(obj, around, count):
    """An empty that turns each copy round an axis from the one before, attached to the object."""
    need(isinstance(around, dict), "around is an axis, a centre and an angle.")
    axis = around.get("axis", "z")
    need(axis in AXES, "around's axis is x, y or z.")
    middle = vector(around.get("centre"), "around centre", default=tuple(obj.matrix_world.translation))
    angle = number(around.get("angle"), "around angle", minimum=1e-3, maximum=360, default=AROUND)
    step = angle / count if abs(angle - 360) < 1e-9 else angle / (count - 1)
    turn = (
        mathutils.Matrix.Translation(middle)
        @ mathutils.Matrix.Rotation(math.radians(step), 4, AXES[axis])
        @ mathutils.Matrix.Translation(-middle)
    )
    name = f"{obj.name} array turn"
    index = 1
    while bpy.data.objects.get(name):
        index += 1
        name = f"{obj.name} array turn {index}"
    empty = bpy.data.objects.new(name, None)
    collection(CUTTERS, hide_render=True).objects.link(empty)
    bpy.context.view_layer.update()
    empty.matrix_world = turn @ obj.matrix_world
    attach(empty, obj)
    return empty, axis, middle, step


def around_text(obj, before, copies, axis, middle, step, faces):
    """Copies round an axis: how far apart they turn, how far from the axis, and the gap between neighbours."""
    way = mathutils.Vector(AXES[axis])
    middle_now = centre(before.shape.points)
    off = middle_now - middle
    radius = (off - off.dot(way) * way).length
    said = f"repeated {len(copies)} times round {axis} through {point_text(middle)}, {step:.4g}° apart, {length(radius)} from the axis"
    if len(copies) > 1:
        said += f", {neighbours_text(copies[0], copies[1], faces)}"
    return said


def fit_settings(obj, op, modifier, before):
    """How many copies an array makes: a count, as many as fill a length, or as many as fill a curve."""
    fit = op.get("fit", "count")
    need(fit in FITS, f"An array's fit is {one_of(FITS)}.")
    modifier.fit_type = FITS[fit]
    if fit == "count":
        modifier.count = whole(op.get("count"), "array count", minimum=2, maximum=1000)
        return None
    if fit == "length":
        reach = number(op.get("length"), "array length", minimum=1e-6)
        modifier.fit_length = reach / max(scene_scale(obj))
        return f"to fill {length(reach)}"
    curve = find_object(op.get("curve"), {"CURVE"})
    modifier.curve = curve
    return curve


def spacing(obj, op, modifier):
    """How far each copy is from the one before: a constant step, a multiple of its size, or an object."""
    ways = [k for k in ("offset", "relative", "offset_object", "around") if op.get(k) is not None]
    need(
        ways or op.get("curve") is not None,
        "An array needs how far apart its copies are: offset, relative, offset_object or around.",
    )
    modifier.use_relative_offset = False
    modifier.use_constant_offset = False
    if op.get("offset") is not None:
        # Along its own axes, as far apart as the scene has them.
        offset = vector(op.get("offset"), "array offset")
        need(offset.length > 1e-9, "An array's offset is how far apart its repeats are: [0, 0, 0] puts them all in one place.")
        reach = scene_scale(obj)
        modifier.use_constant_offset = True
        modifier.constant_offset_displace = [offset[i] / reach[i] for i in range(3)]
    if op.get("relative") is not None:
        factors = vector(op.get("relative"), "array relative")
        need(factors.length > 1e-9, "An array's relative step is a multiple of its own size: [0, 0, 0] puts them all in one place.")
        modifier.use_relative_offset = True
        modifier.relative_offset_displace = factors
    if op.get("offset_object") is not None:
        need(op.get("around") is None, "An array turns round an axis or by an offset_object, not both.")
        modifier.use_object_offset = True
        modifier.offset_object = find_object(op.get("offset_object"))
    if op.get("curve") is not None and not ways:
        # Along the curve's own way: a copy's length apart, as the curve bends them.
        modifier.use_relative_offset = True
        modifier.relative_offset_displace = (1, 0, 0)


def caps(op, modifier):
    """Objects at the array's two ends."""
    said = ""
    for key, field, end in (("start_cap", "start_cap", "start"), ("end_cap", "end_cap", "end")):
        if op.get(key) is not None:
            cap = find_object(op.get(key), {"MESH"})
            setattr(modifier, field, cap)
            said += f", capped by {cap.name} at its {end}"
    return said


def joined_text(obj, op, modifier, copies, base_points):
    """How many points joining the copies where they meet took away."""
    if op.get("merge") is None:
        return ""
    distance = number(op.get("merge"), "array merge", minimum=0)
    modifier.use_merge_vertices = True
    modifier.merge_threshold = distance / max(scene_scale(obj))
    made = Measure(obj).points
    joined = len(copies) * base_points - made
    return f", {joined:,} points joined where copies meet within {length(distance)}"


def repeat(obj, op):
    before = Measure(obj)
    bm = evaluated_mesh(obj)
    try:
        base_points = len(bm.verts)
        faces = [[v.index for v in f.verts] for f in bm.faces]
    finally:
        bm.free()
    modifier = obj.modifiers.new("Array", "ARRAY")
    spacing(obj, op, modifier)
    fitted = fit_settings(obj, op, modifier, before)
    around = None
    if op.get("around") is not None:
        empty, axis, middle, step = turner(obj, op["around"], modifier.count)
        modifier.use_object_offset = True
        modifier.offset_object = empty
        around = axis, middle, step
    bpy.context.view_layer.update()
    copies = copies_of(obj, modifier, base_points)
    if around is not None:
        said = around_text(obj, before, copies, *around, faces)
    else:
        first, second = (centre(copies[0]), centre(copies[1])) if len(copies) > 1 else (None, None)
        step = second - first if first is not None else mathutils.Vector()
        turned = turn_between(copies[0], copies[1]) if len(copies) > 1 else 0.0
        said = f"repeated {len(copies)} times, {length(step.length)} apart"
        if turned > 0.01:
            said += f", each turned {turned:.4g}° from the last, {neighbours_text(copies[0], copies[1], faces)}"
        elif len(copies) > 1:
            said += straight_gap(step, before)
        if isinstance(fitted, str):
            said += f", {fitted}"
    if isinstance(fitted, bpy.types.Object):
        said = along_curve(obj, op, modifier, fitted, said, copies)
    said += joined_text(obj, op, modifier, copies, base_points)
    said += caps(op, modifier)
    return said


def along_curve(obj, op, modifier, curve, said, copies):
    """Copies as many as fill a curve, bent along it."""
    bend = obj.modifiers.new(f"Array along {curve.name}", "CURVE")
    bend.object = curve
    axis = op.get("curve_axis", "x")
    need(axis in DEFORM_AXES, "curve_axis is x, y or z.")
    bend.deform_axis = DEFORM_AXES[axis]
    reach = sum(s.calc_length() for s in curve.data.splines) * max(scene_scale(curve))
    said = f"repeated {len(copies)} times along {curve.name}'s {length(reach)}, each following its bends"
    off = off_curve(obj, modifier, curve, len(copies[0]) if copies else 0)
    if off is not None and off > 1e-4:
        said += (
            f", though their middles lie up to {length(off)} off it: a shape follows a curve as it lies from the"
            f" curve's own origin, so put {obj.name}'s origin at {curve.name}'s to lay them on it"
        )
    return said


def off_curve(obj, modifier, curve, base_points):
    """How far the bent copies' middles lie from the curve's path, at most, in the world."""
    if not base_points:
        return None
    merging = modifier.use_merge_vertices
    modifier.use_merge_vertices = False
    try:
        bm = evaluated_mesh(obj, world=True)
        try:
            points = [v.co.copy() for v in bm.verts]
        finally:
            bm.free()
    finally:
        modifier.use_merge_vertices = merging
        bpy.context.view_layer.update()
    path = [p for p, _ in centreline(curve)]
    if len(path) < 2:
        return None
    middles = [centre(points[i : i + base_points]) for i in range(0, len(points) - base_points + 1, base_points)]
    return max(from_path(m, path) for m in middles)


def from_path(point, path):
    """How far a point lies from a path of straight runs."""
    return min(to_segment(point, a, b) for a, b in zip(path, path[1:]))
