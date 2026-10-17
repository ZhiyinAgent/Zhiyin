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
import io
import os
import re
import sys
import zipfile

import bpy

from . import usd_crate
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
# The one file USD text names by a plain string: the pattern of a clip's
# scenes, in either way clips are written.
USD_TEMPLATE = re.compile(
    r"[tT]emplateAssetPath\s*=\s*"
    r"(?:\"\"\"(.*?)\"\"\"|'''(.*?)'''|\"((?:[^\"\\\r\n]|\\.)*)\"|'((?:[^'\\\r\n]|\\.)*)')",
    re.S,
)
USD_LAYERS = (".usd", ".usda", ".usdc", ".usdz")
# A path put together as the scene opens says nothing until then.
EXPRESSION = "{name} names a file by an expression, which cannot be checked here."


def _layers(content, folder, name):
    """
    The USD scenes a file holds, each with the folder its paths are read
    from: the file itself, or each scene a package holds.
    """
    if not content.startswith(b"PK\x03\x04"):
        yield content, folder, name
        return
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as package:
            for entry in package.infolist():
                if not entry.filename.lower().endswith(USD_LAYERS):
                    continue
                # USD reads a package's files only as they are stored, unpacked.
                if entry.compress_type != zipfile.ZIP_STORED:
                    raise Refused(f"{name} holds {entry.filename} compressed, which USD cannot read.")
                inner = os.path.join(folder, os.path.dirname(entry.filename))
                yield from _layers(package.read(entry), inner, f"{name}[{entry.filename}]")
    except zipfile.BadZipFile as error:
        raise Refused(f"{name} is a USD package that cannot be read here ({error}).") from error


def _named_by(content, name):
    """
    What one USD scene names, as written: in USD text, its asset paths and
    clip patterns; in binary USD, every string it holds, any of which may be
    one.
    """
    if usd_crate.is_crate(content):
        held = usd_crate.strings(content, name)
        if any(len(text) > 1 and text.startswith("`") and text.endswith("`") for text in held):
            raise Refused(EXPRESSION.format(name=name))
        return held
    if not content.startswith(b"#usda"):
        raise Refused(f"{name} is not USD that can be read here.")
    text = content.decode("utf-8", errors="replace")
    named = []
    for quoted, plain in USD_ASSET.findall(text):
        asset = quoted or plain
        if "`" in asset:
            raise Refused(EXPRESSION.format(name=name))
        named.append(asset)
    named.extend("".join(written) for written in USD_TEMPLATE.findall(text))
    return named


def _usd_names(path, workspace):
    """Every file a USD file names, in any of its forms, however deep."""
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
        for scene, folder, name in _layers(content, os.path.dirname(layer), os.path.basename(layer)):
            for written in _named_by(scene, name):
                asset = written.strip()
                if not asset:
                    continue
                try:
                    named = os.path.realpath(os.path.join(folder, asset.split("[", 1)[0]))
                except (OSError, ValueError):
                    # A path the system cannot open is not one USD can read.
                    continue
                names.append(named)
                if not outside([named], workspace) and named.lower().endswith(USD_LAYERS) and os.path.isfile(named):
                    waiting.append(named)
    return names


NAMED = {".obj": _obj_names, **{extension: _usd_names for extension in USD_LAYERS}}


def named_outside(path, workspace):
    """The files outside the workspace that a model file names for its importer to read itself."""
    names = NAMED.get(os.path.splitext(path)[1].lower())
    return outside(names(path, workspace), workspace) if names else []
