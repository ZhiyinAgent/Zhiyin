"""
A rigid sweep: parts that move as one piece, a lid on its hinge or a carriage
on its rail, turned about an axis or slid along a direction in even steps
from one build; with further groups that move with them, each turned or slid
by its own rate times that move, as a gear driven by its pinion or a rack.
Each part is meshed once and the moving meshes are moved, so a fine sweep
takes seconds where running the script at each position takes a build per
step. At each step each moving part is measured against each part that stays
and each part of another group: the meshes find which come within reach, and
the kernel measures those exactly, with how deep they go into each other
where they meet.
"""

import math
import time

import numpy

from . import measure, nearness
from .sweep import PAIRS, REACH, _exact
from .words import mm as _mm
from .words import point as _point

# At or below this, in mm, two solids touch.
TOUCH = 1e-6
# Further than this, in mm, a gear's own axis is not the one it is turned about.
OFF_AXIS = 1e-3
# Within this, in mm, a round face of a part that stays lies on the axis a part turns about.
SHAFT_OFF = 0.01
# How far, in mm, a turned group is slid each way along its axis to find what stops it, and
# how much more volume, in mm³, it must then share with a part that stays to be stopped by it.
FLOAT = 0.1
GROWN = 1e-3


def _rotation(axis, degrees):
    """The rotation by `degrees` about the direction `axis`, as a 3 x 3 matrix."""
    u = numpy.asarray(axis, dtype=float)
    u = u / numpy.linalg.norm(u)
    k = numpy.array([[0.0, -u[2], u[1]], [u[2], 0.0, -u[0]], [-u[1], u[0], 0.0]])
    t = math.radians(degrees)
    return numpy.eye(3) + math.sin(t) * k + (1 - math.cos(t)) * (k @ k)


def _motion(group, value):
    """The rotation and offset that carry a point of the group's parts to where it is when moved by `value`."""
    if "turn" in group:
        rotation = _rotation(group["turn"]["along"], value)
        through = numpy.asarray(group["turn"]["through"], dtype=float)
        return rotation, through - rotation @ through
    along = numpy.asarray(group["slide"]["along"], dtype=float)
    return numpy.eye(3), along / numpy.linalg.norm(along) * value


def _groups(asked):
    """Each group that moves, with what it moves by at the first group's `value`: the first group itself, then those moving with it."""
    groups = [(asked, lambda value: value)]
    for group in asked.get("with") or []:
        groups.append((group, lambda value, rate=group["rate"]: rate * value))
    return groups


def _placed(shape, rotation, offset):
    """The solid moved as its mesh was."""
    from build123d import Location
    from OCP.gp import gp_Trsf

    trsf = gp_Trsf()
    trsf.SetValues(*rotation[0], offset[0], *rotation[1], offset[1], *rotation[2], offset[2])
    return shape.moved(Location(trsf))


def _values(asked):
    move = asked.get("turn") or asked["slide"]
    steps = asked["steps"]
    return [move["from"] + (move["to"] - move["from"]) * i / steps for i in range(steps + 1)]


def _value(group, value):
    return f"{round(value, 3) + 0.0:g}°" if "turn" in group else f"{_mm(value)} mm"


def _names(names):
    return names[0] if len(names) == 1 else f"{', '.join(names[:-1])} and {names[-1]}"


def _move(group, low, high):
    """How a group moves from `low` to `high`, in words, after its parts' names."""
    move = group.get("turn") or group["slide"]
    span = f"{_value(group, low)} to {_value(group, high)}"
    if "turn" in group:
        return f"{span} about the axis through {_point(move['through'])} along {_point(move['along'])}"
    return f"{span} along {_point(move['along'])}"


def _moved(group):
    return "turned" if "turn" in group else "slid"


def _head(asked):
    move = asked.get("turn") or asked["slide"]
    head = f"{_moved(asked).capitalize()} {_names(asked['parts'])} {_move(asked, move['from'], move['to'])}"
    geared = asked.get("with") or []
    if geared:
        head += ", with " + _names(
            [f"{_names(g['parts'])} {_moved(g)} {_move(g, g['rate'] * move['from'], g['rate'] * move['to'])}" for g in geared]
        )
        head += ","
    head += f" in {asked['steps']} {'step' if asked['steps'] == 1 else 'steps'}"
    if geared:
        head += f", each position said as {_names(asked['parts'])}'s"
    return head


def measured(parts, asked, by=None):
    """
    At each step, for each moving part and each part that stays or moves in
    another group within REACH of it: the step, the exact gap, the point
    midway between the two nearest points, and how deep they go into each
    other where they meet. Answers those by pair, and how many steps were
    measured before `by`.
    """
    shown = dict(parts)
    groups = _groups(asked)
    group_of = {name: index for index, (group, _) in enumerate(groups) for name in group["parts"]}
    moving = [name for name, _ in parts if name in group_of]
    meshes = {name: nearness.Surface(shape) for name, shape in parts}
    # Each part's boxes, measured once and moved with it.
    boxed = {name: measure.Boxed(name, shape) for name, shape in parts}
    # Each moving part against each that stays, and against each moving in a
    # later group: parts of one group keep their places to each other.
    pairs = [
        (name, other) for i, name in enumerate(moving) for other, _ in parts if other != name and (other not in group_of or group_of[other] > group_of[name])
    ]
    found = {}
    steps = 0
    for index, value in enumerate(_values(asked)):
        if by is not None and time.time() > by:
            break
        motions = [_motion(group, amount(value)) for group, amount in groups]
        here = {name: meshes[name].moved(*motions[group_of[name]]) for name in moving}
        placed = {}

        def solid(name):
            if name not in group_of:
                return shown[name]
            if name not in placed:
                placed[name] = _placed(shown[name], *motions[group_of[name]])
            return placed[name]

        def boxes(name):
            if name not in group_of:
                return boxed[name]
            return boxed[name].moved(solid(name), *motions[group_of[name]])

        for name, other in pairs:
            if not nearness.near(here[name], here.get(other, meshes[other]), REACH):
                continue
            exact = _exact(solid(name), solid(other))
            if exact is None or exact[0] > REACH:
                continue
            gap, p, q = exact
            depth = 0.0
            if gap <= TOUCH:
                shared = measure.shared(boxes(name), boxes(other))
                depth = shared["depth"] if shared else 0.0
            found.setdefault((name, other), []).append(
                {"index": index, "value": value, "gap": float(gap), "at": [float(v) for v in (p + q) / 2], "depth": float(depth)}
            )
        steps += 1
    return found, steps


def _runs(indices):
    """Consecutive indices as (first, last) runs."""
    runs = []
    for index in indices:
        if runs and index == runs[-1][1] + 1:
            runs[-1][1] = index
        else:
            runs.append([index, index])
    return runs


def _pair_said(asked, first, second, at_steps):
    values = {one["index"]: one["value"] for one in at_steps}
    meeting = [one for one in at_steps if one["gap"] <= TOUCH]
    apart = [one for one in at_steps if one["gap"] > TOUCH]
    if not meeting:
        near = min(apart, key=lambda one: one["gap"])
        return f"{first} and {second} come nearest {_mm(near['gap'])} mm apart at {_value(asked, near['value'])}, at {_point(near['at'])}"
    spans = []
    for low, high in _runs(sorted(one["index"] for one in meeting)):
        spans.append(f"at {_value(asked, values[low])}" if low == high else f"from {_value(asked, values[low])} to {_value(asked, values[high])}")
    said = f"{first} and {second} meet {' and '.join(spans)}"
    deepest = max(meeting, key=lambda one: one["depth"])
    if deepest["depth"] > TOUCH:
        said += f", going {_mm(deepest['depth'])} mm into each other at most, at {_value(asked, deepest['value'])}"
    else:
        said += ", touching without going into each other"
    if apart:
        near = min(apart, key=lambda one: one["gap"])
        said += f"; elsewhere they come nearest {_mm(near['gap'])} mm apart at {_value(asked, near['value'])}, at {_point(near['at'])}"
    return said


def _off_axis(asked):
    """
    A sentence for each of bd_warehouse's gears in a turned group whose own
    axis, found as the gear mesh finds it, is not the one it is turned
    about: such a gear swings in and out of its mesh as it turns.
    """
    from . import bom_record, gears

    kept = bom_record.kept_gears()
    said = []
    for group, _ in _groups(asked):
        if "turn" not in group:
            continue
        through = numpy.asarray(group["turn"]["through"], dtype=float)
        along = numpy.asarray(group["turn"]["along"], dtype=float)
        along = along / numpy.linalg.norm(along)
        for name in group["parts"]:
            for gear in kept.get(name, []):
                centre, direction = numpy.array(gear["centre"]), numpy.array(gear["axis"])
                apart = float(numpy.linalg.norm(numpy.cross(centre - through, along)))
                angle = math.degrees(math.acos(min(1.0, abs(float(direction @ along)))))
                off = []
                if apart > OFF_AXIS:
                    off.append(f"{_mm(apart)} mm from the axis it is turned about")
                if abs(float(direction @ along)) < gears.PARALLEL:
                    off.append(f"at {angle:.3g}° to it")
                if off:
                    said.append(
                        f"{name} is turned about an axis not its own: its own, found on its solid, runs through {_point(centre)} along {_point(direction)}, "
                        f"{' and '.join(off)}, so it swings in and out of its mesh; turn it about its own axis."
                    )
                    break
    return said


def _left_still(asked):
    """
    A sentence for each gear that meshes a gear the sweep turns but is in no
    group itself: it stands while the other turns, so their teeth run into
    each other. Turned with it about its own axis, it turns as many times
    the other's rate as the other has teeth for each of its own, the other way.
    """
    from . import bom_record, gears

    turned = {}
    for index, (group, _) in enumerate(_groups(asked)):
        for name in group["parts"]:
            turned[name] = (group, 1.0 if index == 0 else group["rate"])
    said = []
    for a, fa, b, fb, _ in gears.pairs(bom_record.kept_gears()):
        if not gears.can_mesh(fa, fb):
            continue
        for moving, fm, still, fs in ((a, fa, b, fb), (b, fb, a, fa)):
            if moving not in turned or still in turned or "turn" not in turned[moving][0]:
                continue
            group, rate = turned[moving]
            along = numpy.asarray(group["turn"]["along"], dtype=float)
            along = along / numpy.linalg.norm(along)
            said.append(
                f"{still} ({fs['teeth']:g} teeth) meshes {moving} ({fm['teeth']:g} teeth), which turns, but stays still, so their teeth run into each other: "
                f"add {still} to with, turned about its own axis through {_point(fs['centre'])} along {_point(along)} at rate {-rate * fm['teeth'] / fs['teeth']:.4g}."
            )
    return said


def _fused_shafts(parts, asked, found):
    """
    A sentence for each part that stays and meets a part the sweep turns,
    where it has a round face on the axis that part turns about and inside
    it: a shaft made one with the part it comes out of, standing while the
    part on it turns, so the bore runs into it.
    """
    shown = dict(parts)
    said = []
    for group, _ in _groups(asked):
        if "turn" not in group:
            continue
        through = numpy.asarray(group["turn"]["through"], dtype=float)
        along = numpy.asarray(group["turn"]["along"], dtype=float)
        along = along / numpy.linalg.norm(along)
        for name in group["parts"]:
            for (first, other), at_steps in found.items():
                if first != name or other in _moved_names(asked) or not any(one["gap"] <= TOUCH for one in at_steps):
                    continue
                round_face = _shaft_in(shown[other], shown[name], through, along)
                if round_face is not None:
                    said.append(
                        f"{other} has a round face {_mm(2 * round_face)} mm across on the axis {name} turns about, inside {name}, as a shaft in its bore, "
                        f"but stays still while {name} turns: if that shaft turns with {name}, show it as a part of its own and add it to {name}'s group."
                    )
    return said


def _moved_names(asked):
    return {name for group, _ in _groups(asked) for name in group["parts"]}


def _shaft_in(still, turned, through, along):
    """The radius of a cylindrical face of `still` on the axis through `through` along `along`, lying within `turned`'s box; None when it has none."""
    from build123d import GeomType

    box = turned.bounding_box()
    low, high = numpy.array(tuple(box.min)), numpy.array(tuple(box.max))
    for face in still.faces():
        if face.geom_type != GeomType.CYLINDER:
            continue
        axis = face.axis_of_rotation
        direction = numpy.array(tuple(axis.direction))
        position = numpy.array(tuple(axis.position))
        if abs(float(direction @ along)) < 1 - 1e-6 or numpy.linalg.norm(numpy.cross(position - through, along)) > SHAFT_OFF:
            continue
        own = face.bounding_box()
        if numpy.all(numpy.array(tuple(own.min)) <= high) and numpy.all(numpy.array(tuple(own.max)) >= low):
            return float(face.radius)
    return None


def _end_float(parts, asked, by=None):
    """
    For each group the sweep turns, slid FLOAT mm each way along its axis
    from where it stands: which way nothing stops it, a part that stays
    going no further into it; and what stops it the other way.
    """
    shown = dict(parts)
    moving = {name for group, _ in _groups(asked) for name in group["parts"]}
    boxed = {name: measure.Boxed(name, shape) for name, shape in parts}
    still = [name for name, _ in parts if name not in moving]
    rest = {}

    def volume(found):
        return found["volume"] if found else 0.0

    said = []
    for group, _ in _groups(asked):
        if "turn" not in group or (by is not None and time.time() > by):
            continue
        along = numpy.asarray(group["turn"]["along"], dtype=float)
        along = along / numpy.linalg.norm(along)
        stops = {}
        for sign in (1, -1):
            offset = along * FLOAT * sign
            found = []
            for name in group["parts"]:
                slid = boxed[name].moved(_placed(shown[name], numpy.eye(3), offset), numpy.eye(3), offset)
                for other in still:
                    if (name, other) not in rest:
                        rest[(name, other)] = volume(measure.shared(boxed[name], boxed[other]))
                    if volume(measure.shared(slid, boxed[other])) > rest[(name, other)] + GROWN and other not in found:
                        found.append(other)
            stops[sign] = found
        names = _names(group["parts"])
        if stops[1] and stops[-1]:
            continue
        if not stops[1] and not stops[-1]:
            said.append(f"{names} {'slides' if len(group['parts']) == 1 else 'slide'} along {'its' if len(group['parts']) == 1 else 'their'} axis either way with nothing to stop {'it' if len(group['parts']) == 1 else 'them'}.")
            continue
        free, held = (1, -1) if not stops[1] else (-1, 1)
        one = len(group["parts"]) == 1
        said.append(
            f"{names} {'slides' if one else 'slide'} along {'its' if one else 'their'} axis toward {_point(along * free)} with nothing to stop {'it' if one else 'them'}; "
            f"{_names(stops[held])} {'stops' if len(stops[held]) == 1 else 'stop'} {'it' if one else 'them'} toward {_point(along * held)}."
        )
    if said:
        said.append("A part that turns needs a stop each way along its axis, as a shoulder or collar against a bearing, or a circlip.")
    return said


def said(parts, asked, by=None):
    """
    The sweep in words: the pairs that meet first, deepest first, then those
    coming nearest; then each gear turned off its own axis, each gear left
    standing while the gear it meshes turns, and each turned group that can
    slide along its axis.
    """
    shown = [name for name, _ in parts]
    named = [name for group, _ in _groups(asked) for name in group["parts"]]
    missing = [name for name in named if name not in shown]
    if missing:
        return f"The sweep names {_names(missing)}, which the script does not show; it shows {_names(shown)}."
    measured_said, found = _measured_said(parts, asked, by)
    return " ".join([measured_said, *_fused_shafts(parts, asked, found), *_off_axis(asked), *_left_still(asked), *_end_float(parts, asked, by)])


def _measured_said(parts, asked, by):
    shown = [name for name, _ in parts]
    named = [name for group, _ in _groups(asked) for name in group["parts"]]
    head = _head(asked)
    geared = bool(asked.get("with"))
    if len(named) == len(shown) and not geared:
        return f"{head}: every part moves, so nothing stays to measure them against.", {}
    began = time.time()
    found, steps = measured(parts, asked, by)
    took = _took(time.time() - began, steps)
    of = asked["steps"] + 1
    if steps < of:
        head += f", the time running out after {steps} of {of} positions"
    if not found:
        others = "a part that stays or moves in another group" if geared else "a part that stays"
        return f"{head}: none comes within {REACH:g} mm of {others}.{took}", found

    def order(item):
        meets = [one for one in item[1] if one["gap"] <= TOUCH]
        if meets:
            return (0, -max(one["depth"] for one in meets))
        return (1, min(one["gap"] for one in item[1]))

    pairs = sorted(found.items(), key=order)[:PAIRS]
    return f"{head}: {'; '.join(_pair_said(asked, a, b, at) for (a, b), at in pairs)}.{took}", found


def _took(seconds, positions):
    """How long the sweep's positions took, in all and each, as a sentence after a space: nothing when none was measured."""
    if not positions:
        return ""
    whole = f"{int(seconds // 60)} min {round(seconds % 60):g} s" if seconds >= 60 else f"{seconds:.2g} s" if seconds < 10 else f"{round(seconds):g} s"
    return f" The sweep took {whole}, {seconds / positions:.2g} s a position."
