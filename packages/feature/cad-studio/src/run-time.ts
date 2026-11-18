/**
 * How long a build or a drawing may run: five minutes, or the whole minutes
 * the model gives it, up to thirty; and that time in words, for an answer
 * that ran out of it.
 */

export const minutes = (n: number) => n * 60_000;

/** The most minutes a model may give a build or a drawing. */
const mostMinutes = 30;

/** The minutes a call asks for, nothing when it asks for none, or why they are not minutes it may have. */
export function minutesOf(
  value: unknown,
  run: "build" | "drawing",
):
  | { readonly ok: true; readonly minutes?: number }
  | { readonly ok: false; readonly reason: string } {
  if (value === undefined) return { ok: true };
  if (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= mostMinutes
  )
    return { ok: true, minutes: value };
  return {
    ok: false,
    reason: `minutes is how long the ${run} may run, a whole number from 1 to ${mostMinutes}; left out, it has 5.`,
  };
}

/** How long a call may run: the minutes it asks for, or `usual`, in ms. */
export const timeFor = (asked: number | undefined, usual: number) =>
  asked !== undefined ? minutes(asked) : usual;

const numberWords = [
  "",
  "",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
];

/** A run's time in words: "the minute", "the five minutes", or seconds. */
export const timeWords = (ms: number) =>
  ms === minutes(1)
    ? "the minute"
    : ms % minutes(1) === 0
      ? `the ${numberWords[ms / minutes(1)] ?? ms / minutes(1)} minutes`
      : `the ${Math.round(ms / 1000)} s`;

/** What to do when a run had too little time: less in a call, or more minutes; naming those it had, when given. */
export function moreTime(run: "build" | "drawing", ms?: number): string {
  const advice = `${
    run === "drawing"
      ? "draw one subsystem per call, or, where the whole assembly is needed, ask again with more minutes"
      : "build less in a call, or ask again with more minutes"
  }, up to ${mostMinutes}.`;
  if (ms === undefined) return `${advice[0]!.toUpperCase()}${advice.slice(1)}`;
  const had =
    ms % minutes(1) === 0
      ? `${ms / minutes(1)} ${ms === minutes(1) ? "minute" : "minutes"}`
      : `${Math.round(ms / 1000)} s`;
  return `It had ${had}: ${advice}`;
}
