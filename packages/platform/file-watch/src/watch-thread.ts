/**
 * The thread that holds watched files. Each file is open for reading with a
 * handle that refuses writers, and with a read-handle opportunistic lock
 * (Windows' `FSCTL_REQUEST_OPLOCK`). Opening the file to write it, renaming or
 * deleting it, or renaming a folder above it, breaks the lock, and Windows
 * makes that opener wait until the lock's holder lets go. This thread then
 * copies the file aside, puts the copy and a note of it on disk, and only
 * then closes its handle, so the opener goes on and nothing could write to
 * the file before its bytes were safe. Reading never breaks the lock.
 *
 * A file is held only when what Windows opened lies inside its folder itself:
 * a junction or symbolic link, as the file or on its way, is never followed,
 * so nothing it leads to is held, copied or saved. The copy is read through
 * a handle Windows opens again from the held one, never by the file's path,
 * so it is of the file checked when it was held.
 *
 * It runs on a thread of its own and copies on that thread, so a writer
 * waits only as long as the copy, whatever Zhiyin's own thread is doing, and
 * a file operation of Zhiyin's own that breaks a lock waits for the copy and
 * never on itself.
 *
 * It imports nothing from the workspace, so it starts as it is, without a
 * build step.
 */

import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { parentPort, workerData } from "node:worker_threads";
import koffi from "koffi";
import type {
  FromThread,
  RoomDecision,
  ToThread,
  WatchItem,
  WatchResult,
} from "./watch-messages.js";

const owner = parentPort;
if (!owner) throw new Error("The file watch thread has no owner.");
const { staging } = workerData as { readonly staging: string };

const kernel32 = koffi.load("kernel32.dll");
const CreateFileW = kernel32.func(
  "void* CreateFileW(const char16_t*, uint32, uint32, void*, uint32, uint32, void*)",
);
const GetFileAttributesW = kernel32.func(
  "uint32 GetFileAttributesW(const char16_t*)",
);
const CloseHandle = kernel32.func("bool CloseHandle(void*)");
const GetLastError = kernel32.func("uint32 GetLastError()");
const GetFinalPathNameByHandleW = kernel32.func(
  "uint32 GetFinalPathNameByHandleW(void*, void*, uint32, uint32)",
);
const ReOpenFile = kernel32.func(
  "void* ReOpenFile(void*, uint32, uint32, uint32)",
);
const ReadFile = kernel32.func(
  "bool ReadFile(void*, void*, uint32, _Out_ uint32*, void*)",
);
const DeviceIoControl = kernel32.func(
  "bool DeviceIoControl(void*, uint32, void*, uint32, void*, uint32, void*, void*)",
);
const AssociatePort = kernel32.func(
  "void* CreateIoCompletionPort(void*, void*, uintptr_t, uint32)",
);
const NewPort = kernel32.func(
  "void* CreateIoCompletionPort(intptr_t, void*, uintptr_t, uint32)",
);
const GetQueuedCompletionStatus = kernel32.func(
  "bool GetQueuedCompletionStatus(void*, _Out_ uint32*, _Out_ uintptr_t*, _Out_ void**, uint32)",
);
const PostQueuedCompletionStatus = kernel32.func(
  "bool PostQueuedCompletionStatus(void*, uint32, uintptr_t, void*)",
);

const OVERLAPPED = koffi.struct({
  Internal: "uintptr_t",
  InternalHigh: "uintptr_t",
  Offset: "uint32",
  OffsetHigh: "uint32",
  hEvent: "void*",
});
const bytesOf = (length: number) => koffi.array("uint8", length);

const GENERIC_READ = 0x80000000;
const FILE_SHARE_READ = 0x1;
const OPEN_EXISTING = 3;
const FILE_FLAG_OVERLAPPED = 0x40000000;
const FILE_FLAG_OPEN_REPARSE_POINT = 0x00200000;
const FSCTL_REQUEST_OPLOCK = 0x00090240;
const ERROR_IO_PENDING = 997;
const ERROR_SHARING_VIOLATION = 32;
const ERROR_OPLOCK_NOT_GRANTED = 300;
const INVALID_FILE_ATTRIBUTES = 0xffffffff;
const FILE_ATTRIBUTE_DIRECTORY = 0x10;
const FILE_ATTRIBUTE_REPARSE_POINT = 0x400;
const FILE_ATTRIBUTE_OFFLINE = 0x1000;
const FILE_ATTRIBUTE_RECALL_ON_OPEN = 0x40000;
const FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS = 0x400000;
const OPLOCK_LEVEL_CACHE_READ = 1;
const OPLOCK_LEVEL_CACHE_HANDLE = 2;
const REQUEST_OPLOCK_INPUT_FLAG_REQUEST = 1;
const REQUEST_OPLOCK_INPUT_FLAG_ACK = 2;
const INFINITE = 0xffffffff;
/** Bytes a held file is copied by at a time. */
const copiedAtOnce = 1024 * 1024;
/** The completion key that wakes the thread to close. */
const WAKE = 0;

const invalid = (handle: unknown) =>
  !handle || koffi.address(handle) === BigInt.asUintN(64, -1n);

const port = NewPort(-1, null, 0, 0);

type Held = {
  readonly item: WatchItem;
  readonly handle: unknown;
  readonly overlapped: unknown;
  readonly output: unknown;
  readonly input: unknown;
  /** Waiting for the owner to say what to do, or refused and still held. */
  state: "held" | "deciding" | "refused";
  /** Whether a lock request is still pending, writing to the buffers. */
  pending: boolean;
  /** When the lock broke, for how long the writer waited. */
  brokeAt?: number;
};

const held = new Map<number, Held>();
/**
 * Closed while their lock request was still pending: their buffers stay until
 * Windows reports the request done, since it writes them until then.
 */
const closing = new Map<number, unknown[]>();
const saving = new Map<string, boolean>();
let room = Number.POSITIVE_INFINITY;
let closed = false;

const send = (message: FromThread) => owner.postMessage(message);

/** Requests the lock, or acknowledges a break, at `level`, without waiting. */
function requestLock(entry: Held, level: number, flags: number): number {
  koffi.encode(entry.overlapped, OVERLAPPED, {
    Internal: 0,
    InternalHigh: 0,
    Offset: 0,
    OffsetHigh: 0,
    hEvent: null,
  });
  koffi.encode(entry.output, bytesOf(32), new Array(32).fill(0));
  koffi.encode(entry.input, bytesOf(12), [
    1,
    0,
    12,
    0,
    level,
    0,
    0,
    0,
    flags,
    0,
    0,
    0,
  ]);
  const done = DeviceIoControl(
    entry.handle,
    FSCTL_REQUEST_OPLOCK,
    entry.input,
    12,
    entry.output,
    32,
    null,
    entry.overlapped,
  );
  const error = done ? 0 : GetLastError();
  entry.pending = error === ERROR_IO_PENDING;
  return error;
}

const throughLink =
  "It is a junction or a symbolic link, or one is on its way, and a link is never followed, so it is not watched.";

/** Each watched folder's own path, as Windows names an open file in it. */
const realRoots = new Map<string, string | undefined>();

/** A path as `GetFinalPathNameByHandleW` gives it, without its `\\?\` prefix. */
const plainPath = (path: string) =>
  path.startsWith("\\\\?\\UNC\\")
    ? `\\${path.slice(7)}`
    : path.startsWith("\\\\?\\")
      ? path.slice(4)
      : path;

/** Whether an open file's own path, through no link, lies inside `root`. */
function opensInside(handle: unknown, root: string): boolean {
  if (!realRoots.has(root))
    realRoots.set(
      root,
      (() => {
        try {
          return realpathSync.native(root);
        } catch {
          return undefined;
        }
      })(),
    );
  const real = realRoots.get(root);
  if (real === undefined) return false;
  const name = Buffer.alloc(2 * 32_768);
  const length = GetFinalPathNameByHandleW(handle, name, 32_768, 0);
  if (!length || length >= 32_768) return false;
  const opened = plainPath(name.toString("utf16le", 0, 2 * length));
  let end = real.length;
  // Read once from the end: a pattern for the trailing separators would try
  // again from each one.
  while (end > 0 && (real[end - 1] === "\\" || real[end - 1] === "/")) end -= 1;
  const base = real.slice(0, end).toLowerCase();
  return opened.toLowerCase().startsWith(`${base}\\`);
}

function hold(item: WatchItem): WatchResult {
  const attributes = GetFileAttributesW(item.path);
  if (attributes === INVALID_FILE_ATTRIBUTES)
    return { id: item.id, ok: false, reason: "It is not there any more." };
  if (attributes & FILE_ATTRIBUTE_REPARSE_POINT)
    return { id: item.id, ok: false, reason: throughLink };
  if (attributes & FILE_ATTRIBUTE_DIRECTORY)
    return { id: item.id, ok: false, reason: "It is a folder." };
  if (
    attributes &
    (FILE_ATTRIBUTE_OFFLINE |
      FILE_ATTRIBUTE_RECALL_ON_OPEN |
      FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS)
  )
    return {
      id: item.id,
      ok: false,
      reason:
        "It is kept online only, and watching it would download it, so it is not watched.",
    };
  const handle = CreateFileW(
    item.path,
    GENERIC_READ,
    FILE_SHARE_READ,
    null,
    OPEN_EXISTING,
    FILE_FLAG_OVERLAPPED | FILE_FLAG_OPEN_REPARSE_POINT,
    null,
  );
  if (invalid(handle)) {
    const error = GetLastError();
    return {
      id: item.id,
      ok: false,
      reason:
        error === ERROR_SHARING_VIOLATION
          ? "Another program has it open for writing."
          : `Windows did not open it (error ${error}).`,
    };
  }
  // What was opened must lie inside the folder itself: a folder on the way
  // that is a junction or a symbolic link leads elsewhere, and nothing
  // there is held or saved.
  if (!opensInside(handle, item.root)) {
    CloseHandle(handle);
    return { id: item.id, ok: false, reason: throughLink };
  }
  AssociatePort(handle, port, item.id, 0);
  const entry: Held = {
    item,
    handle,
    overlapped: koffi.alloc(OVERLAPPED, 1),
    output: koffi.alloc("uint8", 32),
    input: koffi.alloc("uint8", 12),
    state: "held",
    pending: false,
  };
  const error = requestLock(
    entry,
    OPLOCK_LEVEL_CACHE_READ | OPLOCK_LEVEL_CACHE_HANDLE,
    REQUEST_OPLOCK_INPUT_FLAG_REQUEST,
  );
  if (error !== ERROR_IO_PENDING) {
    // A lock granted and broken at once, or refused: either way the request
    // is done, and its buffers are free once the handle is.
    CloseHandle(handle);
    free(entry);
    return {
      id: item.id,
      ok: false,
      reason:
        error === ERROR_OPLOCK_NOT_GRANTED
          ? "Windows would not lock it, as for a file another program has mapped into memory to write."
          : `Windows would not lock it (error ${error}).`,
    };
  }
  held.set(item.id, entry);
  return { id: item.id, ok: true };
}

function free(entry: Pick<Held, "overlapped" | "output" | "input">) {
  koffi.free(entry.overlapped);
  koffi.free(entry.output);
  koffi.free(entry.input);
}

/** Closes a held file's handle, so whoever waits on it goes on. */
function letGo(entry: Held) {
  held.delete(entry.item.id);
  CloseHandle(entry.handle);
  // A pending request is cancelled with the handle and reported afterwards.
  if (entry.pending)
    closing.set(entry.item.id, [entry.overlapped, entry.output, entry.input]);
  else free(entry);
}

/** Copies a held file aside and records it, both on disk, then lets it go. */
function save(entry: Held) {
  const { id, root, path } = entry.item;
  const name = `${process.pid}-${Date.now()}-${id}`;
  const part = join(staging, `${name}.part`);
  const staged = join(staging, `${name}.bin`);
  const record = join(staging, `${name}.json`);
  let bytes: number;
  try {
    mkdirSync(staging, { recursive: true });
    copyHeld(entry.handle, part);
    flush(part);
    renameSync(part, staged);
    bytes = statSync(staged).size;
    writeFileSync(
      record,
      JSON.stringify({ version: 1, root, path, bytes, at: Date.now() }),
    );
    flush(record);
  } catch (error) {
    rmSync(part, { force: true });
    rmSync(staged, { force: true });
    rmSync(record, { force: true });
    letGo(entry);
    send({
      kind: "unsaved",
      id,
      root,
      path,
      reason: `It could not be saved first (${error instanceof Error ? error.message : String(error)}).`,
    });
    return;
  }
  room -= bytes;
  const waitedMs = entry.brokeAt === undefined ? 0 : Date.now() - entry.brokeAt;
  letGo(entry);
  send({ kind: "saved", id, root, path, staged, record, bytes, waitedMs });
}

/**
 * Copies the file `handle` holds to `to`, read through a second handle
 * Windows opens from it, never by its path: what is copied is the file
 * checked when it was held, wherever its name now leads.
 */
function copyHeld(handle: unknown, to: string) {
  const reading = ReOpenFile(handle, GENERIC_READ, FILE_SHARE_READ, 0);
  if (invalid(reading))
    throw new Error(`Windows did not open it again (error ${GetLastError()})`);
  const written = openSync(to, "wx");
  try {
    const chunk = Buffer.alloc(copiedAtOnce);
    const read = [0];
    for (;;) {
      if (!ReadFile(reading, chunk, chunk.length, read, null))
        throw new Error(`Windows did not read it (error ${GetLastError()})`);
      if (!read[0]) break;
      writeSync(written, chunk, 0, read[0]);
    }
  } finally {
    closeSync(written);
    CloseHandle(reading);
  }
}

function flush(path: string) {
  const descriptor = openSync(path, "r+");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

/** A held file's lock broke: someone opened it to change it. */
function broke(entry: Held) {
  if (entry.state !== "held") return;
  entry.brokeAt = Date.now();
  const { id, root, path } = entry.item;
  if (saving.get(root) === false) {
    letGo(entry);
    send({ kind: "through", id, root, path });
    return;
  }
  const size = (() => {
    try {
      return statSync(path).size;
    } catch {
      return 0;
    }
  })();
  if (size > room) {
    entry.state = "deciding";
    send({ kind: "needs-room", id, root, path, bytes: size });
    return;
  }
  save(entry);
}

function decide(id: number, decision: RoomDecision) {
  const entry = held.get(id);
  if (!entry || entry.state !== "deciding") return;
  const { root, path } = entry.item;
  if (decision === "save") {
    entry.state = "held";
    save(entry);
  } else if (decision === "without") {
    letGo(entry);
    send({
      kind: "unsaved",
      id,
      root,
      path,
      reason: "The person let it change without a backup.",
    });
  } else {
    // Acknowledged with the handle kept: the waiting opener is refused, as
    // the handle shares the file with readers only.
    entry.state = "refused";
    const output = Buffer.from(
      koffi.decode(entry.output, bytesOf(32)) as number[],
    );
    requestLock(entry, output.readUInt32LE(8), REQUEST_OPLOCK_INPUT_FLAG_ACK);
    send({ kind: "refused", id, root, path });
  }
}

function completed(id: number) {
  const buffers = closing.get(id);
  if (buffers) {
    closing.delete(id);
    for (const buffer of buffers) koffi.free(buffer);
    return;
  }
  const entry = held.get(id);
  if (!entry) return;
  entry.pending = false;
  broke(entry);
}

function pump() {
  const transferred = [0];
  const key = [0];
  const overlapped: unknown[] = [null];
  GetQueuedCompletionStatus.async(
    port,
    transferred,
    key,
    overlapped,
    INFINITE,
    (error: unknown) => {
      if (error)
        throw error instanceof Error ? error : new Error(String(error));
      const id = Number(key[0]);
      if (id === WAKE && closed) {
        CloseHandle(port);
        send({ kind: "closed" });
        owner?.close();
        return;
      }
      if (id !== WAKE) completed(id);
      pump();
    },
  );
}

owner.on("message", (message: ToThread) => {
  switch (message.kind) {
    case "watch":
      send({
        kind: "watched",
        batch: message.batch,
        results: message.items.map(hold),
      });
      return;
    case "settle":
      for (const id of message.ids) {
        const entry = held.get(id);
        if (entry?.state === "held") save(entry);
      }
      send({ kind: "done", batch: message.batch });
      return;
    case "release":
      for (const id of message.ids) {
        const entry = held.get(id);
        if (entry) letGo(entry);
      }
      send({ kind: "done", batch: message.batch });
      return;
    case "saving":
      saving.set(message.root, message.on);
      return;
    case "room":
      room = message.bytes;
      return;
    case "decide":
      decide(message.id, message.decision);
      return;
    case "close":
      closed = true;
      for (const entry of [...held.values()]) letGo(entry);
      PostQueuedCompletionStatus(port, 0, WAKE, null);
      return;
  }
});

pump();
