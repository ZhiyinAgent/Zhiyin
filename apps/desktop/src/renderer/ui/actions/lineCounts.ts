/**
 * How many lines a file change adds and removes. Comparing a large file takes
 * a tenth of a second, and the window draws again every 40 ms while an answer
 * streams, so each count is worked out once: the window keeps each change it
 * was sent as the same object across updates.
 */

import { diffLines, type FileChange } from "@zhiyin/contract";

export type LineCounts = { readonly added: number; readonly removed: number };

const counted = new WeakMap<
  FileChange,
  WeakMap<FileChange, LineCounts | null>
>();

/**
 * The lines `change` adds and removes, or nothing when its contents are not
 * known. A change shown from one recorded change to another is counted once
 * for that pair, `first` and `last`.
 */
export function lineCounts(
  change: FileChange,
  first: FileChange = change,
  last: FileChange = change,
): LineCounts | undefined {
  if (change.diff) return change.diff;
  let byFirst = counted.get(last);
  if (!byFirst) {
    byFirst = new WeakMap();
    counted.set(last, byFirst);
  }
  let counts = byFirst.get(first);
  if (counts === undefined) {
    counts =
      change.after !== undefined &&
      (change.before !== undefined || change.change === "created")
        ? countsOf(diffLines(change.before ?? "", change.after))
        : null;
    byFirst.set(first, counts);
  }
  return counts ?? undefined;
}

/** Only the counts are kept, not the lines compared. */
function countsOf({ added, removed }: LineCounts): LineCounts {
  return { added, removed };
}
