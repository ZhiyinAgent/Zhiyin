"""blender_export: objects written to a model file, which is moved into place only once whole."""

import contextlib
import os
import shutil
import tempfile

import bpy

from .arguments import need, whole
from .baking import baked_for_export
from .file_looks import WITH_MATERIALS, looks_lost
from .finding import find_objects, is_backdrop, is_helper, scene
from .geometry import copies_of, held_still
from .scene_file import pictures_from_their_files
from .shading_files import pictures_lost

EXPORTS = (".glb", ".stl", ".obj", ".fbx", ".usd", ".usda", ".usdc", ".usdz", ".ply")
# The width and height of pictures baked for the file, in pixels: at least, by default and at most.
LEAST_BAKE, BAKE, MOST_BAKE = 32, 1024, 4096


def chosen(names):
    if names:
        return find_objects(names)
    return [o for o in scene().objects if not is_helper(o) and not o.hide_render and o.type not in ("CAMERA", "LIGHT") and not is_backdrop(o)]


def unseen_above(folder):
    """How many of the folders above `folder` Blender may not look at."""
    count = 0
    while (above := os.path.dirname(folder)) != folder:
        folder = above
        count += not os.path.exists(folder)
    return count


def usd_written(output, write):
    """
    A USD file Blender writes at `output`, by way of a folder of its own.

    Before USD writes a file, it finds the deepest folder of its path that
    exists by halving the path's folders, and stops at the first folder it may
    not look at. Blender may look at none above the workspace, so USD would
    refuse to write there. In a folder with at least as many folders below the
    ones Blender may not see as above them, USD's first look lands below, and
    it never looks higher. The file is written there with whole paths to what
    it names, which are then made relative to where it goes, and moved there.
    """
    from pxr import Sdf, UsdUtils

    staging = tempfile.mkdtemp(prefix="zhiyin-usd-")
    try:
        deep = os.path.join(staging, *["d"] * unseen_above(staging))
        os.makedirs(deep)
        staged = os.path.join(deep, "made" + os.path.splitext(output)[1])
        write(staged)
        folder = os.path.dirname(output)

        def relative(path):
            if not path or not os.path.isabs(path):
                return path
            try:
                path = os.path.relpath(path, folder).replace(os.sep, "/")
            except ValueError:
                return path
            return path if path.startswith("../") else f"./{path}"

        layer = Sdf.Layer.FindOrOpen(staged)
        UsdUtils.ModifyAssetPaths(layer, relative)
        layer.Save()
        del layer
        moved_into_place(staged, output)
    finally:
        shutil.rmtree(staging, ignore_errors=True)


# Windows' answer to a move onto another drive.
NOT_SAME_DEVICE = 17


def moved_into_place(staged, output):
    """
    Moves a file Blender wrote in its own folder to where it goes. Windows
    moves a file only within a drive; a workspace on another drive than
    Zhiyin's data gets a copy beside the file it replaces, which then takes
    its place whole.
    """
    try:
        os.replace(staged, output)
        return
    except OSError as error:
        if getattr(error, "winerror", None) != NOT_SAME_DEVICE:
            raise
    beside = f"{output}.{os.getpid()}.zhiyin-part"
    try:
        shutil.copyfile(staged, beside)
        os.replace(beside, output)
    finally:
        if os.path.exists(beside):
            os.remove(beside)


def export(args, scene_file):
    output = args.get("output")
    extension = os.path.splitext(output)[1].lower()
    need(extension in EXPORTS, f"A model is exported as one of {', '.join(EXPORTS)}.")
    names = args.get("objects")
    objects = chosen(names)
    need(objects, "There is nothing to export.")
    # Cutters and other helpers are never part of the model. A named object
    # is exported with all its parts, which hiding it hid too; without names,
    # what is shown is exported, and a part the model hid stays out.
    chosen_parts = list(
        dict.fromkeys(
            part
            for obj in objects
            for part in (obj, *obj.children_recursive)
            if not is_helper(part) and (names or not part.hide_render)
        )
    )
    need(chosen_parts, "A hole's cutter is never exported: name the object it cuts.")
    bake = args.get("bake") is True
    need(
        not bake or extension in WITH_MATERIALS,
        f"A {extension} carries no materials, so there is nothing to bake for it: leave bake out.",
    )
    need(
        not bake or extension == ".glb",
        f"Baking for the file works for a .glb, which carries its pictures inside it; a {extension} refers to picture files,"
        " which a bake for the file does not write: bake them with blender_bake, then export.",
    )
    size = whole(args.get("bake_size"), "bake_size", minimum=LEAST_BAKE, maximum=MOST_BAKE, default=BAKE)
    # A named object is exported even when hidden; Blender exports only what it shows.
    hidden = [
        (part, part.hide_get(), part.hide_viewport, part.hide_render)
        for part in chosen_parts
        if part.hide_get() or part.hide_viewport or part.hide_render
    ]
    for part, _, _, _ in hidden:
        part.hide_set(False)
        part.hide_viewport = False
        part.hide_render = False
    bpy.context.view_layer.update()
    with contextlib.ExitStack() as held:
        baked = held.enter_context(baked_for_export(chosen_parts, size)) if bake else []
        output_written(args, objects, chosen_parts, hidden, output, extension)
        # What the file holds is what the parts wear while it is written.
        lost = written_looks(chosen_parts, output, extension)
    need(os.path.exists(output), f"Blender did not write {os.path.basename(output)}.")
    units = " in millimetres" if extension == ".stl" else ""
    return f"Exported {', '.join(o.name for o in objects)} to {os.path.basename(output)}{units}." + "".join(" " + line for line in baked) + lost


def written_looks(chosen_parts, output, extension):
    """What the file just written loses of the looks its parts and the instances they place wear."""
    with held_still():
        shown = chosen_parts + [
            bpy.data.objects[source] for part in chosen_parts for source, _, _ in copies_of(part) if source and source in bpy.data.objects
        ]
    materials = dict.fromkeys(slot.material for part in shown for slot in part.material_slots if slot.material is not None)
    return looks_lost(materials, output, extension) + pictures_lost(materials, extension)


def output_written(args, objects, chosen_parts, hidden, output, extension):
    """Writes the file in its format from the chosen parts, the hidden ones shown for it and hidden again after."""
    with pictures_from_their_files():
        written_as(objects, chosen_parts, hidden, output, extension)


def written_as(objects, chosen_parts, hidden, output, extension):
    try:
        for obj in scene().objects:
            obj.select_set(False)
        for part in chosen_parts:
            part.select_set(True)
        bpy.context.view_layer.objects.active = objects[0]
        # Each format writes the one file named: no materials beside an OBJ, and
        # a USD keeps its pictures where they are and leaves the world out,
        # rather than writing pictures of its own.
        if extension == ".glb":
            # With what geometry nodes place, which glTF otherwise leaves out.
            bpy.ops.export_scene.gltf(
                filepath=output, export_format="GLB", use_selection=True, export_apply=True, export_gn_mesh=True
            )
        elif extension == ".stl":
            # Printers read STL in millimetres.
            bpy.ops.wm.stl_export(filepath=output, export_selected_objects=True, apply_modifiers=True, global_scale=1000)
        elif extension == ".obj":
            bpy.ops.wm.obj_export(filepath=output, export_selected_objects=True, apply_modifiers=True, export_materials=False)
        elif extension == ".ply":
            bpy.ops.wm.ply_export(filepath=output, export_selected_objects=True, apply_modifiers=True)
        elif extension == ".fbx":
            bpy.ops.export_scene.fbx(filepath=output, use_selection=True)
        elif extension == ".usdz":
            # Blender makes a package in its temporary folder, which lies deep
            # enough in the conversation's own for USD to write there (see
            # usd_written), and moves it here.
            bpy.ops.wm.usd_export(filepath=output, selected_objects_only=True, export_textures_mode="KEEP", convert_world_material=False)
        else:
            usd_written(
                output,
                lambda path: bpy.ops.wm.usd_export(
                    filepath=path,
                    selected_objects_only=True,
                    export_textures_mode="KEEP",
                    relative_paths=False,
                    convert_world_material=False,
                ),
            )
    finally:
        for part, in_view_layer, in_viewport, in_render in hidden:
            part.hide_render = in_render
            part.hide_viewport = in_viewport
            part.hide_set(in_view_layer)
