"""
blender_look: the scene, or the objects named, from the front, the right, the top and three
quarters round, on one sheet, each view in the shading asked: shaded, as wires, by the way each
face points, blue outward and red inward, or by its reflections of a light in bands, with how far
its neighbouring faces turn from each other. With it, each object's counts. It changes nothing.
"""

import os
import shutil
import tempfile
import time

import bmesh
import bpy
import mathutils
import numpy

from .aiming import place_to_fit
from .arguments import need, whole
from .finding import PREVIEW, find_objects, scene, subjects
from .form_measures import form_lines
from .geometry import SHAPE_TYPES, add_part, shapes_of, world_corners
from .graphics_card import solid_in_cycles
from .look_counts import counts
from .pictures import Kept, write_picture
from .preview import surface_colours
from .render import Aside
from .sheets import save_rgb, write_label
from .surface_quality import AXES, bends, bends_words, stripe_material
from .timeline import back_to, go_to, moment, now, seconds_text

# The four views: how each is named, the way from the objects to the camera,
# up the picture when it looks straight down, and whether it is drawn flat.
VIEWS = (
    ("front", (0, -1, 0), (0, 1, 0), True),
    ("right", (1, 0, 0), (0, 1, 0), True),
    ("top", (0, 0, 1), (0, 1, 0), True),
    ("three-quarter", (1, -1, 0.7), (0, 1, 0), False),
)
SHADINGS = {"shaded": "shaded", "wireframe": "wire", "faces": "faces", "reflections": "reflections"}
# A tile's width at least, by default and at most, in pixels; tiles are 4:3.
NARROWEST, TILE, WIDEST = 160, 480, 800
# Space round what is looked at, as a share of the picture.
MARGIN = 0.08
# The sheet's background, behind every view.
GROUND = 0.92
# A wire is this many pixels wide in its view.
WIRE_PIXELS = 1.3
SURFACE_GREY = (0.82, 0.82, 0.82, 1)
WIRE_DARK = (0.03, 0.03, 0.05, 1)
# Blender's face-orientation colours, as light: blue faces point outward, red inward.
OUTWARD = (0.05, 0.22, 0.95, 1)
INWARD = (0.9, 0.06, 0.05, 1)
# How many objects are counted one by one; past them, those with no fault are counted together.
MOST_COUNTED = 24


def face_material():
    """A material that glows blue where a face's front is seen and red where its back is, shaded by how it faces the camera."""
    material = bpy.data.materials.new(PREVIEW)
    material.use_nodes = True
    tree = material.node_tree
    for node in list(tree.nodes):
        tree.nodes.remove(node)
    geometry = tree.nodes.new("ShaderNodeNewGeometry")
    side = tree.nodes.new("ShaderNodeMix")
    side.data_type = "RGBA"
    side.inputs["A"].default_value = OUTWARD
    side.inputs["B"].default_value = INWARD
    tree.links.new(geometry.outputs["Backfacing"], side.inputs["Factor"])
    facing = tree.nodes.new("ShaderNodeLayerWeight")
    depth = tree.nodes.new("ShaderNodeMath")
    depth.operation = "MULTIPLY"
    depth.inputs[1].default_value = 0.5
    tree.links.new(facing.outputs["Facing"], depth.inputs[0])
    shade = tree.nodes.new("ShaderNodeMix")
    shade.data_type = "RGBA"
    shade.blend_type = "MULTIPLY"
    shade.inputs["B"].default_value = (0, 0, 0, 1)
    tree.links.new(depth.outputs["Value"], shade.inputs["Factor"])
    tree.links.new(side.outputs["Result"], shade.inputs["A"])
    glow = tree.nodes.new("ShaderNodeEmission")
    tree.links.new(shade.outputs["Result"], glow.inputs["Color"])
    output = tree.nodes.new("ShaderNodeOutputMaterial")
    tree.links.new(glow.outputs["Emission"], output.inputs["Surface"])
    return material


def wire_copies(shapes):
    """Each shape as wires along its own edges, in the world, to draw over its surface."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    made = []
    for obj in shapes:
        bm = bmesh.new()
        try:
            add_part(bm, obj, depsgraph)
            if not bm.edges:
                continue
            mesh = bpy.data.meshes.new(PREVIEW)
            bm.to_mesh(mesh)
        finally:
            bm.free()
        copy = bpy.data.objects.new(PREVIEW, mesh)
        wires = copy.modifiers.new("Wires", "WIREFRAME")
        wires.use_replace = True
        wires.use_boundary = True
        wires.use_even_offset = False
        wires.offset = 0
        copy.color = WIRE_DARK
        scene().collection.objects.link(copy)
        made.append(copy)
    return made


def pixel_size(camera, width, fit):
    """How wide one pixel of the picture is at the middle of what it shows, in metres."""
    data = camera.data
    if data.type == "ORTHO":
        return data.ortho_scale / width
    points = numpy.array([tuple(c) for c in fit])
    middle = mathutils.Vector(points.mean(axis=0))
    distance = (middle - camera.matrix_world.translation).length
    return distance * data.sensor_width / data.lens / width


def read_rgba(path):
    """A picture's pixels, top row first, laid over the sheet's background where it is clear."""
    image = bpy.data.images.load(path, check_existing=False)
    try:
        width, height = image.size
        pixels = numpy.empty(width * height * 4, dtype=numpy.float32)
        image.pixels.foreach_get(pixels)
    finally:
        bpy.data.images.remove(image)
    rgba = numpy.flipud(pixels.reshape(height, width, 4))
    alpha = rgba[:, :, 3:4]
    return rgba[:, :, :3] * alpha + GROUND * (1 - alpha)


def drawn_as(shading, s, aside, shapes, device, put_back, stripes="z"):
    """Sets the scene to draw the shading asked; returns what was made for it and how it is drawn."""
    made = []
    if shading in ("faces", "reflections"):
        material = face_material() if shading == "faces" else stripe_material(stripes)
        made.append(material)
        aside.set(bpy.context.view_layer, "material_override", material)
        for name, value in (("view_transform", "Standard"), ("look", "None"), ("exposure", 0), ("gamma", 1)):
            aside.set(s.view_settings, name, value)
        if device.eevee:
            s.render.engine = "BLENDER_EEVEE"
            s.eevee.taa_render_samples = 4
            return made, "EEVEE"
        device.use_cycles(4, denoised=False)
        return made, "Cycles"
    if not device.solid:
        return made + solid_by_cycles(shading, aside, shapes, device, put_back), "Cycles"
    s.render.engine = "BLENDER_WORKBENCH"
    s.display.shading.light = "STUDIO"
    aside.set(s.display.shading, "show_object_outline", False)
    # The solid view shows each surface's own colour: the camera's exposure and tone are the render's.
    for name, value in (("view_transform", "Standard"), ("look", "None"), ("exposure", 0), ("gamma", 1)):
        aside.set(s.view_settings, name, value)
    if shading == "shaded":
        s.display.shading.color_type = "MATERIAL"
        put_back.append(surface_colours())
        return made, "the solid view"
    s.display.shading.color_type = "OBJECT"
    for obj in shapes:
        put_back.append([(obj, tuple(obj.color))])
        obj.color = SURFACE_GREY
    made += wire_copies(shapes)
    return made, "the solid view"


def solid_by_cycles(shading, aside, shapes, device, put_back):
    """
    Where the solid view cannot draw, Cycles draws its look: each shape in its surface's colour, or
    grey under its wires, lit evenly from all round. Returns what was made for it.
    """
    for name, value in (("view_transform", "Standard"), ("look", "None"), ("exposure", 0), ("gamma", 1)):
        aside.set(bpy.context.scene.view_settings, name, value)
    put_back.append([(obj, tuple(obj.color)) for obj in shapes])
    made = []
    if shading == "shaded":
        put_back.append(surface_colours())
        for obj in shapes:
            material = next((slot.material for slot in obj.material_slots if slot.material), None)
            obj.color = tuple(material.diffuse_color) if material else SURFACE_GREY
    else:
        for obj in shapes:
            obj.color = SURFACE_GREY
        made += wire_copies(shapes)
    made += solid_in_cycles(aside)
    device.use_cycles(4, denoised=True)
    return made


def restore_colours(put_back):
    for kept in reversed(put_back):
        for owner, colour in kept:
            if isinstance(owner, bpy.types.Material):
                owner.diffuse_color = colour
            else:
                owner.color = colour


def remove(made):
    for thing in made:
        if isinstance(thing, bpy.types.Material):
            bpy.data.materials.remove(thing)
        elif isinstance(thing, bpy.types.World):
            bpy.data.worlds.remove(thing)
        else:
            data = thing.data
            bpy.data.objects.remove(thing)
            if isinstance(data, bpy.types.Camera):
                bpy.data.cameras.remove(data)
            elif isinstance(data, bpy.types.Mesh):
                bpy.data.meshes.remove(data)


def counted_text(shapes):
    """Each shape's counts, those with a fault first; past the most counted, the sound ones only by number."""
    lines = [counts(obj) for obj in shapes]
    faulty = [line for line, fault in lines if fault]
    sound = [line for line, fault in lines if not fault]
    room = max(0, MOST_COUNTED - len(faulty))
    shown = faulty[:MOST_COUNTED] + sound[:room]
    more_faulty = len(faulty) - min(len(faulty), MOST_COUNTED)
    more_sound = len(sound) - min(len(sound), room)
    tail = []
    if more_faulty:
        tail.append(f"{more_faulty} more objects with a fault: name them in objects to see theirs")
    if more_sound:
        tail.append(f"{more_sound} more with none")
    return shown + ([("; ".join(tail) + ".").capitalize()] if tail else [])


def look(args, scene_file, device):
    s = scene()
    names = args.get("objects") or []
    need(isinstance(names, list) and all(isinstance(n, str) for n in names), "objects lists objects by name.")
    shading = args.get("shading", "shaded")
    need(shading in SHADINGS, "shading is shaded, wireframe, faces or reflections.")
    stripes = args.get("stripes", "z")
    need(stripes in AXES, "stripes is x, y or z: the axis of the world the light's bands lie across.")
    need(args.get("stripes") is None or shading == "reflections", "stripes is for shading reflections.")
    width = whole(args.get("tile_width"), "tile_width", minimum=NARROWEST, maximum=WIDEST, default=TILE)
    height = round(width * 3 / 4)
    targets = find_objects(names) if names else subjects()
    shapes = list(dict.fromkeys(part for obj in targets for part in shapes_of(obj) if part.type in SHAPE_TYPES and not part.hide_render))
    need(shapes, "There is nothing to look at: name objects with a shape, or add some.")
    at = moment(args["time"], "time") if args.get("time") is not None else None
    kept_time = now()
    kept = Kept()
    aside = Aside()
    put_back = []
    made = []
    folder = tempfile.mkdtemp(prefix="zhiyin-look-")
    started = time.time()
    try:
        if at is not None:
            go_to(at)
        bpy.context.view_layer.update()
        fit = world_corners(shapes)
        need(fit, "There is nothing to look at: what was named shows nothing.")
        shown = {o.name for o in shapes}
        aside.hide([o for o in s.objects if o.type in SHAPE_TYPES | {"CURVES", "POINTCLOUD", "VOLUME", "GREASEPENCIL"} and o.name not in shown])
        camera = bpy.data.objects.new(PREVIEW, bpy.data.cameras.new(PREVIEW))
        s.collection.objects.link(camera)
        made.append(camera)
        aside.set(s, "camera", camera)
        s.render.resolution_x, s.render.resolution_y = width, height
        s.render.resolution_percentage = 100
        s.render.film_transparent = True
        extra, engine = drawn_as(shading, s, aside, shapes, device, put_back, stripes)
        made += extra
        wires = [o for o in extra if isinstance(o, bpy.types.Object)]
        sheet = numpy.full((2 * height + 4, 2 * width + 4, 3), GROUND, dtype=numpy.float32)
        for index, (name, way, ahead, flat) in enumerate(VIEWS):
            camera.data.type = "ORTHO" if flat else "PERSP"
            camera.data.lens = 50
            place_to_fit(camera, mathutils.Vector(way).normalized(), fit, width / height, MARGIN, ahead)
            bpy.context.view_layer.update()
            thickness = pixel_size(camera, width, fit) * WIRE_PIXELS
            for wire in wires:
                wire.modifiers["Wires"].thickness = thickness
            path = os.path.join(folder, f"{index}.png")
            write_picture(path, "PNG")
            rgb = read_rgba(path)
            if rgb.shape[0] != height or rgb.shape[1] != width:
                ys = (numpy.arange(height) * rgb.shape[0] / height).astype(int)
                xs = (numpy.arange(width) * rgb.shape[1] / width).astype(int)
                rgb = rgb[ys][:, xs]
            write_label(rgb, f"{name} · {SHADINGS[shading]}".upper(), 4, 4, 2 if width >= 320 else 1)
            row, column = divmod(index, 2)
            top, left = row * (height + 4), column * (width + 4)
            sheet[top : top + height, left : left + width] = rgb
        save_rgb(sheet, args["picture"])
        # The counts are of the shapes where they are at the moment asked.
        lines = counted_text(shapes)
        # How far what the sheet shows is from a block-out, read however a model checks its work.
        lines += form_lines(shapes)
        if shading == "reflections":
            lines += [f"Reflections on {o.name}: {bends_words(bends(o))}." for o in shapes[:MOST_COUNTED] if o.type == "MESH"]
    finally:
        restore_colours(put_back)
        aside.restore()
        remove(made)
        kept.restore()
        back_to(kept_time)
        shutil.rmtree(folder, ignore_errors=True)
    took = time.time() - started
    what = ", ".join(o.name for o in targets[:6]) + (f" and {len(targets) - 6} more" if len(targets) > 6 else "") if names else "the scene"
    how = {
        "shaded": "shaded in each surface's colour",
        "wireframe": "as wires along every edge over the surface, hidden edges hidden",
        "faces": "by the way each face points: blue faces point outward, red inward",
        "reflections": (
            f"by their reflections of a light in bands across {stripes}, each surface's own colour left out: bands that"
            " bend smoothly show a smooth surface, and a kink or break in them a crease or a jump in its curvature"
        ),
    }[shading]
    when = f" at {seconds_text(at)} of the animation" if at is not None else ""
    return (
        f"A look at {what}{when}: front, right, top and three-quarter on one sheet, the first three drawn flat, "
        f"each framed on {'them' if names else 'it'}, {how}, drawn with {engine} in {took:.1f} s.\n" + "\n".join(lines)
    )
