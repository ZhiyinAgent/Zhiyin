"""
What the shading library's functions share: the material a call names, the
objects that wear it and the faces they wear it on, measured in the world,
the point in metres its textures are drawn at, and how a node it made is
named so the scene's description says what it gives.
"""

import bpy

from .arguments import need
from .finding import subjects
from .finishes import Graph, metres
from .geometry import SHAPE_TYPES, shapes_mesh
from .shading_graph import EEVEE_GIVES, LIBRARY, METRES
from .wording import area_text

# The most objects a line names; the rest are counted.
NAMED = 6


def material_of(material, what):
    """A material with nodes, given as itself or by its name."""
    if isinstance(material, str):
        found = bpy.data.materials.get(material)
        names = [m.name for m in bpy.data.materials][:20]
        need(found is not None, f"There is no material named “{material}”." + (f" The scene has: {', '.join(names)}." if names else ""))
        material = found
    need(isinstance(material, bpy.types.Material), f"{what} takes a material or its name.")
    need(material.use_nodes and material.node_tree is not None, f"{material.name} has no nodes: make it with zhiyin.material.")
    return material


def graph_of(material):
    """A builder of the material's nodes, and the point in metres on each object, made once per material."""
    graph = Graph(material)
    found = material.node_tree.nodes.get(METRES)
    if found is not None:
        return graph, found.outputs[0]
    at = metres(graph)
    at.node.name = METRES
    at.node.label = "Metres on the object"
    return graph, at


def owned(socket, label, eevee=None):
    """Names the node that gives `socket` as the library's, labelled with what it gives; answers the socket."""
    node = socket.node
    node.name = LIBRARY
    node.label = label[:63]
    if eevee:
        node[EEVEE_GIVES] = eevee
    return socket


def wearers(material):
    """The shapes shown in the scene that wear the material."""
    bpy.context.view_layer.update()
    return [o for o in subjects() if o.type in SHAPE_TYPES and any(s.material == material for s in o.material_slots)]


class Worn:
    """An object's evaluated shape in the world, and the faces of it that wear the material, with their area."""

    def __init__(self, obj, material):
        self.object = obj
        self.mesh = shapes_mesh([obj])
        self.mesh.normal_update()
        slots = {i for i, s in enumerate(obj.material_slots) if s.material == material}
        everything = len(obj.material_slots) <= 1
        self.faces = [f for f in self.mesh.faces if everything or f.material_index in slots]
        self.area = sum(f.calc_area() for f in self.faces)

    def free(self):
        self.mesh.free()


def on_each(material, measure):
    """Each wearer's measure, as “On Box: …; on Lid: …”, or that nothing wears the material yet."""
    found = wearers(material)
    if not found:
        return " It is on no object yet."
    said = []
    for obj in found[:NAMED]:
        worn = Worn(obj, material)
        try:
            said.append(f"{obj.name}: {measure(worn)}")
        finally:
            worn.free()
    more = f"; and {len(found) - NAMED} more objects" if len(found) > NAMED else ""
    return " On " + "; on ".join(said) + more + "."


def worn_text(material):
    """The objects that wear a material, each with the area it wears it on, or that none does."""
    found = wearers(material)
    if not found:
        return "on no object yet"
    said = []
    for obj in found[:NAMED]:
        worn = Worn(obj, material)
        try:
            said.append(f"{obj.name} ({area_text(worn.area)})")
        finally:
            worn.free()
    more = f" and {len(found) - NAMED} more" if len(found) > NAMED else ""
    return "on " + ", ".join(said) + more


def share_text(share):
    """A share as a percentage, to a tenth below 1%."""
    percent = share * 100
    if percent == 0:
        return "0%"
    return f"{percent:.1g}%" if percent < 1 else f"{percent:.0f}%"


def count_text(count):
    """A count of repeats, whole and grouped by thousands once there are ten or more."""
    return f"{round(count):,}" if count >= 10 else f"{count:.2g}"
