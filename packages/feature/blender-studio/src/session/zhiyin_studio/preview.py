"""
The preview after each change, and the overview camera it is taken through. A preview never
changes the scene: everything it adds or sets is put back before the next command, and it is
rendered after the file was saved.
"""

import math
import os

import bpy
import mathutils

from .aiming import place_to_fit
from .arguments import number, whole
from .errors import keep_error
from .finding import LIGHTING, PREVIEW, in_collection, scene, subjects
from .geometry import world_corners
from .pictures import Kept, deep_bounces, lifelike_eevee, see_through, under_a_roof, write_picture

# Seconds of drawing a full preview in Cycles may take, so a scene that is slow
# to draw, such as smoke or a liquid's volume, cannot hold up turning the view.
PREVIEW_DRAWING = 1.0
# A quick picture Cycles draws where the solid view cannot: at half size, as
# the solid view's is, at few samples, and within a quarter of a second of
# drawing.
QUICK_SIZE, QUICK_SAMPLES, QUICK_DRAWING = 50, 2, 0.25

# The colour settings the solid view draws without, in the order they are set: a look depends on the transform.
TONED = ("view_transform", "look", "exposure", "gamma")


def overview_camera(view, aspect):
    data = bpy.data.cameras.new(PREVIEW)
    data.lens = 50
    camera = bpy.data.objects.new(PREVIEW, data)
    scene().collection.objects.link(camera)
    bpy.context.view_layer.update()
    # A frame sheet framed on some parts gives the corners they reach.
    fit = view.get("fit")
    if not (isinstance(fit, list) and fit and all(isinstance(c, mathutils.Vector) for c in fit)):
        fit = None
    corners = fit or world_corners(subjects()) or [mathutils.Vector((-1, -1, 0)), mathutils.Vector((1, 1, 1))]
    yaw = math.radians(-45 + number(view.get("yaw"), "yaw", default=0))
    pitch = math.radians(max(-85, min(85, 25 + number(view.get("pitch"), "pitch", default=0))))
    zoom = number(view.get("zoom"), "zoom", minimum=0.05, maximum=20, default=1)
    direction = mathutils.Vector((math.cos(pitch) * math.cos(yaw), math.cos(pitch) * math.sin(yaw), math.sin(pitch)))
    centre = place_to_fit(camera, direction, corners, aspect, 0.08)
    camera.location = centre + (camera.location - centre) / zoom
    return camera


def preview_light():
    """A soft light for the overview of a scene that has none of its own."""
    data = bpy.data.lights.new(PREVIEW, "SUN")
    data.energy = 2.5
    data.angle = math.radians(30)
    obj = bpy.data.objects.new(PREVIEW + " light", data)
    scene().collection.objects.link(obj)
    obj.rotation_euler = (math.radians(50), 0, math.radians(30))
    return obj


def surface_colours():
    """
    Gives each material, for the moment, the colour its surface is set to as
    the colour a solid drawing uses, and returns what to put back. Light goes
    through glass, so a solid drawing shows it partly see-through: clear glass
    mostly, a coloured liquid less, so its colour still shows.
    """
    kept = []
    for material in bpy.data.materials:
        nodes = material.node_tree.nodes if material.use_nodes and material.node_tree else []
        surface = next((n for n in nodes if n.type == "BSDF_PRINCIPLED"), None)
        if surface is None:
            continue
        kept.append((material, tuple(material.diffuse_color)))
        colour = surface.inputs["Base Color"].default_value
        opacity = 1
        if surface.inputs["Transmission Weight"].default_value > 0:
            brightest = max(colour[0], colour[1], colour[2])
            saturation = (brightest - min(colour[0], colour[1], colour[2])) / brightest if brightest > 0 else 0
            opacity = 0.2 + 0.6 * saturation
        material.diffuse_color = (colour[0], colour[1], colour[2], opacity)
    return kept


def quick_surroundings(s):
    """
    What the camera sees behind the scene, as a solid drawing can show it: the
    product backdrop's white, without the backdrop itself, which a solid
    drawing shades grey, or the world's own colour. Returns what to put back.
    """
    world = s.world
    if world is None:
        return lambda: None
    backdrop = [o for o in s.objects if o.type == "MESH" and in_collection(o, LIGHTING) and not o.hide_render]
    background = next((n for n in world.node_tree.nodes if n.type == "BACKGROUND"), None) if world.use_nodes and world.node_tree else None
    if backdrop:
        colour = (1, 1, 1)
    elif background is not None and not background.inputs["Color"].is_linked:
        strength = background.inputs["Strength"].default_value
        colour = tuple(min(1, c * strength) for c in background.inputs["Color"].default_value[:3])
    else:
        colour = tuple(world.color)
    kept = tuple(world.color)
    world.color = colour
    for obj in backdrop:
        obj.hide_render = True

    def restore():
        world.color = kept
        for obj in backdrop:
            obj.hide_render = False

    return restore


def quick_picture(s, partial):
    """
    The scene as Blender's solid view draws it, at half size: a few
    milliseconds where a lit picture takes a tenth of a second or more, so the
    view keeps up while the person turns it.
    """
    s.render.engine = "BLENDER_WORKBENCH"
    s.render.resolution_percentage = 50
    s.display.shading.light = "STUDIO"
    s.display.shading.color_type = "MATERIAL"
    colours = surface_colours()
    surroundings = quick_surroundings(s)
    # The solid view shows each surface's own colour: the camera's exposure and tone are the render's.
    toned = [(name, getattr(s.view_settings, name)) for name in TONED]
    for name, value in zip(TONED, ("Standard", "None", 0, 1)):
        setattr(s.view_settings, name, value)
    try:
        write_picture(partial, "JPEG", 80)
    finally:
        for name, value in toned:
            setattr(s.view_settings, name, value)
        surroundings()
        for material, colour in colours:
            material.diffuse_color = colour


def preview(view, path, device):
    """
    Renders a picture of the scene for the 3D view, quick or full, then leaves
    the scene exactly as it was.
    """
    s = scene()
    kept = Kept()
    width = whole(view.get("width"), "preview width", minimum=64, maximum=3840, default=960)
    height = whole(view.get("height"), "preview height", minimum=64, maximum=2160, default=540)
    temporary = []
    shown = view.get("view", "overview")
    try:
        if shown == "camera" and s.camera is not None:
            used = "camera"
        else:
            temporary.append(overview_camera(view, width / height))
            s.camera = temporary[-1]
            used = "overview"
        if used == "overview" and not any(o.type == "LIGHT" and not o.hide_render for o in s.objects):
            temporary.append(preview_light())
        s.render.resolution_x, s.render.resolution_y = width, height
        s.render.resolution_percentage = 100
        s.render.film_transparent = False
        partial = path + ".part.jpg"
        engine = "EEVEE"
        if view.get("quick") is True and device.solid:
            engine = "the solid view"
            quick_picture(s, partial)
        elif view.get("quick") is True:
            # Where the solid view cannot draw, Cycles draws the quick picture,
            # small and at a few samples, so turning still keeps up.
            engine = "Cycles"
            s.render.resolution_percentage = QUICK_SIZE
            device.use_cycles(QUICK_SAMPLES, denoised=True)
            s.cycles.time_limit = QUICK_DRAWING
            write_picture(partial, "JPEG", 80)
        elif (device.name and see_through()) or (used == "camera" and under_a_roof(s.camera)):
            # EEVEE draws light through one layer of glass at most, so a
            # liquid in a bottle vanishes, and it lets a sky's light through
            # walls, so a room shows paler and bluer than it is lit; Cycles
            # draws both as the render will. Light through glass takes many
            # bounces, so that picture is drawn at half size, and a room on
            # the processor too; a room on a graphics card is quick enough at
            # full size.
            s.render.resolution_percentage = 50 if see_through() or not device.name else 100
            engine = "Cycles"
            device.use_cycles(16, denoised=True)
            s.cycles.time_limit = PREVIEW_DRAWING
            deep_bounces()
            write_picture(partial, "JPEG", 85)
        else:
            if device.eevee:
                try:
                    s.render.engine = "BLENDER_EEVEE"
                    s.eevee.taa_render_samples = 16
                    lifelike_eevee(s)
                    write_picture(partial, "JPEG", 85)
                except Exception as error:
                    keep_error("EEVEE could not draw a preview, so Cycles draws them from here on", error)
                    device.eevee = False
            if not device.eevee:
                engine = "Cycles"
                s.render.resolution_percentage = 50
                device.use_cycles(8, denoised=True)
                s.cycles.time_limit = PREVIEW_DRAWING
                write_picture(partial, "JPEG", 85)
        os.replace(partial, path)
        scale = s.render.resolution_percentage / 100
        drawn = {"path": path, "width": round(width * scale), "height": round(height * scale), "view": used, "engine": engine}
        return drawn if subjects() else {**drawn, "empty": True}
    finally:
        for obj in temporary:
            data = obj.data
            bpy.data.objects.remove(obj)
            if isinstance(data, bpy.types.Camera):
                bpy.data.cameras.remove(data)
            elif isinstance(data, bpy.types.Light):
                bpy.data.lights.remove(data)
        kept.restore()
