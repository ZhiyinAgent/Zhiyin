"""
Fine detail through Multires: an object given Multires levels and a copy of its finest level to
sculpt, whose shape a reshape puts back into the levels, point for point; and the levels baked
by Blender's Multires baker onto the object's own base, as a tangent-space normal map and a
displacement map, written as pictures in the workspace.
"""

import contextlib
import os

import bpy
import numpy
from mathutils.bvhtree import BVHTree

from .arguments import need, whole
from .bake_files import write_map
from .errors import Refused
from .finding import scene, unused_name
from .picking import mesh_object
from .reports import report
from .unwrap_measures import raster
from .wording import length

# Where a detail copy names the object whose levels it shapes.
DETAIL_OF = "zhiyin_detail_of"
MAPS = {"normal": ("NORMALS", "normal"), "displacement": ("DISPLACEMENT", "height")}


def only(obj, *others):
    """The context of an operator that works on `obj`, with `others` selected beside it."""
    chosen = [*others, obj]
    return bpy.context.temp_override(
        object=obj, active_object=obj, selected_objects=chosen, selected_editable_objects=chosen
    )


def levels_of(obj):
    """The object's Multires step, or None."""
    return next((m for m in obj.modifiers if m.type == "MULTIRES"), None)


def finest(obj, step):
    """The object's points at its finest level, in its own space, as an (N, 3) array."""
    shown = step.levels
    step.levels = step.total_levels
    try:
        evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
        mesh = evaluated.to_mesh()
        try:
            found = numpy.empty(len(mesh.vertices) * 3)
            mesh.vertices.foreach_get("co", found)
        finally:
            evaluated.to_mesh_clear()
    finally:
        step.levels = shown
    return found.reshape(-1, 3)


def in_world(obj, points):
    matrix = numpy.array(obj.matrix_world)
    return points @ matrix[:3, :3].T + matrix[:3, 3]


def sculpt_detail(obj, levels=2):
    """
    Gives a mesh `levels` Multires levels and makes a copy of its finest level, named
    "<name> detail", to sculpt with the library's brushes; the object is hidden meanwhile.
    zhiyin.sculpt_reshape puts the copy's shape into the levels. Returns the copy.
    """
    obj = mesh_object(obj, "sculpt_detail")
    count = whole(levels, "levels", minimum=1, maximum=6, default=2)
    others = [m.name for m in obj.modifiers if m.type != "MULTIRES"]
    if others:
        raise Refused(
            f"{obj.name} has steps besides Multires ({', '.join(others)}), and Multires levels hold detail on the mesh"
            " itself, before any step: apply or remove them first."
        )
    called = unused_name(f"{obj.name} detail")
    step = levels_of(obj)
    if step is None:
        step = obj.modifiers.new("Multires", "MULTIRES")
    if step.total_levels > count:
        raise Refused(f"{obj.name} already has {step.total_levels} Multires levels; give levels={step.total_levels} to sculpt them.")
    with only(obj):
        while step.total_levels < count:
            bpy.ops.object.multires_subdivide(modifier=step.name, mode="CATMULL_CLARK")
    step.levels = step.sculpt_levels = step.render_levels = count
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = bpy.data.meshes.new_from_object(evaluated)
    mesh.name = called
    copy = bpy.data.objects.new(called, mesh)
    copy.matrix_world = obj.matrix_world.copy()
    for into in obj.users_collection:
        into.objects.link(copy)
    copy[DETAIL_OF] = obj.name
    obj.hide_set(True)
    obj.hide_render = True
    report(
        f"Gave {obj.name} {count} Multires levels and made “{called}”, its {len(mesh.vertices)} points at level {count}"
        f" ({obj.name} has {len(obj.data.vertices)}): sculpt the copy, then zhiyin.sculpt_reshape(“{called}”) puts its"
        f" shape into the levels; {obj.name} is hidden meanwhile."
    )
    return copy


def sculpt_reshape(copy):
    """
    Puts a detail copy's shape into the Multires levels of the object it was made from, point for
    point, then removes the copy and shows the object. Says the points moved and the most, and
    how far the object's finest level then strays from the copy.
    """
    copy = mesh_object(copy, "sculpt_reshape")
    named = copy.get(DETAIL_OF)
    need(named, f"{copy.name} is not a detail copy: zhiyin.sculpt_detail makes one.")
    obj = bpy.data.objects.get(named)
    need(obj is not None and obj.type == "MESH", f"{copy.name} was made from {named}, which is gone.")
    step = levels_of(obj)
    need(step is not None and step.total_levels > 0, f"{obj.name} has no Multires levels for {copy.name} to shape.")
    before = finest(obj, step)
    if len(copy.data.vertices) != len(before):
        raise Refused(
            f"{copy.name} has {len(copy.data.vertices)} points, and {obj.name}'s level {step.total_levels} has {len(before)}:"
            " a reshape needs the copy's points as the levels made them, so sculpt the copy without detail= or a remesh."
        )
    shown = step.levels
    step.levels = step.total_levels
    try:
        with only(obj, copy):
            done = bpy.ops.object.multires_reshape(modifier=step.name)
    finally:
        step.levels = shown
    need("FINISHED" in done, f"Blender could not reshape {obj.name}'s levels from {copy.name}.")
    after = finest(obj, step)
    shaped = numpy.empty(len(copy.data.vertices) * 3)
    copy.data.vertices.foreach_get("co", shaped)
    moves = numpy.linalg.norm(in_world(obj, after) - in_world(obj, before), axis=1)
    strays = numpy.linalg.norm(in_world(obj, after) - in_world(copy, shaped.reshape(-1, 3)), axis=1)
    moved = int((moves > 1e-6).sum())
    name, levels = copy.name, step.total_levels
    mesh = copy.data
    bpy.data.objects.remove(copy)
    if not mesh.users:
        bpy.data.meshes.remove(mesh)
    obj.hide_set(False)
    obj.hide_render = False
    report(
        f"Reshaped {obj.name}'s {levels} Multires levels from “{name}”: {moved} of its {len(after)} points moved,"
        f" the most {length(float(moves.max()))}; it strays from the copy by up to {length(float(strays.max()))};"
        f" removed the copy and shows {obj.name} again."
    )
    return obj


@contextlib.contextmanager
def baking(obj, step, image):
    """The Multires baker set to bake the finest level onto the base into `image`; all put back after."""
    s = scene()
    bake = s.render.bake
    kept = (bake.use_multires, bake.type, bake.margin, step.levels, step.render_levels)
    made = None
    if not obj.data.materials:
        made = bpy.data.materials.new(f"{obj.name} bake")
        obj.data.materials.append(made)
    nodes = []
    for material in {m for m in obj.data.materials if m is not None}:
        tree = material.node_tree
        node = tree.nodes.new("ShaderNodeTexImage")
        nodes.append((tree, node, tree.nodes.active))
        node.image = image
        tree.nodes.active = node
    try:
        bake.use_multires = True
        bake.margin = 4
        step.levels = 0
        step.render_levels = step.total_levels
        yield
    finally:
        for tree, node, active in nodes:
            tree.nodes.remove(node)
            if active is not None:
                tree.nodes.active = active
        if made is not None:
            obj.data.materials.pop()
            bpy.data.materials.remove(made)
        bake.use_multires, bake.type, bake.margin, step.levels, step.render_levels = kept


def covered(obj, size):
    """The share of the texture the object's UV layout covers."""
    mesh = obj.data
    mesh.calc_loop_triangles()
    uv = mesh.uv_layers.active.data
    corners = numpy.array([[uv[i].uv[:] for i in t.loops] for t in mesh.loop_triangles], dtype=numpy.float64)
    texels, _ = raster(corners.reshape(-1, 3, 2), size)
    return len(numpy.unique(texels)) / size**2


def height_reach(obj, step):
    """How far the finest level lies from the base surface at most, in the world."""
    base = BVHTree.FromPolygons(
        [obj.matrix_world @ v.co for v in obj.data.vertices], [list(p.vertices) for p in obj.data.polygons]
    )
    points = in_world(obj, finest(obj, step))
    return max((base.find_nearest(p)[3] or 0.0) for p in points)


def sculpt_bake(obj, *, size=1024, maps=("normal", "displacement"), folder="textures"):
    """
    Bakes an object's Multires levels onto its base mesh with Blender's Multires baker: a
    tangent-space normal map and a displacement map, mid-grey on the base surface, `size` pixels
    square, written in the workspace's `folder` as "<name> normal.png" and "<name> displacement.png".
    Returns each map's path by its kind.
    """
    obj = mesh_object(obj, "sculpt_bake")
    step = levels_of(obj)
    need(
        step is not None and step.total_levels > 0,
        f"{obj.name} has no Multires levels to bake; make them with zhiyin.sculpt_detail.",
    )
    need(obj.data.uv_layers, f"{obj.name} has no UV layout for the maps to lie in; unwrap it first with blender_unwrap.")
    pixels = whole(size, "size", minimum=16, maximum=8192, default=1024)
    need(isinstance(maps, (list, tuple)) and maps, "maps must list normal, displacement or both.")
    need(all(m in MAPS for m in maps), "maps must list normal, displacement or both.")
    need(isinstance(folder, str) and folder.strip(), "folder must be a folder in the workspace.")
    os.makedirs(folder, exist_ok=True)
    written = {}
    image = bpy.data.images.new(f"{obj.name} multires bake", pixels, pixels, float_buffer=True)
    try:
        with baking(obj, step, image):
            for kind in dict.fromkeys(maps):
                scene().render.bake.type = MAPS[kind][0]
                with only(obj):
                    done = bpy.ops.object.bake_image()
                need("FINISHED" in done, f"Blender's Multires baker could not bake {obj.name}'s {kind} map.")
                values = numpy.empty(pixels * pixels * 4, dtype=numpy.float32)
                image.pixels.foreach_get(values)
                path = os.path.join(folder, f"{obj.name} {kind}.png")
                write_map(os.path.abspath(path), MAPS[kind][1], values.reshape(-1, 4)[:, :3], pixels)
                written[kind] = path
    finally:
        bpy.data.images.remove(image)
    said = []
    if "normal" in written:
        said.append(f"a normal map, tangent space, at {written['normal']}")
    if "displacement" in written:
        said.append(
            f"a displacement map at {written['displacement']}, mid-grey on the base surface,"
            f" white and black about {length(height_reach(obj, step))} out and in"
        )
    report(
        f"Baked {obj.name}'s {step.total_levels} Multires levels onto its base at {pixels} px: {'; '.join(said)};"
        f" the layout covers {round(covered(obj, pixels) * 100)}% of the texture."
    )
    return written
