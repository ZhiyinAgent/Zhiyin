/**
 * A file only one holder can have open, let go of by the operating system.
 *
 * The file is opened sharing nothing but deletion, so any second open fails
 * with a sharing violation, and marked to be deleted when its last handle
 * closes. Deletion is shared so that the folder holding it can still be
 * removed; a second holder cannot open it either way, and only a file someone
 * deleted by hand could be created afresh beside a running holder.
 * When the holder is gone, however it went, Windows closes its handles and the
 * file goes with them. A lock that records a process id instead can outlive
 * its holder, and a reused id can make a dead holder look alive; this one has
 * nothing to go stale.
 */

import { windowsFiles } from "@zhiyin/sandbox";

const GENERIC_READ = 0x80000000;
const GENERIC_WRITE = 0x40000000;
const DELETE = 0x00010000;
const FILE_SHARE_DELETE = 0x00000004;
const CREATE_ALWAYS = 2;
const FILE_FLAG_DELETE_ON_CLOSE = 0x04000000;
const ERROR_SHARING_VIOLATION = 32;

export type HeldFile = {
  /** Closes the file, which deletes it. Harmless more than once. */
  release(): void;
};

export type HoldAttempt =
  | { readonly held: HeldFile }
  /**
   * `held-elsewhere` only when another holder has it open. Anything else —
   * a missing folder, no permission — is `unavailable`, so a caller never
   * says another copy is running when none is.
   */
  | { readonly refused: "held-elsewhere" | "unavailable" };

export function holdExclusively(path: string): HoldAttempt {
  const files = windowsFiles();
  const opened = files.open(
    path,
    GENERIC_READ | GENERIC_WRITE | DELETE,
    FILE_SHARE_DELETE,
    CREATE_ALWAYS,
    FILE_FLAG_DELETE_ON_CLOSE,
  );
  if (!("handle" in opened) || opened.handle === undefined)
    return {
      refused:
        "error" in opened && opened.error === ERROR_SHARING_VIOLATION
          ? "held-elsewhere"
          : "unavailable",
    };
  const handle = opened.handle;
  let open = true;
  return {
    held: {
      release() {
        if (!open) return;
        open = false;
        files.close(handle);
      },
    },
  };
}
