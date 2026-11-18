"""
A material drawn from its values: a Principled surface with its colour, metal, roughness,
coat, glass and glow, the light inside it, its pictures and texture set, its height and tint,
and a finish with its wear and grime drawn last over the rest. What it holds is said in a few
words, and what was measured on the objects it goes on in sentences after them.
"""

import os

import bpy

from . import material_height, material_inputs, material_maps, material_subsurface, material_tint, surfaces
from .arguments import colour, need, number
from .material_inputs import AMOUNT
from .material_pictures import picture, placement
from .material_values import KELVIN
from .wood import wood
from .wording import hex_of

# Blender's own defaults: 0.5 reflects as the ior says, a coat is glassy.
SPECULAR = 0.5
COAT_ROUGHNESS = 0.03


def build(material, values, targets, engine):
    """Draws the material from its values, its old nodes gone; its values in words and what was measured, in sentences."""
    material.use_nodes = True
    nodes = material.node_tree.nodes
    for node in list(nodes):
        if node.type not in ("BSDF_PRINCIPLED", "OUTPUT_MATERIAL"):
            nodes.remove(node)
    shader = nodes.get("Principled BSDF") or nodes.new("ShaderNodeBsdfPrincipled")
    output = nodes.get("Material Output") or nodes.new("ShaderNodeOutputMaterial")
    links = material.node_tree.links
    links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    material_height.reset(material)
    inputs = shader.inputs
    said, told = [], []
    look, own = surfaces.finish_of(values)
    check_set(values, look)
    # A finish's own colour, else a starting point's for the light inside, else white under a tint.
    start = material_subsurface.own_colour(values)
    plain = own.colour if look else start or ("#ffffff" if values.get("tint") is not None else own.colour)
    base = colour(values.get("color"), "color", default=plain)
    inputs["Base Color"].default_value = base
    owned = f" ({look}'s own colour)" if look else (" (its starting point's own colour)" if start else "")
    said.append(hex_of(base) + (owned if values.get("color") is None else ""))
    inputs["Metallic"].default_value = number(values.get("metallic"), "metallic", minimum=AMOUNT[0], maximum=AMOUNT[1], default=own.metallic)
    inputs["Roughness"].default_value = number(values.get("roughness"), "roughness", minimum=AMOUNT[0], maximum=AMOUNT[1], default=own.roughness)
    if inputs["Metallic"].default_value > 0:
        said.append(f"metallic {inputs['Metallic'].default_value:g}")
    said.append(f"roughness {inputs['Roughness'].default_value:g}")
    grain = number(values.get("wood"), "wood", minimum=AMOUNT[0], maximum=AMOUNT[1], default=0)
    surfaces.check_drawn(values, look, grain)
    said += surfaces.finish_said(values, look, own)
    if grain:
        wood(material, shader, base, grain)
        said.append(f"wood grain {grain:g}")
    inputs["Specular IOR Level"].default_value = number(
        values.get("specular"), "specular", minimum=AMOUNT[0], maximum=AMOUNT[1], default=SPECULAR
    )
    if abs(inputs["Specular IOR Level"].default_value - SPECULAR) > 1e-6:
        said.append(f"specular {inputs['Specular IOR Level'].default_value:g}")
    transmission = number(values.get("transmission"), "transmission", minimum=AMOUNT[0], maximum=AMOUNT[1], default=0)
    inputs["Transmission Weight"].default_value = transmission
    surfaces.check_transmission(values, look, transmission)
    tint = material_tint.tint_of(values, transmission)
    thick = material_tint.check_closed(targets, tint)
    inputs["IOR"].default_value = number(values.get("ior"), "ior", minimum=1, maximum=4, default=1.5)
    if transmission > 0:
        said.append(f"transmission {transmission:g}, ior {inputs['IOR'].default_value:g}")
        if hasattr(material, "use_raytrace_refraction"):
            material.use_raytrace_refraction = True
    alpha = number(values.get("alpha"), "alpha", minimum=AMOUNT[0], maximum=AMOUNT[1], default=1)
    inputs["Alpha"].default_value = alpha
    if alpha < 1:
        said.append(f"opacity {alpha:g}")
    pictured = glow(material, inputs, values, said, told)
    inputs["Coat Weight"].default_value = number(values.get("coat"), "coat", minimum=AMOUNT[0], maximum=AMOUNT[1], default=own.coat)
    inputs["Coat Roughness"].default_value = number(
        values.get("coat_roughness"), "coat_roughness", minimum=AMOUNT[0], maximum=AMOUNT[1], default=COAT_ROUGHNESS
    )
    if inputs["Coat Weight"].default_value > 0:
        said.append(f"coat {inputs['Coat Weight'].default_value:g}")
        if abs(inputs["Coat Roughness"].default_value - COAT_ROUGHNESS) > 1e-6:
            said.append(f"coat roughness {inputs['Coat Roughness'].default_value:g}")
    said += material_inputs.set_inputs(shader, values)
    inside, reach = material_subsurface.set_subsurface(shader, values)
    said += inside
    texture = values.get("texture")
    if texture is not None:
        need(isinstance(texture, dict) and texture.get("path"), "texture gives the path of a picture.")
        laid = placement(material, texture, targets, "texture")
        node = picture(material, texture["path"], laid)
        links.new(node.outputs["Color"], inputs["Base Color"])
        if pictured:
            links.new(node.outputs["Color"], inputs["Emission Color"])
        if texture.get("use_alpha"):
            links.new(node.outputs["Alpha"], inputs["Alpha"])
        said.append(f"picture {os.path.basename(texture['path'])} ({laid.projection})")
    from_maps, maps_laid = None, None
    if values.get("maps") is not None:
        from_maps, maps_laid, driven, maps_said = material_maps.draw_maps(material, shader, values["maps"], targets)
        said.append("maps")
        told.append(maps_said + overridden(values, driven))
    normal = values.get("normal_map")
    if normal is not None:
        told.append(normal_map(material, shader, normal, targets))
        said.append("surface detail")
    height = material_height.height_of(values, from_maps)
    if height is not None:
        told.append(material_height.draw_height(material, height, targets, from_maps, maps_laid))
        said.append(f"height {height['depth'] * 1000:g} mm by {height.get('method', 'bump')}")
    elif from_maps:
        told.append(f"Its maps' height {os.path.basename(from_maps)} is not drawn: give height a depth to draw it.")
    if tint is not None:
        said.append(f"tint {hex_of(tint[0])} at {tint[1] * 1000:g} mm")
        told.append(material_tint.draw_tint(material, tint, thick, base[:3]))
    if reach is not None:
        told.append(material_subsurface.reach_text(reach, targets, engine))
    # Drawn last, over the wood or the picture.
    said += surfaces.draw(material, shader, values, look, own, base, targets)
    return said, told


def check_set(values, look):
    """Refuses a texture set given with another surface of its own, or with a normal map of its own too."""
    maps = values.get("maps")
    if maps is None:
        return
    need(isinstance(maps, dict), "maps gives a folder or the pictures of a texture set.")
    for other, words in (("texture", "a texture"), ("wood", "wood"), ("finish", "a finish")):
        if other == "finish":
            given = look
        elif other == "wood":
            given = values.get("wood")
        else:
            given = values.get("texture") is not None
        need(not given, f"maps draw the surface from a texture set: give the maps or {words}, not both.")
    need(
        not (maps.get("normal") and values.get("normal_map") is not None),
        "maps gives a normal map already: give its normal or normal_map, not both.",
    )


def overridden(values, driven):
    """The values given that a map drives instead, said so the model knows they are not used."""
    keys = {"Base Color": "color", "Roughness": "roughness", "Metallic": "metallic", "Alpha": "alpha"}
    unused = [keys[socket] for socket in driven if keys.get(socket) and values.get(keys[socket]) is not None]
    if not unused:
        return ""
    return f" Its maps drive its {' and '.join(unused)}, so the {' and '.join(unused)} given {'is' if len(unused) == 1 else 'are'} not used."


def glow(material, inputs, values, said, told):
    """
    Sets the glow, none among its values glowing not at all: its colour, times
    a colour temperature's when it has one, and whether Cycles samples it as
    a light. Returns whether the picture is what glows, as on a screen.
    """
    emission = values.get("emission")
    inputs["Emission Strength"].default_value = 0
    if emission is None:
        return False
    need(isinstance(emission, dict), "emission gives a color and a strength.")
    # With a picture and no colour of its own, the picture is what glows, as on a screen.
    pictured = emission.get("color") is None and values.get("texture") is not None
    inputs["Emission Color"].default_value = colour(emission.get("color"), "emission color", default="#ffffff")
    inputs["Emission Strength"].default_value = number(emission.get("strength"), "emission strength", minimum=0, default=1)
    shown = "with its picture" if pictured else hex_of(inputs["Emission Color"].default_value)
    if emission.get("kelvin") is not None:
        kelvin = number(emission["kelvin"], "emission kelvin", minimum=800, maximum=20000)
        need(not pictured, "kelvin colours a glow of its own colour; a picture's glow keeps the picture's colours: give the glow a color, or leave kelvin out.")
        shown = f"{kelvin:g} K light of {temperature_glow(material, inputs, kelvin)}"
    lights_scene = emission.get("lights_scene", True)
    need(isinstance(lights_scene, bool), "emission lights_scene is true or false.")
    material.cycles.emission_sampling = "AUTO" if lights_scene else "NONE"
    said.append(f"glowing {shown} at {inputs['Emission Strength'].default_value:g}" + ("" if lights_scene else ", not sampled as a light"))
    if not lights_scene:
        told.append(
            "Cycles does not sample its glow as a light: what is round it still takes its light, by bounced rays alone and so more"
            " grainily, as suits a screen or a sign seen more than shining; EEVEE draws it the same either way."
        )
    return pictured


def temperature_glow(material, inputs, kelvin):
    """
    Colours the glow by a colour temperature, Blender's blackbody, times its
    own colour; the colour that gives, its brightest channel full, as #rrggbb.
    """
    nodes, links = material.node_tree.nodes, material.node_tree.links
    body = nodes.new("ShaderNodeBlackbody")
    body.name = KELVIN
    body.inputs["Temperature"].default_value = kelvin
    own = tuple(inputs["Emission Color"].default_value)
    mix = nodes.new("ShaderNodeMix")
    mix.data_type, mix.blend_type = "RGBA", "MULTIPLY"
    sockets = {socket.identifier: socket for socket in mix.inputs}
    sockets["Factor_Float"].default_value = 1
    sockets["A_Color"].default_value = own
    links.new(body.outputs["Color"], sockets["B_Color"])
    links.new(next(socket for socket in mix.outputs if socket.type == "RGBA"), inputs["Emission Color"])
    # A light's colour temperature is Blender's same blackbody, which a light reads out.
    probe = bpy.data.lights.new("Zhiyin kelvin", "POINT")
    try:
        probe.use_temperature, probe.temperature = True, kelvin
        rgb = [c * t for c, t in zip(own[:3], probe.temperature_color)]
    finally:
        bpy.data.lights.remove(probe)
    top = max(rgb) or 1
    return hex_of([c / top for c in rgb])


def normal_map(material, shader, normal, targets):
    """Lays a normal map for surface detail, in its convention; the sentence saying which and why."""
    need(isinstance(normal, dict) and normal.get("path"), "normal_map gives the path of a picture.")
    convention, why = material_maps.convention_of(normal["path"], normal.get("convention"))
    laid = placement(material, normal, targets, "normal_map")
    node = picture(material, normal["path"], laid, "normal")
    bump = material.node_tree.nodes.new("ShaderNodeNormalMap")
    bump.convention = material_maps.CONVENTIONS[convention]
    bump.inputs["Strength"].default_value = number(normal.get("strength"), "normal_map strength", minimum=0, maximum=10, default=1)
    material.node_tree.links.new(node.outputs["Color"], bump.inputs["Color"])
    material.node_tree.links.new(bump.outputs["Normal"], shader.inputs["Normal"])
    return f"Its normal map is read as {material_maps.convention_word(convention)}, {why}."
