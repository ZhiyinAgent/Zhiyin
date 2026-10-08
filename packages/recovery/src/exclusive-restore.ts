/**
 * Putting one file back, or removing it, while nothing else can write to it.
 *
 * The file is opened so that others may still read it but no one may write
 * to it; its digest is checked on that handle, and the retained copy is
 * swapped in (or the file deleted) while the handle is still held. A file
 * changed after the review, or held open for writing by another program, is
 * left exactly as it is. A file the work deleted is made again, folder and
 * all, only while nothing has taken its place.
 *
 * The Windows calls are made from Zhiyin's own process. A PowerShell script
 * would often take longer to start on an ordinary laptop than a restore is
 * allowed, and rewind would report restorable files as unrestorable.
 */

import koffi from "koffi";
import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";

const GENERIC_READ = 0x80000000;
const FILE_SHARE_READ = 0x00000001;
const FILE_SHARE_DELETE = 0x00000004;
const OPEN_EXISTING = 3;
const FILE_ATTRIBUTE_NORMAL = 0x00000080;
const MOVEFILE_WRITE_THROUGH = 0x00000008;
const chunkBytes = 1024 * 1024;

export type ExclusiveRestore = {
  readonly absolute: string;
  /** The digest the file must still have, or the restore is refused. */
  readonly expected: string;
  readonly action: "restore" | "remove";
  readonly backup?: string;
};

type Files = {
  readonly openShared: (path: string) => unknown;
  readonly read: (handle: unknown, buffer: Buffer) => number;
  readonly close: (handle: unknown) => void;
  readonly replace: (
    target: string,
    replacement: string,
    previous: string,
  ) => boolean;
  readonly remove: (path: string) => boolean;
  /** Moves a file into place, and fails if anything is already there. */
  readonly moveIntoPlace: (from: string, to: string) => boolean;
};

let files: Files | undefined;

function win32(): Files {
  if (files) return files;
  const kernel32 = koffi.load("kernel32.dll");
  const CreateFileW = kernel32.func(
    "void* CreateFileW(const char16_t*, uint32, uint32, void*, uint32, uint32, void*)",
  );
  const ReadFile = kernel32.func(
    "bool ReadFile(void*, void*, uint32, _Out_ uint32*, void*)",
  );
  const CloseHandle = kernel32.func("bool CloseHandle(void*)");
  const ReplaceFileW = kernel32.func(
    "bool ReplaceFileW(const char16_t*, const char16_t*, const char16_t*, uint32, void*, void*)",
  );
  const DeleteFileW = kernel32.func("bool DeleteFileW(const char16_t*)");
  const MoveFileExW = kernel32.func(
    "bool MoveFileExW(const char16_t*, const char16_t*, uint32)",
  );
  files = {
    openShared: (path) => {
      const handle: unknown = CreateFileW(
        path,
        GENERIC_READ,
        FILE_SHARE_READ | FILE_SHARE_DELETE,
        null,
        OPEN_EXISTING,
        FILE_ATTRIBUTE_NORMAL,
        null,
      );
      const invalid =
        !handle || koffi.address(handle) === BigInt.asUintN(64, -1n);
      return invalid ? undefined : handle;
    },
    read: (handle, buffer) => {
      const read = [0];
      if (!ReadFile(handle, buffer, buffer.length, read, null))
        throw new Error("The file could not be read.");
      return read[0] ?? 0;
    },
    close: (handle) => {
      CloseHandle(handle);
    },
    replace: (target, replacement, previous) =>
      ReplaceFileW(target, replacement, previous, 0, null, null),
    remove: (path) => DeleteFileW(path),
    moveIntoPlace: (from, to) => MoveFileExW(from, to, MOVEFILE_WRITE_THROUGH),
  };
  return files;
}

function digestOf(api: Files, handle: unknown): string {
  const hash = createHash("sha256");
  const buffer = Buffer.alloc(chunkBytes);
  for (;;) {
    const read = api.read(handle, buffer);
    if (!read) break;
    hash.update(buffer.subarray(0, read));
  }
  return hash.digest("hex");
}

export async function restoreExclusively(
  target: ExclusiveRestore,
): Promise<void> {
  if (process.platform !== "win32")
    throw new Error("Exclusive recovery is unavailable on this platform.");
  const api = win32();
  let temporary: string | undefined;
  let previous: string | undefined;
  try {
    if (target.action === "restore") {
      if (!target.backup)
        throw new Error("The retained bytes are unavailable.");
      temporary = `${target.absolute}.${randomUUID().replaceAll("-", "")}.restore`;
      await copyFile(target.backup, temporary);
    }
    const handle = api.openShared(target.absolute);
    if (!handle)
      throw new Error("The file is in use and could not be held for recovery.");
    try {
      if (digestOf(api, handle) !== target.expected)
        throw new Error("The file changed while recovery was being applied.");
      if (target.action === "remove") {
        if (!api.remove(target.absolute))
          throw new Error("The file could not be removed.");
      } else {
        previous = `${target.absolute}.${randomUUID().replaceAll("-", "")}.previous`;
        if (!api.replace(target.absolute, temporary as string, previous))
          throw new Error("The retained bytes could not be put in place.");
        temporary = undefined;
      }
    } finally {
      api.close(handle);
    }
  } finally {
    if (temporary) await rm(temporary, { force: true });
    if (previous) await rm(previous, { force: true });
  }
}

/** Makes a deleted file again from its retained copy, unless one is back. */
export async function recreateExclusively(target: {
  readonly absolute: string;
  readonly backup: string;
}): Promise<void> {
  if (process.platform !== "win32")
    throw new Error("Exclusive recovery is unavailable on this platform.");
  const api = win32();
  await mkdir(dirname(target.absolute), { recursive: true });
  let temporary: string | undefined =
    `${target.absolute}.${randomUUID().replaceAll("-", "")}.restore`;
  try {
    await copyFile(target.backup, temporary);
    if (!api.moveIntoPlace(temporary, target.absolute))
      throw new Error("Something took the deleted file's place.");
    temporary = undefined;
  } finally {
    if (temporary) await rm(temporary, { force: true });
  }
}
