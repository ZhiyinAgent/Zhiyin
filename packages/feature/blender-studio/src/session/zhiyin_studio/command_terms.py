"""
The terms the session holds its commands' inputs to, said once as it starts: of each input a
tool's schema also states, the choices it takes, the names an object of it takes, its least and
most, its longest text, its most items and its default; and the numbers a tool's description
or a studio page states in words. Each is the value the command checks with, so what is said is
what is held; a default that is Blender's own is read from Blender.

An input is named by its path in the command's arguments, a list's items under the list's own
name: operations.kind is the kind of each of operations. Its terms take JSON Schema's words:
enum, properties, minimum, maximum, maxLength, minItems, maxItems and default.
"""

import inspect
import math

import bpy

from . import (
    add_objects,
    animate,
    animate_drive,
    baking,
    camera,
    close_ups,
    contact,
    copies,
    decal_pictures,
    decal_relief,
    decal_shapes,
    decal_strips,
    decal_surface,
    decal_wrap,
    export,
    follow,
    frame_sheet,
    frame_times,
    library,
    lighting,
    lighting_caustics,
    lighting_fog,
    lighting_links,
    look,
    making,
    making_primitives,
    material,
    material_build,
    material_inputs,
    measuring,
    mesh_edits,
    motion_checks,
    render,
    render_checks,
    render_eevee,
    render_post,
    render_video,
    rig_bind,
    rig_bind_ik,
    rig_bind_pose,
    rig_bind_weights,
    scattering,
    settling,
    shaping,
    shaping_array,
    shaping_bevel,
    shaping_boolean,
    shaping_curve,
    shaping_deform,
    shaping_mirror,
    shaping_normals,
    shaping_remesh,
    shaping_subdivide,
    shaping_walls,
    sheets,
    sim_bodies_run,
    sim_bodies_setup,
    sim_cloth,
    sim_cloth_checks,
    sim_cloth_setup,
    sim_colliders,
    sim_liquid,
    sim_liquid_measures,
    sim_stability,
    stylised,
    stylised_lines,
    surface_quality,
    timeline,
    tolerances,
    unwrap_measures,
    unwrapping,
)
from .decal_objects import CHANNEL_RANGE, OFFSET
from .finishes_marks import MARKS


def choices(names):
    return {"enum": list(names)}


def counted(most, default=None):
    """A count of at least one."""
    return {"minimum": 1, "maximum": most, **({"default": default} if default is not None else {})}


def ranged(least, most, default=None):
    return {"minimum": least, "maximum": most, **({"default": default} if default is not None else {})}


def defaulting(value):
    return {"default": list(value) if isinstance(value, tuple) else value}


def kept(value):
    """A value Blender holds in single precision, as it was written."""
    return round(value, 6) if isinstance(value, float) else value


def blenders(kind, name):
    """The default Blender gives a property of its own, of a type or of Cycles's render settings."""
    struct = bpy.types.Scene.bl_rna.properties["cycles"].fixed_type if kind == "cycles" else kind.bl_rna
    held = struct.properties[name]
    return [kept(v) for v in held.default_array] if getattr(held, "is_array", False) else kept(held.default)


def in_mm(metres):
    return kept(metres * 1000)


def shaping_terms():
    takes = dict.fromkeys(name for kind in shaping.TAKES.values() for name in kind)
    cutter_takes = dict.fromkeys(name for kind in shaping_boolean.CUTTER_TAKES.values() for name in kind)
    return {
        "operations": {"properties": ["kind", *takes]},
        "operations.kind": choices(shaping.OPERATIONS),
        "operations.operation": choices(shaping_boolean.BOOLEAN_OPERATIONS),
        "operations.solver": choices([*shaping_boolean.SOLVERS, "auto"]),
        "operations.cutter": {"properties": [*shaping_boolean.CUTTER_PLACING, *cutter_takes]},
        "operations.cutter.shape": choices(shaping_boolean.OFFERED_SHAPES),
        "operations.width_type": choices(shaping_bevel.WIDTH_TYPES),
        "operations.limit": choices(shaping_bevel.LIMITS),
        "operations.miter_outer": choices(shaping_bevel.OUTER_MITERS),
        "operations.miter_inner": choices(shaping_bevel.INNER_MITERS),
        "operations.face_strength": choices(shaping_bevel.FACE_STRENGTHS),
        "operations.profile": ranged(*shaping_bevel.PROFILE),
        "operations.fit": choices(shaping_array.FITS),
        "operations.curve_axis": choices(shaping_array.DEFORM_AXES),
        "operations.around.angle": defaulting(shaping_array.AROUND),
        "operations.mode": choices(shaping_walls.MODES),
        "operations.wall_offset": ranged(*shaping_walls.WALL_OFFSET),
        "operations.scheme": choices(shaping_subdivide.SCHEMES),
        "operations.boundary": choices(shaping_subdivide.BOUNDARIES),
        "operations.uv_smooth": choices(shaping_subdivide.UV_SMOOTHING),
        "operations.crease": ranged(*shaping_subdivide.CREASE_AMOUNT),
        "operations.shading": choices(shaping_normals.SHADINGS),
        "operations.weighting": choices(shaping_normals.WEIGHTINGS),
        "operations.quads": choices(shaping_normals.QUAD_SPLITS),
        "operations.method": choices(shaping_remesh.METHODS),
        "operations.adaptivity": ranged(*shaping_remesh.ADAPTIVITY),
        "operations.texture": choices(shaping_deform.TEXTURES),
        "operations.direction": choices(shaping_deform.DIRECTIONS),
        "operations.space": choices(shaping_deform.SPACES),
        "operations.wrap": choices(shaping_deform.WRAPS),
        "operations.wrap_mode": choices(shaping_deform.WRAP_MODES),
        "operations.midlevel": ranged(*shaping_deform.MIDLEVEL),
        "operations.bevel_mode": choices(shaping_curve.BEVEL_MODES),
        "operations.profile_preset": choices(shaping_curve.PRESETS),
        "operations.taper_mode": choices(shaping_curve.TAPER_MODES),
        "operations.fill": choices({**shaping_curve.FILLS_3D, **shaping_curve.FILLS_2D}),
        "operations.twist": choices(shaping_curve.TWISTS),
    }


def shaping_numbers():
    levels, weight = shaping_subdivide.LEVELS, shaping_normals.WEIGHT
    return {
        "bevel_segments": shaping_bevel.SEGMENTS,
        "bevel_angle": shaping_bevel.ANGLE,
        "around_angle": shaping_array.AROUND,
        "mirror_merge_mm": in_mm(shaping_mirror.BLENDER_MERGE),
        "wall_offset": shaping_walls.WALL_OFFSET[2],
        **dict(zip(("least_levels", "most_levels", "levels"), levels, strict=True)),
        **dict(zip(("least_weight", "most_weight", "weight"), weight, strict=True)),
        "min_vertices": shaping_normals.MIN_VERTICES,
        "midlevel": shaping_deform.MIDLEVEL[2],
        "sliver_mm2": kept(shaping_boolean.SLIVER * 1e6),
    }


def shaping_words():
    return {
        "operation": shaping_boolean.OPERATION,
        "width_type": shaping_bevel.WIDTH_TYPE,
        "limit": shaping_bevel.LIMIT,
        "scheme": shaping_subdivide.SCHEME,
        "shading": shaping_normals.SHADING,
        "weighting": shaping_normals.WEIGHTING,
        "quads": shaping_normals.QUADS,
        "method": shaping_remesh.METHOD,
        "texture": shaping_deform.TEXTURE,
        "direction": shaping_deform.DIRECTION,
        "wrap": shaping_deform.WRAP,
        "wrap_mode": shaping_deform.WRAP_MODE,
    }


def adding_terms():
    least, most, default = making_primitives.ICOSPHERE_LEVELS
    return {
        "inputs": {
            "objects.location": defaulting(add_objects.LOCATION),
            "objects.subdivisions": ranged(least, most, default),
            "objects.top_ratio": ranged(*add_objects.TOP_RATIO),
        },
        "numbers": {
            "segments": making.SEGMENTS,
            "least_subdivisions": least,
            "most_subdivisions": most,
            "subdivisions": default,
            "quad_sphere_quads": making_primitives.QUAD_SPHERE_QUADS,
            "grid_columns": making_primitives.GRID_COLUMNS,
            "circle_points": making_primitives.CIRCLE_POINTS,
            "torus_rings": making.TORUS_RINGS,
        },
    }


def material_terms():
    amount = ranged(*material_inputs.AMOUNT)
    shares = ("metallic", "roughness", "wood", "transmission", "alpha", "coat", "diffuse_roughness")
    return {
        "inputs": {
            **{f"material.{name}": amount for name in shares},
            **{f"material.{mark.key}": amount for mark in MARKS},
            "material.specular": ranged(*material_inputs.AMOUNT, material_build.SPECULAR),
            "material.coat_roughness": ranged(*material_inputs.AMOUNT, material_build.COAT_ROUGHNESS),
            "toon": {"properties": list(material.TOON_TAKES)},
            "toon.bands": counted(stylised.MOST_BANDS, stylised.BANDS),
            "toon.shadow": {"default": stylised.SHADOW},
            "toon.rim.width": ranged(stylised.LEAST_RIM, stylised.MOST_RIM, stylised.RIM),
        },
        "numbers": {
            "specular": material_build.SPECULAR,
            "coat_roughness": material_build.COAT_ROUGHNESS,
            "most_bands": stylised.MOST_BANDS,
            "bands": stylised.BANDS,
            "shadow": stylised.SHADOW,
        },
    }


def decal_terms():
    shapes = decal_shapes.SHAPES
    return {
        "inputs": {
            **{channel: ranged(*CHANNEL_RANGE) for channel in ("roughness", "metal", "coat")},
            "offset": defaulting(OFFSET),
        },
        "numbers": {
            **{f"{shape}_aspect": kept(shapes[shape][0]) for shape in ("vent", "hinge", "seam")},
            "vent_slots": shapes["vent"][3],
            "grille_holes": shapes["grille"][3],
            "hinge_knuckles": shapes["hinge"][3],
            "paper_roughness": decal_wrap.ROUGHNESS["paper"],
            "film_roughness": decal_wrap.ROUGHNESS["clear"],
            "text_pixels": decal_pictures.TEXT_PIXELS,
            "offset_mm": in_mm(OFFSET),
            "eevee_apart_um": kept(decal_surface.EEVEE_PER_METRE * 1e6),
            "cycles_apart_um": kept(decal_surface.CYCLES_PER_METRE * 1e6),
            "stitch_pitch": decal_strips.PITCHES["stitch"],
            "dash_pitch": decal_strips.PITCHES["dash"],
            "shape_pitch": decal_relief.SHAPE_PITCH,
        },
    }


def simulating_terms():
    world = bpy.types.RigidBodyWorld
    gravity = blenders(bpy.types.Scene, "gravity")
    return {
        "inputs": {
            "rigid.friction": ranged(*sim_bodies_setup.FRICTION),
            "rigid.bounce": ranged(*sim_bodies_setup.BOUNCE),
            "world.gravity": {"default": gravity},
            "world.substeps": {"default": blenders(world, "substeps_per_frame")},
            "world.iterations": {"default": blenders(world, "solver_iterations")},
            "colliders.thickness": {"minimum": sim_colliders.THINNEST},
            "liquid.resolution": ranged(sim_liquid.LEAST_RESOLUTION, sim_liquid.MOST_RESOLUTION, sim_liquid.DRAFT),
        },
        "numbers": {
            "friction": sim_bodies_setup.FRICTION[2],
            "bounce": sim_bodies_setup.BOUNCE[2],
            "margin_mm": in_mm(tolerances.PHYSICS_MARGIN),
            "gravity_z": gravity[2],
            "substeps": blenders(world, "substeps_per_frame"),
            "iterations": blenders(world, "solver_iterations"),
            "liquid_resolution": sim_liquid.DRAFT,
            "thinnest_collider_mm": in_mm(sim_colliders.THINNEST),
            "particles_collider_mm": in_mm(sim_colliders.PARTICLES_ONLY),
            **{f"density {name}": kept(density) for name, density in sim_bodies_setup.DENSITIES.items()},
            "rest_speed_mm": in_mm(sim_bodies_run.REST_SPEED),
            "rest_turn": sim_bodies_run.REST_TURN,
            "rests_on_mm": in_mm(tolerances.SETTLED_ON),
            "blown_speed_share": sim_stability.SPEED_SHARE,
            "blown_least_speed": sim_stability.LEAST_LIMIT,
            "blown_growth": sim_stability.GROWN,
            "settled_seconds": sim_stability.LAST,
            "tuned_spacing_mm": in_mm(sim_cloth_setup.TUNED_SPACING),
            "most_cloth_points": sim_cloth_setup.MOST_VERTICES,
            "collision_share": sim_cloth_setup.COLLISION_SHARE,
            "drape_air": sim_cloth.DRAPE_AIR,
            "drape_rest_share": sim_cloth.REST_SHARE,
            "drape_last_frames": sim_cloth_checks.LAST,
            "drape_seconds": sim_cloth.MOST_SECONDS,
            "sharp_fold": sim_cloth_checks.SHARP_FOLD,
            "grid_bound": sim_cloth_checks.GRID_BOUND,
            "exploded": sim_cloth_checks.EXPLODED,
            "domain_margin": sim_liquid.MARGIN_SHARE,
            "holding_voxels": sim_liquid.HOLDING_VOXELS,
            "measured_frames": sim_liquid_measures.MEASURED_FRAMES,
        },
    }


def camera_terms():
    _, most, default = camera.MARGIN
    return {
        "inputs": {
            "frame.margin": ranged(*camera.MARGIN),
            "depth_of_field.aperture": ranged(*camera.APERTURE),
            "exposure": {"default": blenders(bpy.types.ColorManagedViewSettings, "exposure")},
            "outlines.thickness": defaulting(stylised_lines.THICKNESS),
        },
        "numbers": {
            "most_margin": most,
            "margin": default,
            "aperture": camera.APERTURE[2],
            "freestyle_crease": stylised_lines.CREASES["freestyle"],
            "line_art_crease": stylised_lines.CREASES["line_art"],
            "thickness": stylised_lines.THICKNESS,
        },
        "words": {"outline_colour": stylised_lines.COLOUR},
    }


def lighting_terms():
    least, most, default = lighting.SUN_ELEVATION
    return {
        "inputs": {
            "background.sky.sun_elevation": ranged(least, most, default),
            "background.sky.sun_rotation": defaulting(lighting.SUN_ROTATION),
            "lights.look_at": defaulting(lighting.LOOK_AT),
            "lights.strength": defaulting(lighting.SUN_STRENGTH),
            "lights.angle": defaulting(lighting.REAL_SUN),
            "backdrop_reflections": ranged(*lighting.REFLECTIONS_RANGE, lighting.REFLECTIONS),
            "cards.size": defaulting(lighting_links.CARD_SIZE),
            "cards.strength": defaulting(lighting_links.CARD_STRENGTH),
            "fog.anisotropy": ranged(*lighting_fog.ANISOTROPY),
            "caustics.filter_glossy": {"default": blenders("cycles", "blur_glossy")},
        },
        "numbers": {
            "least_sun_elevation": least,
            "most_sun_elevation": most,
            "sun_elevation": default,
            "sun_angle": lighting.REAL_SUN,
            "least_kelvin": lighting.KELVIN[0],
            "most_kelvin": lighting.KELVIN[1],
            "backdrop_reflections": lighting.REFLECTIONS,
            "fog_seen_through": lighting_fog.SEEN_THROUGH,
            "caustics_brighter": lighting_caustics.BRIGHTER,
        },
    }


def render_terms():
    noise_threshold = blenders("cycles", "adaptive_threshold")
    shadow_ranges = {
        "shadow_rays": render_eevee.SHADOW_RAYS,
        "shadow_steps": render_eevee.SHADOW_STEPS,
        "shadow_resolution": render_eevee.SHADOW_RESOLUTION,
    }
    return {
        "inputs": {
            "samples": {"maximum": render.MOST_SAMPLES},
            "frame.margin": ranged(*camera.MARGIN),
            "sampling.noise_threshold": {"default": noise_threshold},
            "post.amount": ranged(*render_post.AMOUNT),
            "eevee.shadows.rays": ranged(*render_eevee.SHADOW_RAYS),
            "eevee.shadows.steps": ranged(*render_eevee.SHADOW_STEPS),
            "eevee.shadows.resolution": ranged(*render_eevee.SHADOW_RESOLUTION),
            "eevee.raytracing.method": choices([*render_eevee.METHODS, "off"]),
            "eevee.raytracing.resolution": choices(int(size) for size in render_eevee.SIZES),
            "eevee.volumes.tile": choices(int(size) for size in render_eevee.SIZES),
            "eevee.volumes.samples": ranged(*render_eevee.VOLUME_SAMPLES),
        },
        "numbers": {
            **{f"{engine}_samples": samples for engine, samples in render.SAMPLES_BY_ENGINE.items()},
            "plan_cut": render.PLAN_CUT,
            "cheap_seconds": render_checks.CHEAP,
            "noise_threshold": noise_threshold,
            "indirect_clamp": blenders("cycles", "sample_clamp_indirect"),
            **{f"least_{name}": least for name, (least, _) in shadow_ranges.items()},
            **{f"most_{name}": most for name, (_, most) in shadow_ranges.items()},
            "glare_highlight": render_post.HIGHLIGHT,
            "post_amount": render_post.AMOUNT[2],
        },
        "words": {"background": render.BACKGROUND},
    }


def signatures():
    """Each function of the library a script reaches as zhiyin, by its name, with its arguments and defaults as Python declares them."""
    return {name: str(inspect.signature(function)) for name, function in library.FUNCTIONS.items()}


def terms():
    """Each command's terms, by the command's name: its inputs', its stated numbers and words, and the script's library."""
    longest = {"maximum": timeline.LONGEST}
    tile = ranged(look.NARROWEST, look.WIDEST, look.TILE)
    return {
        "script": {"signatures": signatures(), "numbers": {"grid_span_part": mesh_edits.SPAN_PART}},
        "add": adding_terms(),
        "edit": {
            "inputs": {
                "edits.duplicate.around.angle": defaulting(copies.WHOLE_TURN),
                "edits.distribute.along.circle.angle": defaulting(copies.WHOLE_TURN),
                "edits.against.gap": defaulting(contact.AGAINST_GAP),
            }
        },
        "settle": {
            "inputs": {
                "seconds": ranged(*settling.SECONDS),
                "friction": ranged(*settling.FRICTION),
                "bounce": ranged(*settling.BOUNCE),
            },
            "numbers": {"margin_mm": in_mm(tolerances.PHYSICS_MARGIN)},
            "words": {"shape": settling.SHAPE},
        },
        "shape": {"inputs": shaping_terms(), "numbers": shaping_numbers(), "words": shaping_words()},
        "material": material_terms(),
        "scatter": {
            "inputs": {
                "count": counted(scattering.MOST["instances"]),
                "spacing": defaulting(scattering.SPACING),
                "jitter.seed": defaulting(scattering.SEED),
                "jitter.turn": defaulting(scattering.TURN),
                "jitter.scale": defaulting(scattering.SCALE),
            },
            "numbers": {
                "most_objects": scattering.MOST["objects"],
                "most_instances": scattering.MOST["instances"],
                "weight": scattering.WEIGHT,
                "tries_each": scattering.TRIES_EACH,
                "fewest_tries": scattering.FEWEST_TRIES,
                "most_tries": scattering.MOST_TRIES,
            },
        },
        "decal": decal_terms(),
        "unwrap": {
            "inputs": {
                "pack.margin_px": defaulting(unwrapping.MARGIN_PX),
                "texel_density.resolution": defaulting(unwrapping.RESOLUTION),
            },
            "numbers": {
                "sharp_angle": unwrapping.SHARP,
                "smart_angle": unwrapping.SMART,
                "density_share": round(100 * (1 - 2 * unwrap_measures.DENSITY_TAIL)),
                "texel_resolution": unwrapping.RESOLUTION,
            },
        },
        "bake": {
            "inputs": {"resolution": ranged(*baking.RESOLUTIONS, baking.RESOLUTION)},
            "numbers": {"resolution": baking.RESOLUTION, "margin_share": baking.MARGIN_SHARE},
        },
        "rig": {
            "inputs": {"bind.influences": counted(rig_bind.MOST_INFLUENCES), "ik.chain": {"minimum": 1}},
            "numbers": {
                "engine_most": rig_bind_weights.ENGINE_MOST,
                "pose_turn": round(math.degrees(rig_bind_pose.TURN)),
                "pose_near_share": rig_bind_pose.NEAR_SHARE,
                "pose_kept_share": rig_bind_pose.KEPT,
                "pose_seconds": rig_bind_pose.BUDGET,
                "target_chain": rig_bind_ik.TARGET_CHAIN,
            },
        },
        "simulate": simulating_terms(),
        "camera": camera_terms(),
        "lighting": lighting_terms(),
        "render": render_terms(),
        "animate": {
            "inputs": {
                "fps": counted(animate.MOST_FPS, blenders(bpy.types.RenderSettings, "fps")),
                "duration": longest,
                "paths.bank": ranged(-animate.MOST_BANK, animate.MOST_BANK),
                "follow.ratio": defaulting(follow.RATIO),
                "follow.formula": {"maxLength": follow.LONGEST_FORMULA},
                "drive.formula": {"maxLength": follow.LONGEST_FORMULA},
                "drive.variables": {"minItems": 1, "maxItems": len(animate_drive.NAMES)},
                "drive.variables.kind": choices(animate_drive.KINDS),
                "drive.combine": choices(animate_drive.COMBINE),
                "cad_motion.from": defaulting(timeline.START),
                "belts.from": defaulting(timeline.START),
            },
            "numbers": {
                "start": timeline.START,
                "blender_frames": blenders(bpy.types.Scene, "frame_end"),
                "follow_ratio": follow.RATIO,
            },
        },
        "frames": {
            "inputs": {
                "time": defaulting(timeline.START),
                "count": counted(frame_times.MOST_FRAMES, frame_times.FRAMES),
                "tile_width": ranged(*frame_sheet.FRAME_WIDTHS, frame_sheet.FRAME_WIDTH),
                "objects": {"maxItems": sheets.MOST_FOLLOWED},
                "end": longest,
            },
            "numbers": {"most_scanned": motion_checks.MOST_SCANNED},
        },
        "closeups": {
            "inputs": {
                "objects": {"maxItems": sheets.MOST_FOLLOWED},
                "main": counted(sheets.MOST_FOLLOWED),
                "tile_width": ranged(close_ups.NARROWEST, close_ups.WIDEST, close_ups.TILE),
            }
        },
        "look": {
            "inputs": {
                "tile_width": tile,
                "shading": choices(look.SHADINGS),
                "stripes": choices(surface_quality.AXES),
            }
        },
        "measure": {"numbers": {"next": measuring.NEXT, "touch_mm": in_mm(tolerances.TOUCH)}},
        "video": {
            "inputs": {
                "start": {**longest, **defaulting(timeline.START)},
                "end": longest,
                "every": counted(render_video.MOST_EVERY),
                "slow_motion": ranged(1, render_video.SLOWEST),
                "samples": {"maximum": render_video.MOST_SAMPLES},
                "sampling.noise_threshold": {"default": blenders("cycles", "adaptive_threshold")},
            },
            "numbers": {
                "longest_video": render_video.LONGEST_VIDEO,
                **{f"{engine}_samples": samples for engine, samples in render_video.SAMPLES_BY_ENGINE.items()},
            },
        },
        "export": {"inputs": {"bake_size": ranged(export.LEAST_BAKE, export.MOST_BAKE, export.BAKE)}},
    }
