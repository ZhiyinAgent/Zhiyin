/**
 * Renaming over a file that is open, through Windows' own call.
 *
 * Node's rename (MoveFileExW) fails while any program has the file being
 * replaced open, even one that lets others delete it, as a reader, an indexer
 * or a virus scanner does. Asked with POSIX semantics, Windows replaces such a
 * file at once: whoever had it open goes on reading what they opened, and the
 * next open finds the new file.
 */

import { toNamespacedPath } from "node:path";
import koffi from "koffi";

/**
 * `replaced`, `held` when a program holds the file without letting it be
 * replaced, or `other` for anything else, which the caller leaves to Node's
 * rename to report.
 */
export type WindowsRename = "replaced" | "held" | "other";

const deleteAccess = 0x00010000;
const shareAll = 0x7;
const openExisting = 3;
const fileRenameInfoEx = 22;
const replaceIfExists = 0x1;
const posixSemantics = 0x2;
const sharingViolation = 32;
/** The fixed part of FILE_RENAME_INFO on 64-bit Windows, name excluded. */
const renameInfoBytes = 24;
const fileNameOffset = 20;
const fileNameLengthOffset = 16;

type Kernel = {
  readonly createFile: (...args: unknown[]) => unknown;
  readonly setInformation: (...args: unknown[]) => number;
  readonly close: (handle: unknown) => number;
  readonly lastError: () => number;
};

let kernel: Kernel | undefined;

function kernel32(): Kernel {
  if (!kernel) {
    const library = koffi.load("kernel32.dll");
    kernel = {
      createFile: library.func(
        "void* __stdcall CreateFileW(const char16_t*, uint32, uint32, void*, uint32, uint32, void*)",
      ),
      setInformation: library.func(
        "int __stdcall SetFileInformationByHandle(void*, int, void*, uint32)",
      ),
      close: library.func("int __stdcall CloseHandle(void*)"),
      lastError: library.func("uint32 __stdcall GetLastError()"),
    };
  }
  return kernel;
}

export function renameReplacingOpenFile(
  from: string,
  to: string,
): WindowsRename {
  const calls = kernel32();
  // Paths past Windows' old length limit reach the call only in this form.
  const handle = calls.createFile(
    toNamespacedPath(from),
    deleteAccess,
    shareAll,
    null,
    openExisting,
    0,
    null,
  );
  if (koffi.address(handle) === BigInt.asUintN(64, -1n)) return "other";
  try {
    const name = Buffer.from(toNamespacedPath(to), "utf16le");
    // The name is followed by a terminating character the length leaves out.
    const info = Buffer.alloc(renameInfoBytes + name.length + 2);
    info.writeUInt32LE(replaceIfExists | posixSemantics, 0);
    info.writeUInt32LE(name.length, fileNameLengthOffset);
    name.copy(info, fileNameOffset);
    if (calls.setInformation(handle, fileRenameInfoEx, info, info.length) !== 0)
      return "replaced";
    return calls.lastError() === sharingViolation ? "held" : "other";
  } finally {
    calls.close(handle);
  }
}
