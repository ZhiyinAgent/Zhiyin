"""
A decal's materials, its own and never the surface's. A picture or text decal takes a copy of the
material under it with the decal mixed into the channels it affects, by the picture's shape, so
everything else it shows is the surface's own; where the picture is transparent the copy is too,
and the surface shows through. A normal decal's copy is bent by its height map over the relief the
surface already has, and darkened in its recesses. A strip's material is a plain one of its own,
and a wrap label's is paper or clear film with the picture printed on it.
"""

import bpy

from .arguments import colour
from .errors import Refused
from .wording import hex_of, length, listed

# Each channel a decal affects, and the Principled BSDF input it changes.
CHANNELS = {"color": "Base Color", "roughness": "Roughness", "metal": "Metallic", "coat": "Coat Weight"}
# The UV layer a decal's picture is laid by.
LAYOUT = "Decal"
# What a decal's material keeps the decal it was made for under, and what a decal is.
MADE_FOR = "zhiyin_decal_material"
# A paper label's own white, where nothing is printed.
PAPER = colour("#f2f0eb", "paper")


def surface_shader(material):
    """The material's output and the Principled BSDF its surface comes from, through whatever lies between."""
    nodes = material.node_tree.nodes
    outputs = [n for n in nodes if n.type == "OUTPUT_MATERIAL"]
    output = next((n for n in outputs if n.is_active_output), outputs[0] if outputs else None)
    if output is None or not output.inputs["Surface"].is_linked:
        return output, None
    seen, waiting = set(), [output.inputs["Surface"].links[0].from_node]
    while waiting:
        node = waiting.pop(0)
        if node.as_pointer() in seen:
            continue
        seen.add(node.as_pointer())
        if node.type == "BSDF_PRINCIPLED":
            return output, node
        waiting += [link.from_node for socket in node.inputs for link in socket.links]
    return output, None


def socket(node, identifier):
    return next(s for s in node.inputs if s.identifier == identifier)


def mixed_into(tree, target, value, mask, colour):
    """Mixes a value into an input by the decal's shape, keeping what fed the input outside it."""
    mix = tree.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA" if colour else "FLOAT"
    kind = "Color" if colour else "Float"
    was, decal = socket(mix, f"A_{kind}"), socket(mix, f"B_{kind}")
    if target.is_linked:
        tree.links.new(target.links[0].from_socket, was)
    else:
        was.default_value = target.default_value
    if isinstance(value, bpy.types.NodeSocket):
        tree.links.new(value, decal)
    else:
        decal.default_value = value
    tree.links.new(mask, socket(mix, "Factor_Float"))
    tree.links.new(next(s for s in mix.outputs if s.identifier == f"Result_{kind}"), target)


def decal_material(base, name, shown, decal):
    """
    A copy of `base`, or of a plain grey material when there is none, with the decal's values
    mixed into the channels it affects. Its picture is transparent where the surface shows, unless
    the decal changes the surface's relief, which reaches past its shape's edge.
    """
    material = base.copy() if base is not None and base.node_tree is not None else bpy.data.materials.new(name)
    material.name = name
    material[MADE_FOR] = decal.name
    output, shader = surface_shader(material)
    if shader is None:
        bpy.data.materials.remove(material)
        raise Refused(
            f"{base.name}'s surface is not made by a Principled BSDF that a decal can mix into: give "
            f"{decal.target}'s faces under it a material that has one, or make the decal a strip, whose material is its own."
        )
    tree = material.node_tree
    layout = tree.nodes.new("ShaderNodeUVMap")
    layout.uv_map = LAYOUT
    texture = tree.nodes.new("ShaderNodeTexImage")
    texture.image = shown.image
    texture.extension = "CLIP"
    tree.links.new(layout.outputs["UV"], texture.inputs["Vector"])
    mask = texture.outputs["Alpha"]
    for channel in decal.affects:
        if channel == "normal":
            bump = tree.nodes.new("ShaderNodeBump")
            bump.inputs["Distance"].default_value = abs(decal.relief)
            bump.invert = decal.relief < 0
            tree.links.new(mask, bump.inputs["Height"])
            normal = shader.inputs["Normal"]
            if normal.is_linked:
                tree.links.new(normal.links[0].from_socket, bump.inputs["Normal"])
            tree.links.new(bump.outputs["Normal"], normal)
            continue
        if channel == "color":
            value = decal.colour if decal.colour is not None else texture.outputs["Color"]
        else:
            value = decal.values[channel]
        mixed_into(tree, shader.inputs[CHANNELS[channel]], value, mask, channel == "color")
    if "normal" not in decal.affects:
        surface = output.inputs["Surface"].links[0].from_socket
        clear = tree.nodes.new("ShaderNodeBsdfTransparent")
        shown_by = tree.nodes.new("ShaderNodeMixShader")
        tree.links.new(mask, shown_by.inputs[0])
        tree.links.new(clear.outputs[0], shown_by.inputs[1])
        tree.links.new(surface, shown_by.inputs[2])
        tree.links.new(shown_by.outputs[0], output.inputs["Surface"])
    return material


def relief_material(base, name, relief, decal, repeat=False):
    """
    A copy of `base`, or of a plain grey material, whose surface is bent by the relief's height map
    on top of whatever relief it had, a finish's or a normal map's, and darkened in its recesses.
    Nothing of it is transparent: everywhere else it is the surface's own material.
    """
    material = base.copy() if base is not None and base.node_tree is not None else bpy.data.materials.new(name)
    material.name = name
    material[MADE_FOR] = decal.name
    _, shader = surface_shader(material)
    if shader is None:
        bpy.data.materials.remove(material)
        raise Refused(
            f"{base.name}'s surface is not made by a Principled BSDF that a normal decal can bend: give "
            f"{decal.target}'s faces under it a material that has one."
        )
    tree = material.node_tree
    layout = tree.nodes.new("ShaderNodeUVMap")
    layout.uv_map = LAYOUT
    texture = tree.nodes.new("ShaderNodeTexImage")
    texture.image = relief.image
    # Smooth slopes between pixels; past its edge the surface's own level carries on.
    texture.interpolation = "Cubic"
    texture.extension = "REPEAT" if repeat else "EXTEND"
    tree.links.new(layout.outputs["UV"], texture.inputs["Vector"])
    parts = tree.nodes.new("ShaderNodeSeparateColor")
    tree.links.new(texture.outputs["Color"], parts.inputs["Color"])
    bump = tree.nodes.new("ShaderNodeBump")
    bump.inputs["Distance"].default_value = abs(relief.height)
    tree.links.new(parts.outputs["Red"], bump.inputs["Height"])
    normal = shader.inputs["Normal"]
    under = normal.links[0].from_node if normal.is_linked else None
    if under is not None:
        tree.links.new(normal.links[0].from_socket, bump.inputs["Normal"])
    tree.links.new(bump.outputs["Normal"], normal)
    darker = tree.nodes.new("ShaderNodeMix")
    darker.data_type = "RGBA"
    darker.blend_type = "MULTIPLY"
    socket(darker, "Factor_Float").default_value = 1.0
    base_colour = shader.inputs["Base Color"]
    if base_colour.is_linked:
        tree.links.new(base_colour.links[0].from_socket, socket(darker, "A_Color"))
    else:
        socket(darker, "A_Color").default_value = base_colour.default_value
    tree.links.new(parts.outputs["Green"], socket(darker, "B_Color"))
    tree.links.new(next(s for s in darker.outputs if s.identifier == "Result_Color"), base_colour)
    return material, under


def label_material(name, shown, label, white_ink, roughness, ink):
    """
    A wrap label's own material: paper, the picture printed on it and the paper showing where the
    picture is clear; or a clear film, glossy, through which the surface shows where nothing is
    printed. On film, ink printed over white hides the surface; ink without white under it lets it
    show through, tinted by the ink.
    """
    material = bpy.data.materials.new(name)
    tree = material.node_tree
    shader = next(n for n in tree.nodes if n.type == "BSDF_PRINCIPLED")
    output = next(n for n in tree.nodes if n.type == "OUTPUT_MATERIAL")
    layout = tree.nodes.new("ShaderNodeUVMap")
    layout.uv_map = LAYOUT
    texture = tree.nodes.new("ShaderNodeTexImage")
    texture.image = shown.image
    texture.extension = "CLIP"
    tree.links.new(layout.outputs["UV"], texture.inputs["Vector"])
    colour = texture.outputs["Color"]
    if ink is not None:
        plain = tree.nodes.new("ShaderNodeRGB")
        plain.outputs[0].default_value = ink
        colour = plain.outputs[0]
    printed = texture.outputs["Alpha"]
    shader.inputs["Roughness"].default_value = roughness
    if label == "paper":
        on_paper = tree.nodes.new("ShaderNodeMix")
        on_paper.data_type = "RGBA"
        socket(on_paper, "A_Color").default_value = PAPER
        tree.links.new(colour, socket(on_paper, "B_Color"))
        tree.links.new(printed, socket(on_paper, "Factor_Float"))
        tree.links.new(next(s for s in on_paper.outputs if s.identifier == "Result_Color"), shader.inputs["Base Color"])
        return material
    gloss = tree.nodes.new("ShaderNodeBsdfPrincipled")
    gloss.inputs["Base Color"].default_value = (0, 0, 0, 1)
    gloss.inputs["Roughness"].default_value = roughness
    through = tree.nodes.new("ShaderNodeBsdfTransparent")
    film = tree.nodes.new("ShaderNodeAddShader")
    tree.links.new(through.outputs[0], film.inputs[0])
    tree.links.new(gloss.outputs[0], film.inputs[1])
    if white_ink:
        tree.links.new(colour, shader.inputs["Base Color"])
        printed_shader = shader.outputs[0]
    else:
        tinted = tree.nodes.new("ShaderNodeBsdfTransparent")
        tree.links.new(colour, tinted.inputs["Color"])
        inked = tree.nodes.new("ShaderNodeAddShader")
        tree.links.new(tinted.outputs[0], inked.inputs[0])
        tree.links.new(gloss.outputs[0], inked.inputs[1])
        printed_shader = inked.outputs[0]
    shown_by = tree.nodes.new("ShaderNodeMixShader")
    tree.links.new(printed, shown_by.inputs[0])
    tree.links.new(film.outputs[0], shown_by.inputs[1])
    tree.links.new(printed_shader, shown_by.inputs[2])
    tree.links.new(shown_by.outputs[0], output.inputs["Surface"])
    return material


def label_words(material, label, white_ink, roughness):
    if label == "paper":
        return (
            f"Its own material “{material.name}”: a paper label, printed on white paper {hex_of(PAPER)} that shows "
            f"where the picture is clear, roughness {roughness:g}."
        )
    ink = (
        "its ink printed over white, so it hides the surface"
        if white_ink
        else "its ink printed without white under it, so the surface shows through it, tinted"
    )
    return (
        f"Its own material “{material.name}”: a clear label, a film of roughness {roughness:g} through which the "
        f"surface shows where nothing is printed, {ink}."
    )


def changes_text(decal):
    """What a decal changes of the surface: the colour, roughness (0.1) and relief (0.5 mm raised)."""
    said = []
    for channel in decal.affects:
        if channel == "color":
            said.append("the colour" if not said else "colour")
        elif channel == "normal":
            raised = f"{length(decal.relief)} raised" if decal.relief > 0 else f"pressed {length(-decal.relief)} in"
            said.append(("the " if not said else "") + f"relief ({raised})")
        else:
            words = {"metal": "metal", "roughness": "roughness", "coat": "coat"}[channel]
            said.append(("the " if not said else "") + f"{words} ({decal.values[channel]:g})")
    return listed(said)


def strip_material(name, values, colour, shown):
    """A strip's own material: its colour, or its picture repeated along it, roughness, metal and coat."""
    material = bpy.data.materials.new(name)
    tree = material.node_tree
    shader = next(n for n in tree.nodes if n.type == "BSDF_PRINCIPLED")
    output = next(n for n in tree.nodes if n.type == "OUTPUT_MATERIAL")
    shader.inputs["Roughness"].default_value = values["roughness"]
    shader.inputs["Metallic"].default_value = values["metal"]
    shader.inputs["Coat Weight"].default_value = values["coat"]
    if colour is not None:
        shader.inputs["Base Color"].default_value = colour
    said = [f"colour {hex_of(colour)}"] if colour is not None else []
    if shown is not None:
        layout = tree.nodes.new("ShaderNodeUVMap")
        layout.uv_map = LAYOUT
        texture = tree.nodes.new("ShaderNodeTexImage")
        texture.image = shown.image
        tree.links.new(layout.outputs["UV"], texture.inputs["Vector"])
        if colour is None:
            tree.links.new(texture.outputs["Color"], shader.inputs["Base Color"])
            said = [f"colours of {shown.said.split(' (')[0]}"]
        clear = tree.nodes.new("ShaderNodeBsdfTransparent")
        shown_by = tree.nodes.new("ShaderNodeMixShader")
        tree.links.new(texture.outputs["Alpha"], shown_by.inputs[0])
        tree.links.new(clear.outputs[0], shown_by.inputs[1])
        tree.links.new(shader.outputs[0], shown_by.inputs[2])
        tree.links.new(shown_by.outputs[0], output.inputs["Surface"])
    said += [f"roughness {values['roughness']:g}", f"metal {values['metal']:g}", f"coat {values['coat']:g}"]
    return material, f"Its own material “{material.name}”: {', '.join(said)}."
