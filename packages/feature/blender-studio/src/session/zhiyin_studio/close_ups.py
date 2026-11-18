"""
Objects looked at closely, the way a picture of the whole hides: each framed
on itself and a margin round it, where it meets what it joins, from the side
the rest of the scene covers least and from the side opposite, side by side
on one sheet with their names; and each object's line, with what is unsound
about it, what it goes into and where a tube ends on nothing. It changes
nothing.
"""

import os
import shutil
import tempfile
import time

import mathutils
import numpy

from . import budget
from .arguments import need, whole
from .finding import find_objects, scene, subjects
from .geometry import world_corners
from .main_objects import main_objects
from .preview import preview
from .sheets import MOST_FOLLOWED, clearest_side, read_rgb, save_rgb, side_text, write_label
from .sim_state import reached_text
from .timeline import back_to, frame_of, go_to, moment, now, seconds_of, seconds_text

# How far round each object a close-up reaches, as a share of the object's own size.
MARGIN = 0.18
# A tile's width at least, by default and at most, in pixels; tiles are 4:3.
NARROWEST, TILE, WIDEST = 160, 480, 800


def grown(corners, share):
    low = mathutils.Vector([min(c[i] for c in corners) for i in range(3)])
    high = mathutils.Vector([max(c[i] for c in corners) for i in range(3)])
    reach = (high - low).length * share
    pad = mathutils.Vector((reach, reach, reach))
    low, high = low - pad, high + pad
    return [mathutils.Vector((x, y, z)) for x in (low.x, high.x) for y in (low.y, high.y) for z in (low.z, high.z)]


def close_ups(args, scene_file, device):
    from .describe import LOOSE_SECONDS, SOUND_SECONDS, object_line
    from .loose import Checker
    from .soundness import Sound

    s = scene()
    names = args.get("objects")
    if args.get("main") is not None:
        need(names is None, "Give objects or main, not both.")
        objects = main_objects(whole(args["main"], "main", minimum=1, maximum=MOST_FOLLOWED))
        need(objects, "The scene has nothing to look at closely.")
    else:
        need(isinstance(names, list) and names and all(isinstance(n, str) for n in names), "objects names the objects to look at.")
        objects = find_objects(names)
    need(len(objects) <= MOST_FOLLOWED, f"Close-ups are of at most {MOST_FOLLOWED} objects at once; {len(objects)} were named.")
    width = whole(args.get("tile_width"), "tile_width", minimum=NARROWEST, maximum=WIDEST, default=TILE)
    height = round(width * 3 / 4)
    # The moment asked for, exactly, or where the scene is.
    at = moment(args["time"], "time") if args.get("time") is not None else None
    kept = now()
    folder = tempfile.mkdtemp(prefix="zhiyin-close-ups-")
    started = time.time()
    lines = []
    try:
        if at is not None:
            go_to(at)
        seconds = at if at is not None else seconds_of(s.frame_current + s.frame_subframe)
        sheet = numpy.full((len(objects) * height + (len(objects) - 1) * 4, 2 * width + 4, 3), 0.92, dtype=numpy.float32)
        for row, obj in enumerate(objects):
            corners = world_corners([obj])
            need(corners, f"“{obj.name}” has no shape to look at.")
            fit = grown(corners, MARGIN)
            best = clearest_side([obj], fit, seconds, 4 / 3)
            turn, rise = (best[0], best[1]) if best else (0, 0)
            for column, (yaw, pitch) in enumerate(((turn, rise), (turn + 180, rise))):
                path = os.path.join(folder, f"{row}-{column}.jpg")
                preview({"width": width, "height": height, "view": "overview", "fit": fit, "yaw": yaw, "pitch": pitch}, path, device)
                rgb = read_rgb(path)
                if rgb.shape[0] != height or rgb.shape[1] != width:
                    ys = (numpy.arange(height) * rgb.shape[0] / height).astype(int)
                    xs = (numpy.arange(width) * rgb.shape[1] / width).astype(int)
                    rgb = rgb[ys][:, xs]
                write_label(rgb, f"{obj.name}, {side_text(yaw, pitch)}".upper(), 4, 4, 2 if width >= 320 else 1)
                top, left = row * (height + 4), column * (width + 4)
                sheet[top : top + height, left : left + width] = rgb
        save_rgb(sheet, args["picture"])
        others = subjects()
        loose, sound = Checker(others, budget.share(LOOSE_SECONDS)), Sound(budget.share(SOUND_SECONDS))
        lines = [object_line(obj, others, loose, sound) for obj in objects]
    finally:
        back_to(kept)
        shutil.rmtree(folder, ignore_errors=True)
    took = time.time() - started
    when = f" at {seconds_text(seconds)} of the animation" if at is not None else ""
    if at is not None:
        reached = reached_text(frame_of(at), frame_of(at))
        lines += [reached] if reached else []
    return (
        f"Close-ups of {len(objects)} {'object' if len(objects) == 1 else 'objects'}{when}, drawn in {took:.1f} s: each on a row, "
        "framed on itself and a margin round it, from the side the rest of the scene covers least, then from the side opposite, "
        "each labelled with its name and side. Look at each where it meets what it joins: a gap, a part sunk in, a torn edge "
        "or a tube that ends in the air shows here before the picture of the whole.\n" + "\n".join(lines)
    )
