import type { LibraryFunction } from "./library-function.js";

export const surfaceQualityFunctions: readonly LibraryFunction[] = [
  {
    name: "reflection_lines",
    call: 'zhiyin.reflection_lines(obj, direction="z")',
    summary:
      "Find where a surface's curvature jumps, as reflection lines (zebra stripes) show it: how far neighbouring faces turn from each other across the edges it shades smooth across, measured on the surface as its steps leave it.",
    arguments: [
      "obj: a mesh object or its name.",
      'direction: "x", "y" or "z", the axis of the world the reflected light\'s bands lie across; blender_look with shading reflections and the same stripes draws them.',
    ],
    example:
      'found = zhiyin.reflection_lines("Body")\nprint(round(found["most"], 1), found["at"][0])',
    reports:
      "the edges it shades smooth across, the most two neighbouring faces turn there in degrees and up to three places most, apart from each other, and what 95% of them turn within; it returns them as most, at, within_95 and edges, or None when it shades smooth across no edge. A turn far above the 95% marks a kink or jump in the curvature a smooth surface should not have.",
    terms: [
      "zebra",
      "zebra stripes",
      "reflection lines",
      "isophotes",
      "curvature",
      "continuity",
      "class A",
      "highlight",
      "surface quality",
      "G2",
    ],
  },
];
