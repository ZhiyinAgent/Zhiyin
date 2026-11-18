"""
What of a material's look a model file keeps. glTF, USD and FBX carry a surface's values and
its pictures, not the node trees that work a look out as it is drawn, such as noise, wood,
a finish, wear and grime: an input such a tree drives is written as something else.
"""

import json
import struct

from .wording import hex_of, listed

# The inputs of a Principled BSDF a model file carries, in the answer's words.
CARRIED = (
    ("Base Color", "colour"),
    ("Metallic", "metalness"),
    ("Roughness", "roughness"),
    ("Normal", "relief"),
    ("Emission Color", "glow"),
    ("Alpha", "opacity"),
)
# The formats that carry materials at all: an OBJ is written without them,
# and STL and PLY hold none.
WITH_MATERIALS = (".glb", ".fbx", ".usd", ".usda", ".usdc", ".usdz")


def feeding(socket):
    """Every node that feeds a socket, the insides of node groups included."""
    found, waiting = [], [link.from_node for link in socket.links]
    while waiting:
        node = waiting.pop()
        if node in found:
            continue
        found.append(node)
        waiting += [link.from_node for each in node.inputs for link in each.links]
        if node.type == "GROUP" and node.node_tree is not None:
            waiting += list(node.node_tree.nodes)
    return found


def worked_out(material):
    """
    The inputs of a material that nodes work out with no picture among them,
    as (input, its words); None when no Principled BSDF draws it.
    """
    if not material.use_nodes or material.node_tree is None:
        return []
    shader = next((n for n in material.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if shader is None:
        return None
    lost = []
    for name, said in CARRIED:
        socket = shader.inputs.get(name)
        if socket is not None and socket.is_linked and not any(n.type == "TEX_IMAGE" and n.image for n in feeding(socket)):
            lost.append((name, said))
    return lost


def glb_materials(path):
    """The materials a .glb file holds, by name."""
    with open(path, "rb") as file:
        data = file.read()
    length = struct.unpack_from("<I", data, 12)[0]
    held = json.loads(data[20 : 20 + length]).get("materials", [])
    return {m.get("name"): m for m in held}


def in_glb(held, name):
    """What a .glb gives an input instead, from the material it holds; glTF's defaults where it gives nothing."""
    pbr = held.get("pbrMetallicRoughness", {})
    if name == "Base Color":
        return f"plain {hex_of(pbr.get('baseColorFactor', [1, 1, 1, 1]))}"
    if name == "Metallic":
        return f"metalness {pbr.get('metallicFactor', 1):.3g}"
    if name == "Roughness":
        return f"roughness {pbr.get('roughnessFactor', 1):.3g}"
    if name == "Normal":
        return "no relief"
    if name == "Emission Color":
        glow = held.get("emissiveFactor", [0, 0, 0])
        return f"glow {hex_of(glow)}" if any(glow) else "no glow"
    return f"opacity {pbr.get('baseColorFactor', [1, 1, 1, 1])[3]:.3g}"


def plain(shader, name):
    """The input's own value, which USD and FBX write in place of what drives it."""
    value = shader.inputs[name].default_value
    if name in ("Base Color", "Emission Color"):
        return f"plain {hex_of(value)}"
    if name == "Normal":
        return "no relief"
    return f"{dict(CARRIED)[name]} {value:.3g}"


def looks_lost(materials, output, extension):
    """
    Each material whose look the file just written does not hold, what the
    file gives it instead, and that baking to a picture keeps it; nothing when
    every look survives.
    """
    if extension not in WITH_MATERIALS:
        return ""
    held = glb_materials(output) if extension == ".glb" else {}
    said = []
    for material in materials:
        lost = worked_out(material)
        if lost is None:
            said.append(
                f"{material.name} is drawn by shader nodes of its own, which a {extension} cannot hold: "
                "the file gives it a plain surface instead."
            )
            continue
        if not lost:
            continue
        shader = next(n for n in material.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        kept = [in_glb(held.get(material.name, {}), name) if extension == ".glb" else plain(shader, name) for name, _ in lost]
        one = len(lost) == 1
        said.append(
            f"{material.name}'s {listed([words for _, words in lost])} {'comes' if one else 'come'} from nodes a {extension} "
            f"cannot hold: the file gives it {listed(kept)} instead. "
            + ("Exporting to a .glb with bake: true keeps it." if one else "Exporting to a .glb with bake: true keeps them.")
        )
    return (" " + " ".join(said)) if said else ""
