/**
 * The kinds of requirement, each with the fields it needs and those it may
 * have. One kind means one thing in every studio that measures it; each
 * studio says which it measures, and may define kinds of its own beside them.
 */

import {
  amount,
  angle,
  direction,
  flag,
  isName,
  isNames,
  isNumber,
  longest,
  mostNames,
  part,
  parts,
  pattern,
  point,
  ranges,
  rule,
  sizes,
  type FieldRule,
} from "./fields.js";

export type Kind = {
  /** The fields it needs, beside id, says and check. */
  readonly needs: readonly string[];
  /** The fields it may have. */
  readonly may: readonly string[];
  /** The rule for each of its fields. */
  readonly fields: Readonly<Record<string, FieldRule>>;
  /** A rule between its fields, the problem said after "a <kind> check", or nothing. */
  readonly whole?: (
    given: Readonly<Record<string, unknown>>,
  ) => string | undefined;
};

export type Kinds = Readonly<Record<string, Kind>>;

/** The materials a mass or balance may be in, by name. */
export const MATERIALS = [
  "PLA",
  "PETG",
  "ABS",
  "ASA",
  "nylon",
  "TPU",
  "resin",
  "aluminium",
  "steel",
  "stainless steel",
  "cast iron",
  "brass",
  "copper",
  "titanium",
  "wood",
] as const;

const millimetres = (field: string, what = "") =>
  amount(`${field} is ${what}a number above 0, in mm`);
const density = amount("density is in g/cm³, above 0");
const material = rule(
  (v) => (MATERIALS as readonly unknown[]).includes(v),
  `material is one of ${MATERIALS.join(", ")}; or give density in g/cm³`,
);
/** Where along the pull a mould splits. */
const parting = rule(
  isNumber,
  "parting is the height along the pull, in mm, where the mould splits; left out, at the part's lowest",
);
/** A point [x, y, z] in mm, every number given. */
const place = (words: string) =>
  rule((v) => Array.isArray(v) && v.length === 3 && v.every(isNumber), words);
const given = (one: Readonly<Record<string, unknown>>, ...fields: string[]) =>
  fields.some((field) => one[field] !== undefined);

/** Every kind a studio measures today. */
export const requirementKinds = {
  size: {
    needs: ["part"],
    may: ["max", "min", "range"],
    fields: {
      part,
      max: sizes("max"),
      min: sizes("min"),
      range: ranges("range"),
    },
    whole: (one) =>
      given(one, "max", "min", "range")
        ? undefined
        : "gives max, min or both, or range",
  },
  fits: {
    needs: ["box"],
    may: ["parts", "turned"],
    fields: {
      box: rule(
        (v) =>
          Array.isArray(v) &&
          v.length === 3 &&
          v.every(
            (one) => typeof one === "number" && Number.isFinite(one) && one > 0,
          ),
        "box is three sizes in mm, along x, y and z",
      ),
      parts,
      turned: flag(
        "turned is true when the parts may be turned a quarter at a time to fit, as on a print bed",
      ),
    },
  },
  hole: {
    needs: ["part", "diameter", "tolerance"],
    may: ["count"],
    fields: {
      part,
      diameter: amount("diameter is a number above 0, in mm"),
      tolerance: amount(
        "tolerance is how far the diameter may be off either way, in mm",
        true,
      ),
      count: rule(
        (v) => Number.isInteger(v) && (v as number) >= 1,
        "count is how many holes of the size there are at least, a whole number",
      ),
    },
  },
  clearance: {
    needs: ["between", "min"],
    may: ["bed", "height", "up"],
    fields: {
      between: rule(
        (v) => Array.isArray(v) && v.length === 2 && v.every(isName),
        `between names two parts, or two patterns, the clearance is between, each at most ${longest} characters`,
      ),
      min: millimetres("min"),
      bed: millimetres(
        "bed",
        "the least clearance near the print bed, where the first layers spread, ",
      ),
      height: millimetres(
        "height",
        "how far above the bed the bed clearance holds, 0.5 mm when left out; ",
      ),
      up: direction("up is a direction [x, y, z]"),
    },
    whole: (one) =>
      given(one, "height", "up") && one["bed"] === undefined
        ? "gives bed when it gives height or up"
        : undefined,
  },
  mesh: {
    needs: ["between"],
    may: ["min", "max", "contact_ratio"],
    fields: {
      between: rule(
        (v) => Array.isArray(v) && v.length === 2 && v.every(isName),
        `between names the two parts, or two patterns, whose gears mesh, each at most ${longest} characters`,
      ),
      min: amount("min is the least backlash in mm, 0 or more", true),
      max: millimetres("max", "the most backlash, "),
      contact_ratio: amount(
        "contact_ratio is the least contact ratio, a number above 0",
      ),
    },
    whole: (one) =>
      given(one, "min", "max", "contact_ratio")
        ? undefined
        : "gives min, max or contact_ratio",
  },
  separate: { needs: [], may: ["parts"], fields: { parts } },
  wall: {
    needs: ["part"],
    may: ["min", "max", "ratio", "nominal", "band", "outside"],
    fields: {
      part,
      min: millimetres("min"),
      max: millimetres(
        "max",
        "the thickest a section may be, as the largest ball inside it, ",
      ),
      ratio: amount(
        "ratio is the most the thickest section may be, as a multiple of the nominal wall, above 0",
      ),
      nominal: millimetres(
        "nominal",
        "the part's nominal wall, its thickness over its largest faces when left out, ",
      ),
      band: amount(
        "band is how far in mm the wall may be off its nominal either way, above 0",
      ),
      outside: rule(
        (v) => isNumber(v) && v >= 0 && v <= 100,
        "outside is the most of the part's surface, in %, whose wall may lie outside nominal ± band, from 0 to 100; 0 when left out",
      ),
    },
    whole: (one) =>
      !given(one, "min", "max", "ratio", "band")
        ? "gives min, max, ratio, band or several"
        : one["outside"] !== undefined && one["band"] === undefined
          ? "gives band with outside"
          : one["nominal"] !== undefined && !given(one, "ratio", "band")
            ? "gives ratio or band with nominal"
            : undefined,
  },
  overhang: {
    needs: ["part", "max"],
    may: ["up", "bridge"],
    fields: {
      part,
      max: angle("max"),
      up: direction("up is a direction [x, y, z]"),
      bridge: amount(
        "bridge is the widest gap in mm the printer crosses in the air, from one edge held up from below to another; 0 or more",
        true,
      ),
    },
  },
  draft: {
    needs: ["part", "min"],
    may: ["pull", "parting"],
    fields: {
      part,
      min: angle("min"),
      pull: direction("pull is a direction [x, y, z]"),
      parting,
    },
  },
  mass: {
    needs: [],
    may: ["parts", "max", "min", "density", "material"],
    fields: {
      parts,
      max: amount("max is a number above 0, in grams"),
      min: amount("min is a number above 0, in grams"),
      density,
      material,
    },
    whole: (one) =>
      !given(one, "max", "min")
        ? "gives max, min or both"
        : !given(one, "density", "material")
          ? "gives the material, or its density in g/cm³"
          : undefined,
  },
  insert: {
    needs: ["part", "along"],
    may: ["into", "travel", "min"],
    fields: {
      part,
      along: direction(
        "along is the direction [x, y, z] the part moves as it goes into its place",
      ),
      into: rule(
        isNames,
        `into names from 1 to ${mostNames} parts it goes into or past, or patterns between slashes, each at most ${longest} characters, and ${pattern} stands for many; left out, every other shown part`,
      ),
      travel: amount(
        "travel is how far the part moves to its place, in mm, above 0; left out, from where it is clear of the parts it goes into",
      ),
      min: amount(
        "min is the least clearance in mm it keeps on the way, 0 or more",
        true,
      ),
    },
  },
  corner: {
    needs: ["part", "min"],
    may: ["along"],
    fields: {
      part,
      min: millimetres("min", "the least radius an inner corner may have, "),
      along: direction(
        "along is the direction [x, y, z] of the cutter's axis; left out, every inner corner is checked",
      ),
    },
  },
  ribs: {
    needs: ["part", "wall"],
    may: ["ratio", "height"],
    fields: {
      part,
      wall: millimetres("wall", "the part's nominal wall, "),
      ratio: amount(
        "ratio is the most a rib may be thick at its root, as a share of the wall, above 0",
      ),
      height: amount(
        "height is the most a rib may stand out, as a multiple of the wall, above 0",
      ),
    },
    whole: (one) =>
      given(one, "ratio", "height") ? undefined : "gives ratio, height or both",
  },
  bend: {
    needs: ["part"],
    may: ["radius", "flange", "hole", "edge", "reliefs", "rules"],
    fields: {
      part,
      radius: millimetres("radius", "the least inside radius of a bend, "),
      flange: millimetres(
        "flange",
        "the shortest flat a flange may have beyond its bend, ",
      ),
      hole: millimetres("hole", "the least distance from a hole to a bend, "),
      edge: millimetres(
        "edge",
        "the least distance from a hole to the sheet's edge, ",
      ),
      reliefs: flag(
        "reliefs is true when every bend that ends inside the sheet is to have a relief",
      ),
      rules: flag(
        "rules is true for every sheet-metal rule from the thickness t: radius t, flange 4t, hole 2.5t plus the bend's radius, edge 2t, and reliefs",
      ),
    },
    whole: (one) =>
      given(one, "radius", "flange", "hole", "edge") ||
      one["reliefs"] === true ||
      one["rules"] === true
        ? undefined
        : "gives radius, flange, hole, edge, reliefs: true, rules: true or several",
  },
  balance: {
    needs: [],
    may: ["parts", "at", "tolerance", "footprint", "up", "materials"],
    fields: {
      parts,
      at: point(
        "at is the point [x, y, z] in mm the centre of mass is to be at, null where it may be anywhere along one",
      ),
      tolerance: amount(
        "tolerance is how far in mm the centre of mass may be from at",
        true,
      ),
      footprint: flag(
        "footprint is true when the centre of mass is to lie over what the parts stand on, so they do not tip",
      ),
      up: direction("up is a direction [x, y, z]"),
      materials: rule(
        (v) =>
          typeof v === "object" &&
          v !== null &&
          !Array.isArray(v) &&
          Object.keys(v).length > 0 &&
          Object.keys(v).length <= mostNames &&
          Object.entries(v).every(
            ([name, value]) =>
              isName(name) &&
              (material(value) === undefined || density(value) === undefined),
          ),
        `materials maps a part, or a pattern between slashes, to its material, one of ${MATERIALS.join(", ")}, or its density in g/cm³, for every part checked; left out, all are as dense`,
      ),
    },
    whole: (one) =>
      one["at"] !== undefined && one["tolerance"] === undefined
        ? "gives tolerance with at"
        : one["tolerance"] !== undefined && one["at"] === undefined
          ? "gives at with tolerance"
          : one["at"] === undefined && one["footprint"] !== true
            ? "gives at with tolerance, footprint: true, or both"
            : undefined,
  },
  undercut: {
    needs: ["part"],
    may: ["pull", "parting", "sides", "max"],
    fields: {
      part,
      pull: direction("pull is a direction [x, y, z]"),
      parting,
      sides: flag(
        "sides is true when the mould has side actions, so a face one square to the pull frees is allowed",
      ),
      max: amount(
        "max is the most area in mm² the mould may trap, 0 or more; 0 when left out",
        true,
      ),
    },
  },
  void: {
    needs: ["part"],
    may: ["opening"],
    fields: {
      part,
      opening: millimetres(
        "opening",
        "the least opening a hollow needs to the outside, as a drain or an escape hole, ",
      ),
    },
  },
  smooth: {
    needs: ["part"],
    may: ["surfaces", "level", "angle", "curvature"],
    fields: {
      part,
      surfaces: rule(
        isNames,
        `surfaces names from 1 to ${mostNames} of the part's named surfaces, the edges between their faces checked; left out, every edge of the part`,
      ),
      level: rule(
        (v) => v === "G1" || v === "G2",
        'level is "G1", the faces meeting at an edge turning no more than angle, or "G2", their curvature across it alike too; "G1" when left out',
      ),
      angle: rule(
        (v) => isNumber(v) && v > 0 && v <= 90,
        "angle is the most in degrees two faces may turn from each other across an edge, above 0 and at most 90; 0.5 when left out",
      ),
      curvature: rule(
        (v) => isNumber(v) && v > 0 && v <= 1,
        "curvature is the most the curvature across an edge may jump, as a share of the larger, above 0 and at most 1; 0.1 when left out",
      ),
    },
    whole: (one) =>
      one["curvature"] !== undefined && one["level"] !== "G2"
        ? 'gives level "G2" with curvature'
        : undefined,
  },
  stress: {
    needs: ["part", "along", "safety"],
    may: [
      "load",
      "toward",
      "supports",
      "spread",
      "torque",
      "root",
      "length",
      "material",
      "yield",
      "modulus",
      "deflection",
    ],
    fields: {
      part,
      along: direction(
        "along is the direction [x, y, z] of the part's length, from the end held, for a cantilever",
      ),
      safety: amount(
        "safety is the least factor the yield strength is to be over the highest stress, above 0",
      ),
      load: amount("load is the force in N, above 0"),
      toward: direction(
        "toward is the direction [x, y, z] the load pushes, square to along",
      ),
      supports: rule(
        (v) => v === "simple" || v === "cantilever" || v === "fixed",
        'supports is "simple" (resting at both ends), "cantilever" (held at the root, the load at the free end) or "fixed" (held at both ends); "simple" when left out',
      ),
      spread: flag(
        "spread is true when the load is spread evenly along the length, the load its total; left out, at the middle, or at the free end of a cantilever",
      ),
      torque: amount(
        "torque is the twisting moment in N·m about along, above 0",
      ),
      root: place(
        "root is the point [x, y, z] in mm where the part leaves what holds it, its length measured from there; left out, from the part's lowest along along",
      ),
      length: millimetres(
        "length",
        "how long the part is from its root, to its far end when left out, ",
      ),
      material: rule(
        (v) => (MATERIALS as readonly unknown[]).includes(v),
        `material is one of ${MATERIALS.join(", ")}; or give yield, and modulus with deflection, in MPa`,
      ),
      yield: amount("yield is the yield strength in MPa, above 0"),
      modulus: amount("modulus is Young's modulus in MPa, above 0"),
      deflection: millimetres(
        "deflection",
        "the most the part may bend under the load, ",
      ),
    },
    whole: (one) =>
      !given(one, "load", "torque")
        ? "gives load, torque or both"
        : given(one, "load") !== given(one, "toward")
          ? "gives toward with load"
          : !given(one, "material", "yield")
            ? "gives the material, or its yield strength in MPa"
            : one["deflection"] !== undefined &&
                (one["load"] === undefined || one["supports"] === "fixed")
              ? "gives deflection with a load on a simple or cantilever part"
              : one["deflection"] !== undefined &&
                  !given(one, "material", "modulus")
                ? "gives the material, or its modulus in MPa, with deflection"
                : undefined,
  },
  strain: {
    needs: ["part", "along", "toward", "deflection", "max"],
    may: ["root", "length"],
    fields: {
      part,
      along: direction(
        "along is the direction [x, y, z] of the arm's length, from its root to its tip",
      ),
      toward: direction(
        "toward is the direction [x, y, z] its tip is pushed, square to along",
      ),
      deflection: millimetres("deflection", "how far its tip is pushed, "),
      max: rule(
        (v) => isNumber(v) && v > 0 && v <= 100,
        "max is the most strain the material allows, in %, as its datasheet gives for a snap fit, above 0",
      ),
      root: place(
        "root is the point [x, y, z] in mm where the arm leaves what holds it; left out, the part's lowest along along",
      ),
      length: millimetres(
        "length",
        "how long the arm is from its root, to its far end when left out, ",
      ),
    },
  },
} as const satisfies Kinds;

export type KindName = keyof typeof requirementKinds;

/** The kinds a studio measures, from those named, in that order, with any of its own after them. */
export function kindsOf(names: readonly KindName[], own: Kinds = {}): Kinds {
  return {
    ...Object.fromEntries(names.map((name) => [name, requirementKinds[name]])),
    ...own,
  };
}
