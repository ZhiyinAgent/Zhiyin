"""
What an object's motion does past its first and last keys: it holds there, carries on at the
speeds it ends with, repeats its keys round, repeats them each round on from the last, as a wheel
keeps turning, or plays them back and forth. A repeat makes the object's action cyclic over its
keys, so Blender smooths each key's handles round the seam; the answer says whether a round ends
where it starts, moving as it does there.

Measured in Blender 5.2: a turn keyed smoothly from 0 to 360 degrees and repeated on each round,
in a cyclic action, turns at one even speed through the seam.
"""

import math

from .arguments import need
from .finding import find_object, is_helper, scene
from .keys import curves_of
from .timeline import fps, seconds_of, seconds_text
from .wording import length

MODES = ("hold", "continue", "repeat", "repeat_on", "back_and_forth")
CYCLES = {"repeat": "REPEAT", "repeat_on": "REPEAT_OFFSET", "back_and_forth": "MIRROR"}
# Speeds either side of a seam are measured over this part of a frame, so a smooth turnaround,
# as a bob at the bottom of its round, is not taken for a jolt.
STEP = 0.01


def own_curves(obj):
    """An object's keyed curves and the actions they are in: its own, and its camera's or light's when no other object shares them."""
    owners = [obj]
    if obj.data is not None and getattr(obj.data, "users", 2) == 1:
        owners.append(obj.data)
    found = []
    for owner in owners:
        curves = curves_of(owner)
        if curves:
            found.append((owner.animation_data.action, curves))
    return found


def set_mode(obj, mode):
    """Sets how every curve of an object runs past its keys; the first and last keyed frames."""
    keyed = own_curves(obj)
    need(keyed, f"{obj.name} has no keys to {mode.replace('_', ' ')}: key it first.")
    frames = [k.co.x for _, curves in keyed for c in curves for k in c.keyframe_points]
    first, last = min(frames), max(frames)
    need(mode in ("hold", "continue") or last - first >= 1, f"{obj.name}'s keys are all at one moment: there is no round to repeat.")
    for action, curves in keyed:
        for curve in curves:
            for modifier in [m for m in curve.modifiers if m.type == "CYCLES"]:
                curve.modifiers.remove(modifier)
            curve.extrapolation = "LINEAR" if mode == "continue" else "CONSTANT"
            if mode in CYCLES:
                cycle = curve.modifiers.new("CYCLES")
                cycle.mode_before = cycle.mode_after = CYCLES[mode]
        cyclic = mode in ("repeat", "repeat_on")
        action.use_frame_range = cyclic
        if cyclic:
            action.frame_start, action.frame_end = first, last
        action.use_cyclic = cyclic
        for curve in curves:
            curve.update()
    return first, last


def pose(obj, frame):
    s = scene()
    whole = math.floor(frame)
    s.frame_set(whole, subframe=frame - whole)
    return obj.matrix_world.copy()


def velocity(a, b):
    """How fast and how fast turning, from one pose to one a step later, a second."""
    from .motion_checks import turn_between

    return (b.translation - a.translation) * fps() / STEP, turn_between(a, b) * fps() / STEP


def seam_text(obj, mode, first, last):
    """Whether a round of an object's motion ends where it starts, moving as it does there; or how it carries on."""
    # Read when called: the motion checks read the scene's description, which reads the motion.
    from .motion_checks import LOOP_PLACE, LOOP_TURN, plain, turn_between

    start = pose(obj, first)
    before_end, end = pose(obj, last - STEP), pose(obj, last)
    span = f"from {seconds_text(seconds_of(first))} to {seconds_text(seconds_of(last))}"
    if mode == "hold":
        return f"holds where its keys begin and end, {span}"
    end_speed, end_turn = velocity(before_end, end)
    if mode == "continue":
        return (
            f"carries on past its keys {span} at the speeds it ends with: {plain(end_speed.length)} m/s"
            f" and {plain(math.degrees(end_turn))}° a second, and comes in at those it starts with"
        )
    period = seconds_text(seconds_of(last) - seconds_of(first))
    if mode == "back_and_forth":
        moving = end_speed.length > LOOP_PLACE * fps() or end_turn > LOOP_TURN * fps()
        return (
            f"plays its keys {span} forward and back, on and on"
            + (
                f"; it turns round at each end while still moving, {plain(end_speed.length)} m/s and {plain(math.degrees(end_turn))}° a second,"
                " a jolt: ease its first and last keys to rest there"
                if moving
                else ", coming to rest at each end"
            )
        )
    gap = (end.translation - start.translation).length
    turned = turn_between(start, end)
    # Past the end, the next round starts: its first frame against the last round's.
    after_end = pose(obj, last + STEP)
    seam_speed, seam_turn = velocity(end, after_end)
    speed_change = (seam_speed - end_speed).length
    turn_change = abs(seam_turn - end_turn)
    said = f"repeats its keys {span}, a round every {period}"
    if mode == "repeat_on":
        # By its keyed values, which say a whole turn that a pose cannot.
        moved = []
        for _, curves in own_curves(obj):
            for curve in curves:
                step = curve.evaluate(last) - curve.evaluate(first)
                axis = "xyz"[curve.array_index] if curve.array_index < 3 else str(curve.array_index)
                if curve.data_path == "location" and abs(step) > LOOP_PLACE:
                    moved.append(f"{length(step)} along {axis}")
                elif curve.data_path == "rotation_euler" and abs(math.degrees(step)) > math.degrees(LOOP_TURN):
                    moved.append(f"{math.degrees(step):.4g}° round {axis}")
        said += ", each round going on from where the last ended" + (f", {', '.join(moved)} further" if moved else "")
    elif gap > LOOP_PLACE or turned > LOOP_TURN:
        return said + f"; a round ends {length(gap)} and {math.degrees(turned):.1f}° from where it starts, so it jumps back each round"
    smooth = speed_change <= LOOP_PLACE * fps() and turn_change <= LOOP_TURN * fps()
    if smooth:
        return said + ": where a round ends and the next begins it moves on at the same speed and turn, with no jump"
    return (
        said
        + f"; where a round ends and the next begins its speed changes by {plain(speed_change)} m/s"
        f" and its turning by {plain(math.degrees(turn_change))}° a second"
    )


def extend(specs, said_by_object):
    """Sets how each object's motion runs past its keys, and says what it does there."""
    need(isinstance(specs, list), "extend is a list.")
    s = scene()
    kept = (s.frame_current, s.frame_subframe)
    try:
        for spec in specs:
            need(isinstance(spec, dict) and spec.get("mode") in MODES, f"Each of extend gives an object and a mode: {', '.join(MODES)}.")
            obj = find_object(spec.get("object"))
            first, last = set_mode(obj, spec["mode"])
            said_by_object.setdefault(obj.name, []).append(seam_text(obj, spec["mode"], first, last))
    finally:
        s.frame_set(kept[0], subframe=kept[1])


def extended(obj):
    """How an object's motion runs past its keys, in a word for its description, or nothing when it holds."""
    for _, curves in own_curves(obj):
        for curve in curves:
            cycle = next((m for m in curve.modifiers if m.type == "CYCLES"), None)
            if cycle is not None:
                return {"REPEAT": "repeating", "REPEAT_OFFSET": "repeating on", "MIRROR": "back and forth"}.get(cycle.mode_after, "repeating")
            if curve.extrapolation == "LINEAR":
                return "carrying on past its keys"
    return ""


def keep_cycles_whole():
    """A cyclic action's round spans all its keys, those keyed after it was made cyclic too."""
    for obj in scene().objects:
        for action, curves in own_curves(obj):
            if not action.use_cyclic:
                continue
            frames = [k.co.x for c in curves for k in c.keyframe_points]
            if frames and (action.frame_start, action.frame_end) != (min(frames), max(frames)) and max(frames) > min(frames):
                action.frame_start, action.frame_end = min(frames), max(frames)
                for curve in curves:
                    curve.update()


def moves(obj):
    """Whether anything moves an object: keys, drivers or constraints on it or on what it is attached to, or physics."""
    while obj is not None:
        data = obj.animation_data
        if curves_of(obj) or (data is not None and data.drivers) or obj.constraints or obj.rigid_body is not None:
            return True
        obj = obj.parent
    return False


def loop_said():
    """Whether the timeline, played round, runs on from its last frame into its first, in place and speed."""
    from .motion_checks import loop_ends

    s = scene()
    kept = (s.frame_current, s.frame_subframe)
    try:
        moving = [o for o in s.objects if not is_helper(o) and moves(o)]
        return " ".join(loop_ends(moving)) if moving else ""
    finally:
        s.frame_set(kept[0], subframe=kept[1])
