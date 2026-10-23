"""What a rendered picture shows: the colour each object shows in it.

The scene is drawn flat, each object in a colour of its own, through the same
camera, and the picture is read where each object is. Glass and liquids are
peeled away in further drawings, so what is inside them is told apart from
them. Everything set for the drawings is put back.

The picture is metered too, as a camera meters a scene, with the scene's own
surfaces as its grey cards: a matt surface shows at its own colour when the
light on it, after the exposure, is what a white card would give back as
white. Surfaces lit several times past that come out pale or glaring, and the
answer says which, and the exposure that would show them as they are.
"""

import math
import os
import shutil
import tempfile

import bpy
import numpy

from .common import CUT_OF, lets_light_through, scene, subjects, wood_of

DRAWN = {"MESH", "CURVE", "FONT", "SURFACE", "META", "CURVES", "POINTCLOUD", "VOLUME", "GREASEPENCIL"}
# Each channel of the flat colours takes one of sixteen levels, 17 apart in
# the drawing's 8-bit values, which a flat drawing without dither or
# anti-aliasing writes exactly. Black, with nothing drawn, is none; the last
# colour is every object past those told apart, so what they cover is never
# put down to what is behind them.
LEVELS = 15
BASE = LEVELS + 1
UNTOLD = BASE**3 - 1
MOST_TOLD = UNTOLD - 1
# Longest side of the drawings, and of the picture as it is read.
MEASURED = 400
# Objects covering less of the picture than this are too small to read.
SMALLEST = 0.002
# How many layers of glass are looked through.
LAYERS = 3
# Light on a surface this many times past what shows it at its own colour is
# said: a stop and a third.
PAST = 2.5
# How much of the picture such surfaces cover before it is said: each, and together.
PAST_EACH, PAST_TOGETHER = 0.02, 0.1
# A colour darker than this is too near black to meter light against.
DARKEST_METERED = 0.03
# Lettering within this many levels of 255 of what it lies on, in every
# channel, does not read.
UNREADABLE = 30
# How far round lettering, in the measured picture's pixels, its ground is looked for.
AROUND = 3


def linear(level):
    srgb = level / LEVELS
    return srgb / 12.92 if srgb <= 0.04045 else ((srgb + 0.055) / 1.055) ** 2.4


def flat_colour(number):
    """The flat colour an object is drawn in for its number."""
    return (linear(number // BASE**2), linear(number // BASE % BASE), linear(number % BASE), 1)


def colours(picture, metered=False):
    """
    The colour each object shows in a picture just rendered, as one line; and,
    metered, which surfaces the picture's light is too much for.
    """
    s = scene()
    drawn = [o for o in subjects() if o.type in DRAWN]
    objects, untold = drawn[:MOST_TOLD], drawn[MOST_TOLD:]
    if not objects:
        return ""
    # What fills a plan's cut is drawn as the shape it was cut from.
    sources = {o.name: o for o in drawn}
    fills = {o: sources[o[CUT_OF]] for o in s.objects if o.get(CUT_OF) in sources and not o.hide_render}
    folder = tempfile.mkdtemp(prefix="zhiyin-seen-")
    exposure = s.view_settings.exposure
    # Kept before the drawings, which are renders and take the picture's place.
    light = light_kept(os.path.join(folder, "light.exr")) if metered else None
    put_back = setting_aside(s, [*drawn, *fills])
    try:
        for number, obj in enumerate(objects, start=1):
            obj.color = flat_colour(number)
        for obj in untold:
            obj.color = flat_colour(UNTOLD)
        for fill, source in fills.items():
            fill.color = source.color
        hidden = set()
        layers = []
        for depth in range(LAYERS):
            for obj in objects:
                obj.hide_render = obj in hidden
            for fill, source in fills.items():
                fill.hide_render = source in hidden
            layers.append(drawing(os.path.join(folder, f"{depth}.png")))
            found = {objects[n - 1] for n in numpy.unique(layers[-1]) if 0 < n < UNTOLD}
            newly = {o for o in found if lets_light_through(o)} - hidden
            if not newly:
                break
            hidden |= newly
        height, width = layers[0].shape
        shown = read(picture, width, height)
        lit = read(light, width, height, 2**exposure) if light else None
    finally:
        put_back()
        shutil.rmtree(folder, ignore_errors=True)
    see_through = numpy.zeros(UNTOLD + 1, dtype=bool)
    see_through[1 : len(objects) + 1] = [lets_light_through(o) for o in objects]
    owner = layers[0].copy()
    for layer in layers[1:]:
        behind = see_through[owner] & (layer != 0)
        owner[behind] = layer[behind]
    said = []
    past = []
    lost = []
    for number in sorted(numpy.unique(owner), key=lambda n: -(owner == n).sum()):
        where = owner == number
        if number in (0, UNTOLD) or where.mean() < SMALLEST:
            continue
        obj = objects[number - 1]
        if obj.get("zhiyin_text"):
            ground = lies_on(owner, where)
            if 0 < ground < UNTOLD and numpy.abs(numpy.median(shown[where], axis=0) - numpy.median(shown[owner == ground], axis=0)).max() < UNREADABLE:
                lost.append(f"{obj.name} on {objects[ground - 1].name}")
        front = layers[0][where]
        behind = front[(front != number) & (front != UNTOLD)]
        through = numpy.bincount(behind) if (front != number).mean() > 0.5 and behind.size else None
        said.append(
            f"{obj.name} {hex_colour(shown[where])}"
            + (f" through {objects[int(through.argmax()) - 1].name}" if through is not None else "")
        )
        own = own_colour(obj) if lit is not None and through is None and where.mean() >= PAST_EACH else None
        if own is not None and brightness(own) >= DARKEST_METERED:
            times = brightness(numpy.median(lit[where], axis=0)) / brightness(own)
            if times >= PAST:
                past.append((obj.name, times, where.mean()))
    if (owner == 0).mean() >= SMALLEST:
        said.append(f"background {hex_colour(shown[owner == 0])}")
    return (
        "Colours in the picture, each the middle of what it shows: "
        + ", ".join(said)
        + "."
        + (f" Lettering that shows almost the colour of what it lies on, and so does not read: {', '.join(lost)}." if lost else "")
        + (f" {len(untold)} more objects past the first {MOST_TOLD} are not told apart." if untold else "")
        + lit_past(past, exposure)
    )


def lies_on(owner, where):
    """The object that most of the picture just round a shape belongs to, as its number, or 0 for none."""
    around = numpy.zeros_like(where)
    for step in range(1, AROUND + 1):
        around[step:, :] |= where[:-step, :]
        around[:-step, :] |= where[step:, :]
        around[:, step:] |= where[:, :-step]
        around[:, :-step] |= where[:, step:]
    beside = owner[around & ~where]
    beside = beside[beside != 0]
    return int(numpy.bincount(beside).argmax()) if beside.size else 0


def lit_past(past, exposure):
    """What to say of surfaces lit past their colours, each with how many times and how much of the picture."""
    covered = sum(share for _, _, share in past)
    if covered < PAST_TOGETHER:
        return ""
    stops = sum(share * math.log2(times) for _, times, share in past) / covered
    return (
        " Lit past their own colours, which shows them pale or glaring: "
        + ", ".join(f"{name} about {times:.2g}×" for name, times, _ in past[:4])
        + f". The exposure is {exposure:+.3g}; an exposure of about {exposure - stops:+.1f} shows them at their colours,"
        " as does less light on them."
    )


def brightness(colour):
    return 0.2126 * colour[0] + 0.7152 * colour[1] + 0.0722 * colour[2]


def own_colour(obj):
    """The one plain, matt colour an object was given, as light; or nothing when it has no such colour."""
    materials = [slot.material for slot in obj.material_slots if slot.material]
    if len(materials) != 1 or not materials[0].use_nodes or lets_light_through(obj):
        return None
    surface = next((n for n in materials[0].node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if surface is None:
        return None
    inputs = surface.inputs
    glows = inputs["Emission Strength"].default_value > 0 and any(inputs["Emission Color"].default_value[:3])
    # Wood draws its grain in the colour it was given, which is still its own.
    pictured = inputs["Base Color"].is_linked and not wood_of(materials[0])
    if pictured or inputs["Metallic"].default_value > 0.5 or glows:
        return None
    return tuple(inputs["Base Color"].default_value[:3])


def light_kept(path):
    """
    The picture just rendered as the light it was made of, before tone and
    exposure, in a file; or nothing when there is none to keep.
    """
    result = bpy.data.images.get("Render Result")
    if result is None:
        return None
    settings = scene().render.image_settings
    before = (settings.file_format, settings.color_mode, settings.color_depth)
    try:
        settings.file_format, settings.color_mode, settings.color_depth = "OPEN_EXR", "RGB", "16"
        result.save_render(path, scene=scene())
    except RuntimeError:
        return None
    finally:
        settings.file_format, settings.color_mode, settings.color_depth = before
    return path if os.path.exists(path) else None


def setting_aside(s, objects):
    """Hides what is not measured, and returns what puts everything back."""
    shading = s.display.shading
    settings = [
        (s.render, "engine"),
        (s.render, "resolution_percentage"),
        (s.render, "film_transparent"),
        (s.render, "filepath"),
        (s.render, "dither_intensity"),
        (s.display, "render_aa"),
        (shading, "light"),
        (shading, "color_type"),
        (shading, "show_object_outline"),
        (shading, "show_shadows"),
        (shading, "show_cavity"),
        (shading, "show_specular_highlight"),
        (shading, "show_xray"),
        (shading, "use_dof"),
        (s.view_settings, "view_transform"),
        (s.view_settings, "look"),
        (s.view_settings, "exposure"),
        (s.view_settings, "gamma"),
        (s.view_settings, "use_white_balance"),
        (s.view_settings, "use_curve_mapping"),
        (s.display_settings, "display_device"),
        (s.render.image_settings, "file_format"),
        (s.render.image_settings, "color_mode"),
        (s.render.image_settings, "color_depth"),
        (s.render.image_settings, "color_management"),
    ]
    values = [(owner, name, getattr(owner, name)) for owner, name in settings]
    others = [o for o in s.objects if o not in objects and not o.hide_render and o.type in DRAWN]
    kept = [(o, o.color[:], o.hide_render) for o in objects] + [(o, o.color[:], False) for o in others]
    for obj in others:
        obj.hide_render = True
    longest = max(s.render.resolution_x, s.render.resolution_y)
    s.render.engine = "BLENDER_WORKBENCH"
    s.render.resolution_percentage = max(1, min(100, round(MEASURED * 100 / longest)))
    s.render.film_transparent = True
    s.render.dither_intensity = 0
    s.display.render_aa = "OFF"
    shading.light, shading.color_type = "FLAT", "OBJECT"
    for name in ("show_object_outline", "show_shadows", "show_cavity", "show_specular_highlight", "show_xray", "use_dof"):
        setattr(shading, name, False)
    s.view_settings.view_transform, s.view_settings.look = "Standard", "None"
    s.view_settings.exposure, s.view_settings.gamma = 0, 1
    # Each object's colour is read back exactly, so nothing may shift it on
    # the way to the file: no white balance, curve, wide-gamut display, other
    # bit depth or colour management of the file's own.
    s.view_settings.use_white_balance = False
    s.view_settings.use_curve_mapping = False
    s.display_settings.display_device = "sRGB"
    s.render.image_settings.file_format, s.render.image_settings.color_mode = "PNG", "RGBA"
    s.render.image_settings.color_depth = "8"
    s.render.image_settings.color_management = "FOLLOW_SCENE"

    def restore():
        for owner, name, value in values:
            setattr(owner, name, value)
        for obj, colour, hidden in kept:
            obj.color, obj.hide_render = colour, hidden

    return restore


def drawing(path):
    """The flat drawing's object number at each pixel, 0 where nothing is."""
    s = scene()
    s.render.filepath = path
    bpy.ops.render.render(write_still=True)
    image = bpy.data.images.load(path, check_existing=False)
    try:
        width, height = image.size
        pixels = numpy.empty(width * height * 4, dtype=numpy.float32)
        image.pixels.foreach_get(pixels)
    finally:
        bpy.data.images.remove(image)
    rgba = pixels.reshape(height, width, 4)
    level = numpy.rint(rgba[..., :3] * LEVELS).astype(int)
    number = level[..., 0] * BASE**2 + level[..., 1] * BASE + level[..., 2]
    number[rgba[..., 3] < 0.5] = 0
    return number


def read(path, width, height, scale=255):
    """The picture at the drawings' size: 0 to 255 for each channel, or its light times a scale."""
    image = bpy.data.images.load(path, check_existing=False)
    try:
        image.scale(width, height)
        pixels = numpy.empty(width * height * 4, dtype=numpy.float32)
        image.pixels.foreach_get(pixels)
    finally:
        bpy.data.images.remove(image)
    return pixels.reshape(height, width, 4)[..., :3] * scale


def hex_colour(pixels):
    r, g, b = (int(round(v)) for v in numpy.median(pixels, axis=0))
    return f"#{min(r, 255):02x}{min(g, 255):02x}{min(b, 255):02x}"
