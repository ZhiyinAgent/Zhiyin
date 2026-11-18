/**
 * The dimension kinds beyond lengths, overall sizes, diameters and radii, and
 * a parts list's materials, checked before anyone is asked: an angle between
 * two edges, a chamfer, a hole's callout and an ordinate from a datum, each
 * with the keys it takes. What they name is found on the part when it is
 * drawn, and refused there if it is not.
 */

import { isPoint } from "./json-values.js";

/** The keys each kind takes beside view, kind, expect and tolerance. */
const TAKES: Readonly<Record<string, readonly string[]>> = {
  angle: ["from", "to"],
  chamfer: ["at"],
  hole_callout: ["at", "all"],
  ordinate: ["from", "to", "direction"],
};
const SHARED = ["view", "kind", "expect", "tolerance"];

/** Why a dimension of one of these kinds cannot be drawn as asked, or nothing; any other kind is named as unknown. */
export function kindProblem(
  dimension: Readonly<Record<string, unknown>>,
  at: string,
): string | undefined {
  const kind = dimension["kind"];
  const takes = typeof kind === "string" ? TAKES[kind] : undefined;
  if (!takes)
    return `${at}.kind is length, overall, diameter, radius, angle, chamfer, hole_callout or ordinate.`;
  const stray = Object.keys(dimension).find(
    (key) => !SHARED.includes(key) && !takes.includes(key),
  );
  if (stray) return `${at} is ${a(kind as string)}; it takes no ${stray}.`;
  if (
    kind === "angle" &&
    !(isPoint(dimension["from"]) && isPoint(dimension["to"]))
  )
    return `${at} is an angle: from and to are points [x, y, z] in mm, each on one of the two edges it is between.`;
  if (kind === "chamfer" && !isPoint(dimension["at"]))
    return `${at} is a chamfer: at is a point [x, y, z] in mm on its slanted edge, seen side on.`;
  if (kind === "hole_callout") {
    if (dimension["at"] === undefined && dimension["expect"] === undefined)
      return `${at} is a hole callout: at is a point [x, y, z] in mm on the hole's circle or at its centre, or expect is its drilled diameter, which finds the hole of that size.`;
    if (dimension["at"] !== undefined && !isPoint(dimension["at"]))
      return `${at} is a hole callout: at is a point [x, y, z] in mm on the hole's circle or at its centre.`;
    if (dimension["all"] !== undefined && typeof dimension["all"] !== "boolean")
      return `${at}.all is true when the callout names every hole like it in the view, as 4× M6×1-6H ↧10.`;
  }
  if (kind === "ordinate") {
    if (!(isPoint(dimension["from"]) && isPoint(dimension["to"])))
      return `${at} is an ordinate: from is the datum, a point [x, y, z] in mm, and to the point it gives the distance of.`;
    if (!["horizontal", "vertical"].includes(dimension["direction"] as string))
      return `${at} is an ordinate: direction is horizontal for the distance across from its datum, or vertical for the distance up.`;
  }
  return undefined;
}

const a = (kind: string) =>
  ({
    angle: "an angle",
    chamfer: "a chamfer",
    hole_callout: "a hole callout",
    ordinate: "an ordinate",
  })[kind] ?? kind;

/** Why a parts list's materials, { part or /pattern/: material }, cannot be read, or nothing. */
export function materialsProblem(materials: unknown): string | undefined {
  if (materials === undefined) return undefined;
  if (
    typeof materials !== "object" ||
    materials === null ||
    Array.isArray(materials) ||
    !Object.keys(materials).length ||
    Object.keys(materials).length > 200 ||
    !Object.entries(materials).every(
      ([name, material]) =>
        name.trim().length > 0 &&
        typeof material === "string" &&
        material.trim().length > 0 &&
        material.length <= 80,
    )
  )
    return 'materials gives each part, by its name or a /pattern/, its material as text of at most 80 characters, as { "Plate": "aluminium", "/Screw.*/": "steel" }.';
  return undefined;
}
