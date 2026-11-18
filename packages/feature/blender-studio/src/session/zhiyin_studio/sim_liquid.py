"""
A liquid for blender_simulate: Mantaflow's FLIP liquid in a domain sized round the container and
the sources, obstacles given collision, the thinnest wall weighed against the voxel before the
bake, then baked over the scene's frames and measured. The cache is kept in the conversation's own
folder, a new one for each bake, so a scene put back keeps the cache it was baked with; past
CACHES_MOST together, the oldest caches the open scene does not name are removed.
"""

import math
import os
import shutil
import time
import uuid

import bmesh
import bpy
import mathutils

from . import sim_liquid_measures as measures
from .arguments import need, number, vector, whole
from .disk_files import folder_size
from .errors import Refused
from .finding import find_object, find_objects, is_helper, link, scene
from .glass import is_glass
from .material_thickness import Thickness
from .shown_mesh import shown_bmesh
from .timeline import fps
from .wording import length, one_of, point_text, size_text, volume_text

# Viscosity by Mantaflow's viscosity solver: water runs free, oil spreads more slowly, honey holds together.
PRESETS = {
    "water": dict(viscosity=None, colour=(0.9, 0.95, 1.0, 1.0), ior=1.333),
    "oil": dict(viscosity=0.1, colour=(0.85, 0.65, 0.15, 1.0), ior=1.47),
    "honey": dict(viscosity=2.0, colour=(0.75, 0.35, 0.02, 1.0), ior=1.5),
}
FLOWS = ("shape", "pour")
DRAFT = 32
LEAST_RESOLUTION = 8
MOST_RESOLUTION = 256
# Walls thinner than this many voxels let the liquid through (probed: 12 mm walls held at 8.3 and 8.85 mm
# voxels; 2, 6 and 9 mm walls leaked at 8.3 mm, and 2 mm at 4.2 mm).
HOLDING_VOXELS = 1.5
# Room round the container and sources: a tenth of the largest side, and at least two voxels.
MARGIN_SHARE = 0.1
DOMAIN = "zhiyin_liquid"
# The most the conversation's liquid caches hold together: past it, the oldest the open scene
# does not name are removed as the next bake starts.
CACHES_MOST = 2 * 1024**3


def caches_root():
    """Where the conversation keeps its liquid caches: its own home, which Blender may write."""
    home = os.environ.get("USERPROFILE") or os.path.expanduser("~")
    return os.path.join(home, "liquid-caches")


def named_caches():
    """The cache folders the open scene's fluid domains name, as the disk has them."""
    return {
        os.path.normcase(os.path.realpath(bpy.path.abspath(m.domain_settings.cache_directory)))
        for obj in bpy.data.objects
        for m in obj.modifiers
        if m.type == "FLUID" and m.fluid_type == "DOMAIN" and m.domain_settings.cache_directory
    }


def trim_caches(root, most, kept):
    """
    Removes the oldest cache folders in `root` until those left hold `most` bytes or less, never
    one in `kept`; the folders removed. A scene put back to one removed shows its liquid unbaked.
    """
    if not os.path.isdir(root):
        return []
    folders = [os.path.join(root, name) for name in os.listdir(root) if os.path.isdir(os.path.join(root, name))]
    sizes = {folder: folder_size(folder) for folder in folders}
    total = sum(sizes.values())
    removed = []
    for folder in sorted(folders, key=os.path.getmtime):
        if total <= most:
            break
        if os.path.normcase(os.path.realpath(folder)) in kept:
            continue
        shutil.rmtree(folder, ignore_errors=True)
        if not os.path.exists(folder):
            total -= sizes[folder]
            removed.append(folder)
    return removed


def cache_folder():
    """
    A new folder for one bake's cache in the conversation's own home, which Zhiyin keeps, so a
    scene put back keeps the liquid it was baked with while the caches stay under CACHES_MOST.
    """
    root = caches_root()
    trim_caches(root, CACHES_MOST, named_caches())
    folder = os.path.join(root, uuid.uuid4().hex[:12])
    os.makedirs(folder, exist_ok=True)
    return folder


def mesh_object(name, what):
    obj = find_object(name)
    need(obj.type == "MESH" and not is_helper(obj), f"“{obj.name}” is not a mesh, and only a mesh can be {what}.")
    need(not any(m.type == "CLOTH" for m in obj.modifiers), f"“{obj.name}” is cloth; give the liquid a mesh of its own.")
    need(
        obj.get(DOMAIN) or not any(m.type == "FLUID" and m.fluid_type == "DOMAIN" for m in obj.modifiers),
        f"“{obj.name}” is a liquid's domain; name the container, sources and obstacles, and the domain is made round them.",
    )
    return obj


def fluid_part(obj, name, kind):
    """The object's one fluid step, of the kind given, in place of any it had."""
    for m in [m for m in obj.modifiers if m.type == "FLUID"]:
        obj.modifiers.remove(m)
    part = obj.modifiers.new(name, "FLUID")
    part.fluid_type = kind
    obj["zhiyin_liquid_part"] = True
    return part


def closed(obj):
    bm = shown_bmesh(obj, steps=False, world=False)
    try:
        return bool(bm.edges) and all(e.is_manifold for e in bm.edges)
    finally:
        bm.free()


def own_volume(obj):
    bm = shown_bmesh(obj, steps=False)
    try:
        return abs(bm.calc_volume())
    finally:
        bm.free()


def world_box(objects):
    corners = [obj.matrix_world @ mathutils.Vector(c) for obj in objects for c in obj.bound_box]
    low = mathutils.Vector([min(c[i] for c in corners) for i in range(3)])
    high = mathutils.Vector([max(c[i] for c in corners) for i in range(3)])
    return low, high


def read_sources(given):
    need(isinstance(given, list) and given, "liquid.sources lists where the liquid comes from.")
    sources = []
    for i, source in enumerate(given):
        need(isinstance(source, dict), f"liquid.sources[{i}] names an object.")
        obj = mesh_object(source.get("object"), "a liquid source")
        flow = source.get("flow", "shape")
        need(flow in FLOWS, f"liquid.sources[{i}].flow is one of {one_of(FLOWS)}.")
        if flow == "shape":
            need(closed(obj), f"“{obj.name}” starts as liquid only as a closed shape, and it is open: close it, or let it pour.")
        speed = vector(source.get("speed"), f"liquid.sources[{i}].speed", default=(0, 0, 0))
        sources.append((obj, flow, speed))
    names = [s[0].name for s in sources]
    need(len(set(names)) == len(names), "Each source is named once.")
    return sources


def remove_old_domains():
    """A liquid set up again replaces the domain an earlier call made, and the flow it gave; a domain of the scene's own is refused."""
    for obj in scene().objects:
        if not obj.get(DOMAIN) and any(m.type == "FLUID" and m.fluid_type == "DOMAIN" for m in obj.modifiers):
            raise Refused(f"The scene has a fluid domain of its own, “{obj.name}”; a liquid set up here makes its own, so remove that one first.")
    for obj in list(scene().objects):
        if obj.get(DOMAIN):
            bpy.data.objects.remove(obj)
    for obj in scene().objects:
        for m in [m for m in obj.modifiers if m.type == "FLUID" and obj.get("zhiyin_liquid_part")]:
            obj.modifiers.remove(m)
        if obj.get("zhiyin_liquid_part"):
            del obj["zhiyin_liquid_part"]


def liquid_material(preset):
    name = f"{preset.capitalize()} (liquid)"
    material = bpy.data.materials.get(name)
    if material is None:
        values = PRESETS[preset]
        material = bpy.data.materials.new(name)
        material.use_nodes = True
        shader = next(n for n in material.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        shader.inputs["Base Color"].default_value = values["colour"]
        shader.inputs["Roughness"].default_value = 0.0
        shader.inputs["IOR"].default_value = values["ior"]
        shader.inputs["Transmission Weight"].default_value = 1.0
    return material


def make_domain(low, high, preset):
    centre, size = (low + high) / 2, high - low
    mesh = bpy.data.meshes.new("Liquid")
    bm = bmesh.new()
    try:
        bmesh.ops.create_cube(bm, size=1.0)
        for v in bm.verts:
            v.co = mathutils.Vector([v.co[i] * size[i] for i in range(3)])
        bm.to_mesh(mesh)
    finally:
        bm.free()
    name = "Liquid" if bpy.data.objects.get("Liquid") is None else f"Liquid of {preset}"
    domain = bpy.data.objects.new(name, mesh)
    domain.location = centre
    link(domain)
    domain[DOMAIN] = True
    domain.data.materials.append(liquid_material(preset))
    return domain


def resolution_of(given, longest):
    if given.get("resolution") is not None and given.get("voxel") is not None:
        raise Refused("liquid takes resolution or voxel, not both: one sets the other.")
    if given.get("voxel") is not None:
        voxel = number(given["voxel"], "liquid.voxel", minimum=0.0001)
        found = math.ceil(longest / voxel - 1e-9)
        need(
            found <= MOST_RESOLUTION,
            f"A {length(voxel)} voxel across the {length(longest)} domain is resolution {found}, past the {MOST_RESOLUTION} a bake"
            " finishes in its time: give a larger voxel.",
        )
        return max(found, 8)
    return whole(given.get("resolution"), "liquid.resolution", minimum=LEAST_RESOLUTION, maximum=MOST_RESOLUTION, default=DRAFT)


def walls_line(obstacles, voxel, longest):
    """Each obstacle's thinnest wall against the voxel: thinner than one and a half voxels may let liquid through."""
    lines = []
    for obj in obstacles:
        thinnest = Thickness(obj).thinnest
        if thinnest is None:
            lines.append(f"{obj.name} is an obstacle; it has no closed wall to measure, so it may let liquid through.")
            continue
        holding = HOLDING_VOXELS * voxel
        if thinnest < holding:
            needed = math.ceil(longest * HOLDING_VOXELS / thinnest)
            fix = (
                f"resolution {needed} or a voxel of {length(thinnest / HOLDING_VOXELS)} holds it"
                if needed <= MOST_RESOLUTION
                else f"thicken it to {length(holding)} for the simulation, as no resolution a bake finishes holds it"
            )
            lines.append(
                f"{obj.name} is an obstacle: its thinnest wall, {length(thinnest)}, is under {HOLDING_VOXELS:g} voxels"
                f" ({length(holding)}) and may let liquid through: {fix}."
            )
        else:
            lines.append(f"{obj.name} is an obstacle: its thinnest wall, {length(thinnest)}, is at least {HOLDING_VOXELS:g} voxels.")
    return lines


def apply(given):
    """Sets up and bakes the liquid given; its lines, the measures after the bake among them."""
    need(isinstance(given, dict), "liquid describes the container, the sources and the obstacles.")
    preset = given.get("preset", "water")
    need(preset in PRESETS, f"liquid.preset is one of {one_of(PRESETS)}.")
    sources = read_sources(given.get("sources"))
    container = mesh_object(given["container"], "a container") if given.get("container") is not None else None
    obstacles = [container] if container else []
    for obj in find_objects(given.get("obstacles") or []):
        need(obj.type == "MESH", f"“{obj.name}” is not a mesh, and only a mesh is an obstacle.")
        if obj not in obstacles:
            obstacles.append(obj)
    for obj, _, _ in sources:
        need(obj not in obstacles, f"“{obj.name}” is both a source and an obstacle.")
    remove_old_domains()
    bpy.context.view_layer.update()
    held = [s[0] for s in sources] + ([container] if container else obstacles)
    low, high = world_box(held)
    longest = max(high - low)
    resolution = resolution_of(given, longest * (1 + 2 * MARGIN_SHARE))
    margin = max(MARGIN_SHARE * longest, 2 * longest / resolution)
    low, high = low - mathutils.Vector((margin,) * 3), high + mathutils.Vector((margin,) * 3)
    longest = max(high - low)
    voxel = longest / resolution
    domain = make_domain(low, high, preset)
    room = scene()
    first, last = room.frame_start, room.frame_end
    modifier = domain.modifiers.new("Liquid", "FLUID")
    modifier.fluid_type = "DOMAIN"
    settings = modifier.domain_settings
    settings.domain_type = "LIQUID"
    settings.resolution_max = resolution
    settings.use_mesh = True
    settings.cache_type = "ALL"
    settings.cache_frame_start, settings.cache_frame_end = first, last
    # Open sides and top let spilled liquid go; an open bottom fills the whole domain with liquid (probed).
    for side in ("front", "back", "right", "left", "top"):
        setattr(settings, f"use_collision_border_{side}", False)
    settings.use_collision_border_bottom = True
    viscosity = PRESETS[preset]["viscosity"]
    settings.use_viscosity = viscosity is not None
    if viscosity is not None:
        settings.viscosity_value = viscosity
    names = ", ".join(o.name for o in held)
    draft = "a draft; raise resolution for the final" if resolution <= DRAFT else "for the final"
    lines = [
        f"Liquid: {preset}, in a new domain “{domain.name}” {size_text(high - low)} round {names}, resolution {resolution}:"
        f" voxels {length(voxel)}, {draft}. Liquid that leaves the domain by its sides or top is gone; its floor holds what falls on it.",
        f"It shows with material “{domain.data.materials[0].name}”, clear and refracting at IOR {PRESETS[preset]['ior']:g}"
        + (
            f"; seen through {container.name}'s glass it shows in Cycles, as EEVEE draws light through one layer of glass at most."
            if container is not None and any(is_glass(m) for m in container.data.materials)
            else "."
        ),
    ]
    shaped = []
    for obj, flow, speed in sources:
        part = fluid_part(obj, "Liquid source", "FLOW")
        flow_settings = part.flow_settings
        flow_settings.flow_type = "LIQUID"
        flow_settings.flow_behavior = "GEOMETRY" if flow == "shape" else "INFLOW"
        flow_settings.use_initial_velocity = speed.length > 0
        flow_settings.velocity_coord = speed
        obj.hide_render = True
        if flow == "shape":
            volume = own_volume(obj)
            shaped.append(volume)
            said = f"{obj.name} starts as liquid, {volume_text(volume)} as modelled"
        else:
            said = f"{obj.name} pours liquid in at every frame"
        if speed.length > 0:
            said += f", moving at {point_text(speed)}/s"
        lines.append(f"{said}; hidden from renders, the liquid shows in its place.")
    for obj in obstacles:
        part = fluid_part(obj, "Liquid obstacle", "EFFECTOR")
        part.effector_settings.effector_type = "COLLISION"
    lines += walls_line(obstacles, voxel, longest)
    bpy.context.view_layer.update()
    settings.cache_directory = cache_folder()
    began = time.monotonic()
    with bpy.context.temp_override(scene=room, active_object=domain, object=domain, selected_objects=[domain]):
        result = bpy.ops.fluid.bake_all()
    seconds = time.monotonic() - began
    need(
        "FINISHED" in result and settings.has_cache_baked_data,
        f"Blender did not bake the liquid ({', '.join(result)}); nothing of it is kept.",
    )
    lines.append(
        f"Baked frames {first}–{last} ({(last - first + 1) / fps():.3g} s) in {seconds:.3g} s; the cache,"
        f" {measures.megabytes(settings.cache_directory)}, is kept in this conversation's own folder for renders of the scene."
    )
    frame_before = room.frame_current
    try:
        lines += measures.after_bake(domain, container, obstacles, voxel, shaped, any(f == "pour" for _, f, _ in sources))
    finally:
        room.frame_set(frame_before)
    return lines
