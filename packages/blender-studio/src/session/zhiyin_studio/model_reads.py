"""What a model file reads besides itself, kept inside the workspace.

A model file names other files for its importer to read: a glTF its geometry
and pictures, an OBJ its materials, a USD file other scenes and textures. The
pictures stay in the scene as images with paths, and are checked once the
import is done; the rest leaves nothing behind to check, so it is refused
before it is read. Python importers are watched as they open files; the OBJ
and USD importers read in Blender's own code, so what those files name is
read from them first.
"""

import contextlib
import os
import re
import sys

import bpy

from .common import Refused, outside

# Which folders a file may be opened in while a model file is read, or None
# when none is being read; and what was refused while it was.
_reading = {"folders": None, "refused": []}


def _watch(event, args):
    folders = _reading["folders"]
    if folders is None or event != "open" or not args or isinstance(args[0], int):
        return
    try:
        path = os.path.realpath(os.fsdecode(args[0]))
    except (TypeError, ValueError):
        return
    if all(outside([path], folder) for folder in folders):
        _reading["refused"].append(path)
        raise PermissionError(f"{path} is outside the workspace.")


# Once for the session: a watch cannot be taken back, so it does nothing
# while no model file is being read.
sys.addaudithook(_watch)


@contextlib.contextmanager
def reading_inside(workspace):
    """While it lasts, Python opens files only in the workspace and in Blender's own folders; answers what it refused."""
    refused = []
    own = [os.path.dirname(bpy.app.binary_path), bpy.utils.resource_path("USER")]
    _reading.update(folders=[workspace, *(folder for folder in own if folder)], refused=refused)
    try:
        yield refused
    finally:
        _reading["folders"] = None


def _obj_names(path, _workspace):
    """The material files an OBJ names, each as written whole and word by word, as an importer might split it."""
    names = []
    with open(path, encoding="utf-8", errors="replace") as text:
        for line in text:
            words = line.split()
            if len(words) > 1 and words[0] == "mtllib":
                names.append(line.strip()[len("mtllib"):].strip())
                names.extend(words[1:])
    folder = os.path.dirname(path)
    return [os.path.realpath(os.path.join(folder, name)) for name in names]


# How USD text writes a file it names, for any use: another scene, a part,
# a texture, a clip. `@@@` quotes a path that holds an `@`.
USD_ASSET = re.compile(r"@@@(.*?)@@@|@([^@\r\n]*)@")
USD_LAYERS = (".usd", ".usda", ".usdc", ".usdz")
UNCHECKABLE = (
    "{name} is binary USD, and the files it reads cannot be checked here. "
    "Export it as .usda, .glb or .obj and add that instead."
)


def _usd_names(path, workspace):
    """Every file a USD text file names, however deep. Binary USD cannot be read here, so it is refused."""
    names = []
    waiting = [os.path.realpath(path)]
    seen = set()
    while waiting:
        layer = waiting.pop()
        if layer in seen:
            continue
        seen.add(layer)
        with open(layer, "rb") as file:
            content = file.read()
        if not content.startswith(b"#usda"):
            raise Refused(UNCHECKABLE.format(name=os.path.basename(layer)))
        folder = os.path.dirname(layer)
        for quoted, plain in USD_ASSET.findall(content.decode("utf-8", errors="replace")):
            asset = (quoted or plain).strip()
            if not asset:
                continue
            # A path put together as the scene opens says nothing until then.
            if "`" in asset:
                raise Refused(f"{os.path.basename(layer)} names a file by an expression, which cannot be checked here.")
            named = os.path.realpath(os.path.join(folder, asset.split("[", 1)[0]))
            names.append(named)
            if not outside([named], workspace) and named.lower().endswith(USD_LAYERS) and os.path.isfile(named):
                waiting.append(named)
    return names


NAMED = {".obj": _obj_names, ".usd": _usd_names, ".usda": _usd_names}


def named_outside(path, workspace):
    """The files outside the workspace that a model file names for its importer to read itself."""
    names = NAMED.get(os.path.splitext(path)[1].lower())
    return outside(names(path, workspace), workspace) if names else []
