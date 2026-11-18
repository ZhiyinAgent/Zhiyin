"""
The cutters a boolean draws beyond boxes, cylinders and spheres: a box with rounded upright
corners, a slot with round ends, a prism on an outline and raised lettering. Each is a closed
solid centred on its origin, as the boxes are, standing along its own z.
"""

import math

import bmesh
import bpy

from .arguments import need, number, points, whole
from .making import centred, from_curve, system_cjk_font, with_uvs


def prism(outline, depth):
    """A closed solid on a flat outline of [x, y] points, `depth` tall, centred on the origin."""
    flat = [(p[0], p[1]) for p in outline]
    twice_area = sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(flat, flat[1:] + flat[:1]))
    need(abs(twice_area) > 1e-14, "The cutter's outline encloses no area.")
    bm = with_uvs(bmesh.new())
    base = bm.faces.new([bm.verts.new((x, y, -depth / 2)) for x, y in flat])
    raised = bmesh.ops.extrude_face_region(bm, geom=[base])["geom"]
    for v in raised:
        if isinstance(v, bmesh.types.BMVert):
            v.co.z += depth
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    return bm


def arc(centre, radius, start, steps):
    """Points round a quarter turn from `start` degrees, `steps` pieces."""
    return [
        (centre[0] + radius * math.cos(math.radians(start + 90 * i / steps)), centre[1] + radius * math.sin(math.radians(start + 90 * i / steps)))
        for i in range(steps + 1)
    ]


def corner_steps(spec):
    return whole(spec.get("segments"), "segments", minimum=4, maximum=512, default=32) // 4


def rounded_box(spec):
    """A box `size` big whose four upright edges are rounded by `radius`."""
    x, y, z = spec["size"]
    radius = number(spec.get("radius"), "cutter radius", minimum=1e-7)
    need(radius <= min(x, y) / 2, f"A rounded box's radius is at most half its narrower side, {min(x, y) / 2:g} m.")
    steps = corner_steps(spec)
    hx, hy = x / 2 - radius, y / 2 - radius
    outline = []
    for centre, start in (((hx, -hy), 270), ((hx, hy), 0), ((-hx, hy), 90), ((-hx, -hy), 180)):
        outline += arc(centre, radius, start, steps)
    return prism(dedupe(outline), z)


def slot(spec):
    """A slot `size` big: as long as its x, as wide as its y with round ends, as deep as its z."""
    x, y, z = spec["size"]
    need(x >= y, "A slot is longer than it is wide: give its length as size's x and its width as its y.")
    radius = y / 2
    steps = corner_steps(spec)
    reach = x / 2 - radius
    outline = arc((reach, 0), radius, 270, steps) + arc((reach, 0), radius, 0, steps)
    outline += arc((-reach, 0), radius, 90, steps) + arc((-reach, 0), radius, 180, steps)
    return prism(dedupe(outline), z)


def dedupe(outline):
    """An outline with points that lie on the one before taken out, as where two arcs meet."""
    kept = []
    for p in outline:
        if not kept or math.dist(p, kept[-1]) > 1e-9:
            kept.append(p)
    if len(kept) > 1 and math.dist(kept[0], kept[-1]) <= 1e-9:
        kept.pop()
    return kept


def outline_prism(spec):
    """A prism on `points`, [x, y] about the cutter's middle, `depth` deep."""
    outline = points(spec.get("points"), "cutter points", 2, 3)
    depth = number(spec.get("depth"), "cutter depth", minimum=1e-7)
    return prism(dedupe([tuple(p) for p in outline]), depth)


def text_prism(spec):
    """Lettering `height` high and `depth` deep, centred on the cutter's middle, reading along its x."""
    body = spec.get("text")
    need(isinstance(body, str) and body.strip(), "A text cutter needs its text.")
    curve = bpy.data.curves.new("Text cutter", "FONT")
    curve.body = body
    curve.size = number(spec.get("height"), "cutter height", minimum=1e-7)
    curve.extrude = number(spec.get("depth"), "cutter depth", minimum=1e-7) / 2
    curve.align_x = "CENTER"
    curve.align_y = "CENTER"
    font = system_cjk_font() if any(ord(c) >= 0x2E80 for c in body) else None
    if font:
        curve.font = bpy.data.fonts.load(font, check_existing=True)
    return with_uvs(centred(from_curve(curve, "Text cutter")))
