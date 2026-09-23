/**
 * Where the history lives on disk, and how a save reaches it.
 *
 * Each conversation is its own log, and the list of conversations with the
 * choices a person made is one more. A save compares what it is given with
 * what it last wrote and appends only the difference, so streaming a reply
 * writes the words that arrived rather than every conversation ever kept, and
 * a file damaged by a crash can cost one conversation at most.
 *
 * Nothing is compared or written by callers: whatever the app holds is what
 * is saved, so no part of the app has to remember to report its change.
 */

import { cp, mkdir, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { ConversationSummary, WorkspaceTask } from "@zhiyin/contract";
import { changesBetween } from "./history-changes.js";
import { HistoryLog, type HistoryFiles } from "./history-log.js";
import { isRecord, isWorkspaceTask } from "./saved-workspace.js";
import { isSavedIndex } from "./saved-index.js";
import { SessionStoreError } from "./errors.js";
import type { DamageReport, SavedWorkspace } from "./index.js";

/** Everything but the conversations themselves. */
export type SavedIndex = Omit<SavedWorkspace, "tasks" | "conversations"> & {
  readonly conversations: readonly ConversationSummary[];
};

/** A conversation read from disk. */
export type OpenedConversation = {
  readonly task: WorkspaceTask;
  /** Whether the last save before the app closed was cut off and dropped. */
  readonly lost: boolean;
};

type IndexState = SavedIndex & { readonly version: 2 };

/** A document as it was last written, and the log it was written to. */
type Written<T> = { readonly log: HistoryLog; state: T };

export function summaryOf(item: ConversationSummary): ConversationSummary {
  return {
    id: item.id,
    title: item.title,
    ...(item.titleSource ? { titleSource: item.titleSource } : {}),
    ...(item.updatedAt ? { updatedAt: item.updatedAt } : {}),
    updatedLabel: item.updatedLabel,
  };
}

/** The choices a person made, and nothing only true while the app runs. */
function settingsOf(
  workspace: Omit<SavedIndex, "conversations">,
): Omit<SavedIndex, "conversations" | "selectedTaskId"> {
  return {
    ...(workspace.preferences ? { preferences: workspace.preferences } : {}),
    ...(workspace.workspace ? { workspace: workspace.workspace } : {}),
    ...(workspace.recentWorkspaces
      ? { recentWorkspaces: workspace.recentWorkspaces }
      : {}),
  };
}

/**
 * A folder name for a conversation. An id that is safe as a name is used as
 * it is, so the folder can be found by eye; any other is hashed, so nothing a
 * conversation is called can name a path.
 */
function folderName(id: string): string {
  return /^[A-Za-z0-9_-]{1,64}$/.test(id)
    ? `c-${id}`
    : `h-${createHash("sha256").update(id).digest("hex").slice(0, 32)}`;
}

/** A read that failed because of the disk, not because of what was on it. */
function unreachable(error: unknown): boolean {
  return (
    isRecord(error) && typeof error.code === "string" && error.code !== "EISDIR"
  );
}

function stampOf(now: Date): string {
  return now.toISOString().replace(/[:.]/g, "-");
}

export class HistoryStore {
  readonly #directory: string;
  readonly #files: HistoryFiles;
  readonly #now: () => Date;
  #index: Written<IndexState> | undefined;
  readonly #conversations = new Map<string, Written<WorkspaceTask>>();

  constructor(directory: string, files: HistoryFiles, now: () => Date) {
    this.#directory = directory;
    this.#files = files;
    this.#now = now;
  }

  get #indexFolder(): string {
    return join(this.#directory, "history", "index");
  }

  get #conversationsFolder(): string {
    return join(this.#directory, "history", "conversations");
  }

  #folderOf(id: string): string {
    return join(this.#conversationsFolder, folderName(id));
  }

  /** The list and the choices, or nothing on a first launch. */
  async loadIndex(): Promise<SavedIndex | undefined> {
    if (!(await HistoryLog.exists(this.#indexFolder, this.#files))) {
      // Conversations are written before the list that names them, so
      // conversations with no list mean the list was lost, not that there is
      // no history.
      if ((await this.#files.names(this.#conversationsFolder)).length)
        throw new SessionStoreError(
          "corrupted",
          "The list of saved conversations is missing.",
        );
      return undefined;
    }
    let read;
    try {
      read = await HistoryLog.open(this.#indexFolder, this.#files);
    } catch (error) {
      throw new SessionStoreError(
        unreachable(error) ? "unavailable" : "corrupted",
        unreachable(error)
          ? "Saved task history could not be read."
          : "Saved task history is damaged and cannot be opened safely.",
        { cause: error },
      );
    }
    if (!isSavedIndex(read.state))
      throw new SessionStoreError(
        "corrupted",
        "Saved task history is damaged and cannot be opened safely.",
      );
    this.#index = { log: read.log, state: read.state };
    return {
      ...settingsOf(read.state),
      selectedTaskId: read.state.selectedTaskId,
      conversations: read.state.conversations,
    };
  }

  /** One conversation, read from its own file the first time it is asked for. */
  async open(id: string): Promise<OpenedConversation> {
    const written = this.#conversations.get(id);
    if (written) return { task: written.state, lost: false };
    let read;
    try {
      read = await HistoryLog.open(this.#folderOf(id), this.#files);
    } catch (error) {
      throw new SessionStoreError(
        unreachable(error) ? "unavailable" : "corrupted",
        unreachable(error)
          ? "This conversation could not be read."
          : "This conversation is damaged and cannot be opened safely.",
        { cause: error },
      );
    }
    if (
      !isWorkspaceTask(read.state) ||
      (read.state as { id: unknown }).id !== id
    )
      throw new SessionStoreError(
        "corrupted",
        "This conversation is damaged and cannot be opened safely.",
      );
    const task = read.state as WorkspaceTask;
    this.#conversations.set(id, { log: read.log, state: task });
    return { task, lost: read.lost };
  }

  /** Every conversation opened. One that will not open fails the whole read. */
  async loadAll(): Promise<SavedWorkspace | undefined> {
    const index = await this.loadIndex();
    if (!index) return undefined;
    const opened = await Promise.all(
      index.conversations.map((item) => this.open(item.id)),
    );
    return {
      ...settingsOf(index),
      tasks: opened.map((item) => item.task),
      selectedTaskId: index.selectedTaskId,
    };
  }

  /**
   * Writes what changed since the last save. Conversations are written before
   * the list that names them, and removed after it stops naming them, so the
   * list never names a conversation that is not on disk.
   */
  async save(workspace: SavedWorkspace, commit: () => boolean): Promise<void> {
    const opened = new Map(workspace.tasks.map((task) => [task.id, task]));
    const conversations = (workspace.conversations ?? workspace.tasks).map(
      (item) => summaryOf(opened.get(item.id) ?? item),
    );
    const next: IndexState = {
      version: 2,
      ...settingsOf(workspace),
      selectedTaskId: workspace.selectedTaskId,
      conversations,
    };
    // A list that exists but will not open is refused, never written over:
    // what it held is for the person to recover or discard.
    if (
      !this.#index &&
      (await HistoryLog.exists(this.#indexFolder, this.#files))
    )
      await this.loadIndex();
    const listed = new Set(conversations.map((item) => item.id));
    const before = new Set(
      this.#index?.state.conversations.map((item) => item.id) ?? [],
    );
    const writes: (() => Promise<void>)[] = [];
    for (const task of workspace.tasks) {
      if (!listed.has(task.id)) continue;
      // A listed conversation this store has not read yet is read first, so
      // only the difference is written; one that will not open is refused
      // rather than written over.
      if (!this.#conversations.has(task.id) && before.has(task.id))
        await this.open(task.id);
      const written = this.#conversations.get(task.id);
      if (!written) {
        writes.push(async () => {
          const log = await HistoryLog.create(
            this.#folderOf(task.id),
            task,
            this.#files,
          );
          this.#conversations.set(task.id, { log, state: task });
        });
        continue;
      }
      if (written.state === task) continue;
      const changes = changesBetween(written.state, task);
      writes.push(async () => {
        await written.log.write(changes, task);
        written.state = task;
      });
    }
    if (!commit()) return;
    try {
      await Promise.all(writes.map((write) => write()));
      if (!this.#index)
        this.#index = {
          log: await HistoryLog.create(this.#indexFolder, next, this.#files),
          state: next,
        };
      else {
        await this.#index.log.write(
          changesBetween(this.#index.state, next),
          next,
        );
        this.#index.state = next;
      }
    } catch (error) {
      throw new SessionStoreError(
        "unavailable",
        "Task history could not be saved.",
        { cause: error },
      );
    }
    for (const id of before) {
      if (listed.has(id)) continue;
      this.#conversations.delete(id);
      await rm(this.#folderOf(id), { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
  }

  /** Every conversation folder, read without changing anything. */
  async #survey(): Promise<{
    readonly readable: {
      readonly log: HistoryLog;
      readonly task: WorkspaceTask;
    }[];
    readonly damaged: string[];
  }> {
    const readable: { log: HistoryLog; task: WorkspaceTask }[] = [];
    const damaged: string[] = [];
    for (const name of await this.#files.names(this.#conversationsFolder)) {
      try {
        const read = await HistoryLog.open(
          join(this.#conversationsFolder, name),
          this.#files,
        );
        if (!isWorkspaceTask(read.state))
          throw new Error("Not a conversation.");
        readable.push({ log: read.log, task: read.state as WorkspaceTask });
      } catch {
        damaged.push(name);
      }
    }
    return { readable, damaged };
  }

  /**
   * What is left of a history whose list will not open, without changing it.
   * `partial` means some conversations can still be read on their own.
   */
  async inspectDamage(): Promise<DamageReport> {
    const { readable, damaged } = await this.#survey();
    return readable.length
      ? { kind: "partial", readable: readable.length, damaged: damaged.length }
      : { kind: "unreadable" };
  }

  /**
   * Copies the list and every conversation that will not open somewhere they
   * will not be written over, and leaves the originals where they are. Every
   * copy is kept: a second damaged launch must not erase the first's.
   */
  async preserveDamaged(): Promise<string> {
    const kept = join(
      this.#directory,
      "damaged-history",
      `history-${stampOf(this.#now())}`,
    );
    try {
      await mkdir(kept, { recursive: true });
      if ((await this.#files.names(this.#indexFolder)).length)
        await cp(this.#indexFolder, join(kept, "index"), { recursive: true });
      for (const name of (await this.#survey()).damaged)
        await cp(
          join(this.#conversationsFolder, name),
          join(kept, "conversations", name),
          { recursive: true },
        );
    } catch (error) {
      throw new SessionStoreError(
        "unavailable",
        "The damaged history could not be read in order to keep it.",
        { cause: error },
      );
    }
    return kept;
  }

  /**
   * Keeps the damage, then starts the list afresh from the conversations that
   * open on their own. A history with nothing readable is refused rather than
   * turned into an empty one: starting over is the person's choice.
   */
  async recoverReadable(): Promise<{
    readonly recovered: number;
    readonly discarded: number;
    readonly kept: string;
  }> {
    const { readable, damaged } = await this.#survey();
    if (!readable.length)
      throw new SessionStoreError(
        "corrupted",
        "Nothing in the saved history could be read, so there is nothing to recover.",
      );
    const kept = await this.preserveDamaged();
    const previous = await this.#previousIndex();
    const order = new Map(
      (Array.isArray(previous?.conversations) ? previous.conversations : [])
        .filter(isRecord)
        .map((item, index) => [item.id, index] as const),
    );
    const tasks = readable
      .sort(
        (a, b) =>
          (order.get(a.task.id) ?? order.size) -
            (order.get(b.task.id) ?? order.size) ||
          (b.task.updatedAt ?? "").localeCompare(a.task.updatedAt ?? ""),
      )
      .map((item) => item.task);
    // Each setting that is sound on its own survives, whatever else in the
    // list was damaged: losing them would make recovery a fresh install.
    const settings = Object.fromEntries(
      (["preferences", "workspace", "recentWorkspaces"] as const)
        .filter(
          (key) =>
            previous?.[key] !== undefined &&
            isSavedIndex({
              version: 2,
              selectedTaskId: null,
              conversations: [],
              [key]: previous[key],
            }),
        )
        .map((key) => [key, previous?.[key]]),
    ) as Omit<SavedIndex, "conversations" | "selectedTaskId">;
    const selected =
      typeof previous?.selectedTaskId === "string" &&
      tasks.some((task) => task.id === previous.selectedTaskId)
        ? previous.selectedTaskId
        : (tasks[0]?.id ?? null);

    await rm(this.#indexFolder, { recursive: true, force: true });
    for (const name of damaged)
      await rm(join(this.#conversationsFolder, name), {
        recursive: true,
        force: true,
      });
    this.#index = undefined;
    this.#conversations.clear();
    for (const item of readable)
      this.#conversations.set(item.task.id, {
        log: item.log,
        state: item.task,
      });
    await this.save(
      {
        ...settings,
        tasks,
        selectedTaskId: selected,
      },
      () => true,
    );
    return { recovered: tasks.length, discarded: damaged.length, kept };
  }

  /** Whatever can still be read of a damaged list, for the settings in it. */
  async #previousIndex(): Promise<Record<string, unknown> | undefined> {
    try {
      const { state } = await HistoryLog.open(this.#indexFolder, this.#files);
      return isRecord(state) ? state : undefined;
    } catch {
      return undefined;
    }
  }
}
