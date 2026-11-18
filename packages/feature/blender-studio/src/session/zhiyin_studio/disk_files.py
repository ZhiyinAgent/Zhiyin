"""The files on disk a scene reads, which paths lie outside a folder, and how much a folder holds."""

import os

import bpy

# The kinds of data Blender reads from a file on disk rather than from the scene.
FILE_DATA = ("images", "libraries", "fonts", "sounds", "movieclips", "volumes", "cache_files")


def files_read():
    """
    Every file on disk the scene reads or has read, by its full path: a file
    packed into the scene was read to pack it.
    """
    paths = set()
    for kind in FILE_DATA:
        for block in getattr(bpy.data, kind):
            path = getattr(block, "filepath", "")
            if not path or path == "<builtin>":
                continue
            paths.add(os.path.realpath(bpy.path.abspath(path, library=block.library)))
    return paths


def outside(paths, folder):
    """
    The paths that are not inside a folder. Each is compared where it really
    is, with its names as the folders store them, so a folder named like this
    one but for case, which a folder that tells case apart can hold, is outside.
    """
    root = os.path.realpath(folder)
    below = root if root.endswith(os.sep) else root + os.sep

    def within(path):
        real = os.path.realpath(path)
        return real == root or real.startswith(below)

    return sorted(path for path in paths if not within(path))


def folder_size(path):
    """The bytes of every file in a folder and the folders in it."""
    total = 0
    for root, _, files in os.walk(path):
        for name in files:
            total += os.path.getsize(os.path.join(root, name))
    return total
