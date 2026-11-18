import type { LibraryFunction } from "./library-function.js";

export const detailFunctions: readonly LibraryFunction[] = [
  {
    name: "panel",
    call: "zhiyin.panel(faces, *, gap=0.002, depth=0.001, split=False, name=None)",
    summary:
      "Cut a panel gap round picked faces: a groove in the one mesh, or the faces split off as a panel of their own, both thickened inward.",
    arguments: [
      "faces: a pick of faces from zhiyin.pick; the gap runs inside the pick's edge, where it meets the rest of the mesh.",
      "gap: the gap's width in metres; under half the panel's narrowest width.",
      "depth: the groove's depth, or with split=True how thick panel and body are made inward.",
      "split: True makes the faces an object of their own, the gap left between it and its body.",
      'name: the split panel\'s name; by default "<body> panel".',
    ],
    example:
      'door = zhiyin.pick("Body", facing="+y", inside=[[-0.4, 0.4, 0.2], [0.4, 0.6, 1.0]])\nzhiyin.panel(door, gap=0.003, depth=0.002, split=True, name="Door")',
    reports:
      "the gap as measured along its seam, one width all along or its range and where it is widest, the depth or thickness, and the faces and open edges; a gap with no seam to follow, or too wide for the panel, is refused.",
    terms: [
      "panel line",
      "seam",
      "groove",
      "shut line",
      "door",
      "hatch",
      "hard surface",
      "split",
      "separate",
    ],
  },
  {
    name: "retopo",
    call: "zhiyin.retopo(obj, faces=2000, *, name=None, symmetric=False, keep_sharp=False, relax=2)",
    summary:
      "Remake a dense mesh as quads with QuadriFlow, relaxed and laid back on the source; the source is hidden and kept.",
    arguments: [
      "obj: a closed mesh object or its name; its modifiers are applied first.",
      "faces: about how many faces to make.",
      'name: the new object\'s name; by default "<source> retopo".',
      "symmetric: True mirrors the result across the object's own x.",
      "keep_sharp: True keeps the source's sharp edges.",
      "relax: how many times the new mesh is smoothed and laid back on the source.",
    ],
    example: 'low = zhiyin.retopo("Sculpt", faces=3000, symmetric=True)',
    reports:
      "faces made against those asked, the share that are quads, poles of 3, 5 and 6 or more edges, how far the source lies from the new surface at most and on average, and the change in volume; a source that is not one closed surface is refused with where it is open.",
    terms: [
      "retopology",
      "remesh",
      "quadriflow",
      "quads",
      "topology",
      "low poly",
      "sculpt",
      "scan",
    ],
  },
];
