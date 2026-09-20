/**
 * The difference between two versions of a file, by line.
 *
 * Line-level and nothing finer. A person reviewing a change is deciding
 * whether to let it happen, and the question they are answering is which lines
 * are being added and which are going away. Character-level highlighting would
 * be prettier and would not change that answer.
 *
 * Unchanged runs are collapsed to a few lines of surrounding context, because
 * a one-line change in a thousand-line file is not reviewable as a
 * thousand-line list.
 */

export type DiffLine = {
  readonly kind: "same" | "added" | "removed";
  /** 1-based line number in the version this line belongs to. */
  readonly beforeLine?: number;
  readonly afterLine?: number;
  readonly text: string;
};

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

/**
 * A cap on the pairwise table below. Past it the two versions are reported as
 * wholly replaced rather than spending seconds diffing: a diff nobody waits
 * for is worth less than an honest coarse answer.
 */
const maximumComparedLines = 4000;

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

function walk(before: readonly string[], after: readonly string[]): DiffLine[] {
  const table = commonTable(before, after);
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      lines.push({
        kind: "same",
        beforeLine: i + 1,
        afterLine: j + 1,
        text: before[i]!,
      });
      i += 1;
      j += 1;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      lines.push({ kind: "removed", beforeLine: i + 1, text: before[i]! });
      i += 1;
    } else {
      lines.push({ kind: "added", afterLine: j + 1, text: after[j]! });
      j += 1;
    }
  }
  for (; i < before.length; i += 1)
    lines.push({ kind: "removed", beforeLine: i + 1, text: before[i]! });
  for (; j < after.length; j += 1)
    lines.push({ kind: "added", afterLine: j + 1, text: after[j]! });
  return lines;
}

function wholesale(
  before: readonly string[],
  after: readonly string[],
): DiffLine[] {
  return [
    ...before.map((text, index): DiffLine => ({
      kind: "removed",
      beforeLine: index + 1,
      text,
    })),
    ...after.map((text, index): DiffLine => ({
      kind: "added",
      afterLine: index + 1,
      text,
    })),
  ];
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

export function diffLines(before: string, after: string): DiffSummary {
  const left = splitLines(before);
  const right = splitLines(after);
  const lines =
    left.length + right.length > maximumComparedLines
      ? wholesale(left, right)
      : walk(left, right);
  return {
    added: lines.filter((line) => line.kind === "added").length,
    removed: lines.filter((line) => line.kind === "removed").length,
    sections: collapse(lines),
  };
}
