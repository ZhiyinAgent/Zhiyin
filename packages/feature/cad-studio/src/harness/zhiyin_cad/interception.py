"""
The harness's one hold on build123d and bd_warehouse while a script runs.

To notice a cut that would break the part or takes nothing away, a join or
a cut with a shape of no volume, a solid lost from a builder, a hole or a
gear to list, and a fillet given edges of another shape, the checks watch
the libraries' own operations. Each operation watched is replaced here
once, while the script runs, by a wrapper that runs the library's own and
hands what it gave to each check that watches it; after the run every one
is put back. A check that may give the script another result than the
library's, as the cut check keeping a part whole, says so when it watches,
and runs before the checks that only see the result.

Every name replaced is in REPLACED; watching any other is refused. They are
proved against the library versions in PROVED_WITH by the real-library
tests, and a test holds PROVED_WITH to the versions the CAD environment's
lock pins, so moving the pin starts by running those tests on the new
versions, then moving PROVED_WITH with it.
"""

import importlib
import sys

# The versions every name below was last proved against with the real libraries.
PROVED_WITH = {"build123d": "0.13.0", "bd_warehouse": "0.4.0"}

# Each name replaced while a script runs: the module holding the class, the class, and the
# attribute. Those starting with an underscore are private to build123d.
REPLACED = (
    ("build123d", "Shape", "cut"),
    ("build123d", "Shape", "fuse"),
    ("build123d", "Shape", "intersect"),
    ("build123d", "Shape", "__add__"),
    ("build123d", "Shape", "__sub__"),
    ("build123d", "Shape", "__and__"),
    ("build123d", "Shape", "__rmul__"),
    ("build123d", "Compound", "__add__"),
    ("build123d", "Compound", "__sub__"),
    ("build123d", "Compound", "__and__"),
    ("build123d", "Location", "__mul__"),
    ("build123d", "Builder", "_add_to_context"),
    ("build123d", "BuildPart", "__new__"),
    ("build123d.topology.three_d", "Mixin3D", "fillet"),
    ("build123d.topology.three_d", "Mixin3D", "chamfer"),
    ("bd_warehouse.fastener", "TapHole", "__init__"),
    ("bd_warehouse.fastener", "ThreadedHole", "__init__"),
    ("bd_warehouse.fastener", "ClearanceHole", "__init__"),
    ("bd_warehouse.fastener", "InsertHole", "__init__"),
    ("bd_warehouse.gear", "SpurGear", "__init__"),
    ("bd_warehouse.gear", "HelicalGear", "__init__"),
)

# What watches each name: checks that may give another result, those that see it, and those that
# may put a clearer error in place of the library's.
_altering, _seeing, _failing = {}, {}, {}
# A name given a function of the check's own in place of the library's, which has none of its own.
_given = {}
# What each name held before the hold, to put back.
_held = {}


def _known(key):
    if key not in REPLACED:
        raise ValueError(f"{'.'.join(key)} is not among the names the harness replaces: add it to REPLACED.")
    return key


def alters(key, hook):
    """`hook(self, args, kwargs, result, caller)` may give another result than the library's."""
    _altering.setdefault(_known(key), []).append(hook)


def sees(key, hook):
    """`hook(self, args, kwargs, result, caller)` sees the result, as the checks that alter it left it."""
    _seeing.setdefault(_known(key), []).append(hook)


def fails(key, hook):
    """`hook(self, args, kwargs, error)` gives an error to raise in place of the library's, or nothing."""
    _failing.setdefault(_known(key), []).append(hook)


def gives(key, function):
    """Sets `function` in place of a name the class only inherits, as BuildPart's __new__."""
    _given[_known(key)] = function


def _owner(key):
    module, cls, _ = key
    try:
        return getattr(importlib.import_module(module), cls, None)
    except ImportError:
        # bd_warehouse may be missing a module in an older environment: its parts go unrecorded.
        return None


def _wrapped(original, key):
    altering, seeing, failing = _altering.get(key, []), _seeing.get(key, []), _failing.get(key, [])

    def wrapper(self, *args, **kwargs):
        caller = sys._getframe(1)
        try:
            result = original(self, *args, **kwargs)
        except Exception as error:
            for hook in failing:
                instead = hook(self, args, kwargs, error)
                if instead is not None:
                    raise instead from None
            raise
        for hook in altering:
            result = hook(self, args, kwargs, result, caller)
        for hook in seeing:
            hook(self, args, kwargs, result, caller)
        return result

    wrapper.__wrapped__ = original
    return wrapper


def hold():
    """Replaces every name watched, until `release`."""
    if _held:
        return
    for key in REPLACED:
        if key not in _altering and key not in _seeing and key not in _failing and key not in _given:
            continue
        owner = _owner(key)
        if owner is None:
            continue
        name = key[2]
        own = owner.__dict__.get(name)
        if key in _given:
            setattr(owner, name, _given[key])
        elif own is not None:
            setattr(owner, name, _wrapped(own, key))
        else:
            continue
        _held[key] = (owner, own)


def release():
    """Puts back what each name held before the hold."""
    for (_, _, name), (owner, own) in _held.items():
        if own is None:
            if name in owner.__dict__:
                delattr(owner, name)
        else:
            setattr(owner, name, own)
    _held.clear()
