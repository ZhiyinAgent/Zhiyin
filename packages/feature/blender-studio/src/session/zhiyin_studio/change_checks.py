"""
The checks after a call that changes the scene, on what the call changed,
by the kind of change: a shape changed is checked for faults in its faces
and how it lies in its picture; a shape moved, changed, added or taken
away is checked, with what stood against it, for floating, lying wholly
inside another and tipping over; a material changed or given is checked for
values no real surface has and pictures read wrongly. Only faults are said,
each with its count and where; a change with none says so in a few words.
How each object moved or added stands, on what or how far above it, is
said in one line, what touches nothing first.
A shape the call left no longer the same on both sides, as it was, is said
with how far it strays from its mirror. After a shaping step or a script,
the faces of each shape it changed are counted by their sides.
"""

import re
import time

import bpy
import mathutils
import numpy

from . import budget
from .cuts import NOTHING, Shape
from .finding import PREVIEW, is_helper, subjects
from .former_names import paired
from .geometry import SHAPE_TYPES, evaluated_graph, has_shape, held_still
from .loose import Checker
from .material_checks import material_faults, material_key
from .mesh_checks import face_kinds_text, mesh_faults
from .placement_checks import tipping, wholly_inside
from .soundness import soundness_text
from .support import standing, standing_text
from .symmetry_checks import symmetric_before, symmetry_lost
from .tolerances import HELD
from .uv_checks import layout_key, lays_picture, uv_faults
from .wording import enumerated, length, stems_text

# The calls whose changes are checked: those that make, shape, place or surface objects.
CHECKED = {"add", "edit", "shape", "material", "script"}
# The calls whose answers count the faces of each shape they changed by their sides.
COUNTED_FACES = {"shape", "script"}
# How long the checks of one call may take, in seconds, or half of what is left of the call's
# time when that is less; what is left is named unchecked.
SECONDS = 20
# How many objects left unchecked are named; the rest are counted.
NAMED = 6
# Past this many objects with faults, like faults are said together.
GROUPED_PAST = 12
# The most characters of faults an answer lists.
LONGEST = 6000
# Steps whose widths stretch with an object's scale.
WIDTH_STEPS = {"BEVEL", "SOLIDIFY", "ARRAY", "SCREW", "WIREFRAME"}


def _values(owner):
    """An object's or a step's settings, as values that compare: what a script may change on it."""
    held = []
    for prop in owner.bl_rna.properties:
        if prop.is_readonly or prop.type not in ("BOOLEAN", "INT", "FLOAT", "ENUM", "STRING", "POINTER"):
            continue
        value = getattr(owner, prop.identifier, None)
        if prop.type == "POINTER":
            value = getattr(value, "name", None)
        elif hasattr(value, "__len__") and not isinstance(value, str):
            value = tuple(value)
        held.append((prop.identifier, value))
    return tuple(held)


def _flags_key(data, key):
    """A true-or-false attribute of a mesh as a value that compares, or None where it has none."""
    attribute = data.attributes.get(key)
    if attribute is None or attribute.data_type != "BOOLEAN":
        return None
    values = numpy.zeros(len(attribute.data), dtype=bool)
    attribute.data.foreach_get("value", values)
    return hash(values.tobytes())


def _shape_key(obj):
    """What an object's own shape holds, to tell whether a call changed it."""
    data = obj.data
    if obj.type == "MESH":
        points = numpy.empty(len(data.vertices) * 3, dtype=numpy.float32)
        data.vertices.foreach_get("co", points)
        corners = numpy.empty(len(data.loops), dtype=numpy.int32)
        data.loops.foreach_get("vertex_index", corners)
        # How it shades is part of its shape as checked: a face smooth across a sharp corner is a fault.
        shading = tuple(_flags_key(data, key) for key in ("sharp_face", "sharp_edge"))
        return (data.name, len(data.polygons), hash(points.tobytes()), hash(corners.tobytes()), shading)
    return (getattr(data, "name", None), tuple(round(v, 6) for v in obj.dimensions))


class State:
    """An object as a call found it: where it is, its shape, its steps, its materials, its layout and its box."""

    def __init__(self, obj):
        self.uid = obj.session_uid
        self.type = obj.type
        self.place = tuple(round(v, 7) for row in obj.matrix_world for v in row)
        self.shape = _shape_key(obj) if obj.type in SHAPE_TYPES else None
        self.steps = tuple((m.name, m.type, _values(m)) for m in getattr(obj, "modifiers", []))
        self.materials = tuple(slot.material.name if slot.material else None for slot in getattr(obj, "material_slots", []))
        self.layout = layout_key(obj)
        self.shown = not obj.hide_render
        corners = numpy.array([tuple(obj.matrix_world @ mathutils.Vector(c)) for c in obj.bound_box])
        self.box = corners.min(axis=0), corners.max(axis=0)
        self.uses = {m.object.name for m in getattr(obj, "modifiers", []) if getattr(m, "object", None) is not None}


class Scene:
    """
    The scene as a call found it: each object's state and each material's values, and, before the
    call, which parts are the same on both sides. Only the scene before is measured for that: the
    parts after are measured when the call shaped them, and measuring every part would evaluate
    those the call left alone, whose evaluated shape a scene loaded again no longer holds.
    """

    def __init__(self, before):
        bpy.context.view_layer.update()
        self.objects = {o.name: State(o) for o in bpy.context.scene.objects if not o.name.startswith(PREVIEW)}
        self.materials = {m.name: material_key(m) for m in bpy.data.materials}
        shown = (o for o in bpy.context.scene.objects if not o.name.startswith(PREVIEW))
        self.symmetric = symmetric_before(shown) if before else {}


def before(op):
    """The scene before a call, for the calls whose changes are checked."""
    return Scene(before=True) if op in CHECKED else None


def same_ids(was, now):
    """The name each object had before a call in this Blender, by its name after it, matched by session id."""
    names = {state.uid: name for name, state in was.objects.items()}
    return {name: names[state.uid] for name, state in now.objects.items() if state.uid in names}


class Changed:
    """
    What a call changed, from the scene before it and after it. `former` names
    what each object was called before; without it, objects are matched by
    their session ids. Renaming one changes nothing checked.
    """

    def __init__(self, was, now, former=None):
        self.pairs = paired(was.objects, now.objects, same_ids(was, now) if former is None else former)
        # Each object that was there, as it was, under its name now.
        before = {n: was.objects[w] for n, w in self.pairs.items()}
        self.added = [n for n in now.objects if n not in before]
        kept_names = set(self.pairs.values())
        self.removed = [w for w in was.objects if w not in kept_names]
        kept = list(before)
        self.shaped = set(self.added) | {
            n for n in kept if (before[n].shape, before[n].steps, before[n].type) != (now.objects[n].shape, now.objects[n].steps, now.objects[n].type)
        }
        self.moved = set(self.added) | {n for n in kept if before[n].place != now.objects[n].place}
        self.shown = {n for n in kept if before[n].shown != now.objects[n].shown}
        # A part whose steps use what changed, as a hole its cutter, changes with it.
        while True:
            reached = {
                n for n, state in now.objects.items() if n not in self.shaped and state.uses & (self.shaped | self.moved)
            }
            if not reached:
                break
            self.shaped |= reached
        self.laid_out = {n for n in kept if before[n].layout != now.objects[n].layout}
        self.materials = {m for m, key in now.materials.items() if was.materials.get(m) != key}
        self.given = {
            n for n in now.objects if n in self.added or before[n].materials != now.objects[n].materials
        }
        for name in self.given:
            self.materials |= {m for m in now.objects[name].materials if m}
        # What stood against what moved, changed, went or was hidden: what it held may now float or tip.
        touched = self.moved | self.shaped | self.shown
        boxes = (
            [before[n].box for n in touched if n in before]
            + [was.objects[n].box for n in self.removed]
            + [now.objects[n].box for n in touched]
        )
        self.around = set()
        if boxes:
            lows, highs = numpy.array([b[0] for b in boxes]), numpy.array([b[1] for b in boxes])
            for n in before:
                if n in touched:
                    continue
                low, high = before[n].box
                if ((high + HELD >= lows) & (low - HELD <= highs)).all(axis=1).any():
                    self.around.add(n)


def evaluated_faces(obj):
    """How many faces an object's shape has with its steps, read from what Blender already evaluated."""
    data = obj.evaluated_get(evaluated_graph()).data
    return len(data.polygons) if isinstance(data, bpy.types.Mesh) else 0


class Faults:
    """
    The faults found, by what they are in, and what time left unchecked. An
    object is checked only when the time left holds its faces at the most a
    face has taken so far, so a few dense shapes cannot carry the checks past
    their time.
    """

    def __init__(self):
        self.found = {}
        self.unchecked = []
        self.deadline = time.time() + budget.share(SECONDS)
        self.ran = False
        self.per_face = 0.0

    def add(self, name, faults):
        self.ran = True
        if faults:
            self.found.setdefault(name, []).extend(faults)

    def in_time(self, name, faces=0):
        if time.time() + self.per_face * faces > self.deadline:
            if name not in self.unchecked:
                self.unchecked.append(name)
            return False
        return True

    def took(self, started, faces):
        """Learns from a check of `faces` faces begun at `started` how long a face takes."""
        if faces:
            self.per_face = max(self.per_face, (time.time() - started) / faces)

    def text(self):
        lines = []
        if self.found:
            lines.append("Faults in what this call changed:")
            if len(self.found) <= GROUPED_PAST:
                lines += [f"- {name}: {'; '.join(faults)}." for name, faults in self.found.items()]
            else:
                lines += grouped_lines(self.found)
        elif self.ran:
            lines.append("Checked what this call changed: no faults.")
        kept, length_so_far = [], 0
        for index, line in enumerate(lines):
            if length_so_far + len(line) > LONGEST:
                lines = kept + [f"{len(lines) - index} more lines of faults are not listed, past the {LONGEST:,} characters they are given."]
                break
            kept.append(line)
            length_so_far += len(line) + 1
        if self.unchecked:
            lines.append(f"Not checked, past the {SECONDS} s the checks of a call have: {enumerated(self.unchecked, NAMED)}.")
        return "\n".join(lines)


def grouped_lines(found):
    """
    Like faults of many objects in one line each: the objects counted by the
    name they share, with the first one's words, and said when the others'
    measures differ from its.
    """
    kinds = {}
    for name, faults in found.items():
        for fault in faults:
            kinds.setdefault(re.sub(r"-?\d+(?:[.,]\d+)*", "#", fault), []).append((name, fault))
    lines = []
    for said in kinds.values():
        names = [name for name, _ in said]
        first_name, first = said[0]
        if len(said) == 1:
            lines.append(f"- {first_name}: {first}.")
            continue
        alike = all(fault == first for _, fault in said)
        lines.append(f"- {stems_text(names)}: {first}" + ("." if alike else f", as {first_name} has it; the others' measures differ."))
    return lines


def transform_faults(obj):
    """What an object's scale does that a resize would not: mirroring it, or stretching the widths of its steps."""
    scale = obj.matrix_world.to_scale()
    said = []
    if obj.matrix_world.to_3x3().determinant() < 0:
        said.append("its scale is negative, which mirrors it: tools and files that do not follow that see its faces turned in")
    steps = [m.name for m in getattr(obj, "modifiers", []) if m.type in WIDTH_STEPS and m.show_viewport]
    if steps and max(abs(s) for s in scale) > 1.001 * min(abs(s) for s in scale):
        said.append(
            f"it is scaled unevenly, ({', '.join(f'{abs(s):.3g}' for s in scale)}), so the widths of {', '.join(steps)} stretch with it:"
            " give it a size with blender_edit_objects instead, which resizes its shape"
        )
    return said


def empty_cuts(obj):
    """The boolean steps that take nothing away, measured with the step and without it."""
    said = []
    for step in obj.modifiers:
        if step.type != "BOOLEAN" or step.operation != "DIFFERENCE" or not step.show_viewport:
            continue
        with_it = Shape(obj)
        step.show_viewport = False
        try:
            without = Shape(obj)
        finally:
            step.show_viewport = True
        bpy.context.view_layer.update()
        if without.same_as(with_it) or (
            without.volume is not None and with_it.volume is not None and without.volume - with_it.volume <= NOTHING * without.volume
        ):
            operand = step.object.name if step.object else (step.collection.name if step.collection else "nothing")
            said.append(f"its {step.name} takes nothing away: {operand} does not pass into it")
    return said


def units_text():
    """What an opened file's units do to its sizes, which every tool gives in metres: nothing when they are metres."""
    units = bpy.context.scene.unit_settings
    said = []
    if abs(units.scale_length - 1) > 1e-9:
        said.append(
            f"its unit scale is {units.scale_length:g}: Blender shows each of its units as {length(units.scale_length)},"
            " and every size the tools give or take counts one as 1 m"
        )
    if units.system == "IMPERIAL":
        said.append("it shows its sizes in feet and inches, and the tools give and take metres")
    if not said:
        return ""
    return " " + "; ".join(said)[0].upper() + "; ".join(said)[1:] + "."


def checked(was, op, args, former=None, unkept=()):
    """
    The checks' words on what a call changed, or nothing when it changed
    nothing they check. `former` names what each object was called before,
    for a scene loaded again since `was`, and `unkept` the pictures a script
    set pixels of that the file it saved keeps without them.
    """
    now = Scene(before=False)
    changed = Changed(was, now, former)
    faults = Faults()
    kinds, lost = [], []
    shown = {o.name: o for o in subjects()}
    with held_still():
        for name in sorted(changed.shaped):
            obj = shown.get(name)
            if obj is None or obj.type not in SHAPE_TYPES:
                continue
            faces = evaluated_faces(obj)
            if not faults.in_time(name, faces):
                continue
            started = time.time()
            torn = soundness_text(obj)
            found = [torn] if torn else []
            if faults.in_time(name):
                found += mesh_faults(obj)
            if faults.in_time(name):
                lost.append(symmetry_lost(obj, was.symmetric.get(changed.pairs.get(name))))
            if op in COUNTED_FACES and obj.type == "MESH":
                kinds.append(f"{name}: {face_kinds_text(obj)}")
            # A typed cut that takes nothing is refused before this.
            if obj.type == "MESH" and op != "shape" and faults.in_time(name):
                found += empty_cuts(obj)
            faults.took(started, faces)
            faults.add(name, found)
        for name in sorted(changed.moved | changed.shaped):
            obj = shown.get(name)
            if obj is not None and faults.in_time(name):
                faults.add(name, transform_faults(obj))
        # A shape whose material changed may now lay a picture by a layout it lacks.
        wearing = {n for n, state in now.objects.items() if set(state.materials) & changed.materials}
        for name in sorted(changed.shaped | changed.laid_out | changed.given | wearing):
            obj = shown.get(name)
            if obj is None or obj.type != "MESH" or not faults.in_time(name):
                continue
            pictured = lays_picture(obj)
            if pictured and obj.data.uv_layers.active is None:
                faults.add(name, ["a material on it lays a picture by its layout, and it has none, so the picture shows as one colour"])
            elif pictured:
                faults.add(name, uv_faults(obj))
        for name in sorted(changed.materials):
            material = bpy.data.materials.get(name)
            if material is not None and faults.in_time(f"Material {name}"):
                faults.add(f"Material {name}", material_faults(material, unkept))
        placing = sorted((changed.moved | changed.shaped | changed.around) & set(shown))
        checker = Checker(list(shown.values()), max(1.0, faults.deadline - time.time()))
        for name in placing:
            obj = shown[name]
            # An empty placing a collection's instances is a shape too.
            if is_helper(obj) or (not has_shape(obj) and not obj.children) or not faults.in_time(name, evaluated_faces(obj)):
                continue
            found = []
            floating = checker.loose_text(obj)
            if floating:
                found.append(floating)
            if name in changed.moved | changed.shaped and faults.in_time(name):
                found += [f"lies wholly inside {other.name}'s solid, hidden unless {other.name} is see-through" for other in wholly_inside(obj, list(shown.values()))]
            tips = tipping(obj, checker) if not floating and faults.in_time(name) else None
            if tips:
                found.append(tips)
            faults.add(name, found)
        # How each object that moved or was added stands, what touches nothing first.
        stood = standing_text(
            [standing(shown[n], checker) for n in sorted(changed.moved & set(shown)) if not is_helper(shown[n]) and has_shape(shown[n])],
            "Where what moved stands",
        )
        for name in checker.unchecked:
            if name not in faults.unchecked:
                faults.unchecked.append(name)
    return "\n".join(filter(None, [faults.text(), stood, symmetry_text(lost), faces_text(kinds)]))


def symmetry_text(lost):
    """The line naming the parts a call left no longer the same on both sides, past NAMED the rest counted."""
    lost = [said for said in lost if said]
    if not lost:
        return ""
    more = len(lost) - NAMED
    return (
        "Symmetry lost: "
        + "; ".join(lost[:NAMED])
        + (f"; and {more} more parts" if more > 0 else "")
        + ". If that is not meant, zhiyin.symmetrize copies one half onto the other."
    )


def faces_text(kinds):
    """The line counting the faces of each shape a shaping step or script changed, past NAMED the rest counted."""
    if not kinds:
        return ""
    more = len(kinds) - NAMED
    return "Faces by their sides: " + "; ".join(kinds[:NAMED]) + (f"; and {more} more shapes" if more > 0 else "") + "."

