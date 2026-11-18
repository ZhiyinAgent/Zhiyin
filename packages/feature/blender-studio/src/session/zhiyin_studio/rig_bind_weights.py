"""
A mesh bound to an armature's deforming bones: by Blender's automatic (heat) weights, by its
bones' envelopes, or rigidly, each loose part whole to the bone it lies in. Its Armature step goes
first, after any mirror, and its weights are then measured: points no bone weights, points on
more than four bones, and bones that move nothing.
"""

import bpy
import mathutils
import mathutils.bvhtree
import numpy

from .arguments import need
from .errors import Refused
from .finding import find_object, scene
from .mesh_math import joined_points, to_segment
from .shown_mesh import array, is_inside
from .wording import length, listed, point_text

HOW = {"automatic": "ARMATURE_AUTO", "envelope": "ARMATURE_ENVELOPE", "rigid": None}
SAID_HOW = {"automatic": "by automatic weights", "envelope": "by its bones' envelopes", "rigid": "rigidly"}
# The mark a rig fitted to a mesh carries: the name of that mesh.
RIG_OF = "zhiyin_rig_of"
# Points along a bone at which a loose part is asked whether the bone runs inside it.
SAMPLES = 40
# The most bones a game engine keeps on a point.
ENGINE_MOST = 4
# The most loose parts named one by one.
PARTS_SAID = 24


def armature_for(bind, meshes):
    """The armature named, else the rig fitted to one of the meshes, else the scene's only armature; with how it was found."""
    named = bind.get("armature")
    if named is not None:
        return find_object(named, {"ARMATURE"}), ""
    names = [m.name for m in meshes]
    armatures = [o for o in scene().objects if o.type == "ARMATURE"]
    fitted = [o for o in armatures if o.get(RIG_OF) in names]
    if len(fitted) == 1:
        return fitted[0], f", the rig fitted to {fitted[0][RIG_OF]}"
    if len(fitted) > 1:
        raise Refused(f"Name bind.armature: rigs were fitted to these meshes, {listed(o.name for o in fitted)}.")
    if len(armatures) == 1:
        return armatures[0], ", the scene's only armature"
    need(armatures, "There is no armature to bind to: make its bones first.")
    raise Refused(
        f"Name bind.armature: no rig was fitted to {listed(names)}, and the scene has {len(armatures)} armatures, "
        f"{listed(o.name for o in armatures)}."
    )


def deforming(arm):
    names = [b.name for b in arm.data.bones if b.use_deform]
    need(names, f"{arm.name} has no deforming bones to bind to.")
    return names


def segment(arm, bone):
    return arm.matrix_world @ bone.head_local, arm.matrix_world @ bone.tail_local


def nearest_bone(arm, names, place):
    """The bone whose length passes nearest a point."""
    return min(names, key=lambda name: to_segment(place, *segment(arm, arm.data.bones[name])))


def middle(points):
    low = mathutils.Vector([min(p[i] for p in points) for i in range(3)])
    high = mathutils.Vector([max(p[i] for p in points) for i in range(3)])
    return (low + high) / 2


def loose_parts(mesh):
    """Each loose part of a mesh: its points' indices, joined by edges."""
    return joined_points(len(mesh.data.vertices), array(mesh.data.edges, "vertices", 2, numpy.int64))


def rigid_weights(mesh, arm, names):
    """Each loose part weighted whole to the bone that runs inside it furthest, else the nearest; a line for each."""
    world = [mesh.matrix_world @ v.co for v in mesh.data.vertices]
    part_of = {}
    parts = loose_parts(mesh)
    for i, part in enumerate(parts):
        for v in part:
            part_of[v] = i
    polygons = [[] for _ in parts]
    for p in mesh.data.polygons:
        polygons[part_of[p.vertices[0]]].append(list(p.vertices))
    groups = {n: mesh.vertex_groups.new(name=n) for n in names}
    said = []
    for i, part in enumerate(parts):
        tree = mathutils.bvhtree.BVHTree.FromPolygons(world, polygons[i]) if polygons[i] else None
        best, share = None, 0.0
        for name in names:
            head, tail = segment(arm, arm.data.bones[name])
            inside = sum(
                1 for k in range(SAMPLES) if tree and is_inside(tree, head.lerp(tail, (k + 0.5) / SAMPLES))
            ) / SAMPLES
            if inside > share:
                best, share = name, inside
        place = middle([world[v] for v in part])
        if best is None:
            best = nearest_bone(arm, names, place)
            head, tail = segment(arm, arm.data.bones[best])
            gap = min(
                (tree.find_nearest(head.lerp(tail, k / SAMPLES))[3] for k in range(SAMPLES + 1))
                if tree
                else ((world[v] - head).length for v in part)
            )
            how = f"no bone runs inside it; {best} is the nearest, {length(gap)} away"
        else:
            how = f"{best}, which runs inside it for {share * 100:.3g}% of its length"
        groups[best].add(part, 1.0, "REPLACE")
        said.append(f"- the part at {point_text(place)}, {len(part)} points: {how}")
    if len(said) > PARTS_SAID:
        said = said[:PARTS_SAID] + [f"- and {len(said) - PARTS_SAID} more parts"]
    return [f"Each of its {len(parts)} loose parts moves whole with one bone:", *said]


def placed_step(mesh, arm, preserve):
    """The mesh's Armature step on this armature, moved first, after any mirror; and where it went in words."""
    step = next(m for m in mesh.modifiers if m.type == "ARMATURE" and m.object == arm)
    step.use_vertex_groups = True
    step.use_bone_envelopes = False
    step.use_deform_preserve_volume = preserve
    mirrors = 0
    for m in mesh.modifiers:
        if m.type != "MIRROR":
            break
        mirrors += 1
    mesh.modifiers.move(mesh.modifiers.find(step.name), mirrors)
    return "first" if mirrors == 0 else "after its mirror"


def bind_mesh(mesh, arm, how, preserve, names):
    """Binds one mesh; the lines saying how, and whether it replaced earlier weights."""
    earlier = any(mesh.vertex_groups.get(n) for n in names)
    for step in [m for m in mesh.modifiers if m.type == "ARMATURE" and m.object == arm]:
        mesh.modifiers.remove(step)
    for n in names:
        group = mesh.vertex_groups.get(n)
        if group is not None:
            mesh.vertex_groups.remove(group)
    world = mesh.matrix_world.copy()
    position = arm.data.pose_position
    arm.data.pose_position = "REST"
    bpy.context.view_layer.update()
    parts = []
    try:
        if how == "rigid":
            parts = rigid_weights(mesh, arm, names)
            mesh.modifiers.new("Armature", "ARMATURE").object = arm
            mesh.parent = arm
            mesh.matrix_parent_inverse = arm.matrix_world.inverted()
            mesh.matrix_basis = world
        else:
            with bpy.context.temp_override(
                active_object=arm, object=arm, selected_objects=[mesh, arm], selected_editable_objects=[mesh, arm]
            ):
                bpy.ops.object.parent_set(type=HOW[how])
    finally:
        arm.data.pose_position = position
    need(
        any(m.type == "ARMATURE" and m.object == arm for m in mesh.modifiers),
        f"Blender did not bind {mesh.name} to {arm.name}.",
    )
    where = placed_step(mesh, arm, preserve and how != "rigid")
    return where, earlier, parts


def keep_heaviest(mesh, names, most):
    """Keeps each point's heaviest bones, at most so many, their weights summing to 1; the line saying what was dropped."""
    index = {g.index: g for g in mesh.vertex_groups if g.name in names}
    lost = []
    for v in mesh.data.vertices:
        on = sorted(((g.weight, g.group) for g in v.groups if g.group in index and g.weight > 0), reverse=True)
        kept, dropped = on[:most], on[most:]
        for _, group in dropped:
            index[group].remove([v.index])
        total = sum(w for w, _ in kept)
        if total > 0:
            for w, group in kept:
                index[group].add([v.index], w / total, "REPLACE")
        if dropped:
            lost.append(len(dropped))
    head = f"Kept at most {most} bone{'s' if most != 1 else ''} on each point, the heaviest, their weights summing to 1"
    if not lost:
        return f"{head}: no point had more."
    fewest, most_lost = min(lost), max(lost)
    span = f"{fewest}" if fewest == most_lost else f"{fewest} to {most_lost}"
    return f"{head}: {len(lost)} points lost {span} bone{'s' if most_lost != 1 else ''}."


def weights_said(mesh, arm, names):
    """What the weights hold: points with none, points on more than four bones; and the bones that move a point."""
    index = {g.index: g.name for g in mesh.vertex_groups if g.name in names}
    unweighted, most, crowded, moving = [], 0, 0, set()
    for v in mesh.data.vertices:
        on = [index[g.group] for g in v.groups if g.group in index and g.weight > 0]
        if not on:
            unweighted.append(mesh.matrix_world @ v.co)
        most = max(most, len(on))
        crowded += len(on) > ENGINE_MOST
        moving.update(on)
    lines = []
    if unweighted:
        place = middle(unweighted)
        lines.append(
            f"{len(unweighted)} points have no weight, around {point_text(place)}, nearest {nearest_bone(arm, names, place)}:"
            " they stay where they are when the bones move."
        )
    else:
        lines.append(f"Every point is weighted, by at most {most} bone{'s' if most != 1 else ''}.")
    if crowded:
        lines.append(
            f"{crowded} points are on more than {ENGINE_MOST} bones, at most {most}: a game engine keeps {ENGINE_MOST};"
            f" give influences {ENGINE_MOST} to keep the heaviest."
        )
    return lines, moving
