"""
A wrap decal: a label sized as it is printed, wrapped round an object's turning axis, as on a
bottle, a jar, a can or a tube. Its width runs round the axis at the radius the surface has at its
middle, so it covers the arc its width makes there, and its height runs along the axis; each point
lies on the surface's outside where a ray from the axis meets it. On a straight part it lies at its
own proportions; where the profile tapers or curves under it, its width stretches by the radius
there over the radius at its middle, which a real label cannot do.
"""

import math

import bmesh
import mathutils

from .arguments import colour, need, number, vector
from .decal_cards import EDGE_ON, Laid, stretch_text
from .decal_materials import LAYOUT, MADE_FOR, label_material, label_words
from .decal_objects import CHANNEL_RANGE, OFFSET, overlap_text, placed, shares_text
from .decal_pictures import picture, text_picture
from .decal_surface import fighting_text, gap_words, range_text, way_text
from .errors import Refused
from .wording import area_text, length, point_text, size_text

AXES = {"x": (1, 0, 0), "y": (0, 1, 0), "z": (0, 0, 1)}
# The most degrees one column of the label's grid turns, and its most rows.
STEP_DEGREES = 3
MOST_ROWS = 64
# A radius that changes less than this share across the label is the label's own.
STRAIGHT = 0.005
LABELS = ("paper", "clear")
# A label's roughness by default: uncoated paper, and a glossy film.
ROUGHNESS = {"paper": 0.6, "clear": 0.15}


class Wrapped:
    """A wrap decal as it lies: its laid shape, where its middle landed and how, and the radii under it."""

    def __init__(self, laid, middle, facing, radius, radii, arc):
        self.laid, self.middle, self.facing = laid, middle, facing
        self.radius, self.radii, self.arc = radius, radii, arc


def axis_of(obj, name):
    """The object's own axis by name, through the middle of its box, in the world."""
    need(name in AXES, "axis is x, y or z: the object's own axis it turns round.")
    corners = [mathutils.Vector(c) for c in obj.bound_box]
    middle = sum(corners, mathutils.Vector()) / 8
    point = obj.matrix_world @ middle
    way = (obj.matrix_world.to_3x3() @ mathutils.Vector(AXES[name])).normalized()
    return point, way


def outside_at(surface, point, way, height, turn, start, side):
    """Where a ray from the axis outward at `turn` radians and `height` along it meets the surface's outside."""
    out = start * math.cos(turn) + side * math.sin(turn)
    base = point + way * height
    return surface.first_hit(base + out * surface.reach, -out, surface.reach), base, out


def wrapped(surface, at, width, height, axis):
    """The label's grid laid round the axis, its middle at the point of the surface outside `at`."""
    obj = surface.obj
    point, way = axis_of(obj, axis)
    along = (at - point).dot(way)
    start = at - point - way * along
    need(
        start.length > 1e-6,
        f"at lies on {obj.name}'s {axis} axis, so it gives no way round it: give a point on the side the label goes.",
    )
    start.normalize()
    side = way.cross(start)
    found, base, _ = outside_at(surface, point, way, along, 0.0, start, side)
    if found is None:
        raise Refused(
            f"Out from {obj.name}'s {axis} axis toward {point_text(at)}, no surface of {obj.name} is met: "
            "give at a point beside its side."
        )
    middle, normal, _ = found
    radius = (middle - base).length
    need(radius > 1e-6, f"{obj.name}'s surface meets its {axis} axis there, so nothing lies round it to wrap.")
    arc = math.degrees(width / radius)
    if arc > 360:
        raise Refused(
            f"A label {length(width)} wide covers {arc:.4g}° round a radius of {length(radius)}, more than once round: "
            f"give a size of at most {length(2 * math.pi * radius)}."
        )
    columns = max(8, math.ceil(arc / STEP_DEGREES))
    rows = min(MOST_ROWS, max(4, math.ceil(height / (width / columns))))
    bm = bmesh.new()
    layout = bm.loops.layers.uv.new(LAYOUT)
    grid, samples, radii = [], [], []
    for j in range(rows + 1):
        t = height * (j / rows - 0.5)
        row = []
        for i in range(columns + 1):
            s = width * (i / columns - 0.5)
            hit, base, out = outside_at(surface, point, way, along + t, s / radius, start, side)
            spot = hit[0] if hit is not None else base + out * radius
            row.append(bm.verts.new(spot))
            if i == columns // 2 and hit is not None:
                radii.append((hit[0] - base).length)
        grid.append(row)
    for j in range(rows):
        for i in range(columns):
            face = bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
            for loop, (a, b) in zip(face.loops, ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))):
                loop[layout].uv = (a / columns, b / rows)
    bm.normal_update()
    for face in bm.faces:
        centre = face.calc_center_median()
        base = point + way * (centre - point).dot(way)
        out = centre - base
        hit = surface.first_hit(base + out.normalized() * surface.reach, -out.normalized(), surface.reach) if out.length else None
        if hit is None:
            samples.append((None, "off"))
        elif hit[1].dot(out.normalized()) <= EDGE_ON:
            samples.append((hit[0], "back"))
        else:
            samples.append((hit[0], "on"))
    # Its width runs to the right and its height up, so each face looks out from the axis.
    return Wrapped(Laid(bm, samples, normal), middle, normal, radius, radii, arc)


def arc_text(wrap, axis):
    """The arc the label covers, and how its width stretches where the radius under it changes."""
    said = f"Round its {axis} axis it covers an arc of {wrap.arc:.3g}°, {length(wrap.radius)} from the axis at its middle"
    if not wrap.radii:
        return said + "."
    least, most = min(wrap.radii), max(wrap.radii)
    if (most - least) / wrap.radius < STRAIGHT:
        return said + "; the surface keeps that radius across its height, so its width lies as printed."
    return (
        said + f"; across its height the surface lies {range_text(least, most)} from the axis, so its width stretches "
        f"{least / wrap.radius:.3g}× to {most / wrap.radius:.3g}× there. A label does not stretch: on that profile a real one "
        "would crease or stand off at its edges, where a shrink sleeve or print on the surface follows it."
    )


def landed_text(name, target, shown, size, axis, wrap):
    return (
        f"Decal “{name}” on {target.name}: {shown.said}, {size}, wrapped round its {axis} axis, its middle at "
        f"{point_text(wrap.middle)}, which faces {way_text(wrap.facing)} there."
    )


def wrap_on(surface, args, name):
    """A label wrapped round the object's axis, of paper or clear film, its material its own."""
    target = surface.obj
    need((args.get("picture") is None) != (args.get("text") is None), "Give exactly one of picture and text.")
    if args.get("picture") is not None:
        shown = picture(args["picture"])
    else:
        shown = text_picture(args.get("text"), args.get("font"), f"{name} text")
    width = number(args.get("size"), "size", minimum=1e-5)
    height = width / shown.aspect
    axis = args.get("axis", "z")
    label = args.get("label", "paper")
    need(label in LABELS, "label is paper or clear.")
    white_ink = args.get("white_ink")
    if label == "paper":
        need(white_ink is None, "white_ink is for a clear label: paper is white already.")
    else:
        need(white_ink is None or isinstance(white_ink, bool), "white_ink is true or false.")
        white_ink = True if white_ink is None else white_ink
    least, most = CHANNEL_RANGE
    roughness = number(args.get("roughness"), "roughness", minimum=least, maximum=most, default=ROUGHNESS[label])
    offset = number(args.get("offset"), "offset", minimum=0, maximum=0.1, default=OFFSET)
    ink = colour(args["color"], "color") if args.get("color") is not None else None
    if ink is None and args.get("text") is not None:
        ink = colour("#000000", "color")
    wrap = wrapped(surface, vector(args.get("at"), "at"), width, height, axis)
    way = axis_of(target, axis)[1]
    axes = (way.cross(wrap.facing).normalized(), way, wrap.facing)
    made = placed(surface, wrap.laid, name, wrap.middle, axes, (width, height), offset)
    material = label_material(f"{name} {label} label", shown, label, white_ink, roughness, ink)
    material[MADE_FOR] = name
    made.obj.data.materials.clear()
    made.obj.data.materials.append(material)
    for poly in made.obj.data.polygons:
        poly.material_index = 0
    return [
        landed_text(name, target, shown, size_text((width, height)), axis, wrap),
        arc_text(wrap, axis),
        f"On the surface it spans {size_text((made.across, made.up))} along its middle lines and covers "
        f"{area_text(made.area)}; {stretch_text(made.worst, made.where)}.",
        shares_text(wrap.laid, target),
        label_words(material, label, white_ink, roughness),
        overlap_text(made.under),
        f"It stands {gap_words(made.least, made.most)} off the surface and moves with {target.name}. "
        + fighting_text(made.least if made.least > 0 else made.lifted, wrap.middle),
    ]
