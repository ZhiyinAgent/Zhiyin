"""
What in a material no real surface has, or a picture cannot give: a colour
darker or brighter than any real surface reflects, a metal darker than any
metal, metalness between metal and not, a refraction no clear material has,
a picture read as the wrong kind (colour as data or data as colour), a
picture whose file is missing, a partly transparent picture whose colour
straight alpha darkens, pixels a script set that nothing keeps, a
normal map made for DirectX, nodes only Cycles draws in a scene EEVEE
renders, and nodes that feed nothing. Each is said with the material and the
input.
"""

import os
import re

import bpy
import numpy

from .material_values import shader_of
from .shading_graph import cycles_only, idle_ends, names_text, renders_with_eevee
from .wording import hex_of

# The light a surface's colour reflects, its linear luminance, as a share: real surfaces from charcoal to fresh snow.
DARKEST, BRIGHTEST = 0.03, 0.9
# The least a metal reflects: iron reflects about half.
DARKEST_METAL = 0.25
# Metalness this far from 0 and 1 is neither.
BETWEEN = 0.1
# The most a clear material bends light: diamond's is 2.42.
MOST_IOR = 3.0
# The inputs a picture gives colour to; any other it reaches takes it as data.
COLOUR_INPUTS = {"Base Color", "Emission Color", "Coat Tint", "Specular Tint", "Sheen Tint", "Color"}
# Nodes where a picture's values end: what they reach decides how the picture is read.
ENDS = {"BSDF_PRINCIPLED", "NORMAL_MAP", "BUMP", "DISPLACEMENT", "OUTPUT_MATERIAL", "EMISSION"}
# A file named as a DirectX normal map, whose green channel runs the other way from Blender's.
DIRECTX = re.compile(r"(^|[_\-. ])(dx|directx)([_\-. ]|$)", re.IGNORECASE)


def reflects(color):
    """The share of light a linear colour reflects."""
    return 0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2]


def read_as(node):
    """How the values a picture node gives are read: as colour, as data, both, or not at all."""
    kinds, waiting, seen = set(), [link for out in node.outputs for link in out.links], set()
    while waiting:
        link = waiting.pop()
        target = link.to_node
        if target.type in ENDS or target.type.startswith("BSDF"):
            if target.type == "NORMAL_MAP" or target.type in ("BUMP", "DISPLACEMENT"):
                kinds.add("data")
            elif target.type == "OUTPUT_MATERIAL":
                kinds.add("data" if link.to_socket.name == "Displacement" else "colour")
            else:
                kinds.add("colour" if link.to_socket.name in COLOUR_INPUTS else "data")
            continue
        if target.name in seen:
            continue
        seen.add(target.name)
        waiting += [after for out in target.outputs for after in out.links]
    return kinds


# Whether a picture's pixels are partly transparent, by what the picture is: its name, file, size and source.
_CLEAR = {}


def darkened_by_alpha(image):
    """Whether an 8-bit picture read with straight alpha has partly transparent pixels, whose colour Blender darkens."""
    if image.is_float or image.alpha_mode != "STRAIGHT" or image.channels != 4:
        return False
    key = (image.name, image.filepath, tuple(image.size), image.source)
    if key not in _CLEAR:
        width, height = image.size
        pixels = numpy.empty(width * height * 4, dtype=numpy.float32)
        image.pixels.foreach_get(pixels)
        _CLEAR[key] = bool(pixels[3::4].min() < 0.99) if len(pixels) else False
    return _CLEAR[key]


def picture_faults(material, unkept=()):
    said = []
    for node in material.node_tree.nodes:
        if node.type != "TEX_IMAGE":
            continue
        image = node.image
        if image is None:
            if any(out.is_linked for out in node.outputs):
                said.append(f"its picture node {node.name} has no picture")
            continue
        file = os.path.basename(bpy.path.abspath(image.filepath, library=image.library)) if image.filepath else image.name
        if (image.is_dirty and image.packed_file is None) or image.name in unkept:
            kept = "blank" if image.source == "GENERATED" else "as its file has it"
            said.append(
                f"its picture {file} holds pixels a script set that nothing keeps: it is neither packed nor saved,"
                f" so the scene file keeps it {kept}; pack it with image.pack() or save it with image.save()"
            )
        if image.source == "FILE" and image.packed_file is None:
            path = bpy.path.abspath(image.filepath, library=image.library)
            if not os.path.exists(path):
                said.append(f"its picture {file} is missing from {path}")
        if node.outputs["Color"].is_linked and darkened_by_alpha(image):
            said.append(
                f"its picture {file} is partly transparent and read with straight alpha, so Cycles and EEVEE darken its"
                " colour by its alpha where it is clear, a dark fringe round what it shows: set"
                " image.alpha_mode = 'CHANNEL_PACKED' to read its colour whole"
            )
        kinds = read_as(node)
        space = image.colorspace_settings
        if kinds == {"colour"} and space.is_data:
            said.append(f"its colour picture {file} is read as data ({space.name}), so its colours show washed out: set it to sRGB")
        if kinds == {"data"} and space.name.lower().startswith("srgb"):
            said.append(f"its picture {file} gives data but is read as colour ({space.name}), so its values are bent: set it to Non-Color")
        if "data" in kinds and DIRECTX.search(os.path.splitext(file)[0]) and any(
            link.to_node.type == "NORMAL_MAP" and link.to_node.convention != "DIRECTX" for out in node.outputs for link in out.links
        ):
            said.append(
                f"its normal map {file} is named as one made for DirectX, whose green runs the other way from Blender's,"
                " but is read as OpenGL, so its relief shows inverted: set its Normal Map node's convention to DirectX"
            )
    return said


def value_faults(material):
    shader = shader_of(material)
    if shader is None:
        return []
    inputs, said = shader.inputs, []

    def plain(name):
        socket = inputs.get(name)
        return None if socket is None or socket.is_linked else socket.default_value

    metallic, color, ior = plain("Metallic"), plain("Base Color"), plain("IOR")
    transmission, roughness = plain("Transmission Weight") or 0.0, plain("Roughness")
    if metallic is not None and BETWEEN < metallic < 1 - BETWEEN:
        said.append(f"metallic {metallic:.3g} is neither metal nor not: a real surface is 0 or 1, and a coat or wear gives what lies between")
    if color is not None and metallic is not None:
        light = reflects(color)
        if metallic >= 0.5 and light < DARKEST_METAL:
            said.append(f"its metal colour {hex_of(color)} reflects {light:.1%} of light, darker than any metal: iron reflects about 55%")
        elif metallic < 0.5 and transmission < 0.5 and light < DARKEST:
            said.append(f"its colour {hex_of(color)} reflects {light:.1%} of light, less than any real surface: charcoal reflects about 4%")
        elif metallic < 0.5 and transmission < 0.5 and light > BRIGHTEST:
            said.append(f"its colour {hex_of(color)} reflects {light:.1%} of light, more than any real surface: fresh snow reflects about 90%")
    if ior is not None and ior < 1:
        said.append(f"its ior {ior:.3g} is below air's 1, which no material is: water is 1.33, glass 1.5")
    if ior is not None and ior > MOST_IOR:
        said.append(f"its ior {ior:.3g} bends light more than any clear material: diamond's is 2.42")
    if ior is not None and transmission >= 0.5 and 1 <= ior < 1.05:
        said.append(f"its ior {ior:.3g} bends no light, so it shows as no glass at all: glass is 1.5, water 1.33")
    if roughness is not None and roughness < 0.005 and (metallic or 0) < 0.5 and transmission < 0.5:
        said.append("its roughness 0 makes a perfect mirror of an opaque surface: polished paint and plastic are 0.05 or more")
    return said


def unused_nodes(material):
    """The nodes of a material that reach no output, each chain named by its last node."""
    idle = idle_ends(material)
    if not idle:
        return []
    shown, verb = names_text(idle)
    return [f"its {shown} {verb} nothing it shows"]


def engine_faults(material):
    """What reaches the output that only Cycles draws, when the scene renders with EEVEE."""
    if not renders_with_eevee():
        return []
    said = []
    for what, feeding, eevee in cycles_only(material):
        into = f", feeding {' and '.join(feeding)}," if feeding else ""
        said.append(f"its {what}{into} shows only in Cycles: this scene renders with EEVEE, {eevee}")
    return said


def material_faults(material, unkept=()):
    """
    What is wrong with a material, each in words, or an empty list. `unkept` names the pictures a
    script set pixels of in a Blender of its own and kept nowhere, which the file here holds without them.
    """
    if material is None or not material.use_nodes or material.node_tree is None:
        return []
    return value_faults(material) + picture_faults(material, unkept) + engine_faults(material) + unused_nodes(material)


def material_key(material):
    """What a material holds, to tell whether a call changed it."""
    if not material.use_nodes or material.node_tree is None:
        return (material.name,)
    held = []
    for node in material.node_tree.nodes:
        values = []
        for socket in node.inputs:
            value = getattr(socket, "default_value", None)
            try:
                values.append(tuple(value) if hasattr(value, "__len__") and not isinstance(value, str) else value)
            except TypeError:
                values.append(None)
        image = getattr(node, "image", None)
        held.append((node.name, node.bl_idname, tuple(values), image.name if image else None, image.colorspace_settings.name if image else None))
    links = [(link.from_node.name, link.from_socket.identifier, link.to_node.name, link.to_socket.identifier) for link in material.node_tree.links]
    return (tuple(sorted(held, key=lambda h: h[0])), tuple(sorted(links)))
