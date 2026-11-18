/**
 * The `zhiyin` library's loops, marks and shaping, as the catalog lists them:
 * edge loops and rings, open boundaries, a region's outline and a loop's
 * inside, edge marks, and points made round, even, flat or moved with a
 * falloff.
 */

import type { LibraryFunction } from "./library-function.js";

export const loopFunctions: readonly LibraryFunction[] = [
  {
    name: "loop",
    call: "zhiyin.loop(obj, *, near=None, through=None, name=None)",
    summary:
      "Take the edge loop through the edge nearest a point, or through edges picked, walked across quads or along an open rim.",
    arguments: [
      "obj: a mesh object or its name.",
      "near: [x, y, z] in the world; the loop goes through the edge nearest it.",
      "through: a pick of edges; a loop is taken through each.",
      "name: keeps the loop on the mesh for zhiyin.picked.",
    ],
    example:
      'rim = zhiyin.loop("Vase", near=[0.05, 0, 0.25], name="rim")\nzhiyin.mark(rim, crease=1)',
    reports:
      "its edges, whether it closes, its length and where it lies; refused, saying how many edges meet at the edge's ends, when no loop goes on from it.",
    terms: [
      "edge loop",
      "loop select",
      "alt click",
      "row",
      "edges",
      "rim",
      "quads",
    ],
  },
  {
    name: "ring",
    call: "zhiyin.ring(obj, *, near=None, through=None, name=None)",
    summary:
      "Take the edge ring across the edge nearest a point, or across edges picked: each edge's opposite in the quads beside it.",
    arguments: [
      "obj: a mesh object or its name.",
      "near: [x, y, z] in the world; the ring goes across the edge nearest it.",
      "through: a pick of edges; a ring is taken across each.",
      "name: keeps the ring on the mesh for zhiyin.picked.",
    ],
    example: 'rungs = zhiyin.ring("Tube", near=[0, 0.5, 0.5])',
    reports:
      "its edges, whether it closes, the faces it crosses, the edges' lengths and where they lie; refused, saying how many sides the faces beside it have, when they are not quads.",
    terms: ["edge ring", "ring select", "parallel edges", "quads", "edges"],
  },
  {
    name: "boundary",
    call: "zhiyin.boundary(obj, *, name=None)",
    summary:
      "Find a mesh's open boundary: the edges of one face only, as the loops they make round holes and rims.",
    arguments: [
      "obj: a mesh object or its name, or a pick; given a pick, only the loops that touch it.",
      "name: keeps the edges on the mesh for zhiyin.picked.",
    ],
    example:
      'holes = zhiyin.boundary("Scan")\ntop = zhiyin.boundary(zhiyin.pick("Tube", "verts", above=0.9))',
    reports:
      "how many loops, each one's edges, whether it closes and its length, and where they lie; refused on a closed surface, counting the edges that join three faces or none.",
    terms: [
      "holes",
      "open edges",
      "non-manifold",
      "rim",
      "border",
      "watertight",
    ],
  },
  {
    name: "region_to_loop",
    call: "zhiyin.region_to_loop(picked, *, name=None)",
    summary: "Turn a pick of faces into its outline: the edges round it.",
    arguments: [
      "picked: a pick of faces.",
      "name: keeps the outline on the mesh for zhiyin.picked.",
    ],
    example:
      'top = zhiyin.pick("Box", facing="+z")\noutline = zhiyin.region_to_loop(top)',
    reports:
      "its edges, the loops they make and their length, and where they lie; refused when the faces close on themselves.",
    terms: ["outline", "border", "select boundary loop", "region", "edges"],
  },
  {
    name: "loop_to_region",
    call: "zhiyin.loop_to_region(picked, *, name=None)",
    summary:
      "Take the faces inside a loop of edges picked: the smaller side of the faces it parts.",
    arguments: [
      "picked: a pick of edges that parts the mesh's faces, such as a closed loop.",
      "name: keeps the faces on the mesh for zhiyin.picked.",
    ],
    example:
      'ring = zhiyin.loop("Sphere", near=[0.7, 0.7, 0])\ncap = zhiyin.loop_to_region(ring)',
    reports:
      "the faces inside and their area beside the other side's, and where they lie; says when both sides are equal, and is refused when the edges part nothing.",
    terms: ["fill", "inside", "region", "select loop inner region", "faces"],
  },
  {
    name: "mark",
    call: "zhiyin.mark(picked, *, crease=None, bevel_weight=None, sharp=None, seam=None)",
    summary:
      "Set crease, bevel weight, sharpness or a UV seam on the edges picked.",
    arguments: [
      "picked: a pick of edges.",
      "crease, bevel_weight: 0 to 1.",
      "sharp, seam: True to set, False to clear.",
    ],
    example:
      'rim = zhiyin.loop("Bowl", near=[0.08, 0, 0.06])\nzhiyin.mark(rim, crease=1, seam=True)',
    reports:
      "for each mark, how many edges it changed and how many of the mesh's edges now carry it; says when nothing changed.",
    terms: [
      "crease",
      "subdivision",
      "bevel weight",
      "sharp edges",
      "seam",
      "UV unwrap",
      "edge attributes",
    ],
  },
  {
    name: "circularize",
    call: "zhiyin.circularize(picked, *, radius=None)",
    summary:
      "Make a chain of edges round, as LoopTools' circle does: a closed loop evenly spaced on the circle nearest it.",
    arguments: [
      "picked: a pick of edges making one chain of three points or more.",
      "radius: in metres; the circle's own fit when not given.",
    ],
    example:
      'hole = zhiyin.region_to_loop(zhiyin.pick("Plate", inside=[[-0.01, -0.01, -1], [0.01, 0.01, 1]]))\nzhiyin.circularize(hole, radius=0.008)',
    reports:
      "the circle's radius, centre and facing, how far off round the points lay before and after, and how far they moved.",
    terms: ["LoopTools", "circle", "round", "hole", "cylinder", "roundness"],
  },
  {
    name: "space_evenly",
    call: "zhiyin.space_evenly(picked)",
    summary:
      "Space a chain's points evenly along the path they make, as LoopTools' space does; an open chain keeps its ends.",
    arguments: [
      "picked: a pick of edges making one chain of three points or more.",
    ],
    example:
      'row = zhiyin.loop("Grid", near=[0, 0.25, 0])\nzhiyin.space_evenly(row)',
    reports:
      "how far off even its segments were before and after, their lengths, and how far the points moved.",
    terms: ["LoopTools", "space", "even", "distribute", "spacing"],
  },
  {
    name: "flatten",
    call: 'zhiyin.flatten(picked, *, plane="best")',
    summary:
      "Move the points picked onto a plane: the one nearest them, or one given.",
    arguments: [
      "picked: a pick of faces, edges or points.",
      'plane: "best", or [point, normal] with normal as [x, y, z], "+z", "up" and the like.',
    ],
    example:
      'top = zhiyin.pick("Rock", facing="+z", within=30)\nzhiyin.flatten(top, plane=[[0, 0, 0.2], "up"])',
    reports:
      "the plane, how far off it the points lay before and after, and how far they moved; refused for three points onto their own plane, which are always flat.",
    terms: [
      "LoopTools",
      "flatten",
      "planar",
      "plane",
      "level",
      "scale to zero",
    ],
  },
  {
    name: "move",
    call: 'zhiyin.move(picked, by, *, falloff=0, shape="smooth", connected=False)',
    summary:
      "Move the points picked, and with a falloff their neighbours by a share, as proportional editing does.",
    arguments: [
      "picked: a pick of faces, edges or points.",
      "by: [x, y, z] in metres, in the world.",
      "falloff: metres from the pick within which points move partly.",
      'shape: "smooth", "linear", "sharp" or "constant": how the share falls with distance.',
      "connected: True measures the distance along the mesh's edges, not in a straight line.",
    ],
    example:
      'tip = zhiyin.pick("Grid", "verts", near=[[0, 0, 0], 0.01])\nzhiyin.move(tip, [0, 0, 0.2], falloff=0.8)',
    reports:
      "how many points moved fully and where they now lie, and how many moved partly, by how much at least and at most.",
    terms: [
      "proportional editing",
      "soft selection",
      "falloff",
      "translate",
      "grab",
      "sculpt",
    ],
  },
  {
    name: "scale",
    call: "zhiyin.scale(picked, by, *, about=None)",
    summary:
      "Scale the points picked along the world's axes about their middle or a point, as S does; 0 along an axis presses them flat across it.",
    arguments: [
      "picked: a pick of faces, edges or points.",
      "by: one factor, or [x, y, z], a factor for each of the world's axes; [1, 0.6, 1] narrows them across y.",
      "about: [x, y, z] in the world; by default the middle of the points picked.",
    ],
    example:
      'tip = zhiyin.pick("Spout", facing="+x", above=0.06)\nzhiyin.scale(tip, [1, 0.6, 0.7])',
    reports:
      "the factors, the point it scaled about, and where the points lay before and lie now.",
    terms: [
      "scale",
      "resize",
      "narrow",
      "widen",
      "shrink",
      "S X 0",
      "taper",
      "pivot",
    ],
  },
  {
    name: "rotate",
    call: "zhiyin.rotate(picked, degrees, *, axis, about=None)",
    summary:
      "Turn the points picked about an axis through their middle or a point, as R does: counter-clockwise looking down the axis.",
    arguments: [
      "picked: a pick of faces, edges or points.",
      "degrees: how far to turn them; less than 0 turns the other way.",
      'axis: "x", "y" or "z" of the world, or [x, y, z].',
      "about: [x, y, z] in the world; by default the middle of the points picked.",
    ],
    example:
      'head = zhiyin.pick("Post", facing="+z", above=2.4)\nzhiyin.rotate(head, 15, axis="y")',
    reports:
      "the angle, the axis and the point it turned about, and where the points lay before and lie now.",
    terms: ["rotate", "turn", "spin", "tilt", "angle", "R", "pivot", "twist"],
  },
];
