"""
A material's surface drawn for a bake as one value glowing: its colour, roughness, metalness,
opacity or relief height, or a measure of its shape such as how sharp its edges are, put in place
of what it draws and taken out again after. A surface that mixes shaders is drawn as the same mix
of what each of them gives, so a bake reads any material, not only one shader's inputs. Cycles
bakes the glow as it is, which makes a value of any material a picture.
"""

import contextlib

import bpy

from .errors import Refused

# What each value is read from in each kind of shader, and what a shader without it gives.
READ = {
    "color": {"BSDF_PRINCIPLED": "Base Color", "*": "Color"},
    "roughness": {"BSDF_PRINCIPLED": "Roughness", "BSDF_GLOSSY": "Roughness", "BSDF_GLASS": "Roughness", "BSDF_REFRACTION": "Roughness", "BSDF_ANISOTROPIC": "Roughness"},
    "metallic": {"BSDF_PRINCIPLED": "Metallic"},
    "opacity": {"BSDF_PRINCIPLED": "Alpha"},
    "emission": {"BSDF_PRINCIPLED": "Emission Color", "EMISSION": "Color"},
}
# How strongly a shader glows, for its glow.
STRENGTH = {"BSDF_PRINCIPLED": "Emission Strength", "EMISSION": "Strength"}
OTHERWISE = {
    "color": {"*": (0.8, 0.8, 0.8, 1.0)},
    "roughness": {"*": 1.0},
    "metallic": {"BSDF_GLOSSY": 1.0, "BSDF_ANISOTROPIC": 1.0, "*": 0.0},
    "opacity": {"BSDF_TRANSPARENT": 0.0, "HOLDOUT": 0.0, "*": 1.0},
    "emission": {"*": 0.0},
}
SHADER_MIXES = {"MIX_SHADER", "ADD_SHADER"}
# How far a right-angled edge's rounding turns the normal: 1 - cos 45°.
RIGHT_EDGE = 0.2929


def _made(tree, kind, made, **settings):
    node = tree.nodes.new(kind)
    for key, value in settings.items():
        setattr(node, key, value)
    made.append(node)
    return node


def _feed(tree, socket, into):
    """Feeds `into` what feeds `socket`, or its own value."""
    if socket.is_linked:
        tree.links.new(socket.links[0].from_socket, into)
        return
    value = socket.default_value
    if not hasattr(into.default_value, "__len__"):
        into.default_value = value[0] if hasattr(value, "__len__") else value
        return
    values = tuple(value) if hasattr(value, "__len__") else (value, value, value)
    width = len(into.default_value)
    into.default_value = (values + (1.0,) * width)[:width]


def _glowing(tree, made):
    """An Emission shader, its output and its colour input, glowing at strength 1."""
    glow = _made(tree, "ShaderNodeEmission", made)
    glow.inputs["Strength"].default_value = 1.0
    return glow


def _value_of(tree, shader, value, made):
    """The shader drawn as the value glowing: mixes as the same mix of each shader's value."""
    if shader is None:
        glow = _glowing(tree, made)
        _set(glow.inputs["Color"], OTHERWISE[value]["*"])
        return glow.outputs[0]
    if shader.type in SHADER_MIXES:
        mix = _made(tree, "ShaderNodeMixShader" if shader.type == "MIX_SHADER" else "ShaderNodeAddShader", made)
        shaders = [s for s in shader.inputs if s.type == "SHADER"]
        if shader.type == "MIX_SHADER":
            _feed(tree, shader.inputs["Fac"], mix.inputs["Fac"])
        targets = [s for s in mix.inputs if s.type == "SHADER"]
        for given, into in zip(shaders, targets):
            source = given.links[0].from_node if given.is_linked else None
            tree.links.new(_value_of(tree, source, value, made), into)
        return mix.outputs[0]
    glow = _glowing(tree, made)
    name = READ[value].get(shader.type) or (READ[value].get("*") if shader.type.startswith("BSDF") or shader.type == "EMISSION" else None)
    socket = shader.inputs.get(name) if name else None
    if socket is not None:
        _feed(tree, socket, glow.inputs["Color"])
        if value == "emission":
            _feed(tree, shader.inputs[STRENGTH[shader.type]], glow.inputs["Strength"])
    else:
        _set(glow.inputs["Color"], OTHERWISE[value].get(shader.type, OTHERWISE[value]["*"]))
    return glow.outputs[0]


def _set(socket, value):
    socket.default_value = value if isinstance(value, tuple) else (value, value, value, 1.0)


def _height(tree, output, made):
    """The relief a displacement gives, in metres along the normal, glowing; refused for a material with none."""
    socket = output.inputs.get("Displacement")
    source = socket.links[0].from_node if socket is not None and socket.is_linked else None
    if source is None or source.type != "DISPLACEMENT":
        raise Refused("height")
    less = _made(tree, "ShaderNodeMath", made, operation="SUBTRACT")
    _feed(tree, source.inputs["Height"], less.inputs[0])
    _feed(tree, source.inputs["Midlevel"], less.inputs[1])
    times = _made(tree, "ShaderNodeMath", made, operation="MULTIPLY")
    tree.links.new(less.outputs[0], times.inputs[0])
    _feed(tree, source.inputs["Scale"], times.inputs[1])
    glow = _glowing(tree, made)
    tree.links.new(times.outputs[0], glow.inputs["Color"])
    return glow.outputs[0]


def _shape_measure(tree, value, made, reach):
    """
    A measure of the shape at each point, glowing: how much of the open sky round it the scene
    hides within `reach`, its edges, its curvature, its hollows, its thinness, where it is and
    which way it faces.
    """
    glow = _glowing(tree, made)
    if value in ("position", "normal"):
        geometry = _made(tree, "ShaderNodeNewGeometry", made)
        tree.links.new(geometry.outputs["Position" if value == "position" else "Normal"], glow.inputs["Color"])
        return glow.outputs[0]
    if value in ("ao", "cavity", "thickness"):
        occlusion = _made(tree, "ShaderNodeAmbientOcclusion", made, inside=value == "thickness", only_local=value != "ao")
        occlusion.inputs["Distance"].default_value = reach
        if value != "thickness":
            tree.links.new(occlusion.outputs["AO"], glow.inputs["Color"])
        else:
            thin = _made(tree, "ShaderNodeMath", made, operation="SUBTRACT")
            thin.inputs[0].default_value = 1.0
            tree.links.new(occlusion.outputs["AO"], thin.inputs[1])
            tree.links.new(thin.outputs[0], glow.inputs["Color"])
        return glow.outputs[0]
    # Edges and curvature: how far rounding the edges by `reach` turns the normal.
    geometry = _made(tree, "ShaderNodeNewGeometry", made)
    rounded = _made(tree, "ShaderNodeBevel", made, samples=8)
    rounded.inputs["Radius"].default_value = reach
    turned = _made(tree, "ShaderNodeVectorMath", made, operation="DOT_PRODUCT")
    tree.links.new(rounded.outputs["Normal"], turned.inputs[0])
    tree.links.new(geometry.outputs["Normal"], turned.inputs[1])
    edge = _made(tree, "ShaderNodeMapRange", made, clamp=True)
    tree.links.new(turned.outputs["Value"], edge.inputs["Value"])
    edge.inputs["From Min"].default_value = 1.0
    edge.inputs["From Max"].default_value = 1.0 - RIGHT_EDGE
    if value == "edge":
        tree.links.new(edge.outputs["Result"], glow.inputs["Color"])
        return glow.outputs[0]
    # Curvature: half grey, lighter on edges that stand out and darker in those that sink in.
    side = _made(tree, "ShaderNodeMath", made, operation="SUBTRACT")
    tree.links.new(geometry.outputs["Pointiness"], side.inputs[0])
    side.inputs[1].default_value = 0.5
    sign = _made(tree, "ShaderNodeMath", made, operation="SIGN")
    tree.links.new(side.outputs[0], sign.inputs[0])
    signed = _made(tree, "ShaderNodeMath", made, operation="MULTIPLY")
    tree.links.new(edge.outputs["Result"], signed.inputs[0])
    tree.links.new(sign.outputs[0], signed.inputs[1])
    half = _made(tree, "ShaderNodeMath", made, operation="MULTIPLY_ADD")
    tree.links.new(signed.outputs[0], half.inputs[0])
    half.inputs[1].default_value = 0.5
    half.inputs[2].default_value = 0.5
    tree.links.new(half.outputs[0], glow.inputs["Color"])
    return glow.outputs[0]


def surface_output(material):
    """The material output Cycles draws."""
    return material.node_tree.get_output_node("CYCLES") if material.node_tree else None


@contextlib.contextmanager
def glowing(materials, value, reach=0.0):
    """
    Draws each material's surface as `value` glowing while the block runs: a shader input
    (color, roughness, metallic, opacity, emission), height, a shape measure (ao, edge,
    curvature, cavity, thickness, position, normal), or "lit" for a plain white glow. Refused("height") for a
    material with no displacement to read height from.
    """
    undo = []
    try:
        for material in materials:
            tree = material.node_tree
            output = surface_output(material)
            if output is None:
                output = tree.nodes.new("ShaderNodeOutputMaterial")
                undo.append((tree, [output], None, None))
            surface = output.inputs["Surface"]
            before = surface.links[0].from_socket if surface.is_linked else None
            made = []
            undo.append((tree, made, surface, before))
            if value == "lit":
                glow = _glowing(tree, made)
                glow.inputs["Color"].default_value = (1, 1, 1, 1)
                shown = glow.outputs[0]
            elif value == "height":
                shown = _height(tree, output, made)
            elif value in READ:
                shown = _value_of(tree, before.node if before is not None else None, value, made)
            else:
                shown = _shape_measure(tree, value, made, reach)
            tree.links.new(shown, surface)
        yield
    finally:
        for tree, made, surface, before in reversed(undo):
            for node in made:
                tree.nodes.remove(node)
            if surface is not None and before is not None:
                tree.links.new(before, surface)


def stand_in_material():
    """A plain material for a shape that has none, drawn as Blender draws one: grey, half rough."""
    material = bpy.data.materials.new("Zhiyin bake stand-in")
    return material
