/**
 * Whether a file approved to be written still goes where it was approved,
 * placed again just before it is delivered: a long run gives another call
 * time to make a file there, or a link in its folder, that nobody approved.
 */

import { placeForWriting, placeOutside } from "./workspace-containment.js";

/** Where an approval placed a file. */
export type ApprovedPlace = {
  /** Where it really goes, with links resolved. */
  readonly absolute: string;
  /** Its path from the workspace; outside, its whole path. */
  readonly relative: string;
  /** Whether a file was there to be replaced. */
  readonly exists: boolean;
  /** Outside the workspace, approved by its real path. */
  readonly outside?: true;
};

/**
 * `same` when the path still reaches the approved place by the same rule, in
 * the workspace or outside it as approved; `moved` when it reaches another,
 * or none; `appeared` when a file is there now where none was approved.
 */
export async function placedAgain(
  root: string,
  approved: ApprovedPlace,
  protect: readonly string[] = [],
): Promise<"same" | "moved" | "appeared"> {
  const now = approved.outside
    ? await placeOutside(root, approved.absolute, { protect })
    : await placeForWriting(root, approved.relative);
  if (
    now.kind !== "writable" ||
    now.absolute !== approved.absolute ||
    (approved.outside && "inside" in now && now.inside)
  )
    return "moved";
  return now.exists && !approved.exists ? "appeared" : "same";
}
