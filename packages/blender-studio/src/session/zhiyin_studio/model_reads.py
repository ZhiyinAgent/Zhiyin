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
import struct
import sys

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
    """
    While it lasts, Python opens files only in the workspace and in Blender's
    own folders, and the workspace is the folder Blender runs in, where USD
    looks for a path not written from ./ or ../; answers what it refused.
    """
    refused = []
    own = [os.path.dirname(bpy.app.binary_path), bpy.utils.resource_path("USER")]
    was = os.getcwd()
    # Entered first, so a workspace that cannot be entered leaves no guard.
    os.chdir(workspace)
    _reading.update(folders=[workspace, *(folder for folder in own if folder)], refused=refused)
    try:
        yield refused
    finally:
        os.chdir(was)
        _reading["folders"] = None


# What Blender's OBJ importer counts as space: every byte up to a space.
OBJ_SPACE = bytes(range(33))
OBJ_SPACES = re.compile(rb"[\x00-\x20]+")


def _obj_names(path, _workspace):
    """
    The material files an OBJ names, read as Blender's importer reads them: a
    line continued by a backslash, any control byte as space, a name quoted
    or not, whole and word by word, and the material file named after the
    model, which it reads whether named or not.
    """
    with open(path, "rb") as file:
        content = re.sub(rb"\\\r?\n", b" ", file.read())
    names = [os.path.splitext(os.path.basename(path))[0] + ".mtl"]
    for line in re.split(rb"\r?\n", content):
        line = line.strip(OBJ_SPACE)
        if not line.startswith(b"mtllib") or len(line) == 6 or line[6] > 32:
            continue
        rest = line[6:].strip(OBJ_SPACE)
        for written in [rest, *OBJ_SPACES.split(rest)]:
            for name in {written, written.strip(b'"')}:
                if name:
                    names.append(name.decode("utf-8", errors="replace"))
    folder = os.path.dirname(path)
    return [os.path.realpath(os.path.join(folder, name)) for name in names]


# How USD text writes a file it names, for any use: another scene, a part,
# a texture, a clip. `@@@` quotes a path that holds an `@`.
USD_ASSET = re.compile(r"@@@(.*?)@@@|@([^@\r\n]*)@")
# Clips name their scenes by a pattern, a string USD text can spell in more
# ways than are read here; their metadata, in either way clips are written,
# with space or comments before its "=".
USD_CLIPS = re.compile(r"(?<![\w:.])(?:clips|clip[A-Z]\w*)(?:\s|/\*.*?\*/|#[^\r\n]*)*=", re.S)
USD_LAYERS = (".usd", ".usda", ".usdc", ".usdz")
# A scene Blender's USD also opens, which can include files of its own.
MATERIALX = ".mtlx"
# What USD drops from a path before it opens the file.
FORMAT_ARGUMENTS = ":SDF_FORMAT_ARGS:"
# A drive with no folder after it, which Windows reads from the folder it is
# in on that drive.
DRIVE_ONLY = re.compile(r"^[A-Za-z]:(?![\\/])")
# A path put together as the scene opens says nothing until then.
EXPRESSION = "{name} names a file by an expression, which cannot be checked here."
PACKAGE = "{name} is a USD package that cannot be read here ({why}). Export it as .usdc, .glb or .obj and add that instead."


def _package_files(content, name):
    """A package's files as USD reads them: one after another from its start, each as stored."""
    files, at = [], 0
    while content[at : at + 4] == b"PK\x03\x04":
        if len(content) < at + 30:
            raise Refused(PACKAGE.format(name=name, why="it is cut short"))
        flags, method = struct.unpack_from("<HH", content, at + 6)
        size, _full, named, extra = struct.unpack_from("<IIHH", content, at + 18)
        start = at + 30 + named + extra
        if method != 0 or flags & 0x08 or len(content) < start + size:
            raise Refused(PACKAGE.format(name=name, why="a file in it is compressed or its size is not given"))
        files.append((content[at + 30 : at + 30 + named].decode("utf-8", errors="replace"), content[start : start + size]))
        at = start + size
    return files


def _layers(content, folder, name):
    """
    The USD scenes a file holds, each with the folder its paths are read
    from: the file itself, or each scene a package holds.
    """
    if not content.startswith(b"PK\x03\x04"):
        yield content, folder, name
        return
    for entry, data in _package_files(content, name):
        if entry.lower().endswith(USD_LAYERS):
            inner = os.path.join(folder, os.path.dirname(entry))
            yield from _layers(data, inner, f"{name}[{entry}]")


def _named_by(content, name):
    """
    What one USD scene names, as written: in USD text, its asset paths; in
    binary USD, every string it holds, any of which may be one.
    """
    if usd_crate.is_crate(content):
        held = usd_crate.strings(content, name)
        if any(len(text) > 1 and text.startswith("`") and text.endswith("`") for text in held):
            raise Refused(EXPRESSION.format(name=name))
        return held
    if not content.startswith(b"#usda"):
        raise Refused(f"{name} is not USD that can be read here.")
    text = content.decode("utf-8", errors="replace")
    if USD_CLIPS.search(text):
        raise Refused(f"{name} plays clips, whose files cannot be checked here. Export it as .usdc, .glb or .obj and add that instead.")
    if "\\@@@" in text:
        raise Refused(f"{name} names a file with an escaped @@@, which cannot be checked here.")
    named = []
    for quoted, _plain in USD_ASSET.findall(text):
        if quoted:
            named.append(quoted)
    # An @ in a string or a comment pairs differently from USD's reading, so
    # what lies between any two @ on a line is checked.
    rest = re.sub(r"@@@.*?@@@", "", text)
    for line in rest.splitlines():
        parts = line.split("@")
        named.extend(parts[1:-1])
    for asset in named:
        if "`" in asset:
            raise Refused(EXPRESSION.format(name=name))
    return named


def _read_as(written, folder, workspace, first, name):
    """
    The files USD may open for a path as written: from the scene's own
    folder, and for a path not written from ./ or ../, from the folder an
    import runs in, which is the workspace, and from the folder of the scene
    it opened first, where USD looks next.
    """
    asset = written.split(FORMAT_ARGUMENTS, 1)[0]
    # A path into a package ends with "]"; elsewhere "[" is a character of
    # the path, and what follows it still climbs.
    if asset.endswith("]") and "[" in asset:
        asset = asset.split("[", 1)[0]
    if DRIVE_ONLY.match(asset):
        raise Refused(f"{name} names {written} by a drive without a folder, which cannot be checked here.")
    places = [folder]
    rooted = asset.startswith(("/", "\\")) or os.path.isabs(asset)
    if not rooted and not asset.startswith(("./", "../")):
        places.extend([workspace, first])
    read = []
    for place in places:
        try:
            read.append(os.path.realpath(os.path.join(place, asset)))
        except (OSError, ValueError):
            # A path the system cannot open is not one USD can read.
            continue
    return read


def _usd_names(path, workspace):
    """Every file a USD file names, in any of its forms, however deep."""
    names = []
    waiting = [os.path.realpath(path)]
    first = os.path.dirname(waiting[0])
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
                if not written.strip():
                    continue
                for named in _read_as(written.strip(), folder, workspace, first, name):
                    if named.lower().endswith(MATERIALX):
                        raise Refused(f"{name} uses a MaterialX scene, whose files cannot be checked here. Export it as .usdc, .glb or .obj and add that instead.")
                    names.append(named)
                    if not outside([named], workspace) and named.lower().endswith(USD_LAYERS) and os.path.isfile(named):
                        waiting.append(named)
    return names


NAMED = {".obj": _obj_names, **{extension: _usd_names for extension in USD_LAYERS}}


def named_outside(path, workspace):
    """The files outside the workspace that a model file names for its importer to read itself."""
    names = NAMED.get(os.path.splitext(path)[1].lower())
    return outside(names(path, workspace), workspace) if names else []
