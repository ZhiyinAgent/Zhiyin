"""
The scene's objects as the tools name them: found by name or by pattern, with what each pattern
named said at the head of the answer, the helpers left out, and the collections the session keeps.
"""

import re

import bpy

from .arguments import need
from .errors import Refused

CUTTERS = "Cutters"
LIGHTING = "Lighting"
PREVIEW = "Zhiyin preview"
# Kept on what fills a plan's cut: the name of the shape it was cut from.
CUT_OF = "zhiyin_cut_of"


def scene():
    return bpy.context.scene


def in_collection(obj, name):
    return any(c.name == name for c in obj.users_collection)


def is_helper(obj):
    """Objects that serve the scene rather than appear in it."""
    return in_collection(obj, CUTTERS) or obj.name.startswith(PREVIEW)


def is_backdrop(obj):
    """The product lighting's backdrop, which its preset marks, whatever it is named."""
    return bool(obj.get("zhiyin_preset")) and obj.type == "MESH"


def scene_objects():
    return [o for o in scene().objects if not o.name.startswith(PREVIEW)]


def find_object(name, kinds=None):
    need(isinstance(name, str) and name.strip(), "Name an object.")
    found = bpy.data.objects.get(name)
    if found is None or found.name not in scene().objects:
        names = [o.name for o in scene_objects() if not is_helper(o)][:40]
        listed = f" The scene has: {', '.join(names)}." if names else " The scene is empty."
        raise Refused(f"There is no object named “{name}”.{listed}")
    if kinds:
        need(found.type in kinds, f"“{name}” is a {found.type.lower()}, and this needs a {' or '.join(k.lower() for k in kinds)}.")
    return found


# What each name written as a pattern stood for in this command, said at the
# head of its answer, so what a pattern named is never left to guess.
_patterns_named = []


def forget_patterns():
    """Each command starts with no pattern said."""
    _patterns_named.clear()


def patterns_said():
    """Each pattern this command was given and the objects it named, a line each."""
    lines = []
    for pattern, objects, passed in _patterns_named:
        names = [o.name for o in objects]
        shown = names if len(names) <= 60 else names[:60] + [f"{len(names) - 60} more"]
        line = f"{pattern} named {len(names)} object{'s' if len(names) != 1 else ''}: {', '.join(shown)}."
        if passed:
            line += " Left out, as this cannot take them: " + ", ".join(f"{o.name} ({kind_of(o)})" for o in passed[:12])
            line += f" and {len(passed) - 12} more." if len(passed) > 12 else "."
        lines.append(line)
    return "\n".join(lines)


def kind_of(obj):
    """What sort of object it is, in words: a mesh, an empty."""
    kind = obj.type.lower()
    return f"{'an' if kind[0] in 'aeiou' else 'a'} {kind}"


def pattern_of(name):
    """The pattern a name written between slashes stands for, matching whole names; None for a plain name."""
    if not (isinstance(name, str) and len(name) > 2 and name.startswith("/") and name.endswith("/")):
        return None
    try:
        return re.compile(name[1:-1])
    except re.error as error:
        raise Refused(f"{name} is not a pattern: {error}.") from None


def find_objects(names, kinds=None):
    """
    The objects named, in order and each once: a name written between
    slashes, such as /Spring_.*/, stands for every object whose whole name it
    matches, in the scene's order. A pattern that matches none is refused.
    """
    found = {}
    for name in names:
        pattern = pattern_of(name)
        if pattern is None:
            obj = find_object(name, kinds)
            found.setdefault(obj.name, obj)
            continue
        named = [o for o in scene_objects() if not is_helper(o) and pattern.fullmatch(o.name)]
        if not named:
            names_here = [o.name for o in scene_objects() if not is_helper(o)][:40]
            listed = f" The scene has: {', '.join(names_here)}." if names_here else " The scene is empty."
            raise Refused(f"{name} matches no object's whole name.{listed}")
        matched = [o for o in named if not kinds or o.type in kinds]
        need(
            matched,
            f"{name} matches only objects this cannot take: "
            + ", ".join(f"{o.name} ({kind_of(o)})" for o in named[:12])
            + f"; it needs a {' or '.join(k.lower() for k in sorted(kinds or []))}.",
        )
        _patterns_named.append((name, matched, [o for o in named if o not in matched]))
        for obj in matched:
            found.setdefault(obj.name, obj)
    return list(found.values())


def unused_name(name):
    need(isinstance(name, str) and name.strip(), "Each object needs a name.")
    need(bpy.data.objects.get(name) is None, f"An object named “{name}” already exists. Choose another name, or edit it.")
    return name


def collection(name, hide_render=False):
    found = bpy.data.collections.get(name)
    if found is None:
        found = bpy.data.collections.new(name)
        scene().collection.children.link(found)
    found.hide_render = hide_render
    return found


def link(obj, into=None):
    (into or scene().collection).objects.link(obj)
    return obj


def subjects():
    """What a picture is of: shapes, without the lights' backdrop or helpers."""
    return [o for o in scene_objects() if not is_helper(o) and not o.hide_render and not in_collection(o, LIGHTING)]
