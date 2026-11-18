"""
Panel gaps: a groove cut round picked faces, or the faces split off as a panel of their own with
the gap left between it and its body, both thickened inward. Each says how wide the gap came out
along its seam, measured from the panel's edge to the body's, where it is widest when it varies,
and how deep or thick the panel is.
"""

import bmesh
import bpy
import mathutils

from .arguments import need, number
from .errors import Refused
from .finding import unused_name
from .mesh_math import to_segment
from .picking import Picked, mesh_object, spend, unspent
from .reports import report
from .wording import length, point_text

LAYER = "zhiyin_panel"
EVEN = 1e-5


def linear_scale(obj):
    """How much the object's own lengths grow in the world."""
    scale = obj.matrix_world.to_scale()
    return abs(scale.x * scale.y * scale.z) ** (1 / 3) or 1.0


def open_edges(bm):
    return sum(1 for e in bm.edges if e.is_boundary)


def seam_of(obj, bm, chosen):
    """The edges between the picked faces and the rest, refused when there are none."""
    need(len(chosen) < len(bm.faces), f"Every face of {obj.name} is picked, so no edge runs between the panel and the rest for a gap to follow.")
    seam = {
        e
        for f in chosen
        for e in f.edges
        if len(e.link_faces) == 2 and any(o not in chosen for o in e.link_faces)
    }
    need(seam, f"Every face of {obj.name} is picked, so no edge runs between the panel and the rest for a gap to follow.")
    return seam


def inset_gap(obj, bm, chosen, width, scale):
    """Insets the picked faces by the gap along their seam; the ring it makes, and whether a face turned over."""
    facing = {f: f.normal.copy() for f in chosen}
    ring = bmesh.ops.inset_region(
        bm, faces=list(chosen), thickness=width / scale, depth=0, use_even_offset=True, use_boundary=False
    )["faces"]
    for f in chosen:
        f.normal_update()
    flipped = any(f.calc_area() < 1e-12 or f.normal.dot(facing[f]) < 0.5 for f in chosen)
    return ring, flipped


def refuse_folded(obj, chosen, width, widths, flipped):
    """A gap that turned faces over, or crossed the panel and came out well short of the width asked."""
    if flipped or min(w for w, _ in widths) < width * 0.75:
        raise Refused(
            f"A gap of {length(width)} folds {obj.name}'s panel of {len(chosen)} faces over itself;"
            " a gap must be under half the panel's narrowest width."
        )


def gap_across(obj, ring, chosen):
    """How wide the ring is in the world, from the panel's edge to the body's, and where it is widest."""
    matrix = obj.matrix_world
    ring_set = set(ring)
    outer = {e for f in ring for e in f.edges if any(o not in ring_set and o not in chosen for o in e.link_faces)}
    inner = {v for f in ring for e in f.edges if any(o in chosen for o in e.link_faces) for v in e.verts}
    segments = [(matrix @ e.verts[0].co, matrix @ e.verts[1].co) for e in outer]
    seam = sum((a - b).length for a, b in segments)
    widths = []
    for v in inner:
        at = matrix @ v.co
        nearest = min(to_segment(at, a, b) for a, b in segments)
        widths.append((nearest, at))
    return widths, seam


def gap_words(widths, seam, what):
    """The gap as an answer says it: one width all along, or its range and where it is widest."""
    least = min(w for w, _ in widths)
    most, at = max(widths, key=lambda item: item[0])
    mean = sum(w for w, _ in widths) / len(widths)
    if most - least < EVEN:
        return f"{length(mean)} {what} all along its {length(seam)} seam"
    return (
        f"{length(least)} to {length(most)} {what} (mean {length(mean)}) along its {length(seam)} seam,"
        f" widest at {point_text(at)}"
    )


def floor_groove(bm, ring, depth):
    """Lowers the ring into a groove `depth` deep, with walls on both sides."""
    made = bmesh.ops.extrude_face_region(bm, geom=list(ring))["geom"]
    bmesh.ops.delete(bm, geom=list(ring), context="FACES_ONLY")
    floor = [g for g in made if isinstance(g, bmesh.types.BMFace)]
    verts = {v for f in floor for v in f.verts}
    for f in floor:
        f.normal_update()
    for v in verts:
        down = sum((f.normal for f in v.link_faces if f in floor), mathutils.Vector())
        if down.length:
            v.co -= down.normalized() * depth


def thickened(obj, depth, scale):
    """Thickens the object inward by `depth`, unless it is already thickened; whether it was."""
    if any(m.type == "SOLIDIFY" for m in obj.modifiers):
        return False
    mod = obj.modifiers.new("Thickness", "SOLIDIFY")
    mod.thickness = depth / scale
    mod.offset = -1
    mod.use_even_offset = True
    return True


def panel(faces, *, gap=0.002, depth=0.001, split=False, name=None):
    """
    A panel gap round a pick of faces, `gap` wide and `depth` deep, cut inside the pick's edge. By
    default a groove in the one mesh; with split=True the faces become an object of their own
    (`name`), the gap left between it and its body, both thickened inward by `depth`. Says the gap
    as measured along the seam, where it is widest when it varies, and the faces and open edges.
    """
    need(isinstance(faces, Picked) and faces.kind == "faces", "panel takes a pick of faces, as zhiyin.pick(obj) gives.")
    unspent(faces)
    obj = mesh_object(faces.object, "panel")
    width = number(gap, "gap", minimum=0, default=0.002)
    deep = number(depth, "depth", minimum=0, default=0.001)
    need(width > 0, "gap must be more than 0.")
    need(deep > 0, "depth must be more than 0.")
    called = unused_name(name or f"{obj.name} panel") if split else None
    scale = linear_scale(obj)
    bm = bmesh.new()
    try:
        bm.from_mesh(obj.data)
        bm.faces.ensure_lookup_table()
        chosen = {bm.faces[i] for i in faces.indices}
        before, open_before = len(bm.faces), open_edges(bm)
        seam_of(obj, bm, chosen)
        ring, flipped = inset_gap(obj, bm, chosen, width, scale)
        widths, seam = gap_across(obj, ring, chosen)
        refuse_folded(obj, chosen, width, widths, flipped)
        if not split:
            floor_groove(bm, ring, deep / scale)
            after, open_after = len(bm.faces), open_edges(bm)
            bm.to_mesh(obj.data)
            obj.data.update()
            report(
                f"Cut a panel gap round {len(chosen)} faces of {obj.name}: {gap_words(widths, seam, 'wide')},"
                f" {length(deep)} deep; {before} faces now {after}, {open_words(open_before, open_after)}."
            )
            spend(faces, "panel")
            return obj
        part = split_off(obj, bm, chosen, ring, called)
    finally:
        bm.free()
    body_thickened = thickened(obj, deep, scale)
    thickened(part, deep, scale)
    closed = (
        f" {obj.name} was closed; it is now a shell {length(deep)} thick round the opening." if not open_before else ""
    )
    report(
        f"Split {called} from {obj.name}: {len(faces)} faces, {gap_words(widths, seam, 'from ' + obj.name)};"
        + (f" both {length(deep)} thick, thickened inward." if body_thickened else f" {called} {length(deep)} thick, thickened inward; {obj.name} keeps its own thickness.")
        + closed
    )
    spend(faces, "panel")
    return part


def open_words(before, after):
    if not after:
        return "no open edges"
    if after == before:
        return f"{after} open edges, as before"
    return f"{after} open edges, {before} before"


def split_off(obj, bm, chosen, ring, called):
    """Removes the ring, moves the picked faces to a new object named `called`; the new object."""
    # A new layer moves every face's data, so the faces are marked by index.
    bm.faces.index_update()
    marked, cut = [f.index for f in chosen], [f.index for f in ring]
    layer = bm.faces.layers.int.new(LAYER)
    bm.faces.ensure_lookup_table()
    for index in marked:
        bm.faces[index][layer] = 1
    bmesh.ops.delete(bm, geom=[bm.faces[i] for i in cut], context="FACES")
    piece = bm.copy()
    layer = bm.faces.layers.int[LAYER]
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f[layer]], context="FACES")
    bm.faces.layers.int.remove(layer)
    bm.to_mesh(obj.data)
    obj.data.update()
    try:
        kept = piece.faces.layers.int[LAYER]
        bmesh.ops.delete(piece, geom=[f for f in piece.faces if not f[kept]], context="FACES")
        piece.faces.layers.int.remove(kept)
        mesh = bpy.data.meshes.new(called)
        piece.to_mesh(mesh)
    finally:
        piece.free()
    for material in obj.data.materials:
        mesh.materials.append(material)
    part = bpy.data.objects.new(called, mesh)
    part.matrix_world = obj.matrix_world.copy()
    for into in obj.users_collection:
        into.objects.link(part)
    return part


FUNCTIONS = (panel,)
