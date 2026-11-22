/**
 * Watching files from the thread that owns them: which files are held, what
 * was saved as each was first changed, and the owner's say in what happens
 * when a file cannot be saved within the room left. The holding is done on
 * the watch thread, so a writer is let go of as soon as its file is saved,
 * whatever this thread is busy with.
 */

import type {
  FromThread,
  RoomDecision,
  ToThread,
  WatchResult,
} from "./watch-messages.js";

export type { RoomDecision } from "./watch-messages.js";

/** What the watch thread is started with. */
export type WatchThreadData = {
  /** Where saved files are copied, on the drive the store is on. */
  readonly staging: string;
};

/** The thread a watch runs on, as `node:worker_threads` starts one. */
export type WatchThread = {
  postMessage(message: ToThread): void;
  on(event: "message", listener: (message: FromThread) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  terminate(): Promise<number>;
};

/** A file saved as it was first changed: a copy of its bytes and a note of it. */
export type SavedFile = {
  readonly root: string;
  readonly path: string;
  /** The copy of its bytes as they were. */
  readonly staged: string;
  /** The note that names the copy's file; the store removes both once it keeps them. */
  readonly record: string;
  readonly bytes: number;
  /** How long the writer waited, in milliseconds. */
  readonly waitedMs: number;
};

/** A write that waits: saving the file needs more room than is left. */
export type RoomRequest = {
  readonly root: string;
  readonly path: string;
  readonly bytes: number;
  /** Answers it; only the first answer counts. */
  decide(decision: RoomDecision): void;
};

export type FileWatchEvents = {
  /** A file was saved and let go. */
  readonly saved?: (file: SavedFile) => void;
  /**
   * A file was let go without being saved: written while its folder was not
   * being saved, or let change without a backup, or it could not be copied.
   * `reason` is absent for the first.
   */
  readonly unsaved?: (root: string, path: string, reason?: string) => void;
  readonly needsRoom?: (request: RoomRequest) => void;
  /** A file's write was refused; it stays held until it is released. */
  readonly refused?: (root: string, path: string) => void;
};

/** Why a file could not be watched, by its path. */
export type WatchFailures = ReadonlyMap<string, string>;

const keyOf = (path: string) => path.toLowerCase();

/** Whether `path` is `folder` or inside it, as Windows compares names. */
function within(folder: string, path: string): boolean {
  const base = keyOf(folder).replace(/[\\/]+$/, "");
  const key = keyOf(path);
  return (
    key === base || key.startsWith(`${base}\\`) || key.startsWith(`${base}/`)
  );
}

export class FileWatch {
  readonly #thread: WatchThread;
  readonly #events: FileWatchEvents;
  /** Each held file's id by its path. */
  readonly #ids = new Map<string, number>();
  readonly #paths = new Map<number, string>();
  readonly #batches = new Map<number, (message: FromThread) => void>();
  #next = 1;
  #failed: Error | undefined;
  #closed: Promise<void> | undefined;
  #onClosed: (() => void) | undefined;

  constructor(
    start: (data: WatchThreadData) => WatchThread,
    staging: string,
    events: FileWatchEvents = {},
  ) {
    this.#events = events;
    this.#thread = start({ staging });
    this.#thread.on("message", (message) => this.#heard(message));
    this.#thread.on("error", (error) => {
      this.#failed = error;
      for (const answer of this.#batches.values())
        answer({ kind: "done", batch: -1 });
      this.#batches.clear();
    });
  }

  /** How many files are held. */
  get count(): number {
    return this.#ids.size;
  }

  /** Whether this file is held. */
  watches(path: string): boolean {
    return this.#ids.has(keyOf(path));
  }

  /**
   * Holds each file for `root`, those held already as they are, and says why
   * any could not be. A file is held only when what Windows opened lies
   * inside `root` itself: a junction or symbolic link on its way, or the
   * file being one, leaves it unheld and unsaved.
   */
  async watch(root: string, paths: readonly string[]): Promise<WatchFailures> {
    const items = paths
      .filter((path) => !this.#ids.has(keyOf(path)))
      .map((path) => ({ id: this.#next++, root, path }));
    const failures = new Map<string, string>();
    if (!items.length) return failures;
    for (const item of items) {
      this.#ids.set(keyOf(item.path), item.id);
      this.#paths.set(item.id, item.path);
    }
    const answer = await this.#ask((batch) => ({
      kind: "watch",
      batch,
      items,
    }));
    const results: readonly WatchResult[] =
      answer.kind === "watched" ? answer.results : [];
    const held = new Set(results.flatMap((r) => (r.ok ? [r.id] : [])));
    for (const item of items) {
      if (held.has(item.id)) continue;
      const result = results.find((r) => r.id === item.id);
      this.#forget(item.id);
      failures.set(
        item.path,
        result && !result.ok
          ? result.reason
          : (this.#failed?.message ?? "The file watch is not running."),
      );
    }
    return failures;
  }

  /**
   * Saves each held file among `paths`, or inside them when they are
   * folders, and lets it go, before Zhiyin itself changes it. Settled once
   * every one is saved.
   */
  async settle(paths: readonly string[]): Promise<void> {
    const ids = this.#idsWithin(paths);
    if (!ids.length) return;
    await this.#ask((batch) => ({ kind: "settle", batch, ids }));
  }

  /** Lets go of each held file among `paths`, or inside them, without saving it. */
  async release(paths: readonly string[]): Promise<void> {
    const ids = this.#idsWithin(paths);
    if (!ids.length) return;
    for (const id of ids) this.#forget(id);
    await this.#ask((batch) => ({ kind: "release", batch, ids }));
  }

  /** Whether a write to a file held for `root` saves it first, or goes through at once. */
  saving(root: string, on: boolean): void {
    this.#post({ kind: "saving", root, on });
  }

  /** How many bytes may be saved before a write waits for `needsRoom`. */
  room(bytes: number): void {
    this.#post({ kind: "room", bytes });
  }

  /** Lets go of every file and ends the thread. */
  close(): Promise<void> {
    this.#closed ??= new Promise<void>((resolve) => {
      if (this.#failed) {
        void this.#thread.terminate().then(() => resolve());
        return;
      }
      this.#onClosed = resolve;
      this.#post({ kind: "close" });
    }).then(() => {
      this.#ids.clear();
      this.#paths.clear();
    });
    return this.#closed;
  }

  #idsWithin(paths: readonly string[]): number[] {
    const ids: number[] = [];
    for (const [key, id] of this.#ids)
      if (paths.some((path) => within(path, key))) ids.push(id);
    return ids;
  }

  #forget(id: number) {
    const path = this.#paths.get(id);
    this.#paths.delete(id);
    if (path !== undefined && this.#ids.get(keyOf(path)) === id)
      this.#ids.delete(keyOf(path));
  }

  #post(message: ToThread) {
    if (!this.#failed) this.#thread.postMessage(message);
  }

  #ask(message: (batch: number) => ToThread): Promise<FromThread> {
    if (this.#failed)
      return Promise.resolve({ kind: "done", batch: -1 } as const);
    const batch = this.#next++;
    return new Promise((resolve) => {
      this.#batches.set(batch, resolve);
      this.#post(message(batch));
    });
  }

  #heard(message: FromThread) {
    switch (message.kind) {
      case "watched":
      case "done": {
        const answer = this.#batches.get(message.batch);
        this.#batches.delete(message.batch);
        answer?.(message);
        return;
      }
      case "saved":
        this.#forget(message.id);
        this.#events.saved?.({
          root: message.root,
          path: message.path,
          staged: message.staged,
          record: message.record,
          bytes: message.bytes,
          waitedMs: message.waitedMs,
        });
        return;
      case "through":
        this.#forget(message.id);
        this.#events.unsaved?.(message.root, message.path);
        return;
      case "unsaved":
        this.#forget(message.id);
        this.#events.unsaved?.(message.root, message.path, message.reason);
        return;
      case "refused":
        this.#events.refused?.(message.root, message.path);
        return;
      case "needs-room": {
        let answered = false;
        const decide = (decision: RoomDecision) => {
          if (answered) return;
          answered = true;
          this.#post({ kind: "decide", id: message.id, decision });
        };
        if (this.#events.needsRoom)
          this.#events.needsRoom({
            root: message.root,
            path: message.path,
            bytes: message.bytes,
            decide,
          });
        else decide("save");
        return;
      }
      case "closed":
        this.#onClosed?.();
        return;
    }
  }
}
