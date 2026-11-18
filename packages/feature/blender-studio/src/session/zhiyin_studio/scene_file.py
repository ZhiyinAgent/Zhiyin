"""The scene file a session works on, which is always the truth.

The session saves the file after every change and loads it again when it
changed on disk, so going back in the conversation or an edit by hand is what
the next command sees.
"""

import contextlib
import hashlib
import os
import re
import shutil
import tempfile

import bpy

from .arguments import colour, need
from .saved_unused import as_saved, kept_while_saving


def settings():
    """Blender's own habits that would litter the workspace or run its code."""
    preferences = bpy.context.preferences
    preferences.filepaths.save_version = 0
    preferences.filepaths.use_auto_save_temporary_files = False
    # Saving makes a thumbnail in the person's user folder, which Blender
    # cannot find in its container: it would write it wherever an unset name
    # leads.
    preferences.filepaths.file_preview_type = "NONE"
    # Pictures are packed by the session itself as it saves; Blender's own autopack would pack fonts
    # and sounds too, and keeps a packed picture as it was when its file changes.
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


# Kept on a picture packed from its file: the file's time and size when it was packed.
PACKED_FROM = "zhiyin_packed_from"


def pack_pictures():
    """
    Packs every picture read from a file into the scene file, so the scene travels whole: a picture
    is packed once, and again only when its file changes, so a save reads no file twice. The
    picture keeps its path, by which answers name it.
    """
    for image in bpy.data.images:
        if image.source != "FILE" or image.library is not None or not image.filepath:
            continue
        # Pixels a script set and kept nowhere are its own to pack or save, which the material checks say.
        if image.is_dirty:
            continue
        path = bpy.path.abspath(image.filepath)
        if not os.path.isfile(path):
            continue
        now = "%d:%d" % stamp(path)
        if image.packed_file is not None:
            # Packed by something else, or from the file as it still is.
            if image.get(PACKED_FROM) in (None, now):
                continue
            image.unpack(method="REMOVE")
            image.reload()
        image.pack()
        image[PACKED_FROM] = now


@contextlib.contextmanager
def pictures_from_their_files():
    """
    While an export runs, each picture packed from a file still there as it was packed is read from
    that file again, so the export names the file as it would had nothing been packed, rather than
    writing a copy of its own; packed again after.
    """
    unpacked = []
    for image in bpy.data.images:
        packed_from = image.get(PACKED_FROM)
        if image.packed_file is None or packed_from is None:
            continue
        path = bpy.path.abspath(image.filepath)
        if not os.path.isfile(path) or "%d:%d" % stamp(path) != packed_from:
            continue
        image.unpack(method="REMOVE")
        unpacked.append(image)
    try:
        yield
    finally:
        for image in unpacked:
            image.pack()


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
            as_saved()
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
        pack_pictures()
        with kept_while_saving():
            bpy.ops.wm.save_as_mainfile(filepath=self.path, check_existing=False, copy=False, compress=False)
        self.stamp = stamp(self.path)

    def written(self):
        """
        What saving the scene as it now is would write, as a digest: Blender writes the same bytes
        for a scene that has not changed since it was loaded, and other bytes once anything saved
        has. Written to a copy elsewhere, so the scene file and what is held stay as they are.
        """
        folder = tempfile.mkdtemp(prefix="zhiyin-written-")
        copy = os.path.join(folder, "scene.blend")
        try:
            with kept_while_saving():
                bpy.ops.wm.save_as_mainfile(
                    filepath=copy, check_existing=False, copy=True, compress=False, relative_remap=False
                )
            digest = hashlib.sha256()
            with open(copy, "rb") as file:
                for block in iter(lambda: file.read(1 << 20), b""):
                    digest.update(block)
            return digest.digest()
        finally:
            shutil.rmtree(folder, ignore_errors=True)

    def reload(self):
        bpy.ops.wm.open_mainfile(filepath=self.path, load_ui=False, use_scripts=False)
        settings()
        as_saved()
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


