/**
 * What changed on a folder's drive since a point, read from the NTFS change
 * journal through a handle on the folder, without administrator rights.
 * Windows hides the names in what it gives a person who is not an
 * administrator, so changes are known by file identity: the 64-bit file
 * reference number that `fs.stat` gives as `ino`.
 */

import koffi from "koffi";

/** Where the journal stood: which journal, and the next record it would write. */
export type JournalPoint = {
  /** The journal's identity, as a decimal string; a new one means the journal was reset. */
  readonly journal: string;
  /** The next update sequence number, as a decimal string. */
  readonly next: string;
};

/** The changes to files of interest since a point. */
export type JournalChanges =
  | {
      readonly ok: true;
      /** Each file of interest that changed, with every reason Windows gave, ORed. */
      readonly changed: ReadonlyMap<string, number>;
      /** Each file not of interest made, moved or renamed into a folder of interest, by that folder. */
      readonly arrived: ReadonlyMap<string, string>;
      /** Each file of interest renamed or moved, by the folder it is in now. */
      readonly moved: ReadonlyMap<string, string>;
      /**
       * Each entry of interest, or in a folder of interest, that is a
       * junction, a symbolic link or another reparse point, or became or
       * stopped being one, by the folder it is in.
       */
      readonly reparse: ReadonlyMap<string, string>;
      readonly next: JournalPoint;
    }
  | {
      readonly ok: false;
      /** The journal was reset or wrapped past the point, or cannot be read. */
      readonly reason: "reset" | "unavailable";
    };

/** The reasons that say a file's contents, name or place changed. */
export const contentReasons =
  0x1 | // data overwritten
  0x2 | // data extended
  0x4 | // data truncated
  0x10 | // a named stream overwritten
  0x20 | // a named stream extended
  0x40 | // a named stream truncated
  0x100 | // created
  0x200 | // deleted
  0x1000 | // renamed: old name
  0x2000 | // renamed: new name
  0x10000 | // a hard link added or removed
  0x200000; // a stream added, removed or renamed

const USN_REASON_RENAME_NEW_NAME = 0x2000;
const USN_REASON_REPARSE_POINT_CHANGE = 0x100000;
const FILE_ATTRIBUTE_REPARSE_POINT = 0x400;
const FILE_READ_ATTRIBUTES = 0x80;
const FILE_SHARE_ALL = 0x7;
const OPEN_EXISTING = 3;
const FILE_FLAG_BACKUP_SEMANTICS = 0x02000000;
const FSCTL_QUERY_USN_JOURNAL = 0x000900f4;
const FSCTL_READ_UNPRIVILEGED_USN_JOURNAL = 0x000903ab;
const ERROR_HANDLE_EOF = 38;

type Kernel = {
  readonly open: (path: string) => unknown;
  readonly close: (handle: unknown) => void;
  readonly control: (
    handle: unknown,
    code: number,
    input: Buffer | null,
    output: Buffer,
  ) => { readonly bytes: number } | { readonly error: number };
};

let loaded: Kernel | undefined;

function kernel(): Kernel {
  if (loaded) return loaded;
  const kernel32 = koffi.load("kernel32.dll");
  const CreateFileW = kernel32.func(
    "void* CreateFileW(const char16_t*, uint32, uint32, void*, uint32, uint32, void*)",
  );
  const CloseHandle = kernel32.func("bool CloseHandle(void*)");
  const GetLastError = kernel32.func("uint32 GetLastError()");
  const DeviceIoControl = kernel32.func(
    "bool DeviceIoControl(void*, uint32, void*, uint32, void*, uint32, _Out_ uint32*, void*)",
  );
  loaded = {
    open(path) {
      const handle = CreateFileW(
        path,
        FILE_READ_ATTRIBUTES,
        FILE_SHARE_ALL,
        null,
        OPEN_EXISTING,
        FILE_FLAG_BACKUP_SEMANTICS,
        null,
      );
      return !handle || koffi.address(handle) === BigInt.asUintN(64, -1n)
        ? undefined
        : handle;
    },
    close: (handle) => void CloseHandle(handle),
    control(handle, code, input, output) {
      const returned = [0];
      const done = DeviceIoControl(
        handle,
        code,
        input,
        input?.length ?? 0,
        output,
        output.length,
        returned,
        null,
      );
      return done
        ? { bytes: returned[0] ?? 0 }
        : { error: GetLastError() as number };
    },
  };
  return loaded;
}

type Journal = {
  readonly id: bigint;
  readonly first: bigint;
  readonly next: bigint;
};

function query(handle: unknown): Journal | undefined {
  const output = Buffer.alloc(80);
  const answer = kernel().control(
    handle,
    FSCTL_QUERY_USN_JOURNAL,
    null,
    output,
  );
  if ("error" in answer) return undefined;
  return {
    id: output.readBigUInt64LE(0),
    first: output.readBigInt64LE(8),
    next: output.readBigInt64LE(16),
  };
}

function withFolder<T>(
  folder: string,
  use: (handle: unknown) => T,
): T | undefined {
  if (process.platform !== "win32") return undefined;
  const handle = kernel().open(folder);
  if (!handle) return undefined;
  try {
    return use(handle);
  } finally {
    kernel().close(handle);
  }
}

/** Where the journal of the folder's drive stands now, or nothing when it keeps none. */
export function journalPoint(folder: string): JournalPoint | undefined {
  return withFolder(folder, (handle) => {
    const journal = query(handle);
    return journal
      ? { journal: String(journal.id), next: String(journal.next) }
      : undefined;
  });
}

/**
 * The changes since `since` to the files and folders `interest` names by
 * identity. A change to a folder of interest's contents, a file made or moved
 * into it, is answered by that folder.
 */
export function journalChanges(
  folder: string,
  since: JournalPoint,
  interest: ReadonlySet<string>,
): JournalChanges {
  const answer = withFolder(folder, (handle): JournalChanges => {
    const journal = query(handle);
    if (!journal) return { ok: false, reason: "unavailable" };
    const start = BigInt(since.next);
    if (String(journal.id) !== since.journal || start < journal.first)
      return { ok: false, reason: "reset" };
    const changed = new Map<string, number>();
    const arrived = new Map<string, string>();
    const moved = new Map<string, string>();
    const reparse = new Map<string, string>();
    const output = Buffer.alloc(1 << 20);
    const input = Buffer.alloc(40);
    let from = start;
    while (from < journal.next) {
      input.fill(0);
      input.writeBigInt64LE(from, 0);
      input.writeUInt32LE(0xffffffff, 8);
      input.writeBigUInt64LE(journal.id, 32);
      const read = kernel().control(
        handle,
        FSCTL_READ_UNPRIVILEGED_USN_JOURNAL,
        input,
        output,
      );
      if ("error" in read) {
        if (read.error === ERROR_HANDLE_EOF) break;
        return { ok: false, reason: "reset" };
      }
      if (read.bytes <= 8) break;
      const after = output.readBigInt64LE(0);
      for (let at = 8; at < read.bytes;) {
        const length = output.readUInt32LE(at);
        if (!length) break;
        if (output.readUInt16LE(at + 4) === 2) {
          const file = String(output.readBigUInt64LE(at + 8));
          const parent = String(output.readBigUInt64LE(at + 16));
          const reason = output.readUInt32LE(at + 40);
          const attributes = output.readUInt32LE(at + 52);
          if (interest.has(file)) {
            changed.set(file, (changed.get(file) ?? 0) | reason);
            if (reason & USN_REASON_RENAME_NEW_NAME) moved.set(file, parent);
          } else if (interest.has(parent) && reason & contentReasons)
            arrived.set(file, parent);
          if (
            (interest.has(file) || interest.has(parent)) &&
            (reason & USN_REASON_REPARSE_POINT_CHANGE ||
              attributes & FILE_ATTRIBUTE_REPARSE_POINT)
          )
            reparse.set(file, parent);
        }
        at += length;
      }
      if (after <= from) break;
      from = after;
    }
    return {
      ok: true,
      changed,
      arrived,
      moved,
      reparse,
      next: {
        journal: String(journal.id),
        next: String(from > journal.next ? from : journal.next),
      },
    };
  });
  return answer ?? { ok: false, reason: "unavailable" };
}
