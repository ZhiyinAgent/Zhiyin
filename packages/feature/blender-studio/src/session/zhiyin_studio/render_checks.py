"""
What a render's own picture says of how it was made: light clipped to white and crushed to black,
where the middle of its light lies against middle grey and how far its light spreads, where the
subject sits in the frame, how long a large picture will take before it is made, and how much
memory it took.
"""

import math
import os
import re
import shutil
import tempfile
import time

import bpy
import numpy

from .arguments import need
from .finding import scene
from .pictures import write_picture

# A channel at or above this, of 1, is clipped to white; every channel at or below it, crushed to black.
CLIPPED, CRUSHED = 254.5 / 255, 3 / 255
# Shares of the picture past which each is said to lose detail.
CLIPPED_LIMIT, CRUSHED_LIMIT = 0.01, 0.05
# Middle grey, as light, and how far over it a white surface lit to show white lies, in stops:
# the middle of a picture's light is said against both, since a picture of white things rightly lies near the second.
MIDDLE_GREY = 0.18
WHITE_OVER_GREY = math.log2(0.85 / MIDDLE_GREY)
# How many names are given for where something is.
NAMED = 3
# A picture this large, in pixels times samples, has its time estimated before it is made.
LARGE = 1920 * 1080 * 128
# How much of a call's time a picture estimated to take longer than is refused. Measured, the
# estimate of a picture of 20 s or more came up to 7% under the time it took, so this leaves twice that.
WITHIN = 0.85
# A Cycles picture made in this many seconds or fewer has its noise measured unasked.
CHEAP = 20


def luminance(rgb):
    return 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]


def load(path):
    """A picture's pixels as RGBA, top row first: display values for a PNG or JPEG, light for an EXR."""
    image = bpy.data.images.load(path, check_existing=False)
    try:
        width, height = image.size
        pixels = numpy.empty(width * height * 4, dtype=numpy.float32)
        image.pixels.foreach_get(pixels)
    finally:
        bpy.data.images.remove(image)
    return numpy.flipud(pixels.reshape(height, width, 4))


def light_of(path):
    """
    The picture just rendered as light, before the tone and exposure, in a
    file; or nothing when there is none. Read before anything else renders.
    """
    result = bpy.data.images.get("Render Result")
    if result is None:
        return None
    settings = scene().render.image_settings
    before = (settings.file_format, settings.color_mode, settings.color_depth)
    try:
        settings.file_format, settings.color_mode, settings.color_depth = "OPEN_EXR", "RGB", "32"
        result.save_render(path, scene=scene())
    except RuntimeError:
        return None
    finally:
        settings.file_format, settings.color_mode, settings.color_depth = before
    return path if os.path.exists(path) else None


def owners_of(found):
    """
    Which object is where in the picture, by its number in the objects that
    come with it: top row first, as the picture is read here, though the
    drawing that tells them is read bottom row first.
    """
    owner = found.get("owner")
    return (numpy.flipud(owner) if owner is not None else None), found.get("objects") or []


def names_over(mask, owner, objects):
    """The objects most of a mask lies on, by the drawing that tells which object is where."""
    if owner is None or not mask.any():
        return []
    height, width = owner.shape
    ys = (numpy.arange(height) * mask.shape[0] / height).astype(int)
    xs = (numpy.arange(width) * mask.shape[1] / width).astype(int)
    under = owner[mask[ys][:, xs]]
    counted = numpy.bincount(under[(under > 0) & (under <= len(objects))], minlength=len(objects) + 1)
    found = [objects[n - 1].name for n in numpy.argsort(-counted) if n > 0 and counted[n] > 0][:NAMED]
    if (under == 0).mean() > 0.5:
        found = ["the background", *found][:NAMED]
    return found


class PictureChecks:
    """The checks read from a picture just written, before the colours are read from drawings that take its place."""

    def __init__(self, output, transparent, light=None):
        """`light` is the picture's light before any compositor, as a file, or nothing."""
        rgba = load(output)
        self.shown = rgba[..., :3]
        self.within = rgba[..., 3] > 0.5 if transparent else numpy.ones(self.shown.shape[:2], dtype=bool)
        self.light = luminance(load(light)[..., :3]) * 2 ** scene().view_settings.exposure if light else None

    def text(self, found):
        """The light of the picture, and where the subject sits in it, as lines."""
        owner, objects = owners_of(found)
        within = self.within
        if not within.any():
            return ""
        clipped = (self.shown >= CLIPPED).any(axis=-1) & within
        crushed = (self.shown <= CRUSHED).all(axis=-1) & within
        said = []
        for mask, words, limit, too in (
            (clipped, "clipped to white", CLIPPED_LIMIT, "loses its highlights"),
            (crushed, "crushed to black", CRUSHED_LIMIT, "loses its shadows"),
        ):
            part = mask.sum() / within.sum()
            line = f"{part * 100:.2g}% of the picture {words}"
            if part > limit:
                where = names_over(mask, owner, objects)
                line += f", over the {limit * 100:g}% past which a picture {too}" + (f": mostly {', '.join(where)}" if where else "")
            said.append(line)
        if self.light is not None and self.light.shape == within.shape:
            lit = numpy.maximum(self.light[within], 1e-6)
            middle = math.log2(float(numpy.median(lit)) / MIDDLE_GREY)
            spread = math.log2(float(numpy.percentile(lit, 95)) / float(numpy.percentile(lit, 5)))
            said.append(
                f"the middle of its light {abs(middle):.1f} stops {'over' if middle > 0 else 'under'} middle grey,"
                f" where a white surface lit to show white is about {WHITE_OVER_GREY:.1f} over"
            )
            said.append(f"{spread:.1f} stops from its darkest twentieth to its brightest")
        text = "Light: " + "; ".join(said) + "."
        framing = framed_text(owner, objects)
        return text + (f"\n{framing}" if framing else "")


def framed_text(owner, objects):
    """Where the subject sits in the picture: how much of it, its middle, the space above it and the edges it meets; and the camera's tilt."""
    if owner is None:
        return ""
    height, width = owner.shape
    # What spans the whole picture, as a floor or a wall does, is where the subject stands, not the subject.
    spanning = set()
    for number in numpy.unique(owner):
        if number == 0:
            continue
        rows, columns = numpy.nonzero(owner == number)
        if columns.min() == 0 and columns.max() == width - 1 or rows.min() == 0 and rows.max() == height - 1:
            spanning.add(int(number))
    subject = (owner > 0) & ~numpy.isin(owner, list(spanning))
    said = []
    if subject.any():
        rows, columns = numpy.nonzero(subject)
        edges = [name for name, touches in (
            ("top", rows.min() == 0),
            ("bottom", rows.max() == height - 1),
            ("left", columns.min() == 0),
            ("right", columns.max() == width - 1),
        ) if touches]
        said.append(
            f"The subject covers {subject.mean() * 100:.2g}% of the picture, its middle {columns.mean() / width * 100:.0f}% across"
            f" and {rows.mean() / height * 100:.0f}% down, with {rows.min() / height * 100:.0f}% of the height above it"
            + (f"; it meets the {' and '.join(edges)} {'edge' if len(edges) == 1 else 'edges'}" if edges else "")
        )
    camera = scene().camera
    if camera is not None:
        across = camera.matrix_world.to_3x3().col[0]
        tilt = math.degrees(math.atan2(across.z, math.hypot(across.x, across.y)))
        if abs(tilt) >= 0.5:
            said.append(f"the camera is tilted {abs(tilt):.1f}° off level")
    return ("; ".join(said) + ".") if said else ""


class MemoryWatch:
    """The most memory a render reports while it draws, from Blender's own render statistics."""

    def __init__(self):
        self.most = 0.0

    def __call__(self, *stats):
        for line in stats:
            for amount, unit in re.findall(r"(?:Mem|Peak):\s*([\d.]+)\s*([KMG])", str(line or "")):
                self.most = max(self.most, float(amount) * {"K": 1e-3, "M": 1, "G": 1e3}[unit])

    def __enter__(self):
        bpy.app.handlers.render_stats.append(self)
        return self

    def __exit__(self, *_):
        if self in bpy.app.handlers.render_stats:
            bpy.app.handlers.render_stats.remove(self)

    def text(self):
        if not self.most:
            return ""
        return f" It took {self.most / 1000:.2g} GB of memory at most." if self.most >= 1000 else f" It took {self.most:.0f} MB of memory at most."


def timed(scale, folder, name):
    """How long the scene takes to render at a share of its size, each side."""
    s = scene()
    kept = s.render.resolution_percentage
    try:
        s.render.resolution_percentage = max(1, round(100 * scale))
        started = time.time()
        write_picture(os.path.join(folder, name), "PNG")
        return time.time() - started
    finally:
        s.render.resolution_percentage = kept


def minutes_text(seconds):
    return f"{seconds:.0f} s" if seconds < 90 else f"{seconds / 60:.1f} min"


def estimated(limit, samples, started, noise=False):
    """
    How long a large Cycles picture will take, from two small ones timed: an
    eighth and a quarter of its size each side, after a sixteenth drawn first
    and not timed, which readies what they all draw with (the device's
    programs, the scene's shapes and textures, the denoiser), so that time is
    not taken for the picture's own. A picture that, with the time the call
    has taken since `started` and the two pictures its noise is measured from
    when that is asked, would run past most of the call's time is refused
    before it is made, saying the numbers and what to lower. Nothing is said
    of a small picture.
    """
    s = scene()
    pixels = s.render.resolution_x * s.render.resolution_y
    if pixels * samples < LARGE:
        return None
    folder = tempfile.mkdtemp(prefix="zhiyin-estimate-")
    try:
        timed(1 / 16, folder, "ready.png")
        small, larger = timed(1 / 8, folder, "a.png"), timed(1 / 4, folder, "b.png")
    finally:
        shutil.rmtree(folder, ignore_errors=True)
    each = max(larger - small, 0) / (1 / 16 - 1 / 64)
    fixed = max(small - each / 64, 0)
    whole = fixed + each
    # The noise is measured from two pictures at half the size each side.
    after = 2 * (fixed + each / 4) if noise else 0
    spent = time.time() - started
    if not limit:
        return whole
    need(
        spent + whole + after <= limit * WITHIN,
        f"This picture would take about {minutes_text(whole)}, at {s.render.resolution_x}×{s.render.resolution_y} and {samples} samples,"
        " timed from two smaller ones"
        + (f", and measuring its noise about {minutes_text(after)} more" if after else "")
        + f": with the {minutes_text(spent)} this call has already taken, past the {minutes_text(limit)} a render may run."
        " Lower the samples or the size, or render a part of the scene.",
    )
    return whole

