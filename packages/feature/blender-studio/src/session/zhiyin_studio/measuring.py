"""
blender_measure: how far apart objects' surfaces are, with the nearest points, or how deep they
go into each other; their gaps along x, y and z; the distance between their centres; what lies
along an axis from one; and one's clearance to everything else, naming the nearest. What an
object places as instances is its shape, and in a clearance each instance is an object of its
own. A deviation is how far one shape strays from another, as after a remesh or a wrap. It
changes nothing.
"""

import time

import numpy

from . import budget
from .arguments import need
from .errors import Refused
from .finding import find_object
from .geometry import has_shape, held_still, holds
from .measure_shapes import Mesh, SceneShapes, Shape, box_gap, first_hit, into, nearest
from .shape_measures import deviation_text
from .tolerances import TOUCH
from .wording import length, listed, point_text

KINDS = ("gap", "centres", "clearance", "deviation")
AXES = {"x": 0, "y": 1, "z": 2}
# How long measuring may take before what is left is said unmeasured, in seconds.
SECONDS = 90
# Besides the nearest, how many more a clearance names.
NEXT = 3


def shape_of(name):
    """An object's whole shape, its parts and instances with it."""
    obj = find_object(name)
    need(has_shape(obj), f"“{obj.name}” has no shape to measure.")
    mesh = Mesh.of_object(obj)
    need(not mesh.empty, f"“{obj.name}” has no shape to measure.")
    return obj, Shape(mesh, label=obj.name)


def along_axes(one, other):
    """How far apart two shapes' extents are along each axis, or how much they overlap; and the axes they are apart along."""
    said, apart = [], []
    for axis, i in AXES.items():
        gap = max(other.low[i] - one.high[i], one.low[i] - other.high[i])
        if gap > TOUCH:
            side = "+" if other.low[i] > one.high[i] else "-"
            said.append(f"{axis} {length(gap)} apart, {other.label} on the {side}{axis} side")
            apart.append((axis, i, side))
        elif gap > -TOUCH:
            said.append(f"{axis} meeting")
        else:
            said.append(f"{axis} overlapping by {length(-gap)}")
    return "Along " + "; along ".join(said) + ".", apart


def travel(one, other, axis, i, side):
    """How far the second shape would move toward the first along an axis before they touch."""
    toward = [0.0, 0.0, 0.0]
    toward[i] = -1.0 if side == "+" else 1.0
    back = [-v for v in toward]
    hits = [found for found in (first_hit(other, [one], toward), first_hit(one, [other], back)) if found]
    way = f"{'-' if side == '+' else ''}{axis}"
    if not hits:
        return f"Moved along {way}, {other.label} would pass {one.label} without touching."
    return f"Moved {length(min(hit[0] for hit in hits))} along {way}, {other.label} would touch {one.label}."


def gap_text(one, other):
    """Surface to surface between two shapes, or how deep they go into each other, then along each axis."""
    found = into(one, other)
    if found is not None:
        depth, where = found
        first = (
            f"{one.label} and {other.label} go {length(depth)} into each other, deepest at {point_text(where)}."
            if depth > 0
            else f"{one.label} and {other.label} cross each other, at {point_text(where)}."
        )
        return first + "\n" + along_axes(one, other)[0]
    distance, on_one, on_other = nearest(one, other)
    if distance <= TOUCH:
        first = f"{one.label} and {other.label} touch, at {point_text(on_one)}."
    else:
        first = (
            f"{one.label} to {other.label}: {length(distance)} apart, surface to surface, "
            f"nearest from {point_text(on_one)} on {one.label} to {point_text(on_other)} on {other.label}."
        )
    axes, apart = along_axes(one, other)
    lines = [first, axes]
    if len(apart) == 1 and distance > TOUCH:
        lines.append(travel(one, other, *apart[0]))
    return "\n".join(lines)


def centres_text(one, other):
    a, b = one.middle, other.middle
    offset = numpy.abs(b - a)
    return (
        f"Centres of {one.label} {point_text(a)} and {other.label} {point_text(b)}: "
        f"{length(float(numpy.linalg.norm(b - a)))} apart, {length(offset[0])} along x, "
        f"{length(offset[1])} along y and {length(offset[2])} along z. A centre is the middle of a shape's extent."
    )


def others(obj):
    """Everything but an object and its parts, as it is measured against them."""
    return SceneShapes(lambda other: other == obj or holds(obj, other))


def clearance_text(obj, own):
    against = others(obj)
    deadline = time.monotonic() + budget.share(SECONDS)
    went_into, clear, unmeasured = [], [], 0
    for other in sorted(against.found, key=lambda shape: box_gap(own, shape)):
        if time.monotonic() > deadline:
            unmeasured += 1
            continue
        if len(clear) > NEXT and box_gap(own, other) >= clear[NEXT][0]:
            break
        found = into(own, other)
        if found is not None:
            went_into.append((other.label, found[0]))
            continue
        distance, on_one, on_other = nearest(own, other)
        clear.append((distance, other.label, on_one, on_other))
        clear.sort(key=lambda one: one[0])
    lines = []
    if went_into:
        said = [f"{label} ({length(depth)})" if depth > 0 else label for label, depth in went_into]
        lines.append(f"{obj.name} goes into {listed(said)}: no clearance.")
    elif clear:
        distance, label, on_one, on_other = clear[0]
        if distance <= TOUCH:
            lines.append(f"Clearance of {obj.name}: none, it touches {label} at {point_text(on_one)}.")
        else:
            lines.append(
                f"Clearance of {obj.name}: {length(distance)}, to {label}, "
                f"from {point_text(on_one)} on {obj.name} to {point_text(on_other)} on {label}."
            )
    else:
        lines.append(f"Clearance of {obj.name}: there is nothing else to measure against.")
    rest = clear[0 if went_into else 1 :][:NEXT]
    if rest:
        lines.append("Next nearest: " + listed([f"{label} {length(distance)}" for distance, label, _, _ in rest]) + ".")
    lines.append(against.said())
    if unmeasured:
        lines.append(f"Not measured, for want of time: {unmeasured} of them.")
    return "\n".join(lines)


def along_text(obj, own, way):
    sign = -1.0 if way.startswith("-") else 1.0
    i = AXES[way.lstrip("-")]
    direction = [0.0, 0.0, 0.0]
    direction[i] = sign
    candidates = others(obj).found
    # Only what lies across from it and on that side can be met.
    ahead = [
        other
        for other in candidates
        if all(other.low[k] <= own.high[k] and own.low[k] <= other.high[k] for k in range(3) if k != i)
        and (other.high[i] >= own.low[i] if sign > 0 else other.low[i] <= own.high[i])
    ]
    for other in ahead:
        found = into(own, other)
        if found is not None:
            return f"From {obj.name} along {way}: it already goes into {other.label}."
    hit = first_hit(own, ahead, direction)
    if hit is None:
        return f"From {obj.name} along {way}: nothing in the way."
    distance, start, end, other = hit
    return (
        f"From {obj.name} along {way}: {other.label}, {length(distance)} away, "
        f"from {point_text(start)} on {obj.name} to {point_text(end)} on {other.label}."
    )


def measure(args, scene_file, device):
    kind = args.get("kind", "gap")
    need(kind in KINDS, "kind is gap, centres, clearance or deviation.")
    between, start, way = args.get("between"), args.get("from"), args.get("along")
    with held_still():
        if kind == "clearance":
            need(isinstance(start, str) and start, "A clearance is from one object: name it in from.")
            need(between is None and way is None, "A clearance takes from alone: everything else is measured against it.")
            obj, own = shape_of(start)
            return clearance_text(obj, own)
        if kind == "deviation":
            need(between is not None and start is None and way is None, "A deviation is between two shapes: name them in between.")
        if between is not None:
            need(
                isinstance(between, list) and len(between) == 2 and all(isinstance(n, str) for n in between),
                "between names two objects.",
            )
            need(start is None and way is None, "between takes two objects; from and along measure from one.")
            first, one = shape_of(between[0])
            second, other = shape_of(between[1])
            if first == second:
                raise Refused("between names the same object twice: name two.")
            if kind == "deviation":
                need(first.type == "MESH" and second.type == "MESH", "A deviation is between two meshes.")
                return deviation_text(first, second)
            return centres_text(one, other) if kind == "centres" else gap_text(one, other)
        need(kind == "gap", "centres are between two objects: name them in between.")
        need(isinstance(start, str) and start, "Name two objects in between, or one in from with an axis in along.")
        need(way in ("x", "-x", "y", "-y", "z", "-z"), "along is x, -x, y, -y, z or -z.")
        obj, own = shape_of(start)
        return along_text(obj, own, way)
