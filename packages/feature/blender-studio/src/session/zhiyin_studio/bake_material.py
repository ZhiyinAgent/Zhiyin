"""
The copy of an object's material a bake gives it, drawn from the baked maps: a Principled BSDF
whose colour, roughness, metalness, relief, glow and opacity are read from the pictures, by the
object's layout. An ORM map gives roughness and metalness where they were not baked alone, and a
height map gives displacement where no normal map was baked. The maps only a texturing tool
uses, as curvature or cavity, are files only. The object's own materials stay in the file.
"""

import bpy

BAKED = " baked"
# The maps the material reads, each a colour picture or a data one.
COLOUR_MAPS = ("color", "emission")


def _picture(tree, path, name, layout):
    """A picture node reading a map from its file, by the object's layout."""
    image = bpy.data.images.load(path, check_existing=True)
    image.reload()
    if bpy.data.filepath:
        image.filepath = bpy.path.relpath(path)
    image.colorspace_settings.name = "sRGB" if name in COLOUR_MAPS else "Non-Color"
    node = tree.nodes.new("ShaderNodeTexImage")
    node.image = image
    node.label = name
    coordinates = tree.nodes.new("ShaderNodeUVMap")
    coordinates.uv_map = layout
    tree.links.new(coordinates.outputs["UV"], node.inputs["Vector"])
    return node


def baked_material(obj, files, height_range=None):
    """
    Gives the object a copy of its first material drawn from the maps in `files` (map -> path),
    on every slot. Returns the copy and the names of the materials it replaced.
    """
    own = [slot.material for slot in obj.material_slots if slot.material is not None]
    name = obj.name + BAKED
    existing = bpy.data.materials.get(name)
    source = own[0] if own else None
    if existing is not None and existing is source:
        # Baked again from its own baked copy: the copy is drawn anew.
        material = existing
    else:
        if existing is not None:
            existing.name = name + " before"
        material = source.copy() if source is not None else bpy.data.materials.new(name)
        material.name = name
    material.use_fake_user = False
    tree = material.node_tree
    tree.nodes.clear()
    output = tree.nodes.new("ShaderNodeOutputMaterial")
    shader = tree.nodes.new("ShaderNodeBsdfPrincipled")
    tree.links.new(shader.outputs[0], output.inputs["Surface"])
    layout = obj.data.uv_layers.active.name
    read = {key: _picture(tree, path, key, layout) for key, path in files.items() if key in (*COLOUR_MAPS, "roughness", "metallic", "normal", "opacity", "orm", "height")}
    if "color" in read:
        tree.links.new(read["color"].outputs["Color"], shader.inputs["Base Color"])
    if "orm" in read and ("roughness" not in read or "metallic" not in read):
        split = tree.nodes.new("ShaderNodeSeparateColor")
        tree.links.new(read["orm"].outputs["Color"], split.inputs["Color"])
        if "roughness" not in read:
            tree.links.new(split.outputs["Green"], shader.inputs["Roughness"])
        if "metallic" not in read:
            tree.links.new(split.outputs["Blue"], shader.inputs["Metallic"])
    elif "orm" in read:
        tree.nodes.remove(read.pop("orm"))
    for key, socket in (("roughness", "Roughness"), ("metallic", "Metallic"), ("opacity", "Alpha")):
        if key in read:
            tree.links.new(read[key].outputs["Color"], shader.inputs[socket])
    if "emission" in read:
        tree.links.new(read["emission"].outputs["Color"], shader.inputs["Emission Color"])
        shader.inputs["Emission Strength"].default_value = 1.0
    if "normal" in read:
        relief = tree.nodes.new("ShaderNodeNormalMap")
        relief.uv_map = layout
        tree.links.new(read["normal"].outputs["Color"], relief.inputs["Color"])
        tree.links.new(relief.outputs["Normal"], shader.inputs["Normal"])
    if "height" in read:
        if "normal" in read or height_range is None:
            tree.nodes.remove(read.pop("height"))
        else:
            low, high = height_range
            span = high - low
            displace = tree.nodes.new("ShaderNodeDisplacement")
            displace.space = "OBJECT"
            displace.inputs["Midlevel"].default_value = -low / span if span else 0.5
            displace.inputs["Scale"].default_value = span
            tree.links.new(read["height"].outputs["Color"], displace.inputs["Height"])
            tree.links.new(displace.outputs["Displacement"], output.inputs["Displacement"])
    # Picture nodes left with nothing to feed take their layout node with them.
    for node in list(tree.nodes):
        if node.type == "UVMAP" and not any(out.links for out in node.outputs):
            tree.nodes.remove(node)
    replaced = []
    for material_before in dict.fromkeys(own):
        if material_before is not material:
            material_before.use_fake_user = True
            replaced.append(material_before.name)
    if not obj.material_slots:
        obj.data.materials.append(material)
    for slot in obj.material_slots:
        slot.material = material
    return material, replaced
