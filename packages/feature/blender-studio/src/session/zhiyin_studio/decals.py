"""
blender_add_decal: a picture or text laid on an object's surface, projected onto it or on a card of
its own, relief drawn by shading alone, a label wrapped round it, or a strip run along a line on
it. A decal is an object of its own that moves with the object, with materials of its own; one
named as a decal already there replaces it. The answer measures where it landed and how it lies:
its size on the surface and worst stretch, how much is off an edge or on the back side, its overlap
with other decals, its gap to the surface and whether a renderer would mix the two at the camera's
distance; a label's arc and stretch round its axis; a strip's length, pattern, corners and
standoff, and a groove's continuity.
"""

import bpy

from .arguments import colour, need, number, vector
from .decal_cards import card, carried, projected, stretch_text
from .decal_materials import MADE_FOR, changes_text, decal_material, strip_material
from .decal_objects import (
    DECAL,
    OFFSET,
    Decal,
    made_object,
    measured_points,
    overlap_text,
    overlapping,
    placed,
    read_values,
    shares_text,
)
from .decal_pictures import picture, text_picture
from .decal_relief import relief_on, relief_strip_materials, relief_text, strip_relief, view_text
from .decal_strips import BANDS, FILLED, PITCHES, PLURALS, continuity_text, corner_gaps, strip_mesh, the_line
from .decal_surface import (
    Surface,
    fighting_text,
    gap_words,
    landing,
    lift,
    picture_axes,
    range_text,
    standoff,
    way_text,
)
from .decal_wrap import wrap_on
from .errors import Refused
from .finding import find_object, scene
from .glass import lets_light_through_sheets
from .wood import lays_grain
from .wording import area_text, length, listed, point_text, size_text

KINDS = ("projected", "mesh", "normal", "wrap", "strip")
CHANNELS = ("color", "roughness", "metal", "coat", "normal")
PATTERNS = ("stitch", "dash", "chevron", "picture", "solid", "groove", "shape")
STRIP_COLOUR = "#202020"
# What each kind of decal takes besides object, name, kind and offset.
TAKES = {
    "projected": ("picture", "text", "font", "color", "at", "direction", "size", "rotation", "affects", "roughness", "metal", "coat", "relief"),
    "normal": ("shape", "picture", "count", "at", "direction", "size", "rotation", "relief"),
    "wrap": ("picture", "text", "font", "color", "at", "size", "axis", "label", "white_ink", "roughness"),
    "strip": ("along", "width", "pattern", "pitch", "raised", "picture", "color", "roughness", "metal", "coat", "relief", "shape", "count"),
}
TAKES["mesh"] = TAKES["projected"] + ("conform",)
INPUTS = ("object", "name", "kind", "offset") + tuple(dict.fromkeys(k for kept in TAKES.values() for k in kept))


def decal_name(given, target):
    """The decal's name, and the earlier decal of that name it replaces."""
    if given is None:
        name, number_ = f"{target.name} decal", 1
        while bpy.data.objects.get(name) is not None:
            number_ += 1
            name = f"{target.name} decal {number_}"
        return name, None
    need(isinstance(given, str) and given.strip(), "name is the decal's name.")
    name = given.strip()
    found = bpy.data.objects.get(name)
    if found is None:
        return name, None
    if found.get(DECAL) is None:
        raise Refused(f"“{name}” is an object of the scene, not a decal: give the decal another name.")
    return name, found


def removed(old):
    """Takes an earlier decal away, with the materials and drawn pictures made for it alone."""
    mesh = old.data
    materials = [m for m in mesh.materials if m is not None and m.get(MADE_FOR) == old.name]
    bpy.data.objects.remove(old)
    if mesh.users == 0:
        bpy.data.meshes.remove(mesh)
    for material in materials:
        images = [n.image for n in material.node_tree.nodes if n.type == "TEX_IMAGE" and n.image is not None]
        if material.users == 0:
            bpy.data.materials.remove(material)
        for image in images:
            if image.users == 0 and image.packed_file is not None and image.filepath == "":
                bpy.data.images.remove(image)


@lets_light_through_sheets
@lays_grain
def add_decal(args, scene_file):
    target = find_object(args.get("object"), {"MESH", "CURVE", "FONT", "SURFACE", "META"})
    kind = args.get("kind", "projected")
    need(kind in KINDS, f"kind is {listed(KINDS).replace(' and ', ' or ')}.")
    wrong = [key for key in INPUTS if key not in TAKES[kind] + ("object", "name", "kind", "offset") and args.get(key) is not None]
    if wrong:
        raise Refused(f"{listed(wrong)} {'is' if len(wrong) == 1 else 'are'} not for a {kind} decal.")
    name, earlier = decal_name(args.get("name"), target)
    if earlier is not None:
        removed(earlier)
    surface = Surface(target)
    try:
        if kind == "strip":
            lines = strip(surface, args, name)
        elif kind == "normal":
            lines = relief_on(surface, args, name)
        elif kind == "wrap":
            lines = wrap_on(surface, args, name)
        else:
            lines = laid_on(surface, args, name, kind)
    finally:
        surface.free()
    if earlier is not None:
        lines[0] += f" It replaces the earlier decal “{name}”."
    return "\n".join(lines)


def laid_on(surface, args, name, kind):
    target = surface.obj
    decal = Decal(name, target)
    need((args.get("picture") is None) != (args.get("text") is None), "Give exactly one of picture and text.")
    if args.get("picture") is not None:
        shown = picture(args["picture"])
    else:
        shown = text_picture(args.get("text"), args.get("font"), f"{name} text")
    width = number(args.get("size"), "size", minimum=1e-5)
    height = width / shown.aspect
    at = vector(args.get("at"), "at")
    direction = vector(args["direction"], "direction") if args.get("direction") is not None else None
    need(direction is None or direction.length > 0, "direction must not be (0, 0, 0).")
    rotation = number(args.get("rotation"), "rotation", default=0)
    read_values(args, decal, {})
    if args.get("color") is not None:
        decal.colour = colour(args["color"], "color")
    elif args.get("text") is not None:
        decal.colour = colour("#000000", "color")
    if args.get("relief") is not None:
        decal.relief = number(args["relief"], "relief", minimum=-0.1, maximum=0.1)
    affects = args.get("affects")
    if affects is None:
        affects = ["color"] + [c for c in ("roughness", "metal", "coat") if c in decal.values]
        affects += ["normal"] if args.get("relief") is not None else []
    need(
        isinstance(affects, list) and affects and all(a in CHANNELS for a in affects),
        "affects lists what the decal changes: color, roughness, metal, coat or normal.",
    )
    for channel in affects:
        if channel in ("roughness", "metal", "coat"):
            need(channel in decal.values, f"affects names {channel}: give {channel}, the value it is changed to.")
    need("normal" not in affects or args.get("relief") is not None, "affects names normal: give relief, how far its shape stands up.")
    decal.affects = [c for c in CHANNELS if c in affects]
    conform = args.get("conform", True)
    need(isinstance(conform, bool), "conform is true or false.")
    hit, normal, toward = landing(surface, at, direction)
    if kind == "projected":
        axes = picture_axes(toward, rotation)
        laid = projected(surface, hit, axes, width, height)
        said = f"projected along {way_text(-toward)} onto the surface at {point_text(hit)}, which faces {way_text(normal)} there"
    else:
        axes = picture_axes(normal, rotation)
        laid = card(surface, hit, axes, width, height, conform)
        said = f"a card of its own at {point_text(hit)}, facing {way_text(normal)}, {'bent to the surface' if conform else 'flat'}"
    made = placed(surface, laid, name, hit, axes, (width, height), decal.offset, flat=kind == "mesh" and not conform)
    obj = made.obj
    for base in made.bases:
        own = f"{name} on {base.name}" if base is not None else f"{name} material"
        obj.data.materials.append(decal_material(base, own, shown, decal))
    lines = [
        f"Decal “{name}” on {target.name}: {shown.said}, {size_text((width, height))}, {said}.",
        f"On the surface it spans {size_text((made.across, made.up))} along its middle lines and covers {area_text(made.area)}; "
        f"{stretch_text(made.worst, made.where)}.",
        shares_text(laid, target),
    ]
    if kind == "mesh":
        gap = f"Gap to the surface: {range_text(made.least, made.most)}"
        lines.append(gap + (f": it dips {length(-made.least)} into the surface near {point_text(made.dip)}." if made.least < 0 else "."))
    lines.append(materials_text(decal, target, made.bases, obj))
    if not shown.clear and "normal" not in decal.affects:
        lines.append(f"{shown.said.split(' (')[0]} has no transparent parts, so its whole rectangle shows.")
    lines.append(overlap_text(made.under))
    stands = gap_words(made.least, made.most) if kind == "projected" else length(made.lifted)
    lines.append(
        f"It stands {stands} off the surface and moves with {target.name}. "
        + fighting_text(made.least if made.least > 0 else made.lifted, hit)
    )
    return lines


def materials_text(decal, target, bases, obj):
    changes = changes_text(decal)
    owns = [m.name for m in obj.data.materials]
    named = [b for b in bases if b is not None]
    if not named:
        return (
            f"It changes {changes} of {target.name}'s surface in a material of its own, “{owns[0]}”; "
            f"{target.name} has no material, so its copy starts from Blender's plain grey."
        )
    if len(bases) == 1:
        base = bases[0].name
        return (
            f"It changes {changes} of {target.name}'s material “{base}” in a copy of its own, “{owns[0]}”, "
            f"which keeps {base}'s other values."
        )
    return (
        f"It changes {changes} of {target.name}'s materials {listed(f'“{b.name}”' for b in named)} in copies of their own, "
        f"{listed(f'“{o}”' for o in owns)}, which keep their other values."
    )


def strip(surface, args, name):
    target = surface.obj
    decal = Decal(name, target)
    width = number(args.get("width"), "width", minimum=1e-5)
    pattern = args.get("pattern", "dash")
    need(pattern in PATTERNS, f"pattern is {listed(PATTERNS).replace(' and ', ' or ')}.")
    relief = None
    if pattern in ("groove", "shape"):
        relief, pitch, asked_words = strip_relief(args, name, width)
        decal.offset = number(args.get("offset"), "offset", minimum=0, maximum=0.1, default=OFFSET)
        shown = relief
    else:
        for key in ("relief", "shape", "count"):
            need(args.get(key) is None, f"{key} is for a groove or a shape strip, not a {pattern} one.")
        shown, pitch, asked_words = printed_pattern(args, pattern, width)
        read_values(args, decal, {"roughness": 0.5, "metal": 0.0, "coat": 0.0})
    raised = number(args["raised"], "raised", minimum=1e-6, maximum=1) if args.get("raised") is not None else None
    paint = None
    if relief is None and (args.get("color") is not None or shown is None):
        paint = colour(args.get("color") or STRIP_COLOUR, "color")
    runs, meetings, line_words = the_line(surface, args.get("along"))
    bm, pieces, fits = strip_mesh(surface, runs, "solid" if pattern == "groove" else pattern, width, pitch or width)
    try:
        need(bm.faces, f"The strip lays no faces on {target.name}: give it a wider width, or another line.")
        points = [f.calc_center_median() for f in bm.faces]
        under = overlapping(target, points)
        if relief is not None:
            carried(surface, bm)
        lift(bm, decal.offset)
        least, most, _ = standoff(surface, measured_points(bm))
        obj = made_object(bm, name, target, decal.offset)
    finally:
        bm.free()
    if relief is not None:
        bases, unders = relief_strip_materials(surface, obj, relief, decal)
        material_words = relief_text(relief, target, bases, obj, unders)
    else:
        material, material_words = strip_material(f"{name} material", decal.values, paint, shown)
        material[MADE_FOR] = name
        obj.data.materials.append(material)
    if raised is not None:
        solid = obj.modifiers.new("Raised", "SOLIDIFY")
        solid.thickness = raised
        solid.offset = 1
        solid.use_even_offset = True
    total = sum(r.length for r in runs)
    lines = [
        f"Strip “{name}” on {target.name} {line_words}: {len(runs)} run{'s' if len(runs) != 1 else ''}, {length(total)} long.",
        pattern_text(pattern, fits, width, raised, shown, asked_words),
        corners_text(runs, meetings, fits, pattern),
    ]
    if pattern == "groove":
        lines += [continuity_text(surface, runs, width), view_text(runs, width, target)]
    lines += [
        f"It stands {gap_words(least, most)} off the surface and moves with {target.name}. "
        + fighting_text(least if least > 0 else decal.offset, nearest_on(runs)),
        material_words,
        overlap_text(under),
    ]
    return lines



def printed_pattern(args, pattern, width):
    """A printed strip's picture, if it repeats one, its pitch and how the pitch was chosen."""
    shown = None
    if pattern == "picture":
        need(args.get("picture") is not None, "pattern picture repeats the picture given as picture.")
        shown = picture(args["picture"])
    else:
        need(args.get("picture") is None, "picture is for pattern picture, which repeats it along the strip.")
    if pattern == "solid":
        need(args.get("pitch") is None, "A plain band has no pitch: it runs whole.")
    asked = args.get("pitch")
    if asked is not None:
        pitch = number(asked, "pitch", minimum=1e-5)
        return shown, pitch, f"asked {length(pitch)}"
    if pattern == "picture":
        return shown, width * shown.aspect, "by default the picture's proportions"
    times = PITCHES.get(pattern, 1)
    return shown, width * times, f"by default {times} width{'s' if times != 1 else ''}"


def pattern_text(pattern, fits, width, raised, shown, asked_words):
    count = sum(c for _, c, _, _, _ in fits)
    pitches = [p for _, _, p, _, _ in fits]
    every = length(pitches[0]) if len({length(p) for p in pitches}) == 1 else range_text(min(pitches), max(pitches))
    finish = f"raised {length(raised)}" if raised is not None else "printed flat"
    if pattern == "solid":
        return f"A plain band {length(width)} wide, {finish}."
    if pattern == "groove":
        return f"{shown.said.capitalize()} {length(width)} wide, drawn by shading alone."
    if pattern == "shape":
        what = shown.said.split(" drawn")[0]
        return (
            f"{what[0].upper()}{what[1:]} repeated {count} times, one every {every} ({asked_words}), {length(width)} wide, "
            "drawn by shading alone."
        )
    what = PLURALS.get(pattern) or f"repeats of {shown.said.split(' (')[0]}"
    return f"{count} {what}, one every {every} ({asked_words}), {length(width)} wide, {finish}."


def nearest_on(runs):
    """The strip's point nearest the camera, where z-fighting would show first."""
    camera = scene().camera
    points = [p for r in runs for p in r.points]
    if camera is None:
        return points[0]
    eye = camera.matrix_world.translation
    return min(points, key=lambda p: (p - eye).length)


def corners_text(runs, meetings, fits, pattern):
    if not meetings:
        if all(r.closed for r in runs):
            loops = "a closed loop" if len(runs) == 1 else f"{len(runs)} closed loops"
            return f"It runs round {loops}, with no corners."
        return "No corners: no runs meet."
    corners = f"{meetings} corner{'s' if meetings != 1 else ''} where runs meet"
    if pattern in BANDS:
        return f"{corners}, each run reaching into it."
    plural = PLURALS[pattern]
    widest = corner_gaps(fits)
    regular = [p * (1 - FILLED[pattern]) for _, _, p, _, _ in fits]
    usual = length(regular[0]) if len({length(g) for g in regular}) == 1 else range_text(min(regular), max(regular))
    across = f"{corners}: across them the widest gap between {plural} is {length(widest)}"
    if usual == length(widest):
        return f"{across}, as between them along a run."
    return f"{across}, against {usual} between them along a run."
