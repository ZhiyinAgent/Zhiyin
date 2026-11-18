"""
Geometry nodes from a short description: the tree built on Blender 5.2's API, its inputs set by
the names the modifier shows, and what it evaluates to measured.

The tree's inputs and outputs are made on its interface, as 5.2 takes them (a node group has no
inputs.new since 4.0), and the modifier's values are set through its properties by each input's
identifier (a subscript such as mod["Socket_2"] is refused in 5.2). A description names nodes by
labels of its own, sockets by the names Blender shows, and links as "label.Socket"; "input" and
"output" are the group's own ends.
"""

import difflib

import bpy
import mathutils

from .arguments import is_number, need
from .errors import Refused
from .finding import find_object, scene
from .mesh_curves import KIND_WORDS, beyond_range, given_value, group_inputs, shown
from .reports import report
from .wording import length

# The kinds of input and output a description names, as Blender's socket types.
SOCKETS = {
    "float": "NodeSocketFloat",
    "int": "NodeSocketInt",
    "bool": "NodeSocketBool",
    "vector": "NodeSocketVector",
    "color": "NodeSocketColor",
    "string": "NodeSocketString",
    "object": "NodeSocketObject",
    "collection": "NodeSocketCollection",
    "material": "NodeSocketMaterial",
    "image": "NodeSocketImage",
    "rotation": "NodeSocketRotation",
    "geometry": "NodeSocketGeometry",
}
# The families of node a geometry node tree takes, by the start of their names.
FAMILIES = ("GeometryNode", "FunctionNode", "ShaderNode", "Node")
ENDS = {"input": "NodeGroupInput", "output": "NodeGroupOutput"}


def node_type(name):
    """A node's type, given whole or without its family's start, as GeometryNodeMeshGrid or MeshGrid; refused with the nearest names."""
    need(isinstance(name, str) and name, "Each node names its type, such as GeometryNodeMeshGrid.")
    known = [n for n in dir(bpy.types) if n.startswith(FAMILIES)]
    for whole_name in (name, *(family + name for family in FAMILIES)):
        if whole_name in known:
            return whole_name
    near = difflib.get_close_matches(name, known, n=4, cutoff=0.6) or difflib.get_close_matches(
        "GeometryNode" + name, known, n=4, cutoff=0.6
    )
    raise Refused(f"There is no node type “{name}”." + (f" Nearest: {', '.join(near)}." if near else ""))


def interface_item(tree, name, spec, in_out):
    """One of the group's inputs or outputs, from its kind or {kind, default, min, max}, or a default value whose kind it takes."""
    if isinstance(spec, str):
        spec = {"kind": spec}
    elif not isinstance(spec, dict):
        spec = {"default": spec}
    kind = spec.get("kind")
    if kind is None:
        value = spec.get("default")
        kind = (
            "bool" if isinstance(value, bool) else "int" if isinstance(value, int) else "float" if is_number(value)
            else "vector" if isinstance(value, (list, tuple)) and len(value) == 3 else None
        )
        need(kind is not None, f"{name}: give its kind, one of {', '.join(SOCKETS)}, or a default it takes.")
    need(kind in SOCKETS, f"{name}'s kind must be one of {', '.join(SOCKETS)}.")
    unknown = sorted(set(spec) - {"kind", "default", "min", "max"})
    need(not unknown, f"{name} takes kind, default, min and max, not {', '.join(unknown)}.")
    item = tree.interface.new_socket(name, in_out=in_out, socket_type=SOCKETS[kind])
    for key, attribute in (("min", "min_value"), ("max", "max_value"), ("default", "default_value")):
        if spec.get(key) is not None:
            need(hasattr(item, attribute), f"{name}, {kind}, has no {key}.")
            setattr(item, attribute, spec[key])
    return item


def socket(node, label, name, outputs):
    """A node's socket by the name Blender shows, or by its identifier, among those it has on."""
    sockets = node.outputs if outputs else node.inputs
    found = next((s for s in sockets if s.enabled and s.name == name), None)
    found = found or next((s for s in sockets if s.identifier == name), None)
    if found is None:
        listed = ", ".join(dict.fromkeys(s.name for s in sockets if s.enabled and s.name))
        raise Refused(
            f"{label} ({node.bl_idname}) has no {'output' if outputs else 'input'} named “{name}”."
            + (f" Its {'outputs' if outputs else 'inputs'}: {listed}." if listed else "")
        )
    return found


def settled(node, label, settings):
    """Sets a node's own settings, such as data_type or operation, refused when it has no such setting or value."""
    need(isinstance(settings, dict), f"{label}'s settings are given as {{name: value}}.")
    for key, value in settings.items():
        properties = node.bl_rna.properties
        if key not in properties or properties[key].is_readonly:
            own = [p.identifier for p in properties if not p.is_readonly and p.identifier not in IGNORED]
            raise Refused(f"{label} ({node.bl_idname}) has no setting “{key}”." + (f" Its settings: {', '.join(own)}." if own else ""))
        try:
            setattr(node, key, value)
        except (TypeError, ValueError) as error:
            raise Refused(f"{label}'s {key} cannot be {shown(value)}: {error}") from error


# A node's settings every node has, which a description does not set.
IGNORED = {
    "name", "label", "location", "location_absolute", "width", "height", "parent", "use_custom_color", "color",
    "select", "show_options", "show_preview", "hide", "mute", "show_texture", "warning_propagation", "color_tag",
}


def made_nodes(tree, described):
    """The described nodes, by their labels, each with its settings and the values of its inputs."""
    need(isinstance(described, dict) and described, "nodes describes at least one node, as {label: type}.")
    nodes = {label: tree.nodes.new(ENDS[label]) for label in ENDS}
    for label, spec in described.items():
        need(label not in ENDS, f"“{label}” is the group's own end; name the node otherwise.")
        if isinstance(spec, str):
            spec = {"type": spec}
        elif isinstance(spec, (list, tuple)):
            spec = {"type": spec[0], "inputs": spec[1] if len(spec) > 1 else {}}
        need(isinstance(spec, dict), f"{label} is described by its type, or {{type, settings, inputs}}.")
        unknown = sorted(set(spec) - {"type", "settings", "inputs"})
        need(not unknown, f"{label} takes type, settings and inputs, not {', '.join(unknown)}.")
        node = tree.nodes.new(node_type(spec.get("type")))
        node.name = node.label = label
        settled(node, label, spec.get("settings") or {})
        for name, value in (spec.get("inputs") or {}).items():
            held = socket(node, label, name, outputs=False)
            need(hasattr(held, "default_value"), f"{label}'s {name} takes no value; link something to it.")
            try:
                held.default_value = value
            except (TypeError, ValueError) as error:
                raise Refused(f"{label}'s {name} cannot be {shown(value)}: {error}") from error
        nodes[label] = node
    return nodes


def linked(tree, nodes, links):
    """Links "label.Socket" to "label.Socket", refused where an end is missing or Blender cannot join the two."""
    need(isinstance(links, (list, tuple)), 'links lists ["from.Socket", "to.Socket"] pairs.')
    for pair in links:
        need(
            isinstance(pair, (list, tuple)) and len(pair) == 2 and all(isinstance(p, str) and "." in p for p in pair),
            f'Each link is ["label.Socket", "label.Socket"], not {shown(pair)}.',
        )
        ends = []
        for end, outputs in zip(pair, (True, False)):
            label, name = end.split(".", 1)
            need(label in nodes, f"No node is labelled “{label}”. The nodes: {', '.join(nodes)}.")
            ends.append(socket(nodes[label], label, name, outputs))
        made = tree.links.new(ends[0], ends[1])
        if not made.is_valid:
            raise Refused(
                f"{pair[0]} ({ends[0].type.lower()}) cannot feed {pair[1]} ({ends[1].type.lower()}): Blender marks the link invalid."
            )


def counted(evaluated):
    """What the evaluated object holds: points, faces, curves and instances."""
    geometry = evaluated.evaluated_geometry()
    found = {}
    if geometry.mesh is not None:
        found["points"] = len(geometry.mesh.vertices)
        found["faces"] = len(geometry.mesh.polygons)
    if geometry.pointcloud is not None:
        found["loose points"] = len(geometry.pointcloud.points)
    if geometry.curves is not None:
        found["curves"] = len(geometry.curves.curves)
    places = geometry.instances_pointcloud()
    found["instances"] = len(places.points) if places is not None else 0
    return found, geometry


def bounds(obj, geometry, depsgraph):
    """The world box of what the object evaluates to, its instances included, or nothing when it is empty."""
    corners = []
    matrix = obj.matrix_world
    if geometry.mesh is not None:
        corners += [matrix @ v.co for v in geometry.mesh.vertices]
    if geometry.pointcloud is not None:
        corners += [matrix @ p.co for p in geometry.pointcloud.points]
    if geometry.curves is not None:
        corners += [matrix @ p.position for p in geometry.curves.points]
    for instance in depsgraph.object_instances:
        if instance.is_instance and instance.parent is not None and instance.parent.original == obj:
            box = instance.object.bound_box
            corners += [instance.matrix_world @ mathutils.Vector(c) for c in box]
    if not corners:
        return None
    return [min(c[i] for c in corners) for i in range(3)], [max(c[i] for c in corners) for i in range(3)]


def bounds_text(box):
    low, high = box
    return ", ".join(
        f"{axis} {length(lo)}" if abs(hi - lo) < 1e-6 else f"{axis} {length(lo)} to {length(hi)}"
        for axis, lo, hi in zip("xyz", low, high)
    )


def holder(obj):
    """The object the tree goes on: one in the scene, or a new empty mesh of that name; and whether it is new."""
    if isinstance(obj, bpy.types.Object):
        return obj, False
    need(isinstance(obj, str) and obj.strip(), "nodes takes an object or its name.")
    if bpy.data.objects.get(obj) is not None:
        return find_object(obj, {"MESH", "CURVE", "POINTCLOUD", "CURVES"}), False
    made = bpy.data.objects.new(obj, bpy.data.meshes.new(obj))
    scene().collection.objects.link(made)
    return made, True


def nodes(obj, spec, *, name=None, values=None):
    """
    Builds a Geometry Nodes tree from `spec` and puts it on `obj` as a modifier named `name`,
    replacing that modifier's tree when it has one: spec's "inputs" and "outputs" are the
    group's own, by name, as a kind or {kind, default, min, max}; "nodes" are {label: type, or
    [type, {input: value}], or {type, settings, inputs}}; "links" are ["label.Socket",
    "label.Socket"] pairs, "input" and "output" being the group's ends. `values` sets the inputs
    on the modifier by their names. Each output but Geometry is written to an attribute of its
    name. Says the tree built, the inputs as set, what it evaluates to (points, faces, curves and
    instances) and where, and what its nodes warn of.
    """
    need(isinstance(spec, dict), 'nodes takes a description: {"inputs": …, "outputs": …, "nodes": …, "links": […]}.')
    unknown = sorted(set(spec) - {"inputs", "outputs", "nodes", "links"})
    need(not unknown, f"A description holds inputs, outputs, nodes and links, not {', '.join(unknown)}.")
    target, fresh = holder(obj)
    called = name or f"{target.name} nodes"
    need(isinstance(called, str) and called.strip(), "name must be a word.")
    tree = bpy.data.node_groups.new(called, "GeometryNodeTree")
    try:
        tree.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
        tree.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
        for label, item in (spec.get("inputs") or {}).items():
            interface_item(tree, label, item, "INPUT")
        outputs = [interface_item(tree, label, item, "OUTPUT") for label, item in (spec.get("outputs") or {}).items()]
        made = made_nodes(tree, spec.get("nodes"))
        linked(tree, made, spec.get("links") or [])
        need(
            made["output"].inputs[0].is_linked,
            "Nothing reaches the output's Geometry: link the geometry the tree makes to output.Geometry.",
        )
    except Exception:
        bpy.data.node_groups.remove(tree)
        if fresh:
            mesh = target.data
            bpy.data.objects.remove(target)
            bpy.data.meshes.remove(mesh)
        raise
    modifier = target.modifiers.get(called)
    replaced = modifier is not None and modifier.type == "NODES"
    if replaced:
        old = modifier.node_group
        modifier.node_group = tree
        if old is not None and old.users == 0:
            bpy.data.node_groups.remove(old)
            tree.name = called
    else:
        modifier = target.modifiers.new(called, "NODES")
        modifier.node_group = tree
    for item in outputs:
        getattr(modifier.properties.outputs, item.identifier).attribute_name = item.name
    said_values = set_values(modifier, tree, values or {})
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    found, geometry = counted(target.evaluated_get(depsgraph))
    box = bounds(target, geometry, depsgraph)
    warned = [f"{w.message}" for w in modifier.node_warnings]
    holds = ", ".join(f"{n:,} {kind if n != 1 else kind.rstrip('s')}" for kind, n in found.items() if n) or "nothing"
    report(
        f"{'Made the mesh object ' + target.name + ' and built' if fresh else 'Built'} {tree.name},"
        f" {len(made) - 2} node{'s' if len(made) != 3 else ''} and {len(tree.links)} link{'s' if len(tree.links) != 1 else ''},"
        f" {'in place of the tree of' if replaced else 'as'} the modifier {modifier.name} on {target.name}"
        + (f"; inputs {said_values}" if said_values else "")
        + (f"; writes the {'attribute' if len(outputs) == 1 else 'attributes'} {', '.join(i.name for i in outputs)}" if outputs else "")
        + f": it makes {holds}"
        + (f", at {bounds_text(box)}" if box else "")
        + "."
        + (f" Its nodes warn: {'; '.join(warned)}." if warned else " Its nodes give no warnings.")
    )
    return modifier


def set_values(modifier, tree, values):
    """Sets the modifier's inputs by their names; the values as Blender holds them."""
    need(isinstance(values, dict), "values is {input name: value}.")
    by_name = {item.name: item for item in group_inputs(tree)}
    for name, value in values.items():
        if name not in by_name:
            listed = ", ".join(f"{i.name} ({KIND_WORDS.get(i.socket_type, i.socket_type)})" for i in by_name.values())
            raise Refused(f"{tree.name} has no input named “{name}”." + (f" Its inputs: {listed}." if listed else " It has no inputs."))
        item = by_name[name]
        held = getattr(modifier.properties.inputs, item.identifier)
        try:
            held.value = given_value(item, value)
        except (TypeError, ValueError) as error:
            raise Refused(f"{name} takes {KIND_WORDS.get(item.socket_type, item.socket_type)}: {error}") from error
    said = []
    for item in by_name.values():
        held = getattr(modifier.properties.inputs, item.identifier).value
        said.append(f"{item.name} {shown(held)}{beyond_range(item, held)}")
    return ", ".join(said)


FUNCTIONS = (nodes,)
