/**
 * What a change looks like to the person asked to approve it.
 *
 * A tool that knows both sides of a change reports both sides, and the
 * interface shows the difference. The alternative — showing the call that
 * would produce it — asks someone to approve a change by reading a JSON
 * argument, which is not review.
 *
 * Carrying an arbitrarily large file into an approval request would make the
 * request slow to deliver, so past a bound the two versions are replaced by
 * the difference: the lines that change, with a few around each. Only a change
 * that is itself past the bound is left out, with the reason named. An
 * approval given without it is an approval given without seeing the change,
 * and the interface must be able to say so.
 */

import { diffLines, type DiffSummary, type FileChange } from "@zhiyin/contract";

/** Both sides together, or the lines a difference shows. Roughly a large source file, not a data dump. */
const maximumChangeCharacters = 256 * 1024;

/**
 * About as many characters as a difference takes to carry: each line shown,
 * its marked pieces, and the few dozen its kind and numbers take.
 */
const perLine = 64;

function carried(diff: DiffSummary): number {
  let total = 0;
  for (const section of diff.sections)
    if (section.kind === "lines")
      for (const line of section.lines)
        total += perLine + line.text.length * (line.parts ? 2 : 1);
  return total;
}

export function describeChange(
  path: string,
  change: "created" | "updated",
  after: string,
  before?: string,
): FileChange {
  if ((before?.length ?? 0) + after.length > maximumChangeCharacters) {
    // A new file's difference is every line of it, larger still.
    if (before === undefined)
      return {
        path,
        change,
        omitted: "This change is too large to show here.",
      };
    const diff = diffLines(before, after);
    return carried(diff) > maximumChangeCharacters
      ? { path, change, omitted: "This change is too large to show here." }
      : { path, change, diff };
  }
  return {
    path,
    change,
    ...(before === undefined ? {} : { before }),
    after,
  };
}
