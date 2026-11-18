"""
A voxel remesh between sculpt passes: the mesh remade as even faces of one size, so stretched
faces and split detail start over. Says the faces and points before and after, how far the new
surface strays from the old, the volume change, and the masks it carried over, each point taking
the weight of the nearest point before.
"""

from mathutils.kdtree import KDTree

from .arguments import need, number
from .errors import Refused
from .picking import mesh_object
from .reports import report
from .sculpt_shape import REST, volume_change
from .shape_measures import Deviation
from .shaping_remesh import voxel_remeshed
from .shown_mesh import shown_bmesh
from .wording import length


def world_copy(obj):
    return shown_bmesh(obj, steps=False)


def group_weights(obj):
    """Each vertex group's weights, by point."""
    found = {g.name: {} for g in obj.vertex_groups}
    names = {g.index: g.name for g in obj.vertex_groups}
    for v in obj.data.vertices:
        for g in v.groups:
            if g.group in names:
                found[names[g.group]][v.index] = g.weight
    return found


def carried(obj, places, weights):
    """Gives each new point every group's weight at the nearest point before."""
    tree = KDTree(len(places))
    for i, at in enumerate(places):
        tree.insert(at, i)
    tree.balance()
    nearest = [tree.find(v.co)[1] for v in obj.data.vertices]
    for name, held in weights.items():
        group = obj.vertex_groups.get(name) or obj.vertex_groups.new(name=name)
        for v, old in zip(obj.data.vertices, nearest):
            if held.get(old, 0) > 0:
                group.add([v.index], held[old], "REPLACE")


def sculpt_remesh(obj, voxel, *, keep_volume=True):
    """
    Remakes a mesh as even faces `voxel` metres across, its volume kept when `keep_volume`, its
    masks carried over by the nearest earlier point. Says the faces and points before and after,
    how far it strays from the shape before, and the volume change.
    """
    obj = mesh_object(obj, "sculpt_remesh")
    size = number(voxel, "voxel", minimum=0)
    need(size > 0, "voxel must be a length in metres more than 0.")
    if obj.modifiers:
        raise Refused(
            f"{obj.name} shows its steps ({', '.join(m.name for m in obj.modifiers)}), and a remesh remakes the mesh"
            " under them: apply or remove them first."
        )
    before = world_copy(obj)
    try:
        need(before.faces, f"{obj.name} has no faces to remesh.")
        faces, points = len(before.faces), len(before.verts)
        volume = before.calc_volume(signed=False)
        weights = group_weights(obj)
        places = [v.co.copy() for v in obj.data.vertices]
        voxel_remeshed(obj, size, "a voxel", keep_volume=bool(keep_volume))
        if REST in obj.data.attributes:
            obj.data.attributes.remove(obj.data.attributes[REST])
        if weights:
            carried(obj, places, weights)
        after = world_copy(obj)
        try:
            strays = Deviation(before, after).words("its shape before", "the remesh")
            volume_words = volume_change(volume, after.calc_volume(signed=False))
            made_faces, made_points = len(after.faces), len(after.verts)
        finally:
            after.free()
    finally:
        before.free()
    masks = (
        f"; the mask{'s' if len(weights) != 1 else ''} {', '.join(f'“{n}”' for n in weights)} carried over by the nearest earlier point"
        if weights
        else ""
    )
    report(
        f"Remeshed {obj.name} in voxels of {length(size)}: faces {faces} → {made_faces}, points {points} → {made_points};"
        f" it strays from its shape before by {strays}; {volume_words}{masks}."
    )
    return obj
