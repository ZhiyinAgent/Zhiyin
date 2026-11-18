"""The scene in words, for a model that cannot see the preview, and Blender's
own answers about its API, which are exact for the installed version."""

import math

import bpy
import mathutils
import mathutils.bvhtree
import numpy

from . import budget
from .aiming import lens_shift
from .animate import describe_motion
from .arguments import need
from .finding import CUTTERS, find_objects, in_collection, scene, subjects
from .form_measures import form_lines
from .geometry import (
    bounds_of,
    copies_of,
    copies_text,
    flat_axis,
    has_shape,
    heights_text,
    held_still,
    hull_points,
    own_points,
    own_size,
    sampled,
    shapes_mesh,
    world_mesh,
)
from .lighting_words import light_facts
from .loose import Checker
from .material_marks import finish_of, marks_said, wood_of
from .material_values import GIVEN
from .material_values import kept_values as given_values
from .material_values import said as given_said
from .mesh_checks import edge_marks_text
from .model_shapes import surface_names
from .overlap_budget import Overlapping
from .overlaps import into_text
from .scales import wrap_text
from .scene_budget import budget_text
from .shading_graph import graph_text, is_library
from .shown_mesh import held_by, shells
from .sim_state import scene_text
from .soundness import Sound, ends_text, mesh_of
from .support import standing, standing_text
from .texel_density import texel_text
from .tone import tone_text
from .wording import hex_of, length, point_text, size_text, turned_text, volume_text

# The most a description spends finding pieces that nothing holds, and holes and crossing faces.
LOOSE_SECONDS = 10
SOUND_SECONDS = 10
# The most a description spends finding what goes into what.
OVERLAP_SECONDS = 20


def mesh_facts(obj):
    """Whether the evaluated mesh is closed, its volume when it is, and the marks its own edges carry."""
    bm = mesh_of(obj)
    try:
        closed = bool(bm.edges) and all(e.is_manifold for e in bm.edges)
        smooth = sum(1 for f in bm.faces if f.smooth)
        shading = "smooth-shaded" if smooth == len(bm.faces) else "flat-shaded" if not smooth else "partly smooth-shaded"
        facts = f"{len(bm.faces)} faces, {shading}, {'closed' if closed else 'open'}"
        if closed:
            facts += f", {volume_text(bm.calc_volume(signed=False))}"
    finally:
        bm.free()
    marks = edge_marks_text(obj)
    if marks:
        facts += f", {marks}"
    return facts


def material_facts(material):
    """A material as set_material sets it, so a later call can change one thing and keep the rest."""
    if not material.use_nodes:
        return material.name
    shader = material.node_tree.nodes.get("Principled BSDF")
    if shader is None:
        return graph_text(material)
    inputs = shader.inputs
    said = []
    base = inputs["Base Color"]
    grain = wood_of(material)
    look, wear, grime = finish_of(material)
    picture = next((n for n in material.node_tree.nodes if n.type == "TEX_IMAGE" and n.image), None) if base.is_linked else None
    if picture is not None:
        said.append(f"picture {bpy.path.basename(picture.image.filepath)}")
    elif base.is_linked and not (grain or look or wear or grime or marks_said(material)):
        said.append("colour from nodes")
    else:
        # Wood, a finish, wear and grime are drawn in the colour given.
        said.append(hex_of(base.default_value))
    said.append(f"roughness {inputs['Roughness'].default_value:.3g}")
    if grain:
        said.append(f"wood grain {grain:.3g}")
    if look:
        said.append(f"{look} finish")
    if wear:
        said.append(f"wear {wear:.3g}")
    if grime:
        said.append(f"grime {grime:.3g}")
    said += marks_said(material)
    if inputs["Metallic"].default_value > 0:
        said.append(f"metallic {inputs['Metallic'].default_value:.3g}")
    if abs(inputs["Specular IOR Level"].default_value - 0.5) > 1e-6:
        said.append(f"specular {inputs['Specular IOR Level'].default_value:.3g}")
    if inputs["Coat Weight"].default_value > 0:
        said.append(f"coat {inputs['Coat Weight'].default_value:.3g}")
        if abs(inputs["Coat Roughness"].default_value - 0.03) > 1e-6:
            said.append(f"coat roughness {inputs['Coat Roughness'].default_value:.3g}")
        if not inputs["Coat Tint"].is_linked and tuple(inputs["Coat Tint"].default_value)[:3] != (1.0, 1.0, 1.0):
            said.append(f"coat tint {hex_of(inputs['Coat Tint'].default_value)}")
        if abs(inputs["Coat IOR"].default_value - 1.5) > 1e-6:
            said.append(f"coat ior {inputs['Coat IOR'].default_value:.3g}")
    if not inputs["Specular Tint"].is_linked and tuple(inputs["Specular Tint"].default_value)[:3] != (1.0, 1.0, 1.0):
        said.append(f"specular tint {hex_of(inputs['Specular Tint'].default_value)}")
    if inputs["Diffuse Roughness"].default_value > 0:
        said.append(f"diffuse roughness {inputs['Diffuse Roughness'].default_value:.3g}")
    if shader.distribution == "GGX":
        said.append("GGX reflections")
    given = given_values(material)
    for key in ("subsurface", "tint", "height", "maps"):
        if isinstance(given.get(key), dict):
            said.append(f"{key} {given_said(key, given[key], given)}")
    if inputs["Transmission Weight"].default_value > 0:
        said.append(f"transmission {inputs['Transmission Weight'].default_value:.3g}, ior {inputs['IOR'].default_value:.3g}")
    if inputs["Alpha"].default_value < 1:
        said.append(f"opacity {inputs['Alpha'].default_value:.3g}")
    if inputs["Emission Strength"].default_value > 0:
        glow = "with its picture" if inputs["Emission Color"].is_linked else hex_of(inputs["Emission Color"].default_value)
        said.append(f"glowing {glow} at {inputs['Emission Strength'].default_value:.3g}")
    # A finish's own relief is the finish; surface detail is a normal map's.
    normals = [n for n in material.node_tree.nodes if n.type == "NORMAL_MAP"]
    if normals:
        said.append("surface detail, read as DirectX" if any(n.convention == "DIRECTX" for n in normals) else "surface detail")
    if "zhiyin_reflections" in material:
        said.append(f"{material['zhiyin_reflections']:.0%} as bright in reflections")
    return f"{material.name} ({', '.join(said)})"


def built_by_script(material):
    """Whether a material's nodes were built by a script, with the library or with bpy, rather than set by set_material."""
    # The product backdrop the lighting lays is said by its own values, its brightness in reflections among them.
    if not material.use_nodes or material.node_tree is None or "zhiyin_reflections" in material:
        return False
    nodes = material.node_tree.nodes
    if any(is_library(n) for n in nodes):
        return True
    return GIVEN not in material and any(n.type not in ("BSDF_PRINCIPLED", "OUTPUT_MATERIAL", "FRAME") for n in nodes)


def scene_material_facts(material):
    """A material as the scene's description gives it: a script's graph by what feeds each input, others as set_material sets them."""
    return graph_text(material) if built_by_script(material) else material_facts(material)


def step_facts(modifier):
    """
    An editing step with the values it was given, so it can be changed
    knowingly, its lengths as they are in the scene: through the object's
    scale, which stretches them with it.
    """
    scale = modifier.id_data.matrix_world.to_scale()
    reach = [abs(s) for s in scale]

    def across(value):
        low, high = value * min(reach), value * max(reach)
        return length(low) if high - low <= 1e-6 * max(high, 1e-12) else f"{length(low)} to {length(high)}, stretched"

    if modifier.type == "BEVEL":
        width = f"{modifier.width_pct:g}%" if modifier.offset_type == "PERCENT" else across(modifier.width)
        return f"{modifier.name} ({width}, {modifier.segments} segments)"
    if modifier.type == "BOOLEAN":
        other = modifier.object.name if modifier.object else "nothing"
        return f"{modifier.name} ({modifier.operation.lower()} with {other})"
    if modifier.type == "ARRAY":
        offset = [modifier.constant_offset_displace[i] * scale[i] for i in range(3)]
        return f"{modifier.name} ({modifier.count} copies, {point_text(offset)} apart)"
    if modifier.type == "MIRROR":
        axes = [a for a, used in zip("xyz", modifier.use_axis) if used]
        across = f" around {modifier.mirror_object.name}" if modifier.mirror_object else ""
        return f"{modifier.name} (across {', '.join(axes)}{across})"
    if modifier.type == "SOLIDIFY":
        owner = modifier.id_data
        axis = flat_axis(owner.data) if owner.type == "MESH" else None
        # A flat sheet's walls are its thickness, across its flat side alone.
        walls = across(modifier.thickness) if axis is None else length(modifier.thickness * reach[axis])
        return f"{modifier.name} (walls {walls})"
    if modifier.type == "SUBSURF":
        return f"{modifier.name} ({modifier.levels} levels)"
    return modifier.name


# How far past the picture's edge a point may lie and still count as in it: a
# fifth of a pixel at 2000 pixels, which is rounding, not a cut.
EDGE = 1e-4


def picture_volume(camera):
    """The space the camera sees, between its clipping distances, as a closed shape in world space."""
    data = camera.data
    frame = data.view_frame(scene=scene())
    depth = -frame[0].z
    near, far = data.clip_start, data.clip_end
    if data.type == "ORTHO":
        corners = [mathutils.Vector((c.x, c.y, -d)) for d in (near, far) for c in frame]
    else:
        corners = [c * (d / depth) for d in (near, far) for c in frame]
    world = [camera.matrix_world @ c for c in corners]
    sides = [(0, 1, 2, 3), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    return mathutils.bvhtree.BVHTree.FromPolygons(world, sides)


def in_view(camera, points):
    """For each point, whether it is in the picture: within its edges and between the clipping distances."""
    data = camera.data
    frame = data.view_frame(scene=scene())
    left, right, bottom, top = frame[2].x, frame[1].x, frame[1].y, frame[0].y
    depth = -frame[0].z
    to_camera = numpy.array(camera.matrix_world.normalized().inverted())
    local = numpy.array([tuple(p) for p in points]) @ to_camera[:3, :3].T + to_camera[:3, 3]
    ahead = -local[:, 2]
    with numpy.errstate(divide="ignore", invalid="ignore"):
        scale = 1.0 if data.type == "ORTHO" else depth / numpy.where(ahead > 0, ahead, numpy.nan)
        x = (local[:, 0] * scale - left) / (right - left)
        y = (local[:, 1] * scale - bottom) / (top - bottom)
    within = (x >= -EDGE) & (x <= 1 + EDGE) & (y >= -EDGE) & (y <= 1 + EDGE)
    return within & (ahead >= data.clip_start) & (ahead <= data.clip_end)


def ancestors(obj):
    parent = obj.parent
    while parent is not None:
        yield parent
        parent = parent.parent


def in_picture(camera, objects):
    """
    Which objects the camera shows whole, which it cuts off, and which it
    misses, by their shapes: a shape is whole when every corner of its hull is
    in the picture, and cut off when part of it is, even with every corner
    outside, as a floor wider than the picture is. A part is told with the
    object it belongs to. A shape others cover at every point of it in the
    picture is hidden behind them, and a camera inside a closed shape says so.
    """
    listed = set(objects)
    objects = [o for o in objects if not any(a in listed for a in ancestors(o))]
    volume = picture_volume(camera)
    eye = camera.matrix_world.translation.copy()
    whole, cut, missed, around = [], [], [], []
    verts, faces, owners, looked = [], [], [], {}
    for obj in objects:
        shape = world_mesh(obj)
        try:
            if not shape.verts:
                continue
            surface = mathutils.bvhtree.BVHTree.FromBMesh(shape)
            if held_by(shells(shape), eye):
                around.append(obj.name)
            step = max(1, len(shape.faces) // 200)
            samples = sampled(shape.verts, 200) + [f.calc_center_median() for f in list(shape.faces)[::step]]
            looked[obj] = [p for p, seen in zip(samples, in_view(camera, samples)) if seen]
            shape.verts.index_update()
            start = len(verts)
            verts += [v.co.copy() for v in shape.verts]
            faces += [[start + v.index for v in f.verts] for f in shape.faces]
            owners += [obj] * len(shape.faces)
            # Last: finding the hull adds its faces to the mesh.
            inside = in_view(camera, hull_points(shape))
        finally:
            shape.free()
        if inside.all():
            whole.append(obj)
        elif inside.any() or surface.overlap(volume):
            cut.append(obj)
        else:
            missed.append(obj)
    everything = mathutils.bvhtree.BVHTree.FromPolygons(verts, faces) if faces else None
    showing = first_seen(camera, everything, owners)
    hidden = {}
    for obj in whole + cut:
        if obj in showing:
            continue
        covering = covered_by(camera, everything, owners, obj, looked[obj])
        if covering:
            hidden[obj] = covering
    said = []
    if around:
        said.append(f"is inside {', '.join(around)}")
    if shown := [o.name for o in whole if o not in hidden]:
        said.append(f"shows {', '.join(shown)} whole")
    if shown := [o.name for o in cut if o not in hidden]:
        said.append(f"cuts off part of {', '.join(shown)}")
    for obj, covering in hidden.items():
        said.append(f"has {obj.name} hidden behind {', '.join(sorted(covering))}")
    if missed:
        named = ", ".join(o.name for o in missed[:10])
        said.append(f"misses {named}" + (f" and {len(missed) - 10} more" if len(missed) > 10 else ""))
    return said


def shapes_in_scene():
    """
    Every visible shape in the scene, part by part, as one surface to cast
    rays at, with the part each of its faces belongs to.
    """
    verts, faces, owners = [], [], []
    for obj in subjects():
        if not has_shape(obj):
            continue
        shape = shapes_mesh([obj])
        try:
            shape.verts.index_update()
            start = len(verts)
            verts += [v.co.copy() for v in shape.verts]
            faces += [[start + v.index for v in f.verts] for f in shape.faces]
            owners += [obj] * len(shape.faces)
        finally:
            shape.free()
    return (mathutils.bvhtree.BVHTree.FromPolygons(verts, faces) if faces else None), owners


def surface_points(targets):
    """Points spread over each target's surface, in world space, with the target and its parts."""
    found = []
    for target in targets:
        shape = world_mesh(target)
        try:
            step = max(1, len(shape.faces) // 100)
            points = sampled(shape.verts, 100) + [f.calc_center_median() for f in list(shape.faces)[::step]]
        finally:
            shape.free()
        if points:
            found.append((target, points, {target, *target.children_recursive}))
    return found


def share_seen(camera, surfaces, everything, owners):
    """
    How much of the targets' surfaces a camera sees, from 0 to 1, and which
    targets it sees nothing of: points of each, in the picture and met first
    by a ray from the camera, against all of their points.
    """
    eye = camera.matrix_world.translation
    seen, total, unseen = 0, 0, []
    for target, points, own in surfaces:
        found = 0
        for point, inside in zip(points, in_view(camera, points)):
            if not inside or everything is None:
                continue
            way = point - eye
            face = everything.ray_cast(eye, way.normalized(), way.length + 1e-4)[2]
            # A ray that slips between faces is taken as seeing the shape.
            if face is None or owners[face] in own:
                found += 1
        seen += found
        total += len(points)
        if not found:
            unseen.append(target)
    return (seen / total if total else 0.0), unseen


def first_seen(camera, everything, owners, count=48):
    """The shapes that rays through a grid across the picture meet first: each shows somewhere."""
    return set(rays_met(camera, everything, owners, count))


def rays_met(camera, everything, owners, count=48):
    """How many of the rays through a grid across the picture each shape meets first: {shape: rays}."""
    if everything is None:
        return {}
    data = camera.data
    frame = data.view_frame(scene=scene())
    left, right, bottom, top = frame[2].x, frame[1].x, frame[1].y, frame[0].y
    depth = -frame[0].z
    to_world = camera.matrix_world.normalized()
    turn = to_world.to_3x3()
    ahead = (turn @ mathutils.Vector((0, 0, -1))).normalized()
    met = {}
    for i in range(count):
        for j in range(count):
            x = left + (right - left) * (i + 0.5) / count
            y = bottom + (top - bottom) * (j + 0.5) / count
            if data.type == "ORTHO":
                start, way = to_world @ mathutils.Vector((x, y, 0)), ahead
            else:
                start, way = to_world.translation, (turn @ mathutils.Vector((x, y, -depth))).normalized()
            face = everything.ray_cast(start, way, data.clip_end)[2]
            if face is not None:
                met[owners[face]] = met.get(owners[face], 0) + 1
    return met


def covered_by(camera, everything, owners, obj, points):
    """
    What covers a shape at every one of its points in the picture, looking
    from the camera; nothing as soon as one point shows, or when the shape
    has no point in the picture to look at.
    """
    if everything is None or not points:
        return set()
    eye = camera.matrix_world.translation
    ahead = (camera.matrix_world.to_quaternion() @ mathutils.Vector((0, 0, -1))).normalized()
    covering = set()
    for point in points:
        if camera.data.type == "ORTHO":
            reach = (point - eye).dot(ahead)
            start, way = point - ahead * reach, ahead
        else:
            start, way, reach = eye, (point - eye).normalized(), (point - eye).length
        _, _, face, _ = everything.ray_cast(start, way, reach + 1e-4)
        # A ray that slips between faces is taken as seeing the shape.
        if face is None or owners[face] is obj:
            return set()
        covering.add(owners[face].name)
    return covering


def object_line(obj, others, loose=None, sound=None, overlapping=None):
    bpy.context.view_layer.update()
    parts = [obj.type.lower()]
    if obj.get("zhiyin_text"):
        bent = f", {wrap_text(obj)}" if obj.get("zhiyin_wrap") else ""
        parts.append(f"lettering “{obj['zhiyin_text']}”{bent}")
    bounds = bounds_of(obj)
    placing = bool(copies_of(obj))
    if obj.type in ("MESH", "CURVE", "FONT") or obj.children or placing:
        size = own_size(obj)
        parts.append(size_text(size) if size is not None else "no size")
    parts.append(f"at {point_text(obj.matrix_world.translation)}")
    heights = heights_text(obj) if bounds else None
    if heights:
        parts.append(heights)
    turned = turned_text(obj)
    if turned:
        parts.append(turned)
    if obj.parent:
        parts.append(f"attached to {obj.parent.name}")
    if obj.hide_render:
        parts.append("hidden")
    if obj.type in ("MESH", "CURVE", "FONT") and not obj.visible_shadow:
        parts.append("casts no shadow")
    if obj.type in ("MESH", "CURVE", "FONT"):
        groups = surface_names(obj.data) if obj.type == "MESH" else []
        if groups and len(groups) == len(obj.material_slots):
            # A CAD part's surfaces, each with the material it is drawn in, as set_material's surface names them.
            materials = [
                f"{group}: {scene_material_facts(s.material) if s.material else 'none'}"
                for group, s in zip(groups, obj.material_slots)
            ]
        else:
            materials = [scene_material_facts(s.material) for s in obj.material_slots if s.material]
        if materials:
            parts.append("material " + "; ".join(materials))
        texels = texel_text(obj)
        if texels:
            parts.append(texels)
    if obj.modifiers:
        parts.append("steps: " + ", ".join(step_facts(m) for m in obj.modifiers))
    # A mesh that only places instances, as geometry nodes scatter them, has no faces of its own to tell.
    if obj.type == "MESH" and not (placing and not len(own_points(obj))):
        parts.append(mesh_facts(obj))
        unsound = sound.text(obj) if sound is not None else None
        if unsound:
            parts.append(unsound)
    if placing:
        parts.append(copies_text(obj))
    # Only what is in the picture: a lighting backdrop surrounds the product
    # rather than going into it.
    if bounds and obj in others:
        parts += overlapping.words(obj) if overlapping is not None else into_text(obj, others)
        apart = loose.loose_text(obj) if loose is not None and (obj.type in ("MESH", "CURVE", "FONT") or placing) else None
        if apart:
            parts.append(apart)
        # What holds it up; one floating is said by what floats.
        stands = standing(obj, loose) if loose is not None and has_shape(obj) else None
        if stands is not None:
            loose.standings.append(stands)
            if stands.gap is None or not apart:
                parts.append(stands.words)
        unjoined = ends_text(obj, others) if sound is not None else None
        if unjoined:
            parts.append(unjoined)
    if obj.type == "LIGHT":
        light = ", ".join(light_facts(obj.data, colour_always=True))
        if obj.get("zhiyin_aim") is not None:
            light += f", aimed at {point_text(obj['zhiyin_aim'])}"
        parts.append(light)
    if obj.type == "CAMERA":
        parts.append(
            f"orthographic, {length(obj.data.ortho_scale)} across" if obj.data.type == "ORTHO" else f"{obj.data.lens:g} mm lens"
        )
        if lens_shift(obj.data):
            parts.append(lens_shift(obj.data))
        dof = obj.data.dof
        if dof.use_dof:
            focus = obj.data.get("zhiyin_focus")
            parts.append(f"background blur at f/{dof.aperture_fstop:g}, focused " + (f"on {focus}" if focus else f"{length(dof.focus_distance)} away"))
        parts += in_picture(obj, subjects())
    return f"- {obj.name}: " + " · ".join(parts)


def sun_text(elevation, turn):
    """
    Where a sky's sun stands and which way its light goes. Blender turns the
    sun round as a compass turns, with +y as north: 0 is +y, 90 is +x. A side
    is named by its axis, and by two when the sun stands between them.
    """
    bearing = round(math.degrees(turn)) % 360
    across, along = math.sin(turn), math.cos(turn)

    def sides(sign):
        near = sorted(((abs(v), axis, v * sign) for v, axis in ((across, "x"), (along, "y")) if abs(v) > 0.38), reverse=True)
        return " and ".join(f"{'+' if v > 0 else '-'}{axis}" for _, axis, v in near)

    return (
        f"the sun {math.degrees(elevation):.3g}° high, standing toward {sides(1)} (bearing {bearing}°); "
        f"its light travels toward {sides(-1)}"
    )


def world_line():
    world = scene().world
    if world is None or not world.use_nodes:
        return "Surroundings: none"
    nodes = world.node_tree.nodes
    if any(n.type == "TEX_ENVIRONMENT" for n in nodes):
        image = next(n for n in nodes if n.type == "TEX_ENVIRONMENT").image
        if image is None:
            shown = "the picture (missing)"
        elif image.packed_file is not None and not image.filepath and image.name.startswith("Zhiyin "):
            # One of Blender's own, kept in the scene under its name.
            shown = f"Blender's own {image.name.removeprefix('Zhiyin ').removesuffix(' surroundings')}"
        else:
            shown = f"the picture {bpy.path.basename(image.filepath)}"
        behind = next((n for n in nodes if n.type == "BACKGROUND" and not n.inputs["Color"].is_linked), None)
        if behind is not None:
            shown += f", seen behind the scene as plain {hex_of(behind.inputs['Color'].default_value)}"
        return f"Surroundings: {shown}"
    if any(n.type == "TEX_SKY" for n in nodes):
        sky = next(n for n in nodes if n.type == "TEX_SKY")
        ground = ", over level ground to the horizon" if any(n.type == "MIX" for n in nodes) else ""
        return f"Surroundings: a sky with {sun_text(sky.sun_elevation, sky.sun_rotation)}{ground}"
    background = next((n for n in nodes if n.type == "BACKGROUND"), None)
    if background is None:
        return "Surroundings: none"
    return f"Surroundings: {hex_of(background.inputs['Color'].default_value)} at strength {background.inputs['Strength'].default_value:g}"


def describe_scene(args, scene_file):
    s = scene()
    names = args.get("objects")
    if names:
        need(isinstance(names, list), "objects must be a list of names.")
        objects = find_objects(names)
    else:
        objects = [o for o in s.objects if not o.name.startswith("Zhiyin preview")]
    shown = [o for o in objects if not in_collection(o, CUTTERS)]
    cutters = [o for o in objects if in_collection(o, CUTTERS)]
    render = s.render
    if render.engine == "CYCLES":
        engine = f"Cycles at {s.cycles.samples} samples"
    elif render.engine == "BLENDER_EEVEE":
        engine = f"EEVEE at {s.eevee.taa_render_samples} samples"
    else:
        engine = render.engine
    others = subjects()
    placed = sum(len(copies_of(o)) for o in shown)
    lines = [
        f"Scene file: {scene_file.name}",
        f"Camera: {s.camera.name if s.camera else 'none'} · picture {render.resolution_x}×{render.resolution_y} with {engine}, {tone_text()}"
        + (" · transparent background" if render.film_transparent else ""),
        world_line(),
        "Positions are origins; heights are where each object's bottom and top are.",
        (f"Objects ({len(shown)}" + (f", placing {placed:,} instances" if placed else "") + "):") if shown else "Objects: none",
    ]
    # Nothing changes while the scene is told, so each object's parts and box
    # are worked out once for every line that needs them.
    with held_still():
        # The three run side by side over the objects, each within its share of the command's time.
        loose = Checker(others, budget.share(LOOSE_SECONDS))
        sound = Sound(budget.share(SOUND_SECONDS))
        overlapping = Overlapping(budget.share(OVERLAP_SECONDS))
        overlapping.measure([o for o in shown if o in others and bounds_of(o)], others)
        lines += [object_line(o, others, loose, sound, overlapping) for o in shown]
        lines += overlapping.group_lines()
        aloft = standing_text([s for s in loose.standings if s.gap is not None], "Touching nothing, the farthest above what is under it first")
        if aloft:
            lines.append(aloft)
        lines += form_lines(shown)
        lines.append(budget_text())
        if overlapping.unchecked:
            lines.append("Not checked for going into others, for want of time: " + ", ".join(overlapping.unchecked) + ".")
        if loose.unchecked:
            lines.append(
                "Not checked for pieces nothing holds, for want of time: " + ", ".join(loose.unchecked) + "."
            )
        if sound.unchecked:
            lines.append(
                "Not checked for holes and crossing faces, for want of time: " + ", ".join(sound.unchecked) + "."
            )
        if cutters:
            lines.append(f"Cutters, never rendered ({len(cutters)}):")
            lines += [object_line(o, []) for o in cutters]
    motion = describe_motion(objects if names else None)
    if motion:
        lines.append(motion)
    simulations = scene_text()
    if simulations:
        lines.append(simulations)
    return "\n".join(lines)


# ---- the API, from the running Blender ----------------------------------------------------


def describe_property(prop):
    kind = prop.type.lower()
    text = f"- {prop.identifier} ({kind}"
    if prop.type == "ENUM":
        items = [i.identifier for i in prop.enum_items]
        text += ": " + ", ".join(items[:40]) + (" …" if len(items) > 40 else "")
    elif getattr(prop, "is_array", False) and getattr(prop, "array_length", 0):
        text += f"[{prop.array_length}]"
    if prop.is_readonly:
        text += ", read-only"
    text += ")"
    if prop.description:
        text += f": {prop.description}"
    return text


def node_answer(identifier):
    tree = bpy.data.node_groups.new("Zhiyin API", "ShaderNodeTree" if identifier.startswith("ShaderNode") else "GeometryNodeTree")
    try:
        node = tree.nodes.new(identifier)
        inputs = [f"- {s.name} ({s.type.lower()}{', ' + repr(tuple(s.default_value)) if hasattr(s, 'default_value') and hasattr(s.default_value, '__len__') else (', ' + repr(s.default_value) if hasattr(s, 'default_value') else '')})" for s in node.inputs]
        outputs = [f"- {s.name} ({s.type.lower()})" for s in node.outputs]
        settings = [describe_property(p) for p in node.bl_rna.properties if p.identifier not in bpy.types.Node.bl_rna.properties.keys()]
        return "\n".join(
            [f"{identifier} ({node.bl_label})", "Inputs:"] + inputs + ["Outputs:"] + outputs + (["Settings:"] + settings if settings else [])
        )
    finally:
        bpy.data.node_groups.remove(tree)


def api(args, scene_file):
    name = args.get("name")
    need(isinstance(name, str) and name.strip(), "Name a type, a node or an operator, such as Object, ShaderNodeBsdfPrincipled or bpy.ops.mesh.bevel.")
    name = name.strip()
    if name.startswith("bpy.ops."):
        parts = name.split(".")
        need(len(parts) == 4, "An operator is named like bpy.ops.mesh.bevel.")
        try:
            rna = getattr(getattr(bpy.ops, parts[2]), parts[3]).get_rna_type()
        except (AttributeError, KeyError):
            return f"Blender {bpy.app.version_string} has no operator {name}."
        lines = [f"{name}: {rna.description}", "Parameters:"]
        lines += [describe_property(p) for p in rna.properties if p.identifier != "rna_type"]
        return "\n".join(lines)
    short = name.removeprefix("bpy.types.")
    # A type by its own name first; a node's shown label, such as “Object”
    # for an Object Info input, only when no type has that name.
    if getattr(bpy.types, short, None) is None:
        by_label = {
            t.bl_rna.name: t.__name__
            for t in (getattr(bpy.types, n) for n in dir(bpy.types) if n.startswith(("ShaderNode", "GeometryNode")))
            if hasattr(t, "bl_rna")
        }
        short = by_label.get(short, short)
    found = getattr(bpy.types, short, None)
    if found is None:
        wanted = short.lower()
        near = sorted(n for n in dir(bpy.types) if wanted in n.lower())[:30]
        return f"Blender {bpy.app.version_string} has no type {short}." + (f" Close names: {', '.join(near)}." if near else "")
    if short.startswith(("ShaderNode", "GeometryNode")) and short not in ("ShaderNode", "GeometryNode"):
        try:
            return node_answer(short)
        except RuntimeError:
            pass
    lines = [f"bpy.types.{short} in Blender {bpy.app.version_string}: {found.bl_rna.description}", "Properties:"]
    lines += [describe_property(p) for p in found.bl_rna.properties if p.identifier != "rna_type"]
    functions = [f.identifier for f in found.bl_rna.functions]
    if functions:
        lines.append("Functions: " + ", ".join(functions))
    return "\n".join(lines)
