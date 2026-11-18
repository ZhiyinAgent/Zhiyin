"""
The rigid-body physics run frame by frame, for blender_simulate over the scene's timeline and for
blender_settle_objects over its own seconds, and measured: for each active body when it comes to
rest, its top speed, what it rests on and where it is at the end, or that it is still moving. Then,
where asked, the bodies are kept where they are at the end as plain places, or their motion is
keyed on every frame, and the rigid-body physics is taken away.
"""

import math

import bpy
import mathutils.bvhtree

from .finding import scene
from .geometry import world_mesh
from .keys import curves_of
from .placing import placed
from .sim_bodies_setup import rigid_objects
from .timeline import fps, seconds_of, seconds_text
from .tolerances import SETTLED_ON
from .wording import listed

# Slower than this, a body is at rest: the physics leaves resting bodies trembling by less.
REST_SPEED = 0.005
REST_TURN = 2.0
# Keys this alike to both neighbours say nothing a straight line between them does not.
ALIKE = 0.0001


def active_bodies():
    return [o for o in rigid_objects() if o.rigid_body.type == "ACTIVE" and not o.rigid_body.kinematic]


def tracked(bodies, frames):
    """Each body's place in the world at each of the frames, the physics run through them in turn."""
    room = scene()
    tracks = {obj: [] for obj in bodies}
    before = room.frame_current
    try:
        for frame in frames:
            room.frame_set(frame)
            for obj in bodies:
                tracks[obj].append(obj.matrix_world.copy())
    finally:
        room.frame_set(before)
    return tracks


def motion(track, rate):
    """A body's speed and its turning, in degrees a second, from each frame of its track to the next."""
    speeds = [(b.translation - a.translation).length * rate for a, b in zip(track, track[1:])]
    turns = [math.degrees(a.to_quaternion().rotation_difference(b.to_quaternion()).angle) * rate for a, b in zip(track, track[1:])]
    return speeds, turns


def moving_steps(speeds, turns):
    """The steps from one frame to the next a body moves in, faster than at rest."""
    return [i for i, (s, t) in enumerate(zip(speeds, turns)) if s > REST_SPEED or t > REST_TURN]


def nearest_gap(obj, other):
    """How near an object's shape comes to another's."""
    mine, theirs = world_mesh(obj), world_mesh(other)
    try:
        tree = mathutils.bvhtree.BVHTree.FromBMesh(theirs)
        gaps = [found[3] for v in mine.verts if (found := tree.find_nearest(v.co))[0] is not None]
    finally:
        mine.free()
        theirs.free()
    return min(gaps) if gaps else math.inf


def rests_on(obj, others):
    """The names of the others an object rests on, once the physics has settled it."""
    return [o.name for o in others if nearest_gap(obj, o) <= SETTLED_ON]


class Run:
    """Each active body's place in the world at every frame of the timeline, from its start."""

    def __init__(self):
        room = scene()
        self.bodies = active_bodies()
        self.frames = list(range(room.frame_start, room.frame_end + 1))
        self.tracks = tracked(self.bodies, self.frames)
        before = room.frame_current
        try:
            # Measured at the end, where each body is left.
            room.frame_set(self.frames[-1])
            self.lines = [self.said(obj) for obj in self.bodies]
        finally:
            room.frame_set(before)

    def said(self, obj):
        speeds, turns = motion(self.tracks[obj], fps())
        moving = moving_steps(speeds, turns)
        parts = []
        if not moving:
            parts.append("does not move")
        elif moving[-1] == len(speeds) - 1:
            parts.append(f"still moving at the end, {speeds[-1]:.3g} m/s: make the timeline longer for it to come to rest")
        else:
            parts.append(f"comes to rest at {seconds_text(seconds_of(self.frames[moving[-1] + 1]))}")
        if moving:
            top = max(range(len(speeds)), key=lambda i: speeds[i])
            parts.append(f"top speed {speeds[top]:.3g} m/s at {seconds_text(seconds_of(self.frames[top + 1]))}")
        under = rests_on(obj, [o for o in rigid_objects() if o is not obj])
        parts.append(f"rests on {listed(under)}" if under else "touches no other body: it fell off, or is still falling")
        parts.append(f"now {placed(obj)}")
        return f"{obj.name}: " + "; ".join(parts) + "."


def remove_physics():
    """Takes every rigid body, and the world, away."""
    for obj in rigid_objects():
        with bpy.context.temp_override(object=obj, active_object=obj, selected_objects=[obj]):
            bpy.ops.rigidbody.object_remove()
    room = scene()
    if room.rigidbody_world is not None:
        with bpy.context.temp_override(scene=room):
            bpy.ops.rigidbody.world_remove()


def at_end_text(run):
    return f"{seconds_text(seconds_of(run.frames[-1]))}, the end of the timeline"


def settle(run):
    """Keeps each active body where it is at the end as its plain place, without the physics."""
    remove_physics()
    for obj in run.bodies:
        obj.matrix_world = run.tracks[obj][-1]
    bpy.context.view_layer.update()
    names = [o.name for o in run.bodies]
    one = len(names) == 1
    return [
        f"Kept {listed(names)} where {'it is' if one else 'they are'} at {at_end_text(run)},"
        f" as {'its plain place' if one else 'their plain places'}, and removed the rigid-body physics."
    ]


def turn_path(obj):
    mode = obj.rotation_mode
    return "rotation_quaternion" if mode == "QUATERNION" else "rotation_axis_angle" if mode == "AXIS_ANGLE" else "rotation_euler"


def place_by(obj, matrix):
    """Sets an object's own place and turn to a world matrix, its turn kept close to the one before."""
    obj.location = matrix.to_translation()
    turn = matrix.to_quaternion()
    if obj.rotation_mode == "QUATERNION":
        obj.rotation_quaternion = -turn if obj.rotation_quaternion.dot(turn) < 0 else turn
    elif obj.rotation_mode == "AXIS_ANGLE":
        axis, angle = turn.to_axis_angle()
        obj.rotation_axis_angle = (angle, *axis)
    else:
        obj.rotation_euler = matrix.to_euler(obj.rotation_mode, obj.rotation_euler)


def thinned(curves):
    """Drops keys alike to both neighbours and makes the rest straight between; the frames still keyed."""
    frames = set()
    for curve in curves:
        points = curve.keyframe_points
        i = 1
        while i < len(points) - 1:
            here, before, after = points[i].co[1], points[i - 1].co[1], points[i + 1].co[1]
            if abs(here - before) + abs(here - after) < ALIKE:
                points.remove(points[i])
            else:
                i += 1
        for point in points:
            point.interpolation = "LINEAR"
            frames.add(round(point.co[0]))
    return frames


def to_keys(run):
    """Keys each active body's place and turn on every frame, thinned, and takes the physics away."""
    remove_physics()
    room = scene()
    before = room.frame_current
    lines = []
    for obj in run.bodies:
        path = turn_path(obj)
        for frame, matrix in zip(run.frames, run.tracks[obj]):
            place_by(obj, matrix)
            obj.keyframe_insert("location", frame=frame)
            obj.keyframe_insert(path, frame=frame)
        keyed = thinned([c for c in curves_of(obj) if c.data_path in ("location", path)])
        lines.append(
            f"{obj.name}: keyed where it is and how it turns on {len(keyed)} of {len(run.frames)} frames,"
            f" {seconds_text(0)} to {seconds_text(seconds_of(run.frames[-1]))}, straight between them."
        )
    room.frame_set(before)
    return lines + ["Removed the rigid-body physics: the keys play and export without it."]


KEEPING = {"settle": settle, "to_keys": to_keys}


def kept(how, run):
    return KEEPING[how](run)

