"""
blender_set_lighting: lights, presets with their backdrop and tone, and a sky, a colour or
surroundings for the world. A moved light stays aimed where it was.
"""

import math
import os

import bpy
import mathutils

from .aiming import keeps_focus, reaim
from .arguments import colour, need, number, vector
from .describe import sun_text
from .errors import Refused
from .finding import LIGHTING, collection, find_object, is_backdrop, scene, subjects
from .geometry import middle_of, world_bounds
from .lighting_caustics import caustics_measured, set_caustics
from .lighting_fog import FOG, fog_measured, keep_world_fog, set_fog
from .lighting_links import EEVEE_RAYS, cards_seen, light_links, shaping
from .lighting_words import light_facts, sun_on_white
from .tone import set_tone
from .wording import one_of, point_text, size_text

LIGHT_KINDS = {"area": "AREA", "point": "POINT", "spot": "SPOT", "sun": "SUN"}
# What a light takes of which objects it lights and lets cast its shadows.
LINKS = ("lights_only", "lights_except", "shadows_only", "shadows_except")


def clear_lighting(which):
    """
    Removes what a preset made ("preset"), its backdrop included, or every
    light ("lights"), keeping the backdrop: the model's own lights outlast a
    preset, and a backdrop is not a light.
    """
    group = bpy.data.collections.get(LIGHTING)
    if group is None:
        return
    for obj in list(group.objects):
        if which == "preset" and not obj.get("zhiyin_preset"):
            continue
        if which == "lights" and obj.type != "LIGHT":
            continue
        data = obj.data
        bpy.data.objects.remove(obj)
        if data is not None and data.users == 0:
            if isinstance(data, bpy.types.Light):
                bpy.data.lights.remove(data)
            elif isinstance(data, bpy.types.Mesh):
                bpy.data.meshes.remove(data)


LIGHT_REACH = 10_000


def light_text(obj):
    """A light as the lighting answer says it."""
    data = obj.data
    said = f"{obj.name} ({', '.join(light_facts(data))}) at {point_text(obj.matrix_world.translation)}"
    if obj.get("zhiyin_aim") is not None:
        said += f", aimed at {point_text(obj['zhiyin_aim'])}"
    if data.type == "SUN":
        said += f", lighting a white matt surface square to it to {sun_on_white(data):.2g} of white"
    return said


AREA_SHAPES = {"square": "SQUARE", "rectangle": "RECTANGLE", "disk": "DISK", "ellipse": "ELLIPSE"}
# A sun's width in the sky by default, in degrees: the real sun's.
REAL_SUN = 0.53
# A sun's strength by default.
SUN_STRENGTH = 3
# A sky's sun: degrees above the horizon, least, most and by default; its bearing by default.
SUN_ELEVATION = (-10, 90, 35)
SUN_ROTATION = 0
# Where a light is aimed when its call names no point.
LOOK_AT = (0, 0, 0)
# A light's colour temperature, least and most, in kelvin; 0 is none.
KELVIN = (800, 20000)


def area_shape(obj, spec, made):
    """An area light's shape and its size, [width, height]: what is not given stays."""
    data = obj.data
    shape = spec.get("shape")
    need(shape is None or shape in AREA_SHAPES, "An area light's shape is square, rectangle, disk or ellipse.")
    if spec.get("size") is not None:
        width, height = vector(spec["size"], "light size", 2)
        need(width >= 1e-4 and height >= 1e-4, "A light's size is [width, height] in metres, each at least 0.0001.")
    elif made:
        width = height = 1.0
    else:
        width, height = data.size, data.size_y if data.shape in ("RECTANGLE", "ELLIPSE") else data.size
    even = abs(width - height) < 1e-9
    if shape is None:
        rounded = not made and data.shape in ("DISK", "ELLIPSE")
        found = ("DISK" if even else "ELLIPSE") if rounded else ("SQUARE" if even else "RECTANGLE")
    else:
        found = AREA_SHAPES[shape]
        if found in ("SQUARE", "DISK") and not even:
            need(
                spec.get("size") is None,
                f"A {shape} light is as wide as it is high: give size [w, w], or shape {'rectangle' if shape == 'square' else 'ellipse'}"
                f" for {size_text([width, height])}.",
            )
            height = width
    data.shape = found
    data.size = width
    data.size_y = height


def light(spec, group):
    """A new light, or, named as one already in the scene, that light with only what is given changed."""
    need(isinstance(spec, dict), "Each light is described by its kind, location and power.")
    existing = bpy.data.objects.get(spec.get("name") or "")
    if existing is not None and existing.type == "LIGHT":
        return set_light(existing, spec, made=False)
    return new_light(spec, group)


def new_light(spec, group):
    kind = spec.get("kind", "area")
    need(kind in LIGHT_KINDS, "A light's kind is area, point, spot or sun.")
    name = spec.get("name") or f"{kind.title()} light"
    data = bpy.data.lights.new(name, LIGHT_KINDS[kind])
    obj = bpy.data.objects.new(name, data)
    group.objects.link(obj)
    return set_light(obj, spec, made=True)


def set_light(obj, spec, made):
    data = obj.data
    kind = data.type
    if spec.get("kind") is not None:
        need(LIGHT_KINDS.get(spec["kind"]) == kind, f"“{obj.name}” is a {kind.lower()} light, and a light keeps its kind.")
    given = lambda key: made or key in spec  # noqa: E731
    for key, owner, words in (("shape", "AREA", "shapes an area light"), ("size", "AREA", "sizes an area light"), ("angle", "SUN", "is a sun's width in the sky")):
        need(kind == owner or spec.get(key) is None, f"{key} {words}; “{obj.name}” is a {kind.lower()} light.")
    if given("color"):
        data.color = colour(spec.get("color"), "light color", default="#ffffff")[:3]
    if spec.get("kelvin") is not None:
        kelvin = number(spec["kelvin"], "kelvin", minimum=0, maximum=KELVIN[1])
        need(
            kelvin == 0 or kelvin >= KELVIN[0],
            f"kelvin is a colour temperature from {KELVIN[0]} to {KELVIN[1]}, or 0 for the light's colour alone.",
        )
        data.use_temperature = kelvin > 0
        if kelvin:
            data.temperature = kelvin
    if spec.get("exposure") is not None:
        data.exposure = number(spec["exposure"], "light exposure", minimum=-10, maximum=10)
    if kind == "SUN":
        if given("strength"):
            data.energy = number(spec.get("strength"), "sun strength", minimum=0, maximum=1000, default=SUN_STRENGTH)
        if given("angle"):
            data.angle = math.radians(number(spec.get("angle"), "sun angle", minimum=0, maximum=180, default=REAL_SUN))
    else:
        if given("power"):
            data.energy = number(spec.get("power"), "light power", minimum=0, maximum=1e7, default=100)
        # EEVEE leaves out a light past a reach it works out from the light's
        # power, so a weak light on a small product would never reach the
        # backdrop behind it. Cycles has no such reach.
        data.use_custom_distance = True
        data.cutoff_distance = LIGHT_REACH
    if kind == "AREA":
        area_shape(obj, spec, made)
    if kind == "SPOT" and given("spot_angle"):
        data.spot_size = math.radians(number(spec.get("spot_angle"), "spot_angle", minimum=1, maximum=180, default=45))
    if given("location"):
        obj.location = vector(spec.get("location"), "light location", default=(0, 0, 3))
    need(
        spec.get("look_at") is None or spec.get("look_at_object") is None,
        "Aim a light at a point with look_at or at an object with look_at_object, not both.",
    )
    if spec.get("look_at_object") is not None:
        aim = middle_of(find_object(spec["look_at_object"]))
    elif given("look_at"):
        aim = vector(spec.get("look_at"), "look_at", default=LOOK_AT)
    else:
        aim = None
    if aim is not None:
        obj["zhiyin_aim"] = list(aim)
    reaim(obj)
    return obj


# How far under the product the backdrop's floor lies, as a share of its size.
UNDER = 5e-4


def backdrop(bounds):
    """
    A white seamless backdrop on every side: a round floor that curves up into
    a wall, so a camera from any direction sees only the backdrop. Seen from
    outside, as by an overview zoomed far out, it is clear.
    """
    low, high = bounds
    extent = high - low
    reach = max(extent.x, extent.y, extent.z) * 10
    rise = max(extent.z * 3, reach)
    radius = reach / 2
    ring = [(reach - radius, 0)]
    for i in range(1, 17):
        a = math.pi / 2 * i / 16
        ring.append((reach - radius + radius * math.sin(a), radius - radius * math.cos(a)))
    ring.append((reach, rise))
    segments = 96
    verts = [(0, 0, 0)]
    for s in range(segments):
        turn = 2 * math.pi * s / segments
        verts.extend((r * math.cos(turn), r * math.sin(turn), z) for r, z in ring)
    count = len(ring)
    top = len(verts)
    verts.append((0, 0, rise))
    faces = []
    for s in range(segments):
        here, there = 1 + s * count, 1 + (s + 1) % segments * count
        faces.append((0, here, there))
        faces.extend((here + k, here + k + 1, there + k + 1, there + k) for k in range(count - 1))
        # A lid: closed all round, the backdrop is all Cycles sees and all
        # that lights the product besides the lights.
        faces.append((here + count - 1, top, there + count - 1))
    mesh = bpy.data.meshes.new("Backdrop")
    mesh.from_pydata(verts, [], faces)
    # Faces point into the bowl, so its inside is the side that is drawn.
    if mesh.polygons[0].normal.z < 0:
        mesh.flip_normals()
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    obj = bpy.data.objects.new("Backdrop", mesh)
    # Its floor lies a hair under what stands on it: glass whose base is in
    # the very place of the floor renders as fused with it, in wedges.
    obj.location = (((low + high) / 2).x, ((low + high) / 2).y, low.z - max(extent) * UNDER)
    material = bpy.data.materials.get("Backdrop")
    if material is None or not material.use_nodes or SEEN not in material.node_tree.nodes:
        material = backdrop_material()
    # A new preset keeps colours as given again until asked otherwise.
    set_reflections(material, REFLECTIONS)
    mesh.materials.append(material)
    return obj


BACKDROP_WHITE = "#f2f2f2"
SEEN = "Zhiyin seen"
REFLECTED = "Zhiyin reflected"
# The product lights are set for the product: its lit side shows its own
# colour. The backdrop is further from them than the product, so the camera
# and reflections see it this many times brighter than it is lit, which keeps
# it white with its shading and the product's shadow on it, as a photographer
# lights a backdrop on its own.
BACKDROP_GAIN = 4
# In reflections the backdrop is, by default, as bright as a white surface lit
# where the product is: brightened as the camera sees it, a glossy deep colour
# greys over, and a saucer's reflection leaves a hard line on a glossy mug.
REFLECTIONS = 1 / BACKDROP_GAIN
# How bright a call may make the backdrop in reflections, from none to white.
REFLECTIONS_RANGE = (0, 1)
# Set so a matte grey of #777777 renders close to #777777 in Cycles, with the
# backdrop in reflections as above.
PRODUCT_LIGHT = 0.26
# The studio lights without the backdrop, set so a matt surface is lit to
# about one and a half times its own colour: the agx tone shows that close to
# the colour, where three times it, as the lights alone give, shows it pale.
STUDIO_LIGHT = 0.46
# Behind a studio scene the camera sees plain dark grey, at this strength.
STUDIO_BEHIND = ("#2a2a2a", 0.4)
# Around it, for metal and gloss to reflect, is Blender's photographed
# studio: dark walls, a white floor and round lamps, the lamps' blue taken
# out so they are white, at a strength that adds a little to the lights.
STUDIO_BALANCE = (1.152, 0.977, 0.864)
STUDIO_SURROUNDINGS = 0.35
# The share of their light the studio lights keep with the surroundings
# there, so a matt surface is lit as brightly as by the lights alone.
STUDIO_SHARE = 0.78
# EEVEE gathers little of the light the backdrop bounces onto the product, and
# its world light is not shut out by the backdrop: a white world of this
# strength stands in for that bounce. Cycles, inside the closed backdrop, never
# sees the world.
PRODUCT_AMBIENT = 0.6


def backdrop_material():
    """
    White, and clear from behind. The camera sees it brightened, through glass
    and liquids too; reflections see it as a white surface beside the product,
    or as brightly as the model sets, up to how the camera sees it; the light
    it passes on to the product is what falls on it.
    """
    material = bpy.data.materials.new("Backdrop")
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    shader = nodes["Principled BSDF"]
    shader.inputs["Base Color"].default_value = colour(BACKDROP_WHITE, "backdrop")
    shader.inputs["Roughness"].default_value = 0.8
    white = colour(BACKDROP_WHITE, "backdrop")
    seen = nodes.new("ShaderNodeBsdfDiffuse")
    seen.name = SEEN
    seen.inputs["Color"].default_value = [c * BACKDROP_GAIN for c in white[:3]] + [1]
    reflected = nodes.new("ShaderNodeBsdfDiffuse")
    reflected.name = REFLECTED
    path = nodes.new("ShaderNodeLightPath")
    glossy = nodes.new("ShaderNodeMixShader")
    links.new(path.outputs["Is Glossy Ray"], glossy.inputs["Fac"])
    links.new(shader.outputs["BSDF"], glossy.inputs[1])
    links.new(reflected.outputs["BSDF"], glossy.inputs[2])
    camera = nodes.new("ShaderNodeMixShader")
    # Cycles counts a ray that went through glass as glossy, which would show
    # the backdrop behind clear glass as dim as in a reflection: smoked glass.
    seen_through = nodes.new("ShaderNodeMath")
    seen_through.operation = "MAXIMUM"
    links.new(path.outputs["Is Camera Ray"], seen_through.inputs[0])
    links.new(path.outputs["Is Transmission Ray"], seen_through.inputs[1])
    links.new(seen_through.outputs["Value"], camera.inputs["Fac"])
    links.new(glossy.outputs["Shader"], camera.inputs[1])
    links.new(seen.outputs["BSDF"], camera.inputs[2])
    facing = nodes.new("ShaderNodeNewGeometry")
    clear = nodes.new("ShaderNodeBsdfTransparent")
    mix = nodes.new("ShaderNodeMixShader")
    links.new(facing.outputs["Backfacing"], mix.inputs["Fac"])
    links.new(camera.outputs["Shader"], mix.inputs[1])
    links.new(clear.outputs["BSDF"], mix.inputs[2])
    links.new(mix.outputs["Shader"], nodes["Material Output"].inputs["Surface"])
    set_reflections(material, REFLECTIONS)
    return material


def set_reflections(material, strength):
    """How bright the backdrop is in reflections, as a share of how it looks."""
    white = colour(BACKDROP_WHITE, "backdrop")
    material.node_tree.nodes[REFLECTED].inputs["Color"].default_value = [c * BACKDROP_GAIN * strength for c in white[:3]] + [1]
    material["zhiyin_reflections"] = strength


# How bright plain white is seen through glass on a white background: white,
# yet not so bright that the glass's edges and reflections wash out with it.
WHITE_BEYOND = 1


def seen_as_white(material):
    """
    For the moment, the backdrop seen through glass or a liquid is plain
    white, as the background around the product is. Returns what puts it back.
    """
    nodes, links = material.node_tree.nodes, material.node_tree.links
    seen = nodes.get(SEEN)
    link = next((l for l in links if seen is not None and l.from_node == seen), None)
    if link is None:
        return lambda: None
    socket = link.to_socket
    white = nodes.new("ShaderNodeEmission")
    white.inputs["Strength"].default_value = WHITE_BEYOND
    links.remove(link)
    links.new(white.outputs["Emission"], socket)
    # Seen only, never a light: sampled as one, the whole backdrop would light
    # the product and speckle its glass.
    sampling = material.cycles.emission_sampling
    material.cycles.emission_sampling = "NONE"

    def restore():
        nodes.remove(white)
        links.new(seen.outputs["BSDF"], socket)
        material.cycles.emission_sampling = sampling

    return restore


def floor_only(backdrops):
    """
    For the moment, the backdrop is plain white except its floor, which shows
    the light falling on it: a picture of it shows only shadows cast on the
    floor, as a white-background photograph keeps them. Returns what puts the
    backdrop back.
    """
    material = bpy.data.materials.new("Zhiyin floor")
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    nodes.remove(nodes["Principled BSDF"])
    lit = nodes.new("ShaderNodeBsdfDiffuse")
    lit.inputs["Color"].default_value = (1, 1, 1, 1)
    plain = nodes.new("ShaderNodeEmission")
    facing = nodes.new("ShaderNodeNewGeometry")
    up = nodes.new("ShaderNodeSeparateXYZ")
    floor = nodes.new("ShaderNodeMapRange")
    floor.interpolation_type = "SMOOTHSTEP"
    floor.inputs["From Min"].default_value = 0.8
    floor.inputs["From Max"].default_value = 0.95
    mix = nodes.new("ShaderNodeMixShader")
    links.new(facing.outputs["Normal"], up.inputs["Vector"])
    links.new(up.outputs["Z"], floor.inputs["Value"])
    links.new(floor.outputs["Result"], mix.inputs["Fac"])
    links.new(plain.outputs["Emission"], mix.inputs[1])
    links.new(lit.outputs["BSDF"], mix.inputs[2])
    links.new(mix.outputs["Shader"], nodes["Material Output"].inputs["Surface"])
    kept = [(o, list(o.data.materials)) for o in backdrops]
    for obj in backdrops:
        obj.data.materials.clear()
        obj.data.materials.append(material)

    def restore():
        for obj, materials in kept:
            obj.data.materials.clear()
            for m in materials:
                obj.data.materials.append(m)
        bpy.data.materials.remove(material)

    return restore


def backdrop_reflections(value):
    strength = number(value, "backdrop_reflections", minimum=REFLECTIONS_RANGE[0], maximum=REFLECTIONS_RANGE[1])
    backdrop_object = next((o for o in scene().objects if is_backdrop(o)), None)
    need(backdrop_object is not None, "There is no backdrop: it comes with the product lighting preset.")
    material = backdrop_object.data.materials[0] if backdrop_object.data.materials else None
    if material is None or SEEN not in material.node_tree.nodes:
        # A backdrop from before reflections could be set is made again.
        material = backdrop_material()
        backdrop_object.data.materials.clear()
        backdrop_object.data.materials.append(material)
    set_reflections(material, strength)
    return f"the backdrop at {strength:.0%} of its brightness in reflections"


def exposure_left():
    """
    Said with a preset's tone. A preset sets the tone and leaves the exposure,
    so one set for an earlier picture still brightens or darkens the next.
    """
    exposure = scene().view_settings.exposure
    return f"; the exposure stays at {exposure:+g}" if abs(exposure) > 1e-6 else ""


def preset(name, group):
    bpy.context.view_layer.update()
    bounds = world_bounds(subjects()) or (
        mathutils.Vector((-0.5, -0.5, 0)),
        mathutils.Vector((0.5, 0.5, 1)),
    )
    centre = (bounds[0] + bounds[1]) / 2
    reach = max((bounds[1] - bounds[0]).length, 0.1)
    if name in ("studio", "product"):
        made = []
        studio = bundled("studio") if name == "studio" else None
        # With the studio's surroundings adding their light, the lights give less.
        strength = PRODUCT_LIGHT if name == "product" else STUDIO_LIGHT * (STUDIO_SHARE if studio else 1)
        for label, direction, power, size in (
            ("Key light", (-1.2, -1.4, 1.3), 1.0, 0.8),
            ("Fill light", (1.6, -0.9, 0.5), 0.35, 1.2),
            ("Rim light", (0.6, 1.6, 1.4), 0.6, 0.5),
        ):
            where = centre + mathutils.Vector(direction).normalized() * reach * 2.2
            made.append(
                new_light(
                    {
                        "name": label,
                        "kind": "area",
                        "location": list(where),
                        "look_at": list(centre),
                        "power": power * 200 * reach**2 * strength,
                        "size": [reach * size, reach * size],
                    },
                    group,
                )
            )
        if name == "product":
            world_colour("#ffffff", PRODUCT_AMBIENT)
            made.append(backdrop(bounds))
            group.objects.link(made[-1])
        # What a preset made, which the next preset replaces.
        for obj in made:
            obj["zhiyin_preset"] = True
        if name == "product":
            set_tone("neutral")
            return (
                "studio lights (key, fill and rim) in a white backdrop that curves up on every side, "
                f"with the neutral tone, which shows the product's colours as given{exposure_left()}"
            )
        set_tone("agx")
        if studio is None:
            world_colour(*STUDIO_BEHIND)
            return (
                "studio lights (key, fill and rim) before a plain dark grey, which is all metal and gloss reflect, "
                f"since this Blender has no studio surroundings of its own; with the agx tone{exposure_left()}"
            )
        surroundings(studio, STUDIO_SURROUNDINGS, 0, STUDIO_BALANCE, seen=STUDIO_BEHIND)
        # Its two lamps stand on opposite sides. Drawn as one sun, they light
        # a matt surface in EEVEE far less than in Cycles.
        scene().world.sun_threshold = 0
        return (
            "studio lights (key, fill and rim) in Blender's photographed studio, which adds a little light and whose "
            f"white floor and lamps metal and gloss reflect; the camera sees plain dark grey behind the scene, with the agx tone{exposure_left()}"
        )
    if name == "daylight":
        sky(math.radians(35), math.radians(30), 1.0)
        set_tone("agx")
        return f"daylight from the sky and {sun_text(math.radians(35), math.radians(30))}, with the agx tone{exposure_left()}"
    if name == "none":
        return "no preset lights or backdrop"
    raise Refused("preset is studio, product, daylight or none.")


def world_nodes():
    world = scene().world or bpy.data.worlds.new("World")
    scene().world = world
    world.use_nodes = True
    tree = world.node_tree
    for node in list(tree.nodes):
        # Fog stays through a new background.
        if node.type != "OUTPUT_WORLD" and not node.name.startswith(FOG):
            tree.nodes.remove(node)
    output = next((n for n in tree.nodes if n.type == "OUTPUT_WORLD"), None) or tree.nodes.new("ShaderNodeOutputWorld")
    background = tree.nodes.new("ShaderNodeBackground")
    tree.links.new(background.outputs["Background"], output.inputs["Surface"])
    keep_world_fog(tree)
    # EEVEE draws the brightest of the surroundings as one sun, as Blender
    # does by default, so a sky's sun casts its shadow.
    world.sun_threshold = SUN_THRESHOLD
    return tree, background


SUN_THRESHOLD = 10


def world_colour(hex_colour, strength):
    _, background = world_nodes()
    background.inputs["Color"].default_value = colour(hex_colour, "background color")
    background.inputs["Strength"].default_value = strength


# What white matt ground gives back under the sky at strength 1, by the sun's
# height in degrees: measured in Blender 5.2 by rendering it.
GROUND_UNDER_SKY = (
    (-10, (0.0003, 0.0025, 0.0117)),
    (-5, (0.0048, 0.0145, 0.0578)),
    (0, (0.39, 0.41, 0.61)),
    (2, (1.07, 0.97, 1.19)),
    (5, (3.06, 2.54, 2.48)),
    (10, (7.44, 6.33, 5.61)),
    (20, (16.89, 14.88, 12.93)),
    (35, (30.24, 27.19, 23.99)),
    (50, (41.40, 37.55, 33.52)),
    (70, (51.48, 46.94, 42.26)),
    (90, (55.07, 50.28, 45.38)),
)
# The share of that light the ground past the scene gives back, a grey card's.
GROUND_SHARE = 0.2
# How far below the horizon the sky has given way to the ground, as the sine
# of the angle: about a degree.
GROUND_EDGE = 0.02


def ground_under(elevation):
    """What the ground past the scene gives back under a sky with the sun this high."""
    degrees = math.degrees(elevation)
    rows = GROUND_UNDER_SKY
    (low, dim), (high, bright) = next((pair for pair in zip(rows, rows[1:]) if degrees <= pair[1][0]), (rows[-2], rows[-1]))
    share = min(1, max(0, (degrees - low) / (high - low)))
    return tuple(GROUND_SHARE * (a + (b - a) * share) for a, b in zip(dim, bright))


def sky(elevation, turn, strength):
    """
    A sky over level ground. Below its horizon the sky itself is near black
    and blue, a sea through a window and a night behind a house seen from
    above, so there the world is the ground past the scene, lit by this sky.
    """
    tree, background = world_nodes()
    texture = tree.nodes.new("ShaderNodeTexSky")
    texture.sky_type = "MULTIPLE_SCATTERING"
    texture.sun_elevation = elevation
    texture.sun_rotation = turn
    direction = tree.nodes.new("ShaderNodeTexCoord")
    parts = tree.nodes.new("ShaderNodeSeparateXYZ")
    tree.links.new(direction.outputs["Generated"], parts.inputs["Vector"])
    below = tree.nodes.new("ShaderNodeMapRange")
    for name, value in (("From Min", -GROUND_EDGE), ("From Max", 0), ("To Min", 1), ("To Max", 0)):
        below.inputs[name].default_value = value
    tree.links.new(parts.outputs["Z"], below.inputs["Value"])
    mix = tree.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    sockets = {socket.identifier: socket for socket in mix.inputs}
    sockets["B_Color"].default_value = (*ground_under(elevation), 1)
    tree.links.new(below.outputs["Result"], sockets["Factor_Float"])
    tree.links.new(texture.outputs["Color"], sockets["A_Color"])
    tree.links.new(next(socket for socket in mix.outputs if socket.type == "RGBA"), background.inputs["Color"])
    background.inputs["Strength"].default_value = strength


def hdri(path, strength, turn, seen=None):
    image = bpy.data.images.load(path, check_existing=True)
    if bpy.data.filepath:
        image.filepath = bpy.path.relpath(path)
    surroundings(image, strength, turn, seen=seen)


# Blender's own pictures of surroundings, made from photographs by Poly
# Haven and given away (CC0), which come with every Blender.
ENVIRONMENTS = ("studio", "city", "courtyard", "forest", "interior", "night", "sunrise", "sunset")


def bundled(name):
    """Blender's own picture of surroundings by name, kept in the scene; or nothing when this Blender has none."""
    kept = f"Zhiyin {name} surroundings"
    image = bpy.data.images.get(kept)
    if image is not None and image.packed_file is not None:
        return image
    folder = bpy.utils.system_resource("DATAFILES", path="studiolights/world")
    path = os.path.join(folder, f"{name}.exr") if folder else ""
    if not os.path.isfile(path):
        return None
    image = bpy.data.images.load(path)
    image.name = kept
    # Packed, it goes with the scene to another Blender, and the scene reads
    # nothing from outside its workspace.
    image.pack()
    image.filepath = ""
    return image


def surroundings(image, strength, turn, balance=(1, 1, 1), seen=None):
    """
    The world as a picture of surroundings, which lights the scene and is
    what it reflects, its colours scaled by `balance`. With `seen`, a colour
    and a strength, the camera sees that plain colour behind the scene instead.
    """
    tree, background = world_nodes()
    texture = tree.nodes.new("ShaderNodeTexEnvironment")
    texture.image = image
    mapping = tree.nodes.new("ShaderNodeMapping")
    mapping.inputs["Rotation"].default_value = (0, 0, turn)
    coordinates = tree.nodes.new("ShaderNodeTexCoord")
    tree.links.new(coordinates.outputs["Generated"], mapping.inputs["Vector"])
    tree.links.new(mapping.outputs["Vector"], texture.inputs["Vector"])
    balanced = tree.nodes.new("ShaderNodeVectorMath")
    balanced.operation = "MULTIPLY"
    balanced.inputs[1].default_value = balance
    tree.links.new(texture.outputs["Color"], balanced.inputs[0])
    tree.links.new(balanced.outputs["Vector"], background.inputs["Color"])
    background.inputs["Strength"].default_value = strength
    if seen is None:
        return
    plain = tree.nodes.new("ShaderNodeBackground")
    plain.inputs["Color"].default_value = colour(seen[0], "background color")
    plain.inputs["Strength"].default_value = seen[1]
    path = tree.nodes.new("ShaderNodeLightPath")
    mix = tree.nodes.new("ShaderNodeMixShader")
    tree.links.new(path.outputs["Is Camera Ray"], mix.inputs["Fac"])
    tree.links.new(background.outputs["Background"], mix.inputs[1])
    tree.links.new(plain.outputs["Background"], mix.inputs[2])
    output = next(n for n in tree.nodes if n.type == "OUTPUT_WORLD")
    tree.links.new(mix.outputs["Shader"], output.inputs["Surface"])


@keeps_focus
def set_lighting(args, scene_file):
    group = collection(LIGHTING)
    said = []
    if args.get("replace"):
        clear_lighting("lights")
        said.append("earlier lights removed")
    if args.get("preset") is not None:
        clear_lighting("preset")
        said.append(preset(args["preset"], group))
    background = args.get("background")
    if background is not None:
        need(isinstance(background, dict), "background gives a color, an hdri or a sky.")
        strength = number(background.get("strength"), "background strength", minimum=0, maximum=100, default=1)
        environment = background.get("environment")
        need(
            sum(1 for key in ("hdri", "environment", "sky") if background.get(key) is not None) <= 1,
            "background takes one of an hdri, an environment or a sky.",
        )
        need(environment is None or environment in ENVIRONMENTS, f"environment is one of {one_of(ENVIRONMENTS)}.")
        if background.get("hdri") or environment:
            turn = math.radians(number(background.get("rotation"), "rotation", default=0))
            # With a colour too, the surroundings light the scene and are what
            # it reflects, and the camera sees the plain colour behind it.
            seen = (background["color"], 1) if background.get("color") is not None else None
            if environment:
                image = bundled(environment)
                need(image is not None, f"This Blender has no {environment} surroundings of its own.")
                surroundings(image, strength, turn, seen=seen)
                said.append(f"surroundings from Blender's own {environment}")
            else:
                hdri(background["hdri"], strength, turn, seen=seen)
                said.append(f"surroundings from {os.path.basename(background['hdri'])}")
            if seen:
                said[-1] += f", seen behind the scene as plain {background['color']}"
        elif background.get("sky") is not None:
            spec = background["sky"]
            need(isinstance(spec, dict), "sky gives the sun's elevation and rotation in degrees.")
            least, most, default = SUN_ELEVATION
            elevation = math.radians(
                number(spec.get("sun_elevation"), "sun_elevation", minimum=least, maximum=most, default=default)
            )
            turn = math.radians(number(spec.get("sun_rotation"), "sun_rotation", default=SUN_ROTATION))
            sky(elevation, turn, strength)
            said.append(f"a sky with {sun_text(elevation, turn)}")
        else:
            world_colour(background.get("color", "#7a7a7a"), strength)
            said.append(f"a {background.get('color', '#7a7a7a')} background")
    lit = [light(spec, group) for spec in args.get("lights") or []]
    # A light just made is where it was put once the scene has taken it in.
    bpy.context.view_layer.update()
    for made, spec in zip(lit, args.get("lights") or []):
        linked = light_links(made, spec)
        said.append(light_text(made) + (f", which {linked}" if linked else ""))
    if args.get("backdrop_reflections") is not None:
        said.append(backdrop_reflections(args["backdrop_reflections"]))
    shaped, cards = shaping(args, group)
    said += shaped
    fogged = isinstance(args.get("fog"), dict) and args["fog"].get("density") != 0
    if args.get("fog") is not None:
        said.append(set_fog(args["fog"], group))
    if args.get("caustics") is not None:
        said.append(set_caustics(args["caustics"]))
    need(said, "Give a preset, a background, lights, backdrop_reflections, cards, seen_by, fog or caustics.")
    linked = any(spec.get(f) is not None for spec in args.get("lights") or [] if isinstance(spec, dict) for f in LINKS)
    # Measured once everything is set, each from small pictures of the scene as it now is.
    measured = [
        cards_seen(cards) if cards else "",
        fog_measured(group) if fogged else "",
        caustics_measured() if args.get("caustics") is not None else "",
    ]
    return (
        f"Lighting: {'; '.join(said)}."
        + (" Cycles and EEVEE both keep which objects a light lights and which cast its shadows." if linked else "")
        + (f" {EEVEE_RAYS}" if shaped else "")
        + "".join(f" {line}" for line in measured if line)
    )
