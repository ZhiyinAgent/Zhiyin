"""
What blender_rig's answer says of an armature's bones: each bone where it is in the world, its length,
roll, parent and whether it deforms, which mesh pieces it lies in and how far an end sticks out; its
chains from root to tip; the pairs named for the two sides and how nearly they mirror; its bone
collections.
"""

import math

import bpy
import mathutils

from .finding import subjects
from .mesh_math import closed, pieces
from .rig_bones_edit import side_of
from .shown_mesh import Triangles, triangles_of
from .wording import length, point_text

MOST_BONES = 40
# Points along a bone tested for the mesh they lie in: its head, its tail and three between.
ALONG = (0.0, 0.25, 0.5, 0.75, 1.0)
# How far apart a pair's points may be and still mirror.
MIRRORED = 0.0001


class Piece(Triangles):
    """One separate piece of a mesh object, closed, in world space, named by the object it is of."""

    def __init__(self, obj, corners, triangles, count):
        super().__init__(corners, triangles)
        self.obj = obj
        self.name = obj.name if count == 1 else f"{obj.name}'s piece round {point_text((self.low + self.high) / 2)}"

    def holds(self, point):
        return super().holds(point, margin=1e-6)


def closed_pieces(obj):
    """A mesh object's own evaluated shape split into its separate closed pieces."""
    found = [(c, t) for c, t in pieces(*triangles_of([obj])) if closed(t)]
    return [Piece(obj, c, t, len(found)) for c, t in found]


def scene_pieces():
    """Every closed piece of every mesh the scene shows."""
    return [piece for obj in subjects() if obj.type == "MESH" for piece in closed_pieces(obj)]


def world_ends(obj, bone):
    return obj.matrix_world @ bone.head_local, obj.matrix_world @ bone.tail_local


def roll_of(bone):
    """A bone's roll in degrees, as edit mode shows it."""
    return math.degrees(bpy.types.Bone.AxisRollFromMatrix(bone.matrix_local.to_3x3())[1])


def ordered(obj):
    """The bones from each root down, parents before their children."""
    found = []

    def walk(bone):
        found.append(bone)
        for child in bone.children:
            walk(child)

    for bone in obj.data.bones:
        if bone.parent is None:
            walk(bone)
    return found


def lies_in(obj, bone, pieces):
    """Which pieces a bone lies in, and how far either end sticks out of them."""
    head, tail = world_ends(obj, bone)
    points = [head.lerp(tail, t) for t in ALONG]
    holders = [[p for p in pieces if p.holds(point)] for point in points]
    middle = holders[2]
    if middle:
        said = f"lies in {' and '.join(p.name for p in middle)}"
        outside = [(end, point) for end, point, held in (("head", points[0], holders[0]), ("tail", points[-1], holders[-1])) if not set(held) & set(middle)]
        for end, point in outside:
            said += f", its {end} {length(min(p.gap(point) for p in middle))} outside"
        return said
    touched = {p.name: p for held in holders for p in held}
    if touched:
        return f"lies mostly outside every mesh, only partly in {' and '.join(touched)}"
    if not pieces:
        return "the scene has no closed mesh for it to lie in"
    nearest = min(pieces, key=lambda p: p.gap(points[2]))
    return f"lies in no mesh, its middle {length(nearest.gap(points[2]))} from {nearest.name}"


def bone_line(obj, bone, pieces):
    head, tail = world_ends(obj, bone)
    parts = [f"{bone.name}: {length((tail - head).length)} long from {point_text(head)} to {point_text(tail)}"]
    roll = round(roll_of(bone), 2) + 0.0
    parts.append(f"roll {roll:g}°")
    if bone.parent is None:
        parts.append("a root")
    elif bone.use_connect:
        parts.append(f"connected to {bone.parent.name}")
    else:
        gap = (obj.matrix_world @ bone.parent.tail_local - head).length
        parts.append(f"child of {bone.parent.name}, {length(gap)} from its tail")
    parts.append("deforms" if bone.use_deform else "does not deform")
    if bone.collections:
        parts.append(f"in {', '.join(c.name for c in bone.collections)}")
    return ", ".join(parts) + "; " + lies_in(obj, bone, pieces) + "."


def bone_lines(obj, pieces):
    bones = ordered(obj)
    lines = [bone_line(obj, bone, pieces) for bone in bones[:MOST_BONES]]
    if len(bones) > MOST_BONES:
        rest = bones[MOST_BONES:]
        lines.append(f"And {len(rest)} more bones: {', '.join(b.name for b in rest[:60])}{' …' if len(rest) > 60 else ''}.")
    return lines


def chain_lines(obj):
    """Each chain of bones from a root or a branch to where it ends or branches again, with its length."""
    lines = []

    def follow(start, branch_of):
        chain, bone = [start], start
        while len(bone.children) == 1:
            bone = bone.children[0]
            chain.append(bone)
        total = sum(b.length * obj.matrix_world.to_scale().x for b in chain)
        loose = [b.name for b in chain[1:] if not b.use_connect]
        line = f"Chain {'from the root' if branch_of is None else f'from {branch_of}'}: {' → '.join(b.name for b in chain)}, {length(total)}"
        if loose:
            line += f", not connected at {', '.join(loose)}"
        if bone.children:
            line += f"; it branches into {', '.join(c.name for c in bone.children)}"
        lines.append(line + ".")
        for child in bone.children:
            follow(child, bone.name)

    for bone in obj.data.bones:
        if bone.parent is None:
            follow(bone, None)
    return lines


def symmetry_lines(obj):
    """The bones named for the two sides as pairs, how nearly each mirrors across the armature's x = 0, and any alone."""
    bones = obj.data.bones
    pairs, alone, off = [], [], []
    for bone in bones:
        if side_of(bone.name) != "L":
            continue
        other = bones.get(bpy.utils.flip_name(bone.name))
        if other is None:
            alone.append(bone.name)
            continue
        pairs.append((bone, other))
        flip = lambda v: mathutils.Vector((-v.x, v.y, v.z))
        apart = max((flip(bone.head_local) - other.head_local).length, (flip(bone.tail_local) - other.tail_local).length)
        apart *= obj.matrix_world.to_scale().x
        if apart > MIRRORED:
            off.append(f"{bone.name} and {other.name} are {length(apart)} off mirroring")
    alone += [b.name for b in bones if side_of(b.name) == "R" and bones.get(bpy.utils.flip_name(b.name)) is None]
    if not pairs and not alone:
        return []
    lines = []
    if pairs:
        mirrored = len(pairs) - len(off)
        shown = ", ".join(f"{a.name}/{b.name}" for a, b in pairs[:12]) + (f" and {len(pairs) - 12} more" if len(pairs) > 12 else "")
        lines.append(f"Symmetry across the armature's x = 0: {len(pairs)} pair{'s' if len(pairs) != 1 else ''} ({shown}), {mirrored} mirroring within {length(MIRRORED)}" + (f"; {'; '.join(off[:12])}" if off else "") + ".")
    if alone:
        lines.append(f"Named for one side with no bone on the other: {', '.join(alone[:20])}.")
    return lines


def collection_lines(obj):
    found = list(obj.data.collections_all)
    if not found:
        return []
    said = [f"{c.name} ({len(c.bones)} bone{'s' if len(c.bones) != 1 else ''}{', hidden' if not c.is_visible else ''})" for c in found]
    return [f"Bone collections: {', '.join(said)}."]


def armature_lines(obj, made):
    """The whole answer on an armature after its bones changed."""
    count = len(obj.data.bones)
    deform = sum(1 for b in obj.data.bones if b.use_deform)
    head = f"{'Made' if made else 'Changed'} armature {obj.name} at {point_text(obj.matrix_world.translation)}: {count} bone{'s' if count != 1 else ''}, {deform} deforming."
    pieces = scene_pieces()
    return [head, *bone_lines(obj, pieces), *chain_lines(obj), *symmetry_lines(obj), *collection_lines(obj)]
