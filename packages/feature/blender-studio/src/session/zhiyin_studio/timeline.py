"""
The timeline: times in seconds from its start, which is frame 1, the
longest time any input may name, going to a moment, a part frame where it
falls between two, and times and the timeline in an answer's words.

A simulation's state at a frame is worked out from the frame before, so in a
scene that holds one not baked, going to a moment steps through every frame
from where it starts to it: set straight there, a falling box would still hang
where it began. A baked one is read straight from its bake.
"""

import math

from .arguments import need, number
from .finding import scene

# The longest timeline: no time an input names reaches past it.
LONGEST = 600
# Where the timeline starts, in seconds: a start or from that a call leaves out.
START = 0


def fps():
    s = scene()
    return s.render.fps / s.render.fps_base


def frame_of(seconds):
    """The frame a time falls on, a part frame where it falls between two."""
    return scene().frame_start + seconds * fps()


def seconds_of(frame):
    return (frame - scene().frame_start) / fps()


def moment(value, name, default=None):
    """A time an input names, in seconds: from 0 to the longest timeline."""
    found = number(value, name, minimum=0, default=default)
    need(found <= LONGEST, f"{name} is at most {LONGEST} s, the longest a timeline runs.")
    return found


def frames_from(first, last):
    """
    The frames keyed from one frame to another: those two exactly, part frames
    where they fall between two, and every whole frame between them.
    """
    between = [float(f) for f in range(math.floor(first) + 1, math.ceil(last)) if first < f < last]
    return [float(first), *between, float(last)]


def now():
    """Where the scene is on its timeline: its frame and the part of one after it."""
    s = scene()
    return s.frame_current, s.frame_subframe


# The frame a simulation was last stepped to from its start, while the scene
# is still there: the next moment after it steps on from it.
_stepped = None

# What simulates, by the kind of step that holds it.
SIMULATING = ("CLOTH", "SOFT_BODY", "FLUID", "DYNAMIC_PAINT")


def simulates(tree, seen=()):
    """Whether a geometry node tree, or a group inside it, holds a simulation zone."""
    for node in tree.nodes:
        if node.bl_idname == "GeometryNodeSimulationOutput":
            return True
        inner = getattr(node, "node_tree", None)
        if node.type == "GROUP" and inner is not None and inner not in seen and simulates(inner, (*seen, tree)):
            return True
    return False


def simulated():
    """
    Whether the scene holds a simulation: a rigid body world, cloth, soft
    bodies, fluid, dynamic paint, particles that are emitted or have hair
    dynamics, or a simulation zone in geometry nodes.
    """
    s = scene()
    if s.rigidbody_world is not None and s.rigidbody_world.enabled:
        return True
    for obj in s.objects:
        for step in obj.modifiers:
            if step.type in SIMULATING:
                return True
            if step.type == "PARTICLE_SYSTEM" and (
                step.particle_system.settings.type == "EMITTER" or step.particle_system.use_hair_dynamics
            ):
                return True
            if step.type == "NODES" and step.node_group is not None and simulates(step.node_group):
                return True
    return False


def go_to(seconds):
    """
    Sets the scene at a moment, a part frame where it falls between two;
    with a simulation not baked, by way of every frame before it from where
    the earliest unbaked simulation starts. With every simulation baked, the
    moment is read from the bakes.
    """
    from .sim_state import all_baked, stepping_start

    global _stepped
    s = scene()
    frame = frame_of(seconds)
    whole = int(math.floor(frame))
    if simulated() and not all_baked():
        start = stepping_start()
        on = _stepped is not None and start <= _stepped <= whole and s.frame_current == _stepped
        for each in range(_stepped + 1 if on else start, whole):
            s.frame_set(each)
        _stepped = whole
    s.frame_set(whole, subframe=frame - whole)


def back_to(kept):
    """Sets the scene back where `now` found it."""
    global _stepped
    _stepped = None
    frame, part = kept
    scene().frame_set(frame, subframe=part)


def seconds_text(seconds):
    return f"{seconds:.3g} s" if seconds < 10 else f"{seconds:.1f} s"


def timeline_text():
    s = scene()
    return (
        f"The timeline runs {seconds_text(0)} to {seconds_text(seconds_of(s.frame_end))} at {fps():g} frames a second"
        f" (frames {s.frame_start} to {s.frame_end})."
    )
