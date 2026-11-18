/**
 * A rigid sweep a build is asked for: parts that move together as one piece,
 * a lid on its hinge or a carriage on its rail, turned about an axis or slid
 * along a direction in even steps; and, for gears, a rack or a belt, further
 * groups that move with them, each turned or slid by its own rate times the
 * first group's move. The harness builds once and moves the parts' meshes, so
 * a fine sweep costs seconds where re-running the script at each position
 * costs a build per step.
 */

import { isRecord } from "./json-values.js";

/** The most steps a sweep takes. */
export const mostSteps = 360;

/** The most groups that move with the first. */
const mostGroups = 5;

type Point = readonly [number, number, number];

/** A group moving with the first: turned about its own axis, or slid, by `rate` times the first group's move. */
type GearedGroup = {
  readonly parts: readonly string[];
  readonly rate: number;
} & (
  | { readonly turn: { readonly through: Point; readonly along: Point } }
  | { readonly slide: { readonly along: Point } }
);

export type RigidSweep = {
  readonly parts: readonly string[];
  readonly steps: number;
  readonly with?: readonly GearedGroup[];
} & (
  | {
      readonly turn: {
        readonly through: Point;
        readonly along: Point;
        readonly from: number;
        readonly to: number;
      };
    }
  | {
      readonly slide: {
        readonly along: Point;
        readonly from: number;
        readonly to: number;
      };
    }
);

const point = (value: unknown): [number, number, number] | undefined =>
  Array.isArray(value) &&
  value.length === 3 &&
  value.every((v) => typeof v === "number" && Number.isFinite(v))
    ? [value[0], value[1], value[2]]
    : undefined;

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const named = (parts: unknown): parts is string[] =>
  Array.isArray(parts) &&
  parts.length > 0 &&
  parts.every((name) => typeof name === "string" && name.trim());

type Checked =
  | { readonly ok: true; readonly sweep: RigidSweep }
  | { readonly ok: false; readonly reason: string };

const refused = (reason: string) => ({ ok: false as const, reason });

const withShape = `sweep's with is a list of 1 to ${mostGroups} groups that move with the parts: each parts, along, through to turn, and rate.`;

/** The group moving with the first that `value` asks for, or why it cannot move so. */
function gearedOf(
  value: unknown,
): { ok: true; group: GearedGroup } | { ok: false; reason: string } {
  if (!isRecord(value)) return refused(withShape);
  if (!named(value["parts"]))
    return refused(
      "each with group's parts names the parts that move together, as the script shows them.",
    );
  if (["from", "to", "steps"].some((key) => value[key] !== undefined))
    return refused(
      "a with group moves by its rate times the first group's move; from, to and steps are the sweep's alone.",
    );
  const turns = value["through"] !== undefined;
  const through = turns ? point(value["through"]) : undefined;
  if (turns && !through)
    return refused(
      "a with group's through is a point on its axis: three numbers.",
    );
  const along = point(value["along"]);
  if (!along || along.every((v) => v === 0))
    return refused(
      "a with group's along is a direction: three numbers, not all zero.",
    );
  const rate = value["rate"];
  if (!finite(rate) || rate === 0)
    return refused(
      "sweep's with rate is how far a group moves for each degree or mm of the first group's move, in degrees when it turns and mm when it slides: a number other than zero, written out, as -0.4 for a gear of 40 teeth driven by one of 16.",
    );
  const parts = value["parts"];
  return {
    ok: true,
    group: through
      ? { parts, turn: { through, along }, rate }
      : { parts, slide: { along }, rate },
  };
}

/** The groups moving with the first that `value` asks for, or why they cannot. */
function withOf(
  value: unknown,
): { ok: true; groups: GearedGroup[] } | { ok: false; reason: string } {
  if (!Array.isArray(value) || !value.length || value.length > mostGroups)
    return refused(withShape);
  const groups: GearedGroup[] = [];
  for (const one of value) {
    const checked = gearedOf(one);
    if (!checked.ok) return checked;
    groups.push(checked.group);
  }
  return { ok: true, groups };
}

/** The sweep `value` asks for, or why it cannot be swept. */
export function rigidSweepOf(value: unknown): Checked {
  if (!isRecord(value))
    return refused(
      "sweep is an object: parts, through (to turn), along, from, to and steps.",
    );
  const parts = value["parts"];
  if (!named(parts))
    return refused(
      "sweep's parts names the parts that move together, as the script shows them.",
    );
  // A point on the axis makes it a turn; without one the parts slide.
  const turns = value["through"] !== undefined;
  const through = turns ? point(value["through"]) : undefined;
  if (turns && !through)
    return refused("sweep's through is a point on the axis: three numbers.");
  const along = point(value["along"]);
  if (!along || along.every((v) => v === 0))
    return refused(
      "sweep's along is a direction: three numbers, not all zero.",
    );
  const from = value["from"];
  const to = value["to"];
  if (!finite(from) || !finite(to) || from === to)
    return refused("sweep's from and to are two different numbers.");
  if (turns && Math.abs(to - from) > 360)
    return refused(
      "sweep turns at most a whole turn, 360 degrees, from from to to.",
    );
  const steps = value["steps"];
  if (
    typeof steps !== "number" ||
    !Number.isInteger(steps) ||
    steps < 1 ||
    steps > mostSteps
  )
    return refused(`sweep's steps is a whole number from 1 to ${mostSteps}.`);
  let groups: GearedGroup[] | undefined;
  if (value["with"] !== undefined) {
    const checked = withOf(value["with"]);
    if (!checked.ok) return checked;
    groups = checked.groups;
  }
  const seen = new Set<string>();
  for (const name of [parts, ...(groups ?? []).map((g) => g.parts)].flat()) {
    if (seen.has(name))
      return refused(
        `sweep names ${name} in two groups; a part moves with one group only.`,
      );
    seen.add(name);
  }
  const geared = groups ? { with: groups } : {};
  return {
    ok: true,
    sweep: through
      ? { parts, turn: { through, along, from, to }, steps, ...geared }
      : { parts, slide: { along, from, to }, steps, ...geared },
  };
}
