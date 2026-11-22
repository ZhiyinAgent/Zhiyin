/**
 * Files saved as they are first written (ADR 0031). Each file a run may
 * change and the store does not hold as it is now is watched; the first
 * write, rename or delete of it waits while the watch copies it aside, and
 * that copy is then kept in the store of pieces. What was saved, and when, is
 * written down, so a run is weighed against it after a restart too.
 *
 * At most 20,000 files are watched. Past that, small files are saved at once,
 * together, until the rest fit; a large file past it is not watched, and is
 * said to be so, so it can be held from a run and saved when asked for.
 *
 * Without a watch, as on a system that has none, each file is saved at once
 * instead, as it is when asked.
 *
 * A junction or symbolic link is never watched or saved, and nothing is read
 * through one: a file is saved only from a handle checked to be the file its
 * path names through real folders.
 */

import { appendFile, mkdir, readdir, readFile, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import {
  alternateStreams,
  FileWatch,
  type RoomDecision,
  type SavedFile,
  type WatchThread,
  type WatchThreadData,
} from "@zhiyin/file-watch";
import { replaceFile } from "@zhiyin/files";
import type { PieceStore } from "./pieces/piece-store.js";
import { sizeOf } from "./run-changes.js";
import { nextSequence, observeSequence } from "./sequence.js";
import { linkOnPath, openedThroughNoLink } from "./workspace-files.js";

const throughLink =
  "It is a junction or a symbolic link, or one is on its way, and a link is never followed, so it is not saved.";

/** The most files watched at once: 20,000 measured 73 MB of the kernel's memory. */
export const mostWatched = 20_000;
/** A file saved at once, rather than watched, when too many are: no larger than this. */
const savedAheadBytes = 4 * 1024 * 1024;

/** A file saved as it was, in the folder it was saved for. */
export type Saved = {
  readonly root: string;
  /** From the folder, with forward slashes. */
  readonly path: string;
  readonly digest: string;
  readonly bytes: number;
  /** When it was saved, in the order recovery records things. */
  readonly seq: number;
  /** How long its writer waited for it, in milliseconds; none when saved at once. */
  readonly waitedMs: number;
};

/** A file that changed without being saved first, and why. */
type Unsaved = {
  readonly root: string;
  readonly path: string;
  readonly reason: string;
  readonly seq: number;
};

export type WatchOutcome =
  | { readonly watched: true }
  | { readonly saved: Saved }
  | { readonly failed: string };

/** What the person chose for a write whose file does not fit the room left. */
export type RoomChoice = "without" | "make-room" | "refuse";

/** A write waiting for the person: its file does not fit in the room left. */
export type RoomQuestion = {
  readonly root: string;
  readonly path: string;
  readonly bytes: number;
};

const keyOf = (root: string, path: string) =>
  `${root.toLowerCase()}\u0000${path.toLowerCase()}`;

/**
 * The full path of a file in `root` named as a listing names it, as `join`
 * gives it: put together directly when the name needs nothing worked out,
 * as tens of thousands are at each copy.
 */
const inside = (root: string, path: string) =>
  process.platform !== "win32" ||
  /(^|\/)\.{1,2}(\/|$)|\/\/|\\|^\/|:/.test(path) ||
  /[\\/]$|\/|\\\\/.test(root)
    ? join(root, path)
    : `${root}\\${path.replaceAll("/", "\\")}`;

export class FirstWrites {
  readonly #folder: string;
  readonly #pieces: PieceStore;
  readonly #watch: FileWatch | undefined;
  readonly #earlier: (root: string, path: string) => string | undefined;
  readonly #ask: ((question: RoomQuestion) => Promise<RoomChoice>) | undefined;
  readonly #makeRoom: (bytes: number, originals?: boolean) => Promise<boolean>;
  /** Saves by file, oldest first. */
  readonly #saves = new Map<string, Saved[]>();
  readonly #unsaved = new Map<string, Unsaved[]>();
  #ingesting: Promise<void> = Promise.resolve();
  #loaded: Promise<void> | undefined;

  constructor(options: {
    /** Recovery's own folder. */
    readonly folder: string;
    readonly pieces: PieceStore;
    /** Starts the watch thread; absent, files are saved at once. */
    readonly start?: (data: WatchThreadData) => WatchThread;
    /** The version of the file the store holds already, which its new pieces are compared with. */
    readonly earlier: (root: string, path: string) => string | undefined;
    /** Asks the person about a write whose file does not fit; absent, it is saved. */
    readonly ask?: (question: RoomQuestion) => Promise<RoomChoice>;
    /**
     * Lets go of versions in the budget's order to fit `bytes`, originals
     * too with `originals`, as the person agreed; says whether it fits.
     */
    readonly makeRoom: (bytes: number, originals?: boolean) => Promise<boolean>;
  }) {
    this.#folder = options.folder;
    this.#pieces = options.pieces;
    this.#earlier = options.earlier;
    this.#ask = options.ask;
    this.#makeRoom = options.makeRoom;
    this.#watch = options.start
      ? new FileWatch(options.start, this.#staging, {
          saved: (file) => this.#heardSaved(file),
          unsaved: (root, path, reason) => {
            if (reason) this.#heardUnsaved(root, path, reason);
          },
          needsRoom: (request) => void this.#decide(request),
        })
      : undefined;
  }

  get #staging() {
    return join(this.#folder, "staging");
  }

  get #log() {
    return join(this.#folder, "saves.log");
  }

  /** Whether files are watched, rather than saved at once. */
  get watching(): boolean {
    return this.#watch !== undefined;
  }

  /**
   * Watches each file of `root` named, by its path there with its size, or
   * saves it at once when there is no watch or too many are watched already.
   * What is saved at once takes no more than `room` bytes of the budget.
   */
  async watch(
    root: string,
    files: readonly (readonly [string, number])[],
    room = Number.POSITIVE_INFINITY,
  ): Promise<Map<string, WatchOutcome>> {
    await this.#load();
    const outcomes = new Map<string, WatchOutcome>();
    let left = room;
    // Saved together, smallest first, each within the room left; contents
    // several files hold take their room once, so what did not fit is tried
    // again while that frees room.
    const charged = new Set<string>();
    const saveAll = async (wanted: readonly (readonly [string, number])[]) => {
      let waiting = [...wanted];
      while (waiting.length) {
        const fits: (readonly [string, number])[] = [];
        const later: (readonly [string, number])[] = [];
        for (const file of waiting)
          if (file[1] > left) later.push(file);
          else {
            fits.push(file);
            left -= file[1];
          }
        const saved = await this.#saveAll(
          root,
          fits.map(([path]) => path),
        );
        let freed = false;
        for (const [index, [path, size]] of fits.entries()) {
          const outcome = saved[index]!;
          outcomes.set(path, outcome);
          if (!("saved" in outcome) || charged.has(outcome.saved.digest)) {
            left += size;
            freed = true;
          } else charged.add(outcome.saved.digest);
        }
        waiting = freed && fits.length ? later : [];
        if (!waiting.length)
          for (const [path] of later)
            outcomes.set(path, {
              failed: `The undo budget has room for ${sizeOf(Math.max(0, left))} more, too little to keep this file first.`,
            });
      }
    };
    const watch = this.#watch;
    if (!watch) {
      await saveAll([...files].sort(([, a], [, b]) => a - b));
      return outcomes;
    }
    const fresh: (readonly [string, number])[] = [];
    for (const file of files)
      if (watch.watches(inside(root, file[0])))
        outcomes.set(file[0], { watched: true });
      else fresh.push(file);
    const space = mostWatched - watch.count;
    let ahead = Math.max(0, fresh.length - space);
    const bySize = [...fresh].sort(([, a], [, b]) => a - b);
    const toWatch: (readonly [string, number])[] = [];
    const savedAhead: (readonly [string, number])[] = [];
    for (const [path, size] of bySize) {
      if (ahead > 0 && size <= savedAheadBytes) {
        ahead -= 1;
        savedAhead.push([path, size]);
      } else toWatch.push([path, size]);
    }
    await saveAll(savedAhead);
    // What is left past the room is the largest.
    const past = toWatch.splice(Math.max(0, space));
    for (const [path] of past)
      outcomes.set(path, {
        failed:
          "Too many files here are not saved yet to watch them all, and it is too large to save at once. Ask for it with prepare_change before changing it.",
      });
    const failures = await watch.watch(
      root,
      toWatch.map(([path]) => inside(root, path)),
    );
    for (const [path] of toWatch) {
      const failure = failures.get(inside(root, path));
      outcomes.set(path, failure ? { failed: failure } : { watched: true });
    }
    return outcomes;
  }

  /** Saves the file now, as `prepare_change` asks, letting go of its watch. */
  async save(root: string, path: string): Promise<WatchOutcome> {
    await this.#load();
    const full = join(root, path);
    if (this.#watch?.watches(full)) {
      await this.#watch.settle([full]);
      await this.settled();
      const saved = this.#saves.get(keyOf(root, path))?.at(-1);
      if (saved) return { saved };
    }
    return this.#saveNow(root, path);
  }

  /**
   * Saves and lets go of each watched file among `paths`, or inside them,
   * before Zhiyin changes them itself, so it never waits on its own watch.
   */
  async settle(paths: readonly string[]): Promise<void> {
    await this.#watch?.settle(paths);
    await this.settled();
  }

  /** Lets go of every watched file inside `folder` without saving it. */
  async release(folder: string): Promise<void> {
    await this.#watch?.release([folder]);
  }

  /** Whether a first write in `root` is saved: during a turn or a run, it is. */
  saving(root: string, on: boolean): void {
    this.#watch?.saving(root, on);
  }

  /** How many bytes may be saved before a write waits for the person. */
  room(bytes: number): void {
    this.#watch?.room(Math.max(0, bytes));
  }

  /** Settles once every copy the watch made is kept in the store. */
  settled(): Promise<void> {
    return this.#ingesting;
  }

  /** The first save of the file at or after `seq`. */
  savedSince(root: string, path: string, seq: number): Saved | undefined {
    return this.#saves
      .get(keyOf(root, path))
      ?.find((saved) => saved.seq >= seq);
  }

  /** Why the file changed without being saved at or after `seq`, if it did. */
  unsavedSince(root: string, path: string, seq: number): string | undefined {
    return this.#unsaved.get(keyOf(root, path))?.find((each) => each.seq >= seq)
      ?.reason;
  }

  /** The versions saved at or after `seq`, by digest, which a run still to be weighed may need. */
  digests(seq: number): ReadonlySet<string> {
    if (this.#digests?.seq === seq && this.#digests.saves === this.#changes)
      return this.#digests.found;
    const found = new Set<string>();
    for (const saves of this.#saves.values())
      for (const saved of saves) if (saved.seq >= seq) found.add(saved.digest);
    this.#digests = { seq, saves: this.#changes, found };
    return found;
  }

  /** The answer `digests` gave last, while no save was made or forgotten since. */
  #digests:
    | {
        readonly seq: number;
        readonly saves: number;
        readonly found: ReadonlySet<string>;
      }
    | undefined;
  /** How many times the saves were changed. */
  #changes = 0;

  /** Forgets saves older than `seq`, which nothing will weigh again. */
  async forgetBefore(seq: number): Promise<void> {
    await this.#load();
    await this.settled();
    let dropped = false;
    for (const [key, saves] of this.#saves) {
      if (!saves.some((saved) => saved.seq < seq)) continue;
      const kept = saves.filter((saved) => saved.seq >= seq);
      dropped = true;
      if (kept.length) this.#saves.set(key, kept);
      else this.#saves.delete(key);
    }
    for (const [key, each] of this.#unsaved) {
      if (!each.some((unsaved) => unsaved.seq < seq)) continue;
      const kept = each.filter((unsaved) => unsaved.seq >= seq);
      if (kept.length) this.#unsaved.set(key, kept);
      else this.#unsaved.delete(key);
    }
    if (!dropped) return;
    this.#changes += 1;
    const lines = [...this.#saves.values()]
      .flat()
      .map((saved) => `${JSON.stringify(saved)}\n`)
      .join("");
    await replaceFile(this.#log, lines);
  }

  async close(): Promise<void> {
    await this.#watch?.close();
    await this.settled();
  }

  async #saveNow(root: string, path: string): Promise<WatchOutcome> {
    const full = join(root, path);
    try {
      if (await linkOnPath(root, full, true)) return { failed: throughLink };
      const kept = await this.#pieces.put(full, {
        ...(this.#earlier(root, path)
          ? { earlier: this.#earlier(root, path)! }
          : {}),
        streams: alternateStreams(full),
        opened: (file) => openedThroughNoLink(root, full, file),
      });
      const saved: Saved = {
        root,
        path,
        digest: kept.digest,
        bytes: kept.bytes,
        seq: nextSequence(),
        waitedMs: 0,
      };
      await this.#record(saved);
      return { saved };
    } catch (error) {
      return {
        failed: `It could not be saved (${error instanceof Error ? error.message : String(error)}).`,
      };
    }
  }

  /** Saves many files of `root` at once, each as `#saveNow` saves one. */
  async #saveAll(
    root: string,
    paths: readonly string[],
  ): Promise<WatchOutcome[]> {
    if (!paths.length) return [];
    const kept = await this.#pieces.putAll(
      paths.map((path) => {
        const source = inside(root, path);
        const earlier = this.#earlier(root, path);
        return {
          source,
          ...(earlier ? { earlier } : {}),
          streams: alternateStreams(source),
          opened: (file) => openedThroughNoLink(root, source, file),
        };
      }),
    );
    const outcomes: WatchOutcome[] = [];
    const saves: Saved[] = [];
    for (const [index, path] of paths.entries()) {
      const answer = kept[index]!;
      if ("failed" in answer) {
        outcomes.push({ failed: `It could not be saved (${answer.failed}).` });
        continue;
      }
      const saved: Saved = {
        root,
        path,
        digest: answer.digest,
        bytes: answer.bytes,
        seq: nextSequence(),
        waitedMs: 0,
      };
      saves.push(saved);
      outcomes.push({ saved });
    }
    await this.#recordAll(saves);
    return outcomes;
  }

  #heardSaved(file: SavedFile) {
    const seq = nextSequence();
    this.#ingesting = this.#ingesting.then(() => this.#ingest(file, seq));
  }

  #heardUnsaved(root: string, absolute: string, reason: string) {
    const path = relative(root, absolute).replaceAll("\\", "/");
    const key = keyOf(root, path);
    this.#unsaved.set(key, [
      ...(this.#unsaved.get(key) ?? []),
      { root, path, reason, seq: nextSequence() },
    ]);
  }

  async #ingest(file: SavedFile, seq: number): Promise<void> {
    const path = relative(file.root, file.path).replaceAll("\\", "/");
    try {
      const earlier = this.#earlier(file.root, path);
      const kept = await this.#pieces.put(file.staged, {
        ...(earlier ? { earlier } : {}),
        streams: alternateStreams(file.staged),
      });
      await this.#record({
        root: file.root,
        path,
        digest: kept.digest,
        bytes: kept.bytes,
        seq,
        waitedMs: file.waitedMs,
      });
      await rm(file.staged, { force: true });
      await rm(file.record, { force: true });
    } catch (error) {
      // Its copy stays aside, to be kept at the next start.
      this.#heardUnsaved(
        file.root,
        file.path,
        `Its copy could not be kept (${error instanceof Error ? error.message : String(error)}).`,
      );
    }
  }

  #record(saved: Saved): Promise<void> {
    return this.#recordAll([saved]);
  }

  async #recordAll(saves: readonly Saved[]): Promise<void> {
    if (!saves.length) return;
    await mkdir(this.#folder, { recursive: true });
    await appendFile(
      this.#log,
      saves.map((saved) => `${JSON.stringify(saved)}\n`).join(""),
    );
    for (const saved of saves) {
      const key = keyOf(saved.root, saved.path);
      const earlier = this.#saves.get(key);
      if (earlier) earlier.push(saved);
      else this.#saves.set(key, [saved]);
    }
    this.#changes += 1;
  }

  async #decide(request: {
    readonly root: string;
    readonly path: string;
    readonly bytes: number;
    decide(decision: RoomDecision): void;
  }): Promise<void> {
    const path = relative(request.root, request.path).replaceAll("\\", "/");
    if (await this.#makeRoom(request.bytes)) return request.decide("save");
    // With nobody to ask, the file is saved past the budget, which lets go
    // of what it may at its next use; an original goes only when asked.
    if (!this.#ask) return request.decide("save");
    const choice = await this.#ask({
      root: request.root,
      path,
      bytes: request.bytes,
    }).catch(() => "refuse" as const);
    if (choice === "without") return request.decide("without");
    if (choice === "refuse") return request.decide("refuse");
    // Making room may let go of what only the person may agree to: they have.
    await this.#makeRoom(request.bytes, true);
    request.decide("save");
  }

  #load(): Promise<void> {
    if (!this.#loaded) {
      this.#loaded = this.#read();
      this.#loaded.catch(() => (this.#loaded = undefined));
    }
    return this.#loaded;
  }

  /** Reads what was saved, and keeps the copies a crash left aside. */
  async #read(): Promise<void> {
    const text = await readFile(this.#log, "utf8").catch(() => "");
    for (const row of text.split("\n")) {
      if (!row) continue;
      try {
        const saved = JSON.parse(row) as Saved;
        observeSequence(saved.seq);
        const key = keyOf(saved.root, saved.path);
        this.#saves.set(key, [...(this.#saves.get(key) ?? []), saved]);
        this.#changes += 1;
      } catch {
        // A line a crash cut short.
      }
    }
    const names = await readdir(this.#staging).catch(() => [] as string[]);
    for (const name of names) {
      const path = join(this.#staging, name);
      if (name.endsWith(".part")) await rm(path, { force: true });
      if (!name.endsWith(".json")) continue;
      const note = await readFile(path, "utf8")
        .then(
          (text) =>
            JSON.parse(text) as {
              root: string;
              path: string;
              bytes: number;
              at: number;
            },
        )
        .catch(() => undefined);
      const staged = path.replace(/\.json$/, ".bin");
      if (!note) {
        await rm(path, { force: true });
        await rm(staged, { force: true });
        continue;
      }
      await this.#ingest(
        {
          root: note.root,
          path: note.path,
          staged,
          record: path,
          bytes: note.bytes,
          waitedMs: 0,
        },
        note.at * 1000,
      );
    }
  }
}
