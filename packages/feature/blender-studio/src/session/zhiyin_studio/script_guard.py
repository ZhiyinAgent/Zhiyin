"""
The operators a model's script is kept from while it runs: those that end a
Blender with no window, snapping, which does nothing without one, and, on a
computer whose graphics card cannot draw, those that would draw on it.

Each is answered with an error naming it and the way to the same result
through bmesh or Blender's data, before Blender is reached. The guard holds
only while a script runs, and Zhiyin's own work calls Blender as it is.

It guards these operators and nothing else. The script runs in a Blender of
its own, which is ended once it has saved the scene, so what it replaces or
leaves in Python never reaches the session that measures and describes the
scene after it.
"""

import contextlib

import bpy

from .graphics_card import refused_by_card

# Each operator that ends this Blender, run without a window, with an access
# violation, measured on Blender 5.2.2: what to do instead.
CRASHES = {
    "mesh.loopcut": "cut loops with bmesh.ops.subdivide_edgering(bm, edges=ring, cuts=n), ring being the edges the loop crosses",
    "mesh.loopcut_slide": "cut loops with bmesh.ops.subdivide_edgering(bm, edges=ring, cuts=n), ring being the edges the loop crosses",
    "sculpt.mesh_filter": "filter the mesh with zhiyin.sculpt_filter(obj, kind), kind smooth, relax, sharpen, inflate or noise, which says what it moved; or move the vertices through the mesh's data: mesh.vertices.foreach_get and foreach_set with numpy",
    "sculpt.color_filter": "set the colours through mesh.color_attributes, each item's color",
    "sculpt.symmetrize": "make a sculpted shape symmetric with zhiyin.sculpt_symmetrize(obj), which keeps its points, or cut and mirror the mesh with zhiyin.symmetrize(obj)",
    "sculpt.mask_filter": "make a sculpt mask as a vertex group with zhiyin.sculpt_mask(picked, name), which zhiyin.sculpt and zhiyin.sculpt_filter take as mask=; or set Blender's own mask through the mesh's float attribute .sculpt_mask on its points: mesh.attributes['.sculpt_mask'].data.foreach_set('value', values)",
    "sculpt.mask_init": "make a sculpt mask as a vertex group with zhiyin.sculpt_mask(picked, name), which zhiyin.sculpt and zhiyin.sculpt_filter take as mask=; or set Blender's own mask through the mesh's float attribute .sculpt_mask on its points: mesh.attributes['.sculpt_mask'].data.foreach_set('value', values)",
    "sculpt.mask_from_boundary": "make a sculpt mask as a vertex group with zhiyin.sculpt_mask(picked, name), which zhiyin.sculpt and zhiyin.sculpt_filter take as mask=; or set Blender's own mask through the mesh's float attribute .sculpt_mask on its points: mesh.attributes['.sculpt_mask'].data.foreach_set('value', values)",
    "sculpt.mask_from_cavity": "make a sculpt mask as a vertex group with zhiyin.sculpt_mask(picked, name), which zhiyin.sculpt and zhiyin.sculpt_filter take as mask=; or set Blender's own mask through the mesh's float attribute .sculpt_mask on its points: mesh.attributes['.sculpt_mask'].data.foreach_set('value', values)",
    "paint.mask_flood_fill": "make a sculpt mask as a vertex group with zhiyin.sculpt_mask(picked, name), which zhiyin.sculpt and zhiyin.sculpt_filter take as mask=; or set Blender's own mask through the mesh's float attribute .sculpt_mask on its points: mesh.attributes['.sculpt_mask'].data.foreach_set('value', values)",
    "sculpt.face_sets_create": "set the face sets through the mesh's integer attribute .sculpt_face_set on its faces",
    "sculpt.face_sets_init": "set the face sets through the mesh's integer attribute .sculpt_face_set on its faces",
    "sculpt.face_set_change_visibility": "hide faces through the mesh's boolean attribute .hide_poly on its faces, or each polygon's hide",
    "uv.stitch": "set the UVs that meet to the same place through mesh.uv_layers.active.data[loop].uv, or bmesh's loop layers, or join them with bpy.ops.uv.weld",
    "paint.project_image": "write the picture's pixels with image.pixels.foreach_set, or lay the picture on the surface through the material, as blender_set_material's texture does",
}

SNAPPING = (
    "snapping does nothing in a Blender without a window: it moves by the plain value given and ignores the snap"
    " (and face-nearest snapping ends this Blender). Place by measured positions instead: read where the target is,"
    " from obj.matrix_world @ v.co of its vertices, its bound_box, or a mathutils.bvhtree.BVHTree's ray_cast or"
    " find_nearest, and set the location from it; blender_edit_objects sets an object down on another."
)


def asks_to_snap(kwargs):
    """Whether an operator's arguments, or those of a transform it runs after itself, ask it to snap."""
    if kwargs.get("snap"):
        return True
    return any(isinstance(value, dict) and value.get("snap") for value in kwargs.values())


class Guarded:
    """
    An operator as a script sees it while it runs: one that ends Blender is
    refused whatever it is given, any other only when it asks to snap. Its
    poll and description are the operator's own.
    """

    def __init__(self, name, operator):
        self._name = name
        self._operator = operator

    def __call__(self, *args, **kwargs):
        if self._name in CRASHES:
            raise RuntimeError(
                f"bpy.ops.{self._name} ends this Blender, which runs without a window, so it was not run."
                f" Instead, {CRASHES[self._name]}."
            )
        if kwargs and asks_to_snap(kwargs):
            raise RuntimeError(f"bpy.ops.{self._name}: {SNAPPING}")
        on_card = refused_by_card(self._name, kwargs)
        if on_card:
            raise RuntimeError(f"bpy.ops.{self._name} was not run: {on_card}.")
        return self._operator(*args, **kwargs)

    def __getattr__(self, name):
        return getattr(self._operator, name)

    def __repr__(self):
        return repr(self._operator)


def guarded_module(module, real):
    found = real(module)
    held = type(found)(found.__name__)

    def operator(name):
        if name.startswith("__"):
            raise AttributeError(name)
        return Guarded(f"{module}.{name}", getattr(found, name))

    held.__getattr__ = operator
    held.__dir__ = found.__dir__
    return held


@contextlib.contextmanager
def guarded_operators():
    """bpy.ops as a model's script sees it, for as long as it runs."""
    real = bpy.ops.__getattr__

    def module(name):
        if name.startswith("__"):
            raise AttributeError(name)
        return guarded_module(name, real)

    bpy.ops.__getattr__ = module
    try:
        yield
    finally:
        bpy.ops.__getattr__ = real
