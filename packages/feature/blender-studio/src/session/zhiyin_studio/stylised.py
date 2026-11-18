"""
Stylised looks: toon shading built onto a material, in flat bands of light with a rim round its edge
when asked, and an outline as an inverted hull, a dark shell round an object whose near side is never drawn.

Measured in Blender 5.2: Shader to RGB gives EEVEE its banded light and leaves Cycles smooth;
Cycles draws the Toon BSDF in steps, which EEVEE draws as plain diffuse; a material with one
output for each engine draws each its own. The hull, see-through to every ray but the camera's
where it faces the camera, outlines a shape in both engines and leaves its lighting as it was.
"""

import math

import bpy
import mathutils

from .arguments import colour, need, number, whole
from .errors import Refused
from .finding import scene
from .picking import mesh_object
from .render_post import compositor_group, post
from .reports import report
from .wording import hex_of, length

TOON = "Zhiyin toon"
OUTLINE = "Zhiyin outline"
# The share of its colour the darkest band shows by default.
SHADOW = 0.35
MOST_BANDS = 8
BANDS = 3
# How much of the surface's turn away from the camera the rim covers: at least, by default and at most.
LEAST_RIM, RIM, MOST_RIM = 0.01, 0.2, 1


def toon_material(material):
    """A material by itself or its name."""
    if isinstance(material, str):
        found = bpy.data.materials.get(material)
        if found is None:
            names = [m.name for m in bpy.data.materials if not m.name.startswith("Zhiyin")][:20]
            raise Refused(f"There is no material named “{material}”. The scene has: {', '.join(names) or 'none'}.")
        material = found
    need(isinstance(material, bpy.types.Material), "toon takes a material or its name.")
    need(not material.is_grease_pencil, f"{material.name} is a Grease Pencil material, which has no surface to shade.")
    return material


def base_colour(material, nodes):
    """Where a material's colour comes from: the socket linked into its surface's colour, or the colour itself."""
    surface = next((n for n in nodes if n.type == "BSDF_PRINCIPLED" and not n.name.startswith(TOON)), None)
    if surface is not None:
        socket = surface.inputs["Base Color"]
        if socket.is_linked:
            return socket.links[0].from_socket, None
        return None, tuple(socket.default_value)
    return None, tuple(material.diffuse_color)


def band_tints(bands, shadow):
    """What each band multiplies the colour by, darkest first, in each channel: from the shadow's tint up to white."""
    if bands == 1:
        return [(1.0, 1.0, 1.0)]
    return [tuple(c + (1 - c) * i / (bands - 1) for c in shadow) for i in range(bands)]


def shaded_toon(material, bands=BANDS, *, shadow=SHADOW, shadow_color=None, rim=None, faceted=False):
    """Builds the toon onto a material, as toon says; the material and what was built, as words."""
    material = toon_material(material)
    bands = whole(bands, "bands", minimum=1, maximum=MOST_BANDS)
    need(shadow == SHADOW or shadow_color is None, "Give the darkest band as shadow, a share, or as shadow_color, a tint: not both.")
    tint = tuple(colour(shadow_color, "shadow_color")[:3]) if shadow_color is not None else (number(shadow, "shadow", minimum=0, maximum=1),) * 3
    need(rim is None or isinstance(rim, dict), 'rim is {"color": "#rrggbb", "width": 0.2}.')
    rim_rgba = colour((rim or {}).get("color"), "rim color", default="#ffffff") if rim is not None else None
    rim_width = number((rim or {}).get("width"), "rim width", minimum=LEAST_RIM, maximum=MOST_RIM, default=RIM) if rim is not None else 0
    need(isinstance(faceted, bool), "faceted is True or False.")
    material.use_nodes = True
    tree = material.node_tree
    nodes, links = tree.nodes, tree.links
    for node in [n for n in nodes if n.name.startswith(TOON)]:
        nodes.remove(node)
    source, rgba = base_colour(material, nodes)
    tints = band_tints(bands, tint)

    def made(kind, label):
        node = nodes.new(kind)
        node.name = f"{TOON} {label}"
        node.label = node.name
        return node

    normal = made("ShaderNodeNewGeometry", "faces") if faceted else None
    # EEVEE: the light a diffuse surface gets, as a value, cut into bands.
    diffuse = made("ShaderNodeBsdfDiffuse", "light")
    diffuse.inputs["Color"].default_value = (1, 1, 1, 1)
    if normal is not None:
        links.new(normal.outputs["True Normal"], diffuse.inputs["Normal"])
    to_rgb = made("ShaderNodeShaderToRGB", "light as colour")
    links.new(diffuse.outputs["BSDF"], to_rgb.inputs["Shader"])
    ramp = made("ShaderNodeValToRGB", "bands")
    ramp.color_ramp.interpolation = "CONSTANT"
    elements = ramp.color_ramp.elements
    while len(elements) < bands:
        elements.new(0.5)
    while len(elements) > bands:
        elements.remove(elements[-1])
    for index, (element, band) in enumerate(zip(elements, tints)):
        element.position = 0 if index == 0 else index / bands
        element.color = (*band, 1)
    links.new(to_rgb.outputs["Color"], ramp.inputs["Fac"])
    tinted = made("ShaderNodeMix", "tint")
    tinted.data_type = "RGBA"
    tinted.blend_type = "MULTIPLY"
    sockets = {s.identifier: s for s in tinted.inputs}
    sockets["Factor_Float"].default_value = 1
    links.new(ramp.outputs["Color"], sockets["A_Color"])
    if source is not None:
        links.new(source, sockets["B_Color"])
    else:
        sockets["B_Color"].default_value = rgba
    flat = next(s for s in tinted.outputs if s.type == "RGBA")
    # The rim: the rim's colour where the surface turns away from the camera, nothing elsewhere.
    edge = None
    if rim_rgba is not None:
        facing = made("ShaderNodeLayerWeight", "rim facing")
        if normal is not None:
            links.new(normal.outputs["True Normal"], facing.inputs["Normal"])
        edge = made("ShaderNodeValToRGB", "rim")
        edge.color_ramp.interpolation = "CONSTANT"
        low, high = edge.color_ramp.elements
        low.position, low.color = 0, (0, 0, 0, 1)
        high.position, high.color = 1 - rim_width, rim_rgba
        links.new(facing.outputs["Facing"], edge.inputs["Fac"])
        lit = made("ShaderNodeMix", "rim added")
        lit.data_type = "RGBA"
        lit.blend_type = "ADD"
        added = {s.identifier: s for s in lit.inputs}
        added["Factor_Float"].default_value = 1
        links.new(flat, added["A_Color"])
        links.new(edge.outputs["Color"], added["B_Color"])
        flat = next(s for s in lit.outputs if s.type == "RGBA")
    glow = made("ShaderNodeEmission", "flat")
    links.new(flat, glow.inputs["Color"])
    eevee = made("ShaderNodeOutputMaterial", "EEVEE")
    eevee.target = "EEVEE"
    links.new(glow.outputs["Emission"], eevee.inputs["Surface"])
    # Cycles: one Toon BSDF a band, each lighting a narrower cone toward the light.
    total = None
    for index in range(bands):
        step = made("ShaderNodeBsdfToon", f"band {index + 1}")
        step.component = "DIFFUSE"
        step.inputs["Size"].default_value = 1 - index / bands
        step.inputs["Smooth"].default_value = 0
        weight = [c - (tints[index - 1][k] if index else 0) for k, c in enumerate(tints[index])]
        if source is not None:
            scaled = made("ShaderNodeMix", f"band {index + 1} colour")
            scaled.data_type = "RGBA"
            scaled.blend_type = "MULTIPLY"
            inputs = {s.identifier: s for s in scaled.inputs}
            inputs["Factor_Float"].default_value = 1
            links.new(source, inputs["A_Color"])
            inputs["B_Color"].default_value = (*weight, 1)
            links.new(next(s for s in scaled.outputs if s.type == "RGBA"), step.inputs["Color"])
        else:
            step.inputs["Color"].default_value = [c * w for c, w in zip(rgba[:3], weight)] + [1]
        if normal is not None:
            links.new(normal.outputs["True Normal"], step.inputs["Normal"])
        if total is None:
            total = step.outputs["BSDF"]
            continue
        added = made("ShaderNodeAddShader", f"band {index + 1} added")
        links.new(total, added.inputs[0])
        links.new(step.outputs["BSDF"], added.inputs[1])
        total = added.outputs["Shader"]
    if edge is not None:
        rim_glow = made("ShaderNodeEmission", "rim glow")
        links.new(edge.outputs["Color"], rim_glow.inputs["Color"])
        with_rim = made("ShaderNodeAddShader", "rim in Cycles")
        links.new(total, with_rim.inputs[0])
        links.new(rim_glow.outputs["Emission"], with_rim.inputs[1])
        total = with_rim.outputs["Shader"]
    cycles = made("ShaderNodeOutputMaterial", "Cycles")
    cycles.target = "CYCLES"
    links.new(total, cycles.inputs["Surface"])
    # The material's own outputs give way to the toon's.
    for node in nodes:
        if node.type == "OUTPUT_MATERIAL" and not node.name.startswith(TOON):
            node.is_active_output = False
    eevee.is_active_output = True
    cycles.is_active_output = True
    users = [o.name for o in scene().objects if any(slot.material == material for slot in o.material_slots)]
    grey = len(set(tint)) == 1
    by = (lambda band: f"{band[0]:.0%}") if grey else (lambda band: f"times {hex_of(band)}")
    colours = (
        "its own colouring at " + ", ".join(by(band) for band in tints)
        if source is not None
        else ", ".join(f"{hex_of([c * t for c, t in zip(rgba[:3], band)])} ({by(band)})" for band in tints)
    )
    return material, (
        f"toon {material.name}: {bands} {'band' if bands == 1 else 'bands'} of light, darkest first: {colours}"
        + (f", a {hex_of(rim_rgba)} rim over the outer {rim_width:.0%} of the turn away from the camera" if rim_rgba is not None else "")
        + (", each face shaded flat" if faceted else "")
        + "; EEVEE draws them flat from Shader to RGB through a constant ramp, Cycles as Toon BSDFs stepped by the angle to the light"
        + (f"; on {', '.join(users)}" if users else "; on no object yet")
    )


def toon(material, bands=BANDS, *, shadow=SHADOW, shadow_color=None, rim=None, faceted=False):
    """
    Shades a material in flat bands of light, built onto it: its colour, or
    the picture or nodes that colour it, kept. EEVEE draws Shader to RGB
    through a constant ramp; Cycles, which cannot read light as a colour,
    draws as many Toon BSDFs, stepped by the angle to the light. The darkest
    band is the colour times shadow, or tinted by shadow_color, and the bands
    rise from it to the colour itself. A rim, {"color", "width"}, glows round
    the shape's edge as the camera sees it. Faceted, each face is shaded flat
    by its own normal. Named again, the toon is made anew.
    """
    material, said = shaded_toon(material, bands, shadow=shadow, shadow_color=shadow_color, rim=rim, faceted=faceted)
    report(said)
    return material


def pixel_size(obj):
    """How wide one pixel of the camera's picture is at an object's middle, in metres, and how far it is."""
    s = scene()
    camera = s.camera
    need(camera is not None, "Outline widths are in pixels of the camera's picture: set a camera first.")
    bpy.context.view_layer.update()
    corners = [obj.matrix_world @ mathutils.Vector(c) for c in obj.bound_box]
    middle = sum(corners, mathutils.Vector()) / len(corners)
    ahead = camera.matrix_world.to_quaternion() @ mathutils.Vector((0, 0, -1))
    distance = max((middle - camera.matrix_world.translation).dot(ahead), 1e-3)
    widest = max(s.render.resolution_x, s.render.resolution_y) * s.render.resolution_percentage / 100
    data = camera.data
    if data.type == "ORTHO":
        return data.ortho_scale / widest, distance
    return 2 * distance * math.tan(data.angle / 2) / widest, distance


def outline_material(rgba):
    """
    Dark where the hull faces away from the camera, round the shape's edge;
    clear where it faces the camera and to every other ray, so the shape is
    seen and lit as it was.
    """
    name = f"{OUTLINE} {hex_of(rgba)}"
    material = bpy.data.materials.get(name)
    if material is not None:
        return material
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    nodes.clear()
    ink = nodes.new("ShaderNodeEmission")
    ink.inputs["Color"].default_value = rgba
    clear = nodes.new("ShaderNodeBsdfTransparent")
    facing = nodes.new("ShaderNodeNewGeometry")
    path = nodes.new("ShaderNodeLightPath")
    other = nodes.new("ShaderNodeMath")
    other.operation = "SUBTRACT"
    other.inputs[0].default_value = 1
    links.new(path.outputs["Is Camera Ray"], other.inputs[1])
    either = nodes.new("ShaderNodeMath")
    either.operation = "MAXIMUM"
    links.new(facing.outputs["Backfacing"], either.inputs[0])
    links.new(other.outputs["Value"], either.inputs[1])
    mix = nodes.new("ShaderNodeMixShader")
    links.new(either.outputs["Value"], mix.inputs["Fac"])
    links.new(ink.outputs["Emission"], mix.inputs[1])
    links.new(clear.outputs["BSDF"], mix.inputs[2])
    links.new(mix.outputs["Shader"], nodes.new("ShaderNodeOutputMaterial").inputs["Surface"])
    material.use_backface_culling = True
    return material


def hull(obj, thickness, rgba):
    """Gives a mesh an inverted hull this many pixels wide; its width in metres and its distance from the camera."""
    metres_per_pixel, distance = pixel_size(obj)
    width = thickness * metres_per_pixel
    step = obj.modifiers.get(OUTLINE) or obj.modifiers.new(OUTLINE, "SOLIDIFY")
    material = outline_material(rgba)
    slots = [slot.material for slot in obj.material_slots]
    for index in reversed(range(len(slots))):
        if slots[index] is not None and slots[index].name.startswith(OUTLINE):
            obj.data.materials.pop(index=index)
    if not obj.data.materials:
        obj.data.materials.append(None)
    obj.data.materials.append(material)
    step.thickness = width
    step.offset = 1
    step.use_flip_normals = True
    step.use_rim = False
    step.use_even_offset = True
    step.material_offset = len(obj.data.materials) - 1
    return width, distance


def remove_hull(obj):
    """Takes an object's hull away; whether it had one."""
    step = obj.modifiers.get(OUTLINE)
    if step is None:
        return False
    obj.modifiers.remove(step)
    for index in reversed(range(len(obj.data.materials))):
        material = obj.data.materials[index]
        if material is not None and material.name.startswith(OUTLINE):
            obj.data.materials.pop(index=index)
    return True


def hull_text(done):
    """The hulls made, as words."""
    return "; ".join(f"{name} {length(width)} wide, at {length(distance)} from the camera" for name, width, distance in done)


def outline(objects, thickness=2, *, color="#000000"):
    """
    Outlines meshes with an inverted hull: a shell pushed out round each, as
    many pixels of the camera's picture wide at its distance, drawn only
    where it shows past the shape's edge, in Cycles and in EEVEE. Named
    again, an object's hull is made anew.
    """
    if isinstance(objects, (str, bpy.types.Object)):
        objects = [objects]
    need(isinstance(objects, (list, tuple)) and objects, "outline takes a mesh object, its name, or a list of them.")
    thickness = number(thickness, "thickness", minimum=0.1, maximum=100)
    rgba = colour(color, "color")
    done = []
    for item in objects:
        obj = mesh_object(item, "outline")
        width, distance = hull(obj, thickness, rgba)
        done.append((obj.name, width, distance))
    report(
        f"outline by an inverted hull, {thickness:g} px of the picture, {hex_of(rgba)}: {hull_text(done)}; drawn past each shape's edge"
        " in Cycles and EEVEE, its light left as it was"
    )
    return [bpy.data.objects[name] for name, _, _ in done]


# The compositor's functions join the looks: a picture's post and Blender's bundled compositor groups.
FUNCTIONS = (toon, outline, post, compositor_group)
