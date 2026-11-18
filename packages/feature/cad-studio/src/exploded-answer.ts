/**
 * What an exploded view reports, as the harness writes it and as the answer
 * says it: the parts taken out in order, each with its way and how far it
 * went, those kept in place, those nothing could free, and any still lying
 * where another passes.
 */

import { isNumber, isRecord, isText } from "./json-values.js";

export type Exploded = {
  readonly order: readonly {
    readonly part: string;
    /** The parts taken out with it, as none comes out alone. */
    readonly with?: readonly string[];
    readonly way: readonly [number, number, number];
    readonly distance: number;
  }[];
  readonly kept: readonly { readonly part: string; readonly why: string }[];
  readonly staying: readonly string[];
  readonly crowded: readonly (readonly [string, string])[];
};

/** The exploded view the harness reported, if it is one; anything else is left out. */
export function explodedIn(value: unknown): { exploded?: Exploded } {
  if (
    !isRecord(value) ||
    !Array.isArray(value["order"]) ||
    !value["order"].every(
      (one) =>
        isRecord(one) &&
        isText(one["part"]) &&
        (one["with"] === undefined ||
          (Array.isArray(one["with"]) && one["with"].every(isText))) &&
        isNumber(one["distance"]) &&
        Array.isArray(one["way"]) &&
        one["way"].length === 3 &&
        one["way"].every(isNumber),
    ) ||
    !Array.isArray(value["kept"]) ||
    !value["kept"].every(
      (one) => isRecord(one) && isText(one["part"]) && isText(one["why"]),
    ) ||
    !Array.isArray(value["staying"]) ||
    !value["staying"].every(isText) ||
    !Array.isArray(value["crowded"]) ||
    !value["crowded"].every(
      (pair) => Array.isArray(pair) && pair.length === 2 && pair.every(isText),
    )
  )
    return {};
  return { exploded: value as Exploded };
}

const AXES: Readonly<Record<string, string>> = {
  "1,0,0": "+X",
  "-1,0,0": "-X",
  "0,1,0": "+Y",
  "0,-1,0": "-Y",
  "0,0,1": "+Z",
  "0,0,-1": "-Z",
};

/** A way out as one reads it: an axis by name, any other way by its direction. */
function wayWords(way: readonly [number, number, number]): string {
  const rounded = way.map((v) => Math.round(v * 1000) / 1000 || 0);
  return (
    AXES[rounded.join(",")] ??
    `along (${rounded.map((v) => Number(v.toFixed(3))).join(", ")})`
  );
}

const mm = (value: number) => `${Number(value.toFixed(1))} mm`;

/** The lines an answer gives an exploded view. */
export function explodedText(exploded: Exploded): string[] {
  const lines: string[] = [];
  const count = exploded.order.reduce(
    (sum, one) => sum + 1 + (one.with?.length ?? 0),
    0,
  );
  const steps = exploded.order.length;
  const how =
    steps === count
      ? "one at a time"
      : `in ${steps} ${steps === 1 ? "step" : "steps"}, those nothing frees alone together with what holds them in`;
  lines.push(
    steps
      ? `Moved apart: ${count} ${count === 1 ? "part" : "parts"} taken out ${how}, the first out first, each along a way found free on the parts' meshes and moved past what it sits against: ${exploded.order.map((one) => `${one.part}${one.with?.length ? ` with ${one.with.join(", ")}` : ""} ${wayWords(one.way)} ${mm(one.distance)}`).join("; ")}.`
      : "Moved apart: no part could be taken out.",
  );
  if (exploded.staying.length)
    lines.push(`Kept in place: ${exploded.staying.join(", ")}.`);
  if (exploded.kept.length)
    lines.push(
      `Left in, as nothing frees ${exploded.kept.length === 1 ? "it" : "them"}: ${exploded.kept.map((one) => `${one.part} (${one.why})`).join("; ")}.`,
    );
  if (exploded.crowded.length)
    lines.push(
      `Still lying where a part taken out after passes: ${exploded.crowded.map(([first, second]) => `${first} in ${second}'s way`).join("; ")}. Give a larger spread, or take fewer parts out.`,
    );
  return lines;
}
