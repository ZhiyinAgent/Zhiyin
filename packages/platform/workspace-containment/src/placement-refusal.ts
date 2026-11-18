/**
 * What a placement that cannot be written becomes: the reason, said once for
 * every feature that writes a file a call names, and whether the model can
 * correct it with a better call, so it is answered to the model alone
 * (ADR 0009).
 */

import { isAbsolute } from "node:path";
import type { Placed, PlacedOutside } from "./workspace-containment.js";

/** A placement answer that is not a place to write. */
export type Unplaced = Exclude<
  Placed["kind"] | PlacedOutside["kind"],
  "writable"
>;

export type PlacementRefusal = {
  readonly reason: string;
  /**
   * Whether a better call can fix it. A path that leaves the workspace, or
   * leads through a link whose target is missing, is the person's to see;
   * a name Windows cannot give a file, a path that is not whole, and a place
   * in Zhiyin's own folders are the model's to correct.
   */
  readonly correctable: boolean;
};

/** Why `path`, placed as `kind`, is not written. */
export function placementRefusal(
  path: string,
  kind: Unplaced,
): PlacementRefusal {
  switch (kind) {
    case "outside":
      return {
        reason: `${path} is outside the workspace.`,
        correctable: false,
      };
    case "link":
      return {
        reason: `${path} leads through a link whose target is missing, so where it would be written is not known.`,
        correctable: false,
      };
    case "protected":
      return {
        reason: `${path} is in a folder Zhiyin keeps for itself, which no tool writes. Choose another place for the file.`,
        correctable: true,
      };
    case "reserved":
      return {
        reason: `${path} is named as Windows names a device, such as NUL or CON, which no file can be. Give the file another name.`,
        correctable: true,
      };
    case "colon":
      return {
        reason: isAbsolute(path)
          ? `${path} has a ":" past its drive. Name the file without one.`
          : `${path} has a ":" in it. Name the file by a workspace-relative path without one.`,
        correctable: true,
      };
    case "not-absolute":
      return {
        reason: `${path} is not a whole path: give its drive, as C:\\folder\\file, or a workspace path.`,
        correctable: true,
      };
  }
}
