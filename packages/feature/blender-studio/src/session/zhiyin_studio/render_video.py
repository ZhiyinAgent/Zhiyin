"""
blender_render_video: the motion rendered to a video file, the scene's settings put back after. A
draft may take every so many frames, played at its real speed, and a slow-motion video stretches
time between the keys. A video too long for one call is drawn frame by frame over several calls and
joined once every frame is made. A simulation the video would show wrongly, jumped where it is not
baked or past the frames its bake holds, is refused before anything is drawn.
"""

import os
import shutil
import tempfile
import time

import bpy

from . import video_frames
from .arguments import need, number, vector, whole
from .errors import Refused
from .finding import find_object, scene
from .graphics_card import card_free
from .pictures import Kept, lifelike_eevee, write_picture
from .render_checks import WITHIN, minutes_text
from .render_sampling import set_sampling
from .sim_state import video_check
from .timeline import LONGEST, START, fps, moment, seconds_of, seconds_text

LONGEST_VIDEO = 300
# The most a video is slowed: Blender maps at most 900 frames to 100.
SLOWEST = 8
# The most frames a draft's one frame stands for.
MOST_EVERY = 24
# Samples per frame by engine when the call does not say, and the most it may ask.
SAMPLES_BY_ENGINE = {"eevee": 32, "cycles": 64}
MOST_SAMPLES = 4096
# Samples per frame, denoised, of a video asked of EEVEE that Cycles draws
# where EEVEE cannot: a draft, as an EEVEE video is.
INSTEAD_SAMPLES = 16
# Cycles's sampling a video's own sampling sets, put back after it.
SAMPLING = ("use_adaptive_sampling", "adaptive_threshold", "adaptive_min_samples", "seed", "use_animated_seed", "sampling_pattern")


def settings_of(struct):
    """Every setting of a group of render settings, by name, to put back after."""
    return {
        p.identifier: getattr(struct, p.identifier)
        for p in struct.bl_rna.properties
        if not p.is_readonly and p.type in ("BOOLEAN", "INT", "FLOAT", "STRING", "ENUM") and getattr(p, "is_array", False) is False
    }


def restore_settings(struct, kept):
    """
    Puts settings back, the container and codec first, since Blender changes
    others to suit them as they are set.
    """
    first = [name for name in ("format", "codec") if name in kept]
    for name in first + [name for name in kept if name not in first]:
        if getattr(struct, name) != kept[name]:
            setattr(struct, name, kept[name])


def estimated(first, count):
    """
    How long the video will take, from a frame drawn alone after its first,
    which also readies what the rest draw with: the seconds for all of them,
    and for one.
    """
    s = scene()
    folder = tempfile.mkdtemp(prefix="zhiyin-video-estimate-")
    try:
        s.frame_set(first)
        write_picture(os.path.join(folder, "first.png"), "PNG")
        started = time.time()
        write_picture(os.path.join(folder, "again.png"), "PNG")
        one = time.time() - started
    finally:
        shutil.rmtree(folder, ignore_errors=True)
    return one * count, one


def too_long(whole_time, count, limit, eevee):
    s = scene()
    return Refused(
        f"This video would take about {minutes_text(whole_time)}, {count} frames at {s.render.resolution_x}×{s.render.resolution_y}"
        f" timed from one: past the {minutes_text(limit)} a video may take. Use fewer samples, a smaller size"
        + (" or EEVEE" if eevee else "")
        + ", or render it in parts, each with its own start and end."
    )


def timing(args):
    """The video's span, step and slowing, checked: start and end in seconds, every so many frames, slowed so many times."""
    s = scene()
    start = moment(args.get("start"), "start", default=START)
    end = moment(args.get("end"), "end", default=min(seconds_of(s.frame_end), LONGEST))
    need(end > start, "end must come after start.")
    every = whole(args.get("every"), "every", minimum=1, maximum=MOST_EVERY, default=1)
    slow = number(args.get("slow_motion"), "slow_motion", minimum=1, maximum=SLOWEST, default=1)
    plays = (end - start) * slow
    if plays > LONGEST_VIDEO + 1e-9:
        middle = start + LONGEST_VIDEO / slow
        seconds = lambda value: f"{round(value, 3):g}"  # noqa: E731
        raise Refused(
            f"A video lasts at most {LONGEST_VIDEO} s, and this one would last {seconds(plays)} s."
            f" Render it in parts of at most {LONGEST_VIDEO} s, each with its own start and end, such as"
            f" {seconds(start)} to {seconds(middle)} s and {seconds(middle)} to {seconds(min(end, middle + LONGEST_VIDEO / slow))} s."
        )
    return start, end, every, slow


def render_video(args, scene_file, device):
    """
    The animation as a video file in the workspace, for the person to watch.
    The scene's own render settings are put back afterwards.
    """
    s = scene()
    out = args.get("output")
    need(isinstance(out, str) and os.path.splitext(out)[1].lower() == ".mp4", "A video is written as .mp4.")
    need("#" not in os.path.basename(out), "A video's name cannot hold #, which Blender replaces with frame numbers.")
    need(not os.path.isdir(out), f"{os.path.basename(out)} is a folder, so no video can be written there.")
    # A camera named for this video is for it alone: the scene keeps its own.
    camera = find_object(args["camera"], {"CAMERA"}) if args.get("camera") else s.camera
    need(camera is not None, "The scene has no camera. Set one with blender_set_camera first.")
    start, end, every, slow = timing(args)
    engine = args.get("engine", "eevee")
    need(engine in ("eevee", "cycles"), "engine is eevee or cycles.")
    need(args.get("sampling") is None or engine == "cycles", "sampling is Cycles's: give engine cycles, or leave sampling out.")
    # Where EEVEE cannot draw, Cycles draws the video as a draft.
    instead = engine == "eevee" and not device.eevee
    limit = args.get("limit_seconds")
    kept = Kept()
    media = (s.render.image_settings.media_type, s.render.image_settings.file_format)
    ffmpeg = s.render.ffmpeg
    kept_ffmpeg = settings_of(ffmpeg)
    frames = (s.frame_start, s.frame_end, s.frame_current)
    kept_time = (s.frame_step, s.render.fps_base, s.render.frame_map_old, s.render.frame_map_new)
    kept_sampling = {name: getattr(s.cycles, name) for name in SAMPLING}
    extension = s.render.use_file_extension
    started = time.time()
    rate = (s.render.fps, s.render.fps_base * every)
    first = round(frames[0] + start * fps())
    last = round(frames[0] + end * fps())
    try:
        s.camera = camera
        if args.get("resolution") is not None:
            w, h = vector(args["resolution"], "resolution", 2)
            need(16 <= w <= 7680 and 16 <= h <= 4320, "resolution must be between 16 and 7680 by 4320 pixels.")
            # H.264 takes even sizes only.
            s.render.resolution_x, s.render.resolution_y = int(w) // 2 * 2, int(h) // 2 * 2
        else:
            s.render.resolution_x, s.render.resolution_y = s.render.resolution_x // 2 * 2, s.render.resolution_y // 2 * 2
        s.render.resolution_percentage = 100
        if engine == "cycles":
            samples = whole(args.get("samples"), "samples", maximum=MOST_SAMPLES, default=SAMPLES_BY_ENGINE["cycles"])
            device.use_cycles(samples)
            set_sampling(args.get("sampling"), engine)
            # Noise that stays put while the picture moves shows as a dirty window: a new seed each frame.
            s.cycles.use_animated_seed = True
        elif instead:
            samples = INSTEAD_SAMPLES
            device.use_cycles(samples, denoised=True)
            s.cycles.use_animated_seed = True
        else:
            samples = whole(args.get("samples"), "samples", maximum=MOST_SAMPLES, default=SAMPLES_BY_ENGINE["eevee"])
            s.render.engine = "BLENDER_EEVEE"
            s.eevee.taa_render_samples = samples
            lifelike_eevee(s)
        s.render.film_transparent = False
        # Slowed, Blender shows frame n as the moment of frame n / slow.
        if slow > 1:
            s.render.frame_map_old, s.render.frame_map_new = 100, round(100 * slow)
        drawn = list(range(round(first * slow), round(last * slow) + 1, every))
        made_at = (s.render.resolution_x, s.render.resolution_y)
        key = {
            "video": args.get("video_key"),
            "time": [start, end, every, slow],
            "size": list(made_at),
            "engine": engine,
            "samples": samples,
            "sampling": args.get("sampling"),
            "camera": camera.name,
        }
        folder = video_frames.folder_for(key) if args.get("video_key") else None
        already = video_frames.made(folder, drawn) if folder else []
        ahead, one = (None, None) if already else estimated(drawn[0], len(drawn))
        over_calls = bool(already) or (bool(limit) and ahead > limit * WITHIN)
        if over_calls and folder is None:
            raise too_long(ahead, len(drawn), limit, device.eevee)
        simulated = video_check(first, last, sequential=every == 1 and slow == 1 and not over_calls)
        if every > 1:
            # Every so many frames, each shown as long as those it stands for: it plays at its real speed.
            s.render.fps_base = rate[1]
        if over_calls:
            done, per = video_frames.draw(folder, drawn, limit * WITHIN if limit else None, started, one or 0.0)
            ready = video_frames.made(folder, drawn)
            joined = len(ready) == len(drawn) and video_frames.join(folder, drawn, out, rate, made_at)
        else:
            s.render.image_settings.media_type = "VIDEO"
            s.render.image_settings.file_format = "FFMPEG"
            ffmpeg.format = "MPEG4"
            ffmpeg.codec = "H264"
            ffmpeg.constant_rate_factor = "HIGH"
            ffmpeg.ffmpeg_preset = "GOOD"
            ffmpeg.audio_codec = "NONE"
            s.frame_start, s.frame_end = drawn[0], drawn[-1]
            s.frame_step = every
            s.render.filepath = out
            s.render.use_file_extension = False
            with card_free():
                bpy.ops.render.render(animation=True)
            need(os.path.exists(out) and os.path.getsize(out) > 0, "Blender wrote no video.")
    finally:
        # The picture format first: a video's settings take no picture format.
        s.render.image_settings.media_type, s.render.image_settings.file_format = media
        # The codec before the picture settings, which may need it.
        restore_settings(ffmpeg, kept_ffmpeg)
        kept.restore()
        s.render.use_file_extension = extension
        s.frame_step, s.render.fps_base, s.render.frame_map_old, s.render.frame_map_new = kept_time
        for name, value in kept_sampling.items():
            setattr(s.cycles, name, value)
        s.frame_start, s.frame_end = frames[0], frames[1]
        s.frame_set(frames[2])
    seconds = time.time() - started
    count = len(drawn)
    played = count / (rate[0] / rate[1])
    paced = (
        f" Every {ordinal(every)} frame, at {rate[0] / rate[1]:g} a second, so it plays at its real speed." if every > 1 else ""
    ) + (f" Slowed {slow:g} times: {seconds_text(end - start)} of the animation plays for {seconds_text(played)}." if slow > 1 else "")
    sampled = " Cycles sampling as given for this video alone, its seed changing each frame." if args.get("sampling") else ""
    engine_said = (
        "Cycles on " + device.said()
        if engine == "cycles"
        else f"Cycles on {device.said()} at {INSTEAD_SAMPLES} samples, as EEVEE cannot draw on this computer"
        if instead
        else "EEVEE"
    )
    if over_calls and not joined:
        left = count - len(ready)
        return (
            f"Drawing {os.path.basename(out)} over several calls, as its frames take longer than one: {len(ready)} of its {count} frames"
            f" are made ({done} in this call, {len(ready) - done} before), {made_at[0]}×{made_at[1]} with {engine_said}, about"
            f" {per:.1f} s a frame; the {left} left take about {minutes_text(left * per)} more."
            " Call blender_render_video again with the same inputs to go on: the frames made are kept in this conversation's own folder,"
            " and the video is written once the last is made. Change nothing in the scene before then, or the frames will not match."
            + paced
            + simulated
        )
    timed = (
        "drawn frame by frame, over as many calls as that took, and joined into the video in this one"
        if over_calls
        else f"estimated beforehand at {minutes_text(ahead)} from one frame"
    )
    return (
        f"Rendered {os.path.basename(out)}, {made_at[0]}×{made_at[1]}, "
        + (f"through {camera.name}, " if args.get("camera") else "")
        + f"from {seconds_text(start)} to {seconds_text(end)} of the animation:"
        f" {count} frames at {rate[0] / rate[1]:g} a second, which play for {seconds_text(played)}, with {engine_said} in {seconds:.0f} s, {timed}."
        + paced
        + sampled
        + simulated
        + " It is for the person to watch: you cannot see a video, so check motion with blender_frame_sheet."
        " The person can play it beside the conversation; once another document takes its place there, read_document shows it again."
    )


def ordinal(n):
    return {2: "2nd", 3: "3rd"}.get(n, f"{n}th")
