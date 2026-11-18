"""
The installed CAD library's reference, read from it for the catalog's pages
(ADR 0024): build123d's public classes and functions, and the parts of each
bd_warehouse module, each with its signature and the library's own
description, and a class's methods and properties. Nothing of the library's
text ships with Zhiyin; this is read on the person's computer, from the
versions installed there.
"""

import enum
import importlib
import importlib.metadata
import inspect
import json
import os
import typing

import build123d as bd

from .api import WAREHOUSE

# The most of a page's text, in characters; past it, members are named only.
LONGEST = 24000
# The most of a member's description told on its class's page.
MEMBER = 600


def _forms(found):
    """Each signature a function is declared with: its overloads, else its own."""
    try:
        overloads = typing.get_overloads(found)
    except (AttributeError, TypeError):
        overloads = []
    for one in overloads or [found]:
        try:
            yield inspect.signature(one)
        except (TypeError, ValueError):
            continue


def _signature(found):
    """A function's signatures, or a class's as its constructor declares them, without self."""
    if inspect.isclass(found):
        forms = [
            form.replace(parameters=list(form.parameters.values())[1:])
            for form in _forms(found.__init__)
            if form.parameters
        ]
    else:
        forms = list(_forms(found))
    return " or ".join(str(form) for form in forms)


def _first(text, most=MEMBER):
    """A description's first paragraph, at most `most` characters."""
    paragraph = (text or "").strip().split("\n\n")[0].strip()
    return paragraph if len(paragraph) <= most else paragraph[: most - 1] + "…"


def _summary(found):
    line = _first(inspect.getdoc(found), 200).split("\n")[0].strip()
    return line or "No description."


def _library_class(cls):
    return isinstance(cls, type) and cls.__module__.split(".")[0] in ("build123d", "bd_warehouse")


def _defined_in(cls, name):
    for owner in cls.__mro__:
        if name in vars(owner):
            return owner
    return None


def _member(cls, name, owner):
    raw = vars(owner)[name]
    if isinstance(raw, property):
        return f"{name} (property): {_first(inspect.getdoc(raw))}".rstrip(": ")
    value = getattr(cls, name, None)
    if not callable(value):
        return None
    said = _first(inspect.getdoc(value))
    return f"{name}{_signature(value)}" + (f": {said}" if said else "")


def _class_page(cls, title, paged):
    """
    A class: its signature, its description, and its members. Members it
    takes from a class with a page of its own are named, pointing to it;
    the rest are each given with their signature and first paragraph.
    """
    lines = [f"class {title}{_signature(cls)}", inspect.getdoc(cls) or "It has no description."]
    if issubclass(cls, enum.Enum):
        lines.append("Members: " + ", ".join(member.name for member in cls))
        return lines, [member.name for member in cls]
    later = [base for base in cls.__mro__[1:] if base in paged]
    stop = cls.__mro__.index(later[0]) if later else len(cls.__mro__)
    own, inherited = [], {}
    for name in sorted(dir(cls)):
        if name.startswith("_"):
            continue
        owner = _defined_in(cls, name)
        if owner is None or not _library_class(owner):
            continue
        if not isinstance(vars(owner)[name], property) and not callable(getattr(cls, name, None)):
            continue
        if cls.__mro__.index(owner) < stop:
            told = _member(cls, name, owner)
            if told:
                own.append((name, told))
        else:
            # Named by the first class with a page that has it.
            nearest = next((base for base in later if hasattr(base, name)), later[0])
            inherited.setdefault(paged[nearest], []).append(name)
    if own:
        lines.append("Methods and properties:")
        size = sum(len(line) for line in lines)
        cut = []
        for name, told in own:
            if size + len(told) > LONGEST:
                cut.append(name)
                continue
            lines.append(f"- {told}")
            size += len(told)
        if cut:
            lines.append("Also, too many to describe here (look each up with cad_api): " + ", ".join(cut))
    for title_of, names in inherited.items():
        lines.append(f"From {title_of}, on its own page: " + ", ".join(names))
    return lines, [name for name, _ in own]


def _page(library, name, title, found, paged):
    if inspect.isclass(found):
        lines, terms = _class_page(found, title, paged)
        kind = "class"
    else:
        lines, terms = [f"{title}{_signature(found)}", inspect.getdoc(found) or "It has no description."], []
        kind = "function"
    return {"library": library, "name": name, "kind": kind, "summary": _summary(found), "terms": terms, "text": "\n".join(lines)}


def _public(module):
    names = getattr(module, "__all__", None) or [n for n in dir(module) if not n.startswith("_")]
    for name in sorted(set(names)):
        found = getattr(module, name, None)
        if inspect.isclass(found) or inspect.isfunction(found) or inspect.isbuiltin(found):
            yield name, found


def build():
    """Every page of the reference, with the versions it was read from."""
    pages = []
    exported = list(_public(bd))
    paged = {found: f"build123d.{name}" for name, found in exported if inspect.isclass(found)}
    warehouse = []
    for module_name in WAREHOUSE:
        module = importlib.import_module(f"bd_warehouse.{module_name}")
        own = [(name, found) for name, found in _public(module) if getattr(found, "__module__", "") == module.__name__]
        warehouse.append((module_name, module, own))
        for name, found in own:
            if inspect.isclass(found):
                paged.setdefault(found, f"bd_warehouse.{module_name}.{name}")
    for name, found in exported:
        pages.append(_page("build123d", name, f"build123d.{name}", found, paged))
    for module_name, module, own in warehouse:
        listed = [f"- {name}: {_summary(found)}" for name, found in own]
        pages.append(
            {
                "library": "bd_warehouse",
                "name": module_name,
                "kind": "module",
                "summary": _summary(module),
                "terms": [name for name, _ in own],
                "text": "\n".join([f"bd_warehouse.{module_name}", _first(inspect.getdoc(module)), "Parts in it:", *listed]),
            }
        )
        for name, found in own:
            pages.append(_page("bd_warehouse", f"{module_name}.{name}", f"bd_warehouse.{module_name}.{name}", found, paged))
    return {
        "versions": {
            "build123d": importlib.metadata.version("build123d"),
            "bd_warehouse": importlib.metadata.version("bd_warehouse"),
        },
        "pages": pages,
    }


def write(folder):
    with open(os.path.join(folder, "reference.json"), "w", encoding="utf-8") as out:
        json.dump(build(), out)
