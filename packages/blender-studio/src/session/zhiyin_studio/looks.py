"""How the scene looks: materials, the camera and the lighting."""

import math
import os

import bpy
import mathutils

from .common import (
    LIGHTING,
    WOOD,
    Refused,
    collection,
    colour,
    find_object,
    hex_of,
    is_backdrop,
    is_helper,
    length,
    lens_shift,
    link,
    look_at,
    middle_of,
    need,
    number,
    outline_points,
    place_to_fit,
    point_text,
    reaim,
    refocus,
    scene,
    set_tone,
    subjects,
    vector,
    vertical,
    wood_of,
    world_bounds,
    world_corners,
)
from .describe import in_picture, material_facts, sun_text

PROJECTIONS = {"uv": None, "box": "BOX", "cylinder": "TUBE", "sphere": "SPHERE", "front": "FLAT"}


# ---- materials ------------------------------------------------------------------------------


def image_node(material, path, projection, repeat):
    nodes, links = material.node_tree.nodes, material.node_tree.links
    image = bpy.data.images.load(path, check_existing=True)
    if bpy.data.filepath:
        image.filepath = bpy.path.relpath(path)
    node = nodes.new("ShaderNodeTexImage")
    node.image = image
    mapping = nodes.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = (repeat[0], repeat[1], 1)
    coordinates = nodes.new("ShaderNodeTexCoord")
    if projection == "uv":
        links.new(coordinates.outputs["UV"], mapping.inputs["Vector"])
    elif projection == "front":
        # Seen from the front: across is x and up is z, not the y a flat
        # projection reads, which would show it from above.
        node.projection = "FLAT"
        split = nodes.new("ShaderNodeSeparateXYZ")
        upright = nodes.new("ShaderNodeCombineXYZ")
        links.new(coordinates.outputs["Generated"], split.inputs["Vector"])
        links.new(split.outputs["X"], upright.inputs["X"])
        links.new(split.outputs["Z"], upright.inputs["Y"])
        links.new(upright.outputs["Vector"], mapping.inputs["Vector"])
    else:
        node.projection = PROJECTIONS[projection]
        if projection == "box":
            node.projection_blend = 0.2
        links.new(coordinates.outputs["Generated"], mapping.inputs["Vector"])
    links.new(mapping.outputs["Vector"], node.inputs["Vector"])
    return node


def set_material(args, scene_file):
    names = args.get("objects")
    need(isinstance(names, list) and names, "objects must name at least one object.")
    targets = [find_object(n, {"MESH", "CURVE", "FONT", "SURFACE", "META"}) for n in names]
    spec = args.get("material")
    need(isinstance(spec, dict), "material describes the material: its colour, roughness and so on.")
    name = spec.get("name") or f"{targets[0].name} material"
    existing = bpy.data.materials.get(name)
    if existing is not None and set(spec) == {"name"}:
        # Named with nothing else: the material as it is, on more objects.
        assign(existing, targets)
        return f"Material {material_facts(existing)} on {', '.join(o.name for o in targets)}, unchanged."
    material = existing or bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    for node in list(nodes):
        if node.type not in ("BSDF_PRINCIPLED", "OUTPUT_MATERIAL"):
            nodes.remove(node)
    shader = nodes.get("Principled BSDF") or nodes.new("ShaderNodeBsdfPrincipled")
    output = nodes.get("Material Output") or nodes.new("ShaderNodeOutputMaterial")
    material.node_tree.links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    inputs = shader.inputs
    said = []
    base = colour(spec.get("color"), "color", default="#cccccc")
    inputs["Base Color"].default_value = base
    said.append(hex_of(base))
    inputs["Metallic"].default_value = number(spec.get("metallic"), "metallic", minimum=0, maximum=1, default=0)
    inputs["Roughness"].default_value = number(spec.get("roughness"), "roughness", minimum=0, maximum=1, default=0.5)
    if inputs["Metallic"].default_value > 0:
        said.append(f"metallic {inputs['Metallic'].default_value:g}")
    said.append(f"roughness {inputs['Roughness'].default_value:g}")
    grain = number(spec.get("wood"), "wood", minimum=0, maximum=1, default=0)
    need(
        not (grain and spec.get("texture") is not None),
        "wood draws its own grain in the colour given: give the wood or the texture, not both.",
    )
    if grain:
        wood(material, shader, base, grain)
        said.append(f"wood grain {grain:g}")
    # Blender's own defaults: 0.5 reflects as the ior says, a coat is glassy.
    inputs["Specular IOR Level"].default_value = number(spec.get("specular"), "specular", minimum=0, maximum=1, default=0.5)
    if abs(inputs["Specular IOR Level"].default_value - 0.5) > 1e-6:
        said.append(f"specular {inputs['Specular IOR Level'].default_value:g}")
    transmission = number(spec.get("transmission"), "transmission", minimum=0, maximum=1, default=0)
    inputs["Transmission Weight"].default_value = transmission
    inputs["IOR"].default_value = number(spec.get("ior"), "ior", minimum=1, maximum=4, default=1.5)
    if transmission > 0:
        said.append(f"transmission {transmission:g}, ior {inputs['IOR'].default_value:g}")
        if hasattr(material, "use_raytrace_refraction"):
            material.use_raytrace_refraction = True
    alpha = number(spec.get("alpha"), "alpha", minimum=0, maximum=1, default=1)
    inputs["Alpha"].default_value = alpha
    if alpha < 1:
        said.append(f"opacity {alpha:g}")
    # Every call sets the whole material: what it leaves out goes back to its default.
    emission = spec.get("emission")
    inputs["Emission Strength"].default_value = 0
    # With a picture and no colour of its own, the picture is what glows, as on a screen.
    pictured = False
    if emission is not None:
        need(isinstance(emission, dict), "emission gives a color and a strength.")
        pictured = emission.get("color") is None and spec.get("texture") is not None
        inputs["Emission Color"].default_value = colour(emission.get("color"), "emission color", default="#ffffff")
        inputs["Emission Strength"].default_value = number(emission.get("strength"), "emission strength", minimum=0, default=1)
        glow = "with its picture" if pictured else hex_of(inputs["Emission Color"].default_value)
        said.append(f"glowing {glow} at {inputs['Emission Strength'].default_value:g}")
    inputs["Coat Weight"].default_value = number(spec.get("coat"), "coat", minimum=0, maximum=1, default=0)
    inputs["Coat Roughness"].default_value = number(spec.get("coat_roughness"), "coat_roughness", minimum=0, maximum=1, default=0.03)
    if inputs["Coat Weight"].default_value > 0:
        said.append(f"coat {inputs['Coat Weight'].default_value:g}")
        if abs(inputs["Coat Roughness"].default_value - 0.03) > 1e-6:
            said.append(f"coat roughness {inputs['Coat Roughness'].default_value:g}")
    texture = spec.get("texture")
    if texture is not None:
        need(isinstance(texture, dict) and texture.get("path"), "texture gives the path of a picture.")
        projection = texture.get("projection", "uv")
        need(projection in PROJECTIONS, "texture projection is uv, box, cylinder, sphere or front.")
        unlaid = [o.name for o in targets if projection == "uv" and o.type == "MESH" and not o.data.uv_layers]
        need(
            not unlaid,
            f"{', '.join(unlaid)} has no layout for a uv picture, which would show one colour; "
            "use cylinder, box, sphere or front.",
        )
        repeat = vector(texture.get("repeat"), "texture repeat", 2, default=(1, 1))
        node = image_node(material, texture["path"], projection, repeat)
        material.node_tree.links.new(node.outputs["Color"], inputs["Base Color"])
        if pictured:
            material.node_tree.links.new(node.outputs["Color"], inputs["Emission Color"])
        if texture.get("use_alpha"):
            material.node_tree.links.new(node.outputs["Alpha"], inputs["Alpha"])
        said.append(f"picture {os.path.basename(texture['path'])} ({projection})")
    normal = spec.get("normal_map")
    if normal is not None:
        need(isinstance(normal, dict) and normal.get("path"), "normal_map gives the path of a picture.")
        node = image_node(material, normal["path"], normal.get("projection", "uv"), vector(normal.get("repeat"), "normal_map repeat", 2, default=(1, 1)))
        node.image.colorspace_settings.name = "Non-Color"
        bump = nodes.new("ShaderNodeNormalMap")
        bump.inputs["Strength"].default_value = number(normal.get("strength"), "normal_map strength", minimum=0, maximum=10, default=1)
        material.node_tree.links.new(node.outputs["Color"], bump.inputs["Color"])
        material.node_tree.links.new(bump.outputs["Normal"], inputs["Normal"])
        said.append("surface detail")
    assign(material, targets)
    return f"Material {material.name} ({', '.join(said)}) on {', '.join(o.name for o in targets)}."


def assign(material, targets):
    for obj in targets:
        if obj.data.materials:
            obj.data.materials[0] = material
            for slot in obj.material_slots:
                slot.material = material
        else:
            obj.data.materials.append(material)


# Wood is a finish, as metal is: the colour is the wood's own and the grain is
# drawn in it, with nothing to unwrap and no picture to keep. It is drawn as a
# tree grows it, in rings round a line that runs the length of the object, a
# little to one side of it: the faces of a board show streaks along it, a few
# centimetres wide at any size, and its ends show arcs. An end wider than a
# board is sawn is no sawn end: the top of a cupboard is a panel, and shows
# streaks along its own longer side. Each wooden object carries which way its
# grain runs, which way it runs on an end, and its own size (GRAIN, GRAIN_END,
# GRAIN_SIZE), which the material reads; so one material serves a table's top
# and its legs, and no two boards show the same streaks.
GRAIN, GRAIN_END, GRAIN_SIZE = "zhiyin_grain", "zhiyin_grain_end", "zhiyin_grain_size"
# The widest a board is sawn, in metres.
BOARD = 0.25
# Streaks to the metre: along the grain, and across it.
GRAIN_ALONG, GRAIN_ACROSS = 0.9, 26.0
# Where the tree's middle ran, in metres from the object's own.
HEART = (0.45, 0.38, -0.33)
# At full strength: how far the dark streaks go below the wood's colour and
# the light ones above it, and how far one board's tone is from the next's.
GRAIN_DARK, GRAIN_LIGHT, BOARD_TONE = 0.3, 0.08, 0.24


def wood(material, shader, base, amount):
    nodes, links = material.node_tree.nodes, material.node_tree.links

    def node(kind, **settings):
        made = nodes.new(kind)
        for name, value in settings.items():
            setattr(made, name, value)
        return made

    def sums(operation, *values):
        made = node("ShaderNodeMath", operation=operation)
        for at, value in enumerate(values):
            if isinstance(value, (int, float)):
                made.inputs[at].default_value = value
            else:
                links.new(value, made.inputs[at])
        return made.outputs[0]

    marker = node("ShaderNodeValue", name=WOOD, label=WOOD)
    marker.outputs[0].default_value = amount

    def vectors(operation, first, second=None):
        made = node("ShaderNodeVectorMath", operation=operation)
        for at, value in enumerate((first, second)):
            if value is None:
                continue
            if isinstance(value, tuple):
                made.inputs[at].default_value = value
            else:
                links.new(value, made.inputs[at])
        return made

    def read(name):
        return node("ShaderNodeAttribute", attribute_type="OBJECT", attribute_name=name).outputs["Vector"]

    # Which way the grain runs where the point being drawn is: along the
    # object, or on a face that looks along it, the way the object's ends run.
    own_frame = node("ShaderNodeTexCoord")
    facing = sums("ABSOLUTE", vectors("DOT_PRODUCT", own_frame.outputs["Normal"], read(GRAIN)).outputs["Value"])
    turned = node("ShaderNodeMix", data_type="VECTOR")
    ends = {socket.identifier: socket for socket in turned.inputs}
    links.new(sums("GREATER_THAN", facing, 0.7), ends["Factor_Float"])
    links.new(read(GRAIN), ends["A_Vector"])
    links.new(read(GRAIN_END), ends["B_Vector"])
    lie = next(socket for socket in turned.outputs if socket.type == "VECTOR")
    # The point, in metres in the object's own frame; how far along the grain
    # it is, and how far from the tree's middle across it.
    metres = vectors("MULTIPLY", own_frame.outputs["Object"], read(GRAIN_SIZE)).outputs["Vector"]
    along = vectors("DOT_PRODUCT", metres, lie).outputs["Value"]
    beside = vectors("SUBTRACT", (1.0, 1.0, 1.0), lie).outputs["Vector"]
    across = vectors("MULTIPLY", metres, beside).outputs["Vector"]
    heart = vectors("MULTIPLY", HEART, beside).outputs["Vector"]
    ring = vectors("LENGTH", vectors("SUBTRACT", across, heart).outputs["Vector"]).outputs["Value"]
    place = node("ShaderNodeCombineXYZ")
    links.new(sums("MULTIPLY", along, GRAIN_ALONG), place.inputs["X"])
    links.new(sums("MULTIPLY", ring, GRAIN_ACROSS), place.inputs["Y"])
    # One side of the middle is not the mirror of the other.
    links.new(vectors("DOT_PRODUCT", across, (0.8, 0.8, 0.8)).outputs["Value"], place.inputs["Z"])
    board = node("ShaderNodeObjectInfo").outputs["Random"]
    own = sums("MULTIPLY", board, 53.0)

    def streaks(scale, detail, distortion):
        made = node("ShaderNodeTexNoise", noise_dimensions="4D")
        made.inputs["Scale"].default_value = scale
        made.inputs["Detail"].default_value = detail
        made.inputs["Roughness"].default_value = 0.55
        made.inputs["Distortion"].default_value = distortion
        links.new(place.outputs["Vector"], made.inputs["Vector"])
        links.new(own, made.inputs["W"])
        return made.outputs[0]

    # Broad bands of darker and lighter wood, with fine lines of pores in them.
    figure = sums("MULTIPLY_ADD", streaks(1.0, 2.0, 0.6), 0.72, sums("MULTIPLY", streaks(6.0, 1.0, 0.15), 0.28))
    shaped = node("ShaderNodeMapRange", interpolation_type="SMOOTHSTEP")
    links.new(figure, shaped.inputs["Value"])
    shaped.inputs["From Min"].default_value = 0.36
    shaped.inputs["From Max"].default_value = 0.64
    dark, light = 1 - GRAIN_DARK * amount, 1 + GRAIN_LIGHT * amount
    mix = node("ShaderNodeMix", data_type="RGBA")
    sockets = {socket.identifier: socket for socket in mix.inputs}
    links.new(shaped.outputs["Result"], sockets["Factor_Float"])
    sockets["A_Color"].default_value = (base[0] * light, base[1] * light, base[2] * light, 1)
    # The dark of wood is warmer than its light.
    sockets["B_Color"].default_value = (base[0] * dark, base[1] * dark * 0.95, base[2] * dark * 0.88, 1)
    toned = node("ShaderNodeHueSaturation")
    links.new(next(socket for socket in mix.outputs if socket.type == "RGBA"), toned.inputs["Color"])
    spread = BOARD_TONE * amount
    links.new(sums("MULTIPLY_ADD", board, spread, 1 - spread / 2), toned.inputs["Value"])
    links.new(toned.outputs["Color"], shader.inputs["Base Color"])


def lay_grain():
    """Tells each wooden object which way its grain runs, its longest side, on its ends too, and its real size."""
    bpy.context.view_layer.update()
    for obj in scene().objects:
        wooden = obj.type in ("MESH", "CURVE", "FONT", "SURFACE", "META") and any(
            wood_of(slot.material) for slot in obj.material_slots
        )
        if not wooden:
            for name in (GRAIN, GRAIN_END, GRAIN_SIZE):
                if name in obj:
                    del obj[name]
            continue
        size, scale = obj.dimensions, obj.matrix_world.to_scale()
        long, second, short = sorted(range(3), key=lambda axis: -size[axis])
        # An end both of whose sides are wider than a board is a panel.
        end = second if size[short] > BOARD else long
        told = {
            GRAIN: [1.0 if axis == long else 0.0 for axis in range(3)],
            GRAIN_END: [1.0 if axis == end else 0.0 for axis in range(3)],
            GRAIN_SIZE: [abs(scale[axis]) for axis in range(3)],
        }
        for name, value in told.items():
            if name not in obj or any(abs(old - new) > 1e-6 for old, new in zip(obj[name], value)):
                obj[name] = value
                obj.update_tag()


# A flat sheet of glass focuses nothing: what is behind a window pane is lit
# as through the open hole. Cycles stops direct light at any glass, which
# leaves a glazed room a third as bright and without its patch of sun, so a
# sheet is taken out of the way of the rays that carry light to a surface.
# Glass that is not a sheet bends light, and keeps the shadow Cycles gives it.
SHEET = "zhiyin_sheet"
SHEET_THIN = 0.05
SHEET_CLEAR = 0.9


def is_glass(material):
    if material is None or not material.use_nodes:
        return False
    nodes = material.node_tree.nodes
    shader = nodes.get("Principled BSDF")
    if shader is not None:
        through = shader.inputs["Transmission Weight"]
        return not through.is_linked and through.default_value >= SHEET_CLEAR
    return any(node.type == "BSDF_GLASS" for node in nodes)


def is_sheet_of_glass(obj):
    """Glass all through, flat, and far thinner than it is wide."""
    materials = [slot.material for slot in obj.material_slots]
    if obj.type != "MESH" or is_helper(obj) or not materials or not all(is_glass(m) for m in materials):
        return False
    thin, narrow, _ = sorted(obj.dimensions)
    return narrow > 0 and thin <= SHEET_THIN * narrow


def light_through_sheets():
    """Sets each sheet of glass to let light through, and says which ones are new."""
    bpy.context.view_layer.update()
    found = []
    for obj in scene().objects:
        sheet = is_sheet_of_glass(obj)
        if sheet == bool(obj.get(SHEET)):
            continue
        obj.visible_shadow = obj.visible_diffuse = not sheet
        if sheet:
            obj[SHEET] = True
            found.append(obj.name)
        else:
            del obj[SHEET]
    if not found:
        return ""
    one = len(found) == 1
    return (
        f"{' and '.join(found) if len(found) < 3 else ', '.join(found)} {'is a thin sheet' if one else 'are thin sheets'} of glass: "
        f"light goes through {'it' if one else 'them'} as through real glass, and {'it casts' if one else 'they cast'} no shadow."
    )


# ---- camera ---------------------------------------------------------------------------------

DIRECTIONS = {
    "front": (0, -1, 0.15),
    "back": (0, 1, 0.15),
    "left": (-1, 0, 0.15),
    "right": (1, 0, 0.15),
    "three-quarter": (1, -1, 0.7),
    "top": (0, 0, 1),
}


def frame(camera, targets, direction, margin, aspect, ahead):
    """
    Places the camera along a direction so the targets fill the picture. It
    fits their shapes, not their boxes: a round thing seen from a corner of
    its box would otherwise sit small in a picture sized for that corner.
    """
    bpy.context.view_layer.update()
    points = [p for target in targets for p in outline_points(target)]
    need(points, "There is nothing visible to frame.")
    return place_to_fit(camera, direction, points, aspect, margin, ahead)


def heading(direction, elevation, around=None):
    """
    A preset direction, moved round the objects by `around` degrees,
    anticlockwise seen from above, and raised to an elevation in degrees above
    level. With it comes the level direction that is up the picture when the
    camera looks straight down: the far side from where it came round to.
    """
    turn = mathutils.Matrix.Rotation(
        math.radians(number(around, "frame around", minimum=-360, maximum=360)) if around is not None else 0, 3, "Z"
    )
    direction = turn @ mathutils.Vector(direction)
    level = mathutils.Vector((direction.x, direction.y, 0))
    if level.length < 1e-6:
        # Straight above is on no side of its own: it is turned from the front.
        level = turn @ mathutils.Vector((0, -1, 0))
    level.normalize()
    if elevation is not None:
        rise = math.radians(number(elevation, "frame elevation", minimum=-60, maximum=90))
        direction = (level.x * math.cos(rise), level.y * math.cos(rise), math.sin(rise))
    return tuple(direction), tuple(-level)


SIDES = ("front", "front-right", "right", "back-right", "back", "back-left", "left", "front-left")


def up_the_picture(ahead):
    """Which way is up the picture of a camera that looks straight down, in the scene's axes."""
    turn = round(math.degrees(math.atan2(-ahead[0], ahead[1]))) % 360
    axis = {0: "+y", 90: "-x", 180: "-y", 270: "+x"}.get(turn)
    return f"{axis} up the picture" if axis else f"up the picture is {turn}° anticlockwise from +y"


def side_of(way, ahead):
    """Where a camera looks from, in degrees round from the front and by its side."""
    if vertical(way):
        return f"straight from above, {up_the_picture(ahead)}"
    turn = round(math.degrees(math.atan2(way[0], -way[1])))
    return f"{turn}° round from the front, on the {SIDES[round(turn / 45) % 8]} side"


def plan_reading(camera, point):
    """Says which way is up the picture of a camera aimed straight down or up by hand."""
    return ", +y up the picture" if vertical(camera.location - mathutils.Vector(point)) else ""


def scene_camera():
    camera = scene().camera
    if camera is None:
        data = bpy.data.cameras.new("Camera")
        camera = link(bpy.data.objects.new("Camera", data))
        scene().camera = camera
    return camera


def set_camera(args, scene_file):
    camera = scene_camera()
    data = camera.data
    render = scene().render
    said = []
    if args.get("resolution") is not None:
        width, height = vector(args["resolution"], "resolution", 2)
        need(16 <= width <= 16384 and 16 <= height <= 16384, "resolution must be between 16 and 16384 pixels each way.")
        render.resolution_x, render.resolution_y = int(width), int(height)
        said.append(f"{int(width)}×{int(height)} pixels")
    if args.get("orthographic") is not None:
        need(isinstance(args["orthographic"], bool), "orthographic is true or false.")
        data.type = "ORTHO" if args["orthographic"] else "PERSP"
    data.lens = number(args.get("lens"), "lens", minimum=4, maximum=1200, default=data.lens)
    said.append(f"{data.lens:g} mm lens" if data.type != "ORTHO" else "orthographic")
    if args.get("shift") is not None:
        across, up = vector(args["shift"], "shift", 2)
        need(abs(across) <= 1 and abs(up) <= 1, "shift is two numbers from -1 to 1: across and up, in picture widths.")
        data.shift_x, data.shift_y = across, up
    # Said whoever set it, so a shift is never there unknown.
    said.append(lens_shift(data) or ("lens not shifted" if args.get("shift") is not None else ""))
    aspect = render.resolution_x / render.resolution_y
    if args.get("frame") is not None:
        spec = args["frame"]
        need(isinstance(spec, dict), "frame names the objects to fit and the direction to look from.")
        targets = [find_object(n) for n in spec.get("objects") or []] or subjects()
        direction = spec.get("direction", "three-quarter")
        need(direction in DIRECTIONS, f"frame direction is one of {', '.join(DIRECTIONS)}.")
        margin = number(spec.get("margin"), "frame margin", minimum=0, maximum=0.9, default=0.1)
        way, ahead = heading(DIRECTIONS[direction], spec.get("elevation"), spec.get("around"))
        frame(camera, targets, way, margin, aspect, ahead)
        # A turn adds to the direction's own, so where it lands is said outright,
        # and so is which way is up a picture taken straight down.
        moved = f", {spec['around']:g}° round: {side_of(way, ahead)}" if spec.get("around") is not None else ""
        raised = f", {spec['elevation']:g}° above level" if spec.get("elevation") is not None else ""
        plan = f", {up_the_picture(ahead)}" if vertical(way) and not moved else ""
        said.append(
            f"framing {', '.join(o.name for o in targets) if spec.get('objects') else 'everything'} from the {direction}{moved}{raised}{plan}"
        )
        if data.type == "ORTHO":
            said.append(f"{length(data.ortho_scale)} across")
    else:
        need(
            args.get("look_at") is None or args.get("look_at_object") is None,
            "Aim at a point with look_at or at an object with look_at_object, not both.",
        )
        if args.get("location") is not None:
            camera.location = vector(args["location"], "location")
            said.append(f"at {point_text(camera.location)}")
        if args.get("look_at") is not None:
            point = vector(args["look_at"], "look_at")
            look_at(camera, point)
            said.append(f"looking at {point_text(point)}{plan_reading(camera, point)}")
        if args.get("look_at_object") is not None:
            target = find_object(args["look_at_object"])
            look_at(camera, middle_of(target))
            said.append(f"looking at the middle of {target.name}{plan_reading(camera, middle_of(target))}")
    dof = args.get("depth_of_field")
    if isinstance(dof, dict) and dof.get("off"):
        data.dof.use_dof = False
        data.pop("zhiyin_focus", None)
        said.append("no background blur")
    elif dof is not None:
        need(isinstance(dof, dict), "depth_of_field gives what to focus on (focus_object or focus_distance) and an aperture.")
        need(
            (dof.get("focus_object") is None) != (dof.get("focus_distance") is None),
            "depth_of_field focuses on an object (focus_object) or at a distance (focus_distance): give one of them.",
        )
        data.dof.use_dof = True
        data.dof.focus_object = None
        if dof.get("focus_object") is not None:
            data["zhiyin_focus"] = find_object(dof["focus_object"]).name
        else:
            data.pop("zhiyin_focus", None)
            data.dof.focus_distance = number(dof.get("focus_distance"), "focus_distance", minimum=0.001)
        data.dof.aperture_fstop = number(dof.get("aperture"), "aperture", minimum=0.5, maximum=128, default=2.8)
        refocus(camera)
        focus = data.get("zhiyin_focus")
        said.append(f"background blur at f/{data.dof.aperture_fstop:g}, focused " + (f"on {focus}" if focus else f"{length(data.dof.focus_distance)} away"))
    if args.get("exposure") is not None:
        settings = scene().view_settings
        settings.exposure = number(args["exposure"], "exposure", minimum=-10, maximum=10)
        said.append(f"exposure {settings.exposure:+g}")
    if args.get("tone") is not None:
        set_tone(args["tone"])
        said.append(f"{args['tone']} tone")
    refocus(camera)
    bpy.context.view_layer.update()
    seen = in_picture(camera, subjects())
    return f"Camera: {', '.join(part for part in said if part)}." + (f" It {'; '.join(seen)}." if seen else "")


# ---- lighting -------------------------------------------------------------------------------

LIGHT_KINDS = {"area": "AREA", "point": "POINT", "spot": "SPOT", "sun": "SUN"}


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
    """A light as answers and the scene's description say it."""
    data = obj.data
    said = f"{obj.name} ({data.type.lower()} light, {data.energy:g} {'strength' if data.type == 'SUN' else 'W'}"
    if data.type == "AREA":
        said += f", {length(data.size)} across"
    said += f") at {point_text(obj.matrix_world.translation)}"
    if obj.get("zhiyin_aim") is not None:
        said += f", aimed at {point_text(obj['zhiyin_aim'])}"
    return said


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
    if given("color"):
        data.color = colour(spec.get("color"), "light color", default="#ffffff")[:3]
    if kind == "SUN":
        if given("strength"):
            data.energy = number(spec.get("strength"), "sun strength", minimum=0, maximum=1000, default=3)
    else:
        if given("power"):
            data.energy = number(spec.get("power"), "light power", minimum=0, maximum=1e7, default=100)
        # EEVEE leaves out a light past a reach it works out from the light's
        # power, so a weak light on a small product would never reach the
        # backdrop behind it. Cycles has no such reach.
        data.use_custom_distance = True
        data.cutoff_distance = LIGHT_REACH
    if kind == "AREA":
        if given("round"):
            data.shape = "DISK" if spec.get("round") else "RECTANGLE"
        if given("size"):
            data.size = number(spec.get("size"), "light size", minimum=1e-4, default=1)
        if data.shape == "RECTANGLE":
            data.size_y = data.size
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
        aim = vector(spec.get("look_at"), "look_at", default=(0, 0, 0))
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
# Set so a matte grey of #777777 renders close to #777777 in Cycles, with the
# backdrop in reflections as above.
PRODUCT_LIGHT = 0.26
# The studio lights without the backdrop, set so a matt surface is lit to
# about one and a half times its own colour: the agx tone shows that close to
# the colour, where three times it, as the lights alone give, shows it pale.
STUDIO_LIGHT = 0.46
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
    strength = number(value, "backdrop_reflections", minimum=0, maximum=1)
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
                        "power": power * 200 * reach**2 * (PRODUCT_LIGHT if name == "product" else STUDIO_LIGHT),
                        "size": reach * size,
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
        world_colour("#2a2a2a", 0.4)
        set_tone("agx")
        return f"studio lights (key, fill and rim), with the agx tone{exposure_left()}"
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
        if node.type != "OUTPUT_WORLD":
            tree.nodes.remove(node)
    output = next((n for n in tree.nodes if n.type == "OUTPUT_WORLD"), None) or tree.nodes.new("ShaderNodeOutputWorld")
    background = tree.nodes.new("ShaderNodeBackground")
    tree.links.new(background.outputs["Background"], output.inputs["Surface"])
    return tree, background


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


def hdri(path, strength, turn):
    tree, background = world_nodes()
    texture = tree.nodes.new("ShaderNodeTexEnvironment")
    texture.image = bpy.data.images.load(path, check_existing=True)
    if bpy.data.filepath:
        texture.image.filepath = bpy.path.relpath(path)
    mapping = tree.nodes.new("ShaderNodeMapping")
    mapping.inputs["Rotation"].default_value = (0, 0, turn)
    coordinates = tree.nodes.new("ShaderNodeTexCoord")
    tree.links.new(coordinates.outputs["Generated"], mapping.inputs["Vector"])
    tree.links.new(mapping.outputs["Vector"], texture.inputs["Vector"])
    tree.links.new(texture.outputs["Color"], background.inputs["Color"])
    background.inputs["Strength"].default_value = strength


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
        if background.get("hdri"):
            hdri(background["hdri"], strength, math.radians(number(background.get("rotation"), "hdri rotation", default=0)))
            said.append(f"surroundings from {os.path.basename(background['hdri'])}")
        elif background.get("sky") is not None:
            spec = background["sky"]
            need(isinstance(spec, dict), "sky gives the sun's elevation and rotation in degrees.")
            elevation = math.radians(number(spec.get("sun_elevation"), "sun_elevation", minimum=-10, maximum=90, default=35))
            turn = math.radians(number(spec.get("sun_rotation"), "sun_rotation", default=0))
            sky(elevation, turn, strength)
            said.append(f"a sky with {sun_text(elevation, turn)}")
        else:
            world_colour(background.get("color", "#7a7a7a"), strength)
            said.append(f"a {background.get('color', '#7a7a7a')} background")
    lit = [light(spec, group) for spec in args.get("lights") or []]
    # A light just made is where it was put once the scene has taken it in.
    bpy.context.view_layer.update()
    said += [light_text(made) for made in lit]
    if args.get("backdrop_reflections") is not None:
        said.append(backdrop_reflections(args["backdrop_reflections"]))
    need(said, "Give a preset, a background, lights or backdrop_reflections.")
    return f"Lighting: {'; '.join(said)}."
