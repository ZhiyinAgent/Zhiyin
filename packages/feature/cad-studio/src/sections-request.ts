/**
 * The cut views a build adds to its picture, so the model can see inside the
 * parts: each a plane through a point, square to the side it is looked at
 * from, through the parts it names or all of them.
 */

import { isRecord } from "./json-values.js";

/** The sides a section is looked at from. */
const sectionSides = [
  "front",
  "back",
  "top",
  "bottom",
  "right",
  "left",
] as const;

/** One section as the harness takes it. */
export type SectionAsked = {
  readonly through: readonly [number, number, number];
  readonly looking: (typeof sectionSides)[number];
  readonly parts?: readonly string[];
};

/** At most this many sections a build, so the picture stays one a model can read. */
const mostSections = 4;

/** The sections a call asks for, or why they are not ones a build can draw. */
export function sectionsOf(
  given: unknown,
  tool: "cad_build" | "cad_draw",
):
  | { readonly ok: true; readonly sections?: readonly SectionAsked[] }
  | { readonly ok: false; readonly reason: string } {
  if (given === undefined) return { ok: true };
  if (tool !== "cad_build")
    return {
      ok: false,
      reason:
        "sections is for cad_build's picture; a drawing's sections are views, listed in views.",
    };
  if (!Array.isArray(given) || given.length < 1 || given.length > mostSections)
    return {
      ok: false,
      reason: `sections lists from 1 to ${mostSections} cuts, each { through: [x, y, z], looking }.`,
    };
  const sections: SectionAsked[] = [];
  for (const [index, one] of given.entries()) {
    const at = `sections[${index}]`;
    if (!isRecord(one))
      return { ok: false, reason: `${at} is { through: [x, y, z], looking }.` };
    const { through, looking, parts } = one;
    if (
      !Array.isArray(through) ||
      through.length !== 3 ||
      !through.every((v) => typeof v === "number" && Number.isFinite(v))
    )
      return {
        ok: false,
        reason: `${at}.through is the point the cut passes through, [x, y, z] in mm.`,
      };
    if (!sectionSides.includes(looking as SectionAsked["looking"]))
      return {
        ok: false,
        reason: `${at}.looking is the side it is seen from: ${sectionSides.join(", ")}.`,
      };
    if (
      parts !== undefined &&
      !(
        Array.isArray(parts) &&
        parts.length > 0 &&
        parts.every((name) => typeof name === "string")
      )
    )
      return {
        ok: false,
        reason: `${at}.parts names the parts it cuts; leave it out to cut them all.`,
      };
    sections.push({
      through: through as [number, number, number],
      looking: looking as SectionAsked["looking"],
      ...(parts ? { parts: parts as string[] } : {}),
    });
  }
  return { ok: true, sections };
}
