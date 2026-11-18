"""
blender_bake: objects' materials and shapes baked into texture maps by Cycles, from the object
itself or from high-detail objects onto it, written as PNG files in the workspace, and the object
given a copy of its material drawn from the maps. Says for each map its file, size and what it
holds, and for each object how much of the texture its layout covers, the texels no ray reached,
how far each island bleeds and how near islands come; the maps are shown on one sheet.

`baked_for_export` bakes what a model file cannot hold of objects' materials into pictures the
file carries, for the length of an export.
"""

import contextlib
import os

import bpy
import numpy

from .arguments import need, whole
from .bake_files import MAPS, contact_sheet, picture_values, range_words, write_map
from .bake_material import baked_material
from .bake_runs import Target, baked_into, baking_scene, cage_from, gap, run_bake
from .bake_shaders import glowing, stand_in_material
from .errors import Refused
from .file_looks import worked_out
from .finding import find_objects
from .glass import lets_light_through_sheets
from .unwrap_measures import raster
from .unwrap_report import layout_measures
from .unwrapping import SMART, lay_out
from .wood import lays_grain
from .wording import length

RESOLUTION = 1024
# The fewest and most pixels across a map.
RESOLUTIONS = (32, 8192)
FOLDER = "textures"
# The shape measures' reach, as a share of the object's size, and the least, in metres.
AO_SHARE, EDGE_SHARE, CAVITY_SHARE, THICKNESS_SHARE, LEAST_REACH = 1.0, 0.01, 0.02, 0.5, 0.0005
# The most texels across the islands' nearness is measured on.
GAP_MEASURED = 2048
# What each input a model file cannot hold is baked into, for an export.
FOR_FILES = {"Base Color": "color", "Metallic": "metallic", "Roughness": "roughness", "Normal": "normal", "Emission Color": "emission", "Alpha": "opacity"}


# A map's margin by default is its size over this, in pixels, and at least one.
MARGIN_SHARE = 128


def default_margin(size):
    """The size over MARGIN_SHARE, halves rounded up as the approval rounds them."""
    return max(1, int(size / MARGIN_SHARE + 0.5))


@contextlib.contextmanager
def with_materials(objects):
    """Each object that has no material given a plain one while the block runs."""
    given = []
    try:
        for obj in objects:
            if not any(slot.material for slot in obj.material_slots):
                material = stand_in_material()
                obj.data.materials.append(material)
                given.append((obj, material))
        yield
    finally:
        for obj, material in given:
            obj.data.materials.pop(index=len(obj.data.materials) - 1)
            bpy.data.materials.remove(material)


def _materials(objects):
    return list(dict.fromkeys(slot.material for obj in objects for slot in obj.material_slots if slot.material is not None))


def _reach(obj, share):
    return max(LEAST_REACH, share * max(obj.dimensions))


class Baker:
    """One object's bakes at one size, from its own surface or from high-detail objects with their cage."""

    def __init__(self, obj, size, margin, highs=(), cage=None):
        self.obj, self.size, self.margin, self.highs, self.cage = obj, size, margin, tuple(highs), cage

    def bake(self, kind, samples, value=None, own=False, margin=None, reach=0.0):
        """The texels a bake wrote, (N, 4) bottom row first; a value glows while it bakes."""
        highs = () if own else self.highs
        target = Target(self.size)
        try:
            with baked_into(self.obj, target):
                drawn = _materials(highs or [self.obj])
                with glowing(drawn, value, reach) if value else contextlib.nullcontext():
                    run_bake(self.obj, kind, samples, self.margin if margin is None else margin, highs, self.cage)
            return target.pixels()
        finally:
            target.free()

    def covered(self):
        """The texels the object's layout covers, as Cycles lays it."""
        return self.bake("EMIT", 1, "lit", own=True, margin=0)[:, 3] > 0.999

    def hit(self):
        """The texels a ray from the high-detail objects reached."""
        return self.bake("EMIT", 1, "lit", margin=0)[:, 3] > 0.999

    def value(self, name):
        """A map's values, (N, 3), and the texels the bake wrote."""
        kind, _, samples = MAPS[name]
        if kind == "glow":
            share = {"ao": AO_SHARE, "edge": EDGE_SHARE, "curvature": EDGE_SHARE, "cavity": CAVITY_SHARE, "thickness": THICKNESS_SHARE}.get(name, 0)
            found = self.bake("EMIT", samples, name, reach=_reach(self.obj, share) if share else 0.0)
        else:
            found = self.bake(kind, samples)
        return found[:, :3].astype(numpy.float64), found[:, 3] > 0.0

    def height(self):
        """How far the surface lies out from the object along its normal, in metres, and the texels written."""
        if not self.highs:
            try:
                found = self.bake("EMIT", 4, "height")
            except Refused:
                raise Refused(
                    f"height needs from: high-detail objects to measure “{self.obj.name}” against, or a material"
                    " with a displacement to read it from."
                ) from None
            return found[:, 0].astype(numpy.float64), found[:, 3] > 0.0
        far = self.bake("EMIT", 4, "position")
        near = self.bake("EMIT", 1, "position", own=True)
        normal = self.bake("EMIT", 1, "normal", own=True)[:, :3].astype(numpy.float64)
        normal /= numpy.maximum(numpy.linalg.norm(normal, axis=1), 1e-12)[:, None]
        out = ((far[:, :3] - near[:, :3]) * normal).sum(axis=1)
        return out, far[:, 3] > 0.0


def _nearest_islands(found, size, margin):
    """How near, in texels at `size`, two islands come, up to twice the margin; None when none come that near. Islands stacked on a twin count as one."""
    laid = found["laid"]
    measured = min(size, GAP_MEASURED)
    scale = size / measured
    texels, owners = raster(laid.flat, measured)
    labels = numpy.full(measured * measured, -1, dtype=numpy.int64)
    island = numpy.arange(laid.island_count)
    for one, two, _ in found["twins"]:
        island[two] = island[one]
    labels[texels] = island[laid.islands[owners]]
    labels = labels.reshape(measured, measured)
    for step in range(int(margin / scale) + 2):
        for one, two in ((labels[1:], labels[:-1]), (labels[:, 1:], labels[:, :-1])):
            if ((one >= 0) & (two >= 0) & (one != two)).any():
                return round(2 * step * scale)
        grown = labels.copy()
        for axis, shift in ((0, 1), (0, -1), (1, 1), (1, -1)):
            moved = numpy.roll(labels, shift, axis=axis)
            empty = grown < 0
            grown[empty] = moved[empty]
        labels = grown
    return None


def _settings(args):
    names = args.get("objects")
    need(isinstance(names, list) and names, "objects names the objects to bake.")
    maps = args.get("maps")
    need(isinstance(maps, list) and maps, f"maps lists what to bake: {', '.join(MAPS)}.")
    unknown = [m for m in maps if m not in MAPS]
    need(not unknown, f"{', '.join(map(str, unknown))} is not a map this bakes: {', '.join(MAPS)}.")
    size = whole(args.get("resolution"), "resolution", minimum=RESOLUTIONS[0], maximum=RESOLUTIONS[1], default=RESOLUTION)
    margin = whole(args.get("margin_px"), "margin_px", minimum=0, maximum=256, default=default_margin(size))
    files = args.get("files") or {}
    for name in names:
        need(all((files.get(name) or {}).get(m) for m in maps), f"The files to write for {name} were not named.")
    return names, list(dict.fromkeys(maps)), size, margin, files


def _cage_words(obj, highs, outside, inside, cage):
    named = ", ".join(h.name for h in highs)
    return (
        f"from {named}, which lies up to {length(outside)} outside {obj.name} and {length(inside)} inside it,"
        f" so rays start {length(cage[0])} out and reach {length(cage[1])} in"
    )


def _layout_words(found):
    """What of the object's layout a bake would be harmed by: islands overlapping, or reaching outside the tile."""
    said = []
    if found["loose"]:
        share = found["loose"] / found["covered"].size ** 2
        said.append(f"islands overlap on {share:.1%} of the texture, so those texels show whichever face baked last")
    if found["outside"]:
        said.append(f"{found['outside']} islands reach outside the texture, and what lies outside bakes nowhere")
    return said


@lets_light_through_sheets
@lays_grain
def bake(args, scene_file):
    names, maps, size, margin, files = _settings(args)
    objects = find_objects(names, {"MESH"})
    highs = find_objects(args["from"], {"MESH"}) if args.get("from") else []
    for obj in objects:
        need(obj not in highs, f"“{obj.name}” is both baked and baked from.")
        need(obj.data.polygons, f"“{obj.name}” has no faces to bake.")
        need(
            obj.data.uv_layers.active is not None,
            f"“{obj.name}” has no layout to bake into: lay it out first with blender_unwrap.",
        )
    folder = args.get("folder") or FOLDER
    lines, tiles, done = [], [], []
    with baking_scene([*objects, *highs]), with_materials([*objects, *highs]):
        for obj in objects:
            lines += _bake_object(obj, maps, size, margin, highs, files[obj.name], folder, tiles, done)
    if args.get("picture") and tiles:
        contact_sheet(tiles, args["picture"])
    for obj, written, height_range in done:
        material, replaced = baked_material(obj, written, height_range)
        kept = f"; {', '.join(replaced)} {'stays' if len(replaced) == 1 else 'stay'} in the file" if replaced else ""
        lines.append(f"{obj.name}'s material is now {material.name}, drawn from its maps{kept}.")
    return "\n".join(lines)


def _bake_object(obj, maps, size, margin, highs, paths, folder, tiles, done):
    cage = None
    said = [f"{obj.name}: {len(maps)} map{'s' if len(maps) != 1 else ''} at {size} × {size} px, {margin} px bleed"]
    if highs:
        outside, inside = gap(obj, highs)
        cage = cage_from(outside, inside)
        said.append(_cage_words(obj, highs, outside, inside, cage))
    baker = Baker(obj, size, margin, highs, cage)
    covered = baker.covered()
    reached = baker.hit() & covered if highs else covered
    said.append(f"its layout covers {covered.mean():.0%} of the texels")
    if highs:
        missed = covered & ~reached
        if missed.any():
            said.append(
                f"rays from {', '.join(h.name for h in highs)} missed {missed.sum() / covered.sum():.0%} of them,"
                " so those texels hold nothing baked from them"
            )
        else:
            said.append("every ray met the high-detail surface")
    found = layout_measures(obj, size)
    need(found is not None, f"“{obj.name}” has no faces in its layout to bake into.")
    near = _nearest_islands(found, size, margin)
    if near is not None and near < 2 * margin:
        said.append(f"islands come within {near} px of each other, so their bleeds meet: each keeps {near // 2} px there")
    else:
        said.append(f"islands lie at least {2 * margin} px apart, so each keeps its whole bleed")
    said += _layout_words(found)
    lines = ["; ".join(said) + "."]
    values, written_texels = {}, {}

    def baked(name):
        if name not in values:
            values[name], written_texels[name] = baker.value(name)
        return values[name], written_texels[name]

    pictures, height_range = {}, None
    for name in maps:
        extra = None
        if name == "orm":
            parts = [baked(part) for part in ("ao", "roughness", "metallic")]
            found = numpy.stack([part[0][:, 0] for part in parts], axis=1)
            wrote = parts[0][1]
        elif name == "height":
            heights, wrote = baker.height()
            shown_at = reached & wrote
            low = float(heights[shown_at].min()) if shown_at.any() else 0.0
            high = float(heights[shown_at].max()) if shown_at.any() else 0.0
            extra = height_range = (low, high)
            level = (heights - low) / (high - low) if high > low else numpy.full(len(heights), 0.5)
            found = numpy.repeat(level[:, None], 3, axis=1)
        else:
            found, wrote = baked(name)
        shown = picture_values(name, found, wrote)
        pictures[name] = shown
        words = range_words(name, found, reached, extra)
        lines.append(f"- {name}: {folder}/{os.path.basename(paths[name])}, {words}.")
        tiles.append((f"{obj.name} {name}", shown, size))
    for name, shown in pictures.items():
        write_map(paths[name], name, shown, size)
    done.append((obj, {name: paths[name] for name in maps}, height_range))
    return lines


@contextlib.contextmanager
def baked_for_export(objects, resolution=RESOLUTION):
    """
    For the length of the block, each of `objects` whose material works out a colour,
    metalness, roughness, relief, glow or opacity with nodes a model file cannot hold wears a
    copy drawn from pictures baked of them, packed in the scene so the file carries them; an
    object with no layout is laid out for it by smart projection. Yields the lines saying what
    was baked; afterwards the objects, their materials and layouts are as they were.
    """
    said, undo = [], []
    try:
        chosen = []
        for obj in objects:
            if obj.type != "MESH" or not obj.data.polygons:
                continue
            materials = _materials([obj])
            lost = set()
            for material in materials:
                inputs = worked_out(material)
                lost.update(FOR_FILES.values() if inputs is None else (FOR_FILES[name] for name, _ in inputs))
            if lost:
                chosen.append((obj, [m for m in MAPS if m in lost]))
        if not chosen:
            yield said
            return
        with baking_scene([obj for obj, _ in chosen]):
            for obj, maps in chosen:
                undo.append(_export_bake(obj, maps, resolution))
                said.append(f"{obj.name}'s {', '.join(maps)} baked into {resolution} px pictures the file carries.")
        yield said
    finally:
        for restore in reversed(undo):
            restore()


def _export_bake(obj, maps, size):
    """Bakes an object's maps into packed pictures and gives it a material of them; returns what puts it back."""
    layers = obj.data.uv_layers
    made_layer = None
    if layers.active is None:
        made_layer = "Zhiyin export layout"
        layers.active = layers.new(name=made_layer)
        lay_out(obj, "smart", SMART, default_margin(size) / size)
    slots = [slot.material for slot in obj.material_slots]
    baker = Baker(obj, size, default_margin(size))
    pictures = {}
    for name in maps:
        found, wrote = baker.value(name)
        shown = picture_values(name, found, wrote)
        image = bpy.data.images.new(f"{obj.name} {name}", size, size, alpha=False)
        image.colorspace_settings.name = "Non-Color"
        pixels = numpy.ones((size * size, 4), dtype=numpy.float32)
        pixels[:, :3] = shown
        image.pixels.foreach_set(pixels.ravel())
        image.pack()
        pictures[name] = image
    material = _export_material(obj, pictures)

    def restore():
        for slot, before in zip(obj.material_slots, slots):
            slot.material = before
        if not slots:
            obj.data.materials.clear()
        bpy.data.materials.remove(material)
        for image in pictures.values():
            bpy.data.images.remove(image)
        if made_layer is not None:
            layers.remove(layers[made_layer])

    return restore


def _export_material(obj, pictures):
    """A material drawn from packed pictures, given to every slot of the object."""
    material = bpy.data.materials.new(f"{obj.name} for the file")
    tree = material.node_tree
    shader = next(n for n in tree.nodes if n.type == "BSDF_PRINCIPLED")
    for name, image in pictures.items():
        image.colorspace_settings.name = "sRGB" if name in ("color", "emission") else "Non-Color"
        node = tree.nodes.new("ShaderNodeTexImage")
        node.image = image
        if name == "normal":
            relief = tree.nodes.new("ShaderNodeNormalMap")
            tree.links.new(node.outputs["Color"], relief.inputs["Color"])
            tree.links.new(relief.outputs["Normal"], shader.inputs["Normal"])
            continue
        socket = {v: k for k, v in FOR_FILES.items()}[name]
        tree.links.new(node.outputs["Color"], shader.inputs[socket])
        if name == "emission":
            shader.inputs["Emission Strength"].default_value = 1.0
    if not obj.material_slots:
        obj.data.materials.append(material)
    for slot in obj.material_slots:
        slot.material = material
    return material

