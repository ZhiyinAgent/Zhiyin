"""
Pictures on a computer whose graphics card cannot draw for Blender, as one with only a basic display
adapter cannot: there Blender ends as soon as it draws with EEVEE or the solid view, without an error
Python could catch. Zhiyin finds that out once in its run and starts every Blender after it with
--processor. Such a Blender draws each of those pictures with Cycles instead, on the device Cycles
found, which on such a computer is the processor. Grease Pencil objects are drawn on the graphics
card whatever the engine, Cycles too, so there they are left out of every picture, and the answer
names them.

With --no-graphics-card, for tests, a Blender on a computer whose graphics card draws behaves as one
that has none: a picture drawn on the graphics card ends it, as it would end there, and Cycles draws
on the processor.
"""

import contextlib
import ctypes
from ctypes import wintypes

import bpy

from .finding import PREVIEW, scene

# The engines that draw on the graphics card.
CARD_ENGINES = ("BLENDER_EEVEE", "BLENDER_WORKBENCH")
# How Windows says a program ended reading memory it may not: as Blender ends there.
ACCESS_VIOLATION = 0xC0000005
# The world that lights Cycles's drawing of the solid view, evenly from all round.
SOLID_WORLD = (0.8, 0.8, 0.8)


class Drawing:
    """
    Whether this Blender draws on the processor, whether it behaves as on a computer with no
    graphics card, for tests, and the Grease Pencil objects a command's pictures left out.
    """

    def __init__(self):
        self.on_processor = False
        self.without_card = False
        self.left_out = set()


DRAWING = Drawing()


def grease_pencils(s=None):
    """The Grease Pencil objects a picture of the scene would show."""
    return [o for o in (s or scene()).objects if o.type == "GREASEPENCIL" and not o.hide_render]


@contextlib.contextmanager
def card_free():
    """
    For as long as a picture is drawn on a computer that draws on the processor: the Grease Pencil
    objects it would show hidden, and kept to be named.
    """
    hidden = grease_pencils() if DRAWING.on_processor else []
    for obj in hidden:
        obj.hide_render = True
    DRAWING.left_out.update(obj.name for obj in hidden)
    try:
        yield
    finally:
        for obj in hidden:
            obj.hide_render = False


def left_out_text():
    """What a command's pictures left out on this computer, as a sentence, or nothing; forgotten once said."""
    names = sorted(DRAWING.left_out)
    DRAWING.left_out.clear()
    if not names:
        return ""
    one = len(names) == 1
    return (
        f"{', '.join(names)} {'is a Grease Pencil object' if one else 'are Grease Pencil objects'}, which only a graphics card"
        f" draws, so {'it is' if one else 'they are'} left out of the pictures on this computer, which draws on its processor."
    )


def object_colour_material(glow):
    """A material in each object's own colour: a matt surface lit by what is round it, or glowing exactly that colour."""
    material = bpy.data.materials.new(PREVIEW)
    material.use_nodes = True
    tree = material.node_tree
    for node in list(tree.nodes):
        tree.nodes.remove(node)
    info = tree.nodes.new("ShaderNodeObjectInfo")
    shader = tree.nodes.new("ShaderNodeEmission" if glow else "ShaderNodeBsdfDiffuse")
    tree.links.new(info.outputs["Color"], shader.inputs["Color"])
    output = tree.nodes.new("ShaderNodeOutputMaterial")
    tree.links.new(shader.outputs[0], output.inputs["Surface"])
    return material


def plain_world(colour):
    """A world of one colour, at a strength of one."""
    world = bpy.data.worlds.new(PREVIEW)
    world.color = colour
    background = next((n for n in world.node_tree.nodes if n.type == "BACKGROUND"), None) if world.node_tree else None
    if background is not None:
        background.inputs["Color"].default_value = (*colour, 1)
        background.inputs["Strength"].default_value = 1
    return world


def solid_in_cycles(aside):
    """
    Sets the scene, through `aside`, for Cycles to draw what the solid view draws: every surface in
    its object's own colour, lit evenly from all round by a plain world, the scene's lights left out.
    Returns the material and world made for it, to remove once it is drawn.
    """
    s = scene()
    material = object_colour_material(glow=False)
    world = plain_world(SOLID_WORLD)
    aside.set(bpy.context.view_layer, "material_override", material)
    aside.set(s, "world", world)
    aside.hide([o for o in s.objects if o.type == "LIGHT"])
    return [material, world]


def flat_in_cycles():
    """
    Sets the scene for Cycles to draw each object flat in its object's own colour, exactly, as the
    solid view's flat light draws it: one sample through the middle of each pixel, of a surface that
    glows its colour, with nothing behind it. Returns what puts the scene back.
    """
    s = scene()
    c = s.cycles
    layer = bpy.context.view_layer
    material = object_colour_material(glow=True)
    world = plain_world((0, 0, 0))
    settings = {
        (s.render, "engine"): "CYCLES",
        (c, "device"): "CPU",
        (c, "samples"): 1,
        (c, "use_denoising"): False,
        (c, "use_adaptive_sampling"): False,
        (c, "pixel_filter_type"): "BOX",
        (c, "filter_width"): 0.01,
        (c, "max_bounces"): 0,
        (c, "time_limit"): 0,
        (layer, "material_override"): material,
        (s, "world"): world,
    }
    kept = [(owner, name, getattr(owner, name)) for owner, name in settings]
    for (owner, name), value in settings.items():
        setattr(owner, name, value)

    def restore():
        for owner, name, value in kept:
            setattr(owner, name, value)
        bpy.data.materials.remove(material)
        bpy.data.worlds.remove(world)

    return restore


def refused_by_card(operator, kwargs):
    """
    Why a script's operator is not run on a computer that draws on its processor, or nothing: it
    would draw on the graphics card, which ends this Blender there.
    """
    if not DRAWING.on_processor:
        return ""
    if operator == "render.opengl":
        return "it draws on the graphics card, which Blender cannot use on this computer: render with Cycles instead"
    if operator == "object.lightprobe_cache_bake":
        return "EEVEE bakes light probes on the graphics card, which Blender cannot use on this computer"
    if operator != "render.render":
        return ""
    named = kwargs.get("scene")
    s = bpy.data.scenes.get(named) if isinstance(named, str) and named else scene()
    if s is None:
        return ""
    if s.render.engine in CARD_ENGINES:
        return (
            f"{s.render.engine} draws on the graphics card, which Blender cannot use on this computer:"
            f" set bpy.data.scenes['{s.name}'].render.engine = 'CYCLES' first"
        )
    shown = grease_pencils(s)
    if shown:
        return (
            f"Grease Pencil objects are drawn on the graphics card, which Blender cannot use on this computer:"
            f" hide {', '.join(o.name for o in shown)} from the render first, with hide_render = True"
        )
    return ""


def end_on_card_drawing():
    """
    --no-graphics-card: a picture drawn on the graphics card ends this Blender, as an access
    violation ends one on a computer whose card cannot draw, with nothing said to Python.
    """
    DRAWING.without_card = True
    kernel = ctypes.windll.kernel32
    kernel.GetCurrentProcess.restype = wintypes.HANDLE
    kernel.TerminateProcess.argtypes = [wintypes.HANDLE, wintypes.UINT]

    def before_render(drawn, *_):
        s = drawn if isinstance(drawn, bpy.types.Scene) else scene()
        if s.render.engine in CARD_ENGINES or grease_pencils(s):
            kernel.TerminateProcess(kernel.GetCurrentProcess(), ACCESS_VIOLATION)

    bpy.app.handlers.render_pre.append(before_render)
