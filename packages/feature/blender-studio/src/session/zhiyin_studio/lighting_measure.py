"""
Small Cycles pictures through the scene's camera that measure what lighting does: how bright
each object the camera sees comes out, as light before the tone and exposure, with one part of
the lighting and without it, and how long a picture takes. Every setting they change is put
back, and the scene renders on the processor for them, the same on every PC.
"""

import math
import os
import shutil
import tempfile
import time

import bpy
import numpy

from . import budget
from .finding import scene, subjects
from .graphics_card import card_free
from .pictures import Kept
from .render_checks import light_of
from .seen import DRAWN, SMALLEST, drawing, flat_colour, read, setting_aside

# Longest side of the pictures, in pixels, and their samples: few, as a quick look takes.
SIDE = 96
SAMPLES = 16
# Past this many seconds for one picture, or half of what is left of the call's time, the rest are not made.
SLOW = 20
# Light darker than this, as a share of white, is too dim to weigh a change against.
DIM = 0.005


def luminance(rgb):
    return 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]


class Measures:
    """Small Cycles pictures of the scene, its settings put back on leaving."""

    EXTRA = (
        ("render", "use_compositing"),
        ("render", "use_sequencer"),
        ("cycles", "seed"),
        ("cycles", "use_animated_seed"),
        ("cycles", "use_adaptive_sampling"),
    )

    def __init__(self, side=SIDE):
        self.side = side
        self.folder = None
        self.slowest = 0.0

    def __enter__(self):
        s = scene()
        self.kept = Kept()
        self.extra = [(owner, field, getattr(getattr(s, owner), field)) for owner, field in self.EXTRA]
        self.folder = tempfile.mkdtemp(prefix="zhiyin-light-")
        s.render.engine = "CYCLES"
        s.cycles.device = "CPU"
        longest = max(s.render.resolution_x, s.render.resolution_y)
        s.render.resolution_x = max(8, round(s.render.resolution_x * self.side / longest))
        s.render.resolution_y = max(8, round(s.render.resolution_y * self.side / longest))
        s.render.resolution_percentage = 100
        s.render.film_transparent = False
        s.render.use_compositing = False
        s.render.use_sequencer = False
        s.cycles.samples = SAMPLES
        s.cycles.use_denoising = False
        # A measuring picture samples for at most as long as one may take, so a heavy scene keeps the call in its time.
        s.cycles.time_limit = max(1.0, budget.share(SLOW))
        s.cycles.use_adaptive_sampling = False
        s.cycles.use_animated_seed = False
        s.cycles.seed = 0
        return self

    def __exit__(self, *_):
        s = scene()
        self.kept.restore()
        for owner, field, value in self.extra:
            setattr(getattr(s, owner), field, value)
        shutil.rmtree(self.folder, ignore_errors=True)

    @property
    def size(self):
        return f"{scene().render.resolution_x}×{scene().render.resolution_y}"

    def too_slow(self):
        """Whether another picture as slow as the slowest would take more than its share of the call's time."""
        return self.slowest > budget.share(SLOW)

    def picture(self, seed=0):
        """The picture's light at each pixel, bottom row first, and the seconds it took."""
        s = scene()
        s.cycles.seed = seed
        started = time.time()
        with card_free():
            bpy.ops.render.render()
        seconds = time.time() - started
        self.slowest = max(self.slowest, seconds)
        path = light_of(os.path.join(self.folder, f"light-{time.time_ns()}.exr"))
        if path is None:
            return None, seconds
        return luminance(read(path, s.render.resolution_x, s.render.resolution_y, 1)), seconds

    def owners(self, objects):
        """Which of the objects the camera sees at each pixel, by its number from 1; 0 where none is."""
        s = scene()
        put_back = setting_aside(s, objects)
        try:
            for number, obj in enumerate(objects, start=1):
                obj.color = flat_colour(number)
            return drawing(os.path.join(self.folder, "owners.png"))
        finally:
            put_back()


def shown(also=()):
    """What the camera sees, drawn shapes only, with `also` though it be in the lighting."""
    found = [o for o in subjects() if o.type in DRAWN and o.visible_camera]
    found += [o for o in also if o not in found and o.type in DRAWN and o.visible_camera and not o.hide_render]
    return found[:254]


def means(light, owner, objects):
    """Each object's mean light where the camera sees it, for those it sees enough of to read."""
    found = {}
    for number, obj in enumerate(objects, start=1):
        where = owner == number
        if where.mean() >= SMALLEST:
            found[obj.name] = float(light[where].mean())
    return found


def change(after, before):
    """How much brighter, as a share, light is after than before; weighed against dim light as against `DIM`."""
    return (after - before) / max(before, DIM)


def noise(first, second, where):
    """Noise between two pictures with other seeds, where a mask says, as a share of the brightness there."""
    bright = numpy.maximum((first[where] + second[where]) / 2, DIM)
    difference = numpy.abs(first[where] - second[where]) / math.sqrt(2) / bright
    return float(numpy.sqrt(numpy.mean(difference**2)))


def no_camera():
    """Why nothing is measured, when the scene has no camera; or nothing."""
    return "" if scene().camera is not None else "There is no camera to measure it through: blender_set_camera places one."
