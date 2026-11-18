import type { LibraryFunction } from "./library-function.js";

export const shapeMeasureFunctions: readonly LibraryFunction[] = [
  {
    name: "deviation",
    call: "zhiyin.deviation(a, b)",
    summary:
      "Measure how far one shape strays from another, as after a remesh, retopology, decimate, wrap or sculpt: both ways, over each whole surface.",
    arguments: [
      "a: the mesh object measured against, or its name, as it shows with its steps.",
      "b: the mesh object measured, or its name.",
    ],
    example:
      'zhiyin.retopo("Sculpt", faces=3000)\nfound = zhiyin.deviation("Sculpt", "Sculpt retopo")\nprint(found["most"], found["within_95"])',
    reports:
      'how far b strays from a in the world: the most, the mean and what 95% of the two surfaces lie within, and where the most is, on which shape; it returns them as "most", "mean" and "within_95" in metres and "at", a point.',
    terms: [
      "deviation",
      "distance",
      "hausdorff",
      "difference",
      "compare",
      "error",
      "accuracy",
      "remesh",
      "decimate",
      "retopology",
      "shrinkwrap",
    ],
  },
];
