/**
 * Every format the history has been saved in since the first release, and how
 * each one becomes the next. ADR 0022.
 *
 * This is the one place a change to what the history holds is registered. A
 * change an earlier release could not read adds a step at the end of the list,
 * with a test that reads history saved in the format before it. Nothing else
 * reads an earlier format: a file is brought to the current one first.
 */

import { isRecord } from "./saved-values.js";

/** How one format becomes the next. A part it leaves out is unchanged. */
export type Migration = {
  readonly settings?: (
    settings: Record<string, unknown>,
  ) => Record<string, unknown>;
  /** A conversation's whole state, as its log holds it. */
  readonly conversation?: (state: unknown) => unknown;
};

export type Formats = {
  /** The format the first release wrote. */
  readonly first: number;
  /** Step `i` turns format `first + i` into the next one. */
  readonly steps: readonly Migration[];
};

/** The history's formats. Format 3 is the first release's. */
export const formats: Formats = { first: 3, steps: [] };

export function currentFormat(known: Formats): number {
  return known.first + known.steps.length;
}

/**
 * What every history file says about itself, under the same names in every
 * format, so any version can tell what a file is before reading the rest.
 */
export type FileFormat = {
  readonly format: number;
  /** The version of Zhiyin that wrote the file. */
  readonly writtenBy: string;
};

export function formatOf(value: unknown): FileFormat | undefined {
  return isRecord(value) &&
    Number.isInteger(value.format) &&
    typeof value.writtenBy === "string"
    ? { format: value.format as number, writtenBy: value.writtenBy }
    : undefined;
}

/**
 * How a file stands against this version: one it reads, one a step brings to
 * the current format, one a newer version wrote, or one it cannot place.
 */
export function standingOf(
  known: Formats,
  format: FileFormat | undefined,
): "current" | "older" | "newer" | "unknown" {
  if (!format) return "unknown";
  const current = currentFormat(known);
  if (format.format === current) return "current";
  if (format.format > current) return "newer";
  return format.format >= known.first ? "older" : "unknown";
}

/** Settings saved in format `from`, as the current format holds them. */
export function migratedSettings(
  known: Formats,
  settings: Record<string, unknown>,
  from: number,
): Record<string, unknown> {
  let result = settings;
  for (const step of known.steps.slice(from - known.first)) {
    if (!step.settings) continue;
    result = step.settings(result);
    if (!isRecord(result))
      throw new Error("A step did not answer with settings.");
  }
  return result;
}

/** A conversation saved in format `from`, as the current format holds it. */
export function migratedConversation(
  known: Formats,
  state: unknown,
  from: number,
): unknown {
  let result = state;
  for (const step of known.steps.slice(from - known.first))
    if (step.conversation) result = step.conversation(result);
  return result;
}
