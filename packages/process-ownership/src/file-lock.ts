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

import koffi from "koffi";

const GENERIC_READ = 0x80000000;
const GENERIC_WRITE = 0x40000000;
const DELETE = 0x00010000;
const FILE_SHARE_DELETE = 0x00000004;
const CREATE_ALWAYS = 2;
const FILE_FLAG_DELETE_ON_CLOSE = 0x04000000;
const ERROR_SHARING_VIOLATION = 32;
const invalidHandle = BigInt.asUintN(64, -1n);

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

type Files = {
  readonly open: (path: string) => { handle: unknown; error: number };
  readonly close: (handle: unknown) => void;
};

let files: Files | undefined;

function win32(): Files {
  if (files) return files;
  const kernel32 = koffi.load("kernel32.dll");
  const CreateFileW = kernel32.func(
    "void* CreateFileW(const char16_t*, uint32, uint32, void*, uint32, uint32, void*)",
  );
  const GetLastError = kernel32.func("uint32 GetLastError()");
  const CloseHandle = kernel32.func("bool CloseHandle(void*)");
  files = {
    open: (path) => {
      const handle: unknown = CreateFileW(
        path,
        GENERIC_READ | GENERIC_WRITE | DELETE,
        FILE_SHARE_DELETE,
        null,
        CREATE_ALWAYS,
        FILE_FLAG_DELETE_ON_CLOSE,
        null,
      );
      const error = GetLastError() as number;
      return !handle || koffi.address(handle) === invalidHandle
        ? { handle: undefined, error }
        : { handle, error: 0 };
    },
    close: (handle) => {
      CloseHandle(handle);
    },
  };
  return files;
}

/** Windows only; elsewhere every attempt is `unavailable`. */
export function holdExclusively(path: string): HoldAttempt {
  if (process.platform !== "win32") return { refused: "unavailable" };
  const api = win32();
  const { handle, error } = api.open(path);
  if (!handle)
    return {
      refused:
        error === ERROR_SHARING_VIOLATION ? "held-elsewhere" : "unavailable",
    };
  let open = true;
  return {
    held: {
      release() {
        if (!open) return;
        open = false;
        api.close(handle);
      },
    },
  };
}
