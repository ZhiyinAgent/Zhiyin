"""
Every baked cloth, soft body and particle system checked after a bake, frame by frame over its
frames: its top speed against what a fall through the whole scene reaches, a sign it blew up; how
a cloth's or soft body's box grown from its first frame to its last, and whether it still moves over
its last half second; how many particles are alive at the end; for a soft body or particles, how
many of its points end inside a collider; and for a cloth, any collider it went through.
"""

import math

import bpy
import mathutils
import mathutils.bvhtree
import numpy

from .finding import scene, subjects
from .geometry import world_mesh
from .shown_mesh import is_inside
from .sim_cloth_through import Through
from .timeline import fps, seconds_of, seconds_text
from .wording import length

GRAVITY = 9.81
# A speed past this many times what a fall through the scene's height reaches, and past the least,
# is no fall or push the scene holds: the simulation blew up.
SPEED_SHARE, LEAST_LIMIT = 3, 10.0
# A box that grows past this many times its first size has flown apart.
GROWN = 2.0
# Moving further than this share of its size over its last half second, it has not settled.
SETTLED = 0.01
LAST = 0.5


def points_of(obj, depsgraph):
    """A mesh's evaluated points in the world."""
    mesh = obj.evaluated_get(depsgraph).data
    found = numpy.empty(len(mesh.vertices) * 3)
    mesh.vertices.foreach_get("co", found)
    matrix = numpy.array(obj.matrix_world)
    return found.reshape(-1, 3) @ matrix[:3, :3].T + matrix[:3, 3], None


def alive_points(obj, index, frame, depsgraph):
    """The particles of one system alive at a frame: their places in the world."""
    system = obj.evaluated_get(depsgraph).particle_systems[index]
    count = len(system.particles)
    if not count:
        return numpy.zeros((0, 3)), numpy.zeros(0)
    places, speeds, born, dies = numpy.empty(count * 3), numpy.empty(count * 3), numpy.empty(count), numpy.empty(count)
    system.particles.foreach_get("location", places)
    system.particles.foreach_get("velocity", speeds)
    system.particles.foreach_get("birth_time", born)
    system.particles.foreach_get("die_time", dies)
    alive = (born <= frame) & (frame < dies)
    return places.reshape(-1, 3)[alive], numpy.linalg.norm(speeds.reshape(-1, 3)[alive], axis=1)


def watched():
    """
    Each baked cloth, soft body and particle system: its label, how to read its points at a frame,
    whether points inside colliders count, and for a cloth, what tracks it going through them.
    """
    found = []
    for obj in scene().objects:
        for step in obj.modifiers:
            if step.type == "CLOTH" and step.point_cache.is_baked:
                found.append((f"cloth on {obj.name}", lambda f, g, o=obj: points_of(o, g), False, Through(obj)))
            elif step.type == "SOFT_BODY" and step.point_cache.is_baked:
                found.append((f"soft body on {obj.name}", lambda f, g, o=obj: points_of(o, g), True, None))
            elif step.type == "PARTICLE_SYSTEM" and step.particle_system.settings.type == "EMITTER" and step.particle_system.point_cache.is_baked:
                index = list(obj.particle_systems).index(step.particle_system)
                found.append((f"particles {step.name} on {obj.name}", lambda f, g, o=obj, i=index: alive_points(o, i, f, g), True, None))
    return found


def scene_height():
    """How high the scene's shapes reach from their lowest point, in metres."""
    lows, highs = [], []
    for obj in subjects():
        if obj.type != "MESH":
            continue
        corners = [obj.matrix_world @ mathutils.Vector(c) for c in obj.bound_box]
        lows.append(min(c.z for c in corners))
        highs.append(max(c.z for c in corners))
    return max(highs) - min(lows) if lows else 1.0


def colliders():
    """The closed meshes simulations meet, each as a tree to test points against."""
    found = []
    for obj in scene().objects:
        if obj.type != "MESH" or not any(m.type == "COLLISION" for m in obj.modifiers):
            continue
        bm = world_mesh(obj)
        try:
            if bm.edges and all(e.is_manifold for e in bm.edges):
                found.append((obj, mathutils.bvhtree.BVHTree.FromBMesh(bm)))
        finally:
            bm.free()
    return found


def across(points):
    return float(numpy.linalg.norm(points.max(axis=0) - points.min(axis=0))) if len(points) else 0.0


class Track:
    """One simulation's points over its frames: its top speed and when, its first and last boxes, its last half second."""

    def __init__(self):
        self.top, self.at, self.first, self.last, self.points, self.recent = 0.0, None, None, None, None, []
        self.particles = False

    def see(self, frame, read):
        points, speeds = read
        speed = None
        if speeds is not None and len(speeds):
            speed = float(speeds.max()) if numpy.isfinite(speeds).all() else math.inf
        elif speeds is None and self.points is not None and len(points) == len(self.points) and len(points):
            speed = float(numpy.linalg.norm(points - self.points, axis=1).max()) * fps() if numpy.isfinite(points).all() else math.inf
        if speed is not None and speed > self.top:
            self.top, self.at = speed, frame
        self.particles = speeds is not None
        if self.first is None and len(points):
            self.first = across(points)
        if len(points):
            self.last = across(points) if numpy.isfinite(points).all() else math.inf
        self.points = points
        self.recent = (self.recent + [points])[-max(2, round(LAST * fps()) + 1) :]

    def settled(self):
        a, b = self.recent[0], self.recent[-1]
        if len(a) != len(b) or not len(a):
            return None
        return float(numpy.linalg.norm(b - a, axis=1).max())


def after_bake():
    """A line for each baked cloth, soft body and particle system, saying whether it stayed sound."""
    found = watched()
    if not found:
        return []
    room = scene()
    before = room.frame_current
    tracks = [Track() for _ in found]
    # Dynamic paint caches each frame it steps through in a folder beside the scene, which no
    # check writes: it sits out the stepping.
    painting = [m for o in room.objects for m in o.modifiers if m.type == "DYNAMIC_PAINT" and m.show_viewport]
    for step in painting:
        step.show_viewport = False
    try:
        for frame in range(room.frame_start, room.frame_end + 1):
            room.frame_set(frame)
            depsgraph = bpy.context.evaluated_depsgraph_get()
            for (_, read, _, through), track in zip(found, tracks):
                track.see(frame, read(frame, depsgraph))
                if through is not None:
                    through.see(frame, track.points, depsgraph)
        meeting = colliders()
    finally:
        for step in painting:
            step.show_viewport = True
        room.frame_set(before)
    height = scene_height()
    limit = max(LEAST_LIMIT, SPEED_SHARE * math.sqrt(2 * GRAVITY * height))
    return [
        line(label, track, limit, height, meeting if counts else [], through)
        for (label, _, counts, through), track in zip(found, tracks)
    ]


def line(label, track, limit, height, meeting, through=None):
    """What one simulation did, sound or not."""
    faults, said = [], []
    if track.at is not None:
        when = seconds_text(seconds_of(track.at))
        if not math.isfinite(track.top) or track.top > limit:
            faults.append(
                f"a point moved {'past any number' if not math.isfinite(track.top) else f'{track.top:.3g} m/s'} at {when},"
                f" past {limit:.3g} m/s, three times what a fall through the scene's {length(height)} reaches: it blew up"
            )
        else:
            said.append(f"top speed {track.top:.3g} m/s at {when}, under the {limit:.3g} m/s that would mean it blew up")
    if track.particles:
        said.append(f"{len(track.points)} alive at the end")
    elif track.first is not None and track.last is not None:
        if not math.isfinite(track.last) or track.last > GROWN * max(track.first, 1e-6):
            faults.append(f"its box grew from {length(track.first)} across to {length(track.last) if math.isfinite(track.last) else 'past any size'}")
        else:
            said.append(f"its box from {length(track.first)} across to {length(track.last)}")
    moved = None if track.particles else track.settled()
    if moved is not None and track.last and math.isfinite(track.last):
        if moved > SETTLED * track.last:
            said.append(f"still moving {length(moved)} over its last {LAST:g} s")
        else:
            said.append(f"at rest over its last {LAST:g} s")
    inside = []
    if track.points is not None and len(track.points) and numpy.isfinite(track.points).all():
        for obj, tree in meeting:
            count = sum(1 for p in track.points if is_inside(tree, mathutils.Vector(p)))
            if count:
                inside.append(f"{count} of its points inside {obj.name}")
    if inside:
        faults.append("at the end " + ", ".join(inside) + ": give the collider more thickness, or the simulation more steps")
    elif meeting:
        said.append("no point inside a collider at the end")
    gone = through.fault() if through is not None else None
    if gone:
        faults.append(gone)
    elif through is not None and through.objects:
        said.append("through no collider at any frame")
    if faults:
        return f"Unsound {label} after the bake: " + "; ".join(faults) + "." + (f" Otherwise {', '.join(said)}." if said else "")
    return f"Sound {label} after the bake: " + ", ".join(said) + "."
