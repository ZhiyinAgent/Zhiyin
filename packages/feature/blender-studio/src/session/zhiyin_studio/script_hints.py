"""
What a script's error leaves unsaid where Blender 5.2 changed an API that
scripts written for earlier Blenders use, said for the line that failed.
"""

import re

import bpy

# Blender's words for a subscript on data that keeps no custom properties.
NO_ID_PROPERTIES = ("doesn't support IDProperties", "id properties not supported")
# A subscript by a written name, and what it is taken from: mod["Socket_2"].
SUBSCRIPT = re.compile(r"([A-Za-z_][\w.]*)\s*\[\s*(['\"])(.+?)\2\s*\](\s*=(?!=))?")
SOCKET = re.compile(r"^Socket_\d+$")
# What a geometry-nodes input's other keys became in 5.2.
SUFFIXES = {
    "_use_attribute": ("type", "= 'ATTRIBUTE' to read it from an attribute, 'VALUE' for the value"),
    "_attribute_name": ("attribute_name", "= …"),
}


def node_sockets():
    """Each input and output of the node groups the scene's geometry-nodes modifiers use: (identifier, name, inputs or outputs, group)."""
    found = []
    for group in {m.node_group for o in bpy.data.objects for m in o.modifiers if m.type == "NODES" and m.node_group}:
        for item in group.interface.items_tree:
            if item.item_type == "SOCKET":
                found.append((item.identifier, item.name, "inputs" if item.in_out == "INPUT" else "outputs", group.name))
    return found


def node_input_form(error, line):
    """
    For a script that reads or sets a geometry-nodes modifier's input as
    mod["Socket_2"], which Blender 5.2 refuses: where that input is now.
    """
    if not isinstance(error, TypeError) or not any(words in str(error) for words in NO_ID_PROPERTIES):
        return ""
    sockets = node_sockets()
    for match in SUBSCRIPT.finditer(line):
        holder, key, setting = match.group(1), match.group(3), match.group(4)
        part, rest = "value", "= …" if setting else ""
        stem = key
        for suffix, (attribute, how) in SUFFIXES.items():
            if key.endswith(suffix):
                stem, part, rest = key[: -len(suffix)], attribute, how if setting else ""
        known = next((s for s in sockets if stem in (s[0], s[1])), None)
        if known is None and not SOCKET.match(stem):
            continue
        identifier, side = (known[0], known[2]) if known else (stem, "inputs")
        named = ""
        if known:
            other = known[1] if stem == identifier else identifier
            named = f"{stem} is the {side[:-1]} {other} of {known[3]}, "
        where = f"{holder}.properties.{side}.{identifier}.{part}"
        return (
            f"\nIn Blender 5.2 a geometry-nodes modifier's inputs are not read or set by {holder}[\"{key}\"]: "
            + named
            + (f"set as {where} {rest}" if setting else f"read as {where}")
            + f". getattr({holder}.properties.{side}, identifier) takes an identifier held in a variable."
        )
    return ""
