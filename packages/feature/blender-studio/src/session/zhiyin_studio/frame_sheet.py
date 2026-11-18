"""
blender_frame_sheet: the motion as a sheet of frames at the times asked, each labelled with its
time, with where the named objects are and what moving parts go into at each. A mesh whose shape
changes, by bones, shape keys or a simulation, moves by its shape, and is followed as a moving
part is. Without pictures it is a report in
numbers of every frame from a start to an end, however many, until most of the call's time is
spent. Either says how each simulation was reached: read from its bake, or stepped from its start.
"""

import math
import os
import shutil
import tempfile
import time

import bpy
import numpy

from .arguments import need, number, whole
from .errors import keep_error
from .finding import find_objects, scene, subjects
from .geometry import Lasting, held_still, own_size, world_corners
from .keys import curves_of
from .motion_checks import overlap_text, scan
from .moving import animated, standing, unchanging
from .placing import placed
from .preview import preview
from .sheets import MOST_FOLLOWED, clearest_side, read_rgb, save_rgb, side_text, write_label
from .sim_state import reached_text
from .timeline import LONGEST, START, back_to, go_to, moment, now, seconds_of, seconds_text, timeline_text
from .wording import listed, point_text

# A frame sheet's limits: how many frames, how wide each, how wide the sheet.
MOST_FRAMES = 36
FRAME_WIDTHS = (160, 640)
# How many frames, and how wide each, when the call does not say.
FRAMES, FRAME_WIDTH = 12, 320
SHEET_WIDEST = 2560
# The share of the call's time limit a scan of every frame may spend.
SCAN_SHARE = 0.8


# The most moving objects a frame sheet checks for what they go into.
MOST_CHECKED = 60


def standing_of(obj):
    location = obj.matrix_world.translation
    turned = [round(math.degrees(a), 1) + 0.0 for a in obj.matrix_world.to_euler("XYZ")]
    said = f"at {point_text(location)}"
    if any(turned):
        said += ", turned (" + ", ".join(f"{a:g}°" for a in turned) + ")"
    if obj.hide_render:
        said += ", hidden"
    return said


def allowed_contacts(given):
    """The pairs of parts the call allows to touch, each side the names it stands for."""
    if given is None:
        return []
    need(
        isinstance(given, list)
        and all(isinstance(pair, list) and len(pair) == 2 and all(isinstance(n, str) for n in pair) for pair in given),
        "allowed lists pairs of names, such as [[\"Gear_A\", \"Gear_B\"]].",
    )
    return [tuple({o.name for o in find_objects([name])} for name in pair) for pair in given]


def scan_budget(args, started):
    """The seconds a scan may still take: most of the call's time limit, less what the call took already."""
    limit = args.get("limit_seconds")
    return None if not limit else max(0.0, limit * SCAN_SHARE - (time.time() - started))


def frame_sheet(args, scene_file, device):
    """
    Frames from a start time, every so many milliseconds, side by side with
    their times, and where each moving object is at each: for checking a
    motion, which a model cannot watch. Without pictures, a report in
    numbers of every frame from a start to an end.
    """
    if args.get("pictures") is False:
        return motion_report(args)
    need(args.get("end") is None, "end is for a report without pictures; frames reach from start, every every_ms.")
    s = scene()
    need(
        s.camera is not None or args.get("view") in ("overview", "objects"),
        "The scene has no camera. Set one with blender_set_camera, or ask for view overview.",
    )
    start = moment(args.get("start"), "start", default=START)
    every = number(args.get("every_ms"), "every_ms", minimum=1, maximum=LONGEST * 1000)
    count = whole(args.get("count"), "count", minimum=1, maximum=MOST_FRAMES, default=FRAMES)
    width = whole(args.get("frame_width"), "frame_width", minimum=FRAME_WIDTHS[0], maximum=FRAME_WIDTHS[1], default=FRAME_WIDTH)
    engine = args.get("engine", "eevee")
    need(engine in ("eevee", "solid"), "engine is eevee or solid.")
    view = args.get("view", "camera")
    need(view in ("camera", "overview", "objects"), "view is camera, overview or objects.")
    need(view != "objects" or args.get("objects"), "view objects frames the objects named: name them in objects.")
    times = [start + i * every / 1000 for i in range(count)]
    need(times[-1] <= LONGEST, f"The frames reach past {LONGEST} s.")
    aspect = s.render.resolution_x / s.render.resolution_y if view == "camera" else 16 / 9
    framed = None
    # A preview is at least 64 on each side: a wide picture's frames are made
    # wider, and a tall one's no taller than the widest frame is wide.
    need(aspect <= FRAME_WIDTHS[1] / 64, f"The camera's picture is too wide to show as frames: {s.render.resolution_x}×{s.render.resolution_y}.")
    need(aspect >= 64 / FRAME_WIDTHS[1], f"The camera's picture is too tall to show as frames: {s.render.resolution_x}×{s.render.resolution_y}.")
    width = max(width, math.ceil(64 * aspect))
    height = max(64, round(width / aspect))
    if height > FRAME_WIDTHS[1]:
        height = FRAME_WIDTHS[1]
        width = max(64, round(height * aspect))
    columns = max(1, min(count, SHEET_WIDEST // width, math.ceil(math.sqrt(count * height / width * 1.6))))
    rows = math.ceil(count / columns)
    asked = args.get("objects") or []
    need(isinstance(asked, list) and all(isinstance(n, str) for n in asked), "objects lists objects by name.")
    followed = find_objects(asked)
    need(len(followed) <= MOST_FOLLOWED, f"A frame sheet follows at most {MOST_FOLLOWED} objects by name; {len(followed)} were named.")
    allowed = allowed_contacts(args.get("allowed"))
    kept = now()
    folder = tempfile.mkdtemp(prefix="zhiyin-frames-")
    started = time.time()
    try:
        sheet = numpy.full((rows * height + (rows - 1) * 4, columns * width + (columns - 1) * 4, 3), 0.92, dtype=numpy.float32)
        # Cameras and lights move too, and what keys show and hide is a subject while it shows.
        candidates = list(
            dict.fromkeys(
                subjects()
                + [o for o in s.objects if o.type in ("CAMERA", "LIGHT")]
                + [o for o in s.objects if any(c.data_path == "hide_render" for c in curves_of(o))]
            )
        )
        seen = {}
        engines = set()
        if view == "objects":
            # One framing for every frame, round everywhere the parts go.
            framed = []
            for at in times:
                go_to(at)
                framed += world_corners(followed)
        side = clearest_side(followed, framed, times[len(times) // 2], aspect) if framed else None
        drawing = {"view": "overview", "fit": framed, "yaw": side[0], "pitch": side[1]} if side else {"view": view}
        for index, at in enumerate(times):
            go_to(at)
            # A shape that changes, by bones, shape keys or a simulation, moves while its origin stays.
            depsgraph = bpy.context.evaluated_depsgraph_get()
            for obj in candidates:
                seen.setdefault(obj.name, []).append(standing(obj, depsgraph))
            path = os.path.join(folder, f"{index}.jpg")
            drawn = preview({"width": width, "height": height, "quick": engine == "solid", **drawing}, path, device)
            engines.add(drawn.get("engine", "EEVEE"))
            rgb = read_rgb(path)
            # A preview drawn at half size, as Cycles draws a room, is taken to the frame's size.
            if rgb.shape[0] != height or rgb.shape[1] != width:
                ys = (numpy.arange(height) * rgb.shape[0] / height).astype(int)
                xs = (numpy.arange(width) * rgb.shape[1] / width).astype(int)
                rgb = rgb[ys][:, xs]
            write_label(rgb, seconds_text(at), 4, 4, 2 if width >= 240 else 1)
            row, column = divmod(index, columns)
            top, left = row * (height + 4), column * (width + 4)
            sheet[top : top + height, left : left + width] = rgb
        moving = [o for o in candidates if len(set(seen.get(o.name, []))) > 1]
        shown = followed or moving[:MOST_FOLLOWED]
        # What moves between the frames drawn moves too, and is checked as it does.
        stepped = list(dict.fromkeys(moving + [o for o in candidates if animated(o)]))
        # Every moving part is checked for what it goes into, not only those
        # whose places are listed: a clash is in the parts not named too. The
        # named come first, then the others, up to the most checked.
        shaped = [o for o in dict.fromkeys(followed + stepped) if own_size(o) is not None]
        checked = shaped[:MOST_CHECKED]
        unchecked = len(shaped) - len(checked)
        lines = []
        # What stays as it is in every frame is measured once, not in each.
        lasting = Lasting(o.as_pointer() for o in candidates if unchanging(o, seen))
        for index, at in enumerate(times):
            go_to(at)
            with held_still(lasting):
                if shown:
                    lines.append(f"{seconds_text(at)}: " + "; ".join(f"{placed_briefly(o)}" for o in shown))
        # Between the frames drawn as at them: every frame of their span is stepped through.
        checks, overlapping, named, scanned = scan(
            times[0], times[-1], stepped, checked, bool(args.get("loop")), lasting, allowed=allowed, budget=scan_budget(args, started)
        )
        save_rgb(sheet, args["picture"])
    finally:
        back_to(kept)
        shutil.rmtree(folder, ignore_errors=True)
    seconds = time.time() - started
    more = len(moving) - len(shown) if not followed else 0
    if view == "objects" and side is None:
        seen_from = f"framed on {listed([o.name for o in followed])}, from the overview's side"
    elif view == "objects":
        seen_from = f"framed on {listed([o.name for o in followed])}, {side_text(side[0], side[1])}, the side the rest of the scene covers least of them"
        if side[3]:
            hidden = [o.name for o in side[3]]
            seen_from += f" ({listed(hidden)} {'is' if len(hidden) == 1 else 'are'} covered by other parts from every side tried)"
    else:
        seen_from = "from the scene camera" if view == "camera" else "from the overview"
    head = (
        f"A frame sheet of {count} frames, {seconds_text(times[0])} to {seconds_text(times[-1])} every {every:g} ms,"
        f" {columns} across and {rows} down, each {width}×{height} and labelled with its time,"
        f" {seen_from}, drawn with {' and '.join(sorted(engines))} in {seconds:.1f} s."
    )
    if overlapping:
        head += (
            " Deepest overlaps, measured on the parts' surfaces, not their boxes, at every frame checked: "
            + overlap_text(overlapping, named, MOST_FOLLOWED, scanned)
            + "."
        )
    if unchecked:
        head += (
            f" Only {len(checked)} parts were checked for overlaps; {unchecked} more moving"
            f" {'part was' if unchecked == 1 else 'parts were'} not: name those to check in objects."
        )
    if not shown:
        moving_text = " Nothing moves in these frames."
    else:
        moving_text = (
            f" Where {'the objects asked for are' if followed else 'each moving object is'} at each time, with what it goes into, measured on their surfaces:"
            + ("" if not more else f" (and {more} more moving objects: name them in objects to see where they are)")
        )
    reached = reached_text(scanned[0], scanned[-1])
    return (
        head
        + moving_text
        + ("\n" + "\n".join(lines) if lines else "")
        + "\n"
        + "\n".join(checks)
        + (f"\n{reached}" if reached else "")
        + f"\n{timeline_text()}"
    )


def motion_report(args):
    """
    The motion in numbers, no pictures: every frame from a start to an end
    stepped through, however many, checked as a frame sheet checks the frames
    between those it draws, until most of the call's time is spent.
    """
    s = scene()
    started = time.time()
    start = moment(args.get("start"), "start", default=START)
    end = moment(args.get("end"), "end", default=min(seconds_of(s.frame_end), LONGEST))
    need(end > start, "end must come after start.")
    asked = args.get("objects") or []
    need(isinstance(asked, list) and all(isinstance(n, str) for n in asked), "objects lists objects by name.")
    followed = find_objects(asked)
    allowed = allowed_contacts(args.get("allowed"))
    kept = now()
    try:
        candidates = list(dict.fromkeys(subjects() + [o for o in s.objects if o.type in ("CAMERA", "LIGHT")]))
        seen = {}
        # Where each stands at the ends and between, so a part moved only by a simulation is found.
        for at in (start, (start + end) / 2, end):
            go_to(at)
            depsgraph = bpy.context.evaluated_depsgraph_get()
            for obj in candidates:
                seen.setdefault(obj.name, []).append(standing(obj, depsgraph))
        moving = list(dict.fromkeys([o for o in candidates if len(set(seen[o.name])) > 1] + [o for o in candidates if animated(o)]))
        shaped = [o for o in dict.fromkeys(followed + moving) if own_size(o) is not None]
        checked = shaped[:MOST_CHECKED]
        lasting = Lasting(o.as_pointer() for o in candidates if unchanging(o, seen))
        checks, overlapping, named, scanned = scan(
            start, end, moving, checked, bool(args.get("loop")), lasting, most=None, allowed=allowed, budget=scan_budget(args, started)
        )
    finally:
        back_to(kept)
    head = f"A motion report in numbers, with no pictures, of {len(moving)} moving {'part' if len(moving) == 1 else 'parts'}, in {time.time() - started:.1f} s."
    if overlapping:
        head += (
            " Deepest overlaps, measured on the parts' surfaces, first and deepest for each pair: "
            + overlap_text(overlapping, named, MOST_FOLLOWED, scanned)
            + "."
        )
    elif checked:
        head += " No two parts go into each other at any frame checked."
    if len(shaped) > len(checked):
        head += f" Only {len(checked)} parts were checked for overlaps; name the others to check in objects."
    reached = reached_text(scanned[0], scanned[-1])
    return head + "\n" + "\n".join(checks) + (f"\n{reached}" if reached else "") + f"\n{timeline_text()}"




def placed_briefly(obj):
    """Where an object is at this moment, and what it goes into."""
    # A camera, a light or an empty has no size to give, only a place and a turn.
    if own_size(obj) is None:
        return f"{obj.name} {standing_of(obj)}"
    try:
        full = placed(obj, 2)
    except Exception as error:
        keep_error("Where a moving object is could not be told", error)
        return f"{obj.name} {standing_of(obj)}"
    return full + (", hidden" if obj.hide_render else "")
