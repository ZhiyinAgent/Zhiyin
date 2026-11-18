/**
 * What a drawing asks for, checked before anyone is asked to approve it: the
 * sheet, the views, the dimensions and the title, each as the harness takes
 * it. What names geometry (a corner, a hole) is found on the part when it is
 * drawn, and refused there if it is not.
 */

import { explodeOf, type ExplodeAsked } from "./explode-request.js";
import { kindProblem, materialsProblem } from "./drawing-kinds.js";
import { isPoint, isRecord } from "./json-values.js";

const SHEETS = ["A4", "A3", "A2", "A1", "A0"];
const NAMED = ["front", "back", "top", "bottom", "left", "right", "iso"];
const STRAIGHT = NAMED.filter((name) => name !== "iso");
const TITLE_FIELDS = [
  "title",
  "number",
  "material",
  "author",
  "company",
  "revision",
  "date",
];
/** A tolerance as a drawing writes one: ±0.1, +0.1/-0, or a fit such as H7. */
const TOLERANCE =
  /^(±\d+(\.\d+)?|[+-]\d+(\.\d+)?\/[+-]?\d+(\.\d+)?|[A-Za-z]{1,2}\d{1,2})$/;

export type DrawingSpec = Readonly<Record<string, unknown>>;

type Checked =
  | { readonly ok: true; readonly spec: DrawingSpec }
  | { readonly ok: false; readonly reason: string };

/** A key the drawing does not know, which a misspelling would otherwise leave unread. */
const unknownKey = (
  value: Record<string, unknown>,
  known: readonly string[],
): string | undefined => Object.keys(value).find((key) => !known.includes(key));

const VIEW_KEYS: Record<string, readonly string[]> = {
  view: ["view", "hidden"],
  section: ["section", "looking", "through", "uncut", "revolved", "axis"],
  detail: ["detail", "of", "at", "radius", "scale"],
  auxiliary: ["auxiliary", "direction", "hidden"],
};
const DRAWING_KEYS = [
  "code",
  "file",
  "arguments",
  "parts",
  "scene",
  "objects",
  "sheet",
  "orientation",
  "projection",
  "scale",
  "views",
  "dimensions",
  "title",
  "outputs",
  "explode",
  "minutes",
  "parts_list",
  "balloons",
  "materials",
];
const DIMENSION_KEYS = [
  "view",
  "kind",
  "from",
  "to",
  "direction",
  "diameter",
  "at",
  "all",
  "expect",
  "tolerance",
];

const isLetter = (value: unknown) =>
  typeof value === "string" && /^[A-Z]$/.test(value);

function viewProblem(view: unknown, index: number): string | undefined {
  const at = `views[${index}]`;
  if (!isRecord(view)) return `${at} is an object.`;
  const kinds = ["view", "section", "detail", "auxiliary"].filter(
    (key) => view[key] !== undefined,
  );
  if (kinds.length !== 1)
    return `${at} gives one of view, section, detail or auxiliary.`;
  const [kind] = kinds;
  if (kind === "auxiliary" && view["looking"] !== undefined)
    return `${at}.looking is a section's straight view; an auxiliary view looks along direction: [x, y, z].`;
  const stray = unknownKey(view, VIEW_KEYS[kind!]!);
  if (stray)
    return `${at} gives ${stray}, which ${kind === "auxiliary" ? "an auxiliary view" : `a ${kind}`} does not take.`;
  if (view["hidden"] !== undefined && typeof view["hidden"] !== "boolean")
    return `${at}.hidden is false to leave the view's hidden edges out.`;
  if (kind === "view")
    return NAMED.includes(view["view"] as string)
      ? undefined
      : `${at}.view is one of ${NAMED.join(", ")}.`;
  if (!isLetter(view[kind!]))
    return `${at}.${kind} is the view's letter, A to Z.`;
  if (kind === "section") {
    if (!STRAIGHT.includes(view["looking"] as string))
      return `${at}.looking is the straight view the section looks as: ${STRAIGHT.join(", ")}.`;
    if (!isPoint(view["through"]))
      return `${at}.through is a point [x, y, z] in mm the cutting plane passes through.`;
    const uncut = view["uncut"];
    if (
      uncut !== undefined &&
      (!Array.isArray(uncut) ||
        uncut.length > 20 ||
        !uncut.every((name) => typeof name === "string" && name.length > 0))
    )
      return `${at}.uncut lists the names of up to 20 parts, or objects of a scene, the section leaves whole.`;
    return revolvedProblem(view, at);
  }
  if (kind === "detail") {
    if (typeof view["of"] !== "string")
      return `${at}.of names the view the detail is taken from.`;
    if (!isPoint(view["at"]))
      return `${at}.at is the point [x, y, z] in mm at the detail's middle.`;
    const radius = view["radius"];
    if (typeof radius !== "number" || !(radius > 0))
      return `${at}.radius is the detail circle's radius in mm, above 0.`;
    const scale = view["scale"];
    if (
      scale !== undefined &&
      (typeof scale !== "number" || !(scale >= 1 && scale <= 20))
    )
      return `${at}.scale is how much larger the detail is drawn, 1 to 20.`;
    return undefined;
  }
  return isPoint(view["direction"]) &&
    Math.hypot(...(view["direction"] as number[])) >= 1e-6
    ? undefined
    : `${at}.direction is the direction [x, y, z] the view looks in, not [0, 0, 0].`;
}

/** The way each straight view looks, as the drafting's views do. */
const LOOKS: Record<string, readonly [number, number, number]> = {
  front: [0, 1, 0],
  back: [0, -1, 0],
  top: [0, 0, -1],
  bottom: [0, 0, 1],
  right: [-1, 0, 0],
  left: [1, 0, 0],
};

/**
 * Why a section's revolved parts cannot be drawn as asked: they are named,
 * none also left whole, and turn about an axis lying in the cutting plane.
 */
function revolvedProblem(
  view: Record<string, unknown>,
  at: string,
): string | undefined {
  const { revolved, axis } = view;
  if (revolved === undefined)
    return axis === undefined
      ? undefined
      : `${at}.axis is the axis revolved parts turn about; name them in revolved.`;
  if (
    !Array.isArray(revolved) ||
    revolved.length === 0 ||
    revolved.length > 40 ||
    !revolved.every((name) => typeof name === "string" && name.length > 0)
  )
    return `${at}.revolved lists the names of up to 40 parts, or objects of a scene, the section draws turned into its plane.`;
  if (axis === undefined)
    return `${at}.revolved needs axis: { through: [x, y, z], along: [x, y, z] }, the axis its parts turn about.`;
  if (
    !isRecord(axis) ||
    unknownKey(axis, ["through", "along"]) !== undefined ||
    !isPoint(axis["through"]) ||
    !isPoint(axis["along"]) ||
    Math.hypot(...(axis["along"] as number[])) < 1e-9
  )
    return `${at}.axis is { through: [x, y, z], along: [x, y, z] }: a point on it in mm and its direction.`;
  const along = axis["along"] as number[];
  const look = LOOKS[view["looking"] as string]!;
  const across =
    Math.abs(along[0]! * look[0] + along[1]! * look[1] + along[2]! * look[2]) /
    Math.hypot(...along);
  if (across > 1e-6)
    return `${at}.axis runs across the cutting plane, square to it in part; revolved parts turn about an axis lying in the plane, square to the way the section looks.`;
  const twice = (revolved as string[]).find((name) =>
    ((view["uncut"] as string[] | undefined) ?? []).includes(name),
  );
  if (twice)
    return `${at} both leaves ${twice} whole and revolves it; give it once.`;
  return undefined;
}

/** The name each view goes by: a named view's own, or the letter of a section, detail or auxiliary view. */
function nameOf(view: Record<string, unknown>): string {
  return String(
    view["view"] ?? view["section"] ?? view["detail"] ?? view["auxiliary"],
  );
}

const DEFAULT_VIEWS = ["front", "top", "right", "iso"];

/** The names of the views a checked drawing has, as its dimensions and outputs refer to them. */
export function viewNames(spec: DrawingSpec): readonly string[] {
  const views = spec["views"] as readonly Record<string, unknown>[];
  return views.length === 0 ? DEFAULT_VIEWS : views.map(nameOf);
}

const greatestDivisor = (a: number, b: number): number =>
  b === 0 ? a : greatestDivisor(b, a % b);

function dimensionProblem(
  dimension: unknown,
  index: number,
): string | undefined {
  const at = `dimensions[${index}]`;
  if (!isRecord(dimension)) return `${at} is an object.`;
  const stray = unknownKey(dimension, DIMENSION_KEYS);
  if (stray) return `${at} gives ${stray}, which a dimension does not take.`;
  if (typeof dimension["view"] !== "string")
    return `${at}.view names the view it is drawn on.`;
  const kind = dimension["kind"];
  if (kind === "length") {
    if (!isPoint(dimension["from"]) || !isPoint(dimension["to"]))
      return `${at} is a length: from and to are points [x, y, z] in mm at its two ends.`;
    const direction = dimension["direction"];
    if (
      direction !== undefined &&
      !["horizontal", "vertical", "aligned"].includes(direction as string)
    )
      return `${at}.direction is horizontal, vertical or aligned.`;
    if (dimension["all"] !== undefined)
      return `${at}.all counts the holes of a diameter, not a length.`;
    if (dimension["at"] !== undefined)
      return `${at} is a length, between from and to; at is a diameter's or a radius's point.`;
    if (
      dimension["diameter"] !== undefined &&
      typeof dimension["diameter"] !== "boolean"
    )
      return `${at}.diameter is true when the length is across a round part, written with Ø.`;
  } else if (kind === "overall") {
    if (!["horizontal", "vertical"].includes(dimension["direction"] as string))
      return `${at} is an overall size: direction is horizontal for the view's whole width or vertical for its whole height.`;
    const stray = ["from", "to", "at", "all", "diameter"].find(
      (key) => dimension[key] !== undefined,
    );
    if (stray)
      return `${at} is an overall size, found from the whole view; it takes no ${stray}.`;
  } else if (kind === "diameter" || kind === "radius") {
    if (dimension["at"] === undefined && dimension["expect"] === undefined)
      return `${at} is a ${kind}: at is a point [x, y, z] in mm on the circle or at its centre, or expect is its size, which finds the ${kind === "diameter" ? "circle" : "arc"} of that size in the view.`;
    if (dimension["at"] !== undefined && !isPoint(dimension["at"]))
      return `${at} is a ${kind}: at is a point [x, y, z] in mm on the circle or at its centre.`;
    if (dimension["diameter"] !== undefined)
      return `${at}.diameter marks a length across a round part; a ${kind} needs none.`;
    const stray = ["from", "to", "direction"].find(
      (key) => dimension[key] !== undefined,
    );
    if (stray)
      return `${at} is a ${kind}, found by its point at; ${stray} is a length's.`;
    const all = dimension["all"];
    if (all !== undefined && (kind !== "diameter" || typeof all !== "boolean"))
      return `${at}.all is true when a diameter names every hole of its size in the view, as 4× Ø6.`;
  } else {
    const problem = kindProblem(dimension, at);
    if (problem) return problem;
  }
  const expect = dimension["expect"];
  if (
    expect !== undefined &&
    (typeof expect !== "number" || !Number.isFinite(expect))
  )
    return `${at}.expect is the size in mm it should have.`;
  const tolerance = dimension["tolerance"];
  if (
    tolerance !== undefined &&
    !(typeof tolerance === "string" && TOLERANCE.test(tolerance))
  )
    return `${at}.tolerance is written as ±0.1, +0.1/-0 or a fit such as H7.`;
  return undefined;
}

/** The drawing a `cad_draw` call asks for, or why it cannot be drawn as asked. */
export function drawingOf(args: Readonly<Record<string, unknown>>): Checked {
  const fail = (reason: string): Checked => ({ ok: false, reason });
  const stray = unknownKey(args, DRAWING_KEYS);
  if (stray) return fail(`A drawing does not take ${stray}.`);
  const sheet = args["sheet"] ?? "A3";
  if (!SHEETS.includes(sheet as string))
    return fail(`sheet is one of ${SHEETS.join(", ")}.`);
  const orientation = args["orientation"] ?? "landscape";
  if (orientation !== "landscape" && orientation !== "portrait")
    return fail("orientation is landscape or portrait.");
  const projection = args["projection"] ?? "first";
  if (projection !== "first" && projection !== "third")
    return fail("projection is first or third (angle).");
  const scale = args["scale"];
  if (
    scale !== undefined &&
    !(typeof scale === "string" && /^[1-9]\d{0,3}:[1-9]\d{0,3}$/.test(scale))
  )
    return fail("scale is written as 1:2 or 5:1.");
  if (typeof scale === "string") {
    const [drawn, real] = scale.split(":").map(Number) as [number, number];
    const shared = greatestDivisor(drawn, real);
    if (shared > 1)
      return fail(
        `scale ${scale} is written ${drawn / shared}:${real / shared}, in its lowest terms.`,
      );
  }
  const views = args["views"] ?? [];
  if (!Array.isArray(views) || views.length > 12)
    return fail("views lists at most 12 views.");
  for (const [index, view] of views.entries()) {
    const problem = viewProblem(view, index);
    if (problem) return fail(problem);
  }
  const names = viewNames({ views });
  const twice = names.find((name, index) => names.indexOf(name) !== index);
  if (twice) return fail(`two views are called ${twice}.`);
  for (const [index, view] of (views as Record<string, unknown>[]).entries()) {
    const of = view["of"];
    if (view["detail"] === undefined) continue;
    if (of === view["detail"])
      return fail(
        `views[${index}] is a detail of itself; name the view it is taken from.`,
      );
    if (!names.includes(of as string))
      return fail(
        `views[${index}] is a detail of the ${String(of)} view, which the drawing does not have; it has ${names.join(", ")}.`,
      );
  }
  // Each detail's chain of parents ends at a view that is not a detail.
  const parentOf = new Map(
    (views as Record<string, unknown>[])
      .filter((view) => view["detail"] !== undefined)
      .map((view) => [view["detail"] as string, view["of"] as string]),
  );
  for (const [index, view] of (views as Record<string, unknown>[]).entries()) {
    const start = view["detail"] as string | undefined;
    if (start === undefined) continue;
    const chain = [start];
    let at = parentOf.get(start);
    while (at !== undefined && !chain.includes(at)) {
      chain.push(at);
      at = parentOf.get(at);
    }
    if (at === start)
      return fail(
        `views[${index}] is detail ${start}, ${chain
          .slice(1)
          .map((name, step) =>
            step === 0 ? `of ${name}` : `which is of ${name}`,
          )
          .join(
            ", ",
          )}, which is of ${start}: no view of the drawing comes first; take one of them from a view that is not a detail.`,
      );
  }
  const dimensions = args["dimensions"] ?? [];
  if (!Array.isArray(dimensions) || dimensions.length > 80)
    return fail("dimensions lists at most 80 dimensions.");
  for (const [index, dimension] of dimensions.entries()) {
    const problem = dimensionProblem(dimension, index);
    if (problem) return fail(problem);
    const on = (dimension as Record<string, unknown>)["view"] as string;
    if (!names.includes(on))
      return fail(
        `dimensions[${index}] is on the ${on} view, which the drawing does not have; it has ${names.join(", ")}.`,
      );
  }
  const title = args["title"] ?? {};
  if (
    !isRecord(title) ||
    Object.entries(title).some(
      ([key, value]) =>
        !TITLE_FIELDS.includes(key) ||
        typeof value !== "string" ||
        value.length > 80,
    )
  )
    return fail(
      `title holds ${TITLE_FIELDS.join(", ")}, each text of at most 80 characters.`,
    );
  const parts = args["parts"];
  if (
    parts !== undefined &&
    !(
      Array.isArray(parts) &&
      parts.length > 0 &&
      parts.every((p) => typeof p === "string")
    )
  )
    return fail("parts names at least one shown part.");
  const scene = args["scene"];
  if (scene !== undefined && typeof scene !== "boolean")
    return fail(
      "scene is true to draw the 3D scene open in this conversation.",
    );
  const objects = args["objects"];
  if (objects !== undefined && scene !== true)
    return fail(
      "objects names what a drawing of the 3D scene shows; give scene: true, or name parts.",
    );
  if (scene === true && parts !== undefined)
    return fail(
      "A drawing of the 3D scene shows its objects; name them in objects, not parts.",
    );
  if (
    objects !== undefined &&
    !(
      Array.isArray(objects) &&
      objects.length > 0 &&
      objects.length <= 200 &&
      objects.every((name) => typeof name === "string" && name.length > 0)
    )
  )
    return fail("objects names 1 to 200 objects of the scene.");
  const partsList = args["parts_list"];
  if (partsList !== undefined && typeof partsList !== "boolean")
    return fail(
      "parts_list is true to draw the parts list and balloon its items.",
    );
  if (partsList === true && scene === true)
    return fail(
      "A parts list lists a script's parts; a drawing of the 3D scene has none.",
    );
  const balloons = args["balloons"];
  if (balloons !== undefined && partsList !== true)
    return fail(
      "balloons names the view a parts list's balloons go on; give parts_list: true too.",
    );
  if (balloons !== undefined && !names.includes(balloons as string))
    return fail(
      `balloons are on the ${String(balloons)} view, which the drawing does not have; it has ${names.join(", ")}.`,
    );
  const materials = args["materials"];
  if (materials !== undefined && partsList !== true)
    return fail(
      "materials gives a parts list's materials; give parts_list: true too.",
    );
  const unmade = materialsProblem(materials);
  if (unmade) return fail(unmade);
  let explode: ExplodeAsked | undefined;
  if (args["explode"] !== undefined) {
    if (scene === true)
      return fail(
        "explode moves a script's parts apart; a drawing of the 3D scene shows it as it is.",
      );
    const asked = explodeOf(args["explode"]);
    if (!asked.ok) return fail(asked.reason);
    explode = asked.explode;
  }
  return {
    ok: true,
    spec: {
      sheet,
      orientation,
      projection,
      ...(scale ? { scale } : {}),
      views,
      // Left out, the drawing gives its overall sizes; an empty list asks for none.
      ...(args["dimensions"] !== undefined ? { dimensions } : {}),
      title,
      ...(parts ? { parts } : {}),
      ...(scene === true ? { scene: true } : {}),
      ...(objects ? { objects } : {}),
      ...(explode ? { explode } : {}),
      ...(partsList === true ? { parts_list: true } : {}),
      ...(balloons !== undefined ? { balloons } : {}),
      ...(materials !== undefined ? { materials } : {}),
    },
  };
}
