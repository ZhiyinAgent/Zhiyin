"""
What the scene costs to draw and hold: the faces drawn with every instance counted, the faces held
in the meshes Blender keeps once each, how many instances and meshes there are, how much memory
the pictures its materials use take as loaded, and the five objects that draw the most faces, an
object placing instances counted with them.
"""

import bpy

from .finding import is_helper
from .geometry import SHAPE_TYPES, evaluated_graph

# How many of the objects drawing the most faces are named.
BIGGEST = 5


def faces_of(shown, counted):
    """The faces of an evaluated object's shape, counted once for each mesh it draws."""
    data = shown.data
    key = data.as_pointer() if data is not None else shown.as_pointer()
    if key not in counted:
        if shown.type == "MESH":
            counted[key] = len(data.polygons)
        else:
            mesh = shown.to_mesh()
            counted[key] = len(mesh.polygons) if mesh is not None else 0
            shown.to_mesh_clear()
    return key, counted[key]


def picture_bytes(image):
    """The memory a picture takes as loaded: its pixels by its channels, four bytes each when it holds floats."""
    width, height = image.size
    return width * height * image.channels * (4 if image.is_float else 1)


def kept_data():
    """
    What the file keeps: the scenes, what Blender holds whether used or not, and everything they use
    in turn. A material nothing wears, and its pictures, are not saved, so they are not the scene's.
    """
    uses = {}
    for used, users in bpy.data.user_map().items():
        for user in users:
            uses.setdefault(user, set()).add(used)
    roots = [*bpy.data.scenes]
    for datablocks in (bpy.data.images, bpy.data.materials, bpy.data.node_groups, bpy.data.textures, bpy.data.brushes):
        roots += [datablock for datablock in datablocks if datablock.use_fake_user]
    kept, waiting = set(), list(roots)
    while waiting:
        datablock = waiting.pop()
        if datablock in kept:
            continue
        kept.add(datablock)
        waiting += uses.get(datablock, ())
    return kept


def budget_text():
    """The scene's faces drawn and held, its instances, meshes and pictures in memory, and its biggest five, in one line."""
    graph = evaluated_graph()
    counted, drawn_by, held = {}, {}, set()
    drawn = instances = 0
    placing = {}
    for instance in graph.object_instances:
        shown = instance.object
        if shown.type not in SHAPE_TYPES:
            continue
        owner = (instance.parent if instance.is_instance else instance.object).original
        if is_helper(owner) or owner.hide_render:
            continue
        key, faces = faces_of(shown, counted)
        held.add(key)
        drawn += faces
        drawn_by[owner.name] = drawn_by.get(owner.name, 0) + faces
        if instance.is_instance:
            instances += 1
            placing[owner.name] = placing.get(owner.name, 0) + 1
    kept = sum(counted[key] for key in held)
    # A render's result and the compositor's viewer are Blender's own; a missing file has no pixels.
    saved = kept_data()
    pictures = [image for image in bpy.data.images if image in saved and image.type in ("IMAGE", "MULTILAYER", "UV_TEST") and image.size[0]]
    memory = sum(picture_bytes(image) for image in pictures) / 2**20
    biggest = sorted(drawn_by.items(), key=lambda item: -item[1])[:BIGGEST]
    named = ", ".join(
        f"{name} ({faces:,} faces" + (f", {placing[name]:,} instances)" if name in placing else ")") for name, faces in biggest if faces
    )
    line = (
        f"Scene budget: {drawn:,} faces drawn, {kept:,} held in {len(held):,} mesh{'es' if len(held) != 1 else ''} kept once each;"
        f" {instances:,} instance{'s' if instances != 1 else ''};"
        f" pictures {memory:.3g} MB in memory as loaded ({len(pictures)} picture{'s' if len(pictures) != 1 else ''})"
    )
    return line + (f". Most faces drawn: {named}." if named else ".")
