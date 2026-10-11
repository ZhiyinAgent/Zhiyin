"""The scene file a session works on, which is always the truth.

The session saves the file after every change and loads it again when it
changed on disk, so going back in the conversation or an edit by hand is what
the next command sees.
"""

import os

import bpy

from .common import Refused, colour, need


def settings():
    """Blender's own habits that would litter the workspace or run its code."""
    preferences = bpy.context.preferences
    preferences.filepaths.save_version = 0
    preferences.filepaths.use_auto_save_temporary_files = False
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
            bpy.ops.wm.open_mainfile(filepath=path, load_ui=False, use_scripts=False)
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
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
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
            self.reload()
            return f"{self.name} changed on disk, so it was loaded again."
        return None


