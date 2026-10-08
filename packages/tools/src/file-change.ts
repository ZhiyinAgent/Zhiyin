/**
 * What a change looks like to the person asked to approve it.
 *
 * A tool that knows both sides of a change reports both sides, and the
 * interface shows the difference. The alternative — showing the call that
 * would produce it — asks someone to approve a change by reading a JSON
 * argument, which is not review.
 *
 * Carrying an arbitrarily large file into an approval request would make the
 * request slow to deliver and impossible to read, so past a bound the contents
 * are left out and the reason is named. An approval given without them is an
 * approval given without seeing the change, and the interface must be able to
 * say so.
 */

import type { FileChange } from "@zhiyin/contract";

/** Both sides together. Roughly a large source file, not a data dump. */
const maximumChangeCharacters = 256 * 1024;

export function describeChange(
  path: string,
  change: "created" | "updated",
  after: string,
  before?: string,
): FileChange {
  if ((before?.length ?? 0) + after.length > maximumChangeCharacters) {
    return {
      path,
      change,
      omitted: "This change is too large to show here.",
    };
  }
  return {
    path,
    change,
    ...(before === undefined ? {} : { before }),
    after,
  };
}
