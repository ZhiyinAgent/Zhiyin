"""
Pictures put together into a sheet: times written on them, their pixels read and saved, and the
side from which named objects are seen best.
"""

import math

import bpy
import numpy

from .describe import shapes_in_scene, share_seen, surface_points
from .preview import overview_camera
from .timeline import go_to

# The most objects a frame sheet follows by name, and the most a video lasts.
MOST_FOLLOWED = 8


# Five by seven glyphs for the times written on each frame.
GLYPHS = {
    "0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
    "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
    "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
    "3": ["#####", "...#.", "..#..", "...#.", "....#", "#...#", ".###."],
    "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
    "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
    "6": ["..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###."],
    "7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
    "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
    "9": [".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."],
    ".": [".....", ".....", ".....", ".....", ".....", ".##..", ".##.."],
    "s": [".....", ".....", ".####", "#....", ".###.", "....#", "####."],
    " ": [".....", ".....", ".....", ".....", ".....", ".....", "....."],
    # Letters, written in capitals, for names and sides.
    "A": [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
    "B": ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
    "C": [".###.", "#...#", "#....", "#....", "#....", "#...#", ".###."],
    "D": ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
    "E": ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
    "F": ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
    "G": [".###.", "#...#", "#....", "#.###", "#...#", "#...#", ".####"],
    "H": ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
    "I": [".###.", "..#..", "..#..", "..#..", "..#..", "..#..", ".###."],
    "J": ["..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."],
    "K": ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
    "L": ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
    "M": ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
    "N": ["#...#", "#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#"],
    "O": [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
    "P": ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
    "Q": [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
    "R": ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
    "S": [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
    "T": ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
    "U": ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
    "V": ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
    "W": ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "#.#.#", ".#.#."],
    "X": ["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"],
    "Y": ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
    "Z": ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
    ",": [".....", ".....", ".....", ".....", ".##..", "..#..", ".#..."],
    "-": [".....", ".....", ".....", "#####", ".....", ".....", "....."],
    "_": [".....", ".....", ".....", ".....", ".....", ".....", "#####"],
    "·": [".....", ".....", ".....", "..#..", ".....", ".....", "....."],
    "°": [".##..", "#..#.", ".##..", ".....", ".....", ".....", "....."],
    "/": ["....#", "....#", "...#.", "..#..", ".#...", "#....", "#...."],
    "(": ["...#.", "..#..", ".#...", ".#...", ".#...", "..#..", "...#."],
    ")": [".#...", "..#..", "...#.", "...#.", "...#.", "..#..", ".#..."],
    "%": ["##..#", "##..#", "...#.", "..#..", ".#...", "#..##", "#..##"],
}


def write_label(rgb, text, x, y, scale):
    """Writes `text` in white on a dark band at x, y of an image held top row first."""
    width = len(text) * 6 * scale + 2 * scale
    height = 9 * scale
    rgb[y : y + height, x : x + width] *= 0.35
    for index, character in enumerate(text):
        glyph = GLYPHS.get(character) or GLYPHS.get(character.upper(), GLYPHS[" "])
        for row, line in enumerate(glyph):
            for column, mark in enumerate(line):
                if mark == "#":
                    top = y + scale + row * scale
                    left = x + scale + (index * 6 + column) * scale
                    rgb[top : top + scale, left : left + scale] = 1


def read_rgb(path):
    """A picture's pixels as display colours, top row first."""
    image = bpy.data.images.load(path, check_existing=False)
    try:
        width, height = image.size
        pixels = numpy.empty(width * height * 4, dtype=numpy.float32)
        image.pixels.foreach_get(pixels)
        return numpy.flipud(pixels.reshape(height, width, 4)[:, :, :3]).copy()
    finally:
        bpy.data.images.remove(image)


def save_rgb(rgb, path):
    height, width = rgb.shape[:2]
    image = bpy.data.images.new("Zhiyin sheet", width, height, alpha=False)
    try:
        pixels = numpy.ones((height, width, 4), dtype=numpy.float32)
        pixels[:, :, :3] = numpy.flipud(rgb)
        # Display colours, as the frames were read back: a new picture keeps
        # them as they are when it is saved.
        image.pixels.foreach_set(pixels.ravel())
        image.file_format = "JPEG"
        image.save(filepath=path, quality=88)
    finally:
        bpy.data.images.remove(image)


# The turns round the objects, and the rises above the overview's own, a sheet
# of named objects is tried from: the first that shows them most is used.
SIDES_TRIED = [(turn, rise) for rise in (0, 30) for turn in range(0, 360, 45)]
# How much more of the named objects a side must show to be chosen over one
# tried before it, so the overview's own side is kept unless another is better.
CLEARER = 0.02


def clearest_side(followed, framed, at, aspect):
    """
    The side of the named objects, round them and above them, from which the
    rest of the scene covers the least of them at a moment, as the turn and the
    rise the overview takes, with what it shows of them and which it misses.
    """
    go_to(at)
    everything, owners = shapes_in_scene()
    surfaces = surface_points(followed)
    best = None
    for turn, rise in SIDES_TRIED:
        camera = overview_camera({"fit": framed, "yaw": turn, "pitch": rise}, aspect)
        try:
            bpy.context.view_layer.update()
            share, unseen = share_seen(camera, surfaces, everything, owners)
        finally:
            data = camera.data
            bpy.data.objects.remove(camera)
            bpy.data.cameras.remove(data)
        if best is None or share > best[2] + CLEARER:
            best = (turn, rise, share, unseen)
    return best


def side_text(turn, rise):
    """Where a sheet of named objects looks from, as the overview turned and raised by so much."""
    yaw, pitch = math.radians(-45 + turn), math.radians(25 + rise)
    across = math.degrees(math.atan2(math.cos(yaw), -math.sin(yaw)))
    sides = ("front", "front-right", "right", "back-right", "back", "back-left", "left", "front-left")
    return f"from the {sides[round(across / 45) % 8]}, {math.degrees(pitch):g}° above level"
