"""
A material's nodes in words: what feeds each input of its surface, as
“Base Color <- Mix(Noise 3 mm, #8a5a3c..#b07a50)”, the nodes that feed
nothing, picture nodes with no picture, and the nodes only Cycles draws, with
what EEVEE draws instead. Measured by rendering each node in both engines in
Blender 5.2: EEVEE gives a Bevel's normal as the plain normal, Pointiness as
0.5 and Random Per Island as 0, draws Toon, Hair and Sheen BSDFs as a plain
diffuse surface, and its occlusion from inside a shape does not see through it.
"""

import bpy

from .wording import enumerated, hex_of, length

# The name of each node the shading library made; its label says what it gives.
LIBRARY = "Zhiyin shading"
# The library's point in metres on the object, which textures are drawn at.
METRES = f"{LIBRARY} metres"
# A library node only Cycles draws keeps what EEVEE draws instead under this key.
EEVEE_GIVES = "zhiyin_eevee"
# How deep a description follows the nodes feeding an input, and how long it may be.
DEEPEST = 5
LONGEST = 200
# What EEVEE draws in place of the nodes, or one output of them, only Cycles draws.
DIFFUSE = "which draws it as a plain diffuse surface"
CYCLES_ONLY = {
    ("BEVEL", None): "which gives the plain normal",
    ("NEW_GEOMETRY", "Pointiness"): "which gives 0.5 everywhere",
    ("NEW_GEOMETRY", "Random Per Island"): "which gives 0 everywhere",
    ("BSDF_TOON", None): DIFFUSE,
    ("BSDF_HAIR", None): DIFFUSE,
    ("BSDF_SHEEN", None): DIFFUSE,
}
# Coordinates a texture is read at, by the output of a Texture Coordinate node.
PROJECTIONS = {"BOX": "box projection", "SPHERE": "sphere projection", "TUBE": "cylinder projection"}


def is_library(node):
    return node.name.startswith(LIBRARY) and bool(node.label)


def is_mark(node):
    """A value the session keeps in a material to read back, such as its finish's name: it feeds nothing by design."""
    return node.type == "VALUE" and node.name.startswith("Zhiyin ")


def outputs_of(material):
    tree = material.node_tree
    return [n for n in tree.nodes if n.type == "OUTPUT_MATERIAL"] if tree else []


def output_of(material):
    """The material output Blender draws: the active one, or the first."""
    found = outputs_of(material)
    return next((n for n in found if n.is_active_output), found[0] if found else None)


def drawn_by_eevee(material):
    """The material outputs EEVEE draws: those for it alone, else those for every engine."""
    found = outputs_of(material)
    own = [n for n in found if n.target == "EEVEE"]
    return own or [n for n in found if n.target == "ALL"]


def reached(material, outputs=None):
    """The names of the nodes whose values reach a material output, or the outputs given."""
    seen, waiting = set(), list(outputs_of(material) if outputs is None else outputs)
    while waiting:
        node = waiting.pop()
        if node.name in seen:
            continue
        seen.add(node.name)
        waiting += [link.from_node for each in node.inputs for link in each.links]
    return seen


def idle_ends(material):
    """
    The nodes that feed nothing a material output draws, each where its
    chain ends: a chain of nodes feeding only one another is named by its last.
    """
    tree = material.node_tree
    used = reached(material)
    idle = [n for n in tree.nodes if n.name not in used and n.type != "FRAME" and not is_mark(n)]
    names = {n.name for n in idle}
    ends = [n for n in idle if not any(link.to_node.name in names for out in n.outputs for link in out.links)]
    return [n.label if is_library(n) else n.name for n in ends]


def names_text(names):
    return enumerated(names, 3), "feeds" if len(names) == 1 else "feed"


def feeds(node):
    """The inputs of shaders and of the output that a node's values end in, by name."""
    found, waiting, seen = [], [link for out in node.outputs for link in out.links], set()
    while waiting:
        link = waiting.pop()
        target = link.to_node
        if target.type == "BSDF_PRINCIPLED" or target.type == "OUTPUT_MATERIAL":
            if link.to_socket.name not in found:
                found.append(link.to_socket.name)
            continue
        if target.name in seen:
            continue
        seen.add(target.name)
        waiting += [after for out in target.outputs for after in out.links]
    return found


def cycles_only(material):
    """What reaches an output EEVEE draws that only Cycles draws, as (what it is, the inputs it feeds, what EEVEE draws instead)."""
    used = reached(material, drawn_by_eevee(material))
    found = []
    for node in material.node_tree.nodes:
        if node.name not in used:
            continue
        what = node.label if is_library(node) else node.name
        eevee = node.get(EEVEE_GIVES)
        if eevee:
            found.append((what, feeds(node), eevee))
            continue
        if (node.type, None) in CYCLES_ONLY:
            found.append((what, feeds(node), CYCLES_ONLY[(node.type, None)]))
            continue
        for out in node.outputs:
            gives = CYCLES_ONLY.get((node.type, out.name))
            if gives and out.is_linked:
                found.append((what if is_library(node) else f"{what}'s {out.name}", feeds(node), gives))
    return found


def renders_with_eevee():
    return bpy.context.scene.render.engine.startswith("BLENDER_EEVEE")


# ---- what feeds an input, in words -------------------------------------------------------------


def number_text(value):
    return f"{value:.4g}"


def value_text(socket):
    """An input's own value: a colour as #rrggbb, a number, or a vector."""
    value = getattr(socket, "default_value", None)
    if value is None:
        return "nothing"
    if socket.type == "RGBA":
        return hex_of(value)
    if hasattr(value, "__len__") and not isinstance(value, str):
        return "(" + ", ".join(number_text(v) for v in value) + ")"
    if isinstance(value, bool):
        return "on" if value else "off"
    if isinstance(value, (int, float)):
        return number_text(value)
    return str(value)


def input_text(socket, depth=0):
    """What an input is given: what feeds it, or its own value."""
    if socket.is_linked:
        return said(socket.links[0].from_socket, depth + 1)
    return value_text(socket)


def enabled(sockets, *names):
    found = [s for s in sockets if s.enabled and (not names or s.name in names)]
    return found


def texture_text(node, depth):
    short = node.bl_label.removesuffix(" Texture")
    if node.type == "TEX_VORONOI" and node.feature != "F1":
        short += " " + node.feature.lower().replace("_", " ")
    scale = node.inputs.get("Scale")
    vector = node.inputs.get("Vector")
    at = vector.links[0].from_node if vector is not None and vector.is_linked else None
    if scale is None:
        return short
    if scale.is_linked:
        return f"{short}, scale {input_text(scale, depth)}"
    if at is not None and at.name == METRES and scale.default_value > 0:
        return f"{short} {length(1 / scale.default_value)}"
    return f"{short}, scale {number_text(scale.default_value)}"


def image_text(node):
    image = node.image
    if image is None:
        return "picture node with no picture"
    file = bpy.path.basename(image.filepath) if image.filepath else image.name
    projection = PROJECTIONS.get(node.projection)
    return f"picture {file}" + (f", {projection}" if projection else "")


def mix_text(node, depth):
    suffix = {"FLOAT": "Float", "VECTOR": "Vector", "RGBA": "Color", "ROTATION": "Rotation"}[node.data_type]
    sockets = {s.identifier: s for s in node.inputs}
    factor = sockets["Factor_Vector" if node.data_type == "VECTOR" and node.factor_mode == "NON_UNIFORM" else "Factor_Float"]
    a, b = (input_text(sockets[f"{side}_{suffix}"], depth) for side in ("A", "B"))
    if node.data_type == "RGBA" and node.blend_type != "MIX":
        return f"{node.blend_type.title().replace('_', ' ')}({input_text(factor, depth)}, {a}, {b})"
    return f"Mix({input_text(factor, depth)}, {a}..{b})"


def operation_text(node, depth):
    name = node.operation.replace("_", " ").capitalize()
    return f"{name}({', '.join(input_text(s, depth) for s in enabled(node.inputs))})"


def remap_text(node, depth):
    def get(name):
        return input_text(next(s for s in node.inputs if s.enabled and s.name == name), depth)

    text = f"Remap({get('Value')}, {get('From Min')}..{get('From Max')}"
    low, high = get("To Min"), get("To Max")
    return text + ("" if (low, high) == ("0", "1") else f" to {low}..{high}") + ")"


def ramp_text(node, depth):
    stops = node.color_ramp.elements
    text = f"Ramp({input_text(node.inputs[0], depth)}, {hex_of(stops[0].color)}..{hex_of(stops[-1].color)}"
    return text + (f", {len(stops)} stops" if len(stops) > 2 else "") + ")"


def bump_text(node, depth):
    return (
        f"Bump({input_text(node.inputs['Height'], depth)}, strength {input_text(node.inputs['Strength'], depth)},"
        f" distance {input_text(node.inputs['Distance'], depth)})"
    )


def generic_text(node, depth):
    base = node.label or node.bl_label
    linked = [input_text(s, depth) for s in node.inputs if s.is_linked]
    return base + (f"({', '.join(linked)})" if linked else "")


TEXTS = {
    "TEX_IMAGE": lambda node, socket, depth: image_text(node),
    "MIX": lambda node, socket, depth: mix_text(node, depth),
    "MIX_RGB": lambda node, socket, depth: (
        f"Mix({input_text(node.inputs[0], depth)}, {input_text(node.inputs[1], depth)}..{input_text(node.inputs[2], depth)})"
    ),
    "MATH": lambda node, socket, depth: operation_text(node, depth),
    "VECT_MATH": lambda node, socket, depth: operation_text(node, depth),
    "MAP_RANGE": lambda node, socket, depth: remap_text(node, depth),
    "VALTORGB": lambda node, socket, depth: ramp_text(node, depth),
    "RGB": lambda node, socket, depth: hex_of(node.outputs[0].default_value),
    "VALUE": lambda node, socket, depth: number_text(node.outputs[0].default_value),
    "BUMP": lambda node, socket, depth: bump_text(node, depth),
    "NORMAL_MAP": lambda node, socket, depth: f"Normal map({input_text(node.inputs['Color'], depth)})",
    "AMBIENT_OCCLUSION": lambda node, socket, depth: (
        f"Occlusion {input_text(node.inputs['Distance'], depth) if node.inputs['Distance'].is_linked else length(node.inputs['Distance'].default_value)}"
        + (", inside" if node.inside else "")
    ),
    "BEVEL": lambda node, socket, depth: (
        f"Bevel {length(node.inputs['Radius'].default_value)}" if not node.inputs["Radius"].is_linked else generic_text(node, depth)
    ),
    "NEW_GEOMETRY": lambda node, socket, depth: f"Geometry {socket.name}",
    "TEX_COORD": lambda node, socket, depth: f"{socket.name} coordinates",
    "LAYER_WEIGHT": lambda node, socket, depth: f"Layer weight {socket.name}, blend {input_text(node.inputs['Blend'], depth)}",
    "FRESNEL": lambda node, socket, depth: f"Fresnel, ior {input_text(node.inputs['IOR'], depth)}",
    "GROUP": lambda node, socket, depth: f"group {node.node_tree.name}" if node.node_tree else "an empty group",
}
# Nodes whose words already say which of their outputs is used.
BY_OUTPUT = {"NEW_GEOMETRY", "TEX_COORD", "LAYER_WEIGHT"}


def said(socket, depth=0):
    """What a node's output gives, in words: the library's own nodes by what they are, others by their kind and inputs."""
    node = socket.node
    if node.type == "REROUTE":
        return input_text(node.inputs[0], depth)
    if is_library(node):
        return node.label
    if depth > DEEPEST:
        return node.label or node.bl_label
    if node.type.startswith("TEX_") and node.type != "TEX_IMAGE" and node.type != "TEX_COORD":
        text = texture_text(node, depth)
    else:
        text = TEXTS.get(node.type, lambda n, s, d: generic_text(n, d))(node, socket, depth)
    shown = enabled(node.outputs)
    if node.type not in BY_OUTPUT and shown and socket != shown[0] and len(shown) > 1:
        text += f".{socket.name}"
    return text if len(text) <= LONGEST else text[: LONGEST - 1] + "…"


# ---- a material's graph, for the scene's description -------------------------------------------


def principled_parts(shader):
    """A Principled BSDF's own values that matter, then what feeds each of its fed inputs, in its order."""
    inputs = shader.inputs
    parts = []

    def plain(name):
        socket = inputs.get(name)
        return None if socket is None or socket.is_linked else socket.default_value

    if plain("Base Color") is not None:
        parts.append(hex_of(plain("Base Color")))
    if (plain("Metallic") or 0) > 0:
        parts.append(f"metallic {plain('Metallic'):.3g}")
    if plain("Roughness") is not None:
        parts.append(f"roughness {plain('Roughness'):.3g}")
    if (plain("Transmission Weight") or 0) > 0:
        parts.append(f"transmission {plain('Transmission Weight'):.3g}, ior {inputs['IOR'].default_value:.3g}")
    if (plain("Alpha") if plain("Alpha") is not None else 1) < 1:
        parts.append(f"opacity {plain('Alpha'):.3g}")
    if (plain("Coat Weight") or 0) > 0:
        parts.append(f"coat {plain('Coat Weight'):.3g}")
    if (plain("Emission Strength") or 0) > 0 and plain("Emission Color") is not None:
        parts.append(f"glowing {hex_of(plain('Emission Color'))} at {plain('Emission Strength'):.3g}")
    parts += [f"{socket.name} <- {said(socket.links[0].from_socket)}" for socket in inputs if socket.is_linked]
    return parts


def notes(material):
    """What in a material's nodes does nothing or shows only in Cycles in an EEVEE scene, in a few words each."""
    found = []
    idle = idle_ends(material)
    if idle:
        shown, verb = names_text(idle)
        found.append(f"{shown} {verb} nothing")
    found += [f"{n.name} has no picture" for n in material.node_tree.nodes if n.type == "TEX_IMAGE" and n.image is None]
    if renders_with_eevee():
        found += [f"{what} shows only in Cycles, and the scene renders with EEVEE, {eevee}" for what, _, eevee in cycles_only(material)]
    return found


def graph_parts(material):
    """A material's nodes as what feeds each input of its surface, then what does nothing or shows only in Cycles."""
    output = output_of(material)
    if output is None:
        return ["no Material Output, so it draws nothing"]
    parts = []
    surface = output.inputs["Surface"]
    if surface.is_linked and surface.links[0].from_node.type == "BSDF_PRINCIPLED":
        parts += principled_parts(surface.links[0].from_node)
    elif surface.is_linked:
        parts.append(f"Surface <- {said(surface.links[0].from_socket)}")
    else:
        parts.append("nothing feeds its Surface")
    parts += [f"{name} <- {said(output.inputs[name].links[0].from_socket)}" for name in ("Volume", "Displacement") if output.inputs[name].is_linked]
    return parts + notes(material)


def graph_text(material):
    return f"{material.name} ({'; '.join(graph_parts(material))})"
