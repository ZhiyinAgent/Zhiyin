"""
What a scatter makes and takes away: each item as copies of it stand, by its own box, the matrix
that sets a copy on a point, linked copies in a collection of their own or instances geometry
nodes place, and the earlier scatter of the same items onto the same surface, removed.
"""

import json
import math

import bpy
import mathutils

from .arguments import need
from .copies import copy_tree
from .errors import Refused
from .finding import is_helper, scene
from .measure_shapes import Mesh
from .placing import keyed_paths
from .wording import listed

# Kept on what a scatter made, naming the scatter, so a later one of the same items replaces it.
TAG = "zhiyin_scatter"
# Kept on the object that places a scatter's instances.
PLACER = "zhiyin_scatter_placer"
# Kept on each linked copy's root, so its attached parts are not counted as copies.
ROOT = "zhiyin_scatter_copy"
# The attributes each instance takes from its point.
TURN, SCALE, ITEM = "zhiyin_turn", "zhiyin_scale", "zhiyin_item"


def items_words(names):
    names = list(names)
    if len(names) > 3:
        return f"{', '.join(names[:2])} and {len(names) - 2} more"
    return listed(names)


def key_of(onto, items):
    return json.dumps({"onto": onto.name, "items": sorted(o.name for o in items)})


class Item:
    """
    An object copies are made of, as it stands: its shape in its own space, the middle of its
    box's base in the world, which a copy stands on its point by, and its footprint.
    """

    def __init__(self, obj, instances):
        need(obj.type == "MESH" or not instances, f"“{obj.name}” is not a mesh, which instances need.")
        need(not keyed_paths(obj), f"“{obj.name}” moves by keys, which would carry its copies back; clear its motion first.")
        world = obj.matrix_world
        need(world.to_3x3().determinant() > 1e-18, f"“{obj.name}” is mirrored or flattened by its scale; apply its scale first.")
        if instances:
            attached = [part.name for part in obj.children_recursive if not is_helper(part)]
            if attached:
                raise Refused(
                    f"“{obj.name}” has parts attached ({', '.join(attached[:6])}), which its instances would leave out: "
                    "scatter it as objects, or join its parts first."
                )
        self.obj = obj
        self.world = world.copy()
        self.mesh = Mesh.of_object(obj, world.inverted())
        need(not self.mesh.empty, f"“{obj.name}” has no faces to scatter.")
        points = [world @ mathutils.Vector(p) for p in self.mesh.verts]
        low = mathutils.Vector([min(p[i] for p in points) for i in range(3)])
        high = mathutils.Vector([max(p[i] for p in points) for i in range(3)])
        self.base = mathutils.Vector(((low.x + high.x) / 2, (low.y + high.y) / 2, low.z))
        self.half_diagonal = math.hypot(high.x - low.x, high.y - low.y) / 2
        self.reach = max((p - self.base).length for p in points)

    def matrix(self, point, turn, factor):
        """The world matrix of a copy standing on `point`, turned by `turn` and scaled by `factor`."""
        return (
            mathutils.Matrix.Translation(point)
            @ turn.to_matrix().to_4x4()
            @ mathutils.Matrix.Scale(factor, 4)
            @ mathutils.Matrix.Translation(-self.base)
            @ self.world
        )


def remove_earlier(key, words, onto):
    """Removes an earlier scatter of the same items onto the same object; what it says of it, or nothing."""
    made = [o for o in bpy.data.objects if o.get(TAG) == key]
    groups = [c for c in bpy.data.collections if c.get(TAG) == key]
    trees = [t for t in bpy.data.node_groups if t.get(TAG) == key]
    if not (made or groups or trees):
        return None
    placers = [o for o in made if o.get(PLACER)]
    instances = sum(len(o.data.vertices) for o in placers)
    copies = sum(1 for o in made if o.get(ROOT))
    meshes = [o.data for o in placers]
    for obj in made:
        bpy.data.objects.remove(obj)
    for mesh in meshes:
        if mesh.users == 0:
            bpy.data.meshes.remove(mesh)
    for tree in trees:
        bpy.data.node_groups.remove(tree)
    for group in groups:
        bpy.data.collections.remove(group)
    gone = []
    if copies:
        gone.append(f"{copies:,} cop{'ies' if copies != 1 else 'y'}")
    if instances:
        gone.append(f"{instances:,} instance{'s' if instances != 1 else ''}")
    said = " and ".join(gone) or "nothing"
    verb = "are" if (copies + instances) != 1 or len(gone) > 1 else "is"
    return f"Replaced the earlier scatter of {words} on {onto.name}: its {said} {verb} gone."


def made_as_objects(key, name, placements):
    """Linked copies of each item at its matrix, in a collection of their own; the collection, and each copy with its item."""
    group = bpy.data.collections.new(name)
    group[TAG] = key
    scene().collection.children.link(group)
    made = []
    for item, matrix in placements:
        root, _ = copy_tree(item.obj, linked=True)
        made.append((root, item))
        root.parent = None
        root.matrix_world = matrix
        root[ROOT] = True
        for copy in [root, *root.children_recursive]:
            copy[TAG] = key
            if is_helper(copy):
                continue
            for holder in list(copy.users_collection):
                holder.objects.unlink(copy)
            group.objects.link(copy)
    return group, made


def _attribute(tree, name, kind):
    node = tree.nodes.new("GeometryNodeInputNamedAttribute")
    node.data_type = kind
    node.inputs["Name"].default_value = name
    return node.outputs["Attribute"]


def made_as_instances(key, name, items, placements):
    """
    One object whose points place the instances, each point carrying its turn, scale and
    item, which geometry nodes read; the object.
    """
    mesh = bpy.data.meshes.new(name)
    mesh.vertices.add(len(placements))
    turns, scales, picks, places = [], [], [], []
    for item, matrix in placements:
        place, turn, scale = matrix.decompose()
        places += list(place)
        turns += list(turn)
        scales += list(scale)
        picks.append(items.index(item))
    mesh.vertices.foreach_set("co", places)
    mesh.attributes.new(TURN, "QUATERNION", "POINT").data.foreach_set("value", turns)
    mesh.attributes.new(SCALE, "FLOAT_VECTOR", "POINT").data.foreach_set("vector", scales)
    mesh.attributes.new(ITEM, "INT", "POINT").data.foreach_set("value", picks)
    mesh.update()
    tree = bpy.data.node_groups.new(name, "GeometryNodeTree")
    tree[TAG] = key
    tree.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    tree.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    given = tree.nodes.new("NodeGroupInput")
    joined = tree.nodes.new("GeometryNodeJoinGeometry")
    turn, scale, pick = _attribute(tree, TURN, "QUATERNION"), _attribute(tree, SCALE, "FLOAT_VECTOR"), _attribute(tree, ITEM, "INT")
    for index, item in enumerate(items):
        shape = tree.nodes.new("GeometryNodeObjectInfo")
        # Its own shape in its own space: the point's turn and scale place it whole.
        shape.transform_space = "ORIGINAL"
        shape.inputs["Object"].default_value = item.obj
        shape.inputs["As Instance"].default_value = True
        this = tree.nodes.new("FunctionNodeCompare")
        this.data_type = "INT"
        this.operation = "EQUAL"
        this.inputs["B"].default_value = index
        tree.links.new(pick, this.inputs["A"])
        placing = tree.nodes.new("GeometryNodeInstanceOnPoints")
        tree.links.new(given.outputs[0], placing.inputs["Points"])
        tree.links.new(this.outputs[0], placing.inputs["Selection"])
        tree.links.new(shape.outputs["Geometry"], placing.inputs["Instance"])
        tree.links.new(turn, placing.inputs["Rotation"])
        tree.links.new(scale, placing.inputs["Scale"])
        tree.links.new(placing.outputs[0], joined.inputs[0])
    tree.links.new(joined.outputs[0], tree.nodes.new("NodeGroupOutput").inputs[0])
    placer = bpy.data.objects.new(name, mesh)
    placer[TAG] = key
    placer[PLACER] = True
    scene().collection.objects.link(placer)
    placer.modifiers.new(name, "NODES").node_group = tree
    return placer
