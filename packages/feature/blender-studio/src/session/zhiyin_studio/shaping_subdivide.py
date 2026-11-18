"""
Subdividing: a subdivision step, Catmull-Clark or simple, at its levels for the viewport and for
renders, with creases on edges sharper than an angle or on the edges of a pick kept by name, its
boundary and picture layout smoothed as asked, and on the limit surface when asked. The answer
gives the cage's faces and the result's, how far it shrinks the shape, how far its surface pulls
in from the cage's corners and where most, and the cage as it was read before smoothing: its faces
by their sides, its poles, the edges it creases and its edges' lengths.
"""

import math

import bmesh

from .arguments import need, number, whole
from .errors import Refused
from .picking import KEPT
from .shaping_measure import Measure
from .subdivision_cage import cage_text
from .wording import length, one_of, point_text, size_text

SCHEMES = {"catmull_clark": "CATMULL_CLARK", "simple": "SIMPLE"}
BOUNDARIES = {"smooth_all": "ALL", "keep_corners": "PRESERVE_CORNERS"}
UV_SMOOTHING = {
    "none": "NONE",
    "keep_corners": "PRESERVE_CORNERS",
    "keep_corners_and_junctions": "PRESERVE_CORNERS_AND_JUNCTIONS",
    "keep_corners_junctions_and_concave": "PRESERVE_CORNERS_JUNCTIONS_AND_CONCAVE",
    "keep_boundaries": "PRESERVE_BOUNDARIES",
    "smooth_all": "SMOOTH_ALL",
}
CREASE = "crease_edge"
# How sharp a creased edge stays, least and most; the levels, least, most and by default.
CREASE_AMOUNT = (0, 1)
LEVELS = (1, 5, 2)
# How a subdivision smooths unless the call says.
SCHEME = "catmull_clark"


def _crease_layer(mesh):
    return mesh.attributes.get(CREASE) or mesh.attributes.new(CREASE, "FLOAT", "EDGE")


def crease_edges(obj, value, angle):
    """Creases the mesh's own edges sharper than an angle; how many."""
    mesh = obj.data
    layer = _crease_layer(mesh)
    limit = math.radians(angle)
    bm = bmesh.new()
    try:
        bm.from_mesh(mesh)
        bm.edges.ensure_lookup_table()
        sharp = [e.index for e in bm.edges if e.is_manifold and e.calc_face_angle(0.0) > limit + 1e-6]
    finally:
        bm.free()
    for index in sharp:
        layer.data[index].value = value
    mesh.update()
    return len(sharp)


def crease_picked(obj, value, name):
    """Creases the edges of a pick kept on the mesh by name; how many. Refused when no edge pick has that name."""
    need(isinstance(name, str) and name.strip(), "edges names a pick of edges kept with zhiyin.pick(..., name=...).")
    mesh = obj.data
    kept = mesh.attributes.get(KEPT + name)
    if kept is None or kept.domain != "EDGE":
        picks = sorted(a.name[len(KEPT) :] for a in mesh.attributes if a.name.startswith(KEPT) and a.domain == "EDGE")
        raise Refused(
            f"“{obj.name}” keeps no pick of edges named “{name}”."
            + (f" It keeps these picks of edges: {', '.join(picks)}." if picks else " It keeps none.")
        )
    flags = [False] * len(kept.data)
    kept.data.foreach_get("value", flags)
    chosen = [i for i, flag in enumerate(flags) if flag]
    need(chosen, f"The pick “{name}” on “{obj.name}” holds no edges.")
    layer = _crease_layer(mesh)
    for index in chosen:
        layer.data[index].value = value
    mesh.update()
    return len(chosen)


def pulled_in(cage, obj):
    """How far the subdivided surface lies from the cage's corners, at most, on average and the corner most, in the world."""
    after = Measure(obj).shape
    if after.tree is None or not cage.points:
        return None
    gaps = [(after.tree.find_nearest(p)[3], p) for p in cage.points]
    gaps = [(g, p) for g, p in gaps if g is not None]
    if not gaps:
        return None
    most, where = max(gaps, key=lambda found: found[0])
    return most, sum(g for g, _ in gaps) / len(gaps), where


def creased_by(obj, op):
    """Creases the edges the step names, by angle or by a kept pick; what it creased, or None."""
    if op.get("crease") is None:
        need(op.get("edges") is None, "edges names the edges a subdivision creases; give crease, 0 to 1, with it.")
        return None
    value = number(op.get("crease"), "crease", minimum=CREASE_AMOUNT[0], maximum=CREASE_AMOUNT[1])
    if op.get("edges") is not None:
        need(op.get("angle") is None, "A subdivision creases the edges sharper than angle or the edges of a pick, not both.")
        return crease_picked(obj, value, op["edges"]), value, f"of the pick “{op['edges']}”"
    angle = number(op.get("angle"), "crease angle", minimum=0, maximum=180, default=30)
    return crease_edges(obj, value, angle), value, f"sharper than {angle:g}°"


def subdivide(obj, op):
    scheme = op.get("scheme", SCHEME)
    need(scheme in SCHEMES, f"A subdivision's scheme is {one_of(SCHEMES)}.")
    creased = creased_by(obj, op)
    before = Measure(obj)
    cage = cage_text(obj)
    modifier = obj.modifiers.new("Subdivision", "SUBSURF")
    modifier.subdivision_type = SCHEMES[scheme]
    least, most, default = LEVELS
    modifier.levels = whole(op.get("levels"), "subdivision levels", minimum=least, maximum=most, default=default)
    modifier.render_levels = whole(op.get("render_levels"), "render_levels", minimum=0, maximum=6, default=modifier.levels)
    for key, choices, field in (("boundary", BOUNDARIES, "boundary_smooth"), ("uv_smooth", UV_SMOOTHING, "uv_smooth")):
        if op.get(key) is not None:
            need(op[key] in choices, f"A subdivision's {key} is {one_of(choices)}.")
            setattr(modifier, field, choices[op[key]])
    if op.get("limit_surface") is not None:
        need(isinstance(op["limit_surface"], bool), "limit_surface is true or false.")
        modifier.use_limit_surface = op["limit_surface"]
    after = Measure(obj)
    how = "simply " if scheme == "simple" else ""
    said = f"subdivided {how}{modifier.levels} times, from {before.faces:,} faces to {after.faces:,}"
    if modifier.render_levels != modifier.levels:
        said += f", {modifier.render_levels} times in renders"
    if any(a < 0.99 * b for a, b in zip(after.size, before.size)):
        said += (
            f", shrinking it from {size_text(before.size)} to {size_text(after.size)}, as subdividing rounds a shape"
            " inside its corners: edges added near them, or a bevel first, keep its size"
        )
    if creased is not None:
        count, value, which = creased
        said += f", {count:,} {'edge' if count == 1 else 'edges'} {which} creased {value:g}"
    pulled = pulled_in(before.shape, obj)
    if pulled is not None and pulled[0] > 1e-6:
        said += f"; its surface lies up to {length(pulled[0])} in from its cage's corners (mean {length(pulled[1])}), most at {point_text(pulled[2])}"
    elif pulled is not None:
        said += "; its surface passes through its cage's corners"
    if op.get("boundary") is not None:
        said += f", its open edges' corners {'kept' if op['boundary'] == 'keep_corners' else 'smoothed'}"
    if op.get("uv_smooth") is not None:
        said += f", its picture layout smoothed: {op['uv_smooth'].replace('_', ' ')}"
    if modifier.use_limit_surface is False:
        said += ", short of the limit surface"
    return f"{said}; {cage}"
