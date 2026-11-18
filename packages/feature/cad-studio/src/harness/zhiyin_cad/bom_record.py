"""
What a parts list and a hole's callout read beside the parts' geometry,
recorded in the run of the script and handed to the run that measures: each
shown part that is one of bd_warehouse's standard parts, by its class and
size, and each hole bd_warehouse's TapHole, ThreadedHole, ClearanceHole or
InsertHole made in a BuildPart, by where it is, which way it goes in and the
thread or fastener it is for, and each gear's figures, which say how it
meshes. The geometry alone cannot say that a hole is
tapped, nor which screw a part is, so these are taken from the classes that
made them; a hole made outside a BuildPart, or a part moved after its holes
were made, is not matched, and the drawing says so. The record is plain data,
written beside the parts and read back checked, with nothing that could run.
"""

import inspect
import json
import math
import os
import re

from . import gears, interception

FILE = "bought.json"
# The largest record read: names, sizes and points, never geometry.
LARGEST = 4 * 1024 * 1024
# bd_warehouse's hole classes and the kind of hole each makes.
HOLE_KINDS = {"TapHole": "tapped", "ThreadedHole": "threaded", "ClearanceHole": "clearance", "InsertHole": "insert"}
# What a standard part's record keeps: its size, its standard, its length.
_SIZES = ("screw_size", "nut_size", "washer_size", "bearing_size", "thread_size")

_holes = []


class Unreadable(Exception):
    """The record beside the parts is not one as this run writes it."""


def _vector(location, z):
    """Where a location puts a point of its own (0, 0, z), as three numbers."""
    import build123d as bd

    at = (location * bd.Location((0, 0, z))).position
    return [float(at.X), float(at.Y), float(at.Z)]


def _thread(fastener):
    """A fastener's thread as numbers: its diameter and pitch in mm, and whether it is metric."""
    diameter = getattr(fastener, "thread_diameter", None)
    pitch = getattr(fastener, "thread_pitch", None)
    if not isinstance(diameter, (int, float)) or not isinstance(pitch, (int, float)):
        return None
    return {"diameter": float(diameter), "pitch": float(pitch), "metric": bool(getattr(fastener, "is_metric", True))}


def _recording(name, kind):
    signature = []

    def made(self, args, kwargs, result, caller):
        try:
            if not signature:
                from bd_warehouse import fastener as fasteners

                # The class's own, past the interception's wrapper.
                signature.append(inspect.signature(getattr(fasteners, name).__init__))
            given = signature[0].bind(self, *args, **kwargs)
            given.apply_defaults()
            fastener = given.arguments.get("fastener")
            material = given.arguments.get("material")
            fit = given.arguments.get("fit")
            drilled = None
            if kind == "tapped" and material in getattr(fastener, "tap_hole_diameters", {}):
                drilled = float(fastener.tap_hole_diameters[material])
            elif kind == "threaded":
                drilled = float(fastener.thread_diameter)
            elif kind == "clearance" and fit in getattr(fastener, "clearance_hole_diameters", {}):
                drilled = float(fastener.clearance_hole_diameters[fit])
            thread = _thread(fastener)
            for location in self._get_object_locations():
                start, inward = _vector(location, 0.0), _vector(location, -1.0)
                _holes.append(
                    {
                        "kind": kind,
                        "at": start,
                        "way": [b - a for a, b in zip(start, inward)],
                        "drilled": drilled,
                        "depth": float(getattr(self, "hole_depth", 0.0) or 0.0),
                        "thread": thread,
                        "fastener": f"{type(fastener).__name__} {getattr(fastener, 'thread_size', '')}".strip(),
                    }
                )
        except Exception:  # noqa: BLE001 - a hole not recorded is only a callout that cannot name its thread
            pass

    return made


for _name, _kind in HOLE_KINDS.items():
    interception.sees(("bd_warehouse.fastener", _name, "__init__"), _recording(_name, _kind))


def start():
    """Records from now on in this process the holes bd_warehouse's hole classes make, and the figures of its gears, while the libraries are held."""
    _holes.clear()
    gears.start()


def holes_made():
    """The holes recorded so far, each once."""
    seen, out = set(), []
    for one in _holes:
        key = json.dumps(one, sort_keys=True)
        if key not in seen:
            seen.add(key)
            out.append(dict(one))
    return out


def _words(name):
    """A class's name as words: SocketHeadCapScrew is socket head cap screw."""
    return re.sub(r"(?<=[a-z])(?=[A-Z])", " ", name).lower()


def bought_of(shape):
    """
    A shown part as a standard part: its bd_warehouse class and module, its
    size and standard, and its length where it has one; nothing for a part
    of the script's own.
    """
    cls = type(shape)
    module = cls.__module__ or ""
    if not module.startswith("bd_warehouse."):
        return None
    size = next((getattr(shape, key) for key in _SIZES if isinstance(getattr(shape, key, None), str)), "")
    standard = getattr(shape, "fastener_type", None) or getattr(shape, "bearing_type", None) or ""
    length = getattr(shape, "length", None)
    return {
        "class": cls.__name__,
        "module": module.rpartition(".")[2],
        "size": str(size),
        "standard": str(standard),
        "length": float(length) if isinstance(length, (int, float)) and not isinstance(length, bool) else None,
    }


def write(folder, parts, holes):
    """Writes the record of the parts shown, the gears each keeps and the holes made beside the parts."""
    bought, kept = {}, {}
    for name, shape in parts:
        found = bought_of(shape)
        if found is not None:
            bought[name] = found
        carried = gears.carried(shape)
        if carried:
            kept[name] = carried
    with open(os.path.join(folder, FILE), "w", encoding="utf-8") as out:
        json.dump({"bought": bought, "gears": kept, "holes": holes}, out)


_read = {"bought": {}, "gears": {}, "holes": []}


def bought():
    """Each shown part that is a standard part, by its name, as read back."""
    return _read["bought"]


def kept_gears():
    """The gears each shown part keeps, by its name, in the order shown, as read back."""
    return _read["gears"]


def holes():
    """Each hole bd_warehouse's hole classes made, as read back."""
    return _read["holes"]


def _text(value):
    if not isinstance(value, str) or len(value) > 200:
        raise Unreadable("a name or a size is not text")
    return value


def _number(value, empty=False):
    if value is None and empty:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise Unreadable("a number is not one")
    return float(value)


def _point(value):
    if not isinstance(value, list) or len(value) != 3:
        raise Unreadable("a point is not one")
    return [_number(v) for v in value]


def load(folder, names):
    """
    Reads the record beside the parts, checked, of the parts named; a run
    that wrote none has none. Raises Unreadable for one not as written.
    """
    _read["bought"], _read["gears"], _read["holes"] = {}, {}, []
    path = os.path.join(folder, FILE)
    if not os.path.isfile(path):
        return
    if os.path.islink(path) or os.path.getsize(path) > LARGEST:
        raise Unreadable("the record of standard parts is not one this run wrote")
    with open(path, encoding="utf-8") as given:
        try:
            record = json.load(given)
        except ValueError:
            raise Unreadable("the record of standard parts is not JSON") from None
    if not isinstance(record, dict) or not isinstance(record.get("bought"), dict) or not isinstance(record.get("holes"), list):
        raise Unreadable("the record of standard parts is not one")
    for name, one in record["bought"].items():
        if name not in names or not isinstance(one, dict):
            raise Unreadable("a standard part is of no part shown")
        _read["bought"][name] = {
            "class": _text(one.get("class")),
            "module": _text(one.get("module")),
            "size": _text(one.get("size")),
            "standard": _text(one.get("standard")),
            "length": _number(one.get("length"), empty=True),
        }
    kept = record.get("gears", {})
    if not isinstance(kept, dict):
        raise Unreadable("the record of gears is not one")
    for name, found in kept.items():
        if name not in names or not isinstance(found, list):
            raise Unreadable("a gear is of no part shown")
        try:
            _read["gears"][name] = [gears.checked(one) for one in found]
        except ValueError as problem:
            raise Unreadable(str(problem)) from None
    for one in record["holes"]:
        if not isinstance(one, dict) or one.get("kind") not in HOLE_KINDS.values():
            raise Unreadable("a hole is not a record of one")
        thread = one.get("thread")
        if thread is not None and not (isinstance(thread, dict) and isinstance(thread.get("metric"), bool)):
            raise Unreadable("a hole's thread is not one")
        _read["holes"].append(
            {
                "kind": one["kind"],
                "at": _point(one.get("at")),
                "way": _point(one.get("way")),
                "drilled": _number(one.get("drilled"), empty=True),
                "depth": _number(one.get("depth")),
                "thread": None
                if thread is None
                else {"diameter": _number(thread.get("diameter")), "pitch": _number(thread.get("pitch")), "metric": thread["metric"]},
                "fastener": _text(one.get("fastener")),
            }
        )


def described(record):
    """A standard part as a parts list writes it: socket head cap screw ISO 4762 M6-1 × 20."""
    standard = record["standard"]
    named = re.sub(r"^(iso|din|en|asme|astm)(\d)", lambda m: f"{m.group(1).upper()} {m.group(2)}", standard) if standard else ""
    size = record["size"]
    length = f" × {record['length']:g}" if record["length"] else ""
    return " ".join(part for part in (_words(record["class"]), named, f"{size}{length}") if part)
