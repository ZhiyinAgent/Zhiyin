"""
blender_simulate's cloth, colliders and liquids, set up for the bake. A drape simulates the cloth
here until it comes to rest and keeps that as its shape, for stills; a cloth that moves is left to
simulate over the scene's frames. A liquid is set up and baked here, as its answer measures the
baked liquid.
"""

import bmesh
import bpy
import numpy

from . import sim_cloth_checks as checks
from . import sim_liquid
from .arguments import need
from .finding import find_objects, scene
from .sim_cloth_setup import edge_lengths, set_up, spacing_of
from .timeline import fps
from .wording import length

# A drape runs at most this long, and is at rest once no point moves further than this share
# of the spacing, or a millimetre, over its last frames.
MOST_SECONDS = 10
REST_SHARE = 0.02
DRAPE_AIR = 10


def apply(args):
    """
    The lines this part answers, none when the call gives none of its inputs, and the cloth to
    drape, if any: it is draped by settle once the call's colliders are set, so it meets them.
    """
    lines, draping = [], None
    if args.get("cloth") is not None:
        said, draping = cloth(args)
        lines += said
    if args.get("liquid") is not None:
        lines += sim_liquid.apply(args["liquid"])
    return lines, draping


def settle(draping, args):
    """The drape's lines: the cloth simulated over the colliders it was given and the call's own."""
    if draping is None:
        return []
    given = args.get("colliders") or {}
    met = list(draping["colliders"])
    met += [obj for obj in find_objects(given.get("objects") or []) if obj not in met]
    return drape({**draping, "colliders": met}, scene())


def cloth(args):
    made = set_up(args)
    obj, modifier = made["object"], made["modifier"]
    room = scene()
    if args["cloth"].get("drape") is True:
        need(
            obj.data.shape_keys is None,
            f"A drape keeps one shape, and “{obj.name}” has shape keys: remove them, or simulate without drape.",
        )
        return made["lines"], made
    cache = modifier.point_cache
    cache.frame_start, cache.frame_end = room.frame_start, room.frame_end
    seconds = (room.frame_end - room.frame_start + 1) / fps()
    return made["lines"] + [
        f"Moves over frames {room.frame_start}–{room.frame_end} ({seconds:.3g} s) from where it is at frame"
        f" {room.frame_start}; until it is baked, Blender simulates it as the scene plays from that frame."
    ], None


def after_bake(args):
    """
    A moving cloth measured once the bake has run: whether it rests at the end, and how sound it
    was where it stretched most. None when the call moves no cloth or its cloth is not baked.
    """
    given = args.get("cloth")
    if not isinstance(given, dict) or given.get("drape") is True:
        return []
    obj = bpy.data.objects.get(given.get("object") or "")
    modifier = next((m for m in obj.modifiers if m.type == "CLOTH"), None) if obj is not None else None
    if modifier is None or not modifier.point_cache.is_baked:
        return []
    cache = modifier.point_cache
    if args.get("bake") is not True:
        # A bake the call did not make was made before it set the cloth up again. Blender keeps it
        # and plays it as it was baked, so its measures would describe that cloth, not this one.
        return [
            f"{obj.name} keeps the bake made before this call set it up again, over frames {cache.frame_start}–{cache.frame_end},"
            " which Blender still plays as it was baked: it does not show what has changed since. Bake again with bake true"
            " to see it, or free the bake with bake false."
        ]
    room = scene()
    frame_before = room.frame_current
    rest = numpy.array(edge_lengths(obj))
    edges = numpy.array([tuple(e.vertices) for e in obj.data.edges], dtype=int).reshape(-1, 2)
    track, worst, stretch = [], None, -1.0
    try:
        for frame in range(room.frame_start, room.frame_end + 1):
            room.frame_set(frame)
            found = checks.points_of(obj)
            track.append(found)
            now = numpy.linalg.norm(found[edges[:, 0]] - found[edges[:, 1]], axis=1)
            most = float((now / numpy.maximum(rest, 1e-9)).max()) if numpy.isfinite(found).all() else numpy.inf
            if most > stretch:
                worst, stretch = (frame, found), most
        colliders = [o for o in (bpy.data.objects.get(n) for n in given.get("colliders") or []) if o is not None]
        frame, points = worst
        room.frame_set(frame)
        reach = checks.collider_reach(colliders, points) if numpy.isfinite(points).all() else []
        sound = checks.soundness_line(obj, track[0], points, rest, reach)
    finally:
        room.frame_set(frame_before)
    moving = checks.motion(track)
    end = (
        f"at rest at the end, no point moving more than {length(moving)} over its last {checks.LAST} frames"
        if moving <= max(0.001, REST_SHARE * spacing_of(obj))
        else f"still moving {length(moving)} over its last {checks.LAST} frames at the end"
    )
    return [
        f"{obj.name}, baked over frames {room.frame_start}–{room.frame_end}: {end}.",
        f"{sound.rstrip('.')}; measured at frame {frame}, where it stretched most.",
    ]


def drape(made, room):
    """Simulates until the cloth rests, keeps that shape as its mesh and takes the cloth away."""
    obj, modifier, spacing = made["object"], made["modifier"], made["spacing"]
    frame_before = room.frame_current
    most = round(MOST_SECONDS * fps())
    cache = modifier.point_cache
    cache.frame_start, cache.frame_end = 1, most + 1
    # Air resists only motion, so a cloth damped more comes to rest sooner in the same shape.
    modifier.settings.air_damping = DRAPE_AIR
    rest = numpy.array(edge_lengths(obj))
    room.frame_set(1)
    start = checks.points_of(obj)
    before_volume = checks.volume_of(obj, start) if made["pressure"] is not None else None
    track = [start]
    still = max(0.001, REST_SHARE * spacing)
    for frame in range(2, most + 2):
        room.frame_set(frame)
        track.append(checks.points_of(obj))
        if not numpy.isfinite(track[-1]).all() or checks.motion(track) <= still:
            break
    final = track[-1]
    moving = checks.motion(track)
    frames = len(track) - 1
    reach = checks.collider_reach(made["colliders"], final) if numpy.isfinite(final).all() else []
    lines = []
    sound = checks.soundness_line(obj, start, final, rest, reach)
    removed = "the cloth and the collision given for it removed" if made["made_colliders"] else "the cloth removed"
    if moving <= still:
        lines.append(
            f"Draped: came to rest after {frames / fps():.3g} s ({frames} frames), no point moving more than"
            f" {length(moving)} over its last {checks.LAST} frames; kept as its shape, {removed}, back at frame {frame_before}."
        )
    else:
        lines.append(
            f"Draped for {MOST_SECONDS} s, the most a drape runs, still moving {length(moving)} over its last {checks.LAST} frames:"
            f" kept as it was then, {removed}, back at frame {frame_before}. Pin it, or give a stiffer fabric, for it to settle."
        )
    lines += checks.rest_lines(reach)
    if numpy.isfinite(final).all():
        folds = checks.folds_line(obj, final, spacing)
        if folds:
            lines.append(folds)
    lines.append(sound)
    if made["pressure"] is not None and numpy.isfinite(final).all():
        lines.append(checks.pressure_line(made["pressure"], before_volume, checks.volume_of(obj, final)))
    if made["seams"]:
        lines.append(checks.seams_line(made["seams"], start, final))
    keep_shape(obj, modifier)
    for collider in made["made_colliders"]:
        for m in [m for m in collider.modifiers if m.type == "COLLISION"]:
            collider.modifiers.remove(m)
    room.frame_set(frame_before)
    return lines


def keep_shape(obj, modifier):
    """The mesh as the cloth left it, with the steps before the cloth, which it has taken in; those after stay."""
    steps = list(obj.modifiers)
    upto = steps.index(modifier)
    after = steps[upto + 1 :]
    shown = [m.show_viewport for m in after]
    for m in after:
        m.show_viewport = False
    try:
        depsgraph = bpy.context.evaluated_depsgraph_get()
        bm = bmesh.new()
        try:
            bm.from_object(obj, depsgraph)
            bm.to_mesh(obj.data)
        finally:
            bm.free()
    finally:
        for m, was in zip(after, shown):
            m.show_viewport = was
    for m in steps[: upto + 1]:
        obj.modifiers.remove(m)
    obj.data.update()
