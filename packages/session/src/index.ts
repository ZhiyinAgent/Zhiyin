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
  rename,
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
import {
  isFolder,
  isRecord,
  isSavedWorkspace,
  isWorkspaceTask,
} from "./saved-workspace.js";
const mib = 1024 * 1024;

/**
 * Signal 0 delivers nothing and only reports whether the process is there.
 * `EPERM` means it exists and belongs to someone else, which still counts.
 */
function processIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

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

export type WorkspaceFileOperations = {
  readonly write: (path: string, source: string) => Promise<void>;
  readonly replace: (temporaryPath: string, path: string) => Promise<void>;
  readonly remove: (path: string) => Promise<void>;
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
 * What a history file holds: the conversations and the choices a person made.
 * Connection, plugin, usage, and browser state are only true while the app
 * runs and are read again at every launch, so they are never stored.
 */
export type SavedWorkspace = Pick<
  WorkspaceSnapshot,
  "preferences" | "workspace" | "recentWorkspaces" | "tasks" | "selectedTaskId"
>;

export interface Sessions {
  loadWorkspace(): Promise<SavedWorkspace | undefined>;
  /** Stores the durable part of a workspace; anything else given is not written. */
  saveWorkspace(
    workspace: SavedWorkspace,
    options?: { readonly commit?: () => boolean },
  ): Promise<void>;
  /**
   * Keeps a picture a conversation refers to, and answers with the name it is
   * referred to by. Stored beside the conversation rather than inside it: the
   * history file is rewritten whenever anything changes, and an encoded image
   * would be rewritten with it every time.
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
  /** What is left of a history file that will not open. Changes nothing. */
  inspectDamage(): Promise<DamageReport>;
  /** Copies the damaged file somewhere safe and answers where. Changes nothing else. */
  preserveDamaged(): Promise<string>;
  /** Keeps the damaged file, then rewrites the history with what could be read. */
  recoverReadable(): Promise<{
    readonly recovered: number;
    readonly discarded: number;
    readonly kept: string;
  }>;
}

/** What is left of a history file that will not open. */
export type DamageReport =
  | { readonly kind: "unreadable" }
  | {
      readonly kind: "partial";
      readonly readable: number;
      readonly damaged: number;
    };

export class SessionStoreError extends Error {
  readonly code: "corrupted" | "unavailable" | "in-use";

  constructor(
    code: SessionStoreError["code"],
    message: string,
    options: { cause?: unknown } = {},
  ) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "SessionStoreError";
    this.code = code;
  }
}

/** Only the fields a history file holds, whatever else the value carries. */
function durable(workspace: SavedWorkspace): SavedWorkspace {
  return {
    ...(workspace.preferences ? { preferences: workspace.preferences } : {}),
    ...(workspace.workspace ? { workspace: workspace.workspace } : {}),
    ...(workspace.recentWorkspaces
      ? { recentWorkspaces: workspace.recentWorkspaces }
      : {}),
    tasks: workspace.tasks,
    selectedTaskId: workspace.selectedTaskId,
  };
}

export class FileSessions implements Sessions {
  readonly #directory: string;
  readonly #workspaceFile: string;
  readonly #lockFile: string;
  readonly #pictureLimits: PictureLimits;
  readonly #now: () => Date;
  readonly #processIsRunning: (pid: number) => boolean;
  readonly #workspaceFiles: WorkspaceFileOperations;
  readonly #pid: number;
  #writes: Promise<void> = Promise.resolve();
  #owned = false;

  constructor(
    directory: string,
    options: {
      readonly pictures?: Partial<PictureLimits>;
      readonly now?: () => Date;
      /** Replaced in tests, where a dead process id has to be a known quantity. */
      readonly processIsRunning?: (pid: number) => boolean;
      /** Which process this instance speaks for. Injected so two owners can be tested. */
      readonly pid?: number;
      /** Replaced by boundary tests that make a workspace write fail. */
      readonly workspaceFiles?: WorkspaceFileOperations;
    } = {},
  ) {
    this.#directory = directory;
    this.#workspaceFile = join(directory, "workspace.json");
    this.#lockFile = join(directory, "owner.lock");
    this.#pictureLimits = { ...defaultPictureLimits, ...options.pictures };
    this.#now = options.now ?? (() => new Date());
    this.#processIsRunning = options.processIsRunning ?? processIsRunning;
    this.#pid = options.pid ?? process.pid;
    this.#workspaceFiles = options.workspaceFiles ?? {
      write: (path, source) => writeFile(path, source, "utf8"),
      replace: rename,
      remove: (path) => rm(path, { force: true }),
    };
  }

  /**
   * Takes ownership of the data directory for this process, or refuses.
   *
   * The write queue orders this process's saves and knows nothing about any
   * other process. Two instances each replacing the whole workspace file would
   * lose whichever set of changes finished first, with nothing to say it had
   * happened, so a second instance is prohibited rather than coordinated.
   *
   * A lock whose process is no longer running is taken over: the previous
   * launch was killed, and refusing forever would need the person to delete a
   * file they have no reason to know about. This trusts process ids not to be
   * reused between an unclean exit and the next launch, which is the same
   * assumption every lock file of this shape makes.
   */
  async claim(): Promise<void> {
    await mkdir(this.#directory, { recursive: true });
    const holder = await this.#currentOwner();
    if (holder !== undefined && holder !== this.#pid)
      throw new SessionStoreError(
        "in-use",
        "Another copy of the app is already using this data. Close it and try again.",
      );
    try {
      await writeFile(
        this.#lockFile,
        JSON.stringify({
          pid: this.#pid,
          since: this.#now().toISOString(),
        }),
        "utf8",
      );
    } catch (error) {
      throw new SessionStoreError(
        "unavailable",
        "This data folder could not be claimed.",
        { cause: error },
      );
    }
    this.#owned = true;
  }

  /** Gives the folder up so the next launch does not have to wait out a lock. */
  async release(): Promise<void> {
    this.#owned = false;
    await rm(this.#lockFile, { force: true }).catch(() => {});
  }

  /**
   * The process holding the folder, or nothing if it is free. A lock that
   * cannot be read or parsed is treated as free: an unreadable lock would
   * otherwise be an app that never starts again.
   */
  async #currentOwner(): Promise<number | undefined> {
    let source: string;
    try {
      source = await readFile(this.#lockFile, "utf8");
    } catch {
      return undefined;
    }
    try {
      const value: unknown = JSON.parse(source);
      if (!isRecord(value) || typeof value.pid !== "number") return undefined;
      return this.#processIsRunning(value.pid) ? value.pid : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Every durable write goes through here first. An instance that was refused
   * ownership must not be able to write anyway — a refusal that only stops the
   * launch, and not the writes, is not a lock.
   */
  async #requireOwnership(): Promise<void> {
    if (this.#owned) return;
    const holder = await this.#currentOwner();
    if (holder !== undefined && holder !== this.#pid)
      throw new SessionStoreError(
        "in-use",
        "Another copy of the app is using this data, so nothing was saved.",
      );
    this.#owned = true;
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

  async loadWorkspace(): Promise<SavedWorkspace | undefined> {
    let source: string;
    try {
      source = await readFile(this.#workspaceFile, "utf8");
    } catch (error) {
      if (isRecord(error) && "code" in error && error.code === "ENOENT")
        return undefined;
      throw new SessionStoreError(
        "unavailable",
        "Saved task history could not be read.",
        { cause: error },
      );
    }

    try {
      const value: unknown = JSON.parse(source);
      if (!isSavedWorkspace(value)) throw new Error("Invalid workspace");
      return durable(value);
    } catch (error) {
      throw new SessionStoreError(
        "corrupted",
        "Saved task history is damaged and cannot be opened safely.",
        { cause: error },
      );
    }
  }

  /**
   * What is left of a history file that will not open, without changing it.
   *
   * `unreadable` means the file is not JSON at all and nothing can be salvaged.
   * `partial` means the shape is intact and some conversations are readable,
   * so there is a real choice to offer rather than only an apology.
   */
  async inspectDamage(): Promise<DamageReport> {
    let source: string;
    try {
      source = await readFile(this.#workspaceFile, "utf8");
    } catch {
      return { kind: "unreadable" };
    }
    let value: unknown;
    try {
      value = JSON.parse(source);
    } catch {
      return { kind: "unreadable" };
    }
    if (!isRecord(value) || !Array.isArray(value.tasks))
      return { kind: "unreadable" };
    const readable = value.tasks.filter(isWorkspaceTask);
    return readable.length
      ? {
          kind: "partial",
          readable: readable.length,
          damaged: value.tasks.length - readable.length,
        }
      : { kind: "unreadable" };
  }

  /**
   * Copies the damaged file somewhere it will not be written over, and leaves
   * the original exactly where it is. Every copy is kept: a second damaged
   * launch must not erase the evidence from the first.
   */
  async preserveDamaged(): Promise<string> {
    const source = await readFile(this.#workspaceFile, "utf8").catch(
      (error: unknown) => {
        throw new SessionStoreError(
          "unavailable",
          "The damaged history could not be read in order to keep it.",
          { cause: error },
        );
      },
    );
    const directory = join(this.#directory, "damaged-history");
    await mkdir(directory, { recursive: true });
    const stamp = this.#now().toISOString().replace(/[:.]/g, "-");
    const kept = join(directory, `workspace-${stamp}.json`);
    await writeFile(kept, source, "utf8");
    return kept;
  }

  /**
   * Keeps the damaged file, then rewrites the history with the conversations
   * that could be read. A file with nothing readable is refused rather than
   * turned into an empty history: starting over is a choice for the person to
   * make, not a consequence of asking what could be recovered.
   */
  async recoverReadable(): Promise<{
    readonly recovered: number;
    readonly discarded: number;
    readonly kept: string;
  }> {
    const damage = await this.inspectDamage();
    if (damage.kind !== "partial")
      throw new SessionStoreError(
        "corrupted",
        "Nothing in the saved history could be read, so there is nothing to recover.",
      );
    const kept = await this.preserveDamaged();
    const value = JSON.parse(
      await readFile(this.#workspaceFile, "utf8"),
    ) as Record<string, unknown>;
    const tasks = (value.tasks as unknown[]).filter(isWorkspaceTask);
    const ids = new Set(tasks.map((task) => (task as { id: string }).id));
    const recovered: SavedWorkspace = {
      ...(isRecord(value.preferences)
        ? {
            preferences: value.preferences as NonNullable<
              WorkspaceSnapshot["preferences"]
            >,
          }
        : {}),
      ...(isFolder(value.workspace)
        ? {
            workspace: value.workspace as NonNullable<
              WorkspaceSnapshot["workspace"]
            >,
          }
        : {}),
      tasks: tasks as WorkspaceSnapshot["tasks"],
      // A conversation that did not survive cannot stay selected: the window
      // would open on a conversation that is not there.
      selectedTaskId:
        typeof value.selectedTaskId === "string" &&
        ids.has(value.selectedTaskId)
          ? value.selectedTaskId
          : ((tasks[0] as { id: string } | undefined)?.id ?? null),
    };
    await this.saveWorkspace(recovered);
    return {
      recovered: tasks.length,
      discarded: (value.tasks as unknown[]).length - tasks.length,
      kept,
    };
  }

  async saveWorkspace(
    workspace: SavedWorkspace,
    options: { readonly commit?: () => boolean } = {},
  ): Promise<void> {
    const source = JSON.stringify(
      { version: 1, ...durable(workspace) },
      null,
      2,
    );
    // The queue is joined before anything is awaited, so saves commit in the
    // order they were submitted. Ownership is checked inside the queued work
    // for the same reason: awaiting it out here would let a later save overtake
    // an earlier one while the check was in flight.
    const write = this.#writes.then(async () => {
      await this.#requireOwnership();
      await this.#write(source, options.commit);
    });
    this.#writes = write.catch(() => undefined);
    return write;
  }

  async #write(
    source: string,
    commit: () => boolean = () => true,
  ): Promise<void> {
    await mkdir(this.#directory, { recursive: true });
    const temporaryFile = `${this.#workspaceFile}.${randomUUID()}.tmp`;
    try {
      await this.#workspaceFiles.write(temporaryFile, source);
      if (!commit()) {
        await this.#workspaceFiles.remove(temporaryFile);
        return;
      }
      await this.#workspaceFiles.replace(temporaryFile, this.#workspaceFile);
    } catch (error) {
      await this.#workspaceFiles.remove(temporaryFile).catch(() => undefined);
      throw new SessionStoreError(
        "unavailable",
        "Task history could not be saved.",
        { cause: error },
      );
    }
  }

  async list(): Promise<readonly SessionSummary[]> {
    const workspace = await this.loadWorkspace();
    return (
      workspace?.tasks.map((task) => ({ id: task.id, label: task.title })) ?? []
    );
  }

  async undo(): Promise<void> {
    throw new SessionStoreError(
      "unavailable",
      "File undo is not available yet.",
    );
  }
}
