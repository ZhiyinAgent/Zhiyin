"""
What a stylised picture shows of its style: how much of each outlined shape's silhouette carries a
line, read from the picture against the drawing that tells which object is where; and, for a toon
material, how many flat colours its shape shows against the bands asked, and the picture's palette.
"""

import math

import bpy
import numpy

from .finding import scene
from .render_checks import load
from .stylised import OUTLINE, TOON
from .stylised_lines import OUTLINED
from .wording import hex_of

# How far a line may lie from where the drawing puts a silhouette, in the picture's pixels, past
# the drawing's own coarseness.
NEAR = 2
# A pixel carries the line when its colour is this much nearer the line's than its shape's is.
NEARER = 0.5
# Shapes whose colour is this near the line's, 0 to 255 in each channel, cannot show it.
UNTELLABLE = 40
# Under this share of its silhouette lined, a shape is said to miss its lines.
COVERED = 0.8
# Colours this near each other, 0 to 255 in each channel, are one flat colour.
SAME = 14
# A flat colour counts as a band when it covers this share of its shape, and in the palette this share of the picture.
BAND, PALETTE = 0.05, 0.01
# How many shapes are named.
NAMED = 4


def srgb_of(rgb):
    text = hex_of(rgb)
    return numpy.array([int(text[i : i + 2], 16) for i in (1, 3, 5)], dtype=numpy.float32)


def ink():
    """The method the scene's outlines are drawn by, the line's colour as 0 to 255, and the objects outlined, or none for all."""
    s = scene()
    layer = bpy.context.view_layer
    if s.render.use_freestyle and layer.use_freestyle:
        lineset = layer.freestyle_settings.linesets.get(OUTLINED)
        if lineset is not None and lineset.show_render and lineset.linestyle is not None:
            group = bpy.data.collections.get(OUTLINED)
            return "Freestyle", srgb_of(lineset.linestyle.color), (set(group.objects) if group else None)
    for obj in s.objects:
        if obj.get("zhiyin_line_art") and not obj.hide_render and obj.data.materials:
            ink_of = obj.data.materials[0].grease_pencil
            step = next((m for m in obj.modifiers if m.type == "LINEART"), None)
            outlined = set(step.source_collection.objects) if step is not None and step.source_type == "COLLECTION" and step.source_collection else None
            return "Line Art", srgb_of(ink_of.color), outlined
    hulled = [o for o in s.objects if o.type == "MESH" and o.modifiers.get(OUTLINE) and o.modifiers[OUTLINE].show_render]
    if hulled:
        material = next((m for m in hulled[0].data.materials if m is not None and m.name.startswith(OUTLINE)), None)
        if material is not None:
            hex_text = material.name.rpartition(" ")[2]
            return "an inverted hull", numpy.array([int(hex_text[i : i + 2], 16) for i in (1, 3, 5)], dtype=numpy.float32), set(hulled)
    return None


def spread_min(values, radius):
    """The least value within `radius` pixels each way, across then down."""
    out = values
    for axis in (0, 1):
        padded = numpy.pad(out, [(radius, radius) if a == axis else (0, 0) for a in (0, 1)], mode="edge")
        size = out.shape[axis]
        out = numpy.min(numpy.stack([numpy.take(padded, range(k, k + size), axis=axis) for k in range(2 * radius + 1)]), axis=0)
    return out


def coverage_text(found, output):
    """How much of each outlined shape's silhouette carries a line in the picture; nothing without outlines."""
    drawn = ink()
    owner, objects = found.get("owner"), found.get("objects") or []
    if drawn is None or owner is None or output is None:
        return ""
    method, line, outlined = drawn
    owner = numpy.flipud(owner)
    picture = load(output)[..., :3] * 255
    height, width = picture.shape[:2]
    ys = (numpy.arange(height) * owner.shape[0] / height).astype(int)
    xs = (numpy.arange(width) * owner.shape[1] / width).astype(int)
    own = owner[ys][:, xs]
    # A silhouette pixel is one of a shape's whose neighbour is another's or the background.
    edge = numpy.zeros_like(own, dtype=bool)
    edge[:, :-1] |= own[:, :-1] != own[:, 1:]
    edge[:, 1:] |= own[:, 1:] != own[:, :-1]
    edge[:-1, :] |= own[:-1, :] != own[1:, :]
    edge[1:, :] |= own[1:, :] != own[:-1, :]
    from_line = numpy.sqrt(((picture - line) ** 2).sum(axis=-1))
    nearest = spread_min(from_line, NEAR + math.ceil(max(height / owner.shape[0], width / owner.shape[1])))
    shares = []
    for number in numpy.unique(own[edge]):
        if number == 0 or number > len(objects):
            continue
        obj = objects[number - 1]
        if outlined is not None and obj not in outlined:
            continue
        mine = own == number
        own_colour = numpy.median(picture[mine & ~edge], axis=0) if (mine & ~edge).any() else numpy.median(picture[mine], axis=0)
        apart = float(numpy.sqrt(((own_colour - line) ** 2).sum()))
        if apart < UNTELLABLE:
            continue
        rim = mine & edge
        lined = nearest[rim] < NEARER * apart
        shares.append((obj.name, float(lined.mean()), int(rim.sum())))
    if not shares:
        return ""
    total = sum(share * count for _, share, count in shares) / sum(count for _, _, count in shares)
    least = sorted((s for s in shares if s[1] < COVERED), key=lambda s: s[1])
    return (
        f"Outlines by {method} line {total:.0%} of the outlined shapes' silhouettes in the picture"
        + (
            "; least "
            + ", ".join(f"{name} {share:.0%}" for name, share, _ in least[:NAMED])
            + ", whose lines are missing along part of the edge: a thicker line, a lower crease, or another method draws more"
            if least
            else ""
        )
        + "."
    )


def flat_colours(pixels, least):
    """The flat colours among some pixels, each covering at least `least` of them, most first, with their shares."""
    if not len(pixels):
        return []
    coarse = (pixels // 4).astype(int)
    keys, counts = numpy.unique(coarse[:, 0] * 4096 + coarse[:, 1] * 64 + coarse[:, 2], return_counts=True)
    order = numpy.argsort(-counts)
    colours = numpy.stack([keys // 4096, keys // 64 % 64, keys % 64], axis=-1)[order] * 4 + 2
    centres, sizes = [], []
    for colour, count in zip(colours, counts[order]):
        for index, centre in enumerate(centres):
            if numpy.abs(centre - colour).max() <= SAME:
                sizes[index] += count
                break
        else:
            centres.append(colour.astype(float))
            sizes.append(count)
    total = len(pixels)
    return [(centre, size / total) for centre, size in zip(centres, sizes) if size / total >= least]


def toon_bands(material):
    """How many bands of light a toon material was made with, and whether it has a rim; or none for another material."""
    if material is None or not material.use_nodes:
        return None
    ramp = material.node_tree.nodes.get(f"{TOON} bands")
    if ramp is None:
        return None
    return len(ramp.color_ramp.elements), material.node_tree.nodes.get(f"{TOON} rim") is not None


def toon_text(found):
    """How many flat colours each toon-shaded shape shows against its bands, and the picture's palette; nothing without toon."""
    owner, objects, shown = found.get("owner"), found.get("objects") or [], found.get("shown")
    if owner is None or shown is None:
        return ""
    said = []
    for number in numpy.unique(owner):
        if number == 0 or number > len(objects):
            continue
        obj = objects[number - 1]
        made = next((toon_bands(slot.material) for slot in obj.material_slots if toon_bands(slot.material)), None)
        if made is None:
            continue
        mine = owner == number
        # Inside the shape only: its edges blend with what is round it.
        inside = mine.copy()
        inside[1:, :] &= mine[:-1, :]
        inside[:-1, :] &= mine[1:, :]
        inside[:, 1:] &= mine[:, :-1]
        inside[:, :-1] &= mine[:, 1:]
        if inside.sum() < 20:
            continue
        bands, rim = made
        flat = flat_colours(shown[inside], BAND)
        # A rim shows only where the surface turns away, so it may add a colour or not.
        most = bands + (1 if rim else 0)
        said.append(
            f"{obj.name} shows {len(flat)} flat {'colour' if len(flat) == 1 else 'colours'} of the {bands} {'band' if bands == 1 else 'bands'} asked"
            + (", with a rim" if rim else "")
            + (
                ": its light falls in fewer bands than asked, so light it from the side, or more lights, to reach the darker ones"
                if len(flat) < bands
                else ": more than asked, as a picture, shadows or another light adds"
                if len(flat) > most
                else ""
            )
        )
    if not said:
        return ""
    palette = flat_colours(shown.reshape(-1, 3), PALETTE)
    covered = sum(share for _, share in palette)
    return (
        "Toon: "
        + "; ".join(said[:NAMED])
        + f". The picture's palette: {len(palette)} flat colours, each over {PALETTE:.0%} of it, cover {covered:.0%} of it."
    )
