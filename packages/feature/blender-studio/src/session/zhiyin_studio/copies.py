"""
Copies of an object and objects set out in a row: copies a step apart, turned round an axis, or
sharing one mesh; and objects spread along a line, a circle, a curve or given points, a spacing
apart or with even gaps, turned to follow the path or to face its centre. Says where each copy
landed, what the copies share, the spacing and gaps reached, and what any goes into.
"""

import math

import bpy
import mathutils

from .arguments import need, number, vector, whole
from .errors import Refused
from .finding import find_object, is_helper, unused_name
from .geometry import bounds_of
from .keys import own_keys, shift_keys
from .placing import keyed_paths, tree
from .resting import rest
from .wording import enumerated, length, point_text

AXES = {"x": (1, 0, 0), "y": (0, 1, 0), "z": (0, 0, 1)}
# The degrees copies round an axis, or a circle they are set out on, spread over by default.
WHOLE_TURN = 360


def next_number(name):
    """The first number n for which “name n” is free."""
    step_number = 2
    while bpy.data.objects.get(f"{name} {step_number}"):
        step_number += 1
    return step_number


def axis_of(value, name):
    """An axis as x, y, z or three numbers, made a unit vector."""
    if isinstance(value, str):
        need(value in AXES, f"{name} is x, y, z or three numbers.")
        return mathutils.Vector(AXES[value])
    found = vector(value, name)
    need(found.length > 1e-9, f"{name} must not be [0, 0, 0].")
    return found.normalized()


def axis_words(axis):
    for name, along in AXES.items():
        if abs(axis.dot(along)) > 1 - 1e-9:
            return name if axis.dot(along) > 0 else f"-{name}"
    return "[" + ", ".join(f"{c:.3g}" for c in axis) + "]"


def pivot_of(spec, what):
    """The point a turn goes round: a point given, or an object's origin, and the words for it."""
    if spec.get("object") is not None:
        need(spec.get("point") is None, f"{what} takes a point or an object to turn round, not both.")
        held = find_object(spec["object"])
        bpy.context.view_layer.update()
        at = held.matrix_world.translation.copy()
        return at, f"{held.name}'s origin at {point_text(at)}"
    at = vector(spec.get("point", spec.get("centre")), f"{what} point")
    return at, point_text(at)


def turned_round(pivot, axis, degrees):
    """The world matrix that turns things `degrees` round `axis` through `pivot`."""
    return (
        mathutils.Matrix.Translation(pivot)
        @ mathutils.Matrix.Rotation(math.radians(degrees), 4, axis)
        @ mathutils.Matrix.Translation(-pivot)
    )


def copy_tree(obj, linked):
    """
    A copy of an object with what is attached to it, linked into the same collections; with
    `linked`, the copies share the originals' meshes. Its keys are its own, and a copy's holes
    are cut by copies of their cutters. The copy's root, and the names of its attached parts.
    """
    step_number = next_number(obj.name)
    copies = {}
    for original in tree(obj):
        copy = original.copy()
        if original.data is not None and not linked:
            copy.data = original.data.copy()
        # Its own keys, so keying or clearing one leaves the other's.
        for owner in (copy, None if linked else copy.data, None if linked else getattr(copy.data, "shape_keys", None)):
            if owner is not None:
                own_keys(owner)
        copy.name = unused_name(f"{original.name} {step_number}")
        for target in original.users_collection:
            target.objects.link(copy)
        copies[original] = copy
    for original, copy in copies.items():
        if original.parent in copies:
            copy.parent = copies[original.parent]
        for modifier in copy.modifiers:
            if getattr(modifier, "object", None) in copies:
                modifier.object = copies[modifier.object]
    attached = [c.name for o, c in copies.items() if o is not obj and not is_helper(c)]
    return copies[obj], attached


def labelled(root, attached):
    return root.name + (f" (with {', '.join(attached)})" if attached else "")


def placed_copy(obj, world, linked):
    """A copy of the object put at `world`, moving as the original does when it moves by keys."""
    root, attached = copy_tree(obj, linked)
    root.matrix_world = world
    # Before Blender evaluates the new copy, which would put it back where its keys say.
    shift_keys(root, "location", root.location - obj.location)
    return root, labelled(root, attached)


def duplicate(obj, spec):
    """
    Copies an object with what is attached to it: each copy moved by the offset in the world's
    terms, or turned round an axis, evenly round a full turn or across the angle given; with
    `linked`, the copies share its mesh. Answers each copy and its label, and how they are spaced.
    """
    need(isinstance(spec, dict), "duplicate is {count, offset} or {count, around}.")
    count = whole(spec.get("count"), "duplicate count", maximum=500, default=1)
    linked = spec.get("linked", False)
    need(isinstance(linked, bool), "duplicate linked is true or false.")
    around = spec.get("around")
    need(
        (spec.get("offset") is None) != (around is None),
        "duplicate takes an offset, a step between copies, or around, a turn round an axis: one of them.",
    )
    bpy.context.view_layer.update()
    world = obj.matrix_world.copy()
    if around is None:
        offset = vector(spec.get("offset"), "duplicate offset")
        steps = [mathutils.Matrix.Translation(offset * i) @ world for i in range(1, count + 1)]
        how = ""
    else:
        need(isinstance(around, dict), "duplicate around is {point or object, axis, angle}.")
        axis = axis_of(around.get("axis", "z"), "duplicate around axis")
        pivot, pivot_said = pivot_of(around, "duplicate around")
        angle = number(around.get("angle"), "duplicate around angle", default=WHOLE_TURN)
        need(abs(angle) > 1e-9, "duplicate around angle must not be 0.")
        full = abs(abs(angle) - 360) < 1e-9
        step = angle / (count + 1) if full else angle / count
        steps = [turned_round(pivot, axis, step * i) @ world for i in range(1, count + 1)]
        how = f"turned round {axis_words(axis)} through {pivot_said}, {step:.4g}° apart"
    made = [placed_copy(obj, matrix, linked) for matrix in steps]
    return made, how


def shared_text(obj):
    """What a linked object's mesh is shared by, as an answer says it."""
    if obj.type != "MESH" or obj.data.users < 2:
        return None
    faces = len(obj.data.polygons)
    return (
        f"sharing one mesh of {faces:,} faces among {obj.data.users} objects:"
        f" {faces:,} faces held in memory, {faces * obj.data.users:,} drawn"
    )


class Path:
    """A path in the world as points, with how far along each one lies, open or closed."""

    def __init__(self, points, closed, words, middle=None):
        need(len(points) >= 2, "A path needs at least two points.")
        self.points = [mathutils.Vector(p) for p in points]
        self.closed = closed
        self.words = words
        self.middle = middle
        ring = self.points + self.points[:1] if closed else self.points
        self.run = [0.0]
        for a, b in zip(ring, ring[1:]):
            self.run.append(self.run[-1] + (b - a).length)
        self.ring = ring
        self.length = self.run[-1]
        need(self.length > 1e-9, "The path's points all lie in one place.")

    def at(self, distance):
        """The place `distance` along the path, and which way it runs there."""
        if self.closed:
            distance %= self.length
        distance = max(0.0, min(self.length, distance))
        for n in range(len(self.ring) - 1):
            if distance <= self.run[n + 1] or n == len(self.ring) - 2:
                a, b = self.ring[n], self.ring[n + 1]
                span = self.run[n + 1] - self.run[n]
                share = (distance - self.run[n]) / span if span > 1e-12 else 0.0
                return a.lerp(b, share), (b - a).normalized()
        return self.ring[-1].copy(), (self.ring[-1] - self.ring[-2]).normalized()


def circle_path(spec):
    need(isinstance(spec, dict), "along circle is {centre, radius, axis, start, angle}.")
    centre = vector(spec.get("centre"), "circle centre", default=(0, 0, 0))
    radius = number(spec.get("radius"), "circle radius", minimum=0)
    need(radius > 0, "circle radius must be more than 0.")
    axis = axis_of(spec.get("axis", "z"), "circle axis")
    start = math.radians(number(spec.get("start"), "circle start", default=0))
    angle = number(spec.get("angle"), "circle angle", default=WHOLE_TURN)
    need(0 < abs(angle) <= 360, "circle angle is more than 0° and at most 360°.")
    if abs(axis.dot(AXES["z"])) > 1 - 1e-9:
        u, v = mathutils.Vector((1, 0, 0)), mathutils.Vector((0, 1, 0)) * (1 if axis.z > 0 else -1)
    else:
        u = axis.orthogonal().normalized()
        v = axis.cross(u)
    full = abs(abs(angle) - 360) < 1e-9
    steps = 256
    span = math.radians(angle)
    points = [
        centre + (u * math.cos(start + span * i / steps) + v * math.sin(start + span * i / steps)) * radius
        for i in range(steps if full else steps + 1)
    ]
    words = f"a circle {length(radius * 2)} across round {point_text(centre)} about {axis_words(axis)}"
    if not full:
        words = f"an arc of {angle:g}° on " + words
    return Path(points, full, words, centre)


def curve_path(name):
    curve = find_object(name, kinds={"CURVE"})
    bpy.context.view_layer.update()
    evaluated = curve.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    try:
        matrix = curve.matrix_world
        places = [matrix @ v.co for v in mesh.vertices]
        links = {}
        for edge in mesh.edges:
            a, b = edge.vertices
            links.setdefault(a, []).append(b)
            links.setdefault(b, []).append(a)
    finally:
        evaluated.to_mesh_clear()
    need(places and links, f"{curve.name} has no line to follow.")
    ends = [i for i, near in links.items() if len(near) == 1]
    first = ends[0] if ends else min(links)
    order, seen = [first], {first}
    while True:
        onward = [n for n in links[order[-1]] if n not in seen]
        if not onward:
            break
        order.append(onward[0])
        seen.add(onward[0])
    path = Path([places[i] for i in order], not ends, "")
    path.words = f"the curve {curve.name}, {length(path.length)} long"
    return path


def path_of(along):
    need(isinstance(along, dict) and len(along) == 1, "along is one of {line}, {circle}, {curve} or {points}.")
    kind, value = next(iter(along.items()))
    if kind == "line":
        need(isinstance(value, list) and len(value) == 2, "along line is [from, to], two points.")
        a, b = vector(value[0], "line from"), vector(value[1], "line to")
        return Path([a, b], False, f"the line from {point_text(a)} to {point_text(b)}")
    if kind == "circle":
        return circle_path(value)
    if kind == "curve":
        need(isinstance(value, str), "along curve is the name of a curve object.")
        return curve_path(value)
    if kind == "points":
        need(isinstance(value, list) and len(value) >= 2, "along points lists two points or more.")
        points = [vector(p, f"point {i + 1}") for i, p in enumerate(value)]
        return Path(points, False, f"the {len(points)} points given")
    raise Refused(f"along takes line, circle, curve or points, not {kind}.")


def reach_along(obj, direction):
    """How far an object reaches behind and ahead of its origin along a direction."""
    bpy.context.view_layer.update()
    box = bounds_of(obj)
    origin = obj.matrix_world.translation
    if box is None:
        return 0.0, 0.0
    corners = [mathutils.Vector((x, y, z)) for x in (box[0].x, box[1].x) for y in (box[0].y, box[1].y) for z in (box[0].z, box[1].z)]
    along = [(c - origin).dot(direction) for c in corners]
    return max(0.0, -min(along)), max(0.0, max(along))


def heading_of(direction):
    return math.atan2(direction.y, direction.x)


def turned_to(obj, base, heading):
    """Turns an object about the world's up by `heading` from the turn it had."""
    here = obj.matrix_world.translation.copy()
    obj.matrix_world = mathutils.Matrix.Translation(here) @ mathutils.Matrix.Rotation(heading, 4, "Z") @ base
    bpy.context.view_layer.update()


def distribute(obj, spec):
    """
    Sets out the object and copies of it, or the objects given with it, along a path: centres
    evenly apart, a distance apart, or with even gaps between them; turned to follow the path or to
    face its middle, and set down on what is below when asked. Answers the line said of them.
    """
    need(isinstance(spec, dict), "distribute is {count, along, spacing, face}.")
    path = path_of(spec.get("along"))
    others = [find_object(n) for n in spec.get("with", [])]
    need(obj not in others, f"“{obj.name}” is set out first; with lists the others.")
    need(len(set(others)) == len(others), "with names each object once.")
    for other in [obj, *others]:
        need(
            not keyed_paths(other),
            f"“{other.name}” moves by keys, which would put it back on the next frame. Clear its motion first.",
        )
    points_given = "points" in spec["along"]
    default = len(path.points) if points_given else max(2, 1 + len(others))
    count = whole(spec.get("count"), "distribute count", minimum=2, maximum=500, default=default)
    need(count >= 1 + len(others), f"distribute count {count} is fewer than the {1 + len(others)} objects given.")
    need(
        not points_given or count == len(path.points),
        f"along points places one at each of the {len(path.points)} points; count {count} differs.",
    )
    linked = spec.get("linked", False)
    need(isinstance(linked, bool), "distribute linked is true or false.")
    face = spec.get("face", "none")
    need(face in ("none", "along", "centre"), "distribute face is none, along or centre.")
    need(face != "centre" or path.middle is not None or path.closed, "face centre needs a circle or a closed curve to face the middle of.")
    spacing = spec.get("spacing", "centres")
    need(spacing in ("centres", "gaps"), "distribute spacing is centres or gaps; apart gives a distance between centres.")
    need(spec.get("apart") is None or spacing == "centres", "distribute apart sets the centres a distance apart, so it takes no gaps spacing.")
    bpy.context.view_layer.update()
    base = {o: o.matrix_world.to_3x3().to_4x4() for o in [obj, *others]}
    placed = [obj, *others]
    labels = [obj.name, *[o.name for o in others]]
    for _ in range(count - len(placed)):
        root, label = placed_copy(obj, obj.matrix_world.copy(), linked)
        base[root] = base[obj]
        placed.append(root)
        labels.append(label)
    middle = path.middle if path.middle is not None else sum(path.points, mathutils.Vector()) / len(path.points)
    slots = path.length / count if path.closed else path.length / (count - 1)
    if spec.get("apart") is not None:
        apart = number(spec["apart"], "distribute apart", minimum=0)
        need(apart > 0, "distribute spacing must be more than 0.")
        needed = apart * (count if path.closed else count - 1)
        need(needed <= path.length + 1e-9, f"{count} a {length(apart)} apart need {length(needed)}; {path.words} is {length(path.length)}.")
        where = [apart * i for i in range(count)]
    elif spacing == "centres" or points_given:
        where = [slots * i for i in range(count)] if not points_given else path.run[: len(path.points)]
    else:
        where = gap_places(placed, path, count)
    for o, distance in zip(placed, where):
        at, running = path.at(distance)
        o.matrix_world = mathutils.Matrix.Translation(at) @ base[o]
        bpy.context.view_layer.update()
        if face == "along":
            turned_to(o, base[o], heading_of(running))
        elif face == "centre":
            towards = middle - at
            turned_to(o, base[o], heading_of(towards) + math.pi / 2)
        if spec.get("rest_on") is not None:
            rest(o, spec["rest_on"])
    gaps = gaps_between(placed, path, where)
    apart_said = spacing_words(where, path)
    said = f"set out {count} along {path.words}: {enumerated(labels, 12)}; {apart_said}"
    if gaps:
        said += f", {gaps}"
    return placed, said


def gap_places(placed, path, count):
    """How far along the path each goes for even gaps between them."""
    reaches = []
    for o in placed:
        _, running = path.at(0)
        reaches.append(reach_along(o, running))
    taken_up = sum(a + b for a, b in reaches)
    free = path.length - taken_up
    need(free >= 0, f"The {count} take {length(taken_up)} along the path, more than its {length(path.length)}.")
    gap = free / count if path.closed else free / (count - 1)
    where = [reaches[0][0]]
    for i in range(1, count):
        where.append(where[-1] + reaches[i - 1][1] + gap + reaches[i][0])
    return where


def gaps_between(placed, path, where):
    """The clear gaps between neighbours along the path, in words, or an overlap between them."""
    found = []
    pairs = list(zip(range(len(placed)), range(1, len(placed))))
    if path.closed:
        pairs.append((len(placed) - 1, 0))
    for i, j in pairs:
        _, running = path.at(where[i])
        _, ahead_i = reach_along(placed[i], running)
        behind_j, _ = reach_along(placed[j], running)
        step = (where[j] - where[i]) % path.length if path.closed else where[j] - where[i]
        found.append(step - ahead_i - behind_j)
    if not found:
        return ""
    low, high = min(found), max(found)
    if low < -1e-6:
        return f"neighbours overlapping along the path by up to {length(-low)}"
    return f"gaps {length(low)}" if high - low < 1e-6 else f"gaps {length(low)} to {length(high)}"


def spacing_words(where, path):
    steps = [b - a for a, b in zip(where, where[1:])]
    if path.closed:
        steps.append(path.length - where[-1] + where[0])
    low, high = min(steps), max(steps)
    return f"{length(low)} apart along it" if high - low < 1e-6 else f"{length(low)} to {length(high)} apart along it"

