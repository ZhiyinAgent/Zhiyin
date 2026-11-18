"""
Outlines for a stylised picture, by one of three methods: Freestyle, which draws lines after the
render; Line Art, which draws them as a Grease Pencil object kept in the scene; or an inverted
hull round each mesh. The answer names the method and what it drew.

Measured in Blender 5.2: Freestyle and Line Art lines show in Cycles and in EEVEE renders with no
window; a scene made without a startup file has a Freestyle line set with no line style, which
draws nothing until it is given one.
"""

import math

import bpy

from .arguments import colour, need, number
from .finding import LIGHTING, collection, find_objects, scene, subjects
from .geometry import middle_of
from .lighting_links import NAMED
from .stylised import hull, hull_text, pixel_size, remove_hull
from .wording import hex_of, length, listed

METHODS = ("freestyle", "line_art", "hull", "none")
OUTLINED = "Zhiyin outlined"
LINE_ART = "Line art"
# The crease each method draws by default, as Blender gives it, in degrees between faces.
CREASES = {"freestyle": 134, "line_art": 140}
# An outline's width in pixels of the picture by default.
THICKNESS = 2
# The outlines' colour unless the call says.
COLOUR = "#000000"
SHAPES = ("MESH", "CURVE", "FONT", "SURFACE", "META")


def outlined_group(objects):
    """The collection a method draws from: the objects named with their parts, or none for everything."""
    group = bpy.data.collections.get(OUTLINED)
    if not objects:
        if group is not None:
            bpy.data.collections.remove(group)
        return None
    if group is None:
        group = bpy.data.collections.new(OUTLINED)
    for obj in list(group.objects):
        group.objects.unlink(obj)
    for obj in objects:
        for part in (obj, *obj.children_recursive):
            if part.name not in group.objects:
                group.objects.link(part)
    return group


def remove_line_art():
    """Takes away the Grease Pencil object Line Art drew with; whether there was one."""
    found = [o for o in scene().objects if o.get("zhiyin_line_art")]
    for obj in found:
        data = obj.data
        bpy.data.objects.remove(obj)
        if data is not None and data.users == 0:
            bpy.data.grease_pencils.remove(data)
    return bool(found)


def remove_all():
    """Takes away every outline a method made; what went, as words."""
    s = scene()
    gone = []
    if s.render.use_freestyle:
        s.render.use_freestyle = False
        gone.append("Freestyle's lines")
    if remove_line_art():
        gone.append("the Line Art object")
    hulls = [o.name for o in s.objects if o.type == "MESH" and remove_hull(o)]
    if hulls:
        gone.append(f"the hulls round {listed(hulls, NAMED)}")
    outlined_group([])
    return gone


def freestyle(thickness, rgba, crease, group):
    s = scene()
    s.render.use_freestyle = True
    s.render.line_thickness_mode = "ABSOLUTE"
    s.render.line_thickness = thickness
    layer = bpy.context.view_layer
    layer.use_freestyle = True
    settings = layer.freestyle_settings
    settings.crease_angle = math.radians(crease)
    lineset = settings.linesets.get(OUTLINED) or settings.linesets.new(OUTLINED)
    for other in settings.linesets:
        other.show_render = other == lineset
    if lineset.linestyle is None:
        lineset.linestyle = bpy.data.linestyles.new(OUTLINED)
    lineset.linestyle.color = rgba[:3]
    lineset.linestyle.thickness = thickness
    lineset.select_by_visibility = True
    lineset.select_by_edge_types = True
    lineset.select_silhouette = lineset.select_border = lineset.select_crease = True
    # What lights the scene, cards and fog among it, is never outlined.
    lineset.select_by_collection = True
    lineset.collection = group or collection(LIGHTING)
    lineset.collection_negation = "INCLUSIVE" if group else "EXCLUSIVE"
    return (
        f"Outlines by Freestyle: {thickness:g} px {hex_of(rgba)} lines along silhouettes, borders and creases sharper than {crease:g}°"
        f" between faces, of {listed([o.name for o in group.objects], NAMED) if group else 'every object shown'}; Cycles and EEVEE draw them"
        " after the picture, which adds to its time"
    )


def line_art(thickness, rgba, crease, group):
    s = scene()
    remove_line_art()
    shown = list(group.objects) if group else [o for o in subjects() if o.type in SHAPES]
    need(shown, "There is nothing for Line Art to draw.")
    nearest = min(shown, key=lambda o: (middle_of(o) - s.camera.matrix_world.translation).length if s.camera else 0)
    metres_per_pixel, distance = pixel_size(nearest)
    data = bpy.data.grease_pencils.new(LINE_ART)
    obj = bpy.data.objects.new(LINE_ART, data)
    obj["zhiyin_line_art"] = True
    collection(LIGHTING).objects.link(obj)
    ink = bpy.data.materials.new(f"{LINE_ART} ink")
    bpy.data.materials.create_gpencil_data(ink)
    ink.grease_pencil.color = rgba
    data.materials.append(ink)
    layer = data.layers.new("Lines")
    layer.frames.new(s.frame_current)
    step = obj.modifiers.new("Line Art", "LINEART")
    if group is not None:
        step.source_type = "COLLECTION"
        step.source_collection = group
    else:
        step.source_type = "SCENE"
        # What lights the scene, cards and fog among it, is never outlined.
        collection(LIGHTING).lineart_usage = "EXCLUDE"
    step.target_layer = layer.name
    step.target_material = ink
    # Its strokes are as wide as the radius it is given, their points' own radius half of it.
    step.radius = thickness * metres_per_pixel
    step.crease_threshold = math.radians(crease)
    bpy.context.view_layer.update()
    drawn = obj.evaluated_get(bpy.context.evaluated_depsgraph_get()).data
    strokes = sum(len(f.drawing.strokes) for lay in drawn.layers for f in lay.frames if f.drawing is not None)
    return (
        f"Outlines by Line Art: the Grease Pencil object {obj.name}, its lines {thickness:g} px {hex_of(rgba)}"
        f" ({length(step.radius)} wide at {length(distance)}, {nearest.name}'s distance from the camera), along the outlines"
        f" and creases sharper than {crease:g}° of {listed([o.name for o in group.objects], NAMED) if group else 'everything shown'}:"
        f" {strokes} {'stroke' if strokes == 1 else 'strokes'} now, drawn over the picture in Cycles and EEVEE"
    )


def hulls(thickness, rgba, group):
    meshes = [o for o in (group.objects if group else subjects()) if o.type == "MESH"]
    need(meshes, "An inverted hull outlines meshes, and there are none to outline.")
    done = []
    for obj in meshes:
        width, distance = hull(obj, thickness, rgba)
        done.append((obj.name, width, distance))
    return (
        f"Outlines by an inverted hull, {thickness:g} px of the picture, {hex_of(rgba)}: {hull_text(done)}; drawn past each shape's edge"
        " in Cycles and EEVEE, its light left as it was"
    )


def set_outlines(spec):
    """Outlines as the camera call gives them, replacing any a method made before; the line that says them."""
    need(isinstance(spec, dict) and spec.get("method") in METHODS, f"outlines method is one of {', '.join(METHODS)}.")
    method = spec["method"]
    gone = remove_all()
    if method == "none":
        return f"Outlines removed: {listed(gone, NAMED)}" if gone else "No outlines to remove"
    thickness = number(spec.get("thickness"), "outlines thickness", minimum=0.1, maximum=100, default=THICKNESS)
    rgba = colour(spec.get("color"), "outlines color", default=COLOUR)
    need(method != "hull" or spec.get("crease") is None, "crease is Freestyle's and Line Art's: a hull outlines the whole shape.")
    crease = number(spec.get("crease"), "outlines crease", minimum=0, maximum=180, default=CREASES.get(method, 0))
    objects = find_objects(spec.get("objects") or [])
    group = outlined_group(objects)
    if method == "freestyle":
        said = freestyle(thickness, rgba, crease, group)
    elif method == "line_art":
        said = line_art(thickness, rgba, crease, group)
    else:
        said = hulls(thickness, rgba, group)
    others = [g for g in gone if not g.startswith({"freestyle": "Freestyle", "line_art": "the Line Art", "hull": "the hulls"}[method])]
    return said + (f", in place of {listed(others, NAMED)}" if others else "")

