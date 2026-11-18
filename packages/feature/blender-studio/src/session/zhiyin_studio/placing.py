"""
Where an object is and what it hangs from: where an answer says it is, attaching and detaching
it where it is in the world, and refusing a part a stretch would slant.
"""

import bpy
import mathutils

from .arguments import need
from .errors import Refused
from .finding import is_helper, subjects
from .geometry import heights_text, own_size
from .keys import curves_of, shift_keys
from .overlaps import into_text
from .scales import even, wrap_text
from .wording import point_text, size_text, turned_text


def placed(obj, most_into=None):
    """
    Where an object is, as an answer says it: its size, its origin, its bottom
    and top, and what it goes into, or the deepest `most_into` of those.
    """
    bpy.context.view_layer.update()
    size = own_size(obj)
    parts = [f"{obj.name} ({size_text(size) if size is not None else 'no size'}) at {point_text(obj.matrix_world.translation)}"]
    turned = turned_text(obj)
    if turned:
        parts.append(turned)
    bent = wrap_text(obj)
    if bent:
        parts.append(bent)
    heights = heights_text(obj)
    if heights:
        parts.append(heights)
    parts += into_text(obj, subjects(), most_into)
    return ", ".join(parts)


def attach(obj, parent):
    """
    Attaches an object to another where it is in the world, even if both were
    placed a moment ago, and answers what it says of its keys.
    """
    need(parent is not obj, f"“{obj.name}” cannot be attached to itself.")
    above = parent.parent
    while above is not None:
        need(above is not obj, f"“{obj.name}” cannot be attached to “{parent.name}”, which is attached to it.")
        above = above.parent
    notes = reparent(obj, parent)
    unslanted_on(obj, "Attach it to something stretched evenly, or turn it square to it first.")
    return notes


def slanting(obj):
    """
    What an object hangs from that is stretched unevenly, now or by keys,
    and the first of it and its attached parts that stretch would slant: one
    turned on it now or by keys. Cutters are left out, as their holes stretch
    with their parts. Nothing when none would be.
    """
    bpy.context.view_layer.update()
    for holder in parent_chain(obj):
        if not stretched_unevenly(holder):
            continue
        for part in (obj, *obj.children_recursive):
            if is_helper(part) or cuts_its_parent(part):
                continue
            if not square_to(holder, part) or turns_by_keys(part, holder):
                return holder, part
    return None


def unslanted_on(obj, advice):
    """Refuses an object, or a part attached to it, turned on something stretched unevenly, which slants it."""
    found = slanting(obj)
    if found:
        holder, part = found
        raise Refused(
            f"“{part.name}” is turned on “{holder.name}”, and “{holder.name}” is stretched unevenly, now or by "
            f"keys, which would slant it. {advice}"
        )


def reparent(obj, parent):
    """
    Attaches an object to `parent`, or to nothing, keeping where it is in the
    world. Its keyed places were made on its old holder's axes, so they move
    with it to the new one's, and it moves as it did; a holder turned or
    stretched from the old one would turn its motion, and is refused. Answers
    what it says of the keys: that they are now on the new axes, when either
    holder moves by keys of its own and its motion is no longer theirs.
    """
    bpy.context.view_layer.update()
    old = obj.parent
    world = obj.matrix_world.copy()
    frame_before = world @ obj.matrix_basis.inverted_safe()
    keyed = keyed_paths(obj) & TRANSFORM_PATHS
    obj.parent = parent
    obj.matrix_world = world
    bpy.context.view_layer.update()
    if not keyed:
        return []
    frame_after = obj.matrix_world @ obj.matrix_basis.inverted_safe()
    change = frame_after.inverted_safe() @ frame_before
    moves_only = all(abs(change[r][c] - (1.0 if r == c else 0.0)) <= 1e-6 for r in range(3) for c in range(3))
    where = f"on “{parent.name}”" if parent is not None else "in the world"
    need(
        moves_only,
        f"“{obj.name}” moves by keys, and its axes {where} are turned or stretched from those its keys were made "
        "on, which would turn its motion. Clear its keys first, then key it again.",
    )
    shift_keys(obj, "location", list(change.translation))
    holders = [h for h in (*([old] if old else []), *parent_chain(old or obj), *parent_chain(obj)) if h is not None]
    if any(keyed_paths(h) & TRANSFORM_PATHS for h in holders):
        return [f"its keys now move it on {parent.name if parent else 'the world'}'s axes"]
    return []


def parent_chain(obj):
    """What an object is attached to, and what that is attached to, up to the scene."""
    chain = []
    node = obj.parent
    while node is not None:
        chain.append(node)
        node = node.parent
    return chain


def place_in_world(obj, location=None, turn=None):
    """Sets where an object is, or how it is turned, in the world's terms, whatever it is attached to."""
    bpy.context.view_layer.update()
    here, rotated, scaled = obj.matrix_world.decompose()
    obj.matrix_world = mathutils.Matrix.LocRotScale(
        here if location is None else location,
        rotated if turn is None else turn.to_quaternion(),
        scaled,
    )


def square_to(group, part):
    """Whether a part's axes lie along its group's, so stretching the group stretches it square."""
    relative = (group.matrix_world.inverted_safe() @ part.matrix_world).to_3x3()
    for column in range(3):
        axis = mathutils.Vector([relative[row][column] for row in range(3)])
        if axis.length < 1e-12:
            continue
        axis.normalize()
        if max(abs(v) for v in axis) < 1 - 1e-6:
            return False
    return True


def cuts_its_parent(part):
    """A part that cuts a hole in what it is attached to: one of its cutters, or one its booleans use."""
    return part.parent is not None and (
        is_helper(part) or any(m.type == "BOOLEAN" and m.object == part for m in part.parent.modifiers)
    )


TRANSFORM_PATHS = {"location", "rotation_euler", "rotation_quaternion", "rotation_axis_angle", "scale"}


def turns_by_keys(part, within=None):
    """Whether a part, or what it is attached to below `within`, turns by keys, and so is turned at some moment."""
    node = part
    while node is not None and node is not within:
        if any(path.startswith("rotation") for path in keyed_paths(node)):
            return True
        node = node.parent
    return False


def slanted_by(group):
    """
    The parts within a group an uneven stretch of it would slant: those turned
    within it now or by keys, but for cutters, whose holes stretch with their
    parts.
    """
    return [
        d.name
        for d in group.children_recursive
        if not cuts_its_parent(d) and (not square_to(group, d) or turns_by_keys(d, group))
    ]


def stretched_unevenly(obj):
    """Whether an object's scale is uneven, now or at any of its keys."""
    if not even([abs(s) for s in obj.scale]):
        return True
    curves = [c for c in curves_of(obj) if c.data_path == "scale"]
    frames = {key.co.x for curve in curves for key in curve.keyframe_points}
    for frame in frames:
        scale = list(obj.scale)
        for curve in curves:
            scale[curve.array_index] = curve.evaluate(frame)
        if not even([abs(s) for s in scale]):
            return True
    return False


def keyed_paths(obj):
    return {curve.data_path for curve in curves_of(obj)}


def tree(obj):
    """An object with everything attached to it, its cutters included."""
    return [obj, *obj.children_recursive]
