"""
blender_animate: objects and bones keyed over time, moved along paths, kept aimed at others,
moving with others and driven by them, and their motion cleared.

Times are seconds from the start of the timeline, which is frame 1. A key of an attached part is
on what it is attached to, as a joint turns on the part before it; every other key is in the
world's terms, as the other tools give places and turns.
"""

import math
import re

import bpy
import mathutils

from .aiming import keeps_focus
from .animate_aims import AIM, AXES, aim_one, unaim
from .animate_bones import key_bone, save_pose
from .animate_drive import drive_one
from .animate_loops import extend, extended, keep_cycles_whole, loop_said
from .animate_measures import forget, settle
from .arguments import colour, is_number, need, number, positive_size, rotation, vector, whole
from .belts import run_one
from .cad_motion import key_motion
from .errors import Refused
from .finding import find_object, find_objects, is_helper, scene
from .follow import described as follows_described
from .follow import follow_one, key_formulas, need_unfollowed, unfollow
from .geometry import own_size
from .glass import lets_light_through_sheets
from .keys import EASINGS, curves_of, eased, shift_keys
from .placing import slanted_by, unslanted_on
from .scales import built_at, even, shape_scale
from .timeline import LONGEST, fps, frame_of, moment, seconds_of, seconds_text, timeline_text
from .wood import lays_grain
from .wording import hex_of, length, listed, point_text

# The most frames a second.
MOST_FPS = 120
# The most degrees a part on a path leans into its turns, either way.
MOST_BANK = 80
# A path's position is keyed this many times a second at least, so the
# motion between keys follows its curve.
PATH_KEYS_PER_SECOND = 24
# How many points of a path's smooth curve are taken between two of its own.
PATH_STEPS = 32


def set_timeline(args):
    """Sets the frames a second and the length, when given; keeps keys at their times."""
    s = scene()
    said = []
    if args.get("fps") is not None:
        new = whole(args["fps"], "fps", minimum=1, maximum=MOST_FPS)
        old = fps()
        if abs(new - old) > 1e-9:
            # Keys stay at the same times, so the motion keeps its speed.
            end = seconds_of(s.frame_end)
            moved = set()
            for owner in animated_owners():
                for curve in curves_of(owner):
                    # Owners a script made share one action move its keys once.
                    if curve.as_pointer() in moved:
                        continue
                    moved.add(curve.as_pointer())
                    for key in curve.keyframe_points:
                        at = seconds_of(key.co.x)
                        key.co.x = s.frame_start + at * new
                        key.handle_left.x = s.frame_start + seconds_of(key.handle_left.x) * new
                        key.handle_right.x = s.frame_start + seconds_of(key.handle_right.x) * new
                    curve.update()
            s.render.fps, s.render.fps_base = new, 1
            s.frame_end = round(s.frame_start + end * new)
            said.append(f"{new} frames a second")
    if args.get("duration") is not None:
        duration = number(args["duration"], "duration", minimum=1 / fps())
        need(
            duration <= LONGEST,
            f"duration is at most {LONGEST} s, the longest a timeline runs. Make a longer film from several scenes,"
            f" each at most {LONGEST} s, each rendered as videos of its own.",
        )
        s.frame_end = max(s.frame_start + 1, round(frame_of(duration)))
        s[TIMELINE_SET] = True
        said.append(f"{seconds_text(duration)} long")
    return said


# Marks a scene whose timeline's length a call set, which keys no longer shorten.
TIMELINE_SET = "zhiyin_timeline_set"
# A new scene's timeline, in frames, which no one chose.
BLENDER_TIMELINE = (1, 250)


def shortened(s):
    """
    Ends a timeline no call set and still at a new scene's 250 frames at the scene's last key,
    so the motion does not stop and hold for seconds no one asked for; answers what it says of it.
    Motion carried on past its keys keeps the timeline as it is.
    """
    if s.get(TIMELINE_SET) or (s.frame_start, s.frame_end) != BLENDER_TIMELINE:
        return ""
    curves = [curve for owner in animated_owners() for curve in curves_of(owner)]
    if not curves or any(curve.modifiers for curve in curves):
        return ""
    last = max(key.co.x for curve in curves for key in curve.keyframe_points)
    end = max(s.frame_start + 1, math.ceil(last - 1e-6))
    if end >= s.frame_end:
        return ""
    held = seconds_of(s.frame_end) - seconds_of(end)
    s.frame_end = end
    return (
        f" It ends at the last key, at {seconds_text(seconds_of(end))}, rather than holding the last pose for {seconds_text(held)}"
        " more as a new scene's 250 frames would: give duration for a hold after it."
    )


def owners_of(obj):
    """
    What can hold an object's keys: itself, its camera, light or mesh, the
    mesh's shapes, and its materials and their surfaces.
    """
    owners = [obj, obj.data, getattr(obj.data, "shape_keys", None)]
    for material in dict.fromkeys(slot.material for slot in obj.material_slots if slot.material is not None):
        owners += [material, material.node_tree]
    return [owner for owner in owners if owner is not None]


def animated_owners():
    """
    Everything in the scene that can hold keys, each once: its objects' own,
    the world's, and the scene itself.
    """
    s = scene()
    owners = [s]
    if s.world is not None:
        owners += [s.world, s.world.node_tree]
    for obj in s.objects:
        owners += owners_of(obj)
    seen = set()
    for owner in owners:
        if owner is None or owner.as_pointer() in seen:
            continue
        seen.add(owner.as_pointer())
        if curves_of(owner):
            yield owner




def keyed(owner, path, frame, easing, index=-1):
    """Keys `path` of `owner` at `frame`, and returns the curves the key went on."""
    owner.keyframe_insert(path, index=index, frame=frame)
    curves = [c for c in curves_of(owner) if c.data_path == path and (index < 0 or c.array_index == index)]
    eased(curves, frame, easing)
    return curves


def parent_space(obj):
    """What a key of this object is relative to: its parent's axes, or the world's."""
    return f" on {obj.parent.name}'s axes" if obj.parent else ""


def attach_plainly(obj):
    """
    Makes an attached part's own place its place on its parent, keeping where
    it is: Blender keeps a hidden correction from the moment it was attached,
    which a key on the part would otherwise be measured from.
    """
    if obj.parent is None:
        return
    inverse = obj.matrix_parent_inverse.copy()
    if inverse == mathutils.Matrix.Identity(4):
        return
    keyed = {c.data_path for c in curves_of(obj)} & {"location", "rotation_euler", "rotation_quaternion", "rotation_axis_angle", "scale"}
    moves_only = all(
        abs(inverse[r][c] - (1.0 if r == c else 0.0)) <= 1e-6 for r in range(3) for c in range(3)
    )
    # Its keys are places measured from that correction: one that only moves
    # it moves them too; one that turns or stretches it would leave them behind.
    need(
        not keyed or moves_only,
        f"“{obj.name}” moves by keys measured from a turned or stretched frame Blender keeps for it on "
        f"“{obj.parent.name}”, which a new key would leave behind. Clear its keys first, then key it again.",
    )
    basis = inverse @ obj.matrix_basis
    obj.matrix_parent_inverse = mathutils.Matrix.Identity(4)
    obj.matrix_basis = basis
    if keyed:
        shift_keys(obj, "location", list(inverse.translation))


def material_of(obj, name):
    material = obj.active_material
    need(material is not None, f"“{obj.name}” has no material, so its {name} cannot be keyed. Give it one with blender_set_material.")
    need(material.use_nodes and material.node_tree is not None, f"“{obj.name}”'s material has no surface to key.")
    surface = next((n for n in material.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    need(surface is not None, f"“{obj.name}”'s material has no Principled surface to key.")
    return material, surface


def resolved(owner, path):
    """The owner of a property and its own name, from a path such as modifiers["Array"].count."""
    try:
        if "." in path or "[" in path:
            head, _, last = path.rpartition(".")
            holder = owner.path_resolve(head) if head else owner
            need(not last.endswith("]"), "A property path ends at a property's name, such as data.energy.")
            return holder, last
        return owner, path
    except ValueError as error:
        raise Refused(f"{path} is not a property of {owner.name}.") from error


def custom(path):
    """The holder's path and the name of a custom property a path ends at, as ["open"] or data["level"]; or nothing."""
    found = re.fullmatch(r"(.*)\[\s*(['\"])([^'\"]+)\2\s*\]", path.strip())
    return (found.group(1).rstrip("."), found.group(3)) if found else None


def set_custom(owner, path, head, key, values, frame, easing, said):
    """
    A key on a custom property, as a door's ["open"] that its parts follow: made where it is
    missing, as a number or a list of them, then keyed on the data block that holds it.
    """
    try:
        holder = owner.path_resolve(head) if head else owner
    except ValueError as error:
        raise Refused(f"{head} is not a property of {owner.name}.") from error
    need(
        not isinstance(holder, bpy.types.bpy_prop_collection),
        f"{path} names an item of {head}, not a value: end the path at one of its values, as modifiers[\"Array\"].count,"
        " or at a custom property, as [\"open\"].",
    )
    value = float(values[0]) if len(values) == 1 else [float(v) for v in values]
    try:
        current = holder.get(key)
        if current is not None and hasattr(current, "__len__") and not isinstance(current, str):
            need(len(values) == len(current), f"{path} takes {len(current)} values.")
        elif current is not None:
            need(len(values) == 1 and isinstance(current, (int, float)), f"{path} takes one number.")
        holder[key] = value
    except TypeError as error:
        raise Refused(f"{head or owner.name} holds no custom properties, so {path} cannot be keyed: {error}") from error
    block = holder.id_data
    full = (holder.path_from_id() if holder != block else "") + f'["{key}"]'
    try:
        block.keyframe_insert(full, frame=frame)
    except (TypeError, RuntimeError) as error:
        raise Refused(f"{path} cannot be keyed: {error}") from error
    eased([c for c in curves_of(block) if c.data_path == full], frame, easing)
    said.append(f"{path} {', '.join(f'{v:g}' for v in values)}" + (", a custom property made for it" if current is None else ""))


def set_property(obj, spec, frame, easing, said):
    """A key on any animatable property: of the object, its camera or light, or its material, or a custom property of one."""
    on = spec.get("on", "object")
    need(on in ("object", "data", "material"), "property.on is object, data or material.")
    path = spec.get("path")
    need(isinstance(path, str) and path.strip(), "property.path names the property, such as data.energy or modifiers[\"Array\"].count.")
    owner = obj if on == "object" else obj.data if on == "data" else obj.active_material
    need(owner is not None, f"“{obj.name}” has no {on} to key.")
    values = spec.get("values")
    need(
        isinstance(values, list) and values and all(is_number(v) for v in values),
        "property.values is a list of numbers: one for a single value, several for a colour or a position.",
    )
    found = custom(path)
    if found is not None:
        return set_custom(owner, path, *found, values, frame, easing, said)
    holder, name = resolved(owner, path)
    try:
        current = getattr(holder, name)
    except AttributeError as error:
        raise Refused(f"{path} is not a property of {owner.name}.") from error
    if hasattr(current, "__len__") and not isinstance(current, str):
        need(len(values) == len(current), f"{path} takes {len(current)} values.")
        setattr(holder, name, [float(v) for v in values])
    else:
        need(len(values) == 1, f"{path} takes one value.")
        kind = type(current)
        need(kind in (int, float, bool), f"{path} cannot be keyed.")
        setattr(holder, name, kind(values[0]) if kind is not bool else bool(values[0]))
    # Keyed on the data block that holds it: a material's surface values live
    # in its node tree, which keeps keys of its own.
    block = holder.id_data
    full = holder.path_from_id(name)
    try:
        block.keyframe_insert(full, frame=frame)
    except (TypeError, RuntimeError) as error:
        raise Refused(f"{path} cannot be keyed: {error}") from error
    eased([c for c in curves_of(block) if c.data_path == full], frame, easing)
    said.append(f"{path} {', '.join(f'{v:g}' for v in values)}")


def unslanted(obj, factors):
    """
    Refuses a keyed scale that would slant what is attached: a scale keyed on
    a part scales what is attached to it with it, as Blender's parts do, and
    unevenly that slants a part turned on it.
    """
    if even(factors):
        return
    turned = slanted_by(obj)
    need(
        not turned,
        f"“{obj.name}” has parts attached turned on it ({', '.join(turned[:4])}), which keying an uneven scale would "
        "slant. Key one factor on every side, or detach them first.",
    )


def key_one(spec, said_by_object):
    if spec.get("bone") is not None or spec.get("pose") is not None:
        return key_bone(spec, said_by_object)
    obj = find_object(spec.get("object"))
    at = moment(spec.get("at"), "at")
    easing = spec.get("easing", "smooth")
    need(easing in EASINGS, f"easing is one of {', '.join(EASINGS)}.")
    frame = frame_of(at)
    said = []
    attach_plainly(obj)
    for field, path, what in (
        ("location", "location", "place"),
        ("rotation", "rotation_euler", "turn"),
        ("size", "scale", "size"),
        ("scale", "scale", "scale"),
    ):
        if spec.get(field) is not None:
            need_unfollowed(obj, path, what)
    if spec.get("location") is not None:
        obj.location = vector(spec["location"], "location")
        keyed(obj, "location", frame, easing)
        said.append(f"at {point_text(obj.location)}{parent_space(obj)}")
    if spec.get("rotation") is not None:
        obj.rotation_mode = "XYZ"
        obj.rotation_euler = rotation(spec["rotation"])
        keyed(obj, "rotation_euler", frame, easing)
        unslanted_on(obj, "Key it square to it, or detach it first.")
        said.append("turned (" + ", ".join(f"{v:g}°" for v in spec["rotation"]) + f"){parent_space(obj)}")
    if spec.get("size") is not None:
        size = positive_size(spec["size"], "size")
        # Measured as it is now: an earlier key in this call may have resized it.
        bpy.context.view_layer.update()
        current = own_size(obj)
        need(current is not None and all(c > 1e-9 for c in current), f"“{obj.name}” is flat or empty, so it cannot be given a size; key scale instead.")
        unslanted(obj, [size[i] / current[i] for i in range(3)])
        obj.scale = [obj.scale[i] * size[i] / current[i] for i in range(3)]
        keyed(obj, "scale", frame, easing)
        said.append(f"{length(size[0])} × {length(size[1])} × {length(size[2])}")
    if spec.get("scale") is not None:
        # Factors on its built size, which its own shape may hold some of.
        shaped = shape_scale(obj)
        built = built_at(obj)
        scale = positive_size(spec["scale"], "scale")
        # Keyed on its own scale, which what it is attached to multiplies now.
        bpy.context.view_layer.update()
        world = list(obj.matrix_world.to_scale())
        holder = [world[i] / obj.scale[i] if abs(obj.scale[i]) > 1e-12 else 1.0 for i in range(3)]
        wanted = [scale[i] * built[i] / shaped[i] / holder[i] for i in range(3)]
        unslanted(obj, [wanted[i] / obj.scale[i] if abs(obj.scale[i]) > 1e-12 else 1.0 for i in range(3)])
        obj.scale = wanted
        keyed(obj, "scale", frame, easing)
        said.append("scaled (" + ", ".join(f"{v:g}" for v in spec["scale"]) + ")")
    if spec.get("hidden") is not None:
        hidden = bool(spec["hidden"])
        for part in (obj, *obj.children_recursive):
            part.hide_render = hidden
            part.hide_viewport = hidden
            # Shown or hidden from that moment, never half way.
            keyed(part, "hide_render", frame, "constant")
            keyed(part, "hide_viewport", frame, "constant")
        said.append("hidden" if hidden else "shown")
    if spec.get("lens") is not None:
        need(obj.type == "CAMERA", f"lens is a camera's; “{obj.name}” is a {obj.type.lower()}.")
        obj.data.lens = number(spec["lens"], "lens", minimum=1, maximum=5000)
        keyed(obj.data, "lens", frame, easing)
        said.append(f"lens {obj.data.lens:g} mm")
    if spec.get("power") is not None:
        need(obj.type == "LIGHT", f"power is a light's; “{obj.name}” is a {obj.type.lower()}.")
        obj.data.energy = number(spec["power"], "power", minimum=0)
        keyed(obj.data, "energy", frame, easing)
        said.append(f"power {obj.data.energy:g}")
    if spec.get("color") is not None:
        rgba = colour(spec["color"], "color")
        if obj.type == "LIGHT":
            obj.data.color = rgba[:3]
            keyed(obj.data, "color", frame, easing)
            said.append(f"light colour {hex_of(rgba)}")
        else:
            material, surface = material_of(obj, "colour")
            surface.inputs["Base Color"].default_value = rgba
            path = surface.inputs["Base Color"].path_from_id("default_value")
            material.node_tree.keyframe_insert(path, frame=frame)
            eased([c for c in curves_of(material.node_tree) if c.data_path == path], frame, easing)
            said.append(f"colour {hex_of(rgba)}, in every object with {material.name}")
    if spec.get("glow") is not None:
        material, surface = material_of(obj, "glow")
        surface.inputs["Emission Strength"].default_value = number(spec["glow"], "glow", minimum=0)
        if spec.get("color") is None and tuple(surface.inputs["Emission Color"].default_value)[:3] == (0, 0, 0):
            surface.inputs["Emission Color"].default_value = surface.inputs["Base Color"].default_value
        path = surface.inputs["Emission Strength"].path_from_id("default_value")
        material.node_tree.keyframe_insert(path, frame=frame)
        eased([c for c in curves_of(material.node_tree) if c.data_path == path], frame, easing)
        said.append(f"glow {spec['glow']:g}, in every object with {material.name}")
    if spec.get("property") is not None:
        set_property(obj, spec["property"], frame, easing, said)
    need(said, f"The key at {seconds_text(at)} for “{obj.name}” sets nothing: give location, rotation, size, scale, hidden, lens, power, color, glow or property.")
    said_by_object.setdefault(obj.name, []).append(f"{seconds_text(at)}: {', '.join(said)}" + ("" if easing == "smooth" else f", reached {easing.replace('_', ' ')}"))
    return at




def through(points, closed):
    """A smooth curve through every point (Catmull-Rom), as many points close together."""
    if closed:
        points = points + [points[0]]
    count = len(points)
    if count == 2:
        return [points[0].lerp(points[1], i / PATH_STEPS) for i in range(PATH_STEPS + 1)]
    curve = []
    for i in range(count - 1):
        p0 = points[i - 1] if i > 0 else (points[-2] if closed else points[0] * 2 - points[1])
        p1, p2 = points[i], points[i + 1]
        p3 = points[i + 2] if i + 2 < count else (points[1] if closed else points[-1] * 2 - points[-2])
        for step in range(PATH_STEPS):
            t = step / PATH_STEPS
            t2, t3 = t * t, t * t * t
            curve.append(
                0.5
                * (
                    2 * p1
                    + (-p0 + p2) * t
                    + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
                    + (-p0 + 3 * p1 - 3 * p2 + p3) * t3
                )
            )
    curve.append(points[-1].copy())
    return curve


def ease_share(share, easing):
    """How far along a path an object is at `share` of its time, by its easing."""
    if easing in ("linear", "constant"):
        return share
    if easing == "ease_in":
        return 1 - math.cos(share * math.pi / 2)
    if easing == "ease_out":
        return math.sin(share * math.pi / 2)
    return (1 - math.cos(share * math.pi)) / 2


def curve_points(name, obj):
    """
    The route a curve object draws, as many points close together on the axes the moving
    object's keys are on, and whether it closes on itself.
    """
    route = find_object(name, {"CURVE"})
    need(route != obj, "An object cannot follow a path along itself.")
    need(len(route.data.splines), f"“{route.name}” has no splines to follow.")
    # Its first spline's line, whatever thickness or bevel it is drawn with.
    spline = route.data.splines[0]
    closed = spline.use_cyclic_u
    if spline.type == "BEZIER":
        knots = list(spline.bezier_points) + ([spline.bezier_points[0]] if closed else [])
        need(len(knots) >= 2, f"“{route.name}”'s spline has one point: there is no route to follow.")
        own = [knots[0].co.copy()]
        for a, b in zip(knots, knots[1:]):
            own += mathutils.geometry.interpolate_bezier(a.co, a.handle_right, b.handle_left, b.co, PATH_STEPS + 1)[1:]
    else:
        need(spline.type == "POLY", f"“{route.name}” is a NURBS curve: make it a Bezier or poly curve to follow it.")
        own = [p.co.xyz for p in spline.points] + ([spline.points[0].co.xyz] if closed else [])
        need(len(own) >= 2, f"“{route.name}”'s spline has one point: there is no route to follow.")
    world = [route.matrix_world @ p for p in own]
    if closed:
        world.pop()
    # On what the object is attached to, as its keys are.
    into = obj.parent.matrix_world.inverted() if obj.parent is not None else mathutils.Matrix.Identity(4)
    points = [into @ p for p in world]
    if closed:
        points.append(points[0].copy())
    return route, points, closed


def behind(curve, lengths, distance, closed):
    """The point `distance` along a curve, run on straight past its ends, or round it when it is closed."""
    total = lengths[-1]
    if closed:
        distance %= total
    elif distance < 0 or distance > total:
        a, b = (curve[0], curve[1]) if distance < 0 else (curve[-2], curve[-1])
        way = (b - a).normalized()
        return (curve[0] if distance < 0 else curve[-1]) + way * (distance if distance < 0 else distance - total)
    for i in range(1, len(curve)):
        if lengths[i] >= distance or i == len(curve) - 1:
            span = lengths[i] - lengths[i - 1]
            return curve[i - 1].lerp(curve[i], (distance - lengths[i - 1]) / span if span > 1e-12 else 0)
    return curve[-1].copy()


def path_one(spec, said_by_object):
    """
    Keys an object along a smooth path, through points or along a curve, eased, facing ahead and
    leaning into its turns where asked; a train behind it follows on the same route, so far apart.
    """
    obj = find_object(spec.get("object"))
    train = find_objects(spec.get("train") or [])
    need(obj not in train, f"“{obj.name}” leads the train, so it is not one of its cars.")
    spacing = spec.get("spacing")
    need((spacing is None) == (not train), "spacing is how far apart the train's objects ride: give both, or neither.")
    spacing = number(spacing, "spacing", minimum=1e-4) if train else 0.0
    movers = [obj, *train]
    for one in movers:
        need_unfollowed(one, "location", "place")
        if spec.get("facing") is not None:
            need_unfollowed(one, "rotation_euler", "turn")
    start = moment(spec.get("from"), "from")
    end = moment(spec.get("to"), "to")
    need(end > start, "A path's to must come after its from.")
    easing = spec.get("easing", "ease_in_out")
    need(easing in EASINGS and easing not in ("bounce", "elastic", "overshoot"), "A path's easing is linear, ease_in, ease_out or ease_in_out.")
    facing = spec.get("facing")
    need(facing is None or facing in AXES, f"facing is one of {', '.join(AXES)}.")
    bank = number(spec.get("bank"), "bank", minimum=-MOST_BANK, maximum=MOST_BANK, default=0)
    need(not bank or facing, "bank leans an object into its turns about the axis it faces along: give facing too.")
    for one in movers:
        attach_plainly(one)
    route = None
    if spec.get("curve") is not None:
        need(spec.get("points") is None, "A path goes through points or along a curve: give one of them.")
        route, curve, closed = curve_points(spec["curve"], obj)
        need(not train or all(o.parent == obj.parent for o in train), "A train's objects are attached to the same object as the one it follows, or to none.")
        through_said = f"along {route.name}"
    else:
        raw = spec.get("points")
        need(isinstance(raw, list) and len(raw) >= 2, "A path needs at least 2 points, or a curve to follow.")
        points = [vector(p, "Each point of a path") for p in raw]
        closed = bool(spec.get("closed"))
        curve = through(points, closed)
        through_said = f"through {len(points)} points"
    lengths = [0.0]
    for a, b in zip(curve, curve[1:]):
        lengths.append(lengths[-1] + (b - a).length)
    total = lengths[-1]
    need(total > 1e-9, "A path's points are all in one place: there is no route to move along.")
    first, last = math.floor(frame_of(start)), math.ceil(frame_of(end))
    step = max(1, round(fps() / PATH_KEYS_PER_SECOND))
    frames = list(range(first, last, step)) + [last]
    shares = [ease_share(min(1.0, max(0.0, (seconds_of(f) - start) / (end - start))), easing) for f in frames]
    # An attached part's points are on its parent's axes, as its keys are, so
    # the path goes with the parent wherever that moves.
    leans = {}
    for index, one in enumerate(movers):
        places = [behind(curve, lengths, share * total - index * spacing, closed) for share in shares]
        tilts = lean(places, frames, bank) if bank else [0.0] * len(places)
        leans[one.name] = max((abs(t) for t in tilts), default=0.0)
        for i, frame in enumerate(frames):
            one.location = places[i]
            keyed(one, "location", frame, "linear")
            # The way ahead from a little behind to a little ahead, so a turn at a
            # point is met half before it and half after.
            here = shares[i] * total - index * spacing
            ahead = behind(curve, lengths, here + total * 1e-3, closed) - behind(curve, lengths, here - total * 1e-3, closed)
            if facing and ahead.length > 1e-9:
                one.rotation_mode = "XYZ"
                # Its facing axis ahead and, as far as that allows, its top up.
                up = "Y" if facing in ("z", "-z") else "Z"
                turn = ahead.normalized().to_track_quat(facing.upper(), up)
                if tilts[i]:
                    turn = mathutils.Quaternion(ahead.normalized(), tilts[i]) @ turn
                one.rotation_euler = turn.to_euler("XYZ", one.rotation_euler)
                keyed(one, "rotation_euler", frame, "linear")
    speed, at = top_speed(obj, frames)
    said_by_object.setdefault(obj.name, []).append(
        f"along a path {through_said}{parent_space(obj)}{' and back to the first' if closed and route is None else ', round its loop' if closed else ''},"
        f" {seconds_text(start)} to {seconds_text(end)}, {length(total)} long, {easing.replace('_', ' ')}"
        + (f", its {facing} axis ahead" if facing else "")
        + (f", leaning up to {math.degrees(leans[obj.name]):.0f}° into its turns" if bank else "")
        + f"; at most {speed:.3g} m/s, at {seconds_text(at)}"
    )
    for index, one in enumerate(train, start=1):
        said_by_object.setdefault(one.name, []).append(
            f"on {obj.name}'s path, {length(index * spacing)} behind it" + (", round the loop" if closed else ", run on straight before the path starts")
        )
    return end


def lean(places, frames, most):
    """
    How far an object leans into its turn at each key, in radians: in proportion to how hard it is
    pushed sideways there, the hardest turn leaning by `most` degrees, its top toward the turn.
    """
    rate = fps()
    sideways = []
    for i in range(len(places)):
        if i == 0 or i == len(places) - 1:
            sideways.append(mathutils.Vector())
            continue
        before = (places[i] - places[i - 1]) * rate / max(frames[i] - frames[i - 1], 1)
        after = (places[i + 1] - places[i]) * rate / max(frames[i + 1] - frames[i], 1)
        push = (after - before) * rate / max((frames[i + 1] - frames[i - 1]) / 2, 1)
        way = (after + before)
        if way.length > 1e-9:
            way.normalize()
            push -= way * push.dot(way)
        sideways.append(push)
    hardest = max((p.length for p in sideways), default=0.0)
    tilts = []
    for i, push in enumerate(sideways):
        if hardest <= 1e-9 or push.length <= 1e-9:
            tilts.append(0.0)
            continue
        ahead = places[min(i + 1, len(places) - 1)] - places[max(i - 1, 0)]
        # Turning about the way ahead by a positive angle tips the top toward ahead × up.
        side = ahead.cross(mathutils.Vector((0, 0, 1)))
        sign = 1.0 if side.dot(push) >= 0 else -1.0
        tilts.append(sign * math.radians(most) * push.length / hardest)
    return tilts


def top_speed(obj, frames):
    """The fastest an object goes between its path keys, in m/s, and when, from its keyed places."""
    places = [mathutils.Vector([c.evaluate(f) for c in sorted((c for c in curves_of(obj) if c.data_path == "location"), key=lambda c: c.array_index)]) for f in frames]
    best, at = 0.0, frames[0]
    for (a, fa), (b, fb) in zip(zip(places, frames), zip(places[1:], frames[1:])):
        speed = (b - a).length * fps() / max(fb - fa, 1)
        if speed > best:
            best, at = speed, (fa + fb) / 2
    return best, seconds_of(at)





def users_of(block, but):
    """The other objects in the scene that share a camera, light, mesh, its shapes or a material."""
    names = []
    for other in scene().objects:
        if other == but:
            continue
        if block in owners_of(other):
            names.append(other.name)
    return names


HIDES = ("hide_render", "hide_viewport")


def driven(owner):
    """Whether anything of an owner is driven."""
    data = getattr(owner, "animation_data", None)
    return data is not None and len(data.drivers) > 0


def clear_one(name, said_by_object, renewed=False):
    """
    Clears an object's motion where it stands: all its keys and its aim. Keys
    of a camera, light, mesh, its shapes or a material it shares with another
    object stay, and are said, since clearing them would stop that object too.
    Its attached parts keep their keys, the shown or hidden keys its own key
    gave them included, which a part's own cannot be told apart from: the
    parts still shown or hidden by keys are named, to clear too if they should.
    One given new motion in the same call is said to have its earlier motion
    cleared, since it does not stay where it is.
    """
    need(isinstance(name, str), "clear lists objects by name.")
    obj = find_object(name)
    unaim(obj)
    followed = unfollow(obj)
    said = ["its earlier motion is cleared"] if renewed else [
        "no longer moves: its keys are cleared"
        + (" and it follows nothing" if followed else "")
        + ", and it stays where it is now"
        + (", hidden" if obj.hide_render else "")
    ]
    if obj.animation_data is not None:
        obj.animation_data_clear()
    shared = []
    blocks = [("its " + obj.type.lower(), obj.data)] if obj.data is not None else []
    shapes = getattr(obj.data, "shape_keys", None)
    if shapes is not None:
        blocks.append(("its shapes", shapes))
    blocks += [(f"its material {m.name}", m) for m in dict.fromkeys(slot.material for slot in obj.material_slots if slot.material is not None)]
    for what, block in blocks:
        owners = [block] + ([block.node_tree] if getattr(block, "node_tree", None) is not None else [])
        if not any(curves_of(owner) or driven(owner) for owner in owners):
            continue
        others = users_of(block, obj)
        if others:
            kept = "keep their keys" if what == "its shapes" else "keeps its keys"
            shared.append(f"{what}, which {', '.join(others)} also {'has' if len(others) == 1 else 'have'}, {kept}")
            continue
        for owner in owners:
            if owner.animation_data is not None:
                owner.animation_data_clear()
    keyed_parts = [
        part.name for part in obj.children_recursive if not is_helper(part) and any(c.data_path in HIDES for c in curves_of(part))
    ]
    if keyed_parts:
        said.append(
            f"{listed(keyed_parts)} attached to it {'keeps its' if len(keyed_parts) == 1 else 'keep their'} shown or hidden keys,"
            " which its own key may have given: clear "
            + ("it" if len(keyed_parts) == 1 else "them")
            + " too to stop that"
        )
    said_by_object.setdefault(obj.name, []).extend(said + shared)


def looped(s):
    """
    Ends the timeline a frame before the scene's last key, which a loop makes
    its first pose again, so played round no moment shows twice. Answers what
    it says of it.
    """
    last = max(
        (key.co.x for owner in animated_owners() for curve in curves_of(owner) for key in curve.keyframe_points),
        default=None,
    )
    need(
        last is not None and last >= s.frame_start + 2,
        "loop needs keys a few frames apart, the last of them the first pose again, as a turn ending at 360 degrees.",
    )
    s.frame_end = max(s.frame_start + 1, math.ceil(last - 1e-6) - 1)
    return (
        f" It ends a frame before the last key at {seconds_text(seconds_of(last))}, which is the first pose again,"
        " so it plays round as a loop."
    )


@keeps_focus
@lets_light_through_sheets
@lays_grain
def animate(args, scene_file):
    s = scene()
    said_by_object = {}
    timeline = set_timeline(args)
    latest = 0.0
    for field in ("clear", "poses", "keys", "paths", "aim", "follow", "drive", "belts"):
        need(args.get(field) is None or isinstance(args[field], list), f"{field} is a list.")
        need(
            field == "clear" or all(isinstance(item, dict) for item in args.get(field) or []),
            f"Each of {field} is an object with its own fields.",
        )
    # Objects the call moves again once their motion is cleared.
    moved = {
        spec.get("object")
        for field in ("keys", "paths", "aim", "follow", "drive", "belts")
        for spec in args.get(field) or []
        if isinstance(spec.get("object"), str)
    }
    forget()
    for name in [o.name for o in find_objects(args.get("clear") or [])]:
        clear_one(name, said_by_object, renewed=name in moved)
    for spec in args.get("poses") or []:
        save_pose(spec, said_by_object)
    keys = args.get("keys") or []
    # In time order, so each key's easing is set on the key it follows.
    for spec in sorted(keys, key=lambda k: k.get("at", 0) if isinstance(k, dict) and is_number(k.get("at")) else 0):
        latest = max(latest, key_one(spec, said_by_object))
    for spec in args.get("paths") or []:
        latest = max(latest, path_one(spec, said_by_object))
    for spec in args.get("aim") or []:
        aim_one(spec, said_by_object)
    keyed = [k for k in (follow_one(spec, said_by_object) for spec in args.get("follow") or []) if k is not None]
    for spec in args.get("drive") or []:
        drive_one(spec, said_by_object)
    for spec in args.get("belts") or []:
        latest = max(latest, run_one(spec, said_by_object, seconds_of(s.frame_end)))
    if args.get("cad_motion") is not None:
        latest = max(latest, key_motion(args["cad_motion"], said_by_object))
    keep_cycles_whole()
    if args.get("extend") is not None:
        extend(args["extend"], said_by_object)
    looping = args.get("loop")
    need(looping is None or isinstance(looping, bool), "loop is true or false.")
    need(
        timeline or said_by_object or keyed or looping,
        "Give keys, poses, paths, aim, follow, drive, belts, cad_motion, clear, extend, fps, duration or loop.",
    )
    lengthened = ""
    if frame_of(latest) > s.frame_end:
        s.frame_end = math.ceil(frame_of(latest))
        lengthened = " It was lengthened to reach the last key."
    else:
        lengthened = shortened(s)
    if looping:
        lengthened = looped(s)
        s[TIMELINE_SET] = True
    # Over the whole timeline, once it is as long as the call makes it.
    key_formulas(keyed, said_by_object, seconds_of)
    # Tips, driven values and stretches, measured with every motion of the call set.
    settle()
    # The view and the file show the start, where every key has its place.
    s.frame_set(s.frame_start)
    lines = [timeline_text() + lengthened]
    if looping:
        lines.append(loop_said())
    for name, said in said_by_object.items():
        lines.append(f"{name}: " + "; ".join(said) + ".")
    lines.append(
        "Check the motion with blender_frame_sheet, which shows frames you can see; blender_render_video makes the video for the person."
    )
    return "\n".join(lines)


def keyed_name(path):
    """A keyed property as the tools name it."""
    if path.startswith("key_blocks["):
        return "shapes"
    if path.startswith("pose.bones["):
        bone, _, value = path[len("pose.bones[") :].partition("].")
        return f"{bone.strip(chr(34))}'s {keyed_name(value)}"
    return path.rpartition(".")[2].replace("_euler", "").replace("default_value", "material values").replace("energy", "power")


def describe_motion(objects=None):
    """
    What moves in the scene, or among `objects`, for its description, with when each keyed value
    has its keys; nothing when nothing does.
    """
    said, times = [], []
    for obj in objects if objects is not None else scene().objects:
        curves = [c for owner in owners_of(obj) for c in curves_of(owner)]
        aim = obj.constraints.get(AIM)
        follows = follows_described(obj) + drives_described(obj)
        if not curves and (aim is None or aim.target is None) and not follows:
            continue
        parts = []
        if curves:
            frames = [k.co.x for c in curves for k in c.keyframe_points]
            keyed_names = sorted({keyed_name(c.data_path) for c in curves})
            past = extended(obj)
            parts.append(
                f"{', '.join(keyed_names)} keyed from {seconds_text(seconds_of(min(frames)))} to {seconds_text(seconds_of(max(frames)))}"
                + (f", {past}" if past else "")
            )
        if aim is not None and aim.target is not None:
            parts.append(f"aims at {aim.target.name}")
        parts += follows
        said.append(f"{obj.name}: {'; '.join(parts)}.")
        if curves:
            times.append(f"{obj.name}'s {channel_times(curves)}")
    if not said:
        return ""
    return "Motion: " + timeline_text() + " " + " ".join(said) + (" Keys by channel: " + "; ".join(times) + "." if times else "")


# A channel with more keys than this is said by its count and span, not each time.
TIMES_LISTED = 6


def channel_times(curves):
    """When each keyed value of an object has its keys: each time, or how many over what span; one key is held at every time."""
    by_channel = {}
    for curve in curves:
        by_channel.setdefault(keyed_name(curve.data_path), set()).update(round(k.co.x, 3) for k in curve.keyframe_points)
    said = []
    for name, frames in sorted(by_channel.items()):
        times = sorted(frames)
        if len(times) == 1:
            said.append(f"{name} at {seconds_text(seconds_of(times[0]))} only, so held at every time")
        elif len(times) <= TIMES_LISTED:
            said.append(f"{name} at " + listed([seconds_text(seconds_of(f)) for f in times]))
        else:
            said.append(f"{name} {len(times)} keys from {seconds_text(seconds_of(times[0]))} to {seconds_text(seconds_of(times[-1]))}")
    return ", ".join(said)


def drives_described(obj):
    """The values of an object, its bones, shapes or materials that drivers set, other than what it follows."""
    said = []
    for owner in owners_of(obj):
        data = getattr(owner, "animation_data", None)
        for curve in data.drivers if data is not None else []:
            if owner == obj and curve.data_path in ("location", "rotation_euler", "scale"):
                continue
            index = f"[{curve.array_index}]" if curve.array_index else ""
            said.append(f"{curve.data_path}{index} driven")
    return said
