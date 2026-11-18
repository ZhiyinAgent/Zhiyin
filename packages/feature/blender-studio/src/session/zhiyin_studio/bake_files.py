"""
Baked maps as files: each map's values made into a picture, a colour map in sRGB and a data map
as its plain values, 8 bits a channel, or 16 for a normal or a height map; what each holds said in
words, measured over the texels the layout covers; and the maps shown side by side on one sheet.
"""

import bpy
import numpy

from .pictures import saved_over
from .sheets import save_rgb, write_label
from .wording import hex_of, length

COLOUR, DATA, DEEP = "colour", "data", "deep"
# How each map is baked: from a value glowing, a Cycles bake of its own, or other maps; with its
# picture's kind and the samples each texel takes.
MAPS = {
    "color": ("glow", COLOUR, 4),
    "roughness": ("glow", DATA, 4),
    "metallic": ("glow", DATA, 4),
    "opacity": ("glow", DATA, 4),
    "emission": ("glow", COLOUR, 4),
    "normal": ("NORMAL", DEEP, 8),
    "ao": ("glow", DATA, 32),
    "curvature": ("glow", DATA, 32),
    "cavity": ("glow", DATA, 32),
    "thickness": ("glow", DATA, 32),
    "edge": ("glow", DATA, 32),
    "height": ("height", DEEP, 4),
    "orm": ("packed", DATA, 0),
}
# What a texel no face covers holds in each map.
NEUTRAL = {"normal": (0.5, 0.5, 1.0), "curvature": (0.5, 0.5, 0.5), "height": (0.5, 0.5, 0.5), "opacity": (1.0, 1.0, 1.0)}
# Each tile of the contact sheet, in pixels across.
TILE = 192
SHEET_COLUMNS = 4
MOST_TILES = 24


def srgb(linear):
    linear = numpy.clip(linear, 0.0, 1.0)
    return numpy.where(linear <= 0.0031308, linear * 12.92, 1.055 * numpy.power(linear, 1 / 2.4) - 0.055)


def picture_values(name, values, written):
    """A map's texels as the file holds them, 0 to 1 in RGB: values (N, 3), `written` where a bake wrote."""
    kind = MAPS[name][1]
    shown = srgb(values) if kind == COLOUR else numpy.clip(values, 0.0, 1.0)
    shown = shown.copy()
    shown[~written] = NEUTRAL.get(name, (0.0, 0.0, 0.0))
    return shown


def write_map(path, name, shown, size):
    """Writes a map's values as a PNG at `path`, replacing what is there whole."""
    deep = MAPS[name][1] == DEEP
    image = bpy.data.images.new("Zhiyin baked map", size, size, alpha=False, float_buffer=deep)
    try:
        # Its values are written as they are: a colour map's are already sRGB.
        image.colorspace_settings.name = "Non-Color"
        pixels = numpy.ones((size * size, 4), dtype=numpy.float32)
        pixels[:, :3] = shown
        image.pixels.foreach_set(pixels.ravel())
        image.file_format = "PNG"

        def save(where):
            image.filepath_raw = where
            image.save()

        saved_over(path, save)
    finally:
        bpy.data.images.remove(image)


def _scalar(values):
    return f"{values.min():.3g} to {values.max():.3g}, mean {values.mean():.3g}"


def _degrees(value):
    return "0" if value < 0.005 else f"{value:.2g}"


def range_words(name, values, covered, extra=None):
    """What a map holds over the texels its layout covers, in words."""
    if not covered.any():
        return "no texels covered"
    inside = values[covered]
    if name in ("color", "emission"):
        light = inside @ numpy.array([0.2126, 0.7152, 0.0722])
        if name == "emission" and light.max() <= 1e-4:
            return "black: nothing glows"
        said = f"{hex_of(inside[light.argmin()])} to {hex_of(inside[light.argmax()])}, mean {hex_of(inside.mean(axis=0))}"
        if light.max() > 1.0:
            said += ", glowing brighter than white, which the picture holds as white"
        return said
    if name == "normal":
        way = inside * 2 - 1
        tilt = numpy.degrees(numpy.arctan2(numpy.linalg.norm(way[:, :2], axis=1), way[:, 2]))
        return f"tilting {_degrees(float(tilt.mean()))}° on average from the surface, {_degrees(float(tilt.max()))}° at most"
    if name == "height":
        low, high = extra
        return f"{length(low)} to {length(high)} from the surface, black at {length(low)} and white at {length(high)}"
    if name == "orm":
        return "; ".join(f"{part} {_scalar(inside[:, i])}" for i, part in enumerate(("ao", "roughness", "metallic")))
    if name == "thickness":
        return _scalar(inside[:, 0]) + ", white where thin"
    return _scalar(inside[:, 0])


def contact_sheet(tiles, path):
    """The maps side by side, each labelled: `tiles` are (label, values (N, 3) as the file holds them, size)."""
    tiles = tiles[:MOST_TILES]
    columns = min(SHEET_COLUMNS, len(tiles))
    rows = (len(tiles) + columns - 1) // columns
    sheet = numpy.full((rows * TILE, columns * TILE, 3), 0.12, dtype=numpy.float32)
    for index, (label, values, size) in enumerate(tiles):
        picture = numpy.flipud(values.reshape(size, size, 3))
        pick = (numpy.arange(TILE) * size // TILE).clip(0, size - 1)
        tile = picture[pick][:, pick]
        top, left = (index // columns) * TILE, (index % columns) * TILE
        sheet[top : top + TILE, left : left + TILE] = tile
        write_label(sheet, label[:30], left + 4, top + 4, 1)
    save_rgb(sheet, path)
