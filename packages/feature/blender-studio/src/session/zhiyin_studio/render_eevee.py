"""
EEVEE as the engine of the picture to hand over, for stylised work: an option that marks it final,
and its quality, kept in the scene: shadows, ray tracing, volumes, and light probes baked round the
scene, which keep a room's walls from letting the sky's light through.

Measured in Blender 5.2: a light probe volume bakes with no window, and EEVEE then draws with it.
"""

import json
import time

import bpy

from .arguments import need, number, whole
from .finding import LIGHTING, collection, scene, subjects
from .geometry import world_bounds
from .stylised_checks import toon_bands

KEPT = "zhiyin_eevee"
PROBE = "Light probe volume"
# How far the probe volume reaches past what it is fitted to, as a share of its size.
PROBE_MARGIN = 0.1
METHODS = {"screen": "SCREEN", "probe": "PROBE"}
SIZES = ("1", "2", "4", "8", "16")
# The least and most of each quality a call may set.
SHADOW_RAYS, SHADOW_STEPS, SHADOW_RESOLUTION, VOLUME_SAMPLES = (1, 4), (1, 16), (0.1, 1), (1, 256)


def kept():
    try:
        return json.loads(scene().get(KEPT) or "{}")
    except ValueError:
        return {}


def check(spec):
    """Refuses EEVEE options that are not its own, before anything is drawn."""
    need(isinstance(spec, dict), "eevee gives final, shadows, raytracing, volumes or probes.")
    need(spec.get("final") is None or isinstance(spec["final"], bool), "eevee final is true or false.")
    need(spec.get("probes") is None or isinstance(spec["probes"], bool), "eevee probes is true or false.")
    for part in ("shadows", "raytracing", "volumes"):
        need(spec.get(part) is None or isinstance(spec[part], dict), f"eevee {part} is an object of its settings.")
    rays = spec.get("raytracing") or {}
    need(rays.get("method") in (None, "off", *METHODS), "eevee raytracing method is screen, probe or off.")
    for name, value in (("raytracing resolution", rays.get("resolution")), ("volumes tile", (spec.get("volumes") or {}).get("tile"))):
        need(value is None or str(value) in SIZES, f"eevee {name} is 1, 2, 4, 8 or 16 pixels.")


def set_eevee(spec):
    """
    Sets the EEVEE options a call gives on the scene, kept with those given
    before, and applies all of them; what probes baked, as words, or nothing.
    """
    s = scene()
    options = kept()
    if spec is not None:
        for part in ("shadows", "raytracing", "volumes"):
            if spec.get(part) is not None:
                options[part] = {**options.get(part, {}), **spec[part]}
        for flag in ("final", "probes"):
            if spec.get(flag) is not None:
                options[flag] = spec[flag]
        s[KEPT] = json.dumps(options)
    e = s.eevee
    shadows = options.get("shadows", {})
    if shadows.get("rays") is not None:
        e.shadow_ray_count = whole(shadows["rays"], "eevee shadows rays", minimum=SHADOW_RAYS[0], maximum=SHADOW_RAYS[1])
    if shadows.get("steps") is not None:
        e.shadow_step_count = whole(shadows["steps"], "eevee shadows steps", minimum=SHADOW_STEPS[0], maximum=SHADOW_STEPS[1])
    if shadows.get("resolution") is not None:
        least, most = SHADOW_RESOLUTION
        e.shadow_resolution_scale = number(shadows["resolution"], "eevee shadows resolution", minimum=least, maximum=most)
    rays = options.get("raytracing", {})
    if rays.get("method") is not None:
        e.use_raytracing = rays["method"] != "off"
        if rays["method"] != "off":
            e.ray_tracing_method = METHODS[rays["method"]]
    if rays.get("resolution") is not None:
        e.ray_tracing_options.resolution_scale = str(rays["resolution"])
    volumes = options.get("volumes", {})
    if volumes.get("tile") is not None:
        e.volumetric_tile_size = str(volumes["tile"])
    if volumes.get("samples") is not None:
        e.volumetric_samples = whole(volumes["samples"], "eevee volumes samples", minimum=VOLUME_SAMPLES[0], maximum=VOLUME_SAMPLES[1])
    if volumes.get("shadows") is not None:
        need(isinstance(volumes["shadows"], bool), "eevee volumes shadows is true or false.")
        e.use_volumetric_shadows = volumes["shadows"]
    if spec is not None and spec.get("probes"):
        return baked_probes()
    return ""


def baked_probes():
    """Bakes the scene's light probe volumes, fitting one round the scene when it has none; what was baked, as words."""
    s = scene()
    volumes = [o for o in s.objects if o.type == "LIGHT_PROBE" and o.data.type == "VOLUME"]
    added = not volumes
    if added:
        bounds = world_bounds(subjects())
        need(bounds is not None, "There is nothing for a light probe volume to fit round.")
        low, high = bounds
        probe = bpy.data.objects.new(PROBE, bpy.data.lightprobes.new(PROBE, "VOLUME"))
        collection(LIGHTING).objects.link(probe)
        probe.location = (low + high) / 2
        # A probe volume's cube reaches one unit each way from its middle at scale 1.
        probe.scale = [max((h - lo) / 2 * (1 + PROBE_MARGIN), 0.05) for lo, h in zip(low, high)]
        volumes = [probe]
    started = time.time()
    with bpy.context.temp_override(object=volumes[0], active_object=volumes[0], selected_objects=volumes):
        result = bpy.ops.object.lightprobe_cache_bake(subset="ALL")
    need("FINISHED" in result, "EEVEE could not bake the scene's light probes.")
    names = ", ".join(o.name for o in volumes)
    return (
        f" Light probes baked in {time.time() - started:.1f} s: {names}"
        + (", a volume fitted round the scene and kept in it, so its rooms keep the sky's light out" if added else "")
        + "."
    )


def shows_toon():
    """Whether something in the picture wears a toon material, which EEVEE draws as its final look."""
    return any(toon_bands(slot.material) for obj in subjects() for slot in getattr(obj, "material_slots", []))


def is_final(spec):
    """Whether an EEVEE picture is the one to hand over: as the call or the scene says, or for the toon it shows."""
    asked = (spec or {}).get("final")
    return bool(kept().get("final") if asked is None else asked) or shows_toon()


def baked_volume():
    return any(o.type == "LIGHT_PROBE" and o.data.type == "VOLUME" and not o.hide_render for o in scene().objects)


def final_text(roofed):
    """What an EEVEE picture to hand over was drawn with, as sentences."""
    e = scene().eevee
    why = "as asked (eevee final)" if kept().get("final") else "for the toon materials it shows, which are drawn for EEVEE"
    rays = (
        f"ray tracing by {'the screen' if e.ray_tracing_method == 'SCREEN' else 'light probes'} at 1/{e.ray_tracing_options.resolution_scale} resolution"
        if e.use_raytracing
        else "no ray tracing, so glass and polished metal show dark"
    )
    said = (
        f" EEVEE makes this the picture to hand over, {why}: shadows of {e.shadow_ray_count} {'ray' if e.shadow_ray_count == 1 else 'rays'}"
        f" and {e.shadow_step_count} steps at {e.shadow_resolution_scale:.0%} resolution, {rays},"
        f" volumes in {e.volumetric_tile_size} px tiles of {e.volumetric_samples} samples"
        f" {'with' if e.use_volumetric_shadows else 'without'} their shadows, {e.taa_render_samples} samples."
    )
    if roofed and not baked_volume():
        said += " From inside a room EEVEE lets a sky's light through walls unless the room has a baked light probe volume: eevee probes true fits and bakes one."
    return said
