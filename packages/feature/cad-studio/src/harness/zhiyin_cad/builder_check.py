"""
Solids a script makes in algebra mode inside a builder's block and then
loses. A `with BuildPart()` block takes in what its own objects and
operations make; a solid an operator gives there, as `Pos(20, 0, 0) *
Box(5, 5, 5)`, or a shape's own fuse, cut or intersect, goes into no builder
unless the script adds it. One that nothing takes in afterwards, no builder,
no later operation and no show(), is lost without an error, and the build's
answer names where the script made it.

A solid is known by its shape in the kernel, wherever it is moved: a copy
placed by `Locations` or `Pos` is the same solid, so adding one in its place
takes it in. Only what was taken in after the solid was made counts.
"""

import itertools
import sys

import build123d as bd
from OCP.TopLoc import TopLoc_Location

from . import cut_check, interception

_scripts = None
# Each solid made, in the order made: where, the block it was made in, its solids' keys, its box and when.
made = []
# When each solid was last taken in, by its key.
taken = {}
_clock = itertools.count()

# The operators and methods that make a shape in algebra mode, by the class that holds them.
_MAKING = (
    ("Location", "__mul__", "an operator"),
    ("Shape", "__rmul__", "an operator"),
    ("Shape", "__add__", "an operator"),
    ("Shape", "__sub__", "an operator"),
    ("Shape", "__and__", "an operator"),
    ("Compound", "__add__", "an operator"),
    ("Compound", "__sub__", "an operator"),
    ("Compound", "__and__", "an operator"),
    ("Shape", "fuse", "fuse()"),
    ("Shape", "cut", "cut()"),
    ("Shape", "intersect", "intersect()"),
)


def _key(solid):
    """A solid as the kernel holds it, wherever it is placed."""
    return hash(solid.wrapped.Located(TopLoc_Location()))


def _solids(value):
    """The solids of a value an operation was handed: a shape, or a list of them."""
    if isinstance(value, bd.Shape):
        return value.solids() if value._wrapped is not None else []
    if isinstance(value, (list, tuple)):
        return [solid for item in value for solid in _solids(item)]
    return []


def _in_builder():
    """The builder whose block the script is in, when it builds a part."""
    builder = bd.Builder._get_context(None, False)
    return builder if isinstance(builder, bd.BuildPart) else None


def _place(frame):
    """Where a frame of the script's own files is, as the model knows it, or nothing for any other."""
    named = _scripts(frame.f_code.co_filename)
    if named is None:
        return None, None
    line = f"line {frame.f_lineno}" if named == "the script" else f"{named}:{frame.f_lineno}"
    place = f"{line} of the script" if named == "the script" else line
    if frame.f_code.co_name != "<module>":
        place += f" in {frame.f_code.co_name}"
    return place, line


def take(*values):
    """Notes that `values` were taken in now, by an operation, a builder or show()."""
    if not made:
        return
    now = next(_clock)
    for solid in _solids(list(values)):
        taken[_key(solid)] = now


def _making(how):
    def making(self, others, _, result, caller):
        if _scripts is None:
            return
        take(self, *others)
        if not isinstance(result, bd.Shape) or result._wrapped is None or result._dim != 3:
            return
        builder = _in_builder()
        if builder is None or getattr(builder, "_zhiyin_block", None) is None:
            return
        where, _ = _place(caller)
        if where is None or not result.solids():
            return
        made.append(
            {
                "where": where,
                "how": how,
                "block": builder._zhiyin_block,
                "keys": {_key(solid) for solid in result.solids()},
                "box": cut_check._plain_box(result),
                "middles": [tuple(solid.bounding_box(optimal=False).center()) for solid in result.solids()],
                "at": next(_clock),
            }
        )

    return making


def _added(self, objects, _, result, caller):
    if _scripts is not None:
        take(*objects)


def _new(cls, *_, **__):
    """
    A BuildPart that knows where its block begins, from the line that makes
    it. A builder finds the block it is in by the frames that make and enter
    it, so neither __init__ nor __enter__ is wrapped: object creation calls
    __new__ straight from the script's line.
    """
    builder = object.__new__(cls)
    builder._zhiyin_block = _place(sys._getframe(1))[1] if _scripts is not None else None
    return builder


for _owner, _name, _how in _MAKING:
    interception.sees(("build123d", _owner, _name), _making(_how))
interception.sees(("build123d", "Builder", "_add_to_context"), _added)
interception.gives(("build123d", "BuildPart", "__new__"), _new)


def start(scripts):
    """Watches the script's builders while the libraries are held; `scripts` names a file as the model knows it."""
    global _scripts
    _scripts = scripts
    made.clear()
    taken.clear()


def stop():
    global _scripts
    _scripts = None


def _within(points, shown):
    """Whether any of `points` lies inside a solid of the parts shown."""
    from OCP.BRepClass3d import BRepClass3d_SolidClassifier
    from OCP.gp import gp_Pnt
    from OCP.TopAbs import TopAbs_IN

    for part in shown:
        for solid in part.solids():
            box = solid.bounding_box(optimal=False)
            for point in points:
                if not all(lo <= v <= hi for v, lo, hi in zip(point, box.min, box.max)):
                    continue
                classifier = BRepClass3d_SolidClassifier(solid.wrapped, gp_Pnt(*point), 1e-6)
                if classifier.State() == TopAbs_IN:
                    return True
    return False


def lost(shown):
    """
    Notes each solid the script made inside a builder's block that nothing
    took in after it was made, nor `shown` holds, beside the build's joins
    and cuts that add or take nothing.
    """
    take(*shown)
    for one in made:
        if any(taken.get(key, -1) > one["at"] for key in one["keys"]):
            continue
        if _within(one["middles"], shown):
            # Its material is in a part shown, by a way not watched, as an algebra fillet of it.
            continue
        key = (one["where"], "lost")
        if key not in cut_check.empty:
            cut_check.empty[key] = {
                "where": one["where"],
                "what": "lost",
                "shape": (
                    f"a solid made with {one['how']} inside the BuildPart block at {one['block']}, {one['box']}, went into no part: "
                    "a builder takes in what its own objects and operations make, never what an operator such as * or + gives. "
                    "insert() it inside the block, or build the part in one mode."
                ),
                "times": 0,
            }
        cut_check.empty[key]["times"] += 1
    made.clear()
    taken.clear()
