/**
 * The `zhiyin` library a script reaches beside `bpy`, as the catalog lists it:
 * each function's call, what it is for, an example, and what it reports. The
 * functions themselves live in the session's Python; every one listed here is
 * there, and every one there is listed.
 */

import { curveFunctions } from "./library-curves.js";
import { detailFunctions } from "./library-details.js";
import { editFunctions } from "./library-edits.js";
import type { LibraryFunction } from "./library-function.js";
import { loopFunctions } from "./library-loops.js";
import { nodeFunctions } from "./library-nodes.js";
import { shadingFunctions } from "./library-shading.js";
import { shapeMeasureFunctions } from "./library-shape-measures.js";
import { sculptingFunctions } from "./library-sculpting.js";
import { stylisedFunctions } from "./library-stylised.js";
import { surfaceQualityFunctions } from "./library-surface-quality.js";

export type { LibraryFunction } from "./library-function.js";

const pickingFunctions: readonly LibraryFunction[] = [
  {
    name: "pick",
    call: 'zhiyin.pick(obj, kind="faces", *, facing=None, within=15, above=None, below=None, inside=None, near=None, side_of=None, material=None, grow=0, name=None)',
    summary:
      "Pick a mesh's faces, edges or points by what they are, not by index: facing, height, box, nearness, side of a plane, material.",
    arguments: [
      "obj: a mesh object or its name.",
      'kind: "faces", "edges" or "verts".',
      'facing: "+x", "-x", "+y", "-y", "+z", "-z", "up", "down" or [x, y, z]; within: the angle allowed, in degrees.',
      "above, below: heights in metres, in the world.",
      "inside: two corners of a box, [[x, y, z], [x, y, z]]; near: [[x, y, z], metres].",
      "side_of: [point on a plane, the side it faces]; material: a material's name.",
      "grow: rings of neighbours added after; name: keeps the pick on the mesh for zhiyin.picked.",
    ],
    example:
      'top = zhiyin.pick("Jar", facing="+z", above=0.12, name="rim")\nprint(len(top))',
    reports:
      "how many it took, their area for faces, and where they lie in x, y and z; a pick that takes nothing is refused with what each condition alone takes.",
    terms: [
      "select",
      "selection",
      "faces",
      "edges",
      "vertices",
      "normal",
      "direction",
      "region",
      "box",
      "bmesh",
      "edit mode",
    ],
  },
  {
    name: "picked",
    call: "zhiyin.picked(obj, name)",
    summary:
      "Take up again a pick kept by name in an earlier script, selected as it was.",
    arguments: [
      "obj: a mesh object or its name.",
      "name: the name the pick was kept by.",
    ],
    example: 'rim = zhiyin.picked("Jar", "rim")',
    reports:
      "how many it holds; refused, naming the picks the mesh keeps, when none has that name.",
    terms: ["selection", "saved", "named", "reuse"],
  },
];

/** Every function scripts reach, as the catalog lists them. */
export const libraryFunctions: readonly LibraryFunction[] = [
  ...pickingFunctions,
  ...loopFunctions,
  ...editFunctions,
  ...curveFunctions,
  ...nodeFunctions,
  ...detailFunctions,
  ...shadingFunctions,
  ...shapeMeasureFunctions,
  ...stylisedFunctions,
  ...sculptingFunctions,
  ...surfaceQualityFunctions,
];

/** The catalog id of a library function. */
export const libraryFunctionId = (plugin: string, name: string) =>
  `function:${plugin}/zhiyin.${name}`;

/** A function's page as `open` reads it. */
export const libraryFunctionText = (fn: LibraryFunction) =>
  [
    fn.call,
    fn.summary,
    "Arguments:",
    ...fn.arguments.map((line) => `- ${line}`),
    "Example:",
    fn.example,
    `Reports: ${fn.reports} The script's answer lists each call's line after what the script printed.`,
  ].join("\n");
