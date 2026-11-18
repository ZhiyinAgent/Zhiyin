"""
blender_unwrap: objects' surfaces laid flat for textures. Seams are marked by angle and by the
boundaries between materials or a CAD part's groups of surfaces, each closed part is cut until it
lies flat, along where the camera sees least, and the surface is unwrapped by the method asked,
then packed in the tile with margins in texels, or scaled to a texel density. Says for each object
what its layout came to, measured on the shape with its steps.
"""

import math

import bmesh
import bpy
from bpy_extras.object_utils import world_to_camera_view

from .arguments import need, number, whole
from .finding import find_objects, scene
from .unwrap_measures import Laid, density
from .unwrap_report import layout_lines
from .unwrap_seams import camera_sight, cut_flat, mark_seams, seams_bmesh
from .wording import length as length_text

# Each method, the operator's own name for it where it has one.
SEAMED = {"angle": "ANGLE_BASED", "conformal": "CONFORMAL", "minimum_stretch": "MINIMUM_STRETCH", "follow_quads": "ANGLE_BASED"}
PROJECTED = ("smart", "cube", "cylinder", "sphere", "lightmap", "camera")
METHODS = (*SEAMED, *PROJECTED)
# What each method is called in the answer.
METHOD_WORDS = {
    "angle": "angle-based unwrapping",
    "conformal": "conformal unwrapping",
    "minimum_stretch": "minimum-stretch unwrapping",
    "follow_quads": "following its quads",
    "smart": "smart projection",
    "cube": "cube projection",
    "cylinder": "cylinder projection",
    "sphere": "sphere projection",
    "lightmap": "lightmap packing",
    "camera": "projection from the camera",
}
# The angle sharp edges are seamed at when a mesh has no seams, and smart projection's own.
SHARP = 60
SMART = 66
RESOLUTION = 1024
MARGIN_PX = 4


def _editing(obj, work):
    """Runs `work` with `obj` alone in edit mode, every face selected, shown while it runs."""
    hidden = obj.hide_get(), obj.hide_viewport
    obj.hide_set(False)
    obj.hide_viewport = False
    # Faces hidden while editing would be left out of the layout; every face is laid out.
    for element in (*obj.data.vertices, *obj.data.edges, *obj.data.polygons):
        element.hide = False
        element.select = True
    view_layer = bpy.context.view_layer
    active = view_layer.objects.active
    selected = [o for o in view_layer.objects if o.select_get()]
    for other in selected:
        other.select_set(False)
    obj.select_set(True)
    view_layer.objects.active = obj
    try:
        with bpy.context.temp_override(active_object=obj, object=obj, selected_objects=[obj], selected_editable_objects=[obj]):
            bpy.ops.object.mode_set(mode="EDIT")
            try:
                return work()
            finally:
                bpy.ops.object.mode_set(mode="OBJECT")
    finally:
        obj.select_set(False)
        for other in selected:
            other.select_set(True)
        view_layer.objects.active = active
        obj.hide_viewport = hidden[1]
        obj.hide_set(hidden[0])


def _follow_quads(obj, margin):
    """Unwraps by angle, then lays every quad out from the largest one, as a grid."""
    quads = [p for p in obj.data.polygons if p.loop_total == 4]
    need(quads, f"“{obj.name}” has no faces of four sides, which following quads lays out: use angle.")
    largest = max(quads, key=lambda p: p.area).index

    def work():
        bpy.ops.uv.unwrap(method="ANGLE_BASED", margin=margin, margin_method="FRACTION")
        bm = bmesh.from_edit_mesh(obj.data)
        bm.faces.ensure_lookup_table()
        for face in bm.faces:
            face.select = face.index == largest or len(face.verts) == 4
        bm.faces.active = bm.faces[largest]
        bmesh.update_edit_mesh(obj.data)
        bpy.ops.uv.follow_active_quads(mode="LENGTH_AVERAGE")

    _editing(obj, work)
    return len(obj.data.polygons) - len(quads)


def _from_camera(obj):
    """Lays each corner where the camera's picture shows it, across and up its frame."""
    camera = scene().camera
    need(camera is not None, "camera lays the surface out as the scene's camera sees it, and the scene has no camera.")
    layer = obj.data.uv_layers.active
    matrix = obj.matrix_world
    for loop in obj.data.loops:
        x, y, _ = world_to_camera_view(scene(), camera, matrix @ obj.data.vertices[loop.vertex_index].co)
        layer.uv[loop.index].vector = (x, y)
    return camera.name


def lay_out(obj, method, angle, margin):
    """Lays the surface out by a projection that needs no seams."""
    size = max(obj.dimensions) or 1.0

    def work():
        if method == "smart":
            bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=margin, margin_method="FRACTION")
        elif method == "cube":
            bpy.ops.uv.cube_project(cube_size=size / max(obj.scale) if max(obj.scale) else size, scale_to_bounds=False)
        elif method == "cylinder":
            bpy.ops.uv.cylinder_project(direction="ALIGN_TO_OBJECT", scale_to_bounds=False)
        elif method == "sphere":
            bpy.ops.uv.sphere_project(direction="ALIGN_TO_OBJECT", scale_to_bounds=False)
        elif method == "lightmap":
            bpy.ops.uv.lightmap_pack(PREF_CONTEXT="ALL_FACES")

    _editing(obj, work)


def _pack(obj, margin, rotate, fill):
    """Packs the islands in the tile at their shared scale, filling it when `fill`."""

    def work():
        bpy.ops.uv.average_islands_scale()
        bpy.ops.uv.pack_islands(rotate=rotate, scale=fill, margin=margin, margin_method="FRACTION", shape_method="CONCAVE")

    _editing(obj, work)


def _scale_layout(obj, factor):
    layer = obj.data.uv_layers.active
    for item in layer.uv:
        item.vector = item.vector * factor


def _settings(args):
    """The call's settings, checked: method, seams, packing, resolution and density."""
    method = args.get("method") or "angle"
    need(method in METHODS, f"method is one of {', '.join(METHODS)}.")
    seams = args.get("seams")
    need(seams is None or isinstance(seams, dict), "seams is an object: angle, by and hide.")
    seams = dict(seams or {})
    if seams.get("angle") is not None:
        seams["angle"] = number(seams["angle"], "seams.angle", minimum=0, maximum=180)
    need(seams.get("by") in (None, "material", "surface_group"), "seams.by is material or surface_group.")
    need(seams.get("hide") in (None, True, False), "seams.hide is true or false.")
    if method not in SEAMED:
        asked = [k for k in ("by", "hide") if seams.get(k) is not None] + (["angle"] if method != "smart" and seams.get("angle") is not None else [])
        need(
            not asked,
            f"{METHOD_WORDS[method]} lays the surface out without seams, so seams.{asked[0] if asked else ''} does nothing: leave it out"
            + (", or use seams.angle for smart projection's angle." if method == "smart" else "."),
        )
    pack = args.get("pack")
    need(pack is None or isinstance(pack, dict), "pack is an object: margin_px and rotate.")
    pack = pack or {}
    margin_px = number(pack.get("margin_px"), "pack.margin_px", minimum=0, maximum=256, default=MARGIN_PX)
    rotate = pack.get("rotate", True)
    need(rotate in (True, False), "pack.rotate is true or false.")
    texel = args.get("texel_density")
    need(texel is None or isinstance(texel, dict), "texel_density is an object: px_per_cm and resolution.")
    texel = texel or {}
    resolution = whole(texel.get("resolution"), "texel_density.resolution", minimum=16, maximum=16384, default=RESOLUTION)
    per_cm = texel.get("px_per_cm")
    if per_cm is not None:
        per_cm = number(per_cm, "texel_density.px_per_cm", minimum=0.01, maximum=10000)
    need(method != "camera" or per_cm is None, "camera lays the surface out as the camera's frame: leave texel_density.px_per_cm out.")
    return method, seams, margin_px, rotate, resolution, per_cm


def _seamed(obj, seams, sight, hide):
    """Marks the seams asked, or keeps the mesh's own, then cuts each closed part open. The words for it."""
    bm = seams_bmesh(obj)
    try:
        said = []
        if seams.get("angle") is not None or seams.get("by"):
            said.append("seams on " + " and ".join(mark_seams(bm, obj, seams)))
        elif not any(e.seam for e in bm.edges):
            said.append(f"seams on edges sharper than {SHARP}°, as it had none")
            mark_seams(bm, obj, {"angle": SHARP})
        else:
            said.append(f"its own {sum(1 for e in bm.edges if e.seam)} seam edges")
        cuts, length, unsolved = cut_flat(bm, obj, sight if hide else None)
        if cuts:
            where = f", where {sight.camera.name} sees least" if hide and sight else ""
            said.append(f"{cuts} cut{'s' if cuts != 1 else ''} {length_text(length)} long to lay its closed parts flat{where}")
        if unsolved:
            said.append(
                f"{unsolved} part{'s' if unsolved != 1 else ''} with a hole through, as a ring, still not flat: give each a seam round its tube"
            )
        bm.to_mesh(obj.data)
    finally:
        bm.free()
    return said


def unwrap(args, scene_file):
    names = args.get("objects")
    need(isinstance(names, list) and names, "objects names the objects to unwrap.")
    objects = find_objects(names, {"MESH"})
    method, seams, margin_px, rotate, resolution, per_cm = _settings(args)
    margin = margin_px / resolution
    hide = seams.get("hide")
    sight = camera_sight(hide)
    if hide is None:
        hide = sight is not None
    done = set()
    lines = []
    for obj in objects:
        need(obj.data.polygons, f"“{obj.name}” has no faces to unwrap.")
        if obj.data.uv_layers.active is None:
            obj.data.uv_layers.new(name="UVMap")
        said = []
        if obj.data not in done:
            done.add(obj.data)
            if method in SEAMED:
                said += _seamed(obj, seams, sight, hide)
                if method == "follow_quads":
                    left = _follow_quads(obj, margin)
                    if left:
                        said.append(f"{left} faces not of four sides kept from angle-based unwrapping")
                else:
                    _editing(obj, lambda: bpy.ops.uv.unwrap(method=SEAMED[method], margin=margin, margin_method="FRACTION"))
            elif method == "camera":
                said.append(f"as {_from_camera(obj)} sees it")
            else:
                lay_out(obj, method, seams.get("angle", SMART), margin)
            if method != "camera":
                _pack(obj, margin, rotate, per_cm is None)
                if per_cm is not None:
                    found = density(Laid(obj), resolution)
                    if found and found[1] > 0:
                        _scale_layout(obj, per_cm / found[1])
                        _editing(obj, lambda: bpy.ops.uv.pack_islands(rotate=rotate, scale=False, margin=margin, margin_method="FRACTION", shape_method="CONCAVE"))
                said.append(
                    f"packed with {margin_px:g} px margins"
                    + (f" at {per_cm:g} px/cm" if per_cm is not None else "")
                    + f" for {resolution} px"
                )
        else:
            said.append("its mesh, shared, unwrapped with the object before")
        lines.append(f"{obj.name}: {METHOD_WORDS[method]} on {obj.data.uv_layers.active.name}, " + ", ".join(said) + ".")
        lines += layout_lines(obj, resolution, sight)
    return "\n".join(lines)
