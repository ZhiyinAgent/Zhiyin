"""
A curve's geometry: the cross-section it sweeps (round of a depth, another curve's shape, or a
profile preset), how far it is extruded and offset, a taper along it, how its ends and faces are
filled and how it twists. The answer measures the surface the curve makes: its faces, its length
along the path, how wide it is across at its narrowest and widest, and whether its ends are closed.
"""

import bpy
import mathutils

from .arguments import need, number, whole
from .finding import find_object
from .scales import scene_scale
from .wording import length, one_of

BEVEL_MODES = {"round": "ROUND", "object": "OBJECT", "profile": "PROFILE"}
PRESETS = {"line": "LINE", "supports": "SUPPORTS", "cornice": "CORNICE", "crown": "CROWN", "steps": "STEPS"}
TAPER_MODES = {"override": "OVERRIDE", "multiply": "MULTIPLY", "add": "ADD"}
FILLS_3D = {"full": "FULL", "back": "BACK", "front": "FRONT", "half": "HALF"}
FILLS_2D = {"both": "BOTH", "back": "BACK", "front": "FRONT", "none": "NONE"}
TWISTS = {"minimum": "MINIMUM", "z_up": "Z_UP", "tangent": "TANGENT"}
PLACES = 64


def evaluated_points(obj):
    """An object's evaluated mesh as world points and faces, and whether every edge joins two faces."""
    bpy.context.view_layer.update()
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    try:
        points = [obj.matrix_world @ v.co for v in mesh.vertices]
        faces = len(mesh.polygons)
        # A curve's mesh keeps its caps' and seams' points apart from the sides': joined by place.
        place = [tuple(round(c, 7) for c in v.co) for v in mesh.vertices]
        uses = {}
        for polygon in mesh.polygons:
            for a, b in polygon.edge_keys:
                key = tuple(sorted((place[a], place[b])))
                uses[key] = uses.get(key, 0) + 1
        closed = bool(uses) and all(n == 2 for n in uses.values())
    finally:
        evaluated.to_mesh_clear()
    return points, faces, closed


def centreline(obj):
    """The curve's path as it is evaluated, in the world: a point and the way it runs at each."""
    copy = obj.data.copy()
    copy.bevel_mode = "ROUND"
    copy.bevel_depth = 0
    copy.bevel_object = None
    copy.taper_object = None
    copy.extrude = 0
    copy.offset = 0
    holder = bpy.data.objects.new(f"{obj.name} path", copy)
    bpy.context.scene.collection.objects.link(holder)
    holder.matrix_world = obj.matrix_world.copy()
    try:
        points, _, _ = evaluated_points(holder)
    finally:
        bpy.data.objects.remove(holder)
        bpy.data.curves.remove(copy)
    path = []
    for i, point in enumerate(points):
        ahead = points[min(i + 1, len(points) - 1)] - points[max(i - 1, 0)]
        if ahead.length > 1e-12:
            path.append((point, ahead.normalized()))
    return path


def across(points, path, reach):
    """How wide the surface is across at each place along its path, measured on the points lying in the plane square to it there."""
    tolerance = max(1e-7, 1e-5 * reach)
    widths = []
    # At most this many places along it, evenly, so a long fine curve is measured quickly.
    step = max(1, len(path) // PLACES)
    for middle, way in path[::step] + path[-1:]:
        ring = [p for p in points if abs((p - middle).dot(way)) <= tolerance and (p - middle).length <= reach]
        if len(ring) >= 2:
            widths.append(max((a - b).length for i, a in enumerate(ring) for b in ring[i + 1 :]))
    return widths


def path_length(obj):
    return sum(s.calc_length() for s in obj.data.splines) * max(scene_scale(obj))


def surface_text(obj):
    """The surface a curve makes, measured: faces, length along its path, width across, and its ends."""
    points, faces, closed = evaluated_points(obj)
    if not faces:
        return "it makes no surface: give it a depth, an extrude, a section or a fill"
    low = mathutils.Vector([min(p[i] for p in points) for i in range(3)])
    high = mathutils.Vector([max(p[i] for p in points) for i in range(3)])
    widths = across(points, centreline(obj), (high - low).length)
    said = f"now a surface of {faces:,} faces, {length(path_length(obj))} along its path"
    if widths:
        narrow, wide = min(widths), max(widths)
        said += (
            f", {length(wide)} across"
            if wide - narrow <= 1e-6
            else f", {length(narrow)} to {length(wide)} across, {length(widths[0])} at its start and {length(widths[-1])} at its end"
        )
    cyclic = all(s.use_cyclic_u for s in obj.data.splines)
    if cyclic:
        said += ", a closed loop" + (" and a closed solid" if closed else "")
    else:
        said += ", closed at its ends" if closed else ", open at its ends"
    return said


def choose(op, key, choices, what):
    value = op.get(key)
    need(value in choices, f"A curve's {what} is {one_of(choices)}.")
    return choices[value]


def curve_geometry(obj, op):
    curve = obj.data
    reach = max(scene_scale(obj))
    said = []
    if op.get("bevel_mode") is not None:
        curve.bevel_mode = choose(op, "bevel_mode", BEVEL_MODES, "bevel_mode")
    if op.get("depth") is not None:
        depth = number(op.get("depth"), "curve depth", minimum=0)
        curve.bevel_depth = depth / reach
        said.append(f"swept {length(depth)} deep about its path")
    if op.get("resolution") is not None:
        curve.bevel_resolution = whole(op.get("resolution"), "resolution", minimum=0, maximum=32)
        said.append(f"{curve.bevel_resolution} steps round each quarter of its section")
    if op.get("curve_resolution") is not None:
        curve.resolution_u = whole(op.get("curve_resolution"), "curve_resolution", minimum=1, maximum=64)
        said.append(f"{curve.resolution_u} steps between its points")
    if op.get("bevel_object") is not None:
        section = find_object(op.get("bevel_object"), {"CURVE"})
        need(section != obj, "A curve cannot sweep its own shape.")
        curve.bevel_mode = "OBJECT"
        curve.bevel_object = section
        said.append(f"its section the shape of {section.name}")
    if op.get("profile_preset") is not None:
        curve.bevel_mode = "PROFILE"
        curve.bevel_profile.preset = choose(op, "profile_preset", PRESETS, "profile_preset")
        said.append(f"its section a {op['profile_preset']} profile")
    if op.get("extrude") is not None:
        extrude = number(op.get("extrude"), "extrude", minimum=0)
        curve.extrude = extrude / reach
        said.append(f"extruded {length(extrude)} each way")
    if op.get("curve_offset") is not None:
        offset = number(op.get("curve_offset"), "curve_offset")
        curve.offset = offset / reach
        said.append(f"offset {length(offset)} from its path")
    if op.get("taper_object") is not None:
        taper = find_object(op.get("taper_object"), {"CURVE"})
        need(taper != obj, "A curve cannot taper by itself.")
        curve.taper_object = taper
        said.append(f"tapered by {taper.name}")
    if op.get("taper_mode") is not None:
        curve.taper_radius_mode = choose(op, "taper_mode", TAPER_MODES, "taper_mode")
        said.append(f"its taper {op['taper_mode']} its points' own radius")
    if op.get("fill") is not None:
        fills = FILLS_3D if curve.dimensions == "3D" else FILLS_2D
        curve.fill_mode = choose(op, "fill", fills, f"fill, for a {curve.dimensions} curve,")
        said.append(f"filled {op['fill']}")
    if op.get("caps") is not None:
        need(isinstance(op.get("caps"), bool), "caps is true or false.")
        curve.use_fill_caps = op["caps"]
    if op.get("twist") is not None:
        curve.twist_mode = choose(op, "twist", TWISTS, "twist")
        said.append(f"twisting by {op['twist'].replace('_', ' ')}")
    if op.get("twist_smooth") is not None:
        curve.twist_smooth = number(op.get("twist_smooth"), "twist_smooth", minimum=0)
    need(said or op.get("caps") is not None or op.get("bevel_mode") is not None, "A curve step sets at least one of the curve's settings.")
    head = ", ".join(said) or f"bevelled {op.get('bevel_mode', curve.bevel_mode.lower())}"
    return f"{head}: {surface_text(obj)}"
