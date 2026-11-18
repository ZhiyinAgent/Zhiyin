"""
What a decal shows: a picture from the workspace, read for its size and whether any of it is
transparent, or text drawn as a picture of its own, white letters on nothing, kept in the scene
file, whose transparency is the letters' shape.
"""

import os

import bpy
import numpy

from .arguments import need
from .errors import Refused
from .making import system_cjk_font
from .material_pictures import alpha_kept_apart

# Text is drawn this many pixels along its longer side, each pixel from 3 × 3 samples.
TEXT_PIXELS = 1024
SAMPLES = 3
# Room left round the letters, as a share of their height, so none touches the picture's edge.
ROOM = 0.04


class Shown:
    """A decal's picture: the image, its name in answers, its width over its height, and whether any of it is transparent."""

    def __init__(self, image, said, aspect, clear):
        self.image, self.said, self.aspect, self.clear = image, said, aspect, clear


def picture(path):
    """A workspace picture, kept in the scene by its path."""
    image = bpy.data.images.load(path, check_existing=True)
    image.filepath = bpy.path.relpath(path) if bpy.data.filepath else path
    alpha_kept_apart(image)
    width, height = image.size
    name = os.path.basename(path)
    need(width > 0 and height > 0, f"{name} could not be read as a picture.")
    clear = False
    if image.channels == 4:
        pixels = numpy.empty(width * height * 4, dtype=numpy.float32)
        image.pixels.foreach_get(pixels)
        clear = bool(pixels[3::4].min() < 0.99)
    return Shown(image, f"{name} ({width} × {height} px)", width / height, clear)


def letter_triangles(body, font):
    """The triangles of text's letters, in the text's own units, from Blender's own lettering."""
    curve = bpy.data.curves.new("Zhiyin decal text", "FONT")
    curve.body = body
    curve.align_x = "CENTER"
    curve.align_y = "CENTER"
    font = font or (system_cjk_font() if any(ord(c) >= 0x2E80 for c in body) else None)
    if font:
        curve.font = bpy.data.fonts.load(font, check_existing=True)
    obj = bpy.data.objects.new("Zhiyin decal text", curve)
    bpy.context.scene.collection.objects.link(obj)
    try:
        evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
        mesh = evaluated.to_mesh()
        mesh.calc_loop_triangles()
        triangles = [[tuple(mesh.vertices[i].co[:2]) for i in t.vertices] for t in mesh.loop_triangles]
        evaluated.to_mesh_clear()
    finally:
        bpy.data.objects.remove(obj)
        bpy.data.curves.remove(curve)
    return triangles


def text_picture(body, font, name):
    """Text drawn as a picture of its own, its letters white and everything else transparent."""
    need(isinstance(body, str) and body.strip(), "text is the words the decal shows.")
    triangles = letter_triangles(body, font)
    if not triangles:
        raise Refused(f"“{body}” draws no letters in its font: give a font that has them.")
    xs = [p[0] for t in triangles for p in t]
    ys = [p[1] for t in triangles for p in t]
    room = (max(ys) - min(ys)) * ROOM
    x0, y0 = min(xs) - room, min(ys) - room
    across, high = max(xs) + room - x0, max(ys) + room - y0
    if across >= high:
        width, height = TEXT_PIXELS, max(1, round(TEXT_PIXELS * high / across))
    else:
        width, height = max(1, round(TEXT_PIXELS * across / high)), TEXT_PIXELS
    inside = numpy.zeros((height * SAMPLES, width * SAMPLES), dtype=bool)
    scale_x, scale_y = width * SAMPLES / across, height * SAMPLES / high
    for triangle in triangles:
        corners = [((x - x0) * scale_x, (y - y0) * scale_y) for x, y in triangle]
        fill(inside, corners)
    alpha = inside.reshape(height, SAMPLES, width, SAMPLES).mean(axis=(1, 3))
    pixels = numpy.ones((height, width, 4), dtype=numpy.float32)
    pixels[:, :, 3] = alpha
    image = bpy.data.images.new(name, width, height, alpha=True)
    image.pixels.foreach_set(pixels.ravel())
    image.pack()
    return Shown(image, f"text “{body}” drawn as a {width} × {height} px picture", across / high, True)


def fill(inside, corners):
    """Marks the samples whose middles lie in a triangle."""
    (ax, ay), (bx, by), (cx, cy) = corners
    rows, columns = inside.shape
    left, right = max(0, int(min(ax, bx, cx))), min(columns, int(max(ax, bx, cx)) + 1)
    bottom, top = max(0, int(min(ay, by, cy))), min(rows, int(max(ay, by, cy)) + 1)
    if left >= right or bottom >= top:
        return
    x, y = numpy.meshgrid(numpy.arange(left, right) + 0.5, numpy.arange(bottom, top) + 0.5)
    one = (bx - ax) * (y - ay) - (by - ay) * (x - ax)
    two = (cx - bx) * (y - by) - (cy - by) * (x - bx)
    three = (ax - cx) * (y - cy) - (ay - cy) * (x - cx)
    within = ((one >= 0) & (two >= 0) & (three >= 0)) | ((one <= 0) & (two <= 0) & (three <= 0))
    inside[bottom:top, left:right] |= within
