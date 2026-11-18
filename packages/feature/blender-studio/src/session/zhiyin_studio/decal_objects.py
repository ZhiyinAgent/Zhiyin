"""
A decal as an object of the scene, whatever its kind: what a call asks of it, the object it is made
into, attached to the one it lies on with its shape in that object's own space, the points its gap
to the surface is measured at, and the other decals it lies over.
"""

import bmesh
import bpy
import mathutils
from mathutils.bvhtree import BVHTree

from .arguments import number
from .decal_cards import middle_lines, worst_stretch
from .decal_surface import lift, standoff
from .finding import scene
from .wording import listed

# Kept on a decal: the object it lies on, and how far it stands off it.
DECAL = "zhiyin_decal"
LIFT = "zhiyin_decal_lift"
OFFSET = 0.0001
# The least and most of a roughness, metal or coat a decal gives its surface.
CHANNEL_RANGE = (0, 1)


class Decal:
    """What a call asks of a decal, read and checked."""

    def __init__(self, name, target):
        self.name, self.target = name, target.name
        self.affects, self.values, self.colour, self.relief = [], {}, None, 0.0


def percent(share):
    found = share * 100
    return f"{round(found)}%" if found >= 1 or found == 0 else f"{found:.2g}%"


def world_tree(obj):
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    bm = bmesh.new()
    try:
        bm.from_mesh(evaluated.to_mesh())
        evaluated.to_mesh_clear()
        bmesh.ops.transform(bm, matrix=obj.matrix_world, verts=list(bm.verts))
        return BVHTree.FromBMesh(bm)
    finally:
        bm.free()


def overlapping(target, points):
    """The other decals on the object that lie over these points of the surface, each with the share it covers."""
    found = []
    if not points:
        return found
    for other in scene().objects:
        if other.get(DECAL) != target.name or other.type != "MESH":
            continue
        tree = world_tree(other)
        reach = max(2 * float(other.get(LIFT, OFFSET)), 0.0002)
        under = sum(1 for p in points if tree.find_nearest(p, reach)[0] is not None)
        if under:
            found.append((other, under / len(points)))
    return found


def overlap_text(found):
    if not found:
        return "It overlaps no other decal."
    said = listed(f"“{o.name}” over {percent(share)} of its area" for o, share in found)
    return f"It overlaps {said} and sits above {'it' if len(found) == 1 else 'them'}."


def made_object(bm, name, target, lifted):
    """The decal as an object attached to the one it lies on, its shape kept in that object's own space."""
    matrix = target.matrix_world
    bmesh.ops.transform(bm, matrix=matrix.inverted(), verts=list(bm.verts))
    if matrix.determinant() < 0:
        bmesh.ops.reverse_faces(bm, faces=list(bm.faces))
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    obj = bpy.data.objects.new(name, mesh)
    (target.users_collection[0] if target.users_collection else scene().collection).objects.link(obj)
    obj.parent = target
    obj.matrix_parent_inverse = mathutils.Matrix.Identity(4)
    obj.matrix_basis = mathutils.Matrix.Identity(4)
    data = getattr(target, "data", None)
    if data is not None and hasattr(data, "texspace_location"):
        # The surface's material reads its generated places as the object does.
        mesh.use_auto_texspace = False
        mesh.texspace_location = data.texspace_location
        mesh.texspace_size = data.texspace_size
    obj.visible_shadow = False
    obj[DECAL] = target.name
    obj[LIFT] = lifted
    return obj


def measured_points(bm):
    """A decal's corners, the middles of its edges and of its faces: where its gap to the surface is measured."""
    return (
        [v.co.copy() for v in bm.verts]
        + [(e.verts[0].co + e.verts[1].co) / 2 for e in bm.edges]
        + [f.calc_center_median() for f in bm.faces]
    )


def read_values(args, decal, defaults):
    for key in ("roughness", "metal", "coat"):
        value = args.get(key)
        if value is not None or key in defaults:
            least, most = CHANNEL_RANGE
            decal.values[key] = number(value, key, minimum=least, maximum=most, default=defaults.get(key))
    decal.offset = number(args.get("offset"), "offset", minimum=0, maximum=0.1, default=OFFSET)


class Placed:
    """A decal made an object, with what was measured of it as it lay."""

    def __init__(self, **measured):
        self.__dict__.update(measured)


def placed(surface, laid, name, spot, axes, size, offset, flat=False):
    """
    Measures a picture's decal as it lies on the surface, lifts it off by `offset` above any decal
    under it, and makes it an object: its area, middle lines, worst stretch, the decals under it,
    its gap to the surface and the surface's material slots its faces lie on.
    """
    target = surface.obj
    bm = laid.bm
    try:
        area = sum(f.calc_area() for f in bm.faces)
        across, up = middle_lines(bm, spot, axes)
        worst, where = worst_stretch(bm, *size)
        under = overlapping(target, laid.on_surface())
        lifted = offset + max((float(o.get(LIFT, OFFSET)) for o, _ in under), default=0.0)
        if flat:
            bmesh.ops.translate(bm, vec=laid.facing * lifted, verts=list(bm.verts))
        else:
            lift(bm, lifted)
        least, most, dip = standoff(surface, measured_points(bm))
        used = sorted({f.material_index for f in bm.faces})
        for f in bm.faces:
            f.material_index = used.index(f.material_index)
        obj = made_object(bm, name, target, lifted)
    finally:
        bm.free()
    slots = target.material_slots
    bases = [slots[i].material if i < len(slots) else None for i in used]
    return Placed(
        obj=obj, area=area, across=across, up=up, worst=worst, where=where, under=under,
        lifted=lifted, least=least, most=most, dip=dip, bases=bases,
    )


def shares_text(laid, target):
    off, back = laid.share("off"), laid.share("back")
    said = [
        f"{percent(off)} of it is off an edge, over no surface of {target.name}" if off else "none is off an edge",
        f"{percent(back)} is on the back side, on faces turned away from where it is cast" if back else "none is on the back side",
    ]
    text = "; ".join(said) + "."
    return text[0].upper() + text[1:]
