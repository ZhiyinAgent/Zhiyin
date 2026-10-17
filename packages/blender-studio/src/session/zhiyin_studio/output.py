"""Pictures and model files out of the scene: renders, exports and previews.

A preview never changes the scene: everything it adds or sets is put back
before the next command, and it is rendered after the file was saved.
"""

import math
import os
import shutil
import tempfile
import time

import bmesh
import bpy
import mathutils
import numpy

from .common import (
    CUT_OF,
    LIGHTING,
    PREVIEW,
    SHAPE_TYPES,
    TONES,
    add_part,
    find_object,
    in_collection,
    keep_error,
    length,
    lets_light_through,
    is_helper,
    need,
    number,
    scene,
    vector,
    whole,
    place_to_fit,
    refocus,
    subjects,
    tone_text,
    world_bounds,
    world_corners,
)
from .looks import DIRECTIONS, floor_only, frame, heading, seen_as_white
from .seen import colours

GPU_KINDS = ("OPTIX", "CUDA", "HIP", "ONEAPI", "METAL")
EXPORTS = (".glb", ".stl", ".obj", ".fbx", ".usd", ".usda", ".usdc", ".usdz", ".ply")
# Seconds of drawing a full preview in Cycles may take, so a scene that is slow
# to draw, such as smoke or a liquid's volume, cannot hold up turning the view.
PREVIEW_DRAWING = 1.0
# Bounces light is followed through in a scene with glass or a liquid.
SEE_THROUGH_BOUNCES = 32
# Samples for the two pictures of the backdrop that find a product's shadow on
# white, and how close to unshaded a pixel there counts as unshaded.
SHADOW_SAMPLES = 64
UNSHADED = 0.985


def gpu():
    """Turns on the first kind of GPU Cycles can use, and names it; nothing on a CPU-only PC."""
    preferences = bpy.context.preferences.addons["cycles"].preferences
    for kind in GPU_KINDS:
        try:
            preferences.compute_device_type = kind
        except TypeError:
            continue
        preferences.get_devices()
        devices = [d for d in preferences.devices if d.type == kind]
        if devices:
            for device in preferences.devices:
                device.use = device.type == kind
            return devices[0].name
    preferences.compute_device_type = "NONE"
    return None


class Device:
    def __init__(self):
        self.name = gpu()
        self.eevee = True

    def use_cycles(self, samples):
        render = scene()
        render.render.engine = "CYCLES"
        render.cycles.device = "GPU" if self.name else "CPU"
        render.cycles.samples = samples
        render.cycles.use_denoising = True

    def said(self):
        return self.name or "the processor"


def write_picture(path, file_format, quality=90):
    settings = scene().render.image_settings
    settings.media_type = "IMAGE"
    settings.file_format = file_format
    if file_format == "JPEG":
        settings.quality = quality
        settings.color_mode = "RGB"
    elif file_format == "PNG":
        settings.color_mode = "RGBA" if scene().render.film_transparent else "RGB"
    scene().render.filepath = path
    bpy.ops.render.render(write_still=True)


def lifelike_eevee(s):
    """
    Without ray tracing EEVEE draws glass and polished metal black; without its
    fast global illumination a product takes no light from the surfaces round
    it, and shows more than a stop darker than Cycles shows it.
    """
    s.eevee.use_raytracing = True
    s.eevee.use_fast_gi = True


# Said with every EEVEE picture, so a draft is not handed over as the picture.
DRAFT = (
    "EEVEE is a quick look at layout and framing: it lets a sky's light through walls and ceilings and shows glass roughly, "
    "so light and colours are judged, and the picture to hand over is made, with Cycles."
)


# How much of a plan's picture is left empty round the scene.
PLAN_MARGIN = 0.06
# An object over this share of a plan, with its bottom above the middle of
# the scene's height, hides what is under it as a ceiling or a roof does.
OVER_THE_REST = 0.6
# Said with a plan, so nothing is put back by hand.
PLAN_KEEPS = " The scene keeps its own camera, lights, background, tone, exposure and picture size."
# How high above the floor a plan is cut, as drawn plans are: above a window's
# sill and below a door's head. The floor is at z = 0 in a scene that stands
# on it, whatever slab or ground lies under; elsewhere it is the lowest point.
PLAN_CUT = 1.2
# How far above the height asked for the cut is really made. Sills, worktops
# and door heads are built at round heights, and a face lying in the very
# plane of a cut is neither above it nor below: the outline there comes out
# with corners that join three edges, and nothing can be filled.
CUT_SLIVER = 0.00037
# How far under the cut its filled faces lie, so the cut does not take them too.
UNDER_THE_CUT = 0.002
# A wall a cut passes through is filled with this, as a drawn plan fills its walls.
CUT_FILL = (0.04, 0.04, 0.04, 1)
# A shape this near the top of the highest one cut is as high as the walls.
AS_HIGH = 0.05
# How many names are said of what a cut leaves out or passes through.
NAMED = 6


class Aside:
    """What one picture hides or sets for itself, put back once it is written."""

    def __init__(self):
        self.steps = []

    def hide(self, objects):
        for obj in objects:
            if not obj.hide_render:
                self.set(obj, "hide_render", True)

    def set(self, owner, name, value):
        self.steps.append((owner, name, getattr(owner, name)))
        setattr(owner, name, value)

    def restore(self):
        for owner, name, value in reversed(self.steps):
            setattr(owner, name, value)
        self.steps = []


def footprint(obj):
    """How much of the plan an object covers, by its bounds."""
    own = world_bounds([obj])
    return (own[1].x - own[0].x) * (own[1].y - own[0].y) if own else 0


def filled_cut(level, made):
    """
    Fills what a plan's cut passes through: the inside of each closed shape
    where it crosses the level, as an object of its own just under the cut
    that names the shape it was cut from, added to what was made for the
    picture. A shape as high as the highest of them is
    filled dark, as a drawn plan fills its walls. A lower one, as a door's
    leaf, a window or a wardrobe is, is filled with its own material, so it
    shows as it would from above and is not taken for a wall. Returns the
    names of the shapes filled dark and of those filled in their own colour,
    each from the one that covers most of the plan. An open shape, such as a
    plane stood up, has no inside and is left as the cut leaves it.
    """
    depsgraph = bpy.context.evaluated_depsgraph_get()
    crossings = []
    try:
        for obj in subjects():
            own = world_bounds([obj]) if obj.type in SHAPE_TYPES else None
            if own is None or not own[0].z < level < own[1].z:
                continue
            part = bmesh.new()
            try:
                add_part(part, obj, depsgraph)
                # The material most of its surface has is the one it is filled with.
                covered = {}
                for face in part.faces:
                    covered[face.material_index] = covered.get(face.material_index, 0) + face.calc_area()
                slot = max(covered, key=covered.get) if covered else 0
                slots = obj.material_slots
                material = slots[slot].material if slot < len(slots) else None
                cut = bmesh.ops.bisect_plane(
                    part,
                    geom=part.verts[:] + part.edges[:] + part.faces[:],
                    dist=1e-6,
                    plane_co=(0, 0, level + CUT_SLIVER),
                    plane_no=(0, 0, 1),
                    clear_inner=True,
                    clear_outer=True,
                )
                edges = [e for e in cut["geom_cut"] if isinstance(e, bmesh.types.BMEdge)]
                # Closed outlines only: no edge of the cut ends where no other begins.
                if not edges or any(len(v.link_edges) < 2 for e in edges for v in e.verts):
                    continue
                bmesh.ops.triangle_fill(part, use_beauty=True, edges=edges, normal=(0, 0, 1))
                if not part.faces:
                    continue
                crossing = bpy.data.meshes.new(PREVIEW)
                try:
                    part.to_mesh(crossing)
                except Exception:
                    bpy.data.meshes.remove(crossing)
                    raise
                crossings.append((obj, own[1].z, material, crossing))
            except Exception as error:
                # A shape that cannot be filled is still cut; the picture goes on.
                keep_error(f"The cut through {obj.name} could not be filled", error)
                continue
            finally:
                part.free()
        if not crossings:
            return [], []
        highest = max(top for _, top, _, _ in crossings)
        dark = bpy.data.materials.new(PREVIEW)
        made.append(dark)
        dark.use_nodes = True
        surface = next(n for n in dark.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        surface.inputs["Base Color"].default_value = CUT_FILL
        surface.inputs["Roughness"].default_value = 1
        surface.inputs["Specular IOR Level"].default_value = 0
        walled, lower = [], []
        for obj, top, material, crossing in crossings:
            as_walls = top >= highest - AS_HIGH
            (walled if as_walls else lower).append(obj)
            crossing.materials.append(dark if as_walls else material)
            for face in crossing.polygons:
                face.material_index = 0
            # Its own object, so the colours read from the picture can name
            # what its fill shows as the shape it was cut from.
            filled = bpy.data.objects.new(PREVIEW, crossing)
            filled[CUT_OF] = obj.name
            made.append(filled)
            filled.location.z = -UNDER_THE_CUT
            scene().collection.objects.link(filled)
        by_cover = lambda objs: [o.name for o in sorted(objs, key=footprint, reverse=True)]
        return by_cover(walled), by_cover(lower)
    finally:
        # What became a fill is removed with what was made; the rest now.
        for _, _, _, crossing in crossings:
            if not crossing.users:
                bpy.data.meshes.remove(crossing)


def plan_from_above(aside, cut=None):
    """
    Sets the scene for its plan: seen from straight above with +y up the
    picture, lit by a white background alone in the neutral tone. EEVEE lets
    that light through walls, so a floor shows the colour it was given however
    high the walls round it are.

    The plan is cut at a height, as a drawn one is: nothing above it is drawn,
    so a ceiling does not hide the rooms and a door shows as a gap in its
    wall, and what it passes through is filled where it is cut. Returns what
    was made for the picture, to remove once it is written, the height of the
    cut when it takes anything away, the names of what stands above it, and
    the names of what it fills dark and of what it fills in its own colour.
    """
    s = scene()
    aside.hide([o for o in s.objects if o.type == "LIGHT" or o.get("zhiyin_preset")])
    need(subjects(), "There is nothing to show in a plan.")
    world = bpy.data.worlds.new(PREVIEW)
    world.use_nodes = True
    tree = world.node_tree
    for node in list(tree.nodes):
        tree.nodes.remove(node)
    light = tree.nodes.new("ShaderNodeBackground")
    light.inputs["Color"].default_value = (1, 1, 1, 1)
    light.inputs["Strength"].default_value = 1
    tree.links.new(light.outputs["Background"], tree.nodes.new("ShaderNodeOutputWorld").inputs["Surface"])
    data = bpy.data.cameras.new(PREVIEW)
    data.type = "ORTHO"
    camera = bpy.data.objects.new(PREVIEW, data)
    s.collection.objects.link(camera)
    made = [camera, world]
    try:
        aside.set(s, "world", world)
        aside.set(s, "camera", camera)
        settings = s.view_settings
        for name, value in (("view_transform", TONES["neutral"]), ("look", "None"), ("exposure", 0), ("gamma", 1)):
            aside.set(settings, name, value)
        way, ahead = heading(DIRECTIONS["top"], None)
        frame(camera, subjects(), way, PLAN_MARGIN, s.render.resolution_x / s.render.resolution_y, ahead)
        low, high = world_bounds(subjects())
        level = (0 if low.z <= 0 <= high.z else low.z) + PLAN_CUT if cut is None else cut
        if level >= high.z:
            return made, None, [], ([], [])
        # The camera sees nothing nearer than the cut.
        data.clip_start = max(camera.location.z - level - CUT_SLIVER, 1e-4)
        standing = [o for o in subjects() if (world_bounds([o]) or (low, high))[0].z >= level]
        above = [o.name for o in sorted(standing, key=footprint, reverse=True)]
        # Left out whole: what starts at the very height of the cut would
        # otherwise show its underside's inner face.
        aside.hide(standing)
        through = filled_cut(level, made)
    except Exception:
        aside.restore()
        discard(made)
        raise
    return made, level, above, through


def discard(made):
    """Removes the camera, the background and the filled cut a plan was drawn with."""
    for thing in made:
        if isinstance(thing, bpy.types.World):
            bpy.data.worlds.remove(thing)
        elif isinstance(thing, bpy.types.Material):
            bpy.data.materials.remove(thing)
        else:
            data = thing.data
            bpy.data.objects.remove(thing)
            if isinstance(data, bpy.types.Camera):
                bpy.data.cameras.remove(data)
            else:
                bpy.data.meshes.remove(data)


def lying_over(targets):
    """The objects that cover most of a plan from high up, as a ceiling or a roof does."""
    whole_plan = world_bounds(targets)
    if whole_plan is None or len(targets) < 2:
        return []
    low, high = whole_plan
    plan_area = (high.x - low.x) * (high.y - low.y)
    found = []
    for obj in targets:
        own = world_bounds([obj])
        if own is None or plan_area <= 0:
            continue
        covered = (own[1].x - own[0].x) * (own[1].y - own[0].y)
        if covered >= OVER_THE_REST * plan_area and own[0].z > (low.z + high.z) / 2:
            found.append(obj.name)
    return found


def listed(names):
    return ", ".join(names[:-1]) + (" and " if len(names) > 1 else "") + names[-1]


def cut_text(level, above, through):
    """What a plan's cut took away and filled, said so the picture is read as cut."""
    walled, lower = through
    if level is None or not (above or walled or lower):
        return ""

    def some(names):
        more = len(names) - NAMED
        return listed(names[:NAMED] + [f"{more} more"]) if more > 0 else listed(names)

    said = []
    if above:
        one = len(above) == 1
        said.append(f"{some(above)} {'stands' if one else 'stand'} above it and {'is' if one else 'are'} not drawn")
    if walled:
        one = len(walled) == 1
        said.append(f"{some(walled)}, the highest it passes through, {'is' if one else 'are'} filled dark there")
    if lower:
        one = len(lower) == 1
        said.append(
            f"{some(lower)}, which it passes through lower than {'those' if len(walled) > 1 else 'that'}, "
            f"{'is filled in its own colour' if one else 'are filled in their own colours'}"
        )
    told = "; ".join(said[:-1]) + ("; and " if len(said) > 1 else "") + said[-1]
    return f" The plan is cut at {length(level)}, as a drawn plan is: {told}. cut sets another height."


def render(args, scene_file, device):
    output = args.get("output")
    extension = os.path.splitext(output)[1].lower()
    need(extension in (".png", ".jpg", ".jpeg"), "A render is written as .png or .jpg.")
    background = args.get("background", "scene")
    need(background in ("scene", "white", "transparent"), "background is scene, white or transparent.")
    need(not (background == "transparent" and extension != ".png"), "A transparent background needs a .png file.")
    view = args.get("view", "camera")
    need(view in ("camera", "plan"), "view is camera or plan.")
    plan = view == "plan"
    need(not (plan and background != "scene"), "A plan has a white background of its own: leave background out.")
    need(not (plan and args.get("camera")), "A plan is seen from straight above, through no camera of the scene: leave camera out.")
    need(
        not (plan and args.get("engine", "eevee") != "eevee"),
        "A plan is drawn with EEVEE, whose light from the background walls do not shade: leave engine out.",
    )
    need(plan or args.get("cut") is None, "cut is a plan's: a picture through the camera shows the scene whole.")
    cut = number(args["cut"], "cut") if args.get("cut") is not None else None
    engine = "eevee" if plan else args.get("engine", "cycles")
    need(engine in ("cycles", "eevee"), "engine is cycles or eevee.")
    need(
        not (background == "white" and engine != "cycles"),
        "A white background with the product's shadow renders with Cycles: use engine cycles.",
    )
    left_out = [find_object(name) for name in args.get("without") or []]
    s = scene()
    # A plan leaves the scene's render settings as they were; a picture
    # through the camera keeps the ones it was made with.
    kept = Kept() if plan else None
    camera_name = args.get("camera")
    if camera_name:
        s.camera = find_object(camera_name, {"CAMERA"})
    if not plan:
        need(s.camera is not None, "The scene has no camera. Set one with blender_set_camera first.")
        refocus(s.camera)
    aside = Aside()
    made = []
    level, above, through = None, [], ([], [])
    try:
        if args.get("resolution") is not None:
            width, height = vector(args["resolution"], "resolution", 2)
            need(16 <= width <= 16384 and 16 <= height <= 16384, "resolution must be between 16 and 16384 pixels each way.")
            s.render.resolution_x, s.render.resolution_y = int(width), int(height)
        s.render.resolution_percentage = 100
        if engine == "cycles":
            device.use_cycles(whole(args.get("samples"), "samples", maximum=16384, default=128))
        else:
            s.render.engine = "BLENDER_EEVEE"
            s.eevee.taa_render_samples = whole(args.get("samples"), "samples", maximum=16384, default=64)
            lifelike_eevee(s)
        s.render.film_transparent = background == "transparent"
        aside.hide([part for obj in left_out for part in (obj, *obj.children_recursive)])
        if plan:
            made, level, above, through = plan_from_above(aside, cut)
        # A see-through background leaves the backdrop out of the picture; it still
        # lights the product and shows in its reflections.
        backdrops = [o for o in s.objects if o.get("zhiyin_preset") and o.type == "MESH"] if background != "scene" else []
        started = time.time()
        put_back = deep_bounces() if engine == "cycles" else lambda: None
        try:
            if background == "white":
                on_white(output, "PNG" if extension == ".png" else "JPEG", backdrops)
            else:
                for obj in backdrops:
                    obj.visible_camera = False
                try:
                    write_picture(output, "PNG" if extension == ".png" else "JPEG", 92)
                finally:
                    for obj in backdrops:
                        obj.visible_camera = True
        finally:
            put_back()
        seconds = time.time() - started
        # What the picture shows is read as the picture was made: with what
        # it left out still left out, through the camera it was made through.
        try:
            # Metered where the light is the scene's own and drawn as it is:
            # a plan has its own, and EEVEE lets a sky through walls.
            seen = colours(output, metered=engine == "cycles" and background == "scene" and not plan)
        except Exception as error:
            keep_error("The colours in a picture could not be read", error)
            seen = "The colours in the picture could not be read."
        size = f"{s.render.resolution_x}×{s.render.resolution_y}"
        tone = tone_text()
        # What stands above the cut is not in the picture to lie over the rest.
        over = lying_over([o for o in subjects() if o.name not in above]) if plan else []
        across = made[0].data.ortho_scale if plan else 0
    finally:
        aside.restore()
        discard(made)
        if kept is not None:
            kept.restore()
    if args.get("picture"):
        reduced_copy(output, args["picture"])
    where = device.said() if engine == "cycles" else "EEVEE"
    left = [o.name for o in left_out] + (["the lights"] if plan else [])
    one = len(over) == 1
    return (
        f"Rendered {os.path.basename(output)}, {size}, "
        + (f"the plan from above with +y up the picture, {length(across)} across, " if plan else "")
        + f"with {'Cycles on ' + where if engine == 'cycles' else 'EEVEE'} in {seconds:.1f} s, {tone}"
        + (f", without {listed(left)}" if left else "")
        + "."
        + cut_text(level, above, through)
        + (PLAN_KEEPS if plan else "" if engine == "cycles" else f" {DRAFT}")
        + (
            f" {listed(over)} {'lies' if one else 'lie'} over the rest and {'hides' if one else 'hide'} it from above: "
            f"name {'it' if one else 'them'} in without to leave {'it' if one else 'them'} out of the plan."
            if over
            else ""
        )
        + (f"\n{seen}" if seen else "")
    )


def on_white(output, file_format, backdrops):
    """
    The picture on exact white, as marketplaces ask of a main picture. The
    product is rendered without the backdrop behind it, which glass shows as
    plain white. Its shadow is how much darker the backdrop's floor is with
    the product than without it: two quick pictures of the floor alone, lit
    only straight from the lights and drawn the same way, so they differ only
    where the product stands between the floor and a light.
    """
    s = scene()
    folder = tempfile.mkdtemp(prefix="zhiyin-white-")
    product, shaded, bare = (os.path.join(folder, name) for name in ("product.png", "shaded.png", "bare.png"))
    products = [o for o in subjects() if o.type not in ("CAMERA", "LIGHT", "LIGHT_PROBE")] if backdrops else []
    seen = [(o, o.visible_camera) for o in products + backdrops]
    materials = {m for o in backdrops for m in o.data.materials if m is not None and m.use_nodes}
    samples, bounces = s.cycles.samples, s.cycles.max_bounces
    put_back = []
    try:
        s.render.film_transparent = True
        for obj in backdrops:
            obj.visible_camera = False
        put_back = [seen_as_white(m) for m in materials]
        write_picture(product, "PNG")
        for back in put_back:
            back()
        put_back = []
        if backdrops:
            s.render.film_transparent = False
            s.cycles.samples = min(samples, SHADOW_SAMPLES)
            s.cycles.max_bounces = 0
            for obj in backdrops:
                obj.visible_camera = True
            for obj in products:
                obj.visible_camera = False
            put_back = [floor_only(backdrops)]
            write_picture(shaded, "PNG")
            for obj in products:
                obj.hide_render = True
            write_picture(bare, "PNG")
        lay_on_white(product, (shaded, bare) if backdrops else None, output, file_format)
    finally:
        for back in put_back:
            back()
        for obj, was in seen:
            obj.visible_camera = was
        for obj in products:
            obj.hide_render = False
        s.cycles.samples, s.cycles.max_bounces = samples, bounces
        s.render.film_transparent = False
        shutil.rmtree(folder, ignore_errors=True)


def lay_on_white(product, shadow, output, file_format):
    """
    Lays a picture with a see-through background over exact white, darkened
    where the backdrop is darker with the product than without it.
    """
    image = bpy.data.images.load(product, check_existing=False)
    try:
        width, height = image.size
        pixels = numpy.empty(width * height * 4, dtype=numpy.float32)
        image.pixels.foreach_get(pixels)
        rgba = pixels.reshape(-1, 4)
        alpha = rgba[:, 3:4].copy()
        light = numpy.ones_like(alpha)
        if shadow is not None:
            shaded, bare = (brightness(path) for path in shadow)
            light = numpy.clip(shaded / numpy.maximum(bare, 1e-4), 0, 1)
            # Differences too faint to see are the two pictures' own grain.
            light[light > UNSHADED] = 1
        rgba[:, :3] = numpy.minimum(rgba[:, :3] * alpha + light * (1 - alpha), 1)
        rgba[:, 3] = 1
        image.pixels.foreach_set(pixels)
        image.file_format = file_format
        image.save(filepath=output, quality=92)
    finally:
        bpy.data.images.remove(image)


def brightness(path):
    image = bpy.data.images.load(path, check_existing=False)
    try:
        pixels = numpy.empty(len(image.pixels), dtype=numpy.float32)
        image.pixels.foreach_get(pixels)
        return pixels.reshape(-1, 4)[:, :3].mean(axis=1, keepdims=True)
    finally:
        bpy.data.images.remove(image)


def reduced_copy(source, target, longest=1280):
    """A smaller JPEG of a render, for a model that can look at it."""
    image = bpy.data.images.load(source, check_existing=False)
    try:
        width, height = image.size
        scale = min(1.0, longest / max(width, height, 1))
        if scale < 1:
            image.scale(max(1, round(width * scale)), max(1, round(height * scale)))
        image.file_format = "JPEG"
        image.save(filepath=target, quality=85)
    finally:
        bpy.data.images.remove(image)


def chosen(names):
    if names:
        return [find_object(n) for n in names]
    return [o for o in scene().objects if not is_helper(o) and not o.hide_render and o.type not in ("CAMERA", "LIGHT") and o.name != "Backdrop"]


def export(args, scene_file):
    output = args.get("output")
    extension = os.path.splitext(output)[1].lower()
    need(extension in EXPORTS, f"A model is exported as one of {', '.join(EXPORTS)}.")
    objects = chosen(args.get("objects"))
    need(objects, "There is nothing to export.")
    chosen_parts = [part for obj in objects for part in [obj, *obj.children_recursive]]
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
            bpy.ops.export_scene.gltf(filepath=output, export_format="GLB", use_selection=True, export_apply=True)
        elif extension == ".stl":
            # Printers read STL in millimetres.
            bpy.ops.wm.stl_export(filepath=output, export_selected_objects=True, apply_modifiers=True, global_scale=1000)
        elif extension == ".obj":
            bpy.ops.wm.obj_export(filepath=output, export_selected_objects=True, apply_modifiers=True, export_materials=False)
        elif extension == ".ply":
            bpy.ops.wm.ply_export(filepath=output, export_selected_objects=True, apply_modifiers=True)
        elif extension == ".fbx":
            bpy.ops.export_scene.fbx(filepath=output, use_selection=True)
        else:
            bpy.ops.wm.usd_export(filepath=output, selected_objects_only=True, export_textures_mode="KEEP", convert_world_material=False)
    finally:
        for part, in_view_layer, in_viewport, in_render in hidden:
            part.hide_render = in_render
            part.hide_viewport = in_viewport
            part.hide_set(in_view_layer)
    need(os.path.exists(output), f"Blender did not write {os.path.basename(output)}.")
    units = " in millimetres" if extension == ".stl" else ""
    return f"Exported {', '.join(o.name for o in objects)} to {os.path.basename(output)}{units}."


# ---- previews -------------------------------------------------------------------------------


class Kept:
    """Render settings a preview changes, put back exactly afterwards."""

    FIELDS = (
        ("render", "engine"),
        ("render", "resolution_x"),
        ("render", "resolution_y"),
        ("render", "resolution_percentage"),
        ("render", "filepath"),
        ("render", "film_transparent"),
        ("eevee", "taa_render_samples"),
        ("eevee", "use_raytracing"),
        ("eevee", "use_fast_gi"),
        ("cycles", "samples"),
        ("cycles", "device"),
        ("cycles", "use_denoising"),
        ("cycles", "time_limit"),
        ("cycles", "max_bounces"),
        ("cycles", "glossy_bounces"),
        ("cycles", "transmission_bounces"),
        ("cycles", "transparent_max_bounces"),
    )

    def __init__(self):
        s = scene()
        self.values = [(owner, field, getattr(getattr(s, owner), field)) for owner, field in self.FIELDS]
        settings = s.render.image_settings
        self.picture = (settings.file_format, settings.color_mode, settings.quality)
        shading = s.display.shading
        self.shading = (shading.light, shading.color_type)
        self.camera = s.camera

    def restore(self):
        s = scene()
        for owner, field, value in self.values:
            setattr(getattr(s, owner), field, value)
        settings = s.render.image_settings
        settings.file_format, settings.color_mode, settings.quality = self.picture
        s.display.shading.light, s.display.shading.color_type = self.shading
        s.camera = self.camera


def overview_camera(view, aspect):
    data = bpy.data.cameras.new(PREVIEW)
    data.lens = 50
    camera = bpy.data.objects.new(PREVIEW, data)
    scene().collection.objects.link(camera)
    bpy.context.view_layer.update()
    corners = world_corners(subjects()) or [mathutils.Vector((-1, -1, 0)), mathutils.Vector((1, 1, 1))]
    yaw = math.radians(-45 + number(view.get("yaw"), "yaw", default=0))
    pitch = math.radians(max(-85, min(85, 25 + number(view.get("pitch"), "pitch", default=0))))
    zoom = number(view.get("zoom"), "zoom", minimum=0.05, maximum=20, default=1)
    direction = mathutils.Vector((math.cos(pitch) * math.cos(yaw), math.cos(pitch) * math.sin(yaw), math.sin(pitch)))
    centre = place_to_fit(camera, direction, corners, aspect, 0.08)
    camera.location = centre + (camera.location - centre) / zoom
    return camera


def preview_light():
    """A soft light for the overview of a scene that has none of its own."""
    data = bpy.data.lights.new(PREVIEW, "SUN")
    data.energy = 2.5
    data.angle = math.radians(30)
    obj = bpy.data.objects.new(PREVIEW + " light", data)
    scene().collection.objects.link(obj)
    obj.rotation_euler = (math.radians(50), 0, math.radians(30))
    return obj


def surface_colours():
    """
    Gives each material, for the moment, the colour its surface is set to as
    the colour a solid drawing uses, and returns what to put back. Light goes
    through glass, so a solid drawing shows it partly see-through: clear glass
    mostly, a coloured liquid less, so its colour still shows.
    """
    kept = []
    for material in bpy.data.materials:
        nodes = material.node_tree.nodes if material.use_nodes and material.node_tree else []
        surface = next((n for n in nodes if n.type == "BSDF_PRINCIPLED"), None)
        if surface is None:
            continue
        kept.append((material, tuple(material.diffuse_color)))
        colour = surface.inputs["Base Color"].default_value
        opacity = 1
        if surface.inputs["Transmission Weight"].default_value > 0:
            brightest = max(colour[0], colour[1], colour[2])
            saturation = (brightest - min(colour[0], colour[1], colour[2])) / brightest if brightest > 0 else 0
            opacity = 0.2 + 0.6 * saturation
        material.diffuse_color = (colour[0], colour[1], colour[2], opacity)
    return kept


def under_a_roof(camera):
    """
    Whether something in the picture is straight above the camera, as a
    ceiling is above one that stands in a room.
    """
    shown = {obj.name for obj in subjects()}
    depsgraph = bpy.context.evaluated_depsgraph_get()
    up = mathutils.Vector((0, 0, 1))
    origin = camera.matrix_world.translation.copy()
    # Past what is hidden from the picture, to the first thing that is in it.
    for _ in range(16):
        hit, where, _normal, _face, obj, _matrix = scene().ray_cast(depsgraph, origin, up)
        if not hit:
            return False
        if obj.name in shown:
            return True
        origin = where + up * 1e-4
    return False


def see_through():
    """Whether anything in the picture lets light through it, as glass or a liquid does."""
    return any(lets_light_through(obj) for obj in subjects())


def deep_bounces():
    """
    With something see-through in the scene, light is followed through more
    bounces than Blender's own limits, four of them off glossy surfaces,
    which leave dark bands inside a thick bottle. Returns what puts the
    scene's own limits back.
    """
    c = scene().cycles
    names = ("max_bounces", "glossy_bounces", "transmission_bounces", "transparent_max_bounces")
    kept = [(name, getattr(c, name)) for name in names]
    if see_through():
        for name, value in kept:
            setattr(c, name, max(value, SEE_THROUGH_BOUNCES))

    def restore():
        for name, value in kept:
            setattr(c, name, value)

    return restore


def quick_surroundings(s):
    """
    What the camera sees behind the scene, as a solid drawing can show it: the
    product backdrop's white, without the backdrop itself, which a solid
    drawing shades grey, or the world's own colour. Returns what to put back.
    """
    world = s.world
    if world is None:
        return lambda: None
    backdrop = [o for o in s.objects if o.type == "MESH" and in_collection(o, LIGHTING) and not o.hide_render]
    background = next((n for n in world.node_tree.nodes if n.type == "BACKGROUND"), None) if world.use_nodes and world.node_tree else None
    if backdrop:
        colour = (1, 1, 1)
    elif background is not None and not background.inputs["Color"].is_linked:
        strength = background.inputs["Strength"].default_value
        colour = tuple(min(1, c * strength) for c in background.inputs["Color"].default_value[:3])
    else:
        colour = tuple(world.color)
    kept = tuple(world.color)
    world.color = colour
    for obj in backdrop:
        obj.hide_render = True

    def restore():
        world.color = kept
        for obj in backdrop:
            obj.hide_render = False

    return restore


def quick_picture(s, partial):
    """
    The scene as Blender's solid view draws it, at half size: a few
    milliseconds where a lit picture takes a tenth of a second or more, so the
    view keeps up while the person turns it.
    """
    s.render.engine = "BLENDER_WORKBENCH"
    s.render.resolution_percentage = 50
    s.display.shading.light = "STUDIO"
    s.display.shading.color_type = "MATERIAL"
    colours = surface_colours()
    surroundings = quick_surroundings(s)
    try:
        write_picture(partial, "JPEG", 80)
    finally:
        surroundings()
        for material, colour in colours:
            material.diffuse_color = colour


def preview(view, path, device):
    """
    Renders a picture of the scene for the 3D view, quick or full, then leaves
    the scene exactly as it was.
    """
    s = scene()
    kept = Kept()
    width = whole(view.get("width"), "preview width", minimum=64, maximum=3840, default=960)
    height = whole(view.get("height"), "preview height", minimum=64, maximum=2160, default=540)
    temporary = []
    shown = view.get("view", "overview")
    try:
        if shown == "camera" and s.camera is not None:
            used = "camera"
        else:
            temporary.append(overview_camera(view, width / height))
            s.camera = temporary[-1]
            used = "overview"
        if used == "overview" and not any(o.type == "LIGHT" and not o.hide_render for o in s.objects):
            temporary.append(preview_light())
        s.render.resolution_x, s.render.resolution_y = width, height
        s.render.resolution_percentage = 100
        s.render.film_transparent = False
        partial = path + ".part.jpg"
        if view.get("quick") is True:
            quick_picture(s, partial)
        elif device.name and (see_through() or (used == "camera" and under_a_roof(s.camera))):
            # EEVEE draws light through one layer of glass at most, so a
            # liquid in a bottle vanishes, and it lets a sky's light through
            # walls, so a room shows paler and bluer than it is lit; Cycles
            # draws both as the render will. Light through glass takes many
            # bounces, so that picture is drawn at half size; a room without
            # any is quick enough at full size.
            s.render.resolution_percentage = 50 if see_through() else 100
            device.use_cycles(16)
            s.cycles.time_limit = PREVIEW_DRAWING
            deep_bounces()
            write_picture(partial, "JPEG", 85)
        else:
            if device.eevee:
                try:
                    s.render.engine = "BLENDER_EEVEE"
                    s.eevee.taa_render_samples = 16
                    lifelike_eevee(s)
                    write_picture(partial, "JPEG", 85)
                except Exception as error:
                    keep_error("EEVEE could not draw a preview, so Cycles draws them from here on", error)
                    device.eevee = False
            if not device.eevee:
                s.render.resolution_percentage = 50
                device.use_cycles(8)
                s.cycles.time_limit = PREVIEW_DRAWING
                write_picture(partial, "JPEG", 85)
        os.replace(partial, path)
        scale = s.render.resolution_percentage / 100
        drawn = {"path": path, "width": round(width * scale), "height": round(height * scale), "view": used}
        return drawn if subjects() else {**drawn, "empty": True}
    finally:
        for obj in temporary:
            data = obj.data
            bpy.data.objects.remove(obj)
            if isinstance(data, bpy.types.Camera):
                bpy.data.cameras.remove(data)
            elif isinstance(data, bpy.types.Light):
                bpy.data.lights.remove(data)
        kept.restore()
