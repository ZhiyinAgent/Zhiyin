/**
 * The difference between two versions of a file, by line, and by word inside
 * a line that was rewritten.
 *
 * A person reviewing a change is deciding whether to let it happen. Which
 * lines arrive and which go away answers most of it; but a line rewritten to
 * change one value reads as two near-identical lines, and the value is what
 * the person has to find. So a removed line and the added line that replaced
 * it have the words that differ marked, when enough of them is shared for
 * the two to be the same line rewritten.
 *
 * Unchanged runs are collapsed to a few lines of surrounding context, because
 * a one-line change in a thousand-line file is not reviewable as a
 * thousand-line list.
 *
 * Both comparisons cost what the change costs, not what the file holds: a
 * long file edited in a few places reads as those edits. The words of
 * rewritten lines are marked until a fixed amount of work is spent, after
 * which the remaining lines are shown whole.
 */

import { lineSteps } from "./line-steps.js";

export type DiffLine = {
  readonly kind: "same" | "added" | "removed";
  /** 1-based line number in the version this line belongs to. */
  readonly beforeLine?: number;
  readonly afterLine?: number;
  readonly text: string;
  /** The line in pieces, those that differ from the line it pairs with marked. */
  readonly parts?: readonly LinePart[];
};

type LinePart = { readonly text: string; readonly changed: boolean };

export type DiffSection =
  | { readonly kind: "lines"; readonly lines: readonly DiffLine[] }
  /** A run of unchanged lines that was left out, and how many. */
  | { readonly kind: "skipped"; readonly count: number };

export type DiffSummary = {
  readonly added: number;
  readonly removed: number;
  readonly sections: readonly DiffSection[];
};

/** Unchanged lines kept on each side of a change, so it can be placed. */
const context = 3;

function splitLines(text: string): string[] {
  // An empty file has no lines. Splitting it yields one empty string, which
  // would show a created file as replacing a blank line that was never there.
  if (text === "") return [];
  const lines = text.split(/\r?\n/);
  // A trailing newline ends the last line; it does not begin an empty one.
  if (lines.length > 1 && lines.at(-1) === "") lines.pop();
  return lines;
}

/** Longest common subsequence lengths, the usual table. */
function commonTable(before: readonly string[], after: readonly string[]) {
  const table = Array.from(
    { length: before.length + 1 },
    () => new Uint32Array(after.length + 1),
  );
  for (let i = before.length - 1; i >= 0; i -= 1) {
    const row = table[i]!;
    const next = table[i + 1]!;
    for (let j = after.length - 1; j >= 0; j -= 1) {
      row[j] =
        before[i] === after[j]
          ? next[j + 1]! + 1
          : Math.max(next[j]!, row[j + 1]!);
    }
  }
  return table;
}

/** Words, runs of space, and each other character on its own. */
const tokens = (text: string) =>
  text.match(/[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu) ?? [];

/** Past this many token pairs, a line is left whole rather than compared. */
const maximumComparedTokens = 40_000;

/** Token pairs, and characters split into tokens, one whole difference may spend marking rewritten lines. */
const rewriteWork = 2_000_000;

/** How much of the two lines must be shared for one to be the other rewritten. */
const sameLineShare = 0.5;

function pieces(
  words: readonly string[],
  kept: readonly boolean[],
): LinePart[] {
  const parts: LinePart[] = [];
  words.forEach((text, index) => {
    const changed = !kept[index];
    const last = parts.at(-1);
    if (last && last.changed === changed)
      parts[parts.length - 1] = { text: last.text + text, changed };
    else parts.push({ text, changed });
  });
  return parts;
}

/** The two lines in marked pieces, or nothing when they are not one line rewritten. */
function rewritten(
  before: string,
  after: string,
  budget: { left: number },
): { before: LinePart[]; after: LinePart[] } | undefined {
  // Splitting the lines costs their length, paid even when they turn out
  // not to be one line rewritten.
  budget.left -= before.length + after.length;
  const left = tokens(before);
  const right = tokens(after);
  const work = left.length * right.length;
  if (work > maximumComparedTokens || work > budget.left) return undefined;
  budget.left -= work;
  const table = commonTable(left, right);
  const keptLeft = left.map(() => false);
  const keptRight = right.map(() => false);
  let shared = 0;
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      keptLeft[i] = true;
      keptRight[j] = true;
      shared += left[i]!.trim().length;
      i += 1;
      j += 1;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) i += 1;
    else j += 1;
  }
  const visible = (before + after).replace(/\s+/g, "").length;
  if (visible === 0 || (2 * shared) / visible < sameLineShare) return undefined;
  return { before: pieces(left, keptLeft), after: pieces(right, keptRight) };
}

/** How many added lines ahead a removed line looks for the one it became. */
const pairingReach = 8;

/**
 * In each run of changed lines, each removed line is paired with the first
 * added line after the last pairing, within reach, that is it rewritten.
 */
function markRewrites(lines: readonly DiffLine[]): DiffLine[] {
  const marked = [...lines];
  const budget = { left: rewriteWork };
  let start = 0;
  while (start < marked.length) {
    if (marked[start]!.kind === "same") {
      start += 1;
      continue;
    }
    let end = start;
    while (end < marked.length && marked[end]!.kind !== "same") end += 1;
    const run = Array.from({ length: end - start }, (_, k) => start + k);
    const removed = run.filter((index) => marked[index]!.kind === "removed");
    const added = run.filter((index) => marked[index]!.kind === "added");
    let next = 0;
    for (const gone of removed) {
      if (budget.left <= 0) return marked;
      for (
        let k = next;
        k < Math.min(added.length, next + pairingReach);
        k += 1
      ) {
        const arrived = added[k]!;
        const parts = rewritten(
          marked[gone]!.text,
          marked[arrived]!.text,
          budget,
        );
        if (!parts) continue;
        marked[gone] = { ...marked[gone]!, parts: parts.before };
        marked[arrived] = { ...marked[arrived]!, parts: parts.after };
        next = k + 1;
        break;
      }
    }
    start = end;
  }
  return marked;
}

function collapse(lines: readonly DiffLine[]): DiffSection[] {
  const changed = lines.map((line) => line.kind !== "same");
  const keep = lines.map((_line, index) =>
    changed
      .slice(Math.max(0, index - context), index + context + 1)
      .some(Boolean),
  );
  const sections: DiffSection[] = [];
  let run: DiffLine[] = [];
  let skipped = 0;
  const flushLines = () => {
    if (run.length) sections.push({ kind: "lines", lines: run });
    run = [];
  };
  const flushSkipped = () => {
    if (skipped) sections.push({ kind: "skipped", count: skipped });
    skipped = 0;
  };
  lines.forEach((line, index) => {
    if (keep[index]) {
      flushSkipped();
      run.push(line);
    } else {
      flushLines();
      skipped += 1;
    }
  });
  flushLines();
  flushSkipped();
  return sections;
}

/** Each line once, numbered by its place in the version it belongs to. */
function compared(
  before: readonly string[],
  after: readonly string[],
): DiffLine[] {
  return lineSteps(before, after).map((step): DiffLine =>
    step.kind === "same"
      ? {
          kind: "same",
          beforeLine: step.before + 1,
          afterLine: step.after + 1,
          text: before[step.before]!,
        }
      : step.kind === "removed"
        ? {
            kind: "removed",
            beforeLine: step.before + 1,
            text: before[step.before]!,
          }
        : {
            kind: "added",
            afterLine: step.after + 1,
            text: after[step.after]!,
          },
  );
}

export function diffLines(before: string, after: string): DiffSummary {
  const lines = markRewrites(compared(splitLines(before), splitLines(after)));
  return {
    added: lines.filter((line) => line.kind === "added").length,
    removed: lines.filter((line) => line.kind === "removed").length,
    sections: collapse(lines),
  };
}
