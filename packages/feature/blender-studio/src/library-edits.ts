/**
 * The library's topology edits, as the catalog lists them: extrude, inset,
 * bevel, bridge, fill, loop cut, merge, symmetrize, fix normals and imprint.
 * Each acts on what a pick took, or on a whole mesh, in the world's metres,
 * and says what it changed, measured.
 */

import type { LibraryFunction } from "./library-function.js";
import { statedNumbers } from "./stated-numbers.js";

export const editFunctions: readonly LibraryFunction[] = [
  {
    name: "extrude",
    call: 'zhiyin.extrude(picked, by, *, along="normal")',
    summary:
      "Extrude picked faces, edges or points and move the new copy out by a distance or towards a direction.",
    arguments: [
      "picked: a pick from zhiyin.pick; an edit spends it, so carry on with the pick it returns.",
      "by: metres along the faces' normals (less than 0 goes against them); for edges, along the normals of the faces beside them; or [x, y, z] in metres for faces, edges or points.",
      'along: "normal" moves each point along the normals around it, "average" moves them together along the average normal, "each" extrudes every face on its own, "onward" carries edges on past the faces beside them, as a rim extended upward.',
    ],
    example:
      'top = zhiyin.pick("Box", facing="+z")\nlid = zhiyin.extrude(top, 0.02)\nlip = zhiyin.extrude(zhiyin.boundary("Bowl"), 0.004)',
    reports:
      "how far and which way the new copy moved, faces, edges and points before and after, open or crossing faces it made, and where the new copy lies; returns a pick of it.",
    terms: [
      "extrude",
      "push",
      "pull",
      "raise",
      "boss",
      "extend",
      "faces",
      "edges",
      "region",
      "thickness",
      "rim",
      "lip",
      "flange",
      "shrink fatten",
      "along normals",
    ],
  },
  {
    name: "inset",
    call: "zhiyin.inset(picked, thickness, *, depth=0, individual=False, outset=False)",
    summary:
      "Inset picked faces: a ring of faces round each region, as wide all round, with the inner faces raised or sunk.",
    arguments: [
      "picked: a pick of faces.",
      "thickness: the ring's width in metres.",
      "depth: metres to raise the inner faces; less than 0 sinks them.",
      "individual: each face gets its own ring instead of one round the region.",
      "outset: the ring grows outwards, onto the faces around.",
    ],
    example:
      'top = zhiyin.pick("Box", facing="+z")\ninner = zhiyin.inset(top, 0.01)\nzhiyin.extrude(inner, -0.005)',
    reports:
      "the ring's width, its narrowest when it is narrower than asked, and the counts before and after; refused, saying how wide fits, when the thickness turns the ring inside out; returns a pick of the inner faces.",
    terms: ["inset", "border", "frame", "rim", "panel", "recess", "lip"],
  },
  {
    name: "bevel",
    call: "zhiyin.bevel(picked, width, *, segments=1, profile=0.5, clamp=True, affect=None)",
    summary:
      "Bevel or round picked edges or points: chamfer them by a width, in segments shaped by a profile.",
    arguments: [
      'picked: a pick of edges, or of points (kind="verts").',
      "width: metres from each edge to where the bevel starts.",
      "segments: rows across the bevel; more rounds it.",
      "profile: 0.5 round, towards 1 square, towards 0 hollow.",
      "clamp: shrink the width where faces would overlap.",
      'affect: "verts" bevels the points of picked edges; by default the pick\'s own kind.',
    ],
    example:
      'rim = zhiyin.pick("Box", "edges", above=0.99)\nzhiyin.bevel(rim, 0.005, segments=3)',
    reports:
      "how many it bevelled, the width asked and the width made when clamping narrowed it, the counts before and after, faces with no area or crossing faces it left, and the faces added; returns a pick of them.",
    terms: [
      "bevel",
      "chamfer",
      "round",
      "fillet",
      "soften",
      "edges",
      "corners",
    ],
  },
  {
    name: "bridge",
    call: "zhiyin.bridge(picked, *, cuts=0, twist=0, smoothness=0)",
    summary:
      "Join two picked edge loops with a band of faces, with rows of edges between them, bowed or twisted; given faces, remove them and join their rims, as for a handle.",
    arguments: [
      'picked: a pick of edges (kind="edges") holding two loops, both closed or both open, of the same number of edges; or a pick of faces in two patches, which go, their rims being the loops. The band keeps the surface facing out, even between two patches on one side.',
      "cuts: rows of edges across the band.",
      "twist: how many edges to turn one loop against the other.",
      "smoothness: with cuts, bows the band so it leaves each loop the way the loop's own faces run on; at its middle it bulges out about smoothness × the length between the loops ÷ 4, so 2 bows a 50 mm band out 25 mm. Each edge between the loops bows by its own length, so a long outer one bows further than a short inner one.",
    ],
    example:
      'ends = zhiyin.pick("Pipe", "edges", inside=[[-1, -1, 0.9], [1, 1, 1.1]])\nzhiyin.bridge(ends, cuts=4, smoothness=0.5)\ncaps = zhiyin.pick("Teapot", facing="-x", inside=[[-0.12, -0.01, 0.03], [-0.09, 0.01, 0.13]])\nzhiyin.bridge(caps, cuts=10, smoothness=2)',
    reports:
      "the loops joined, the faces made, the counts before and after, how long the edges between the loops run, how far a bow moved them, for closed loops the band's section where it leaves them and at its narrowest, so a pinch shows, and, for closed loops turned out of line, how many edges round and the twist that makes them shortest; refused, with the loops and their counts, when the pick is not two matching loops; returns a pick of the faces made.",
    terms: ["bridge", "connect", "join", "loft", "tube", "edge loops", "skin"],
  },
  {
    name: "fill",
    call: "zhiyin.fill(picked_or_obj, *, method=None, span=None)",
    summary:
      "Fill holes, closed loops of open edges: with a grid of quads by default, one n-gon each, or a fan of triangles.",
    arguments: [
      "picked_or_obj: a pick of edges round the holes, or a mesh object or its name for every hole it has.",
      'method: left out, a grid of quads in each hole of an even number of edges, four or more, and one face in any other; "grid" refuses any other; "holes" or "face" one face each; "fan" triangles round a point at each middle.',
      `span: for a grid, how many faces across; by default the hole's edges over ${statedNumbers.script.grid_span_part}.`,
    ],
    example: 'zhiyin.fill("Bottle")',
    reports:
      "the holes found and filled, the faces made and the grids' sizes, the counts before and after, any n-gons made, and the poles left: points inside the surface where other than four edges meet, by how many meet; refused when there is no hole; returns a pick of the faces made.",
    terms: [
      "fill",
      "cap",
      "fan",
      "poles",
      "close",
      "hole",
      "grid fill",
      "face",
      "n-gon",
      "boundary",
    ],
  },
  {
    name: "loop_cut",
    call: "zhiyin.loop_cut(picked, *, cuts=1, slide=0)",
    summary:
      "Cut loops of edges across the ring of four-sided faces each picked edge runs through.",
    arguments: [
      'picked: a pick of edges (kind="edges"), any edge the loops will cross.',
      "cuts: how many loops, evenly spaced.",
      "slide: between -1 and 1, moves the loops along the ring by that share of the gap between two cuts, towards the end the line names.",
    ],
    example:
      'side = zhiyin.pick("Box", "edges", inside=[[0.4, 0.4, 0.1], [0.6, 0.6, 0.9]])\nzhiyin.loop_cut(side, cuts=2)',
    reports:
      "the loops added, across how many edges, which way they slid, the counts before and after, and where the new loops lie; returns a pick of their edges.",
    terms: [
      "loop cut",
      "edge loop",
      "subdivide",
      "split",
      "ring",
      "support loop",
    ],
  },
  {
    name: "merge",
    call: 'zhiyin.merge(picked_or_obj, *, distance=0.0001, to="distance")',
    summary:
      "Merge points: those closer than a distance, or all picked into one at their centre or a given point.",
    arguments: [
      "picked_or_obj: a pick, whose points are merged, or a mesh object or its name for all its points.",
      "distance: metres; points closer than this become one.",
      'to: "distance", "center", or [x, y, z] in the world, where the picked points become one.',
    ],
    example: 'zhiyin.merge("Imported")',
    reports:
      "how many points went and the counts before and after, or that none were that close and how far apart the closest two are; returns how many points it removed.",
    terms: [
      "merge",
      "weld",
      "remove doubles",
      "duplicate vertices",
      "collapse",
      "join points",
    ],
  },
  {
    name: "delete",
    call: "zhiyin.delete(picked)",
    summary:
      "Delete picked faces, edges or points, as Blender's Delete does, leaving holes: faces with what only they used, edges with the faces on them, points with every edge and face that meets them.",
    arguments: ["picked: a pick of faces, edges or points."],
    example:
      'cap = zhiyin.pick("Can", facing="+z")\nrim = zhiyin.delete(cap)\nzhiyin.fill(rim, method="grid")',
    reports:
      "the counts before and after and each new hole by its edges; returns a pick of the open edges round the holes it left.",
    terms: [
      "delete",
      "remove",
      "erase",
      "cut away",
      "open",
      "hole",
      "faces",
      "vertices",
    ],
  },
  {
    name: "dissolve",
    call: "zhiyin.dissolve(picked)",
    summary:
      "Dissolve picked faces, edges or points, as Blender's Dissolve does: the faces round them join into larger ones and the surface stays closed.",
    arguments: [
      "picked: a pick of faces (each region becomes one face), edges or points (the faces on either side join).",
    ],
    example:
      'patch = zhiyin.pick("Box", facing="+x", inside=[[0.4, -0.3, 0.2], [0.6, 0.3, 0.8]])\nzhiyin.dissolve(patch)',
    reports:
      "the counts before and after and each n-gon it made by its sides; returns a pick of the faces it joined.",
    terms: [
      "dissolve",
      "remove",
      "simplify",
      "limited dissolve",
      "merge faces",
      "join faces",
      "edge loop",
      "n-gon",
    ],
  },
  {
    name: "symmetrize",
    call: 'zhiyin.symmetrize(obj, *, axis="x", direction="+")',
    summary:
      "Make a mesh the same on both sides of its own x, y or z = 0, copying one half onto the other.",
    arguments: [
      "obj: a mesh object or its name.",
      'axis: "x", "y" or "z", of the object\'s own axes.',
      'direction: "+" copies the + half onto the - side; "-" the other way.',
    ],
    example: 'zhiyin.symmetrize("Car", axis="x", direction="-")',
    reports:
      "the counts before and after and whether the seam was left with open edges; refused when nothing is on the side to copy.",
    terms: ["symmetrize", "mirror", "symmetry", "half", "both sides"],
  },
  {
    name: "fix_normals",
    call: "zhiyin.fix_normals(obj)",
    summary:
      "Recalculate normals outside: turn a mesh's faces out of each closed piece and with the rest of each open one.",
    arguments: ["obj: a mesh object or its name."],
    example: 'zhiyin.fix_normals("Imported")',
    reports:
      "how many faces it turned, those that pointed into a closed piece and those against the rest of an open one, and the largest's place, or that every face already faced its way; a hollow's inner walls face its hollow; returns a pick of the faces turned.",
    terms: [
      "normals",
      "recalculate",
      "outside",
      "flip",
      "inside out",
      "face orientation",
      "backfaces",
    ],
  },
  {
    name: "imprint",
    call: 'zhiyin.imprint(target, outline=None, *, text=None, curve=None, direction="-z", depth=0, at=None, height=0.1)',
    summary:
      "Knife project without a view: press an outline, text or closed curve onto a mesh along a direction and cut it into the surface; depth embosses or debosses it.",
    arguments: [
      "target: a mesh object or its name.",
      "outline: [x, y, z] points in the world, or [a, b] along the two world axes across an axis direction (x y for ±z, y z for ±x, x z for ±y).",
      "text: letters, height metres high, centred on at ([x, y, z], the mesh's middle by default), reading the right way seen along the direction.",
      "curve: a closed curve object or its name, as drawn.",
      'direction: the way it is pressed, such as "-z" onto a top or "+y" onto a front, or [x, y, z].',
      "depth: metres to raise the faces inside it; less than 0 sinks them.",
    ],
    example:
      'logo = zhiyin.imprint("Lid", text="ZY", height=0.02, direction="-z", depth=-0.001)',
    reports:
      "what it pressed and which way, the counts before and after, the faces inside it with their area and extent, and the faces of more than four sides the cut left; refused where the outline passes off the surface or the knife would reach the far side; with depth, the extrude's own line follows; returns a pick of the faces inside, raised or sunk.",
    terms: [
      "knife project",
      "knife",
      "project",
      "emboss",
      "deboss",
      "engrave",
      "logo",
      "intersect",
    ],
  },
];
