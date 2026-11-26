"""
A motion checked at every frame, as a frame sheet's pictures cannot: parts going into each other,
pops, turns that flip, turns too fast for the frame rate, parts that slide or slip where they
rest, rods between two parts that change length, objects that leave the camera's picture,
flickers of showing and hiding, and whether a loop ends where it began; the fastest parts and
those that accelerate hardest; feet and wheels that go into what they stand on; and the contacts
a call allows, as gears that mesh, apart from the overlaps. A mesh that bones bend is
measured by its surface, which moves while its origin stays. And, after an animation,
the values keyed only once, which hold at every time.
"""

import math
import time

import bpy
import mathutils
import numpy

from .animate_deformed import bent, surface, surface_pops, surface_slides, surface_speeds
from .describe import in_view
from .finding import scene, subjects
from .geometry import copies_named, held_still, own_points, own_size
from .keys import curves_of
from .motion_ground import Ground
from .overlaps import goes_into
from .timeline import fps, frame_of, go_to, seconds_of, seconds_text
from .tolerances import RESTS_IN_MOTION
from .wording import length, listed

# The most frames a scan steps through; past them, it steps every so many and says so.
MOST_SCANNED = 360
# A step this many times the steps either side of it, and longer than the least below, is a pop.
POP, LEAST_POP = 4, 0.002
# A turn this much per frame shows as a wheel turning backward in a video.
STROBE = math.radians(30)
# A turn between two frames past this, on one keyed angle, is a flip.
FLIP = math.radians(180)
# A part that rests and slides further than this, while it rests, slides.
SLIDING = 0.005
# A wheel whose travel and roll differ by more than this share slips.
SLIPPING = 0.1
# A turn whose axis is this near upright, about a line through the part or this share of its size from it,
# swings it where it rests, as a door on its hinge or a turntable does: it travels nowhere.
UPRIGHT, SWING_MARGIN = math.cos(math.radians(10)), 0.1
# An aimed part whose shape reaches at least this share of the way to what it aims at is a rod or a link.
ROD_REACH = 0.5
# A rod's two ends whose distance changes more than this, and this share, do not stay joined.
STRETCH, STRETCH_SHARE = 0.001, 0.01
# A loop whose end and start differ by more than this, in place or turn, jumps.
LOOP_PLACE, LOOP_TURN = 0.001, math.radians(1)
# How many of each kind of finding are named; the rest are counted.
SAID = 4
# Gravity's pull, in m/s², which an acceleration is also said in.
GRAVITY = 9.81
AIMS = ("TRACK_TO", "DAMPED_TRACK", "LOCKED_TRACK")


def spans(frames, marked):
    """Runs of marked frames, as their first and last."""
    runs, start, last = [], None, None
    for frame, on in zip(frames, marked):
        if on and start is None:
            start = frame
        if not on and start is not None:
            runs.append((start, last))
            start = None
        last = frame
    if start is not None:
        runs.append((start, last))
    return runs


def span_text(run):
    first, last = (seconds_of(f) for f in run)
    return f"at {seconds_text(first)}" if first == last else f"from {seconds_text(first)} to {seconds_text(last)}"


def plain(value):
    """A measure to three figures, never in powers of ten."""
    if abs(value) >= 1000:
        return f"{value:.0f}"
    if value == 0 or not math.isfinite(value):
        return f"{value:g}"
    said = f"{value:.{max(0, 2 - math.floor(math.log10(abs(value))))}f}"
    return said.rstrip("0").rstrip(".") if "." in said else said


def some(items):
    items = list(items)
    more = len(items) - SAID
    return "; ".join(items[:SAID]) + (f"; and {more} more" if more > 0 else "")


def turn_between(a, b):
    """The angle one placement is turned from another, the short way round, in radians."""
    angle = a.to_quaternion().rotation_difference(b.to_quaternion()).angle
    return min(angle, 2 * math.pi - angle)


def lowest(obj):
    """The lowest point of an object's shape in the world, or nothing."""
    points = own_points(obj)
    if not len(points):
        return None
    return mathutils.Vector(points[int(points[:, 2].argmin())])


def boxes():
    """Each mesh shown, with the box round it in the world, from its own box's corners."""
    return [(obj, *box_of(obj)) for obj in subjects() if obj.type == "MESH"]


def resting_on(obj, point, around, depsgraph):
    """
    What an object rests on at its lowest point: another mesh whose surface is
    within a resting distance above or below the point, or nothing. Each mesh
    near is asked alone, so a floor in the very plane of the object's own
    bottom is found.
    """
    down = mathutils.Vector((0, 0, -1))
    start = point - down * RESTS_IN_MOTION
    for other, low, high in around:
        if other == obj or not (low.x <= point.x <= high.x and low.y <= point.y <= high.y and low.z - RESTS_IN_MOTION <= point.z <= high.z + RESTS_IN_MOTION):
            continue
        to_own = other.matrix_world.inverted()
        way = to_own.to_3x3() @ down
        reach = (way * 2 * RESTS_IN_MOTION).length
        try:
            # An object's ray cast answers whether it hit first, then where.
            hit, _, _, _ = other.evaluated_get(depsgraph).ray_cast(to_own @ start, way.normalized(), distance=reach)
        except RuntimeError:
            continue
        if hit:
            return other
    return None


def allowed_pair(first, second, allowed):
    """Whether two parts are a contact the call allows, as gears that mesh or a shaft in its bearing."""
    return any((first in a and second in b) or (first in b and second in a) for a, b in allowed)


def scan(first, last, moving, checked, loop, lasting, most=MOST_SCANNED, allowed=(), budget=None):
    """
    Steps through every frame from one time to another and returns the
    findings as lines, the overlaps each two parts have, by pair and frame,
    and the frames scanned. `moving` are the objects followed, `checked` those
    measured for what they go into. Past the most frames a scan steps through,
    each frame it takes is measured again a frame on, so turns and speeds are
    still measured a frame apart; with no most, it takes every frame. Pairs
    of names in `allowed` touch by design: their overlaps are said apart.
    Past `budget` seconds it stops, and says the frame it reached.
    """
    s = scene()
    every = list(range(math.ceil(frame_of(first) - 1e-6), math.floor(frame_of(last) + 1e-6) + 1))
    step = max(1, math.ceil(len(every) / most)) if most else 1
    frames = every[::step] or [round(frame_of(first))]
    started = time.perf_counter()
    taken = []
    contacts = {}
    ground = Ground(moving)
    placed = {o.name: [] for o in moving}
    after = {o.name: [] for o in moving}
    shown = {o.name: [] for o in moving}
    low = {o.name: [] for o in moving}
    under = {o.name: [] for o in moving}
    extent = {o.name: [] for o in moving}
    seen = {o.name: [] for o in moving}
    surfaces = {o.name: [] for o in moving if bent(o)}
    aims = {
        (o.name, c.target.name): []
        for o in moving
        for c in o.constraints
        if c.type in AIMS and c.target is not None and not c.mute
    }
    rods = set()
    overlaps = {}
    named = {}
    camera = s.camera
    for frame in frames:
        if budget is not None and taken and time.perf_counter() - started > budget:
            break
        taken.append(frame)
        go_to(seconds_of(frame))
        depsgraph = bpy.context.evaluated_depsgraph_get()
        around = boxes()
        for obj in moving:
            placed[obj.name].append(obj.matrix_world.copy())
            shown[obj.name].append(not obj.hide_render)
            point = lowest(obj) if own_size(obj) is not None else None
            low[obj.name].append(point)
            support = resting_on(obj, point, around, depsgraph) if point is not None else None
            under[obj.name].append((support, support.matrix_world.copy()) if support is not None else None)
            extent[obj.name].append(box_of(obj) if point is not None else None)
            if point is not None:
                box = extent[obj.name][-1]
                ground.see(frame, obj, point, box[1].z - box[0].z, around, depsgraph)
            if obj.name in surfaces:
                surfaces[obj.name].append(surface(obj, depsgraph))
            if camera is not None and obj != camera and own_size(obj) is not None:
                seen[obj.name].append(bool(in_view(camera, [obj.matrix_world.translation])[0]))
        for (name, target), distances in aims.items():
            aimed, at = bpy.data.objects[name], bpy.data.objects[target]
            if not distances and reaches(aimed, at.matrix_world.translation):
                rods.add((name, target))
            distances.append((aimed.matrix_world.translation - at.matrix_world.translation).length)
        with held_still(lasting):
            for obj in checked:
                for other, depth in goes_into(obj, subjects()):
                    for part in (obj, other):
                        named.setdefault(part.name, copies_named(part))
                    found = contacts if allowed_pair(obj.name, other.name, allowed) else overlaps
                    pair = found.setdefault(tuple(sorted((obj.name, other.name))), {})
                    pair[frame] = max(pair.get(frame, 0.0), depth or 0.0)
        if step > 1 and frame < every[-1]:
            go_to(seconds_of(frame + 1))
            for obj in moving:
                after[obj.name].append(obj.matrix_world.copy())
    stopped = len(taken) < len(frames)
    frames = taken
    # Each part's placement at each frame scanned with its placement a frame on.
    paces = {name: list(zip(matrices, matrices[1:] if step == 1 else after[name])) for name, matrices in placed.items()}
    span = f"from {seconds_text(seconds_of(frames[0]))} to {seconds_text(seconds_of(frames[-1]))}, {len(frames)} frames"
    head = (
        f"Checked at every frame {span}"
        if step == 1
        else f"Checked every {step} frames {span}: past {most} frames a scan steps over some, so pops, overlaps and sliding"
        " are measured between the frames it took, and turns and speeds a frame on from each"
    )
    if stopped:
        head += (
            f" (stopped there for the call's time, short of {seconds_text(last)}: check on with time"
            f" {seconds_text(seconds_of(frames[-1]))})"
        )
    surface_findings = surface_pops(frames, surfaces, POP, LEAST_POP)
    findings = (
        pops(frames, placed, step)
        + ([f"Pops of surfaces bones bend: {some(surface_findings)}."] if surface_findings else [])
        + flips(every, moving)
        + strobing(frames, paces)
        + flickers(frames, shown)
        + slides(frames, placed, low, under, extent, paces, step)
        + surface_sliding(frames, surfaces, under)
        + stretches({aim: distances for aim, distances in aims.items() if aim in rods})
        + leaving(frames, seen)
        + (loop_ends(moving) if loop else [])
    )
    fastest = speeds(frames, paces, surface_speeds(frames, surfaces, step))
    lines = [head + (". " + " ".join(findings) if findings else ": nothing pops, flips, turns too fast for the frame rate, slides where it rests or leaves the picture.")]
    if fastest:
        lines.append(fastest)
    hardest = accelerations(frames, paces, step)
    if hardest:
        lines.append(hardest)
    lines += ground.lines(lambda frame: seconds_text(seconds_of(frame)))
    lines += contact_lines(contacts, named, allowed, frames)
    return lines, overlaps, named, frames


def contact_lines(contacts, named, allowed, frames):
    """The contacts the call allows: how deep each pair went into each other, and those that never touched."""
    if not allowed:
        return []
    said = []
    if contacts:
        said.append("Allowed contacts, left out of the overlaps: " + overlap_text(contacts, named, len(contacts), frames) + ".")
    untouched = [
        f"{listed(sorted(a))} and {listed(sorted(b))}"
        for a, b in allowed
        if not any(allowed_pair(first, second, [(a, b)]) for first, second in contacts)
    ]
    if untouched:
        said.append(f"Allowed contacts that never touch in these frames: {some(untouched)}.")
    return said


def accelerations(frames, paces, step):
    """
    The parts that speed up or slow down hardest: the most their velocity changes a second, from
    each frame to the next, in m/s² and in g, and when.
    """
    found = []
    for name, pairs in paces.items():
        velocities = [(b.translation - a.translation) * fps() for a, b in pairs]
        changes = [(w - v).length * fps() / step for v, w in zip(velocities, velocities[1:])]
        if changes and max(changes) > 1e-6:
            at = int(numpy.argmax(changes))
            found.append((max(changes), name, at))
    if not found:
        return ""
    found.sort(key=lambda f: -f[0])
    said = [f"{name} {plain(top)} m/s² ({plain(top / GRAVITY)} g) at {seconds_text(seconds_of(frames[at + 1]))}" for top, name, at in found[:SAID]]
    return "Hardest accelerations: " + "; ".join(said) + "."


def surface_sliding(frames, surfaces, under):
    """Surfaces bones bend whose lowest points travel over what they rest on, as a foot skates on a floor."""
    said = [
        found
        for name, points in surfaces.items()
        if (found := surface_slides(bpy.data.objects[name], frames, points, under[name], RESTS_IN_MOTION, SLIDING))
    ]
    return [f"Sliding where bent surfaces rest: {some(said)}."] if said else []


def box_of(obj):
    """The lowest and highest corners of the box round an object in the world, from its own box's corners."""
    corners = [obj.matrix_world @ mathutils.Vector(c) for c in obj.bound_box]
    return (
        mathutils.Vector([min(c[i] for c in corners) for i in range(3)]),
        mathutils.Vector([max(c[i] for c in corners) for i in range(3)]),
    )


def reaches(obj, target):
    """
    Whether an aimed part is a rod or a link: a shape that reaches from where
    it turns at least halfway to what it aims at. A camera, a light, or a
    part that only looks toward something, as a head or a turret does, has no
    length to keep.
    """
    points = own_points(obj)
    origin = numpy.array(obj.matrix_world.translation)
    way = numpy.array(target) - origin
    distance = numpy.linalg.norm(way)
    if not len(points) or distance < 1e-9:
        return False
    return float(((points - origin) @ (way / distance)).max()) >= ROD_REACH * distance


def pops(frames, placed, step):
    """Places that jump in one frame: a step far longer than the steps either side of it."""
    said = []
    for name, matrices in placed.items():
        steps = [(b.translation - a.translation).length for a, b in zip(matrices, matrices[1:])]
        for i in range(1, len(steps) - 1):
            around = max(steps[i - 1], steps[i + 1])
            if steps[i] > LEAST_POP and steps[i] > POP * around:
                said.append(f"{name} jumps {length(steps[i])} between {seconds_text(seconds_of(frames[i]))} and {seconds_text(seconds_of(frames[i + 1]))}, moving {length(around)} in the frames either side")
                break
    return [f"Pops: {some(said)}."] if said else []


def bone_named(path):
    """The bone a keyed path of an armature names, from pose.bones["Name"]."""
    return path[len("pose.bones[") :].partition("]")[0].strip("\"'")


def flips(frames, moving):
    """Keyed angles that jump past half a turn between two frames, as an angle keyed across ±180° does."""
    said = []
    for obj in moving:
        for curve in curves_of(obj):
            if not curve.data_path.endswith("rotation_euler"):
                continue
            values = [curve.evaluate(f) for f in frames]
            whose = obj.name + (f"'s bone {bone_named(curve.data_path)}" if curve.data_path.startswith("pose.bones[") else "")
            for i, (a, b) in enumerate(zip(values, values[1:])):
                if abs(b - a) > FLIP:
                    axis = "xyz"[curve.array_index]
                    said.append(f"{whose}'s turn around {axis} jumps {math.degrees(abs(b - a)):.0f}° between {seconds_text(seconds_of(frames[i]))} and {seconds_text(seconds_of(frames[i + 1]))}")
                    break
    return [f"Flips: {some(said)}; key a turn as the angles it passes through, not the shortest way back."] if said else []


def strobing(frames, paces):
    """Turns past a twelfth of a turn a frame, which a video shows going backward or jerking."""
    said = []
    for name, pairs in paces.items():
        turns = [turn_between(a, b) for a, b in pairs]
        if turns and max(turns) > STROBE:
            i = int(numpy.argmax(turns))
            said.append(f"{name} {math.degrees(turns[i]):.0f}° a frame at {seconds_text(seconds_of(frames[i]))}")
    return [f"Turning faster than {math.degrees(STROBE):.0f}° a frame, which a video shows turning backward or jerking: {some(said)}; slow it or raise the frame rate."] if said else []


def flickers(frames, shown):
    """Objects shown or hidden for a single frame."""
    said = []
    for name, flags in shown.items():
        for i in range(1, len(flags) - 1):
            if flags[i] != flags[i - 1] and flags[i] != flags[i + 1]:
                said.append(f"{name} {'shows' if flags[i] else 'hides'} for one frame at {seconds_text(seconds_of(frames[i]))}")
                break
    return [f"Flickers: {some(said)}."] if said else []


def turn_of(a, b):
    """The turn from one placement to another, the short way round: its axis in the world, and its angle in radians."""
    turn = b.to_quaternion() @ a.to_quaternion().inverted()
    axis, angle = turn.axis, turn.angle
    return (-axis, 2 * math.pi - angle) if angle > math.pi else (axis, angle)


def swings(start, shift, axis, angle, box):
    """
    Whether a step is a turn about an upright line through the part itself,
    or close by it, as a door swings on its hinge and a turntable turns: it
    turns where it rests and travels nowhere. `start` is where its origin
    was, `shift` how far that moved across the ground, `box` the part's
    corners in the world before the step.
    """
    if angle < 1e-6 or abs(axis.z) < UPRIGHT:
        return False
    signed = angle if axis.z > 0 else -angle
    c, s = math.cos(signed), math.sin(signed)
    # Where the origin went is where it was, turned about the pivot: (I - R) pivot = end - R start.
    end = start + shift
    turned = mathutils.Vector((c * start.x - s * start.y, s * start.x + c * start.y))
    pivot = mathutils.Matrix(((1 - c, s), (-s, 1 - c))).inverted() @ (end - turned)
    low, high = box
    margin = SWING_MARGIN * max(high.x - low.x, high.y - low.y)
    return low.x - margin <= pivot.x <= high.x + margin and low.y - margin <= pivot.y <= high.y + margin


def slides(frames, placed, low, under, extent, paces, step):
    """
    Parts that rest on something while they move: one that does not turn
    slides by how far it travels while resting; one that rolls as it
    travels, a wheel turning about a level line across its way, slips by how
    much its travel and its roll differ. A part that swings about an upright
    line through itself, as a door or a turntable does, travels nowhere. A
    scan that steps over frames measures each turn a frame on, so a fast
    wheel's roll is not lost between the frames it took.
    """
    said = []
    for name, points in low.items():
        travel = roll = 0.0
        resting_frames = []
        on = None
        for i in range(1, len(points)):
            if points[i] is None or points[i - 1] is None or under[name][i] is None or under[name][i - 1] is None:
                continue
            on, carrying = under[name][i]
            a, b = placed[name][i - 1], placed[name][i]
            # What it rests on may move too: its travel is counted against what carries it.
            before = under[name][i - 1][1] if under[name][i - 1][0] == on else carrying
            carried = carrying @ before.inverted() @ points[i - 1] - points[i - 1]
            shift = (b.translation - a.translation - carried).to_2d()
            axis, angle = turn_of(a, b) if step == 1 else turn_of(*paces[name][i - 1])
            angle *= step
            resting_frames.append(frames[i])
            if swings(a.translation.to_2d(), shift, axis, angle, extent[name][i - 1]):
                continue
            moved = shift.length
            # Only the turn about the level line across its way rolls it along.
            across = mathutils.Vector((-shift.y, shift.x, 0)) / moved if moved > 1e-9 else None
            rolled = angle * abs(axis.dot(across)) if across is not None else 0.0
            height = b.translation.z - points[i].z
            travel += moved
            roll += rolled * max(height, 0)
        if not resting_frames or travel <= SLIDING:
            continue
        when = f"between {seconds_text(seconds_of(resting_frames[0]))} and {seconds_text(seconds_of(resting_frames[-1]))}"
        if roll <= SLIDING:
            said.append(f"{name} slides {length(travel)} along {on.name} {when} while it rests on it")
        elif abs(travel - roll) / travel > SLIPPING:
            said.append(f"{name} travels {length(travel)} on {on.name} {when} while its turn rolls it {length(roll)}: it slips by {abs(travel - roll) / travel * 100:.0f}%")
    return [f"Sliding where they rest: {some(said)}."] if said else []


def stretches(aims):
    """Aimed parts whose distance to what they aim at changes, as a rod between two parts does when its ends do not stay on them."""
    said = []
    for (name, target), distances in aims.items():
        if len(distances) < 2:
            continue
        change = max(distances) - min(distances)
        if change > STRETCH and change > STRETCH_SHARE * max(distances):
            said.append(f"{name} and {target}, from {length(min(distances))} to {length(max(distances))} apart")
    return [f"Aimed parts whose distance to what they aim at changes, so a rod between them would stretch: {some(said)}."] if said else []


def leaving(frames, seen):
    """Objects in the camera's picture at some frames that leave it at others."""
    said = []
    for name, flags in seen.items():
        if flags and any(flags) and not all(flags):
            runs = spans(frames, [not f for f in flags])
            said.append(f"{name} {', '.join(span_text(r) for r in runs[:3])}")
    return [f"Leaving the camera's picture, by their middles: {some(said)}."] if said else []


def loop_ends(moving):
    """
    Whether the timeline plays round as a loop: played again, its first frame
    follows its last, so the frame after the last must be where the first is,
    moving and turning as it moves and turns there. A last frame that is the
    first again, while the first moves on, shows that moment twice: the
    motion stalls a frame each time round.
    """
    s = scene()
    at = {}
    for frame in (s.frame_start, s.frame_start + 1, s.frame_end, s.frame_end + 1):
        go_to(seconds_of(frame))
        at[frame] = {o.name: o.matrix_world.copy() for o in moving}
    first, second = at[s.frame_start], at[s.frame_start + 1]
    last, after = at[s.frame_end], at[s.frame_end + 1]

    def apart(one, other, name):
        return (one[name].translation - other[name].translation).length > LOOP_PLACE or turn_between(one[name], other[name]) > LOOP_TURN

    names = [o.name for o in moving]
    if names and s.frame_end > s.frame_start + 1 and not any(apart(last, first, n) for n in names) and any(apart(second, first, n) for n in names):
        return [
            f"As a loop, {seconds_text(seconds_of(s.frame_end))}, the timeline's last frame, is its first again, so played round"
            " that moment shows twice and the motion stalls a frame each time:"
            f" end the timeline a frame earlier, at {seconds_text(seconds_of(s.frame_end - 1))}, so the frame after its last is its first."
        ]
    said = []
    for obj in moving:
        name = obj.name
        gap = (after[name].translation - first[name].translation).length
        turn = turn_between(first[name], after[name])
        speed = ((after[name].translation - last[name].translation) - (second[name].translation - first[name].translation)).length * fps()
        spin = abs(turn_between(last[name], after[name]) - turn_between(first[name], second[name])) * fps()
        if gap > LOOP_PLACE or turn > LOOP_TURN:
            said.append(f"{name} is {length(gap)} and {math.degrees(turn):.1f}° from where it starts")
        elif speed > LOOP_PLACE * fps() or spin > LOOP_TURN * fps():
            said.append(
                f"{name} is where it starts, but its speed changes by {plain(speed)} m/s and its turning by {plain(math.degrees(spin))}° a second"
            )
    ends = f"{seconds_text(seconds_of(s.frame_end + 1))}, the frame after the timeline's last,"
    if said:
        return [f"As a loop, {ends} does not run on into its first: {some(said)}."]
    return [f"As a loop, {ends} runs on into its first, in place and speed."]


def speeds(frames, paces, surfaces=()):
    """The fastest moving parts, and surfaces bones bend: top speed and turn, and when."""
    found = [(top, 0.0, name, at, 0) for top, at, name in surfaces]
    for name, pairs in paces.items():
        if not pairs:
            continue
        moves = [(b.translation - a.translation).length * fps() for a, b in pairs]
        turns = [turn_between(a, b) * fps() for a, b in pairs]
        top, spin = max(moves), max(turns)
        if top > 1e-6 or spin > 1e-6:
            found.append((top, spin, name, int(numpy.argmax(moves)), int(numpy.argmax(turns))))
    if not found:
        return ""
    found.sort(key=lambda f: -(f[0] + f[1]))
    said = []
    for top, spin, name, at_move, at_turn in found[:SAID]:
        parts = []
        if top > 1e-6:
            parts.append(f"{plain(top)} m/s at {seconds_text(seconds_of(frames[at_move]))}")
        if spin > 1e-6:
            parts.append(f"{plain(spin / (2 * math.pi) * 60)} turns a minute at {seconds_text(seconds_of(frames[at_turn]))}")
        said.append(f"{name} {' and '.join(parts)}")
    return "Fastest: " + "; ".join(said) + "."


def overlap_text(overlaps, named, most, scanned):
    """
    Each two parts that go into each other, deepest first: how deep, when
    deepest, and over which spans of the frames scanned, so a scan that steps
    over frames does not break one overlap into many.
    """
    if not overlaps:
        return ""
    ranked = sorted(overlaps.items(), key=lambda item: max(item[1].values()), reverse=True)[:most]
    said = []
    for (first, second), by_frame in ranked:
        deepest = max(by_frame.values())
        at = [f for f in sorted(by_frame) if by_frame[f] >= deepest * 0.99][:6]
        runs = spans(scanned, [f in by_frame for f in scanned])
        when = listed([seconds_text(seconds_of(f)) for f in at])
        said.append(
            f"{named.get(first, first)} and {named.get(second, second)}, "
            + (f"{length(deepest)} deep at {when}" if deepest else f"their surfaces crossing at {when}")
            + f"; in each other {listed([span_text(r) for r in runs[:4]])}"
            + (f" and {len(runs) - 4} more times" if len(runs) > 4 else "")
        )
    return "; ".join(said)


def lone_keys():
    """Values keyed once: a single key holds at every time, so a part keyed only where it ends is there from the start."""
    from .animate import animated_owners

    said = []
    for owner in animated_owners():
        for curve in curves_of(owner):
            if len(curve.keyframe_points) == 1 and not curve.modifiers:
                at = seconds_of(curve.keyframe_points[0].co.x)
                name = getattr(owner, "name", "")
                if curve.data_path.startswith("pose.bones["):
                    name += f"'s bone {bone_named(curve.data_path)}"
                value = curve.data_path.rpartition(".")[2].replace("_euler", "").replace("_quaternion", "").replace("_axis_angle", "")
                said.append(f"{name}'s {value} at {seconds_text(at)}")
    said = list(dict.fromkeys(said))
    if not said:
        return []
    return [f"Keyed once, so held at every time, there from the start: {some(said)}. Key where each starts too."]
