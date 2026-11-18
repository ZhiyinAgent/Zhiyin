"""
Mirroring: a mirror step across the object's own axes or another object's, clipped and joined at
the mirror, cutting away what reaches across unless asked not to, with its picture layout mirrored
when asked. The answer says how far apart the halves stand, what was cut away, and whether the seam
on each mirror plane closes, opens or overlaps, measured on the shape before it is mirrored.
"""

import bpy
import mathutils

from .arguments import need, number
from .finding import find_object
from .scales import scene_scale
from .shaping_measure import Measure
from .soundness import mesh_of
from .wording import length

AXES = ("x", "y", "z")
# Blender joins points this near the mirror, in the object's own lengths, unless told otherwise.
BLENDER_MERGE = 0.001
# An open edge this near the mirror, as a share of the shape's reach along it, was meant to meet it.
MEANT = 0.05


def mirror_middle(obj, across):
    """The middle of an object's shape, where a mirror sees it: in its own space, or the space of the object it is mirrored around."""
    bpy.context.view_layer.update()
    to_mirror = across.matrix_world.inverted() @ obj.matrix_world if across else mathutils.Matrix.Identity(4)
    corners = [to_mirror @ mathutils.Vector(c) for c in obj.bound_box]
    return [(min(c[i] for c in corners) + max(c[i] for c in corners)) / 2 for i in range(3)]


class Seam:
    """The shape before it is mirrored, seen from one mirror plane, in the world's lengths."""

    def __init__(self, obj, across, index):
        bpy.context.view_layer.update()
        to_mirror = (across or obj).matrix_world.inverted()
        reach = scene_scale(across or obj)[index]
        bm = mesh_of(obj)
        try:
            self.places = [(to_mirror @ v.co)[index] * reach for v in bm.verts]
            self.open = [(to_mirror @ v.co)[index] * reach for v in bm.verts if v.is_boundary]
        finally:
            bm.free()
        self.low, self.high = min(self.places, default=0.0), max(self.places, default=0.0)

    def crosses(self):
        return self.low < -1e-6 and self.high > 1e-6

    def words(self, axis, merge, joining, bisect):
        """Whether the seam on this mirror plane closes, opens or overlaps; nothing when the shape is clear of it."""
        if self.crosses() and not bisect:
            depth = min(-self.low, self.high)
            return f"; across {axis} its halves overlap by up to {length(depth)}, as bisect is off and it reaches across the mirror"
        if self.crosses():
            # Cut on the mirror, so the cut's edges lie on it and join their image.
            return f"; what reached across {axis} was cut away first, its seam on the mirror closed"
        meant = MEANT * max(self.high - self.low, 1e-9)
        near = [abs(p) for p in self.open if abs(p) <= max(meant, merge)]
        if not near:
            return None
        if not joining:
            return f"; the seam on {axis} is open: merge is off, so its {len(near):,} open points by the mirror stay unjoined"
        apart = [d for d in near if d > merge * (1 + 1e-6)]
        if apart:
            return (
                f"; the seam on {axis} opens: {len(apart):,} open points stand up to {length(max(apart))} off the mirror,"
                f" beyond the {length(merge)} merge, leaving a gap up to {length(2 * max(apart))}"
            )
        return f"; the seam on {axis} is closed, its {len(near):,} open points joined on the mirror"


def mirror(obj, op):
    axes = op.get("axes", ["x"])
    need(isinstance(axes, list) and axes and all(a in AXES for a in axes), "mirror axes are x, y or z.")
    across = find_object(op["across"]) if op.get("across") else None
    middle = mirror_middle(obj, across)
    used = [a in axes for a in AXES]
    seams = {i: Seam(obj, across, i) for i, u in enumerate(used) if u}
    before = Measure(obj)
    modifier = obj.modifiers.new("Mirror", "MIRROR")
    modifier.use_axis = used
    modifier.mirror_object = across
    for key in ("clip", "bisect", "flip", "mirror_u", "mirror_v"):
        need(op.get(key) is None or isinstance(op.get(key), bool), f"{key} is true or false.")
    modifier.use_clip = op.get("clip", True)
    bisect = op.get("bisect", True)
    # A shape reaching across the mirror would overlap its own image,
    # counted twice; the part across is cut away, keeping the side the
    # shape mostly lies on, or the side asked.
    modifier.use_bisect_axis = [u and bisect for u in used]
    flip = op.get("flip")
    modifier.use_bisect_flip_axis = [u and (flip if flip is not None else middle[i] < 0) for i, u in enumerate(used)]
    reach = scene_scale(across or obj)
    if op.get("merge") is not None:
        merge = number(op.get("merge"), "mirror merge", minimum=0)
        modifier.use_mirror_merge = merge > 0
        modifier.merge_threshold = max(merge / max(reach), 1e-9)
    joining = modifier.use_mirror_merge
    modifier.use_mirror_u = bool(op.get("mirror_u"))
    modifier.use_mirror_v = bool(op.get("mirror_v"))
    after = Measure(obj)
    said = f"mirrored across {', '.join(axes)}"
    if flip is not None and bisect:
        said += f", keeping its {'-' if flip else '+'}{'/'.join(axes)} side"
    if after.alike(before):
        return said + f", which changes nothing: it was already the same on both sides of its mirror, at its {'own origin' if across is None else across.name}'s"
    for index, axis in enumerate(AXES):
        if not used[index]:
            continue
        seam = seams[index]
        merge = modifier.merge_threshold * reach[index]
        told = seam.words(axis, merge, joining, bisect)
        if told is None and (seam.low > 1e-6 or seam.high < -1e-6):
            near = min(abs(seam.low), abs(seam.high))
            told = f"; its halves across {axis} stand {length(2 * near)} apart"
        if told:
            said += told
    if not modifier.use_clip:
        said += ", unclipped, so points on the mirror may be moved off it"
    if modifier.use_mirror_u or modifier.use_mirror_v:
        flipped = " and ".join(k for k, u in (("u", modifier.use_mirror_u), ("v", modifier.use_mirror_v)) if u)
        said += f", the copy's picture layout mirrored in {flipped}"
    return said
