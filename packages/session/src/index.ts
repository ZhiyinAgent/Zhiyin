/**
 * Persists conversations so they can be resumed, and tracks each turn's file
 * changes so they can be undone.
 *
 * Boundaries and invariants: docs/architecture/features/session/README.md
 */

import {
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  type ProducedImage,
  type StoredPicture,
  type WorkspaceSnapshot,
} from "@zhiyin/contract";
import { isRecord } from "./saved-workspace.js";
import {
  HistoryStore,
  type OpenedConversation,
  type SavedIndex,
} from "./history-store.js";
import { historyFiles, type HistoryFiles } from "./history-log.js";
import { SessionStoreError } from "./errors.js";
import { FolderOwnership, type OwnershipOptions } from "./owner-lock.js";

export { SessionStoreError } from "./errors.js";
export type { OpenedConversation, SavedIndex } from "./history-store.js";
export { historyFiles, type HistoryFiles } from "./history-log.js";

const mib = 1024 * 1024;

/**
 * How much disk the pictures a conversation refers to may occupy.
 *
 * Screenshots arrive faster than anything else the app keeps — a browser task
 * takes a dozen without being asked — and unlike a recovery copy nobody ever
 * deletes one deliberately. Bounded the same way recovery is (ADR 0019): a
 * ceiling for one picture, a ceiling for all of them, and an age past which a
 * picture is not worth its bytes.
 */
export type PictureLimits = {
  /** The whole store. Oldest pictures go first when this is exceeded. */
  readonly totalBytes: number;
  /** The largest one picture may be. A larger one is not stored at all. */
  readonly pictureBytes: number;
  /** How long a picture is kept, however much room there is. */
  readonly maximumAgeMs: number;
};

export const defaultPictureLimits: PictureLimits = {
  totalBytes: 128 * mib,
  pictureBytes: 12 * mib,
  maximumAgeMs: 30 * 24 * 60 * 60 * 1000,
};

/**
 * What is left where a picture was, so a conversation can say what happened
 * instead of showing a gap. A few dozen bytes: the record of an eviction must
 * not itself be what fills the disk.
 */
type PictureRemoval = { readonly reason: string; readonly at: string };

const evictedReason = "This screenshot was deleted to save disk space.";
const oversizeReason = "This screenshot was too large to keep.";
const unknownReason = "This picture is no longer stored with the conversation.";

export interface SessionSummary {
  readonly id: string;
  /** Always producible, even for a session trimmed for the model's context. */
  readonly label: string;
}

/**
 * What the history holds: the conversations and the choices a person made.
 * Connection, plugin, usage, and browser state are only true while the app
 * runs and are read again at every launch, so they are never stored.
 *
 * `conversations` is the whole list and `tasks` the conversations opened; a
 * listed conversation that is not open is left as it is on disk.
 */
export type SavedWorkspace = Pick<
  WorkspaceSnapshot,
  | "preferences"
  | "workspace"
  | "recentWorkspaces"
  | "tasks"
  | "conversations"
  | "selectedTaskId"
>;

export interface Sessions {
  /**
   * The conversations, newest first, and the choices, without opening any
   * conversation.
   */
  loadIndex(): Promise<SavedIndex | undefined>;
  /** One conversation, read when it is first opened. */
  openConversation(id: string): Promise<OpenedConversation>;
  /** Every conversation opened at once. One that will not open fails the read. */
  loadWorkspace(): Promise<SavedWorkspace | undefined>;
  /**
   * Stores the durable part of a workspace, writing only what changed since
   * the last save; anything else given is not written.
   */
  saveWorkspace(
    workspace: SavedWorkspace,
    options?: { readonly commit?: () => boolean },
  ): Promise<void>;
  /**
   * Keeps a picture a conversation refers to, and answers with the name it is
   * referred to by. Stored beside the conversation rather than inside it: an
   * encoded image is large, and a conversation's file is read whole whenever
   * the conversation is opened.
   */
  savePicture(image: ProducedImage): Promise<string>;
  /**
   * The picture, or why it is not there — never a guess at what it was. A
   * picture the store deleted to stay inside its limits says so, because
   * "missing" and "removed on purpose" are different things to be told.
   */
  readPicture(source: string): Promise<StoredPicture>;
  /** Drops pictures nothing refers to any more. */
  forgetPictures(sources: readonly string[]): Promise<void>;
  list(): Promise<readonly SessionSummary[]>;
  /** Idempotent: undoing twice does nothing the second time. */
  undo(turnId: string): Promise<void>;
  /** What is left of a history whose settings will not open. Changes nothing. */
  inspectDamage(): Promise<DamageReport>;
  /** Copies what is damaged somewhere safe and answers where. Changes nothing else. */
  preserveDamaged(): Promise<string>;
  /** Keeps what is damaged, then starts the settings afresh beside what could be read. */
  recoverReadable(): Promise<{
    readonly recovered: number;
    readonly discarded: number;
    readonly kept: string;
  }>;
}

/** What is left of a history whose settings will not open. */
export type DamageReport =
  | { readonly kind: "unreadable" }
  | {
      readonly kind: "partial";
      readonly readable: number;
      readonly damaged: number;
    };

export class FileSessions implements Sessions {
  readonly #directory: string;
  readonly #ownership: FolderOwnership;
  readonly #pictureLimits: PictureLimits;
  readonly #now: () => Date;
  readonly #history: HistoryStore;
  /** Every read and write of the history, in the order they were asked for. */
  #queue: Promise<void> = Promise.resolve();

  constructor(
    directory: string,
    options: {
      readonly pictures?: Partial<PictureLimits>;
      readonly now?: () => Date;
      /** Replaced by boundary tests that make a history write fail or count it. */
      readonly historyFiles?: HistoryFiles;
    } & OwnershipOptions = {},
  ) {
    this.#directory = directory;
    this.#ownership = new FolderOwnership(
      join(directory, "owner.lock"),
      options,
    );
    this.#pictureLimits = { ...defaultPictureLimits, ...options.pictures };
    this.#now = options.now ?? (() => new Date());
    this.#history = new HistoryStore(
      directory,
      options.historyFiles ?? historyFiles,
      this.#now,
    );
  }

  /**
   * Runs after everything asked for before it. The queue is joined before
   * anything is awaited, so work commits in the order it was submitted.
   */
  #queued<T>(work: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(work);
    this.#queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** Takes ownership of the data directory for this process, or refuses. */
  async claim(): Promise<void> {
    await mkdir(this.#directory, { recursive: true });
    await this.#ownership.claim();
  }

  /** Gives the folder up so the next launch does not have to wait out a lock. */
  release(): Promise<void> {
    return this.#ownership.release();
  }

  /**
   * One file per picture, named by the id the conversation refers to it by.
   * The id is generated here and never taken from anywhere else, so nothing a
   * model or a server chose can name a path.
   */
  #pictureFile(source: string): string | undefined {
    return /^[0-9a-f-]{36}$/.test(source)
      ? join(this.#directory, "pictures", source)
      : undefined;
  }

  /** Where the note left in a removed picture's place lives. */
  #removalFile(source: string): string | undefined {
    const file = this.#pictureFile(source);
    return file ? `${file}.removed` : undefined;
  }

  async savePicture(image: ProducedImage): Promise<string> {
    const id = randomUUID();
    const file = this.#pictureFile(id);
    if (!file)
      throw new SessionStoreError("unavailable", "Invalid picture id.");
    const encoded = JSON.stringify(image);
    try {
      await mkdir(join(this.#directory, "pictures"), { recursive: true });
      // A picture past the per-picture ceiling is refused whole rather than
      // stored and immediately evicted: one oversized screenshot must not be
      // able to push out every picture that came before it.
      if (Buffer.byteLength(encoded, "utf8") > this.#pictureLimits.pictureBytes)
        await this.#recordRemoval(id, oversizeReason);
      else await writeFile(file, encoded, "utf8");
    } catch (error) {
      throw new SessionStoreError(
        "unavailable",
        "A picture could not be saved.",
        { cause: error },
      );
    }
    // After the write, so the picture just saved is the one kept when the
    // store is already at its limit.
    await this.#cleanupPictures(id);
    return id;
  }

  async readPicture(source: string): Promise<StoredPicture> {
    const file = this.#pictureFile(source);
    if (!file) return { status: "missing", reason: unknownReason };
    try {
      const stored: unknown = JSON.parse(await readFile(file, "utf8"));
      if (
        isRecord(stored) &&
        typeof stored.mediaType === "string" &&
        typeof stored.data === "string"
      )
        return {
          status: "ready",
          mediaType: stored.mediaType,
          data: stored.data,
        };
    } catch {
      // Falls through to whatever was left in its place.
    }
    return { status: "missing", reason: await this.#removalReason(source) };
  }

  async #removalReason(source: string): Promise<string> {
    const note = this.#removalFile(source);
    if (!note) return unknownReason;
    try {
      const stored: unknown = JSON.parse(await readFile(note, "utf8"));
      if (isRecord(stored) && typeof stored.reason === "string")
        return stored.reason;
    } catch {
      // No note: the picture was never here, or predates this record.
    }
    return unknownReason;
  }

  async #recordRemoval(source: string, reason: string): Promise<void> {
    const note = this.#removalFile(source);
    if (!note) return;
    const removal: PictureRemoval = {
      reason,
      at: this.#now().toISOString(),
    };
    await writeFile(note, JSON.stringify(removal), "utf8").catch(() => {
      // A conversation that cannot say why a picture is gone still says it is.
    });
  }

  /**
   * Age first, then size, oldest going first — the same order recovery uses.
   * `keep` is the picture this cleanup was triggered by: it is never the one
   * evicted to make room for itself.
   */
  async #cleanupPictures(keep?: string): Promise<void> {
    const folder = join(this.#directory, "pictures");
    let names: string[];
    try {
      names = await readdir(folder);
    } catch {
      return;
    }
    const cutoff = this.#now().getTime() - this.#pictureLimits.maximumAgeMs;
    const kept: { id: string; bytes: number; at: number }[] = [];
    for (const name of names) {
      if (name.endsWith(".removed")) {
        // The note outlives the picture, but not for ever.
        const info = await stat(join(folder, name)).catch(() => undefined);
        if (info && info.mtimeMs < cutoff)
          await rm(join(folder, name), { force: true });
        continue;
      }
      const info = await stat(join(folder, name)).catch(() => undefined);
      if (!info) continue;
      if (name !== keep && info.mtimeMs < cutoff) {
        await rm(join(folder, name), { force: true });
        await this.#recordRemoval(name, evictedReason);
        continue;
      }
      kept.push({ id: name, bytes: info.size, at: info.mtimeMs });
    }
    let total = kept.reduce((sum, entry) => sum + entry.bytes, 0);
    for (const entry of kept.sort((a, b) => a.at - b.at)) {
      if (total <= this.#pictureLimits.totalBytes) break;
      if (entry.id === keep) continue;
      await rm(join(folder, entry.id), { force: true });
      await this.#recordRemoval(entry.id, evictedReason);
      total -= entry.bytes;
    }
  }

  async forgetPictures(sources: readonly string[]): Promise<void> {
    await Promise.all(
      sources.map(async (source) => {
        const file = this.#pictureFile(source);
        if (file) await rm(file, { force: true });
      }),
    );
  }

  loadIndex(): Promise<SavedIndex | undefined> {
    return this.#queued(() => this.#history.loadIndex());
  }

  openConversation(id: string): Promise<OpenedConversation> {
    return this.#queued(() => this.#history.open(id));
  }

  loadWorkspace(): Promise<SavedWorkspace | undefined> {
    return this.#queued(() => this.#history.loadAll());
  }

  inspectDamage(): Promise<DamageReport> {
    return this.#queued(() => this.#history.inspectDamage());
  }

  preserveDamaged(): Promise<string> {
    return this.#queued(() => this.#history.preserveDamaged());
  }

  recoverReadable(): Promise<{
    readonly recovered: number;
    readonly discarded: number;
    readonly kept: string;
  }> {
    return this.#queued(async () => {
      await this.#ownership.require();
      return this.#history.recoverReadable();
    });
  }

  /**
   * Ownership is checked inside the queued work: awaiting it out here would
   * let a later save overtake an earlier one while the check was in flight.
   */
  saveWorkspace(
    workspace: SavedWorkspace,
    options: { readonly commit?: () => boolean } = {},
  ): Promise<void> {
    return this.#queued(async () => {
      await this.#ownership.require();
      await this.#history.save(workspace, options.commit ?? (() => true));
    });
  }

  async list(): Promise<readonly SessionSummary[]> {
    const index = await this.loadIndex();
    return (
      index?.conversations.map((item) => ({
        id: item.id,
        label: item.title,
      })) ?? []
    );
  }

  async undo(): Promise<void> {
    throw new SessionStoreError(
      "unavailable",
      "File undo is not available yet.",
    );
  }
}
