"""
blender_settle_objects: objects dropped onto their supports by Blender's rigid-body physics, given
to it and run frame by frame as blender_simulate gives and runs its bodies, their final places kept
as plain places and the physics taken away again. Says for each how far it moved and turned, what
it came to rest on, whether it was still moving at the end and whether it fell off everything it
was given to rest on.
"""

import math

import bpy

from .aiming import keeps_focus
from .arguments import need, number
from .errors import Refused
from .finding import find_objects, is_helper, scene
from .placing import keyed_paths, placed
from .sim_bodies_run import motion, moving_steps, remove_physics, rests_on, tracked
from .sim_bodies_setup import Body, give
from .timeline import fps
from .tolerances import PHYSICS_MARGIN
from .wording import length, listed

SHAPES = ("hull", "mesh", "box")
# The mass each dropped object is given: Blender's own for a new rigid body. How a body falls and
# settles does not depend on it, only how it pushes another.
MASS = 1.0
# How long the physics runs, in seconds, and each body's friction and bounce: least, most and by default.
SECONDS = (0.2, 20, 3)
FRICTION = (0, 1, 0.5)
BOUNCE = (0, 1, 0)
# How the physics sees each dropped object unless the call says.
SHAPE = "hull"


def bodies(names, what):
    found = find_objects(names)
    for obj in found:
        need(obj.type == "MESH" and not is_helper(obj), f"“{obj.name}” is not a shape to {what}.")
        if obj.parent is not None:
            raise Refused(f"“{obj.name}” is attached to “{obj.parent.name}”; settle what it is attached to, or detach it first.")
        need(not keyed_paths(obj), f"“{obj.name}” moves by keys, which would place it again on the next frame. Clear its motion first.")
    return found


def run_physics(falling, supports, seconds, shape, friction, bounce):
    """Runs the physics on a scene of its own world; each falling object's world matrix at every frame."""
    """
    Runs the physics on a world of its own for `seconds`: each falling object given to it as an
    active body seen by `shape`, each support as a still one seen by its mesh, both with every
    step on them. Each falling object's world matrix at every frame.
    """
    room = scene()
    need(room.rigidbody_world is None, "This scene already has rigid-body physics of its own; settle runs only where there is none.")
    frames = max(2, round(seconds * fps()))
    with bpy.context.temp_override(scene=room):
        bpy.ops.rigidbody.world_add()
    world = room.rigidbody_world
    try:
        world.point_cache.frame_start = 1
        world.point_cache.frame_end = frames + 1
        for obj in falling:
            give(Body(obj, "active", shape, friction, bounce, ("mass", MASS, None)))
        for obj in supports:
            give(Body(obj, "passive", "mesh", friction, bounce, None))
        return tracked(falling, range(1, frames + 2))
    finally:
        remove_physics()


@keeps_focus
def settle_objects(args, scene_file):
    names = args.get("objects")
    need(isinstance(names, list) and names, "objects lists the objects to drop.")
    falling = bodies(names, "drop")
    on = args.get("on")
    need(isinstance(on, list) and on, "on lists what they settle onto: the floor, a table, a shelf.")
    supports = bodies(on, "rest on")
    for obj in falling:
        need(obj not in supports, f"“{obj.name}” is both dropped and rested on.")
    seconds = number(args.get("seconds"), "seconds", minimum=SECONDS[0], maximum=SECONDS[1], default=SECONDS[2])
    shape = args.get("shape", SHAPE)
    need(shape in SHAPES, "shape is hull, mesh or box: how the physics sees each dropped object.")
    friction = number(args.get("friction"), "friction", minimum=FRICTION[0], maximum=FRICTION[1], default=FRICTION[2])
    bounce = number(args.get("bounce"), "bounce", minimum=BOUNCE[0], maximum=BOUNCE[1], default=BOUNCE[2])
    bpy.context.view_layer.update()
    started = {obj: obj.matrix_world.copy() for obj in falling}
    tracks = run_physics(falling, supports, seconds, shape, friction, bounce)
    lines = []
    for obj in falling:
        track = tracks[obj]
        if not track:
            raise Refused(f"The physics gave “{obj.name}” no place.")
        obj.matrix_world = track[-1]
        bpy.context.view_layer.update()
        before, after = started[obj], track[-1]
        moved = (after.translation - before.translation).length
        fell = before.translation.z - after.translation.z
        slid = (after.translation - before.translation).to_2d().length
        turned = math.degrees(before.to_quaternion().rotation_difference(after.to_quaternion()).angle)
        speeds, turns = motion(track, fps())
        moving = moving_steps(speeds, turns)
        under = rests_on(obj, [o for o in [*supports, *falling] if o is not obj])
        went = [f"fell {length(fell)}" if fell > 1e-6 else f"rose {length(-fell)}" if fell < -1e-6 else None]
        went += [f"slid {length(slid)}" if slid > 1e-6 else None, f"turned {turned:.3g}°" if turned >= 0.05 else None]
        went = [m for m in went if m]
        parts = [listed(went) if moved > 1e-6 and went else "did not move"]
        if under:
            parts.append(f"rests on {listed(under)}")
        if not under:
            parts.append("touches nothing it was given to rest on: it fell off")
        if moving and moving[-1] == len(speeds) - 1:
            parts.append(f"still moving at the end, {speeds[-1]:.3g} m/s: settle for longer")
        lines.append(f"{obj.name}: {', '.join(parts)}; now {placed(obj)}")
    gap = f" Shapes rest {length(PHYSICS_MARGIN)} apart, the margin the physics keeps between them."
    return "\n".join(f"{line}." for line in lines) + gap

