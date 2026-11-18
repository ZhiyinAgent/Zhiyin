"""
Retopology: a dense mesh remade as quads with QuadriFlow, relaxed and laid back onto the source.
It says how many faces it made and how many are quads, its poles, how far the source's surface
lies from the new one, and how much the volume changed. A source that is not one closed surface
is refused, naming where it is open.
"""

import math

import bmesh
import bpy
from mathutils.bvhtree import BVHTree

from .arguments import whole
from .errors import Refused
from .finding import unused_name
from .geometry import sampled
from .mesh_panels import linear_scale
from .picking import mesh_object, spread
from .reports import report
from .wording import length


def own_mesh(obj):
    """The object's mesh as it is shown, modifiers applied, in its own space."""
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    bm = bmesh.new()
    bm.from_mesh(evaluated.to_mesh())
    evaluated.to_mesh_clear()
    return bm


def closed_or_refused(obj, bm):
    """Refuses a surface QuadriFlow cannot remesh, saying where it is open or tangled."""
    matrix = obj.matrix_world
    opened = [e for e in bm.edges if e.is_boundary]
    if opened:
        raise Refused(
            f"{obj.name} is not closed: {len(opened)} of its edges are open, at"
            f" {spread([matrix @ v.co for e in opened for v in e.verts])}."
            " QuadriFlow remeshes only a closed surface; fill its holes first."
        )
    tangled = [e for e in bm.edges if len(e.link_faces) > 2]
    if tangled:
        raise Refused(
            f"{obj.name} is not one clean surface: {len(tangled)} of its edges join more than two faces, at"
            f" {spread([matrix @ v.co for e in tangled for v in e.verts])}."
            " QuadriFlow remeshes only a surface whose every edge joins two faces."
        )


def quadriflow(obj, target, symmetric, keep_sharp, *, keep_boundary=False, seed=0):
    """Runs QuadriFlow on `obj` alone, mirrored across the axes its mesh is set to mirror on; whether it finished."""
    view_layer = bpy.context.view_layer
    active = view_layer.objects.active
    selected = [o for o in view_layer.objects if o.select_get()]
    for other in selected:
        other.select_set(False)
    obj.select_set(True)
    view_layer.objects.active = obj
    try:
        with bpy.context.temp_override(
            active_object=obj, object=obj, selected_objects=[obj], selected_editable_objects=[obj]
        ):
            result = bpy.ops.object.quadriflow_remesh(
                mode="FACES",
                target_faces=target,
                use_mesh_symmetry=symmetric,
                use_preserve_sharp=keep_sharp,
                use_preserve_boundary=keep_boundary,
                seed=seed,
            )
    finally:
        obj.select_set(False)
        for other in selected:
            other.select_set(True)
        view_layer.objects.active = active
    return "FINISHED" in result


def relaxed_onto(bm, surface, rounds):
    """Smooths the new mesh `rounds` times, laying every point back on the source's surface."""
    inner = [v for v in bm.verts if not v.is_boundary]
    for _ in range(rounds):
        bmesh.ops.smooth_vert(bm, verts=inner, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
        for v in bm.verts:
            found = surface.find_nearest(v.co)[0]
            if found is not None:
                v.co = found
    for v in bm.verts:
        found = surface.find_nearest(v.co)[0]
        if found is not None:
            v.co = found


def poles(bm):
    counts = [len(v.link_edges) for v in bm.verts if not v.is_boundary]
    return sum(1 for c in counts if c == 3), sum(1 for c in counts if c == 5), sum(1 for c in counts if c >= 6)


def lies_within(source, made, scale):
    """How far the source's points lie from the new surface, at most and on average, in the world."""
    tree = BVHTree.FromBMesh(made)
    gaps = [(p - tree.find_nearest(p)[0]).length * scale for p in sampled(source.verts)]
    return max(gaps), sum(gaps) / len(gaps)


def volume_words(before, after):
    change = (after - before) / before * 100 if before else 0
    if abs(change) < 0.05:
        return "volume unchanged"
    return f"volume {abs(change):.1f}% {'smaller' if change < 0 else 'larger'}"


def retopo(obj, faces=2000, *, name=None, symmetric=False, keep_sharp=False, relax=2):
    """
    A new object of about `faces` quads over `obj`, made by QuadriFlow, relaxed `relax` times and
    laid back on the source's surface; mirrored across the object's x when `symmetric`, keeping
    sharp edges when `keep_sharp`. The source is hidden and kept. Says the faces and quads, the
    poles, how far the source lies from the new surface, and the change in volume.
    """
    source = mesh_object(obj, "retopo")
    target = whole(faces, "faces", minimum=10, maximum=200000, default=2000)
    rounds = whole(relax, "relax", minimum=0, maximum=20, default=2)
    called = unused_name(name or f"{source.name} retopo")
    scale = linear_scale(source)
    original = own_mesh(source)
    try:
        closed_or_refused(source, original)
        surface = BVHTree.FromBMesh(original)
        before = len(original.faces)
        volume_before = original.calc_volume(signed=False) * scale**3
        mesh = bpy.data.meshes.new(called)
        original.to_mesh(mesh)
        mesh.use_mirror_x = bool(symmetric)
        made = bpy.data.objects.new(called, mesh)
        made.matrix_world = source.matrix_world.copy()
        for into in source.users_collection:
            into.objects.link(made)
        if not quadriflow(made, target, bool(symmetric), bool(keep_sharp)) or not made.data.polygons:
            bpy.data.objects.remove(made)
            bpy.data.meshes.remove(mesh)
            raise Refused(f"QuadriFlow could not remesh {source.name} into about {target} faces; try another number of faces.")
        result = bmesh.new()
        try:
            result.from_mesh(made.data)
            relaxed_onto(result, surface, rounds)
            result.to_mesh(made.data)
            made.data.update()
            count = len(result.faces)
            quads = sum(1 for f in result.faces if len(f.verts) == 4)
            three, five, six = poles(result)
            most, mean = lies_within(original, result, scale)
            volume_after = result.calc_volume(signed=False) * scale**3
        finally:
            result.free()
    finally:
        original.free()
    source.hide_set(True)
    source.hide_render = True
    report(
        f"Retopologised {source.name} as {called}: {count} faces (asked {target}) from {before},"
        f" {math.floor(quads / count * 100)}% quads; poles: {three} of 3 edges, {five} of 5, {six} of 6 or more;"
        f" {source.name} lies within {length(most)} of it (mean {length(mean)});"
        f" {volume_words(volume_before, volume_after)}. {source.name} is hidden."
    )
    return made


FUNCTIONS = (retopo,)
