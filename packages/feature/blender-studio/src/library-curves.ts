import type { LibraryFunction } from "./library-function.js";

export const curveFunctions: readonly LibraryFunction[] = [
  {
    name: "curve",
    call: 'zhiyin.curve(name, points, *, kind="bezier", cyclic=False, handles="auto", order=3, weights=None, tilt=None, radius=None, depth=0, resolution=12, location=(0, 0, 0))',
    summary:
      "Make a curve object through points: bezier, NURBS or poly, open or closed, bare or drawn as a round tube.",
    arguments: [
      "name: the new object's name; points: [[x, y, z], …] in the object's own space, at least 2.",
      'kind: "bezier", "nurbs" or "poly"; cyclic: True closes it.',
      'handles: for bezier, "auto", "vector", "aligned" or "free".',
      "order: for NURBS, 2 to 6, at most the number of points; weights: one number or one per point.",
      "tilt: degrees, one or one per point; radius: scales the tube at each point.",
      "depth: the tube's radius in metres, 0 for a bare curve; resolution: steps between points.",
      "location: where the object is placed.",
    ],
    example:
      'rail = zhiyin.curve("Rail", [[0, 0, 0], [1, 0, 0.2], [2, 0.5, 0.2]], depth=0.01)',
    reports:
      "its kind, how many points, open or closed, its length, where it lies in x, y and z, how thick its tube is, its sharp corners, its tightest bend's radius and where, a tube wider than that bend, and where it crosses itself or its tube runs into itself.",
    terms: [
      "spline",
      "path",
      "bezier",
      "nurbs",
      "pipe",
      "tube",
      "cable",
      "wire",
      "rail",
      "bevel",
    ],
  },
  {
    name: "set_inputs",
    call: "zhiyin.set_inputs(obj, modifier=None, **values)",
    summary:
      "Set a Geometry Nodes modifier's inputs by the names its group shows, not by socket identifiers.",
    arguments: [
      "obj: an object or its name; modifier: the modifier's name when it has more than one.",
      "values: Name=value: a number, a whole number, True or False, three numbers, or an object, collection, material or image by name.",
      "{'attribute': name} as a value reads that input from an attribute.",
    ],
    example: 'zhiyin.set_inputs("Fence", Count=12, Height=1.1, Post="Post")',
    reports:
      "each value as Blender holds it afterwards and what it was, a value past the input's own range, and what the group's nodes warn of; an input the group lacks is refused with the inputs it has.",
    terms: [
      "geometry nodes",
      "modifier",
      "socket",
      "parameter",
      "input",
      "procedural",
      "node group",
    ],
  },
];
