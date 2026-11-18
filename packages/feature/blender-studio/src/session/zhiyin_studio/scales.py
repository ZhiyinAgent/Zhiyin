"""
The scale bookkeeping: what a part's shape was resized by, the scale it was built at, and what
the scene stretches its lengths by, so scaling stays a factor on its built size.
"""

import bpy

from .wording import length

SHAPE_SCALE = "zhiyin_shape_scale"


def shape_scale(obj):
    """What a part's own shape was resized by along its own axes, as resizing with parts attached does."""
    return [float(v) for v in obj.get(SHAPE_SCALE, (1.0, 1.0, 1.0))]


BUILT_SCALE = "zhiyin_built_scale"


def built_at(obj):
    """
    The scale an object had in the world as it was added, which is its built
    size: a group's, the scale it was fitted at, and a model's part's, what
    the model's own file and that fit gave it.
    """
    return [float(v) for v in obj.get(BUILT_SCALE, (1.0, 1.0, 1.0))]


def world_scale(obj):
    """An object's scale in the world along its own axes: its own, and what it is attached to gives it."""
    return list(obj.matrix_world.to_scale())


def built_scale(obj):
    """
    A part's scale from its built size: its scale in the world, with what its
    shape was resized by, against the scale it was added at, so what it is
    attached to does not count against it.
    """
    bpy.context.view_layer.update()
    world = world_scale(obj)
    shaped = shape_scale(obj)
    built = built_at(obj)
    return [world[i] * shaped[i] / built[i] for i in range(3)]


def even(factors):
    """
    Whether factors are one on every side, as near as the sizes an answer
    gives, to four figures, can say: a size repeated from one is even.
    """
    return max(factors) - min(factors) <= 1e-3 * max(abs(f) for f in factors)


def scene_scale(obj):
    """How much the scene stretches an object's own lengths, along each of its own axes."""
    return [abs(s) for s in obj.matrix_world.to_scale()]


def wrap_text(obj):
    """The cylinder lettering is bent round, in the scene's lengths, or nothing."""
    if not obj.get("zhiyin_wrap"):
        return None
    reach = scene_scale(obj)
    if not even(reach):
        return "bent round a cylinder, then stretched unevenly"
    return f"bent round a {length(float(obj['zhiyin_wrap']) * reach[0])} radius"
