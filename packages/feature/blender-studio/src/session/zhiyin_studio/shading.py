"""
Building materials in scripts: a material with a Principled BSDF given to
objects, masks by the shape and patterns sized in metres, mixed and remapped,
then fed into the shader's inputs or raised as relief. Each call says in one
line what it made, in the words the scene's description uses for it, such as
“Steel's Base Color <- Mix(Noise 3 mm, #8a5a3c..#b07a50)”.
"""

import bpy

from .arguments import colour, is_number, need, number
from .finding import find_object
from .finishes import Graph, source
from .geometry import SHAPE_TYPES
from .material_values import shader_of
from .reports import report
from .shading_common import material_of, owned, worn_text
from .shading_graph import said, value_text
from .shading_masks import mask
from .shading_patterns import pattern
from .wording import length

# Inputs that take a direction, which a height gives through zhiyin.relief.
DIRECTIONS = {"Normal", "Coat Normal", "Tangent"}


def objects_of(objects):
    """Objects given as one or a list, each as itself or by its name, that can wear a material."""
    if objects is None:
        return []
    listed = objects if isinstance(objects, (list, tuple)) else [objects]
    found = []
    for obj in listed:
        if isinstance(obj, str):
            obj = find_object(obj)
        need(isinstance(obj, bpy.types.Object), "objects are objects or their names.")
        need(obj.type in SHAPE_TYPES, f"{obj.name} is a {obj.type.lower()}, which wears no material.")
        found.append(obj)
    return found


def material(name, objects=None):
    """Takes or makes a material with a Principled BSDF into its output and gives it whole to the objects; answers it."""
    need(isinstance(name, str) and name.strip(), "zhiyin.material takes the material's name.")
    found = bpy.data.materials.get(name)
    targets = objects_of(objects)
    if found is None:
        found = bpy.data.materials.new(name)
        found.use_nodes = True
        nodes = found.node_tree.nodes
        shader = shader_of(found) or nodes.new("ShaderNodeBsdfPrincipled")
        output = next((n for n in nodes if n.type == "OUTPUT_MATERIAL"), None) or nodes.new("ShaderNodeOutputMaterial")
        found.node_tree.links.new(shader.outputs["BSDF"], output.inputs["Surface"])
        state = "new: a Principled BSDF into its Material Output"
    else:
        need(
            found.use_nodes and shader_of(found) is not None,
            f"{name} draws its surface without a Principled BSDF: build on its own nodes with bpy, or name a new material.",
        )
        state = "kept with its nodes"
    for obj in targets:
        if obj.data.materials:
            for index in range(len(obj.data.materials)):
                obj.data.materials[index] = found
            for slot in obj.material_slots:
                slot.material = found
        else:
            obj.data.materials.append(found)
    report(f"Material {found.name}, {state}, {worn_text(found)}.")
    return found


def as_value(value, what):
    """A socket, a number, or a colour as #rrggbb or three or four numbers, as the graph builder takes it."""
    if isinstance(value, bpy.types.NodeSocket):
        return value
    if isinstance(value, str):
        return colour(value, what)
    if is_number(value):
        return float(value)
    if isinstance(value, (list, tuple)) and len(value) in (3, 4) and all(is_number(v) for v in value):
        return tuple(float(v) for v in value) + ((1.0,) if len(value) == 3 else ())
    need(False, f"{what} is a socket from zhiyin, a number, or a colour written like #c0392b.")


def is_colour(value):
    if isinstance(value, bpy.types.NodeSocket):
        return value.type in ("RGBA", "VECTOR")
    return isinstance(value, tuple)


def mix(material, factor, a, b):
    """a where factor is 0 and b where it is 1, colours or numbers, as a socket."""
    material = material_of(material, "zhiyin.mix")
    factor, a, b = as_value(factor, "factor"), as_value(a, "a"), as_value(b, "b")
    need(not is_colour(factor), "factor is a number or a socket giving one, such as a mask or a pattern.")
    coloured = is_colour(a) or is_colour(b)
    made = Graph(material).mix(factor, a, b, "RGBA" if coloured else "FLOAT")
    report(f"Mix for {material.name}: {said(made)}, {'a colour' if coloured else 'a number'}.")
    return made


def remap(material, value, low, high):
    """0 where value is below low, 1 above high, smoothly between, as a socket."""
    material = material_of(material, "zhiyin.remap")
    value = as_value(value, "value")
    low, high = number(low, "low"), number(high, "high")
    need(low < high, "low is below high.")
    made = Graph(material).step(value, low, high)
    report(f"Remap for {material.name}: {said(made)}, 0 below {low:g} and 1 above {high:g}.")
    return made


def principled(material, what):
    shader = shader_of(material)
    need(shader is not None, f"{material.name} has no Principled BSDF for {what} to feed: make it with zhiyin.material.")
    return shader


def feed(material, input, value):
    """Feeds a Principled input: links a socket into it, or sets its own value; answers what feeds it now."""
    material = material_of(material, "zhiyin.feed")
    shader = principled(material, "zhiyin.feed")
    socket = shader.inputs.get(input) if isinstance(input, str) else None
    if socket is None or not socket.enabled:
        names = ", ".join(s.name for s in shader.inputs if s.enabled)
        need(False, f"{material.name}'s Principled BSDF has no input {input}: it has {names}.")
    value = as_value(value, input)
    if socket.name in DIRECTIONS:
        need(isinstance(value, bpy.types.NodeSocket) and value.type == "VECTOR", f"{input} takes a direction: give a height to zhiyin.relief instead.")
    linked = isinstance(value, bpy.types.NodeSocket)
    if not linked and socket.type == "RGBA":
        need(isinstance(value, tuple), f"{input} takes a colour written like #c0392b.")
    elif not linked:
        need(isinstance(value, float), f"{input} takes a number.")
        # Blender holds a value set from Python past the input's range without a word.
        held = socket.bl_rna.properties["default_value"]
        low, high = held.hard_min, held.hard_max
        if high < 1e30 and low > -1e30:
            need(low <= value <= high, f"{material.name}'s {socket.name} takes {low:g} to {high:g}, and {value:g} is outside it.")
    was = said(socket.links[0].from_socket) if socket.is_linked else None
    instead = f", in place of {was}" if was else ""
    for link in list(socket.links):
        material.node_tree.links.remove(link)
    if linked:
        material.node_tree.links.new(value, socket)
        report(f"{material.name}'s {socket.name} <- {said(value)}{instead}.")
    else:
        socket.default_value = value
        report(f"{material.name}'s {socket.name} set to {value_text(socket)}{instead}.")
    return socket


def relief(material, height, depth):
    """Raises the surface by a height from 0 to 1, up to `depth` metres, as a bump on the shader's normal."""
    material = material_of(material, "zhiyin.relief")
    shader = principled(material, "zhiyin.relief")
    need(isinstance(height, bpy.types.NodeSocket), "height is a socket from zhiyin, such as a pattern or a mask.")
    depth = number(depth, "depth", minimum=1e-7, maximum=1)
    graph = Graph(material)
    bump = graph.node("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 1
    # The height is in metres on the object, as the patterns are drawn.
    bump.inputs["Distance"].default_value = 1
    graph.into(bump.inputs["Height"], graph.math("MULTIPLY", height, depth))
    if shader.inputs["Normal"].is_linked:
        graph.into(bump.inputs["Normal"], source(graph, shader.inputs["Normal"]))
    graph.links.new(bump.outputs["Normal"], shader.inputs["Normal"])
    shape = said(height)
    owned(bump.outputs["Normal"], f"Relief({shape}, {length(depth)})")
    coat = " Its coat stays smooth over it." if shader.inputs["Coat Weight"].default_value > 0 else ""
    report(
        f"Relief for {material.name}: {shape} raised up to {length(depth)}, as a bump: the light follows it and the outline does not;"
        f" Cycles and EEVEE.{coat}"
    )
    return bump.outputs["Normal"]


FUNCTIONS = (material, mask, pattern, mix, remap, feed, relief)
