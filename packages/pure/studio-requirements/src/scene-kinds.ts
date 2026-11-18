/**
 * The kinds of requirement only the 3D studio measures, on a scene's meshes:
 * a part's proportions, where it is against another, what holds together,
 * how many there are, the faces drawn, what the camera sees and what goes
 * into what over the animation. Beside them
 * the 3D studio measures the shared kinds that mean the same on a mesh.
 */

import {
  amount,
  isName,
  isNames,
  isNumber,
  isRange,
  longest,
  mostNames,
  part,
  parts,
  pattern,
  rule,
} from "./fields.js";
import type { Kinds } from "./kinds.js";

/** A size in mm, a number it must be or [least, most]: `what` says what it is. */
const millimetres = (field: string, what: string) =>
  rule(
    isRange,
    `${field} is ${what} in mm, a number it must be or [least, most]`,
  );

/** A second part, by name or pattern, which `what` says the role of. */
const other = (field: string, what: string) =>
  rule(
    isName,
    `${field} names ${what}, or a pattern between slashes, at most ${longest} characters; ${pattern} stands for several`,
  );

const sides = rule(
  (v) =>
    Array.isArray(v) &&
    v.length === 2 &&
    v.every((side) => side === "top" || side === "bottom"),
  `sides is two of "top" and "bottom": the part's side, then the other's`,
);

const isWhole = (v: unknown): v is number =>
  Number.isInteger(v) && (v as number) >= 0;

/** The longest a timeline runs, in seconds. */
const longestTimeline = 600;

/** A moment on the timeline in seconds, `missing` when left out. */
const moment = (field: string, missing: string) =>
  rule(
    (v) => isNumber(v) && v >= 0 && v <= longestTimeline,
    `${field} is a time in seconds, from 0 to ${longestTimeline}; left out, ${missing}`,
  );

/** Where a part is against another, along z: below or above it by a range. */
const level = (side: "below" | "above") => ({
  needs: ["part", "other", "by"],
  may: ["sides"],
  fields: {
    part,
    other: other("other", `the part it is ${side}`),
    by: millimetres("by", `how far ${side} it is`),
    sides,
  },
});

/** The kinds the 3D studio measures and no other studio does. */
export const sceneKinds = {
  thickness: {
    needs: ["part", "range"],
    may: [],
    fields: { part, range: millimetres("range", "the thickness") },
  },
  width: {
    needs: ["part", "range"],
    may: [],
    fields: { part, range: millimetres("range", "the width") },
  },
  reach: {
    needs: ["part", "from", "range"],
    may: [],
    fields: {
      part,
      from: other("from", "the part it reaches out from"),
      range: millimetres("range", "how far it reaches out"),
    },
  },
  rests_on: {
    needs: ["part"],
    may: ["on"],
    fields: {
      part,
      on: rule(
        isName,
        `on names what it rests on, or a pattern between slashes, at most ${longest} characters; left out, the ground at height 0`,
      ),
    },
  },
  below: level("below"),
  above: level("above"),
  joined: { needs: ["parts"], may: [], fields: { parts } },
  inside: {
    needs: ["part", "of"],
    may: [],
    fields: {
      part,
      of: rule(
        (v) => isName(v) || isNames(v),
        `of names what the part is inside: a part, or a list of 1 to ${mostNames} parts, each a name or a pattern between slashes such as /Wall_.*/, at most ${longest} characters; several are measured as one, as walls and a floor`,
      ),
    },
  },
  count: {
    needs: ["part", "range"],
    may: [],
    fields: {
      part,
      range: rule(
        (v) =>
          isWhole(v) ||
          (Array.isArray(v) &&
            v.length === 2 &&
            v.every(isWhole) &&
            (v[0] as number) <= (v[1] as number)),
        "range is how many there are, a whole number or [least, most]",
      ),
    },
  },
  faces: {
    needs: ["max"],
    may: ["parts"],
    fields: {
      max: rule(
        (v) => Number.isInteger(v) && (v as number) > 0,
        "max is the most faces drawn, a whole number above 0",
      ),
      parts,
    },
  },
  separate_in_motion: {
    needs: ["parts"],
    may: ["max", "start", "end", "every"],
    fields: {
      parts,
      max: amount(
        "max is the deepest in mm one part may go into another, 0 or more; left out, none may",
        true,
      ),
      start: moment("start", "0"),
      end: moment("end", "the timeline's end"),
      every: rule(
        (v) => Number.isInteger(v) && (v as number) >= 1,
        "every is how many frames apart the frames measured are, a whole number from 1, every frame when left out",
      ),
    },
    whole: (given) =>
      typeof given["start"] === "number" &&
      typeof given["end"] === "number" &&
      given["end"] < given["start"]
        ? "gives an end after its start"
        : undefined,
  },
  in_view: {
    needs: ["parts"],
    may: ["camera"],
    fields: {
      parts,
      camera: rule(
        isName,
        `camera names the camera, at most ${longest} characters; left out, the scene's camera`,
      ),
    },
  },
} as const satisfies Kinds;
