"""
The parts a script built, handed from the run that ran it to the run that
measures them. Each part is a file of the kernel's own exact geometry, which
holds data and no code, and a manifest says the rest: each part's name, its
named surfaces and the faces a helper marked to mesh coarser for viewing, by
their place among the part's faces, what the helpers did, the cuts skipped,
the joins and cuts that add or take nothing, the solids lost from a
builder, the way each part is made where the script said, what the helpers
made, and the parts at each other
position. The measuring run reads all of it as
data, checked, and loads nothing that could run.
"""

import json
import math
import os
import re

import build123d as bd
from OCP.BinTools import BinTools, BinTools_FormatVersion_CURRENT
from OCP.TopoDS import TopoDS_Shape

from . import making, meshing, surfaces
from .build import Run

MANIFEST = "manifest.json"
# The largest manifest read: names, face numbers and notes, never geometry.
LARGEST_MANIFEST = 64 * 1024 * 1024
# A part's file is named by the run that wrote it, a plain name in its folder.
_FILE = re.compile(r"^[A-Za-z0-9_.-]{1,64}\.bin$")


class Unreadable(Exception):
    """What the script's run left is not parts as the measuring run reads them."""


def write_parts(folder, prefix, parts):
    listed = []
    for index, (name, shape) in enumerate(parts):
        file = f"{prefix}-{index}.bin"
        # The exact geometry alone: a mesh left on the faces would be read as one of some fineness.
        BinTools.Write_s(shape.wrapped, os.path.join(folder, file), False, False, BinTools_FormatVersion_CURRENT)
        listed.append({"name": name, "file": file})
    return listed


def write(folder, run, arguments, others, unchecked, slowest, seconds, positioned):
    """
    Writes the build's own run, its parts and what it said, and each other
    position's parts, with `arguments` and each other's, those not started
    for want of time, the longest one took, and the run's seconds.
    """
    faces = {name: surfaces.faces_of(shape) for name, shape in run.parts}
    manifest = {
        "arguments": list(arguments),
        "parts": write_parts(folder, "part", run.parts),
        "surfaces": {name: {group: list(indexes) for group, indexes in groups.items()} for name, groups in run.surfaces.items()},
        "wire": {
            name: marked
            for name, _ in run.parts
            if (marked := meshing.marked_faces(faces[name], run.wire))
        },
        "helped": list(run.helped),
        "skipped": [
            {**one, "at": list(one["at"]) if one.get("at") is not None else None}
            for one in run.skipped
        ],
        "empty": list(run.empty),
        "making": dict(run.making),
        "features": list(run.features),
        "positioned": bool(positioned),
        "positions": [
            {"arguments": list(given), "parts": write_parts(folder, f"position{index}", parts)}
            for index, (given, parts) in enumerate(others, start=1)
        ],
        "unchecked": [list(one) for one in unchecked],
        "slowest": slowest,
        "seconds": seconds,
    }
    with open(os.path.join(folder, MANIFEST), "w", encoding="utf-8") as out:
        json.dump(manifest, out)


def _text(value):
    if not isinstance(value, str):
        raise Unreadable("a name or a note is not text")
    return value


def _texts(value):
    if not isinstance(value, list):
        raise Unreadable("a list is not one")
    return [_text(one) for one in value]


def _number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise Unreadable("a number is not one")
    return float(value)


def _index(value, count):
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value < count:
        raise Unreadable("a face number is not one of the part's")
    return value


# What each helper's record holds: its points, and its sizes, which may be left out.
_FEATURES = {
    "cast": (("pull", "base"), ("height",)),
    "boss": (("at", "way"), ("diameter", "height", "hole")),
}


def _feature(one):
    """A helper's record of what it made, as plain numbers, or Unreadable."""
    if not isinstance(one, dict) or one.get("kind") not in _FEATURES:
        raise Unreadable("what a helper made is not a record of one")
    points, sizes = _FEATURES[one["kind"]]
    found = {"kind": one["kind"]}
    for key in points:
        value = one.get(key)
        if not isinstance(value, list) or len(value) != 3:
            raise Unreadable("a helper's point is not one")
        found[key] = [_number(v) for v in value]
    for key in sizes:
        found[key] = None if one.get(key) is None else _number(one[key])
    return found


def read_parts(folder, listed):
    if not isinstance(listed, list):
        raise Unreadable("the parts are not a list")
    parts, taken = [], set()
    for one in listed:
        if not isinstance(one, dict):
            raise Unreadable("a part is not named with its file")
        name, file = _text(one.get("name")), _text(one.get("file"))
        if not _FILE.match(file) or file in taken:
            raise Unreadable("a part's file is not one of the run's own")
        taken.add(file)
        path = os.path.join(folder, file)
        if not os.path.isfile(path) or os.path.islink(path):
            raise Unreadable(f"{name}'s geometry is missing")
        shape = TopoDS_Shape()
        try:
            BinTools.Read_s(shape, path)
        except Exception as problem:  # noqa: BLE001 - the kernel's own refusal, said as the file's
            raise Unreadable(f"{name}'s geometry could not be read: {problem}") from None
        if shape.IsNull():
            raise Unreadable(f"{name}'s geometry is empty")
        parts.append((name, bd.Shape.cast(shape)))
    names = [name for name, _ in parts]
    if len(set(names)) != len(names):
        raise Unreadable("two parts share a name")
    return parts


def read(manifest_path):
    """
    The build's run, as a Run of the parts read back, and each other
    position's parts, from what the script's run wrote: or Unreadable, saying
    what is not as it should be.
    """
    folder = os.path.dirname(manifest_path)
    if os.path.getsize(manifest_path) > LARGEST_MANIFEST:
        raise Unreadable("its manifest is too large")
    with open(manifest_path, encoding="utf-8") as given:
        try:
            manifest = json.load(given)
        except ValueError:
            raise Unreadable("its manifest is not JSON") from None
    if not isinstance(manifest, dict):
        raise Unreadable("its manifest is not a record")
    parts = read_parts(folder, manifest.get("parts"))
    faces = {name: surfaces.faces_of(shape) for name, shape in parts}
    groups = {}
    for name, named in (manifest.get("surfaces") or {}).items():
        if name not in faces or not isinstance(named, dict):
            raise Unreadable("named surfaces are of no part shown")
        groups[name] = {_text(group): sorted({_index(i, len(faces[name])) for i in indexes}) for group, indexes in named.items() if isinstance(indexes, list)}
    wire = {}
    for name, marked in (manifest.get("wire") or {}).items():
        if name not in faces or not isinstance(marked, list):
            raise Unreadable("marked faces are of no part shown")
        listing = []
        for one in marked:
            if not isinstance(one, list) or len(one) != 3:
                raise Unreadable("a marked face is not a face with its fineness")
            listing.append((_index(one[0], len(faces[name])), _number(one[1]), _number(one[2])))
        meshing.mark_faces(faces[name], listing, wire)
    skipped = []
    for one in manifest.get("skipped") or []:
        if not isinstance(one, dict):
            raise Unreadable("a skipped cut is not a record")
        at = one.get("at")
        if at is not None and (not isinstance(at, list) or len(at) != 3):
            raise Unreadable("a skipped cut's place is not a point")
        skipped.append(
            {key: _text(one.get(key)) for key in ("where", "why", "part", "cutter")}
            | {"at": tuple(_number(v) for v in at) if at is not None else None}
        )
    empty = []
    for one in manifest.get("empty") or []:
        if not isinstance(one, dict) or one.get("what") not in ("join", "cut", "miss", "lost"):
            raise Unreadable("a join or cut that adds or takes nothing is not a record of one")
        times = one.get("times")
        if isinstance(times, bool) or not isinstance(times, int) or times < 1:
            raise Unreadable("a join or cut of no volume is not counted")
        empty.append({key: _text(one.get(key)) for key in ("where", "what", "shape")} | {"times": times})
    ways = {}
    for name, method in (manifest.get("making") or {}).items():
        if name not in faces or method not in making.METHODS:
            raise Unreadable("a way of making is not one, or of no part shown")
        ways[name] = method
    features = [_feature(one) for one in manifest.get("features") or []]
    others = []
    for one in manifest.get("positions") or []:
        if not isinstance(one, dict):
            raise Unreadable("a position is not a record")
        others.append((_texts(one.get("arguments")), read_parts(folder, one.get("parts"))))
    seconds = manifest.get("seconds") or {}
    if not isinstance(seconds, dict):
        raise Unreadable("its times are not a record")
    return {
        "run": Run(parts, _texts(manifest.get("helped") or []), skipped, groups, wire, empty, ways, features),
        "arguments": _texts(manifest.get("arguments") or []),
        "positioned": manifest.get("positioned") is True,
        "others": others,
        "unchecked": [_texts(one) for one in manifest.get("unchecked") or []],
        "slowest": _number(manifest.get("slowest") or 0),
        "seconds": {key: _number(seconds.get(key) or 0) for key in ("import", "build", "total")},
    }
