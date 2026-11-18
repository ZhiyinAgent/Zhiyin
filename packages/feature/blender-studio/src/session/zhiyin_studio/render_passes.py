"""
What a render holds besides its picture, read straight after it is drawn: its light before any
compositor, the noisy picture under the denoised one, and how many samples each pixel took.

Measured in Blender 5.2: a render result saved as a multilayer EXR holds the compositor's picture
and each pass of the view layer as images of their own, which OpenImageIO, bundled with Blender,
reads by name; a single-layer EXR holds the compositor's picture alone. The sample count pass holds
each pixel's samples as a share of the most it could take.
"""

import os

import bpy
import numpy
import OpenImageIO as oiio

from .finding import scene

# The passes by the names the multilayer file gives them, after the view layer's name.
COMBINED, NOISY, SAMPLES = "Combined", "Noisy Image", "Debug Sample Count"


def saved_passes(path):
    """Saves the render just drawn, every pass of it, as a multilayer EXR; whether there was one."""
    result = bpy.data.images.get("Render Result")
    if result is None:
        return False
    settings = scene().render.image_settings
    before = (settings.media_type, settings.file_format, settings.color_mode, settings.color_depth)
    try:
        settings.media_type = "MULTI_LAYER_IMAGE"
        settings.color_depth = "32"
        result.save_render(path, scene=scene())
    except RuntimeError:
        return False
    finally:
        settings.media_type = before[0]
        for field, value in zip(("file_format", "color_mode", "color_depth"), before[1:]):
            try:
                setattr(settings, field, value)
            except TypeError:
                pass
    return os.path.exists(path)


def read_passes(path):
    """
    Each pass of the view layer in a multilayer EXR, by its name, as an array
    top row first: four channels for a picture, one for a value. The
    compositor's picture is left out.
    """
    found = {}
    image = oiio.ImageInput.open(path)
    if image is None:
        return found
    try:
        index = 0
        while image.seek_subimage(index, 0):
            spec = image.spec()
            names = list(spec.channelnames)
            layer, _, rest = names[0].partition(".")
            name = rest.rpartition(".")[0]
            if layer != "Composite" and name and name not in found:
                pixels = image.read_image(index, 0, 0, spec.nchannels, oiio.FLOAT)
                if pixels is not None:
                    found[name] = numpy.asarray(pixels).reshape(spec.height, spec.width, spec.nchannels)
            index += 1
    finally:
        image.close()
    return found


def passes_now(folder, name="passes"):
    """The passes of the render just drawn, read at once, or none."""
    path = os.path.join(folder, f"{name}.exr")
    return read_passes(path) if saved_passes(path) else {}


def light_file(passes, path):
    """
    Writes the light a render was made of, before any compositor, as a
    single-layer EXR that Blender reads as light; its path, or nothing.
    """
    light = passes.get(COMBINED)
    if light is None:
        return None
    rgba = light if light.shape[2] == 4 else numpy.dstack([light[..., :3], numpy.ones(light.shape[:2], dtype=numpy.float32)])
    spec = oiio.ImageSpec(rgba.shape[1], rgba.shape[0], 4, oiio.FLOAT)
    spec.channelnames = ("R", "G", "B", "A")
    out = oiio.ImageOutput.create(path)
    if out is None:
        return None
    try:
        out.open(path, spec)
        out.write_image(numpy.ascontiguousarray(rgba, dtype=numpy.float32))
    finally:
        out.close()
    return path if os.path.exists(path) else None


def luminance(rgb):
    return 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]
