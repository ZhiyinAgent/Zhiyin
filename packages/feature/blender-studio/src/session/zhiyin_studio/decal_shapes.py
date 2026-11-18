"""
The relief a normal decal draws by shading alone, made here as a height map of its own and never
downloaded: a vent's slots, a rivet's head, a screw's cross-recessed head, a grille's holes, a
hinge's knuckles or a panel seam, each drawn at its own proportions; or a workspace picture whose
brightness is the height. With the height goes how much each point lies below what is round it,
which darkens recesses as ambient light finds them less. Both are kept in one picture in the scene
file: the height in red, the light left in green.
"""

import bpy
import numpy

from .arguments import need, whole
from .decal_pictures import Shown, picture
from .wording import length

# Each shape: its width over its height, what it is called, how high it stands for its width by
# default (pressed in when negative), and how many of its parts it has by default.
SHAPES = {
    "vent": (2.0, "a vent of {count} slots", -0.04, 6),
    "rivet": (1.0, "a rivet head", 0.22, None),
    "screw": (1.0, "a cross-recessed screw head", 0.2, None),
    "grille": (1.0, "a grille of {count} × {count} holes", -0.03, 6),
    "hinge": (4.0, "a hinge of {count} knuckles", 0.12, 3),
    "seam": (10.0, "a panel seam", -0.02, None),
}
# The height map's longer side, in pixels.
PIXELS = 512
# How far round each point the recess is judged, as a share of the picture's shorter side, and how much
# of the light the deepest recess loses.
REACH = 0.06
DARKEST = 0.5


class Relief(Shown):
    """A normal decal's height map: the picture, its words, its proportions, its height range and how dark its recesses go."""

    def __init__(self, image, said, aspect, height, darkest):
        super().__init__(image, said, aspect, False)
        self.height, self.darkest = height, darkest


def grid(aspect):
    """The picture's points as (x, y) in widths, x across from -aspect/2 to aspect/2 and y from -0.5 to 0.5."""
    columns, rows = (PIXELS, max(16, round(PIXELS / aspect))) if aspect >= 1 else (max(16, round(PIXELS * aspect)), PIXELS)
    x = (numpy.arange(columns) + 0.5) / columns * aspect - aspect / 2
    y = (numpy.arange(rows) + 0.5) / rows - 0.5
    return numpy.meshgrid(x, y)


def smoothstep(edge0, edge1, value):
    t = numpy.clip((value - edge0) / (edge1 - edge0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def dome(r, radius, rise):
    """A spherical cap `rise` high on a circle of `radius`, nothing outside it."""
    sphere = (radius * radius + rise * rise) / (2 * rise)
    inside = r < radius
    h = numpy.zeros_like(r)
    h[inside] = numpy.sqrt(numpy.maximum(sphere * sphere - r[inside] ** 2, 0)) - (sphere - rise)
    # A little roll at the rim keeps the shading's slope from breaking there.
    return h * smoothstep(radius, radius * 0.94, r)


def slot(x, y, half_length, half_width, soft):
    """1 inside a slot with round ends, along x, falling to 0 over `soft` at its edge."""
    along = numpy.maximum(numpy.abs(x) - (half_length - half_width), 0)
    distance = numpy.sqrt(along * along + y * y)
    return smoothstep(half_width, half_width - soft, distance)


def heights(shape, count):
    """The shape's height at each point, 1 its highest part, pressed shapes from 0 down to -1."""
    aspect = SHAPES[shape][0]
    x, y = grid(aspect)
    r = numpy.sqrt(x * x + y * y)
    if shape == "rivet":
        return dome(r, 0.46, 1.0)
    if shape == "screw":
        head = dome(r, 0.46, 1.0)
        arm = 0.07
        cross = numpy.maximum(slot(x, y, 0.27, arm, 0.02), slot(y, x, 0.27, arm, 0.02))
        # The recess tapers to a point at its middle, as a cross-head bit's does.
        depth = 1.1 * (1 - numpy.minimum(r / 0.27, 1) * 0.6)
        return head - cross * depth
    if shape == "vent":
        pitch = (aspect - 0.2) / count
        h = numpy.zeros_like(x)
        for i in range(count):
            middle = -aspect / 2 + 0.1 + pitch * (i + 0.5)
            h = numpy.minimum(h, -slot(y, x - middle, 0.38, pitch * 0.3, 0.012))
        return h
    if shape == "grille":
        pitch = 0.9 / count
        h = numpy.zeros_like(x)
        for i in range(count):
            for j in range(count):
                cx, cy = -0.45 + pitch * (i + 0.5), -0.45 + pitch * (j + 0.5)
                d = numpy.sqrt((x - cx) ** 2 + (y - cy) ** 2)
                h = numpy.minimum(h, -smoothstep(pitch * 0.36, pitch * 0.3, d))
        return h
    if shape == "hinge":
        barrel = numpy.sqrt(numpy.maximum(0.36**2 - y * y, 0)) / 0.36
        span = aspect - 0.2
        knuckle = span / count
        gaps = numpy.zeros_like(x)
        for i in range(1, count):
            at = -span / 2 + knuckle * i
            gaps = numpy.maximum(gaps, smoothstep(0.03, 0.01, numpy.abs(x - at)))
        ends = smoothstep(span / 2, span / 2 - 0.03, numpy.abs(x))
        return barrel * ends * (1 - 0.8 * gaps)
    # A seam: a groove along its length, round at its floor and its two ends.
    return -slot(x, y, aspect / 2 - 0.15, 0.3, 0.25)


def recess_light(h):
    """How much light each point keeps, 1 in the open: less the more it lies below what is round it."""
    rows, columns = h.shape
    reach = max(2, round(min(rows, columns) * REACH))
    padded = numpy.pad(h, reach, mode="edge")
    summed = padded.cumsum(0).cumsum(1)
    summed = numpy.pad(summed, ((1, 0), (1, 0)))
    size = 2 * reach + 1
    around = (
        summed[size:, size:] - summed[:-size, size:] - summed[size:, :-size] + summed[:-size, :-size]
    ) / (size * size)
    below = numpy.clip((around[:rows, :columns] - h) * 2, 0, 1)
    return 1 - DARKEST * below


def kept(name, values):
    """A picture of its own, kept in the scene file, read as data: red the height, green the light left."""
    rows, columns = values[0].shape
    pixels = numpy.ones((rows, columns, 4), dtype=numpy.float32)
    pixels[:, :, 0], pixels[:, :, 1], pixels[:, :, 2] = values[0], values[1], values[0]
    old = bpy.data.images.get(name)
    if old is not None and old.users == 0:
        bpy.data.images.remove(old)
    image = bpy.data.images.new(name, columns, rows, alpha=False, float_buffer=True)
    image.colorspace_settings.name = "Non-Color"
    image.alpha_mode = "CHANNEL_PACKED"
    image.pixels.foreach_set(pixels.ravel())
    image.pack()
    return image


def shape_relief(shape, count, width, relief, name, room=1.0):
    """
    One of the library's shapes as a height map, `width` wide (across a strip, its height), standing
    `relief` metres (pressed in when negative); `room` times its own length, the rest flat either side.
    """
    aspect, words, standing, parts = SHAPES[shape]
    if parts is None:
        need(count is None, f"count is for a vent, a grille or a hinge, not a {shape}.")
    else:
        count = whole(count, "count", minimum=1, maximum=40, default=parts)
    h = heights(shape, count)
    if room > 1:
        side = round(h.shape[1] * (room - 1) / 2)
        h = numpy.pad(h, ((0, 0), (side, side)), mode="constant")
        aspect *= room
    rise = relief if relief is not None else standing * width
    need(rise != 0, "relief must not be 0: give how high the shape stands, or how deep it presses in when negative.")
    # A shape asked the other way from its own, as an embossed vent or a dimpled rivet, is turned over.
    if (rise > 0) != (standing > 0):
        h = -h
    light = recess_light(h)
    span = float(h.max() - h.min()) or 1.0
    image = kept(f"{name} relief", ((h - h.min()) / span, light))
    said = words.format(count=count)
    columns, rows = image.size
    return Relief(image, f"{said} drawn as a {columns} × {rows} px height map", aspect, rise, 1 - float(light.min()))


def groove_relief(relief, name):
    """
    A groove across a strip: level at its two edges, deepest along its middle, round at its floor;
    a raised bead when `relief` is above 0.
    """
    across = (numpy.arange(PIXELS // 2) + 0.5) / (PIXELS // 2) - 0.5
    depth = numpy.repeat((numpy.cos(numpy.pi * across) ** 2)[:, None], 4, axis=1)
    if relief > 0:
        image = kept(f"{name} relief", (depth, numpy.ones_like(depth)))
        return Relief(image, "a bead", 4 / (PIXELS // 2), relief, 0.0)
    image = kept(f"{name} relief", (1 - depth, 1 - DARKEST * depth))
    return Relief(image, "a groove", 4 / (PIXELS // 2), relief, DARKEST)


def picture_relief(path, relief):
    """A workspace picture whose brightness is the height, white the highest."""
    need(relief is not None, "relief is how high the picture's white stands, in metres, or how deep it presses in when negative.")
    need(relief != 0, "relief must not be 0: give how high the picture's white stands, or how deep it presses in when negative.")
    shown = picture(path)
    image = shown.image
    width, height = image.size
    pixels = numpy.empty(width * height * image.channels, dtype=numpy.float32)
    image.pixels.foreach_get(pixels)
    grey = pixels.reshape(height, width, image.channels)[:, :, : min(3, image.channels)].mean(axis=2)
    # Pressed in, white is the floor: the height runs the other way.
    grey = grey if relief > 0 else 1 - grey
    light = recess_light(grey)
    made = kept(f"{bpy.path.display_name_from_filepath(path)} relief", (grey, light))
    return Relief(made, f"{shown.said.split(' (')[0]} as a {width} × {height} px height map", shown.aspect, relief, 1 - float(light.min()))


def relief_words(relief):
    """How a normal decal stands: 2 mm raised, pressed 0.5 mm in, its recesses darkened by up to 35%."""
    stands = f"standing {length(relief.height)}" if relief.height > 0 else f"pressed {length(-relief.height)} in"
    dark = round(relief.darkest * 100)
    return stands + (f", its recesses darkened by up to {dark}%" if dark >= 1 else "")
