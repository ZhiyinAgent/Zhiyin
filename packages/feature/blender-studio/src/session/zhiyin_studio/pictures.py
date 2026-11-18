"""
What every picture of the scene shares: the device that draws it, writing it without leaving a
half-written file, and the settings a picture changes, put back exactly afterwards.
"""

import contextlib
import os

import bpy
import mathutils

from .arguments import need
from .finding import scene, subjects
from .graphics_card import DRAWING, card_free
from .material_marks import lets_light_through

GPU_KINDS = ("OPTIX", "CUDA", "HIP", "ONEAPI", "METAL")


# Bounces light is followed through in a scene with glass or a liquid.
SEE_THROUGH_BOUNCES = 32


def gpu():
    """Turns on the first kind of GPU Cycles can use, and names it; nothing on a CPU-only PC."""
    preferences = bpy.context.preferences.addons["cycles"].preferences
    for kind in GPU_KINDS:
        try:
            preferences.compute_device_type = kind
        except TypeError:
            continue
        preferences.get_devices()
        devices = [d for d in preferences.devices if d.type == kind]
        if devices:
            for device in preferences.devices:
                device.use = device.type == kind
            return devices[0].name
    preferences.compute_device_type = "NONE"
    return None


class Device:
    def __init__(self, card_draws=True):
        self.name = None if DRAWING.without_card else gpu()
        # Whether EEVEE and the solid view draw on this computer's graphics
        # card; where they do not, Cycles draws their pictures.
        self.eevee = card_draws
        self.solid = card_draws

    def use_cycles(self, samples, denoised=None):
        """
        Cycles at so many samples on the device found. Denoising is as the
        scene has it, unless `denoised` says otherwise, as a quick look at few
        samples needs.
        """
        render = scene()
        render.render.engine = "CYCLES"
        render.cycles.device = "GPU" if self.name else "CPU"
        render.cycles.samples = samples
        if denoised is not None:
            render.cycles.use_denoising = denoised

    def guiding_text(self):
        """
        What to say of path guiding the scene asks for: Cycles guides paths
        only on the processor, so on a graphics card it does nothing.
        """
        if not (self.name and scene().cycles.use_guiding):
            return ""
        return (
            f" The scene asks for path guiding, which Cycles does only on the processor: this picture was drawn on {self.name}"
            " without it, and the scene keeps the setting."
        )

    def said(self):
        return self.name or "the processor"


def write_picture(path, file_format, quality=90):
    settings = scene().render.image_settings
    settings.media_type = "IMAGE"
    settings.file_format = file_format
    if file_format == "JPEG":
        settings.quality = quality
        settings.color_mode = "RGB"
    elif file_format == "PNG":
        settings.color_mode = "RGBA" if scene().render.film_transparent else "RGB"

    def render_to(where):
        scene().render.filepath = where
        with card_free():
            bpy.ops.render.render(write_still=True)

    saved_over(path, render_to)


def saved_over(path, save):
    """
    Saves a picture at `path` by `save(where)`, written beside it first and
    then put in its place, so a picture already there is replaced whole or
    left as it was; one another program holds open is said, not a bare error.
    """
    folder, name = os.path.split(path)
    stem, extension = os.path.splitext(name)
    beside = os.path.join(folder, f".{stem}.zhiyin-writing{extension}")
    save(beside)
    try:
        os.replace(beside, path)
    except PermissionError:
        with contextlib.suppress(OSError):
            os.remove(beside)
        need(
            False,
            f"{name} is open in another program, which keeps it from being replaced: close it there, "
            "or write the picture under another name.",
        )


def lifelike_eevee(s):
    """
    Without ray tracing EEVEE draws glass and polished metal black; without its
    fast global illumination a product takes no light from the surfaces round
    it, and shows more than a stop darker than Cycles shows it.
    """
    s.eevee.use_raytracing = True
    s.eevee.use_fast_gi = True


class Kept:
    """Render settings a preview changes, put back exactly afterwards."""

    FIELDS = (
        ("render", "engine"),
        ("render", "resolution_x"),
        ("render", "resolution_y"),
        ("render", "resolution_percentage"),
        ("render", "filepath"),
        ("render", "film_transparent"),
        ("eevee", "taa_render_samples"),
        ("eevee", "use_raytracing"),
        ("eevee", "use_fast_gi"),
        ("cycles", "samples"),
        ("cycles", "device"),
        ("cycles", "use_denoising"),
        ("cycles", "time_limit"),
        ("cycles", "max_bounces"),
        ("cycles", "glossy_bounces"),
        ("cycles", "transmission_bounces"),
        ("cycles", "transparent_max_bounces"),
    )

    def __init__(self):
        s = scene()
        self.values = [(owner, field, getattr(getattr(s, owner), field)) for owner, field in self.FIELDS]
        settings = s.render.image_settings
        self.picture = (settings.media_type, settings.file_format, settings.color_mode, settings.quality)
        shading = s.display.shading
        self.shading = (shading.light, shading.color_type)
        self.camera = s.camera

    def restore(self):
        s = scene()
        # The camera first: nothing after may leave the scene without it.
        s.camera = self.camera
        for owner, field, value in self.values:
            setattr(getattr(s, owner), field, value)
        settings = s.render.image_settings
        # The kind of output first: which picture formats there are depends on it.
        settings.media_type = self.picture[0]
        for field, value in zip(("file_format", "color_mode", "quality"), self.picture[1:]):
            if getattr(settings, field) == value:
                continue
            try:
                setattr(settings, field, value)
            except TypeError:
                # A value Blender read back as none of its own, such as the
                # empty colour mode a codec change can leave: there is nothing
                # to put back.
                pass
        s.display.shading.light, s.display.shading.color_type = self.shading


def under_a_roof(camera):
    """
    Whether something in the picture is straight above the camera, as a
    ceiling is above one that stands in a room.
    """
    shown = {obj.name for obj in subjects()}
    depsgraph = bpy.context.evaluated_depsgraph_get()
    up = mathutils.Vector((0, 0, 1))
    origin = camera.matrix_world.translation.copy()
    # Past what is hidden from the picture, to the first thing that is in it.
    for _ in range(16):
        hit, where, _normal, _face, obj, _matrix = scene().ray_cast(depsgraph, origin, up)
        if not hit:
            return False
        if obj.name in shown:
            return True
        origin = where + up * 1e-4
    return False


def see_through():
    """Whether anything in the picture lets light through it, as glass or a liquid does."""
    return any(lets_light_through(obj) for obj in subjects())


def deep_bounces():
    """
    With something see-through in the scene, light is followed through more
    bounces than Blender's own limits, four of them off glossy surfaces,
    which leave dark bands inside a thick bottle. Returns what puts the
    scene's own limits back.
    """
    c = scene().cycles
    names = ("max_bounces", "glossy_bounces", "transmission_bounces", "transparent_max_bounces")
    kept = [(name, getattr(c, name)) for name in names]
    if see_through():
        for name, value in kept:
            setattr(c, name, max(value, SEE_THROUGH_BOUNCES))

    def restore():
        for name, value in kept:
            setattr(c, name, value)

    return restore
