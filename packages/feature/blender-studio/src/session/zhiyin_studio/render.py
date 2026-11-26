"""
blender_render: a picture through a camera, or a plan seen from straight above, on the scene's
own background, on white with the product's shadow, or on none.
"""

import os
import shutil
import tempfile
import time

import bmesh
import bpy
import numpy

from .aiming import refocus
from .arguments import need, number, vector, whole
from .camera import DIRECTIONS, MARGIN, frame, heading
from .errors import keep_error
from .finding import CUT_OF, PREVIEW, find_object, find_objects, is_backdrop, scene, subjects
from .form_measures import form_lines
from .geometry import SHAPE_TYPES, add_part, world_bounds
from .lighting import floor_only, seen_as_white
from .lighting_caustics import eevee_caustics
from .pictures import Kept, deep_bounces, lifelike_eevee, saved_over, see_through, under_a_roof, write_picture
from .render_checks import CHEAP, MemoryWatch, PictureChecks, estimated, minutes_text, names_over, owners_of
from .render_eevee import check as check_eevee
from .render_eevee import final_text, is_final, set_eevee, shows_toon
from .render_noise import noise_text
from .render_passes import SAMPLES, light_file, passes_now
from .render_post import composite_after, ours, set_post
from .render_sampling import SampleWatch, limit_text, sampling_text, set_sampling
from .seen import colours
from .sim_state import reached_text
from .stylised_checks import coverage_text, toon_text
from .timeline import back_to, frame_of, go_to, moment, now
from .tone import TONES, tone_text
from .wording import length, listed

# Samples for the two pictures of the backdrop that find a product's shadow on
# white, and how close to unshaded a pixel there counts as unshaded.
SHADOW_SAMPLES = 64
UNSHADED = 0.985


def draft_text(glass):
    """Said with every EEVEE picture, so a draft is not handed over as the picture."""
    return (
        "EEVEE is a quick look at layout and framing: "
        + ("it shows glass roughly, so " if glass else "")
        + "light and colours are judged, and the picture to hand over is made, with Cycles."
    )
# Samples by engine when the call does not say, and the most it may ask.
SAMPLES_BY_ENGINE = {"cycles": 128, "eevee": 64}
MOST_SAMPLES = 16384
# Samples for a draft asked of EEVEE from inside a room, which Cycles draws
# instead: within a few levels of its colours at 128.
DRAFT_SAMPLES = 16
# Said with that draft.
ROOM_DRAFT = (
    f"Asked of EEVEE from inside a room, this draft is drawn with Cycles at {DRAFT_SAMPLES} samples: EEVEE lets a sky's light "
    "through walls and ceilings. The picture to hand over is made with Cycles at its full samples."
)


def instead_text(plan, eevee):
    """What a picture asked of EEVEE says where Cycles drew it, EEVEE being unable to draw there."""
    said = (
        f" EEVEE cannot draw on this computer, whose graphics card Blender cannot use, so this {'plan' if plan else 'picture'}"
        f" was drawn with Cycles at {DRAFT_SAMPLES} samples instead, as a draft."
    )
    if shows_toon():
        said += " Cycles draws toon materials as Toon BSDFs stepped by the angle to the light, not flat as EEVEE draws them."
    if eevee is not None:
        said += " The eevee settings given are kept in the scene, and do nothing in Cycles"
        said += "; no light probes were baked, which only EEVEE bakes." if eevee.get("probes") else "."
    return said


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
# What is behind a picture unless the call says.
BACKGROUND = "scene"


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
    called = time.time()
    output = args.get("output")
    extension = os.path.splitext(output)[1].lower()
    need(extension in (".png", ".jpg", ".jpeg"), "A render is written as .png or .jpg.")
    background = args.get("background", BACKGROUND)
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
    need(not (plan and args.get("exposure") is not None), "A plan is drawn at an exposure of its own: leave exposure out.")
    exposure = number(args["exposure"], "exposure", minimum=-10, maximum=10) if args.get("exposure") is not None else None
    engine = "eevee" if plan else args.get("engine", "cycles")
    need(engine in ("cycles", "eevee"), "engine is cycles or eevee.")
    need(not (plan and args.get("post") is not None), "A plan is drawn plain, with no post: leave post out.")
    need(args.get("eevee") is None or engine == "eevee", "eevee's options are for engine eevee.")
    need(not (plan and args.get("eevee") is not None), "A plan is drawn with EEVEE as it is: leave eevee out.")
    if args.get("eevee") is not None:
        check_eevee(args["eevee"])
    set_sampling(args.get("sampling"), engine, gpu=bool(device.name))
    need(
        not (background == "white" and engine != "cycles"),
        "A white background with the product's shadow renders with Cycles: use engine cycles.",
    )
    left_out = find_objects(args.get("without") or [])
    need(not (left_out and args.get("only")), "Name what to show in only or what to leave out in without: only or without, not both.")
    shown_only = find_objects(args.get("only") or [])
    framing = args.get("frame")
    need(framing is None or isinstance(framing, dict), "frame names what to fit and the side to look from.")
    need(not (plan and framing is not None), "A plan frames the whole scene from above: leave frame out.")
    s = scene()
    # A plan leaves the scene's render settings as they were; a picture
    # through the camera keeps the ones it was made with.
    kept = Kept() if plan else None
    # A camera named for this picture is for it alone: the scene keeps its own.
    camera_name = args.get("camera")
    scene_camera = s.camera
    if camera_name:
        s.camera = find_object(camera_name, {"CAMERA"})
    if not plan and framing is None:
        need(s.camera is not None, "The scene has no camera. Set one with blender_set_camera first.")
        refocus(s.camera)
    aside = Aside()
    # An exposure given is for this picture alone: the scene keeps its own.
    scene_exposure = s.view_settings.exposure
    made = []
    framed_on = ""
    level, above, through = None, [], ([], [])
    # A moment of the animation, when one is asked for; the scene goes back to
    # the frame it was on.
    kept_time = now()
    at = moment(args["time"], "time") if args.get("time") is not None else None
    # Where the render's passes are kept while its checks read them.
    folder = tempfile.mkdtemp(prefix="zhiyin-render-")
    try:
        if at is not None:
            go_to(at)
        if exposure is not None:
            aside.set(s.view_settings, "exposure", exposure)
        was = (s.render.resolution_x, s.render.resolution_y)
        if args.get("resolution") is not None:
            width, height = vector(args["resolution"], "resolution", 2)
            need(16 <= width <= 16384 and 16 <= height <= 16384, "resolution must be between 16 and 16384 pixels each way.")
            s.render.resolution_x, s.render.resolution_y = int(width), int(height)
        s.render.resolution_percentage = 100
        aside.hide([part for obj in left_out for part in (obj, *obj.children_recursive)])
        if shown_only:
            kept_shown = {part.name for obj in shown_only for part in (obj, *obj.children_recursive)}
            aside.hide([o for o in subjects() if o.name not in kept_shown])
        if framing is not None:
            # A copy of the camera, lens and all, framed for this picture: the
            # scene's own stays where it was.
            own = s.camera
            if own is not None:
                framed = own.copy()
                framed.data = own.data.copy()
            else:
                framed = bpy.data.objects.new(PREVIEW, bpy.data.cameras.new(PREVIEW))
            framed.name = PREVIEW
            # Placed by the framing alone, not by what the camera follows.
            framed.parent = None
            framed.constraints.clear()
            framed.animation_data_clear()
            s.collection.objects.link(framed)
            made.append(framed)
            fitted = find_objects(framing.get("objects") or []) or shown_only or subjects()
            direction = framing.get("direction", "three-quarter")
            need(direction in DIRECTIONS, f"frame direction is one of {', '.join(DIRECTIONS)}.")
            margin = number(framing.get("margin"), "frame margin", minimum=MARGIN[0], maximum=MARGIN[1], default=MARGIN[2])
            way, ahead = heading(DIRECTIONS[direction], framing.get("elevation"), framing.get("around"))
            frame(framed, fitted, way, margin, s.render.resolution_x / s.render.resolution_y, ahead)
            aside.set(s, "camera", framed)
            refocus(framed)
            framed_on = (
                f"framed on {listed([o.name for o in fitted]) if framing.get('objects') or shown_only else 'everything shown'}"
                f" from the {direction}, "
                + ("the scene's own camera staying where it was" if own is not None else "the scene still having no camera")
            )
        # From inside a room EEVEE lets a sky's light through the walls and
        # the ceiling; the draft is drawn as the room is lit, and says so. A
        # picture EEVEE makes to hand over is drawn by EEVEE, and says so.
        # Where EEVEE cannot draw, Cycles draws what was asked of it, a plan
        # too, and says so.
        instead = engine == "eevee" and not device.eevee
        final = engine == "eevee" and not plan and not instead and is_final(args.get("eevee"))
        roofed = engine == "eevee" and not plan and not instead and under_a_roof(s.camera)
        drafted = roofed and not final
        baked = ""
        if instead:
            engine = "cycles"
            device.use_cycles(DRAFT_SAMPLES, denoised=True)
            if args.get("eevee") is not None:
                # Kept in the scene for a computer that draws EEVEE; nothing is baked here.
                set_eevee({part: value for part, value in args["eevee"].items() if part != "probes"})
        elif drafted:
            engine = "cycles"
            device.use_cycles(DRAFT_SAMPLES, denoised=True)
        elif engine == "cycles":
            device.use_cycles(whole(args.get("samples"), "samples", maximum=MOST_SAMPLES, default=SAMPLES_BY_ENGINE["cycles"]))
            # How many samples each pixel took, read from the render's own pass.
            aside.set(bpy.context.view_layer.cycles, "pass_debug_sample_count", True)
        else:
            s.render.engine = "BLENDER_EEVEE"
            s.eevee.taa_render_samples = whole(args.get("samples"), "samples", maximum=MOST_SAMPLES, default=SAMPLES_BY_ENGINE["eevee"])
            lifelike_eevee(s)
            if not plan:
                baked = set_eevee(args.get("eevee"))
        posted = set_post(args["post"]) if args.get("post") is not None else ""
        s.render.film_transparent = background == "transparent"
        if plan:
            made, level, above, through = plan_from_above(aside, cut)
            # A plan is drawn plain, whatever post the scene keeps.
            aside.set(s.render, "use_compositing", False)
        # A see-through background leaves the backdrop out of the picture; it still
        # lights the product and shows in its reflections.
        backdrops = [o for o in s.objects if is_backdrop(o)] if background != "scene" else []
        put_back = deep_bounces() if engine == "cycles" else lambda: None
        watch = MemoryWatch()
        reached = SampleWatch()
        try:
            # A large picture is timed from two small ones first, and refused when it would not finish.
            ahead = (
                estimated(args.get("limit_seconds"), s.cycles.samples, called, noise=args.get("noise") is True)
                if engine == "cycles" and not drafted
                else None
            )
            started = time.time()
            with watch, reached:
                passes, glares = drawn(output, extension, background, backdrops, folder)
            seconds = time.time() - started
        finally:
            put_back()
        # The light of the picture is read before the drawings that tell the colours take its place.
        checked = not plan and background != "white"
        try:
            lit = light_file(passes, os.path.join(folder, "light.exr")) if checked else None
            checks = PictureChecks(output, background == "transparent", lit) if checked else None
        except Exception as error:
            keep_error("The light of a picture could not be read", error)
            lit, checks = None, None
        owners = {}
        # What the picture shows is read as the picture was made: with what
        # it left out still left out, through the camera it was made through.
        try:
            # Metered where the light is the scene's own and drawn as it is:
            # a plan has its own, and EEVEE lets a sky through walls.
            seen = colours(output, metered=engine == "cycles" and background == "scene" and not plan, owners=owners, light=lit)
        except Exception as error:
            keep_error("The colours in a picture could not be read", error)
            seen = "The colours in the picture could not be read."
        light = checks.text(owners) if checks is not None else ""
        if checked:
            styled = [line for line in (coverage_text(owners, output), toon_text(owners)) if line]
            light = "\n".join([*([light] if light else []), *styled])
        noise = args.get("noise")
        if checked and engine == "cycles" and not drafted and (noise is True or (noise is None and seconds <= CHEAP)):
            put_back = deep_bounces()
            try:
                clamped = isinstance(args.get("sampling"), dict) and args["sampling"].get("clamp") is not None
                light += ("\n" if light else "") + noise_text(owners, s.cycles.samples, clamp_asked=clamped)
            finally:
                put_back()
        size = f"{s.render.resolution_x}×{s.render.resolution_y}"
        resized = not plan and (s.render.resolution_x, s.render.resolution_y) != was
        tone = tone_text()
        # What stands above the cut is not in the picture to lie over the rest.
        over = lying_over([o for o in subjects() if o.name not in above]) if plan else []
        across = made[0].data.ortho_scale if plan else 0
        unlit = not plan and not any(o.type == "LIGHT" and not o.hide_render for o in s.objects) and not sun_in_sky()
        glass = see_through()
        counts = passes.get(SAMPLES)
        at_limit = limit_text(counts[..., 0] if counts is not None else None, lambda mask: names_over(mask, *owners_of(owners)))
        sampled = sampling_text(reached, seconds, at_limit) if engine == "cycles" and not drafted else ""
        missed = eevee_misses() if engine == "eevee" and not plan else ""
        eevee_said = (final_text(roofed) if final else f" {draft_text(glass)}") + baked if engine == "eevee" and not plan else ""
        if glares:
            posted += (" " if posted else "") + "Measured from this picture's light: " + "; ".join(glares) + "."
        elif ours() and background == "white":
            posted += (" " if posted else "") + "The post is not laid over a picture on white, which stays exact white."
    finally:
        shutil.rmtree(folder, ignore_errors=True)
        aside.restore()
        discard(made)
        if kept is not None:
            kept.restore()
        if at is not None:
            back_to(kept_time)
        if camera_name:
            s.camera = scene_camera
    if args.get("picture"):
        reduced_copy(output, args["picture"])
    where = device.said() if engine == "cycles" else "EEVEE"
    # How far what the picture shows is from a block-out, read however a model checks its work.
    formed = form_lines([o for o in subjects() if o not in left_out and (not shown_only or o in shown_only)])
    left = [o.name for o in left_out] + (["the lights"] if plan else [])
    one = len(over) == 1
    return (
        f"Rendered {os.path.basename(output)}, {size}, "
        + (
            f"through {camera_name}, the scene's own camera staying {scene_camera.name if scene_camera else 'none'}, "
            if camera_name and (scene_camera is None or scene_camera.name != camera_name)
            else ""
        )
        + (f"at {at:g} s of the animation, " if at is not None else "")
        + (f"the plan from above with +y up the picture, {length(across)} across, " if plan else "")
        + f"with {'Cycles on ' + where if engine == 'cycles' else 'EEVEE'} in {seconds:.1f} s, {tone}"
        + (
            f", the scene's own exposure staying {scene_exposure:+g}"
            if exposure is not None and abs(exposure - scene_exposure) > 1e-6
            else ""
        )
        + (f", without {listed(left)}" if left else "")
        + (f", only {listed([o.name for o in shown_only])}, the rest left out" if shown_only else "")
        + (f", {framed_on}" if framed_on else "")
        + "."
        + (f" The scene's picture size is now {size}, from {was[0]}×{was[1]}, and stays for later pictures through its camera." if resized else "")
        + (f" Estimated beforehand at {minutes_text(ahead)}." if ahead is not None else "")
        + watch.text()
        + (" The scene has no lights: only its background lights it." if unlit else "")
        + cut_text(level, above, through)
        + (instead_text(plan, args.get("eevee")) if instead else "")
        + (PLAN_KEEPS if plan else f" {ROOM_DRAFT}" if drafted else "" if engine == "cycles" else eevee_said)
        + (device.guiding_text() if engine == "cycles" else "")
        + (
            f" {listed(over)} {'lies' if one else 'lie'} over the rest and {'hides' if one else 'hide'} it from above: "
            f"name {'it' if one else 'them'} in without to leave {'it' if one else 'them'} out of the plan."
            if over
            else ""
        )
        + missed
        + (f"\n{posted}" if posted else "")
        + (f"\n{sampled}" if sampled else "")
        + (f"\n{seen}" if seen else "")
        + (f"\n{light}" if light else "")
        + (f"\n{reached_text(frame_of(at), frame_of(at))}" if at is not None and reached_text(frame_of(at), frame_of(at)) else "")
        + "".join(f"\n{line}" for line in formed)
    )


def eevee_misses():
    """What the scene asks for that an EEVEE picture leaves out: caustics, and what only rays other than the camera's see."""
    unseen = [
        o.name
        for o in scene().objects
        if o.type == "MESH"
        and not o.hide_render
        and not o.visible_camera
        and (o.visible_diffuse or o.visible_glossy or o.visible_transmission)
    ]
    said = eevee_caustics()
    if unseen:
        one = len(unseen) == 1
        said += (
            f" EEVEE leaves out what its camera does not see: {listed(unseen)} {'plays its' if one else 'play their'} part"
            " in reflections and light only in Cycles."
        )
    return said


def sun_in_sky():
    """Whether the scene's background is a sky with its sun up, which lights the scene as a sun lamp does."""
    world = scene().world
    if world is None or not world.use_nodes:
        return False
    return any(
        n.type == "TEX_SKY" and n.sun_disc and n.sun_elevation > 0 and n.sun_intensity > 0 for n in world.node_tree.nodes
    )


def drawn(output, extension, background, backdrops, folder):
    """
    Writes the picture: on exact white, with no compositor, which would
    change its white; or on the scene's own background or none, the backdrop
    then left out. A picture with the post set here is drawn raw and then
    composited from its light. Returns the passes of its render, read before
    anything else renders, and what the post said of its glares, or None.
    """
    file_format = "PNG" if extension == ".png" else "JPEG"
    s = scene()
    composited = s.render.use_compositing
    if background == "white":
        s.render.use_compositing = False
        try:
            on_white(output, file_format, backdrops)
        finally:
            s.render.use_compositing = composited
        return {}, None
    post = ours()

    def write():
        write_picture(output, file_format, 92)

    for obj in backdrops:
        obj.visible_camera = False
    try:
        s.render.use_compositing = composited and not post
        write()
        passes = passes_now(folder)
        glares = None
        if post:
            s.render.use_compositing = True
            glares = composite_after(passes, folder, write, background == "transparent")
            if glares is None:
                # No light to composite from: drawn again through the compositor as it is.
                write()
    finally:
        s.render.use_compositing = composited
        for obj in backdrops:
            obj.visible_camera = True
    return passes, glares


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
        saved_over(output, lambda where: image.save(filepath=where, quality=92))
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
