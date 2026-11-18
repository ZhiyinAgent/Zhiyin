/**
 * A requirements file: { "requirements": [...] }, each requirement an id,
 * its words, and a check of one of the kinds the studio measures, with that
 * kind's fields. A file that cannot be read as requirements is refused,
 * naming the requirement, the field and how to mend it.
 */

import { longest, mostNames } from "./fields.js";
import type { Kinds } from "./kinds.js";

export type Requirement = Readonly<Record<string, unknown>> & {
  readonly id: string;
  readonly check: string;
};

/** The most requirements a file holds. */
const mostRequirements = 100;
/** The most a requirements file may hold, in bytes. */
export const largestFile = 256 * 1024;

/** The limits a requirements file is held to, as the model is told them. */
export const requirementLimits = `The file holds from 1 to ${mostRequirements} requirements and is at most ${largestFile / 1024} KB; says is at most ${longest} characters, a part's name or pattern at most ${longest}, and a list of them at most ${mostNames} entries.`;

/** "a" or "an", as a kind's name begins. */
const a = (kind: string) => (/^[aeiou]/.test(kind) ? "an" : "a");

/**
 * The requirements a file's text holds, checked against the kinds a studio
 * measures, or why it cannot be read as them, after the file's name, with
 * what the design is when the file says. A kind in `elsewhere`, which
 * another studio measures, is read by its fields too, so one file serves a
 * design in both studios.
 */
export function readRequirements(
  text: string,
  file: string,
  kinds: Kinds,
  elsewhere: Kinds = {},
):
  | {
      readonly ok: true;
      readonly requirements: readonly Requirement[];
      /** What the design is, as the file's object says it. */
      readonly object?: string;
    }
  | { readonly ok: false; readonly reason: string } {
  const fail = (reason: string) =>
    ({ ok: false, reason: `${file}: ${reason}.` }) as const;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return fail(`it is not JSON (${(error as Error).message})`);
  }
  const listed =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)["requirements"]
      : undefined;
  if (!Array.isArray(listed) || listed.length === 0)
    return fail(
      `it holds { "requirements": [...] }, from 1 to ${mostRequirements} of them`,
    );
  if (listed.length > mostRequirements)
    return fail(
      `it holds at most ${mostRequirements} requirements; check several parts in one with a pattern between slashes, such as /Bolt_.*/, or keep those that matter most`,
    );
  const object = (value as Record<string, unknown>)["object"];
  if (
    object !== undefined &&
    !(
      typeof object === "string" &&
      object.trim().length > 0 &&
      object.length <= longest
    )
  )
    return fail(
      `object is what the design is, in words, at most ${longest} characters`,
    );
  const ids = new Set<string>();
  const requirements: Requirement[] = [];
  for (const [index, item] of listed.entries()) {
    const at = `requirement ${index + 1}`;
    if (typeof item !== "object" || item === null || Array.isArray(item))
      return fail(`${at} is an object`);
    const given = item as Record<string, unknown>;
    const id = given["id"];
    if (typeof id !== "string" || !/^[\w.-]{1,20}$/.test(id))
      return fail(
        `${at} needs an id, such as "R1", of letters, digits, ".", "-" or "_"`,
      );
    if (ids.has(id)) return fail(`two requirements are ${id}`);
    ids.add(id);
    const says = given["says"];
    if (
      says !== undefined &&
      !(typeof says === "string" && says.length <= longest)
    )
      return fail(
        `${id}: says is the requirement in words, at most ${longest} characters; shorten it`,
      );
    const kind = given["check"];
    const fields =
      typeof kind !== "string"
        ? undefined
        : Object.hasOwn(kinds, kind)
          ? kinds[kind]
          : Object.hasOwn(elsewhere, kind)
            ? elsewhere[kind]
            : undefined;
    if (!fields || typeof kind !== "string")
      return fail(`${id}: check is one of ${Object.keys(kinds).join(", ")}`);
    for (const need of fields.needs)
      if (given[need] === undefined)
        return fail(`${id}: ${a(kind)} ${kind} check needs ${need}`);
    for (const [field, value] of Object.entries(given)) {
      if (["id", "says", "check"].includes(field)) continue;
      const fieldRule = [...fields.needs, ...fields.may].includes(field)
        ? fields.fields[field]
        : undefined;
      if (!fieldRule)
        return fail(
          `${id}: ${field} is not a field of ${a(kind)} ${kind} check; it takes ${[...fields.needs, ...fields.may].join(", ")}`,
        );
      const problem = fieldRule(value);
      if (problem) return fail(`${id}: ${problem}`);
    }
    const between = fields.whole?.(given);
    if (between) return fail(`${id}: ${a(kind)} ${kind} check ${between}`);
    requirements.push({ ...given, id, check: kind } as Requirement);
  }
  return {
    ok: true,
    requirements,
    ...(typeof object === "string" ? { object } : {}),
  };
}
