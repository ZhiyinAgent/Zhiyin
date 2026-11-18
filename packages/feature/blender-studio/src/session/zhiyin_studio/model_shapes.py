"""
A model file's meshes made whole, and the groups of surfaces a CAD part
comes with. A file such as a CAD export draws each face as a piece of its
own, joined to the next only by points in the same place: such a mesh is open
everywhere, and a step that rounds, thickens or smooths it tears it along the
joins. Its points in the same place are joined into one, the edges where the
file's own normals part kept sharp, so the shape and its shading stay as the
file has them and the mesh is closed where the shape is.

A CAD part's groups of surfaces, such as its machined faces, are each drawn
with a material slot of their own; the mesh lists the group of each slot.
"""

import bpy

from .errors import Refused
from .wording import listed as in_a_sentence

# Points nearer than this, in metres, are one: well under what a model file
# draws apart, and well over the rounding of its numbers.
SAME_PLACE = 1e-6
SURFACES = "zhiyin_surfaces"
CAD_PART = "zhiyin_cad_part"
CAD_SIZE = "zhiyin_cad_size"


def is_cad_part(obj):
    """Whether an object's shape is a CAD part's, made in the CAD studio: its shape changes there."""
    return obj.type == "MESH" and obj.data.get(CAD_PART) is not None


def exact_size(obj, data=None):
    """
    A CAD part's size along its own axes, as the CAD studio measured it on the
    exact solid and wrote it beside the mesh, scaled as the object is; nothing
    for a shape without one. Its mesh only approaches it, by its facets.
    """
    size = (data or obj.data).get(CAD_SIZE)
    if size is None or len(size) != 3:
        return None
    return [float(value) * abs(scale) for value, scale in zip(size, obj.scale)]


def made_whole(meshes):
    """
    Joins each mesh's points in the same place, once for a mesh several
    objects share. All are edited at once: going in and out of editing for
    each, in a scene of a few hundred thousand faces, took most of a second
    a part, minutes for an engine of a hundred and fifty.
    """
    chosen, done = [], set()
    for obj in meshes:
        if obj.type != "MESH" or obj.data in done or not obj.data.polygons:
            continue
        done.add(obj.data)
        # A mesh with shape keys or bones bends by its points, which joining would change.
        if obj.data.shape_keys is not None or obj.vertex_groups:
            continue
        chosen.append(obj)
    if not chosen:
        return
    view_layer = bpy.context.view_layer
    active = view_layer.objects.active
    selected = [o for o in view_layer.objects if o.select_get()]
    for obj in selected:
        obj.select_set(False)
    for obj in chosen:
        obj.select_set(True)
    try:
        with bpy.context.temp_override(active_object=chosen[0], object=chosen[0], selected_objects=chosen, selected_editable_objects=chosen):
            view_layer.objects.active = chosen[0]
            bpy.ops.object.mode_set(mode="EDIT")
            bpy.ops.mesh.select_all(action="SELECT")
            bpy.ops.mesh.remove_doubles(threshold=SAME_PLACE, use_sharp_edge_from_normals=True)
            bpy.ops.mesh.select_all(action="DESELECT")
            bpy.ops.object.mode_set(mode="OBJECT")
    finally:
        for obj in chosen:
            obj.select_set(False)
        for obj in selected:
            obj.select_set(True)
        view_layer.objects.active = active


def surfaces_of(mesh):
    """The group of surfaces each of a mesh's slots draws, "" for the part's other faces; none when it has no groups."""
    named = mesh.get(SURFACES)
    if named is None:
        return None
    return [str(n) for n in named]


# What a CAD part's faces in no group are called, in answers and in set_material.
REST = "rest"


def surface_names(mesh):
    """The name of the surfaces each slot draws, the faces in no group being the rest."""
    return [n or REST for n in surfaces_of(mesh) or []]


def slots_of_surface(obj, surface):
    """
    The slots that draw a group of a CAD part's surfaces, refused with the
    groups it has when it has no such group.
    """
    names = surface_names(obj.data) if obj.type == "MESH" else []
    if not names:
        raise Refused(
            f"“{obj.name}” has no groups of surfaces: only a part from the CAD studio has them, named as it is shown there."
            " Leave surface out to give the whole object the material."
        )
    if surface not in names:
        joined = in_a_sentence(sorted(set(names) - {REST}) + ([REST] if REST in names else []))
        raise Refused(f"{obj.name}'s surfaces are {joined}: name one of them.")
    return [i for i, n in enumerate(names) if n == surface]


def slots_by_group(old, new):
    """
    For each slot of the new shape, the old shape's slot whose material it
    takes, both shapes having groups: the slot of the same group, or for a
    group the old shape lacks, the slot of the part's other faces.
    """
    before, after = surfaces_of(old), surfaces_of(new)
    last = max(len(old.materials) - 1, 0)
    rest = before.index("") if "" in before else 0
    return [min(before.index(group) if group in before else rest, last) for group in after]
