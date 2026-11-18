"""
Cycles bakes as the studio runs them: the scene's render and bake settings, its selection and
what it shows put back exactly afterwards; a picture in memory each bake writes into, its
texels left unwritten told from those a ray reached; and, for a bake from high-detail objects,
the cage set from the gap measured between the two surfaces.
"""

import contextlib

import bpy
import mathutils.bvhtree
import numpy

from .finding import scene
from .geometry import world_mesh
from .pictures import Kept

# The bake settings a bake changes, put back after.
BAKE_FIELDS = (
    "margin",
    "margin_type",
    "use_selected_to_active",
    "cage_extrusion",
    "max_ray_distance",
    "use_clear",
    "normal_space",
    "target",
    "use_cage",
)
# How much further than the measured gap the cage reaches, and the least it reaches, in metres.
CAGE_SPARE, CAGE_LEAST = 1.2, 0.001
# The most points of the object the gap is measured from.
GAP_POINTS = 6000


@contextlib.contextmanager
def baking_scene(objects):
    """Cycles on the session's device, every object given shown and selectable, all put back after."""
    s = scene()
    kept = Kept()
    bake = s.render.bake
    bake_kept = {field: getattr(bake, field) for field in BAKE_FIELDS}
    view_layer = bpy.context.view_layer
    active = view_layer.objects.active
    selected = [o for o in view_layer.objects if o.select_get()]
    shown = [(o, o.hide_get(), o.hide_viewport, o.hide_render, o.hide_select) for o in objects]
    try:
        s.render.engine = "CYCLES"
        devices = bpy.context.preferences.addons["cycles"].preferences.compute_device_type
        s.cycles.device = "CPU" if devices == "NONE" else "GPU"
        for obj, *_ in shown:
            obj.hide_set(False)
            obj.hide_viewport = False
            obj.hide_render = False
            obj.hide_select = False
        yield
    finally:
        for obj, in_layer, in_viewport, in_render, unselectable in shown:
            obj.hide_select = unselectable
            obj.hide_render = in_render
            obj.hide_viewport = in_viewport
            obj.hide_set(in_layer)
        for obj in view_layer.objects:
            obj.select_set(obj in selected)
        view_layer.objects.active = active
        for field, value in bake_kept.items():
            setattr(bake, field, value)
        kept.restore()


class Target:
    """A float picture in memory a bake writes into, read only in the texels it was written."""

    def __init__(self, size):
        self.size = size
        self.image = bpy.data.images.new("Zhiyin bake", size, size, alpha=True, float_buffer=True)
        self.image.colorspace_settings.name = "Non-Color"
        self.image.pixels.foreach_set(numpy.zeros(size * size * 4, dtype=numpy.float32))

    def pixels(self):
        """The picture as rows of RGBA, bottom row first, as Blender holds it."""
        found = numpy.empty(self.size * self.size * 4, dtype=numpy.float32)
        self.image.pixels.foreach_get(found)
        return found.reshape(self.size * self.size, 4)

    def free(self):
        bpy.data.images.remove(self.image)


@contextlib.contextmanager
def baked_into(obj, target):
    """The object's materials each with a picture node of the target, chosen, while the block runs."""
    made = []
    try:
        for material in {slot.material for slot in obj.material_slots if slot.material is not None}:
            node = material.node_tree.nodes.new("ShaderNodeTexImage")
            node.image = target.image
            was = material.node_tree.nodes.active
            material.node_tree.nodes.active = node
            made.append((material, node, was))
        yield
    finally:
        for material, node, was in made:
            material.node_tree.nodes.remove(node)
            if was is not None and was.name in material.node_tree.nodes:
                material.node_tree.nodes.active = was


def run_bake(obj, kind, samples, margin, highs=(), cage=None):
    """One Cycles bake of `kind` onto the object, from `highs` when given, with the object's chosen pictures as targets."""
    s = scene()
    s.cycles.samples = samples
    view_layer = bpy.context.view_layer
    for other in view_layer.objects:
        other.select_set(other is obj or other in highs)
    view_layer.objects.active = obj
    settings = dict(type=kind, margin=margin, margin_type="ADJACENT_FACES", use_clear=False, target="IMAGE_TEXTURES")
    if kind == "NORMAL":
        settings.update(normal_space="TANGENT", normal_r="POS_X", normal_g="POS_Y", normal_b="POS_Z")
    if highs:
        settings.update(use_selected_to_active=True, cage_extrusion=cage[0], max_ray_distance=cage[1], use_cage=False)
    else:
        settings.update(use_selected_to_active=False)
    with bpy.context.temp_override(active_object=obj, object=obj, selected_objects=[obj, *highs], selected_editable_objects=[obj, *highs]):
        bpy.ops.object.bake(**settings)


def gap(obj, highs):
    """
    How far the high-detail surfaces lie outside and inside the object's own, along its
    normals, in metres, from points spread over it: (outside, inside).
    """
    trees = []
    for high in highs:
        part = world_mesh(high)
        try:
            trees.append(mathutils.bvhtree.BVHTree.FromBMesh(part))
        finally:
            part.free()
    own = world_mesh(obj)
    try:
        own.normal_update()
        points = [(v.co.copy(), v.normal.copy()) for v in own.verts] + [(f.calc_center_median(), f.normal.copy()) for f in own.faces]
    finally:
        own.free()
    step = max(1, len(points) // GAP_POINTS)
    outside, inside = 0.0, 0.0
    for point, normal in points[::step]:
        found = [hit for hit in (tree.find_nearest(point) for tree in trees) if hit[0] is not None]
        if not found:
            continue
        nearest = min(found, key=lambda hit: hit[3])[0]
        along = (nearest - point).dot(normal)
        outside, inside = max(outside, along), max(inside, -along)
    return outside, inside


def cage_from(outside, inside):
    """The cage's reach out from the object and the rays' length in from it, past the measured gap."""
    extrusion = outside * CAGE_SPARE + CAGE_LEAST
    return extrusion, extrusion + inside * CAGE_SPARE + CAGE_LEAST
