"""The scene file a session works on, which is always the truth.

The session saves the file after every change and loads it again when it
changed on disk, so going back in the conversation or an edit by hand is what
the next command sees.
"""

import os
import re

import bpy

from .common import Refused, colour, need


def settings():
    """Blender's own habits that would litter the workspace or run its code."""
    preferences = bpy.context.preferences
    preferences.filepaths.save_version = 0
    preferences.filepaths.use_auto_save_temporary_files = False
    # Saving makes a thumbnail in the person's user folder, which Blender
    # cannot find in its container: it would write it wherever an unset name
    # leads.
    preferences.filepaths.file_preview_type = "NONE"
    bpy.data.use_autopack = False


def new_scene():
    bpy.ops.wm.read_homefile(use_empty=True, use_factory_startup=True)
    settings()
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    world = bpy.data.worlds.new("World")
    world.use_nodes = True
    background = world.node_tree.nodes["Background"]
    background.inputs["Color"].default_value = colour("#7a7a7a", "background")
    background.inputs["Strength"].default_value = 1.0
    scene.world = world
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 128
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 1920
    scene.render.resolution_y = 1080
    scene.render.resolution_percentage = 100
    # Blender's own default is /tmp, which on Windows is a folder it makes at
    # the root of the drive: a script that renders by itself writes beside the
    # scene file instead.
    scene.render.filepath = "//renders/"


def stamp(path):
    status = os.stat(path)
    return (status.st_mtime_ns, status.st_size)


class SceneFile:
    def __init__(self):
        self.path = None
        self.stamp = None

    @property
    def name(self):
        return os.path.basename(self.path) if self.path else None

    def open(self, path, create):
        need(path.lower().endswith(".blend"), "A scene file ends in .blend.")
        if os.path.exists(path):
            try:
                bpy.ops.wm.open_mainfile(filepath=path, load_ui=False, use_scripts=False)
            except Exception:
                # With no scene open, Blender still holds its own startup
                # scene, which would be shown as if it were the person's.
                if self.path is None:
                    new_scene()
                raise
            settings()
            self.path = path
            self.stamp = stamp(path)
            return False
        need(create, f"{os.path.basename(path)} does not exist. Pass create: true to start a new scene there.")
        new_scene()
        self.path = path
        self.save()
        return True

    def require(self):
        need(self.path is not None, "No scene is open. Open or create one with blender_open_scene first.")

    def save(self):
        folder = os.path.dirname(self.path)
        # os.makedirs looks at the folders above even one that exists, and
        # Blender may not see those above the workspace: it would fail there.
        if not os.path.isdir(folder):
            os.makedirs(folder)
        bpy.ops.wm.save_as_mainfile(filepath=self.path, check_existing=False, copy=False, compress=False)
        self.stamp = stamp(self.path)

    def reload(self):
        bpy.ops.wm.open_mainfile(filepath=self.path, load_ui=False, use_scripts=False)
        settings()
        self.stamp = stamp(self.path)

    def follow_disk(self):
        """Loads the file when it changed on disk. Answers what happened, if anything."""
        if self.path is None:
            return None
        if not os.path.exists(self.path):
            gone = self.name
            self.path = None
            self.stamp = None
            new_scene()
            return f"{gone} no longer exists, so no scene is open."
        if stamp(self.path) != self.stamp:
            try:
                self.reload()
            except Exception as error:
                # What is open no longer matches the file; nothing is kept
                # that the next change would save over it.
                name = self.name
                self.path = None
                self.stamp = None
                new_scene()
                return f"{name} changed on disk and could not be loaded: {why_unloaded(error)}. No scene is open."
            return f"{self.name} changed on disk, so it was loaded again."
        return None


def why_unloaded(error):
    """Blender's reason a file could not be loaded, without the path it names."""
    said = str(error).strip().splitlines()[0] if str(error).strip() else type(error).__name__
    said = said.removeprefix("Error: ").strip()
    if "\": " in said:
        said = said.rsplit("\": ", 1)[1]
    # Blender names the file by its whole path in several forms; its name is enough.
    said = re.sub(
        r"([\"'])([^\"']*[\\/][^\"']*)\1",
        lambda found: found.group(1) + os.path.basename(found.group(2)) + found.group(1),
        said,
    )
    return said.rstrip(".") or type(error).__name__


