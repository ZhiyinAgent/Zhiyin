"""
What the installed CAD library accepts, read from it: a helper's, a
build123d name's or a bd_warehouse part's inputs and what they do, as the
library itself says, so a script is written for the version installed.
"""

import difflib
import importlib
import inspect

import build123d as bd

from . import helpers

# The most of a description told, in characters.
LONGEST = 6000
WAREHOUSE = (
    "bearing",
    "bushing",
    "fastener",
    "flange",
    "gear",
    "o_rings",
    "open_builds",
    "pipe",
    "retaining_ring",
    "shaft_key",
    "sprocket",
    "thread",
)


UPDATE = "Update the CAD studio from the 3D & Rendering plugin on the Plugins page."


class Unimportable(Exception):
    """A bd_warehouse module that is there to import but fails to, as in a CAD environment from an older release."""

    def __init__(self, module, error):
        super().__init__(f"{module} cannot be imported in this CAD environment ({error}). {UPDATE}")


def _warehouse(parts):
    """The bd_warehouse object a dotted path means and the deepest module on it, or Unimportable."""
    within, cut = None, len(parts)
    for depth in range(1, len(parts) + 1):
        module = ".".join(parts[:depth])
        try:
            within = importlib.import_module(module)
        except ModuleNotFoundError as error:
            # No module of that name under one that imported: the rest are names in that one.
            if depth > 1 and error.name == module:
                cut = depth - 1
                break
            raise Unimportable(module, error) from error
        except Exception as error:
            raise Unimportable(module, error) from error
    found = within
    for attribute in parts[cut:]:
        found = getattr(found, attribute, None)
        if found is None:
            break
    return found, within


def _found(name):
    """The object a name means: a helper, a build123d name, or a bd_warehouse module or name in one, with the module it was sought in."""
    plain = name.strip().removeprefix("build123d.").removeprefix("bd.")
    if plain in helpers.GIVEN:
        return helpers.GIVEN[plain], plain, None
    head, _, rest = plain.partition(".")
    if head in helpers.GIVEN and rest:
        # A helper's own function, as strength.shaft.
        found = getattr(helpers.GIVEN[head], rest, None)
        return found, plain if found is not None else None, None
    if name.strip().split(".")[0] == "bd_warehouse":
        found, within = _warehouse(name.strip().split("."))
        return found, name.strip() if found is not None else None, within
    found = bd
    for attribute in plain.split("."):
        found = getattr(found, attribute, None)
        if found is None:
            return None, None, None
    return found, f"build123d.{plain}", None


def _members(module):
    return sorted(n for n, v in vars(module).items() if not n.startswith("_") and inspect.isclass(v) and v.__module__ == module.__name__)


def _signature(found):
    try:
        return str(inspect.signature(found))
    except (TypeError, ValueError):
        return ""


def _near(name, within):
    """The names near one the library lacks: for a bd_warehouse path, the parts of the module it was sought in, or its modules."""
    last = name.strip().split(".")[-1]
    if name.strip().split(".")[0] != "bd_warehouse":
        known = list(helpers.GIVEN) + [n for n in dir(bd) if not n.startswith("_") and not inspect.ismodule(getattr(bd, n))] + [f"bd_warehouse.{m}" for m in WAREHOUSE]
        return difflib.get_close_matches(last, known, n=8, cutoff=0.55)
    if within is not None and within.__name__ != "bd_warehouse":
        members = {m: f"{within.__name__}.{m}" for m in _members(within)}
    else:
        members = {m: f"bd_warehouse.{m}" for m in WAREHOUSE}
    return [members[m] for m in difflib.get_close_matches(last, list(members), n=8, cutoff=0.55)]


def look_up(name, later=None):
    """
    What the library says of a name; `later` holds, by name, what a name
    only a later release has is answered with, for one this one lacks.
    """
    try:
        found, title, within = _found(str(name))
    except Unimportable as error:
        return f"Cannot look up {str(name).strip()}: {error}"
    if found is None and later and str(name) in later:
        return str(later[str(name)])
    if found is None:
        near = _near(str(name), within)
        return f"Nothing is named {name} in build123d, bd_warehouse or the helpers." + (
            f" Near it: {', '.join(near)}." if near else ""
        )
    helper = title.partition(".")[0] in helpers.GIVEN
    lines = [f"{title}{_signature(found)}" + (": a helper given to scripts, with no import" if helper else "")]
    if inspect.ismodule(found):
        lines.append(f"Parts in it: {', '.join(_members(found))}.")
    text = inspect.getdoc(found) or "It has no description."
    lines.append(text)
    if inspect.isclass(found):
        methods = [
            f"{n}{_signature(getattr(found, n))}"
            for n, v in inspect.getmembers(found)
            if not n.startswith("_") and callable(v) and getattr(v, "__qualname__", "").startswith(found.__name__ + ".")
        ][:30]
        if methods:
            lines.append("Its own methods: " + "; ".join(methods))
    said = "\n".join(lines)
    return said if len(said) <= LONGEST else said[:LONGEST] + "\n… (cut short)"
