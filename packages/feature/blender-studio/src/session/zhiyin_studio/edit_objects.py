"""
blender_edit_objects: each object moved, turned (round its origin or another point), resized,
scaled, renamed, attached, hidden, set down, pushed against another or laid onto a point of it,
marked as flying, deleted, copied, set out along a path or given new shapes from a model file, its
keyed motion kept with it.
"""

import os

import bpy
import mathutils
import numpy

from .aiming import keeps_focus, reaim
from .arguments import location_of, need, number, positive_size, rotation, vector
from .contact import move_onto, push_against
from .copies import axis_of, axis_words, distribute, duplicate, pivot_of, shared_text, turned_round
from .errors import Refused
from .finding import find_object, is_helper, subjects, unused_name
from .geometry import heights_text, own_size
from .glass import lets_light_through_sheets
from .keys import shift_keys
from .layouts import lay_again, own_layout
from .loose import mark_flying
from .making import model_file
from .model_shapes import exact_size, slots_by_group, surfaces_of
from .overlaps import into_text
from .placing import attach, keyed_paths, place_in_world, placed, reparent, tree, unslanted_on
from .resizing import cutters_of, resize
from .resting import rest, resting_on
from .scales import built_scale
from .uv_checks import lays_picture
from .wood import lays_grain
from .wording import listed, point_text, size_text, turned_text

# How many copies of one edit are told by what they go into.
COPIES_SAID = 12


def in_words(names):
    """Names in a sentence: one, two joined by and, or a list ending in and; nothing for none."""
    names = list(names)
    return listed(names) if names else ""


def reshaped_from(obj, path, workspace):
    """
    An object and its parts given the shapes of the parts of the same names
    in a model file, each about the origin the file gives it: their place,
    turn, attachments, materials, steps and motion stay. Nothing of the file
    stays in the scene. Answers what changed, in words.
    """
    need(isinstance(path, str) and path, "shapes_from is a workspace model file.")
    meshes = [o for o in tree(obj) if o.type == "MESH" and not is_helper(o)]
    need(meshes, f"“{obj.name}” holds no shape to give a new one to.")
    # Out of the way while the file is read, so its parts arrive by their own
    # names, and named again once the file's objects are gone.
    names = {o: o.name for o in meshes}
    materials_before = set(bpy.data.materials)
    for index, o in enumerate(meshes):
        o.name = f"zhiyin reshaping {index}"
    try:
        group, parts = model_file(path, unused_name("zhiyin new shapes"), workspace)
        try:
            given, resized, kept, added = give_shapes(meshes, names, parts)
        finally:
            shapes = [p.data for p in parts if p.type == "MESH"]
            for part in [group, *parts]:
                bpy.data.objects.remove(part)
            for shape in shapes:
                if shape.users == 0:
                    bpy.data.meshes.remove(shape)
            for material in set(bpy.data.materials) - materials_before:
                if material.users == 0:
                    bpy.data.materials.remove(material)
    finally:
        for o, name in names.items():
            o.name = name
    need(given, f"{os.path.basename(path)} holds no part named as “{obj.name}” or its parts: it holds {in_words(added) or 'no shapes'}.")
    said = f"new shapes from {os.path.basename(path)} for {in_words(given)}, each keeping its place, turn, attachment, materials and motion"
    if resized:
        said += "; " + "; ".join(resized)
    if kept:
        said += f"; not in the file, so as they were: {in_words(kept)}"
    if added:
        said += f"; in the file and not here: {in_words(added)}, which blender_add_objects adds"
    return said


def give_shapes(meshes, names, parts):
    """
    Each of the scene's meshes, by its real name in `names`, given the shape of
    the file's part of that name. Answers the names given one, those that
    changed size and how, those the file lacks and the file's parts left over.
    """
    bpy.context.view_layer.update()
    found = {}
    for part in parts:
        if part.type == "MESH":
            # Named again by Blender only where another object holds its name.
            plain = part.name if part.name in names.values() else part.name.rsplit(".", 1)[0]
            found.setdefault(plain, part)
    given, resized, kept = [], [], []
    for o in meshes:
        name = names[o]
        new = found.pop(name, None)
        if new is None:
            kept.append(name)
            continue
        before = own_size(o)
        old = o.data
        exact_before = exact_size(o, old)
        shape = new.data
        # Its own materials on the new shape: each group of surfaces keeps the
        # material it had, in its slots; a shape with no groups, by slot number.
        # A shape with groups that had no materials keeps its own slots.
        grouped = surfaces_of(old) is not None and surfaces_of(shape) is not None
        if grouped and old.materials:
            chosen = [old.materials[i] for i in slots_by_group(old, shape)]
            # Clearing the slots puts every face in the first: each keeps its own.
            slots = numpy.empty(len(shape.polygons), dtype=numpy.int32)
            shape.polygons.foreach_get("material_index", slots)
            shape.materials.clear()
            for material in chosen:
                shape.materials.append(material)
            shape.polygons.foreach_set("material_index", slots)
        elif old.materials or surfaces_of(shape) is None:
            slots = numpy.empty(len(shape.polygons), dtype=numpy.int32)
            shape.polygons.foreach_get("material_index", slots)
            shape.materials.clear()
            for material in old.materials:
                shape.materials.append(material)
            shape.polygons.foreach_set("material_index", numpy.minimum(slots, max(len(old.materials) - 1, 0)))
        o.data = shape
        if old.users == 0:
            bpy.data.meshes.remove(old)
        bpy.context.view_layer.update()
        after = own_size(o)
        given.append(name)
        # Both sizes the CAD measured, when both shapes carry one: meshed again
        # more or less finely, an unchanged part is the same size.
        exact_after = exact_size(o, shape)
        if exact_before and exact_after:
            before, after = exact_before, exact_after
        if before and after and any(abs(a - b) > 1e-5 for a, b in zip(before, after)):
            resized.append(f"{name} changed from {size_text(before)} to {size_text(after)}")
    return given, resized, kept, sorted(found)


def hole_sizes(obj):
    """The size of each hole's cutter of an object, to tell what a resize did to its holes."""
    bpy.context.view_layer.update()
    return {cutter: own_size(cutter) for cutter in cutters_of(obj) if obj.type == "MESH"}


def holes_stretched(before):
    """Each hole a resize stretched out of its shape, measured on its cutter: a round hole turned oval among them."""
    bpy.context.view_layer.update()
    said = []
    for cutter, was in before.items():
        now = own_size(cutter)
        if was is None or now is None:
            continue
        kept = [now[i] / was[i] for i in range(3) if was[i] > 1e-9]
        if not kept or max(kept) <= min(kept) * (1 + 1e-4):
            continue
        round_before = abs(was[0] - was[1]) <= 1e-4 * max(was[0], was[1])
        said.append(
            f"its hole {cutter.name} stretched with it from {size_text(was)} to {size_text(now)}"
            + (", no longer round" if round_before and abs(now[0] - now[1]) > 1e-4 * max(now[0], now[1]) else "")
        )
    return said


def turn_about(obj, spec):
    """
    Turns an object round an axis through a point, or through another object's origin, as a door
    turns on its hinge: it moves as well as turns. Answers what it says of the turn.
    """
    need(isinstance(spec, dict), "turn_about is {point or object, axis, angle}.")
    need(
        (spec.get("point") is None) != (spec.get("object") is None),
        "turn_about takes a point or an object to turn round: one of them.",
    )
    angle = number(spec.get("angle"), "turn_about angle")
    need(abs(angle) > 1e-9, "turn_about angle must not be 0.")
    axis = axis_of(spec.get("axis", "z"), "turn_about axis")
    pivot, pivot_said = pivot_of(spec, "turn_about")
    bpy.context.view_layer.update()
    obj.matrix_world = turned_round(pivot, axis, angle) @ obj.matrix_world
    bpy.context.view_layer.update()
    reaim(obj)
    unslanted_on(obj, "Turn it square to it, or detach it first.")
    return f"turned {angle:g}° round {axis_words(axis)} through {pivot_said}"


@keeps_focus
@lets_light_through_sheets
@lays_grain
def edit_objects(args, scene_file):
    edits = args.get("edits")
    need(isinstance(edits, list) and edits, "edits must list at least one change.")
    said = []
    for edit in edits:
        need(isinstance(edit, dict), "Each edit is an object naming the object it changes.")
        obj = find_object(edit.get("object"))
        name = obj.name
        if edit.get("delete"):
            # What is attached goes with it, as a group's parts and a part's cutters do.
            parts = [o.name for o in tree(obj)[1:] if not is_helper(o)]
            for part in reversed(tree(obj)):
                bpy.data.objects.remove(part)
            said.append(f"{name}: deleted" + (f", with {', '.join(parts)}" if parts else ""))
            continue
        changes = []
        moved = False
        if edit.get("shapes_from") is not None:
            changes.append(reshaped_from(obj, edit["shapes_from"], args.get("workspace")))
        # Where its keys place it moves with a move, or the next frame would
        # put it back; a turn its keys would undo is refused.
        keyed = keyed_paths(obj)
        bpy.context.view_layer.update()
        placed_at = obj.location.copy()
        # Where it was, said beside where it is after: a move is told from what to what.
        started_at = obj.matrix_world.translation.copy()
        turning = [k for k in ("rotation", "turn_about", "align_to_surface") if edit.get(k) not in (None, False)]
        need(
            not turning or not any(path.startswith("rotation") for path in keyed),
            f"“{name}” turns by keys, which would turn it back at once. Key its turn with blender_animate, "
            "or clear its motion first.",
        )
        if edit.get("rename"):
            renamed = unused_name(edit["rename"])
            focused_by = [c for c in bpy.data.cameras if c.get("zhiyin_focus") == obj.name]
            obj.name = renamed
            for camera in focused_by:
                camera["zhiyin_focus"] = obj.name
            changes.append(f"renamed to {obj.name}")
        # Positions and turns are the world's, attached or not.
        if edit.get("location") is not None:
            # [x, y] for one set down after, from the height it is at now.
            place_in_world(obj, location=mathutils.Vector(location_of(edit, obj.matrix_world.translation.z)))
            reaim(obj)
            changes.append("moved")
            moved = True
        if edit.get("move_by") is not None:
            bpy.context.view_layer.update()
            place_in_world(obj, location=obj.matrix_world.translation + vector(edit["move_by"], "move_by"))
            reaim(obj)
            changes.append("moved")
            moved = True
        if edit.get("rotation") is not None:
            turned_before = (turned_text(obj) or "turned (0°, 0°, 0°)").removeprefix("turned ")
            place_in_world(obj, turn=rotation(edit["rotation"]))
            unslanted_on(obj, "Turn it square to it, or detach it first.")
            changes.append(f"turned from {turned_before}")
            moved = True
        if edit.get("turn_about") is not None:
            changes.append(turn_about(obj, edit["turn_about"]))
            moved = True
        resizing = edit.get("size") is not None or edit.get("scale") is not None
        sharing = obj.data.users if resizing and obj.type == "MESH" else 0
        holes = hole_sizes(obj) if resizing else {}
        # The layout adding laid, found before the resize, is laid again at the new proportions after it.
        laid_by = own_layout(obj) if resizing else None
        if edit.get("size") is not None:
            size = positive_size(edit["size"], "size")
            bpy.context.view_layer.update()
            # Along its own axes, as it was given when added.
            current = own_size(obj) or (0, 0, 0)
            need(all(c > 1e-9 for c in current), f"“{name}” is flat or empty, so it cannot be given a size; scale it instead.")
            changes.append(f"resized from {size_text(current)}")
            changes += resize(obj, [size[i] / current[i] for i in range(3)])
            # Steps such as walls thickened outward add a width that resizes
            # unlike the shape: resized again by what it misses, it reaches
            # it, unless that small a resize is one it refuses, when the size
            # it reached is the one said.
            for _ in range(4 if obj.type == "MESH" else 0):
                bpy.context.view_layer.update()
                now = own_size(obj)
                missed = [size[i] / now[i] for i in range(3)]
                if max(abs(m - 1) for m in missed) <= 1e-4:
                    break
                try:
                    resize(obj, missed, exact=True)
                except Refused:
                    break
            bpy.context.view_layer.update()
            reached = own_size(obj)
            if any(abs(reached[i] - size[i]) > 1e-4 * size[i] for i in range(3)):
                changes.append(f"reaching {size_text(reached)}, not the {size_text(size)} asked")
            moved = True
        if edit.get("scale") is not None:
            scale = positive_size(edit["scale"], "scale")
            built = built_scale(obj)
            need(all(abs(s) > 1e-9 for s in built), f"“{name}” is flattened to nothing, so it cannot be scaled; give it a size instead.")
            sized = own_size(obj)
            changes.append(f"scaled from {size_text(sized)}" if sized is not None else "scaled")
            changes += resize(obj, [scale[i] / built[i] for i in range(3)])
            moved = True
        changes += holes_stretched(holes)
        if sharing > 1 and obj.data.users == 1:
            others = sharing - 1
            changes.append(f"its mesh its own now, no longer shared with {others} other{'s' if others != 1 else ''}")
        # Said where a picture is laid by it, which the layout changes.
        if laid_by is not None and lay_again(obj, laid_by) and lays_picture(obj):
            changes.append("its picture laid out again at its new proportions")
        if edit.get("parent"):
            notes = attach(obj, find_object(edit["parent"]))
            changes.append(f"attached to {obj.parent.name}")
            changes += notes
        if edit.get("detach"):
            changes.append("detached")
            changes += reparent(obj, None)
        if edit.get("hidden") is not None:
            # With what is attached; cutters stay out of pictures either way.
            for part in tree(obj):
                if is_helper(part):
                    continue
                part.hide_render = bool(edit["hidden"])
                part.hide_viewport = bool(edit["hidden"])
            changes.append("hidden" if edit["hidden"] else "shown")
        on = resting_on(edit, name)
        need(
            on is None or edit.get("to") is None,
            f"“{name}” is set down by rest_on or moved onto a point by to: give one of them.",
        )
        if on is not None:
            changes.append(rest(obj, on, bool(edit.get("align_to_surface"))))
            moved = True
        # Pushed or laid against another last, so the gap said is the one it is left with.
        if edit.get("against") is not None:
            changes.append(push_against(obj, edit["against"]))
            moved = True
        if edit.get("to") is not None:
            changes.append(move_onto(obj, edit["to"]))
            moved = True
        if edit.get("flying") is not None:
            changes.append(mark_flying(obj, edit["flying"]))
        if "location" in keyed and edit.get("parent") is None and not edit.get("detach"):
            bpy.context.view_layer.update()
            shift = obj.location - placed_at
            if shift.length > 1e-9:
                shift_keys(obj, "location", list(shift))
                changes.append("its keyed motion moved with it")
        if moved and (obj.matrix_world.translation - started_at).length > 1e-9:
            moved_from = f"moved from {point_text(started_at)}"
            if "moved" in changes:
                changes[changes.index("moved")] = moved_from
                changes = [c for c in changes if c != "moved"]
            else:
                changes.append(moved_from)
        if edit.get("duplicate") is not None:
            made, how = duplicate(obj, edit["duplicate"])
            bpy.context.view_layer.update()
            # Where each copy landed and what it goes into there.
            copies = []
            for index, (root, label) in enumerate(made):
                if index >= COPIES_SAID:
                    copies.append(label)
                    continue
                heights = heights_text(root)
                copies.append(
                    ", ".join([f"{label} at {point_text(root.matrix_world.translation)}", *([heights] if heights else []), *into_text(root, subjects(), 3)])
                )
            changes.append(f"copied {how + ', ' if how else ''}as {'; '.join(copies)}")
            shared = shared_text(obj) if edit["duplicate"].get("linked") else None
            if shared:
                changes.append(shared)
        if edit.get("distribute") is not None:
            spread_out, said_of = distribute(obj, edit["distribute"])
            changes.append(said_of)
            for other in spread_out[1:]:
                changes += [f"{other.name} {line}" for line in into_text(other, subjects(), 3)]
            if edit["distribute"].get("linked"):
                shared = shared_text(obj)
                if shared:
                    changes.append(shared)
            moved = True
        need(changes, f"The edit of “{name}” changes nothing.")
        said.append(f"{name}: {', '.join(changes)}" + (f"; now {placed(obj)}" if moved else ""))
    return "\n".join(f"{line}." for line in said)
