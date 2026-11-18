"""
Which object after a change is which before it. Within one Blender an object keeps its session id
whatever it is renamed. A script runs in a Blender of its own, and the session loads the file it
saved, so every object is new to the session: the script's Blender marks each object it found, and
still holds after the script, with the name it had when the file was opened, and the session reads
and removes the marks. A copy the script made carries no mark, nor does an object Blender cannot
mark, as one linked from another file. An object with no mark is the one before it of its own name,
unless a marked object was that one.
"""

import bpy

# The property each object is marked with. Blender's panels leave out a property whose name starts
# with an underscore.
MARK = "_zhiyin_name_before_script"


def found():
    """Each object of the file as a script's Blender opened it, by its session id, with its name."""
    return {o.session_uid: o.name for o in bpy.data.objects if o.library is None}


def mark(before):
    """Marks each object of `before` still here with the name it had; a copy that carries a mark has it removed."""
    for obj in bpy.data.objects:
        if obj.library is not None:
            continue
        name = before.get(obj.session_uid)
        if name is not None:
            obj[MARK] = name
        elif MARK in obj:
            del obj[MARK]


def taken_marks():
    """The name each marked object had before the script, by its name now; the marks are removed."""
    former = {}
    for obj in bpy.data.objects:
        if obj.library is not None or MARK not in obj:
            continue
        was = obj[MARK]
        del obj[MARK]
        if isinstance(was, str):
            former[obj.name] = was
    return former


def paired(was, now, former):
    """
    Each name now with the name its object had before, for the objects that were there: as
    `former` names them, else by the same name, when no object of `former` had that name.
    """
    taken = set(former.values())
    pairs = {}
    for name in now:
        if name in former:
            if former[name] in was:
                pairs[name] = former[name]
        elif name in was and name not in taken:
            pairs[name] = name
    return pairs
