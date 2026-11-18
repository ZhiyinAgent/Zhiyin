"""
A video too long for one call, made over several: its frames are drawn as pictures into a folder of
the conversation's own, named by the video and every setting it is made with, so a call made again
with the same inputs skips the frames already there and goes on. Each call draws frames until most
of its time is spent; the call that draws the last one joins them into the video and removes the
folder. A frame is drawn whole or not at all, so a call stopped part way loses at most the frame it
was on.
"""

import hashlib
import json
import os
import shutil
import time

import bpy

from .finding import scene
from .graphics_card import DRAWING
from .pictures import write_picture

ROOT = "video-frames"


def folder_for(key):
    """The folder a video's frames go in, from what names it and how it is made."""
    home = os.environ.get("USERPROFILE") or os.path.expanduser("~")
    digest = hashlib.sha256(json.dumps(key, sort_keys=True).encode("utf-8")).hexdigest()[:16]
    return os.path.join(home, ROOT, digest)


def frame_file(folder, frame):
    return os.path.join(folder, f"frame_{frame:06d}.png")


def made(folder, frames):
    """The frames already drawn in the folder."""
    return [f for f in frames if os.path.isfile(frame_file(folder, f))]


def draw(folder, frames, limit, started, guess):
    """
    Draws each frame not yet in the folder, in order, until the next would run past `limit` seconds
    from `started`, guessing a frame's time as `guess` until one is timed, and always at least
    one. Answers how many it drew and the seconds a frame took.
    """
    os.makedirs(folder, exist_ok=True)
    s = scene()
    drawn, spent, per = 0, 0.0, guess
    for frame in frames:
        path = frame_file(folder, frame)
        if os.path.isfile(path):
            continue
        # At least one frame a call, so every call goes on.
        if drawn and limit and time.time() - started + per > limit:
            break
        began = time.time()
        s.frame_set(frame)
        write_picture(path, "PNG")
        spent += time.time() - began
        drawn += 1
        per = spent / drawn
    return drawn, per


def join(folder, frames, out, rate, size):
    """Joins the drawn frames, in order, into an H.264 video at `rate` frames a second, then removes the folder."""
    edit = bpy.data.scenes.new("Zhiyin video frames")
    try:
        edit.render.resolution_x, edit.render.resolution_y = size
        edit.render.resolution_percentage = 100
        edit.render.fps, edit.render.fps_base = rate
        # The frames are already as the scene's view shows them: taken as they are.
        edit.view_settings.view_transform = "Standard"
        edit.view_settings.look = "None"
        editor = edit.sequence_editor_create()
        strip = editor.strips.new_image("frames", frame_file(folder, frames[0]), 1, 1)
        for frame in frames[1:]:
            strip.elements.append(os.path.basename(frame_file(folder, frame)))
        edit.frame_start, edit.frame_end = 1, len(frames)
        edit.render.use_sequencer = True
        settings = edit.render.image_settings
        settings.media_type = "VIDEO"
        settings.file_format = "FFMPEG"
        ffmpeg = edit.render.ffmpeg
        ffmpeg.format = "MPEG4"
        ffmpeg.codec = "H264"
        ffmpeg.constant_rate_factor = "HIGH"
        ffmpeg.ffmpeg_preset = "GOOD"
        ffmpeg.audio_codec = "NONE"
        edit.render.filepath = out
        edit.render.use_file_extension = False
        # The sequencer joins the frames and no engine draws; a new scene
        # still names EEVEE, which a computer that draws on its processor
        # never names for a picture.
        if DRAWING.on_processor:
            edit.render.engine = "CYCLES"
        bpy.ops.render.render(animation=True, scene=edit.name)
    finally:
        bpy.data.scenes.remove(edit)
    if os.path.exists(out) and os.path.getsize(out) > 0:
        shutil.rmtree(folder, ignore_errors=True)
        return True
    return False
