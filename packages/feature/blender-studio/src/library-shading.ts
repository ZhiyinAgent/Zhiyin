import type { LibraryFunction } from "./library-function.js";

export const shadingFunctions: readonly LibraryFunction[] = [
  {
    name: "material",
    call: "zhiyin.material(name, objects=None)",
    summary:
      "Take or make a material with a Principled BSDF into its output, and give it whole to objects, to build its nodes on.",
    arguments: [
      "name: the material's name; one that exists is kept with its nodes and must have a Principled BSDF.",
      "objects: an object, its name, or a list of them; each wears the material in every slot.",
    ],
    example: 'steel = zhiyin.material("Steel", ["Bracket", "Bolt"])',
    reports:
      "whether it is new or kept, and each object that wears it with the area it wears it on.",
    terms: [
      "material",
      "shader",
      "node tree",
      "principled bsdf",
      "assign",
      "surface",
    ],
  },
  {
    name: "mask",
    call: "zhiyin.mask(material, kind, **options)",
    summary:
      "A 0-to-1 mask by the shape, in metres: edges, recesses, occlusion, up-facing faces, thin parts, points, view angle or loose parts.",
    arguments: [
      "material: a material or its name.",
      'kind: "edges" (reach=0.002 m), "cavity" (reach=0.02), "occlusion" (reach=0.1), "up" (within=45 degrees of +z), "thickness" (below=0.005 m: 1 where thinner), "pointiness" (spread=0.05), "layer_weight" (blend=0.5), "fresnel" (ior=1.5) or "island_random".',
      "options: only those the kind takes; any other is refused.",
    ],
    example:
      'edges = zhiyin.mask(steel, "edges", reach=0.0015)\nzhiyin.feed(steel, "Base Color", zhiyin.mix(steel, edges, "#55565a", "#c6c8cb"))',
    reports:
      "what the mask gives, which engines show it (thickness, pointiness and island_random are Cycles only; occlusion-based masks show in EEVEE only where the camera sees), and, on each object wearing the material, where it lands: edge lengths and their share of the surface, the up-facing area, the thinnest part and the share thinner than asked, the average occlusion, the points or the loose parts.",
    terms: [
      "mask",
      "edge wear",
      "cavity",
      "ambient occlusion",
      "curvature",
      "pointiness",
      "thickness",
      "fresnel",
      "facing",
      "random per island",
      "dirt",
    ],
  },
  {
    name: "pattern",
    call: "zhiyin.pattern(material, kind, size, **options)",
    summary:
      "A 0-to-1 pattern drawn in metres on each object: noise, cells, stripes, weave, cracks or flakes.",
    arguments: [
      "material: a material or its name.",
      'kind: "noise" (detail=2, roughness=0.5, distortion=0), "cells" (randomness=1), "stripes" (axis="x" of the object\'s own frame, width=size/2), "weave", "cracks" (width=size/50, distortion=0.25) or "flakes".',
      "size: metres: a feature's width, the distance between stripes or threads, a crack's cell or a flake.",
      "options: only those the kind takes; any other is refused.",
    ],
    example:
      'grain = zhiyin.pattern(steel, "noise", 0.003)\nzhiyin.feed(steel, "Roughness", zhiyin.remap(steel, grain, 0.4, 0.6))',
    reports:
      "its size as Blender holds it, that Cycles and EEVEE both show it, and how many fit across each object that wears the material, or that one is wider than the object.",
    terms: [
      "procedural",
      "texture",
      "noise",
      "voronoi",
      "stripes",
      "weave",
      "fabric",
      "cracks",
      "flakes",
      "metallic paint",
      "grain",
    ],
  },
  {
    name: "mix",
    call: "zhiyin.mix(material, factor, a, b)",
    summary:
      "a where factor is 0 and b where it is 1: colours (#rrggbb) or numbers, or sockets from other calls.",
    arguments: [
      "material: a material or its name.",
      "factor: a number or a socket giving one, such as a mask or a pattern.",
      "a, b: colours written like #8a5a3c, numbers, or sockets; with a colour among them the mix is a colour.",
    ],
    example:
      'zhiyin.feed(steel, "Base Color", zhiyin.mix(steel, grain, "#8a5a3c", "#b07a50"))',
    reports:
      "the mix as the scene's description names it, and whether it gives a colour or a number.",
    terms: ["mix", "blend", "lerp", "colour", "combine"],
  },
  {
    name: "remap",
    call: "zhiyin.remap(material, value, low, high)",
    summary:
      "0 where a value is below low and 1 above high, smoothly between: to sharpen a mask or a pattern.",
    arguments: [
      "material: a material or its name.",
      "value: a socket, such as a mask or a pattern.",
      "low, high: numbers, low below high.",
    ],
    example: "spots = zhiyin.remap(steel, grain, 0.55, 0.6)",
    reports:
      "the remap as the scene's description names it, and where it is 0 and 1.",
    terms: ["map range", "threshold", "smoothstep", "contrast", "levels"],
  },
  {
    name: "feed",
    call: "zhiyin.feed(material, input, value)",
    summary:
      "Feed one input of the material's Principled BSDF: link a socket into it, or set its own colour or number.",
    arguments: [
      "material: a material or its name.",
      'input: the input as Blender names it, such as "Base Color", "Roughness", "Metallic" or "Coat Weight".',
      "value: a socket, a number, or a colour written like #8a5a3c; Normal takes a direction, given by zhiyin.relief.",
    ],
    example: 'zhiyin.feed(steel, "Metallic", 1)',
    reports:
      "what feeds the input now, as the scene's description names it, what it replaced, and a value Blender clamped.",
    terms: ["link", "connect", "input", "socket", "principled", "set value"],
  },
  {
    name: "relief",
    call: "zhiyin.relief(material, height, depth)",
    summary:
      "Raise the surface by a 0-to-1 height up to a depth in metres, as a bump on the shader's normal; the outline does not move.",
    arguments: [
      "material: a material or its name.",
      "height: a socket, such as a pattern or a mask.",
      "depth: metres at a height of 1.",
    ],
    example: "zhiyin.relief(steel, grain, 0.0003)",
    reports:
      "what is raised and how far, that it is a bump the outline does not follow, and that Cycles and EEVEE both show it.",
    terms: [
      "bump",
      "relief",
      "normal",
      "height",
      "displacement",
      "texture detail",
    ],
  },
];
