"""
What moves over a timeline: an object keys, drivers, constraints or a simulation move; one that
bones bend; and one whose shape changes while its origin stays, by keys on its mesh or its shape
keys, or by steps that simulate, read a cache, follow another object or run geometry nodes. A
shape changed by steps alone is told by its shape at the moments looked at.
"""

from .animate_deformed import bent, mark
from .geometry import SHAPE_TYPES, parts_below
from .keys import curves_of
from .timeline import simulates

# Steps whose result can change from one moment to the next with no key on the object.
CHANGING_STEPS = {
    "CLOTH",
    "SOFT_BODY",
    "FLUID",
    "DYNAMIC_PAINT",
    "OCEAN",
    "MESH_CACHE",
    "MESH_SEQUENCE_CACHE",
    "WAVE",
    "EXPLODE",
    "NODES",
    "PARTICLE_INSTANCE",
}


def keyed_shape(obj):
    """Whether keys or drivers change an object's shape: on its mesh, or on its shape keys."""
    if obj.type not in SHAPE_TYPES:
        return False
    data = obj.data
    for owner in (data, getattr(data, "shape_keys", None)):
        if owner is None:
            continue
        found = owner.animation_data
        if curves_of(owner) or (found is not None and found.drivers):
            return True
    return False


def may_reshape(obj):
    """Whether an object's shape may change over the timeline: keyed, bent by bones, or by a step that changes on its own or follows another object."""
    if obj.type not in SHAPE_TYPES:
        return False
    if keyed_shape(obj) or bent(obj):
        return True
    return any(
        step.show_viewport and (step.type in CHANGING_STEPS or getattr(step, "object", None) is not None)
        for step in getattr(obj, "modifiers", [])
    )


def animated(obj):
    """
    Whether anything moves an object: keys, drivers or constraints on it or on
    what it is attached to, a simulation, bones that bend it, or keys on its shape.
    """
    if bent(obj) or keyed_shape(obj):
        return True
    while obj is not None:
        data = obj.animation_data
        if curves_of(obj) or (data is not None and data.drivers) or obj.constraints or obj.rigid_body is not None:
            return True
        obj = obj.parent
    return False


def standing(obj, depsgraph):
    """
    How an object stands at this moment, to tell moments apart: its place,
    turn and size, whether it shows, and, for a shape that may change, the
    middle and spread of its points.
    """
    found = tuple(round(v, 5) for row in obj.matrix_world for v in row) + (obj.hide_render,)
    return found + mark(obj, depsgraph) if may_reshape(obj) else found


def unchanging(obj, seen):
    """
    Whether an object, and every part it holds, stood the same at each moment
    in `seen` and keeps its shape: nothing moves it, no keys on its mesh or
    its shapes, and no step that bends it by another object.
    """
    for part in [obj, *parts_below(obj)]:
        if len(set(seen.get(part.name, [None, ()]))) != 1 or animated(part):
            return False
        if any(getattr(step, "object", None) is not None or steps_on(step) for step in getattr(part, "modifiers", [])):
            return False
    return True


def steps_on(step):
    """Whether a step changes its shape from moment to moment by itself: a simulation, a cache, a wave or a geometry nodes simulation."""
    if step.type == "NODES":
        return step.node_group is not None and simulates(step.node_group)
    return step.type in CHANGING_STEPS
