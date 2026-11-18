"""
blender_rig's bones as list edits on an armature: bones added or changed by name at points in the world,
extruded, subdivided, duplicated with their children, renamed or removed, one side mirrored to the other
across the armature's own x = 0, and bones gathered into bone collections.
"""

import math
import re

import bpy
import mathutils

from .arguments import is_number, need, vector, whole
from .errors import Refused
from .finding import find_object, link, scene, unused_name

KINDS = ("extrude", "subdivide", "duplicate", "rename", "remove")
SIDES = {"L": re.compile(r"(^|[._\- ])(L|l)($|[._\- ])|Left|left|LEFT"), "R": re.compile(r"(^|[._\- ])(R|r)($|[._\- ])|Right|right|RIGHT")}


def armature_named(name, make):
    """The armature object named, made at the world's origin when `make` and there is none."""
    need(isinstance(name, str) and name.strip(), "armature names the armature object the bones go in.")
    found = bpy.data.objects.get(name)
    if found is not None and found.name in scene().objects:
        need(found.type == "ARMATURE", f"“{name}” is a {found.type.lower()}, not an armature.")
        return found, False
    if not make:
        find_object(name, {"ARMATURE"})
    data = bpy.data.armatures.new(unused_name(name))
    return link(bpy.data.objects.new(name, data)), True


class Editing:
    """The armature in edit mode for the length of a `with` block, with the world turned into its own space."""

    def __init__(self, obj):
        self.obj = obj
        self.inverse = obj.matrix_world.inverted()

    def __enter__(self):
        self.hidden = self.obj.hide_get()
        self.obj.hide_set(False)
        self.obj.hide_viewport = False
        bpy.context.view_layer.objects.active = self.obj
        bpy.ops.object.mode_set(mode="EDIT")
        return self

    def __exit__(self, *_):
        bpy.ops.object.mode_set(mode="OBJECT")
        self.obj.hide_set(self.hidden)

    @property
    def bones(self):
        return self.obj.data.edit_bones

    def local(self, value, name):
        return self.inverse @ vector(value, name)

    def bone(self, name, what):
        need(isinstance(name, str) and name.strip(), f"{what} names a bone.")
        found = self.bones.get(name)
        if found is None:
            known = [b.name for b in self.bones][:40]
            raise Refused(f"{self.obj.name} has no bone named “{name}”." + (f" It has: {', '.join(known)}." if known else " It has no bones yet."))
        return found


def set_bones(editing, items):
    """Adds or changes each bone listed, by name; a new bone needs a head (or a connected parent) and a tail."""
    need(isinstance(items, list) and items, "bones lists bones, each with a name.")
    names = []
    for i, item in enumerate(items):
        need(isinstance(item, dict), f"bones[{i}] is a bone: a name, a head and a tail.")
        name = item.get("name")
        need(isinstance(name, str) and name.strip(), f"bones[{i}] needs a name.")
        bone = editing.bones.get(name)
        made = bone is None
        if made:
            need("tail" in item, f"bones[{i}] ({name}) is a new bone and needs a tail.")
            need("head" in item or (item.get("parent") and item.get("connected")), f"bones[{i}] ({name}) is a new bone and needs a head, or a parent it is connected to.")
            bone = editing.bones.new(name)
            bone.use_deform = True
        parent = item.get("parent")
        if parent is not None:
            need(isinstance(parent, str), f"bones[{i}].parent names a bone, or is empty for none.")
            bone.parent = editing.bone(parent, f"bones[{i}].parent") if parent else None
            need(not parent or parent != name, f"{name} cannot be its own parent.")
        if "head" in item:
            bone.head = editing.local(item["head"], f"bones[{i}].head")
        if "tail" in item:
            bone.tail = editing.local(item["tail"], f"bones[{i}].tail")
        if "connected" in item:
            need(isinstance(item["connected"], bool), f"bones[{i}].connected is true or false.")
            need(not item["connected"] or bone.parent is not None, f"{name} is connected to no parent: give it a parent.")
            if item["connected"] and made and "head" not in item:
                bone.head = bone.parent.tail.copy()
            bone.use_connect = item["connected"]
        if "roll" in item:
            need(is_number(item["roll"]), f"bones[{i}].roll is in degrees.")
            bone.roll = math.radians(item["roll"])
        if "deform" in item:
            bone.use_deform = bool(item["deform"])
        need((bone.tail - bone.head).length > 1e-5, f"{name}'s head and tail are in the same place: a bone needs a length.")
        if item.get("collection"):
            assign(editing.obj.data, item["collection"], [bone.name])
        names.append(bone.name)
    return names


def assign(armature, collection_name, bone_names):
    """Puts the bones into the bone collection of that name, made when there is none."""
    need(isinstance(collection_name, str) and collection_name.strip(), "A bone collection needs a name.")
    found = armature.collections_all.get(collection_name) or armature.collections.new(collection_name)
    for name in bone_names:
        found.assign(armature.edit_bones.get(name) or armature.bones[name])
    return found


def children_of(bone):
    return [b for b in bone.id_data.edit_bones if b.parent == bone]


def edit_bones(editing, items):
    """Each list edit in order; the names of the bones each made, renamed or removed."""
    need(isinstance(items, list) and items, "bone_edits lists edits, each naming a bone and its kind.")
    said = []
    for i, item in enumerate(items):
        need(isinstance(item, dict), f"bone_edits[{i}] names a bone and a kind.")
        kind = item.get("kind")
        need(kind in KINDS, f"bone_edits[{i}].kind is one of {', '.join(KINDS)}.")
        bone = editing.bone(item.get("bone"), f"bone_edits[{i}].bone")
        said.append(EDITS[kind](editing, bone, item, f"bone_edits[{i}]"))
    return said


def extrude(editing, bone, item, where):
    need("to" in item, f"{where} extrudes {bone.name}: give to, the point its new bone reaches.")
    name = item.get("name") or next_name(editing, bone.name)
    need(editing.bones.get(name) is None, f"{where}: {editing.obj.name} already has a bone named “{name}”.")
    new = editing.bones.new(name)
    new.head = bone.tail.copy()
    new.tail = editing.local(item["to"], f"{where}.to")
    need((new.tail - new.head).length > 1e-5, f"{where}.to is {bone.name}'s tail: the new bone needs a length.")
    new.parent, new.use_connect, new.use_deform = bone, True, bone.use_deform
    new.align_roll(bone.z_axis)
    for collection in bone.collections:
        collection.assign(new)
    return f"extruded {name} from {bone.name}'s tail"


def subdivide(editing, bone, item, where):
    count = whole(item.get("count"), f"{where}.count", minimum=2, maximum=32)
    name, head, tail, roll = bone.name, bone.head.copy(), bone.tail.copy(), bone.roll
    below = children_of(bone)
    pieces = [bone]
    for k in range(1, count):
        piece_name = next_name(editing, name)
        piece = editing.bones.new(piece_name)
        piece.use_deform, piece.roll = bone.use_deform, roll
        for collection in bone.collections:
            collection.assign(piece)
        pieces.append(piece)
    for k, piece in enumerate(pieces):
        piece.head = head.lerp(tail, k / count)
        piece.tail = head.lerp(tail, (k + 1) / count)
        piece.roll = roll
        if k:
            piece.parent, piece.use_connect = pieces[k - 1], True
    for child in below:
        connected = child.use_connect
        child.parent = pieces[-1]
        child.use_connect = connected
    return f"subdivided {name} into {', '.join(p.name for p in pieces)}"


def duplicate(editing, bone, item, where):
    offset = mathutils.Vector(vector(item.get("offset"), f"{where}.offset", default=(0, 0, 0)))
    offset = editing.inverse.to_3x3() @ offset
    replace = item.get("replace")
    if replace is not None:
        need(isinstance(replace, list) and len(replace) == 2 and all(isinstance(r, str) for r in replace) and replace[0], f"{where}.replace is [text in the names, text it becomes].")
    family = [bone, *bone.children_recursive]
    names = {}
    for old in family:
        new_name = old.name.replace(replace[0], replace[1]) if replace else next_name(editing, old.name)
        need(new_name != old.name, f"{where}.replace leaves {old.name}'s name as it is: copies need names of their own.")
        need(editing.bones.get(new_name) is None, f"{where}: {editing.obj.name} already has a bone named “{new_name}”.")
        names[old.name] = new_name
    copies = {}
    for old in family:
        new = editing.bones.new(names[old.name])
        new.head, new.tail, new.roll = old.head + offset, old.tail + offset, old.roll
        new.use_deform = old.use_deform
        for collection in old.collections:
            collection.assign(new)
        copies[old.name] = new
    for old in family:
        new = copies[old.name]
        new.parent = copies.get(old.parent.name) if old.parent and old.parent.name in copies else old.parent
        new.use_connect = old.use_connect and new.parent is not None
    return f"copied {bone.name}{' and the bones below it' if len(family) > 1 else ''} as {', '.join(names.values())}"


def rename(editing, bone, item, where):
    name = item.get("name")
    need(isinstance(name, str) and name.strip(), f"{where} renames {bone.name}: give name, its new name.")
    need(editing.bones.get(name) is None, f"{where}: {editing.obj.name} already has a bone named “{name}”.")
    old = bone.name
    bone.name = name
    return f"renamed {old} to {bone.name}"


def remove(editing, bone, item, where):
    name, parent = bone.name, bone.parent
    for child in children_of(bone):
        child.use_connect = False
        child.parent = parent
    editing.bones.remove(bone)
    return f"removed {name}" + (f", its children now under {parent.name}" if parent else "")


EDITS = {"extrude": extrude, "subdivide": subdivide, "duplicate": duplicate, "rename": rename, "remove": remove}


def next_name(editing, name):
    """Blender's way of naming a copy: the name with the next free .001, .002 … ending."""
    stem = re.sub(r"\.\d{3}$", "", name)
    for k in range(1, 1000):
        candidate = f"{stem}.{k:03d}"
        if editing.bones.get(candidate) is None:
            return candidate
    raise Refused(f"No free name is left for a copy of {name}.")


def side_of(name):
    """Which side a bone's name puts it on, L or R, by Blender's own naming; None for the middle."""
    if bpy.utils.flip_name(name) == name:
        return None
    return "L" if SIDES["L"].search(name) else "R" if SIDES["R"].search(name) else None


def symmetrize(editing, side):
    """
    Mirrors every bone named for one side across the armature's x = 0 onto the other side's names, as
    Blender's Symmetrize does: points mirrored, roll negated, parents and collections taken to the other side
    where it has them. Bones already on the other side are replaced. The names of the bones made.
    """
    need(side in ("L", "R"), "symmetrize is L or R: the side copied to the other.")
    sources = [b for b in editing.bones if side_of(b.name) == side]
    need(sources, f"{editing.obj.name} has no bone named for the {side} side (such as upper_arm.{side}) to mirror.")
    made = {}
    for bone in sources:
        name = bpy.utils.flip_name(bone.name)
        mirror = editing.bones.get(name)
        if mirror is None:
            mirror = editing.bones.new(name)
        made[bone.name] = mirror
    flipped = lambda v: mathutils.Vector((-v.x, v.y, v.z))
    for bone in sources:
        mirror = made[bone.name]
        mirror.head, mirror.tail, mirror.roll = flipped(bone.head), flipped(bone.tail), -bone.roll
        mirror.use_deform = bone.use_deform
        parent = bone.parent
        if parent is not None:
            other = editing.bones.get(bpy.utils.flip_name(parent.name))
            mirror.parent = other if other is not None else parent
        else:
            mirror.parent = None
        mirror.use_connect = bone.use_connect and mirror.parent is not None
        for collection in list(mirror.collections):
            collection.unassign(mirror)
        for collection in bone.collections:
            target = editing.obj.data.collections_all.get(bpy.utils.flip_name(collection.name)) or collection
            target.assign(mirror)
    return [m.name for m in made.values()]


def set_collections(obj, items):
    """Each bone collection listed, made when missing, given its bones and shown or hidden; the lines said."""
    need(isinstance(items, list) and items, "collections lists bone collections, each with a name.")
    armature = obj.data
    for i, item in enumerate(items):
        need(isinstance(item, dict) and isinstance(item.get("name"), str) and item["name"].strip(), f"collections[{i}] needs a name.")
        bones = item.get("bones") or []
        need(isinstance(bones, list), f"collections[{i}].bones lists bone names.")
        for name in bones:
            need(isinstance(name, str) and armature.bones.get(name) is not None, f"collections[{i}]: {obj.name} has no bone named “{name}”.")
        found = armature.collections_all.get(item["name"]) or armature.collections.new(item["name"])
        for name in bones:
            found.assign(armature.bones[name])
        if "visible" in item:
            found.is_visible = bool(item["visible"])
