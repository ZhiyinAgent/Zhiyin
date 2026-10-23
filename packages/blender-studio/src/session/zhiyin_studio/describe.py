"""The scene in words, for a model that cannot see the preview, and Blender's
own answers about its API, which are exact for the installed version."""

import math

import bmesh
import bpy
import mathutils
import mathutils.bvhtree
import numpy

from .common import (
    CUTTERS,
    bounds_of,
    find_object,
    heights_text,
    held_still,
    hex_of,
    hull_points,
    in_collection,
    into_text,
    is_inside,
    length,
    lens_shift,
    need,
    own_size,
    point_text,
    sampled,
    scene,
    size_text,
    subjects,
    tone_text,
    turned_text,
    volume_text,
    welded,
    wood_of,
    world_mesh,
)


def mesh_facts(obj):
    """Whether the evaluated mesh is closed, and its volume when it is."""
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    try:
        bm = bmesh.new()
        bm.from_mesh(mesh)
        bm.transform(obj.matrix_world)
        welded(bm, list(bm.verts))
        closed = bool(bm.edges) and all(e.is_manifold for e in bm.edges)
        smooth = sum(1 for f in bm.faces if f.smooth)
        shading = "smooth-shaded" if smooth == len(bm.faces) else "flat-shaded" if not smooth else "partly smooth-shaded"
        facts = f"{len(bm.faces)} faces, {shading}, {'closed' if closed else 'open'}"
        if closed:
            facts += f", {volume_text(bm.calc_volume(signed=False))}"
        bm.free()
        return facts
    finally:
        evaluated.to_mesh_clear()


def material_facts(material):
    """A material as set_material sets it, so a later call can change one thing and keep the rest."""
    if not material.use_nodes:
        return material.name
    shader = material.node_tree.nodes.get("Principled BSDF")
    if shader is None:
        return f"{material.name} (its own shader nodes)"
    inputs = shader.inputs
    said = []
    base = inputs["Base Color"]
    grain = wood_of(material)
    if base.is_linked and not grain:
        picture = next((n for n in material.node_tree.nodes if n.type == "TEX_IMAGE" and n.image), None)
        said.append(f"picture {bpy.path.basename(picture.image.filepath)}" if picture else "colour from nodes")
    else:
        said.append(hex_of(base.default_value))
    said.append(f"roughness {inputs['Roughness'].default_value:.3g}")
    if grain:
        said.append(f"wood grain {grain:.3g}")
    if inputs["Metallic"].default_value > 0:
        said.append(f"metallic {inputs['Metallic'].default_value:.3g}")
    if abs(inputs["Specular IOR Level"].default_value - 0.5) > 1e-6:
        said.append(f"specular {inputs['Specular IOR Level'].default_value:.3g}")
    if inputs["Coat Weight"].default_value > 0:
        said.append(f"coat {inputs['Coat Weight'].default_value:.3g}")
        if abs(inputs["Coat Roughness"].default_value - 0.03) > 1e-6:
            said.append(f"coat roughness {inputs['Coat Roughness'].default_value:.3g}")
    if inputs["Transmission Weight"].default_value > 0:
        said.append(f"transmission {inputs['Transmission Weight'].default_value:.3g}, ior {inputs['IOR'].default_value:.3g}")
    if inputs["Alpha"].default_value < 1:
        said.append(f"opacity {inputs['Alpha'].default_value:.3g}")
    if inputs["Emission Strength"].default_value > 0:
        glow = "with its picture" if inputs["Emission Color"].is_linked else hex_of(inputs["Emission Color"].default_value)
        said.append(f"glowing {glow} at {inputs['Emission Strength'].default_value:.3g}")
    if inputs["Normal"].is_linked:
        said.append("surface detail")
    if "zhiyin_reflections" in material:
        said.append(f"{material['zhiyin_reflections']:.0%} as bright in reflections")
    return f"{material.name} ({', '.join(said)})"


def step_facts(modifier):
    """An editing step with the values it was given, so it can be changed knowingly."""
    if modifier.type == "BEVEL":
        return f"{modifier.name} ({length(modifier.width)}, {modifier.segments} segments)"
    if modifier.type == "BOOLEAN":
        other = modifier.object.name if modifier.object else "nothing"
        return f"{modifier.name} ({modifier.operation.lower()} with {other})"
    if modifier.type == "ARRAY":
        return f"{modifier.name} ({modifier.count} copies, {point_text(modifier.constant_offset_displace)} apart)"
    if modifier.type == "MIRROR":
        axes = [a for a, used in zip("xyz", modifier.use_axis) if used]
        across = f" around {modifier.mirror_object.name}" if modifier.mirror_object else ""
        return f"{modifier.name} (across {', '.join(axes)}{across})"
    if modifier.type == "SOLIDIFY":
        return f"{modifier.name} (walls {length(modifier.thickness)})"
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
            if bool(shape.edges) and all(e.is_manifold for e in shape.edges) and is_inside(surface, eye):
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


def first_seen(camera, everything, owners, count=48):
    """The shapes that rays through a grid across the picture meet first: each shows somewhere."""
    if everything is None:
        return set()
    data = camera.data
    frame = data.view_frame(scene=scene())
    left, right, bottom, top = frame[2].x, frame[1].x, frame[1].y, frame[0].y
    depth = -frame[0].z
    to_world = camera.matrix_world.normalized()
    turn = to_world.to_3x3()
    ahead = (turn @ mathutils.Vector((0, 0, -1))).normalized()
    seen = set()
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
                seen.add(owners[face])
    return seen


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


def object_line(obj, others):
    bpy.context.view_layer.update()
    parts = [obj.type.lower()]
    if obj.get("zhiyin_text"):
        bent = f", bent round a {length(obj['zhiyin_wrap'])} radius" if obj.get("zhiyin_wrap") else ""
        parts.append(f"lettering “{obj['zhiyin_text']}”{bent}")
    bounds = bounds_of(obj)
    if obj.type in ("MESH", "CURVE", "FONT") or obj.children:
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
        materials = [material_facts(s.material) for s in obj.material_slots if s.material]
        if materials:
            parts.append("material " + "; ".join(materials))
    if obj.modifiers:
        parts.append("steps: " + ", ".join(step_facts(m) for m in obj.modifiers))
    if obj.type == "MESH":
        parts.append(mesh_facts(obj))
    # Only what is in the picture: a lighting backdrop surrounds the product
    # rather than going into it.
    if bounds and obj in others:
        parts += into_text(obj, others)
    if obj.type == "LIGHT":
        unit = "strength" if obj.data.type == "SUN" else "W"
        light = f"{obj.data.type.lower()} light, {obj.data.energy:g} {unit}, colour {hex_of(obj.data.color)}"
        if obj.data.type == "AREA":
            light += f", {length(obj.data.size)} across"
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
        return f"Surroundings: the picture {bpy.path.basename(image.filepath) if image else '(missing)'}"
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
        objects = [find_object(n) for n in names]
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
    lines = [
        f"Scene file: {scene_file.name}",
        f"Camera: {s.camera.name if s.camera else 'none'} · picture {render.resolution_x}×{render.resolution_y} with {engine}, {tone_text()}"
        + (" · transparent background" if render.film_transparent else ""),
        world_line(),
        "Positions are origins; heights are where each object's bottom and top are.",
        f"Objects ({len(shown)}):" if shown else "Objects: none",
    ]
    # Nothing changes while the scene is told, so each object's parts and box
    # are worked out once for every line that needs them.
    with held_still():
        lines += [object_line(o, others) for o in shown]
        if cutters:
            lines.append(f"Cutters, never rendered ({len(cutters)}):")
            lines += [object_line(o, []) for o in cutters]
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
