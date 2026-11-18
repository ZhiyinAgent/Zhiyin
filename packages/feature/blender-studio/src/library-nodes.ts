/**
 * The library's Geometry Nodes builder, as the catalog lists it: a tree from
 * a short description, made on Blender 5.2's interface, its inputs set by the
 * names the modifier shows, and what it evaluates to measured.
 */

import type { LibraryFunction } from "./library-function.js";

export const nodeFunctions: readonly LibraryFunction[] = [
  {
    name: "nodes",
    call: "zhiyin.nodes(obj, spec, *, name=None, values=None)",
    summary:
      "Build a Geometry Nodes tree from a short description and put it on an object as a modifier, on Blender 5.2's API.",
    arguments: [
      "obj: an object or its name; a name no object has makes an empty mesh object of it.",
      'spec["inputs"], spec["outputs"]: the group\'s own, {name: kind} or {name: {kind, default, min, max}}; kinds float, int, bool, vector, color, string, object, collection, material, image, rotation, geometry. Each output but Geometry is written to an attribute of its name.',
      'spec["nodes"]: {label: type}, {label: [type, {input: value}]} or {label: {type, settings, inputs}}; a type is its bl_idname, as GeometryNodeMeshGrid, or without its family, as MeshGrid; settings are its own, as {"operation": "MULTIPLY"}; sockets by the name Blender shows, or by identifier, as Value_001.',
      'spec["links"]: ["label.Socket", "label.Socket"] pairs, from an output to an input; "input" and "output" are the group\'s ends, and something must reach output.Geometry.',
      "name: the modifier's and tree's name; a modifier of that name gets the new tree in place of its old one.",
      "values: {input name: value} set on the modifier, as zhiyin.set_inputs sets them. Blender 5.2 refuses mod[\"Socket_2\"] = v: a modifier's inputs are at mod.properties.inputs.<identifier>.value, and a group's sockets are made with group.interface.new_socket, not group.inputs.new.",
    ],
    example:
      'zhiyin.nodes("Field", {\n  "inputs": {"Count": {"kind": "int", "default": 5, "min": 1}},\n  "nodes": {"grid": ["MeshGrid", {"Size X": 2, "Size Y": 2}], "cone": "MeshCone", "place": "InstanceOnPoints"},\n  "links": [["input.Count", "grid.Vertices X"], ["input.Count", "grid.Vertices Y"],\n            ["grid.Mesh", "place.Points"], ["cone.Mesh", "place.Instance"], ["place.Instances", "output.Geometry"]],\n}, values={"Count": 8})',
    reports:
      "the tree built, its nodes and links, the modifier it is on, each input as Blender holds it with a value past its range, the attributes its outputs write, what it evaluates to (points, faces, loose points, curves, instances) and where in x, y and z, instances included, and what its nodes warn of; a node type, socket or setting it lacks, or a link Blender marks invalid, is refused with what there is.",
    terms: [
      "geometry nodes",
      "node tree",
      "node group",
      "procedural",
      "instances",
      "scatter",
      "interface",
      "new_socket",
      "modifier",
      "node warnings",
    ],
  },
];
