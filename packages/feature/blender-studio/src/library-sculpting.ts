import type { LibraryFunction } from "./library-function.js";

const sculptReports =
  "the points it moved, the most and where, any points a mask held back, the volume before and after with the change (or that the surface is open), and any new pairs of crossing faces and where; it returns a pick of the points it moved.";

export const sculptingFunctions: readonly LibraryFunction[] = [
  {
    name: "sculpt",
    call: "zhiyin.sculpt(obj, brush, stroke, *, radius, strength=None, depth=None, by=None, falloff=None, mirror=None, mask=None, detail=None)",
    summary:
      "Sculpt a mesh's own points with a brush along a stroke: draw, clay, crease, inflate, grab, smooth, flatten or pinch, with falloff, mirror symmetry, a mask and detail added where the stroke needs it.",
    arguments: [
      "obj: a mesh object or its name.",
      'brush: "draw" raises along the surface\'s facing under the stroke; "clay" builds up to a level depth above it; "crease" cuts a groove and draws its sides in; "inflate" swells along each point\'s normal; "grab" carries points by a distance; "flatten" lays them onto the surface\'s middle plane; "pinch" draws them toward the stroke; "smooth" moves them toward their neighbours, an open edge staying put.',
      "stroke: points in the world, [[x, y, z], ...], laid onto the surface (one point is a dab), or a curve object or its name; a point further off the surface than radius is refused.",
      "radius: metres from the stroke the brush reaches.",
      "depth: metres the surface moves under the stroke's middle, outward when positive, for draw, clay, crease and inflate (needed by them).",
      "strength: 0 to 1, the share of the full effect, for crease (its pull toward the stroke), smooth, flatten and pinch; 0.5 when not given.",
      "by: [x, y, z] in metres, how far grab carries the points under the stroke (needed by grab).",
      'falloff: "smooth", "sphere", "sharp", "linear" or "constant", how the effect fades to the radius; sharp for crease, smooth for the rest.',
      'mirror: the object\'s own axes to repeat the stroke across, "x", "xy", "xyz" and so on.',
      "mask: a vertex group, as zhiyin.sculpt_mask makes, whose weights hold points back.",
      "detail: metres; edges under the stroke longer than this are split first, and those the stroke stretches past it after, as dynamic topology does.",
    ],
    example:
      'zhiyin.sculpt("Head", "draw", [[0.02, -0.09, 1.62], [0.04, -0.08, 1.64]], radius=0.01, depth=0.002, mirror="x", detail=0.002)\nzhiyin.sculpt("Head", "smooth", [[0.03, -0.085, 1.63]], radius=0.015)',
    reports: sculptReports,
    terms: [
      "sculpt",
      "brush",
      "stroke",
      "dyntopo",
      "dynamic topology",
      "clay strips",
      "crease",
      "inflate",
      "grab",
      "pinch",
      "smooth",
      "flatten",
      "symmetry",
      "organic",
      "character",
    ],
  },
  {
    name: "sculpt_filter",
    call: "zhiyin.sculpt_filter(obj, kind, *, strength=None, depth=None, size=None, rounds=None, seed=None, mask=None)",
    summary:
      "Filter a whole mesh as sculpting does: smooth, relax, sharpen, inflate or noise, held back where a mask says.",
    arguments: [
      "obj: a mesh object or its name.",
      'kind: "smooth" moves each point toward its neighbours; "relax" evens the points out along the surface and lays them back on it; "sharpen" pushes each point further from its neighbours across the surface; "inflate" swells along each point\'s normal; "noise" raises and lowers the surface by a pattern. An open edge stays put under smooth, relax and sharpen.',
      "strength: 0 to 1 a round, for smooth, relax and sharpen; 0.5 when not given. rounds: how many times, 1 when not given.",
      "depth: metres, outward when positive, for inflate and noise (needed by them); noise moves up to about that.",
      "size: metres across the noise's features (needed by noise); seed: a whole number giving another pattern.",
      "mask: a vertex group whose weights hold points back.",
      "Each kind refuses an option it does not take.",
    ],
    example:
      'zhiyin.sculpt_filter("Rock", "noise", depth=0.004, size=0.05)\nzhiyin.sculpt_filter("Rock", "smooth", rounds=2, mask="Edges")',
    reports: sculptReports,
    terms: [
      "sculpt",
      "filter",
      "mesh filter",
      "smooth",
      "relax",
      "sharpen",
      "inflate",
      "noise",
      "displace",
      "roughen",
    ],
  },
  {
    name: "sculpt_mask",
    call: 'zhiyin.sculpt_mask(picked, name="Mask", *, weight=1, blur=0, invert=False)',
    summary:
      "Make a sculpt mask, a vertex group, from a pick's points, softened over rings of neighbours or turned inside out.",
    arguments: [
      "picked: a pick of faces, edges or points, from zhiyin.pick or zhiyin.picked.",
      "name: the vertex group's name; one of that name is replaced.",
      "weight: 0 to 1, how much the mask holds its points back.",
      "blur: rings of neighbours that take a weight falling off ring by ring.",
      "invert: every other point takes the weight instead.",
    ],
    example:
      'eyes = zhiyin.pick("Head", "verts", near=[[0.03, -0.09, 1.65], 0.015])\nzhiyin.sculpt_mask(eyes, "Eyes", blur=2)\nzhiyin.sculpt_filter("Head", "smooth", mask="Eyes")',
    reports:
      "how many points it holds fully and how many partly; it returns the vertex group.",
    terms: ["mask", "sculpt", "vertex group", "protect", "hold", "freeze"],
  },
  {
    name: "sculpt_remesh",
    call: "zhiyin.sculpt_remesh(obj, voxel, *, keep_volume=True)",
    summary:
      "Remesh a sculpt in even voxels between passes, so stretched faces and split detail start over; masks are carried over.",
    arguments: [
      "obj: a mesh object or its name, with no steps (modifiers) of its own.",
      "voxel: metres across each new face; a size that would make over about 2,000,000 faces is refused, saying the least size.",
      "keep_volume: keep the volume the mesh held.",
    ],
    example: 'zhiyin.sculpt_remesh("Creature", 0.004)',
    reports:
      "the faces and points before and after, how far the new surface strays from the old (the most, the mean, what 95% lies within, and where), the volume change, and the masks carried over by the nearest earlier point.",
    terms: [
      "remesh",
      "voxel",
      "voxel remesh",
      "sculpt",
      "retopology",
      "even",
      "rebuild",
    ],
  },
  {
    name: "sculpt_detail",
    call: "zhiyin.sculpt_detail(obj, levels=2)",
    summary:
      "Give a mesh Multires levels and a copy of its finest level to sculpt fine detail on, to be put back with zhiyin.sculpt_reshape.",
    arguments: [
      "obj: a mesh object or its name, with no steps besides Multires.",
      "levels: 1 to 6 Multires levels, each four times the faces of the last.",
    ],
    example:
      'copy = zhiyin.sculpt_detail("Head", levels=3)\nzhiyin.sculpt(copy, "crease", [[0.02, -0.09, 1.7], [0.05, -0.08, 1.71]], radius=0.004, depth=-0.0005)\nzhiyin.sculpt_reshape(copy)',
    reports:
      "the levels given, the copy's name (\"<name> detail\") and points against the object's; the object is hidden meanwhile; it returns the copy.",
    terms: [
      "multires",
      "multiresolution",
      "subdivide",
      "fine detail",
      "high poly",
      "sculpt",
      "pores",
      "wrinkles",
    ],
  },
  {
    name: "sculpt_reshape",
    call: "zhiyin.sculpt_reshape(copy)",
    summary:
      "Put a detail copy's sculpted shape back into the Multires levels of the object it was made from, point for point.",
    arguments: [
      "copy: the copy zhiyin.sculpt_detail made, or its name; refused once its points changed, as by detail= or a remesh.",
    ],
    example: 'zhiyin.sculpt_reshape("Head detail")',
    reports:
      "the points of the finest level that moved and the most, and how far it then strays from the copy; the copy is removed and the object shown again.",
    terms: ["multires", "reshape", "apply", "detail", "sculpt"],
  },
  {
    name: "sculpt_bake",
    call: 'zhiyin.sculpt_bake(obj, *, size=1024, maps=("normal", "displacement"), folder="textures")',
    summary:
      "Bake an object's Multires levels onto its base mesh as a tangent-space normal map and a displacement map, with Blender's Multires baker.",
    arguments: [
      "obj: a mesh object with Multires levels and a UV layout.",
      "size: pixels across each square map, 16 to 8192.",
      'maps: "normal", "displacement" or both.',
      'folder: the workspace folder the maps are written in, as "<name> normal.png" and "<name> displacement.png".',
    ],
    example:
      'maps = zhiyin.sculpt_bake("Head", size=2048)\nprint(maps["normal"])',
    reports:
      "each map's file, the displacement's reach either side of the base surface (mid-grey on it), and how much of the texture the layout covers; it returns each map's path by its kind.",
    terms: [
      "bake",
      "normal map",
      "displacement map",
      "height",
      "multires",
      "low poly",
      "game",
      "texture",
    ],
  },
  {
    name: "sculpt_symmetrize",
    call: 'zhiyin.sculpt_symmetrize(obj, axis="x", direction="+")',
    summary:
      "Make a sculpted mesh the same on both sides of its own axis while keeping its points: each takes its mirror's place, paired by where they stood before sculpting.",
    arguments: [
      "obj: a mesh object or its name.",
      "axis: x, y or z; the plane is the object's own axis = 0.",
      'direction: "+" copies the + side onto the - side, "-" the other way.',
      "A point with no mirror among the other side's points is laid onto the mirrored surface; zhiyin.symmetrize instead cuts and mirrors the mesh itself.",
    ],
    example: 'zhiyin.sculpt_symmetrize("Head", axis="x", direction="-")',
    reports:
      "the points set to their mirror's place, those laid onto the mirrored surface and those on the seam, the most moved, and the symmetry's RMS and largest before and after.",
    terms: ["symmetrize", "symmetry", "mirror", "sculpt", "copy side"],
  },
  {
    name: "symmetry",
    call: 'zhiyin.symmetry(obj, axis="x")',
    summary:
      "Measure how far a shape is from the same on both sides of its own axis: each point mirrored and measured to the nearest place on the surface.",
    arguments: [
      "obj: a mesh object or its name, as it shows with its steps.",
      "axis: x, y or z; the plane is the object's own axis = 0.",
    ],
    example: 'found = zhiyin.symmetry("Head")\nprint(found["most"])',
    reports:
      'the RMS and the largest distance and the point it is at, and what 95% of the points lie within; it returns them as "rms", "most" and "within_95" in metres and "at", a point.',
    terms: ["symmetry", "mirror", "asymmetry", "measure", "compare sides"],
  },
];
