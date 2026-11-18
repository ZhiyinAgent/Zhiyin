/**
 * Requirements as a studio measured them, and as an answer and the person's
 * list of checks say them: how many hold, each one holding with its margin,
 * failing with how far past its limit, or not checked with why; each margin
 * beside the last check of the same design; and each requirement that failed
 * last time and has left the file, named so taking one out is never silent.
 */

import type { ActionDetail } from "@zhiyin/contract";
import { figures } from "./ranges.js";

export type Checked = {
  readonly id: string;
  /** Whether it holds; null when it could not be checked. */
  readonly holds: boolean | null;
  readonly measured?: string;
  /** How far inside the limit, or, below zero, past it. */
  readonly margin?: number;
  readonly unit?: string;
  /** Why it could not be checked. */
  readonly why?: string;
};

/** What a requirement came to at the last check of the same design: its margin, whether it held, its unit and what it says. */
export type Last = {
  readonly margin?: number;
  readonly holds: boolean | null;
  readonly unit?: string;
  readonly says?: string;
};

/** Each requirement's words, by id. */
export type Says = Readonly<Record<string, string | undefined>>;

/** How a studio's verdicts are headed and where the requirements were read. */
export type Verdicts = {
  /** The file the requirements were read from, as the answer names it. */
  readonly file: string;
  /** The heading before the count, "Requirements in <file>" when left out. */
  readonly title?: string;
  /** What a margin is compared with, "the last build" when left out. */
  readonly since?: string;
  /**
   * "counted" leaves the requirements that hold out of the answer's lines,
   * in the count only, and gives each reason some could not be checked one
   * line; "listed", the default, gives every requirement its line.
   */
  readonly holding?: "listed" | "counted";
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The requirements a studio's harness checked, if they are that; anything else is left out. */
export function checkedIn(value: unknown): {
  requirements?: readonly Checked[];
} {
  if (
    !Array.isArray(value) ||
    !value.every(
      (one) =>
        isRecord(one) &&
        typeof one["id"] === "string" &&
        (one["holds"] === null || typeof one["holds"] === "boolean") &&
        (one["measured"] === undefined ||
          typeof one["measured"] === "string") &&
        (one["margin"] === undefined ||
          (typeof one["margin"] === "number" &&
            Number.isFinite(one["margin"]))) &&
        (one["unit"] === undefined || typeof one["unit"] === "string") &&
        (one["why"] === undefined || typeof one["why"] === "string"),
    )
  )
    return {};
  return { requirements: value as Checked[] };
}

/** The requirements as they are kept for the next check of the same design, by id. */
export function keptOf(
  checked: readonly Checked[],
  says: Says,
): Record<string, Last> {
  return Object.fromEntries(
    checked.map((one) => [
      one.id,
      {
        holds: one.holds,
        ...(one.margin !== undefined ? { margin: one.margin } : {}),
        ...(one.unit !== undefined ? { unit: one.unit } : {}),
        ...(says[one.id] ? { says: says[one.id] as string } : {}),
      },
    ]),
  );
}

/** What was kept of the last check, with anything not a requirement's record left out. */
export function lastOf(kept: unknown): Readonly<Record<string, Last>> {
  return isRecord(kept)
    ? (Object.fromEntries(
        Object.entries(kept).filter(([, one]) => isRecord(one)),
      ) as Record<string, Last>)
    : {};
}

/** Whether a unit is written against its number: degrees, and a share such as "% of the frame". */
const against = (unit: string) => unit === "°" || unit.startsWith("%");

const withUnit = (value: number, unit: string) =>
  `${value}${against(unit) ? unit : ` ${unit}`}`;

const amount = (value: number, unit: string) =>
  withUnit(figures(Math.abs(value)), unit);

/**
 * The lines an answer gives the requirements checked, each margin beside the
 * last check's, then each requirement that failed in the last check of the
 * design and is no longer in the file.
 */
export function verdictLines(
  verdicts: Verdicts,
  checked: readonly Checked[],
  says: Says,
  last: Readonly<Record<string, Last>>,
): string[] {
  const measured = checked.filter((one) => one.holds !== null);
  const holding = measured.filter((one) => one.holds);
  const title = verdicts.title ?? `Requirements in ${verdicts.file}`;
  const since = verdicts.since ?? "the last build";
  const lines = checked.length
    ? [
        `${title}: ${holding.length} of ${measured.length} checked ${holding.length === 1 ? "holds" : "hold"}${measured.length < checked.length ? `, ${checked.length - measured.length} not checked` : ""}.`,
      ]
    : [];
  const counted = verdicts.holding === "counted";
  const unchecked = new Map<string, string[]>();
  for (const one of checked) {
    const named = says[one.id] ? `${one.id} (${says[one.id]})` : one.id;
    if (one.holds === null && counted) {
      const why = one.why ?? "it could not be measured";
      unchecked.set(why, [...(unchecked.get(why) ?? []), named]);
      continue;
    }
    if (one.holds && counted) continue;
    if (one.holds === null) {
      lines.push(
        `- ${named} not checked: ${one.why ?? "it could not be measured"}.`,
      );
      continue;
    }
    const unit = one.unit ?? "";
    const before = last[one.id]?.margin;
    const moved =
      one.margin !== undefined &&
      before !== undefined &&
      Math.abs(one.margin - before) >= 0.005
        ? `, its margin ${one.margin < before ? "down" : "up"} from ${figures(before)} to ${withUnit(figures(one.margin), unit)} since ${since}`
        : "";
    lines.push(
      `- ${named} ${one.holds ? "holds" : "fails"}${moved}: ${one.measured ?? ""}${marginWords(one)}.`,
    );
  }
  for (const [why, named] of unchecked)
    lines.push(`- ${named.join(", ")} not checked: ${why}.`);
  return [...lines, ...leftTheFile(verdicts, checked, last)];
}

/** A margin as the answer says it after the measure, with its leading "; ". */
function marginWords(one: Checked): string {
  if (one.margin === undefined) return "";
  const unit = one.unit ?? "";
  return one.margin >= 0
    ? `; ${amount(one.margin, unit)} to spare`
    : `; ${amount(one.margin, unit)} past the limit`;
}

/** Each requirement that failed in the last check and is no longer in the file. */
function leftTheFile(
  verdicts: Verdicts,
  checked: readonly Checked[],
  last: Readonly<Record<string, Last>>,
): string[] {
  const present = new Set(checked.map((one) => one.id));
  const since = verdicts.since ?? "the last build";
  const lines: string[] = [];
  for (const [id, before] of Object.entries(last)) {
    if (present.has(id) || before.holds !== false) continue;
    const named = before.says ? `${id} (${before.says})` : id;
    const past =
      typeof before.margin === "number" && before.margin < 0
        ? `, ${amount(before.margin, before.unit ?? "")} past its limit,`
        : "";
    lines.push(
      `${named} failed in ${since}${past} and is no longer in ${verdicts.file}.`,
    );
  }
  return lines;
}

/**
 * The requirements as the person is shown them: each one holding, failing
 * or not checked, with what was measured, and under the list any that
 * failed last time and have left the file. None when there is nothing to
 * show.
 */
export function verdictDetail(
  verdicts: Verdicts,
  checked: readonly Checked[],
  says: Says,
  last: Readonly<Record<string, Last>>,
): ActionDetail | undefined {
  const left = leftTheFile(verdicts, checked, last);
  if (!checked.length && !left.length) return undefined;
  return {
    kind: "checks",
    label: verdicts.title ?? `Requirements in ${verdicts.file}`,
    items: checked.map((one) => {
      const note =
        one.holds === null
          ? (one.why ?? "it could not be measured")
          : `${one.measured ?? ""}${marginWords(one)}`.replace(/^; /, "");
      return {
        label: says[one.id] ? `${one.id} · ${says[one.id]}` : one.id,
        holds: one.holds,
        ...(note ? { note } : {}),
      };
    }),
    ...(left.length ? { note: left.join(" ") } : {}),
  };
}
