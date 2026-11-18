"""
An instance added as an object: a collection's objects placed by an empty, or one object's shape
placed by geometry nodes on a single point, each drawn where the instance is, sharing its source's
meshes. Said by how many instances it places, of what, and the box round them.
"""

import bpy

from .arguments import need
from .errors import Refused
from .finding import scene_objects
from .geometry import SHAPE_TYPES, bounds_of, copies_text, held_still
from .wording import point_text


def collection_instance(group, name):
    """An empty placing a collection's objects where it is."""
    holder = bpy.data.objects.new(name, None)
    holder.instance_type = "COLLECTION"
    holder.instance_collection = group
    return holder


def object_instance(source, name):
    """A one-point mesh whose geometry nodes place the source's shape, in its own space, on that point."""
    mesh = bpy.data.meshes.new(name)
    mesh.vertices.add(1)
    mesh.update()
    tree = bpy.data.node_groups.new(name, "GeometryNodeTree")
    tree.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    tree.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    given, out = tree.nodes.new("NodeGroupInput"), tree.nodes.new("NodeGroupOutput")
    shape = tree.nodes.new("GeometryNodeObjectInfo")
    shape.transform_space = "ORIGINAL"
    shape.inputs["Object"].default_value = source
    shape.inputs["As Instance"].default_value = True
    placing = tree.nodes.new("GeometryNodeInstanceOnPoints")
    tree.links.new(given.outputs[0], placing.inputs["Points"])
    tree.links.new(shape.outputs["Geometry"], placing.inputs["Instance"])
    tree.links.new(placing.outputs[0], out.inputs[0])
    holder = bpy.data.objects.new(name, mesh)
    holder.modifiers.new(name, "NODES").node_group = tree
    return holder


def instance(spec, name, workspace):
    """An instance of the collection or object `of` names: a collection by that name first."""
    of = spec.get("of")
    need(isinstance(of, str) and of.strip(), "An instance's of names the collection or object it places.")
    group = bpy.data.collections.get(of)
    if group is not None:
        need(any(o.type in SHAPE_TYPES for o in group.all_objects), f"The collection “{of}” holds no shape to place.")
        return collection_instance(group, name), None
    source = bpy.data.objects.get(of)
    if source is None or source not in scene_objects():
        collections = [c.name for c in bpy.data.collections][:20]
        listed = f" Collections: {', '.join(collections)}." if collections else ""
        raise Refused(f"There is no collection or object named “{of}”.{listed}")
    need(source.type in SHAPE_TYPES, f"“{of}” is {'an' if source.type.lower()[0] in 'aeiou' else 'a'} {source.type.lower()}, with no shape to place.")
    return object_instance(source, name), None


def instance_text(obj):
    """How many instances an object places, of what, and the box round them."""
    with held_still():
        placed = copies_text(obj)
        box = bounds_of(obj)
    if not placed:
        return "places nothing"
    return f"{placed}, their box from {point_text(box[0])} to {point_text(box[1])}"
