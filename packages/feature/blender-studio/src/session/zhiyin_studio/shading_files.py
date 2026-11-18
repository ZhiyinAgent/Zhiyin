"""
What of a material's pictures a model file keeps. glTF, USD and FBX lay each
picture by the shape's UV layout and read it straight into an input, as
Blender 5.2 writes them: a picture laid by projection or by other
coordinates is laid by the UV layout instead, and a picture mixed with other
nodes loses them. glTF and USD keep the picture alone, and glTF also keeps it
multiplied by a plain colour; FBX keeps no picture of such an input, only the
input's own value.
"""

import bpy

from .file_looks import CARRIED, feeding
from .material_values import shader_of
from .shading_graph import PROJECTIONS
from .wording import hex_of, listed

# The formats that lay pictures by the UV layout alone.
LAID_BY_LAYOUT = (".glb", ".fbx", ".usd", ".usda", ".usdc", ".usdz")
# Nodes between a picture and an input that a file still holds: the picture's own coordinates and a normal map.
HELD = {"TEX_IMAGE", "TEX_COORD", "UVMAP", "MAPPING", "NORMAL_MAP", "REROUTE", "SEPARATE_COLOR", "SEPRGB"}


def picture_name(node):
    image = node.image
    return bpy.path.basename(image.filepath) if image.filepath else image.name


def laid_by(node):
    """How a picture node is laid on the shape when not by its UV layout, or None."""
    if node.projection in PROJECTIONS:
        return PROJECTIONS[node.projection]
    vector = node.inputs.get("Vector")
    waiting = [link for link in vector.links] if vector is not None else []
    while waiting:
        link = waiting.pop()
        if link.from_node.type == "TEX_COORD":
            if link.from_socket.name != "UV":
                return f"its {link.from_socket.name} coordinates"
            continue
        waiting += [after for each in link.from_node.inputs for after in each.links]
    return None


def held_in_glb(node):
    """A mix a .glb keeps: the picture multiplied by a plain colour, as its colour factor."""
    if node.type != "MIX" or node.data_type != "RGBA" or node.blend_type != "MULTIPLY":
        return False
    linked = [s for s in node.inputs if s.enabled and s.is_linked]
    return len(linked) == 1


def pictures_lost(materials, extension):
    """Each material whose pictures the file lays otherwise or keeps without the nodes mixed in, and what it gives instead."""
    if extension not in LAID_BY_LAYOUT:
        return ""
    said = []
    for material in materials:
        shader = shader_of(material)
        if shader is None:
            continue
        for name, words in CARRIED:
            socket = shader.inputs.get(name)
            if socket is None or not socket.is_linked:
                continue
            nodes = feeding(socket)
            pictures = [n for n in nodes if n.type == "TEX_IMAGE" and n.image]
            if not pictures:
                continue
            files = listed([picture_name(p) for p in pictures])
            for picture in pictures:
                laid = laid_by(picture)
                if laid:
                    said.append(
                        f"{material.name}'s {words} comes from its picture {picture_name(picture)} laid by {laid}, which a {extension}"
                        " cannot hold: the file lays the picture by the shape's UV layout instead."
                    )
            mixed = [n for n in nodes if n.type not in HELD and not (extension == ".glb" and held_in_glb(n))]
            if not mixed:
                continue
            if extension == ".fbx":
                value = socket.default_value
                plain = f"plain {hex_of(value)}" if name in ("Base Color", "Emission Color") else ("no relief" if name == "Normal" else f"{words} {value:.3g}")
                instead = f"gives it {plain} instead"
            else:
                instead = "gives it the picture alone" if len(pictures) == 1 else "gives it the pictures alone"
            said.append(
                f"{material.name}'s {words} mixes its picture {files} with nodes a {extension} cannot hold: the file {instead}."
                " Exporting to a .glb with bake: true keeps it."
            )
    return (" " + " ".join(said)) if said else ""
