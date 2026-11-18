"""
The pose test of a binding: each joint turned 60° each way about its own x axis, on copies of the
armature and meshes that hold the rest pose, no constraints and no motion, and the meshes'
steps up to their Armature step. Says, for each joint, the volume it loses or gains near it and
the new places its surface goes through itself.

The volume is the sum of the cones from the joint to each face: what moves whole with a bone
turns about the joint and keeps its cones, so the change is the change near the joint, and on a
closed mesh it is the change in the mesh's own volume. It is said against the volume of the mesh
within half the shorter of the joint's two bones, measured at rest.
"""

import math
import time

import bpy
import mathutils
import mathutils.bvhtree
import mathutils.geometry
import numpy

from . import budget
from .finding import scene
from .shown_mesh import array, is_inside, shown_data
from .wording import length, point_text, volume_text

TURN = math.radians(60)
# Near a joint: within this share of the shorter of its two bones.
NEAR_SHARE = 0.5
# Points across a ball near a joint, along each axis, at which the mesh's volume there is measured.
BALL_GRID = 12
# A joint keeping its volume within this share of what lies near it keeps its volume.
KEPT = 0.05
# A change in volume within this share of what is measured is arithmetic, not a change.
UNMEASURED = 1e-5
# The pose test stops turning joints after this many seconds, or half of what is left of the call's time.
BUDGET = 60
# The most joints named one by one in the summary, and described one by one.
NAMED = 12
JOINTS_SAID = 12


class Posed:
    """A mesh's copy, bound to the copied armature, with its shape read in the world."""

    def __init__(self, mesh, rig, arm):
        self.mesh = mesh
        self.copy = mesh.copy()
        self.copy.animation_data_clear()
        scene().collection.objects.link(self.copy)
        self.copy.parent = None
        self.copy.matrix_world = mesh.matrix_world.copy()
        for c in list(self.copy.constraints):
            self.copy.constraints.remove(c)
        steps = list(self.copy.modifiers)
        at = next(i for i, m in enumerate(steps) if m.type == "ARMATURE" and m.object == arm)
        for m in steps[at + 1 :]:
            self.copy.modifiers.remove(m)
        self.copy.modifiers[at].object = rig
        bpy.context.view_layer.update()
        with shown_data(self.copy, bpy.context.evaluated_depsgraph_get()) as shape:
            shape.calc_loop_triangles()
            self.triangles = array(shape.loop_triangles, "vertices", 3, numpy.int32)
            self.polygons = [list(p.vertices) for p in shape.polygons]
        self.rest = self.points()
        # Points in the same place at rest stay together as the bones move them.
        place = {}
        ids = [place.setdefault(tuple(numpy.round(p, 6)), len(place)) for p in self.rest]
        self.places = [{ids[v] for v in p} for p in self.polygons]
        self.rest_crossings = self.crossings(self.rest)

    def points(self):
        """The copy's points in the world, as it is evaluated now."""
        bpy.context.view_layer.update()
        # Evaluated anew, as the bones have moved it.
        with shown_data(self.copy, bpy.context.evaluated_depsgraph_get()) as shape:
            local = array(shape.vertices, "co", 3, float)
        matrix = numpy.array(self.copy.matrix_world)
        return local @ matrix[:3, :3].T + matrix[:3, 3]

    def cones(self, points, apex, chosen=None):
        """The volume of the cones from a point to the faces, or to those chosen."""
        triangles = self.triangles if chosen is None else self.triangles[chosen]
        a, b, c = (points[triangles[:, k]] - apex for k in range(3))
        return float(numpy.einsum("ij,ij->i", a, numpy.cross(b, c)).sum() / 6)

    def crossings(self, points):
        """Pairs of faces going through each other, faces touching at a point left out."""
        tree = mathutils.bvhtree.BVHTree.FromPolygons(points.tolist(), self.polygons)
        return {(a, b) for a, b in tree.overlap(tree) if a < b and not self.places[a] & self.places[b]}

    def inside_ball(self, centre, radius):
        """How much of the mesh at rest lies within a distance of a point, from points on a grid through that ball."""
        tree = mathutils.bvhtree.BVHTree.FromPolygons(self.rest.tolist(), self.polygons)
        steps = (numpy.arange(BALL_GRID) + 0.5) / BALL_GRID * 2 - 1
        grid = numpy.stack(numpy.meshgrid(steps, steps, steps), axis=-1).reshape(-1, 3)
        grid = grid[numpy.linalg.norm(grid, axis=1) <= 1]
        inside = sum(1 for p in grid if is_inside(tree, centre + mathutils.Vector(p) * radius))
        return inside / len(grid) * (4 / 3) * math.pi * radius**3

    def remove(self):
        bpy.data.objects.remove(self.copy)


def resting_rig(arm):
    """A copy of the armature in its rest pose, with no constraints and no motion."""
    rig = arm.copy()
    rig.animation_data_clear()
    scene().collection.objects.link(rig)
    rig.parent = None
    rig.matrix_world = arm.matrix_world.copy()
    for c in list(rig.constraints):
        rig.constraints.remove(c)
    for bone in rig.pose.bones:
        for c in list(bone.constraints):
            bone.constraints.remove(c)
        bone.location = (0, 0, 0)
        bone.rotation_mode = "QUATERNION"
        bone.rotation_quaternion = (1, 0, 0, 0)
        bone.scale = (1, 1, 1)
    return rig


def meeting(one, other):
    """Where two faces that go through each other meet: the middle of the points where the edges of each pass through the other."""
    found = []
    for edges, face in ((one, other), (other, one)):
        corners = [mathutils.Vector(c) for c in face]
        triangles = [(corners[0], corners[k], corners[k + 1]) for k in range(1, len(corners) - 1)]
        for k in range(len(edges)):
            start, end = mathutils.Vector(edges[k]), mathutils.Vector(edges[(k + 1) % len(edges)])
            way = end - start
            if way.length < 1e-12:
                continue
            for triangle in triangles:
                hit = mathutils.geometry.intersect_ray_tri(*triangle, way, start, True)
                if hit is not None and (hit - start).dot(way) <= way.length_squared:
                    found.append(hit)
    if not found:
        return numpy.concatenate([one, other]).mean(axis=0)
    return sum(found, mathutils.Vector()) / len(found)


def plain(value):
    """A measure to three figures, never in powers of ten."""
    return f"{value:.3g}" if abs(value) < 1000 else f"{value:.0f}"


def turned_text(degrees, posed, points, apex, near, size):
    """One way a joint turned: the volume it lost or gained, against the volume near it, and new self-crossings."""
    change = posed.cones(points, apex) - posed.cones(posed.rest, apex)
    said = f"{degrees:g}° {'loses' if change < 0 else 'gains'}"
    if abs(change) <= UNMEASURED * max(near, posed.cones(posed.rest, apex), 1e-12):
        said = f"{degrees:g}° keeps its volume"
    elif near > 0:
        said += f" {plain(abs(change) / near * 100)}% of the {volume_text(near)} within {length(size)} of it ({volume_text(abs(change))})"
    else:
        said += f" {volume_text(abs(change))}"
    new = sorted(posed.crossings(points) - posed.rest_crossings)
    if new:
        a, b = new[0]
        where = meeting(points[posed.polygons[a]], points[posed.polygons[b]])
        said += f", {len(new)} new self-crossing{'s' if len(new) != 1 else ''}, one at {point_text(where)}"
    else:
        said += ", no new self-crossings"
    kept = near > 0 and abs(change) <= KEPT * near and not new
    return said, kept


def joint_lines(rig, bone, posed_meshes, moved, several):
    """The pose test of one joint, for each mesh the bone moves; and whether every one keeps."""
    world = rig.matrix_world
    apex_world = world @ bone.bone.head_local
    shorter = min((world @ b.bone.tail_local - world @ b.bone.head_local).length for b in (bone, bone.parent))
    size = NEAR_SHARE * shorter
    apex = numpy.array(apex_world)
    measures = [(posed, posed.inside_ball(apex_world, size)) for posed in posed_meshes if bone.name in moved[posed.mesh.name]]
    turns = {posed.mesh.name: [] for posed, _ in measures}
    for sign in (1, -1):
        bone.rotation_quaternion = mathutils.Quaternion((1, 0, 0), sign * TURN)
        for posed, near in measures:
            turns[posed.mesh.name].append(turned_text(sign * 60, posed, posed.points(), apex, near, size))
    bone.rotation_quaternion = (1, 0, 0, 0)
    bpy.context.view_layer.update()
    lines, all_kept = [], True
    for posed, _ in measures:
        said = turns[posed.mesh.name]
        kept = all(k for _, k in said)
        all_kept = all_kept and kept
        if not kept:
            on = f", on {posed.mesh.name}" if several else ""
            lines.append(f"- {bone.name}{on} at {point_text(apex_world)}: " + "; ".join(s for s, _ in said) + ".")
    return lines, all_kept


def pose_test(meshes, arm, moved):
    """The pose test's lines: each joint of a bone that moves points, and hangs from another bone, turned each way."""
    moving = set().union(*moved.values())
    joints = [b.name for b in arm.pose.bones if b.name in moving and b.parent is not None]
    if not joints:
        return ["Pose test: no joint to turn, as no bone that moves points hangs from another bone."]
    rig = resting_rig(arm)
    posed_meshes = []
    started, allowed = time.monotonic(), budget.share(BUDGET)
    try:
        posed_meshes = [Posed(mesh, rig, arm) for mesh in meshes]
        lines, kept, tested, failed = [], 0, 0, []
        for name in joints:
            if time.monotonic() - started > allowed:
                break
            said, all_kept = joint_lines(rig, rig.pose.bones[name], posed_meshes, moved, len(meshes) > 1)
            if not all_kept:
                failed.append(name)
                if len(failed) <= JOINTS_SAID:
                    lines += said
            kept += all_kept
            tested += 1
    finally:
        for posed in posed_meshes:
            posed.remove()
        bpy.data.objects.remove(rig)
        bpy.context.view_layer.update()
    named = joints[:NAMED] + ([f"{len(joints) - NAMED} more"] if len(joints) > NAMED else [])
    count = f"{len(joints)} joint{'s' if len(joints) != 1 else ''}, {', '.join(named)}"
    head = f"Pose test, each joint turned 60° each way about its own x: {count};"
    if kept == tested and tested == 1:
        head += " it keeps within 5% of the volume near it and makes no new self-crossings."
    elif kept == tested:
        head += " all keep within 5% of the volume near them and make no new self-crossings."
    else:
        failing = tested - kept
        head += (
            f" {failing} of them {'loses or gains' if failing == 1 else 'lose or gain'} more than 5% of the volume near"
            f" {'it' if failing == 1 else 'them'} or {'makes' if failing == 1 else 'make'} new self-crossings:"
        )
    untested = [f"{len(joints) - tested} joints not tested: the pose test stops after {allowed:.0f} s."] if tested < len(joints) else []
    unsaid = failed[JOINTS_SAID:]
    if unsaid:
        lines.append(f"- and {len(unsaid)} more that do not keep: {', '.join(unsaid)}.")
    return [head, *lines, *untested]
