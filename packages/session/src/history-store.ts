/**
 * Where the history lives on disk, and how a save reaches it.
 *
 * Each conversation is a folder holding the conversation, as a file that only
 * grows, and a small summary of it for the list. The choices a person made are
 * one more file beside them. There is no list of conversations on disk: the
 * list is the folders, read through their summaries and ordered by when each
 * conversation last changed, so a conversation is started, renamed or deleted
 * by touching its own folder and nothing else.
 *
 * A save compares what it is given with what it last wrote and appends only
 * the difference, so streaming a reply writes the words that arrived. Nothing
 * is compared or written by callers: whatever the app holds is what is saved,
 * so no part of the app has to remember to report its change.
 */

import { cp, mkdir, rename, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { ConversationSummary, WorkspaceTask } from "@zhiyin/contract";
import { changesBetween } from "./history-changes.js";
import { HistoryLog, type HistoryFiles } from "./history-log.js";
import { isRecord, isWorkspaceTask } from "./saved-workspace.js";
import { isConversationSummary, isSavedSettings } from "./saved-index.js";
import { SessionStoreError } from "./errors.js";
import type { DamageReport, SavedWorkspace } from "./index.js";

/** The choices a person made. */
export type SavedSettings = Omit<SavedWorkspace, "tasks" | "conversations">;

/** The list of conversations and the choices, read without opening any. */
export type SavedIndex = SavedSettings & {
  /** Newest first: the conversation changed last leads. */
  readonly conversations: readonly ConversationSummary[];
  /**
   * Conversations that could not be read at all, not even their summary.
   * They were moved to `keptAt`, so they are reported once.
   */
  readonly setAside?: { readonly count: number; readonly keptAt: string };
};

/** A conversation read from disk. */
export type OpenedConversation = {
  readonly task: WorkspaceTask;
  /** Whether the last save before the app closed was cut off and dropped. */
  readonly lost: boolean;
};

/**
 * A conversation's summary as kept on disk. `conversationBytes` is how long
 * the conversation's file was when the summary was written: a summary that
 * disagrees with it is from before the last save, and is not trusted.
 */
type Meta = ConversationSummary & { readonly conversationBytes: number };

/** A conversation as it was last written, and the log it was written to. */
type Written = {
  readonly log: HistoryLog;
  state: WorkspaceTask;
  /** A save cut off by a crash was dropped, and nobody has been told yet. */
  lost: boolean;
};

export function summaryOf(item: ConversationSummary): ConversationSummary {
  return {
    id: item.id,
    title: item.title,
    ...(item.titleSource ? { titleSource: item.titleSource } : {}),
    ...(item.updatedAt ? { updatedAt: item.updatedAt } : {}),
    updatedLabel: item.updatedLabel,
  };
}

/**
 * The order conversations are listed in: the one changed last first, then
 * those never dated; any tie by id, so the order is the same at every launch.
 */
function newestFirst(a: ConversationSummary, b: ConversationSummary): number {
  if (a.updatedAt !== b.updatedAt) {
    if (a.updatedAt === undefined) return 1;
    if (b.updatedAt === undefined) return -1;
    return a.updatedAt < b.updatedAt ? 1 : -1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The choices a person made, and nothing only true while the app runs. */
function settingsOf(
  workspace: SavedSettings,
): Omit<SavedSettings, "selectedTaskId"> {
  return {
    ...(workspace.preferences ? { preferences: workspace.preferences } : {}),
    ...(workspace.contextBudget
      ? { contextBudget: workspace.contextBudget }
      : {}),
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
export function folderName(id: string): string {
  return /^[A-Za-z0-9_-]{1,64}$/.test(id)
    ? `c-${id}`
    : `h-${createHash("sha256").update(id).digest("hex").slice(0, 32)}`;
}

/** A folder being deleted: renamed first, so half a deletion is never listed. */
const deleting = ".deleting";

/** A read that failed because of the disk, not because of what was on it. */
function unreachable(error: unknown): boolean {
  return (
    isRecord(error) && typeof error.code === "string" && error.code !== "EISDIR"
  );
}

function stampOf(now: Date): string {
  return now.toISOString().replace(/[:.]/g, "-");
}

function parsedJson(bytes: Buffer | undefined): unknown {
  if (!bytes) return undefined;
  try {
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    return undefined;
  }
}

function readable(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export class HistoryStore {
  readonly #directory: string;
  readonly #files: HistoryFiles;
  readonly #now: () => Date;
  /** Whether what is on disk has been read, so a save knows what it replaces. */
  #loaded = false;
  /** The conversations on disk. */
  #onDisk = new Set<string>();
  /** The settings as last written, to write them only when they change. */
  #settings: string | undefined;
  readonly #conversations = new Map<string, Written>();
  /** Conversations whose summary on disk is missing, broken or behind. */
  readonly #staleMeta = new Set<string>();

  constructor(directory: string, files: HistoryFiles, now: () => Date) {
    this.#directory = directory;
    this.#files = files;
    this.#now = now;
  }

  get #settingsFile(): string {
    return join(this.#directory, "history", "settings.json");
  }

  get #conversationsFolder(): string {
    return join(this.#directory, "history", "conversations");
  }

  #folderOf(id: string): string {
    return join(this.#conversationsFolder, folderName(id));
  }

  #logOf(folder: string): string {
    return join(folder, "conversation.jsonl");
  }

  #metaOf(folder: string): string {
    return join(folder, "meta.json");
  }

  /** The conversation folders, finishing any deletion a crash interrupted. */
  async #folders(): Promise<string[]> {
    const names = await this.#files.names(this.#conversationsFolder);
    for (const name of names.filter((item) => item.endsWith(deleting)))
      await rm(join(this.#conversationsFolder, name), {
        recursive: true,
        force: true,
      }).catch(() => undefined);
    return names.filter((item) => !item.endsWith(deleting));
  }

  /** The settings, or nothing if they were never written. */
  async #readSettings(): Promise<SavedSettings | undefined> {
    let bytes;
    try {
      bytes = await this.#files.read(this.#settingsFile);
    } catch (error) {
      throw new SessionStoreError(
        "unavailable",
        "Saved task history could not be read.",
        { cause: error },
      );
    }
    if (!bytes) return undefined;
    const settings = parsedJson(bytes);
    if (!isSavedSettings(settings))
      throw new SessionStoreError(
        "corrupted",
        "Saved task history is damaged and cannot be opened safely.",
      );
    this.#settings = bytes.toString("utf8");
    return {
      ...settingsOf(settings),
      selectedTaskId: settings.selectedTaskId,
    };
  }

  /**
   * What the list shows about the conversation in this folder: its summary
   * when that is current, otherwise the conversation itself. A conversation
   * whose file will not open is listed from its summary, and fails when it is
   * opened; one with neither is nothing to list.
   */
  async #summaryIn(name: string): Promise<ConversationSummary | undefined> {
    const folder = join(this.#conversationsFolder, name);
    let meta: unknown;
    let size: number | undefined;
    try {
      [meta, size] = await Promise.all([
        this.#files.read(this.#metaOf(folder)).then(parsedJson),
        this.#files.size(this.#logOf(folder)),
      ]);
    } catch (error) {
      throw new SessionStoreError(
        "unavailable",
        "Saved task history could not be read.",
        { cause: error },
      );
    }
    const summary =
      isConversationSummary(meta) && folderName(meta.id) === name
        ? summaryOf(meta)
        : undefined;
    if (
      summary &&
      (meta as Partial<Meta>).conversationBytes === size &&
      size !== undefined
    )
      return summary;
    try {
      const read = await HistoryLog.open(this.#logOf(folder), this.#files);
      if (
        !isWorkspaceTask(read.state) ||
        folderName((read.state as WorkspaceTask).id) !== name
      )
        throw new Error("Not this folder's conversation.");
      const task = read.state as WorkspaceTask;
      this.#conversations.set(task.id, {
        log: read.log,
        state: task,
        lost: read.lost,
      });
      this.#staleMeta.add(task.id);
      return summaryOf(task);
    } catch (error) {
      if (unreachable(error))
        throw new SessionStoreError(
          "unavailable",
          "Saved task history could not be read.",
          { cause: error },
        );
      return summary;
    }
  }

  /** Moves folders that hold nothing readable out of the history, together. */
  async #setAside(names: readonly string[]): Promise<string> {
    const kept = join(
      this.#directory,
      "damaged-history",
      `conversations-${stampOf(this.#now())}`,
    );
    await mkdir(kept, { recursive: true });
    for (const name of names)
      await rename(join(this.#conversationsFolder, name), join(kept, name));
    return kept;
  }

  /** The list and the choices, or nothing on a first launch. */
  async loadIndex(): Promise<SavedIndex | undefined> {
    const settings = await this.#readSettings();
    const names = await this.#folders();
    if (!settings && !names.length) {
      this.#loaded = true;
      return undefined;
    }
    const found = await Promise.all(
      names.map(async (name) => ({
        name,
        summary: await this.#summaryIn(name),
      })),
    );
    const conversations = found
      .flatMap((item) => (item.summary ? [item.summary] : []))
      .sort(newestFirst);
    const lost = found.filter((item) => !item.summary).map((item) => item.name);
    const keptAt = lost.length
      ? await this.#setAside(lost).catch(() => this.#conversationsFolder)
      : undefined;
    this.#onDisk = new Set(conversations.map((item) => item.id));
    this.#loaded = true;
    return {
      ...(settings ? settingsOf(settings) : {}),
      selectedTaskId: settings?.selectedTaskId ?? null,
      conversations,
      ...(keptAt ? { setAside: { count: lost.length, keptAt } } : {}),
    };
  }

  /** One conversation, read from its own file the first time it is asked for. */
  async open(id: string): Promise<OpenedConversation> {
    const written = this.#conversations.get(id);
    if (written) {
      const lost = written.lost;
      written.lost = false;
      return { task: written.state, lost };
    }
    let read;
    try {
      read = await HistoryLog.open(
        this.#logOf(this.#folderOf(id)),
        this.#files,
      );
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
    this.#conversations.set(id, { log: read.log, state: task, lost: false });
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
   * The summary beside a conversation, after the conversation is saved. It is
   * only a copy, so a failure to write it is not a failed save: it is found
   * behind at the next launch and rebuilt from the conversation.
   */
  async #writeMeta(written: Written): Promise<void> {
    const meta: Meta = {
      ...summaryOf(written.state),
      conversationBytes: written.log.size,
    };
    await this.#files
      .write(this.#metaOf(this.#folderOf(written.state.id)), readable(meta))
      .then(
        () => this.#staleMeta.delete(written.state.id),
        () => undefined,
      );
  }

  /**
   * Writes what changed since the last save: each conversation that changed
   * in its own folder, then the settings, then removes the folders of
   * conversations no longer listed.
   */
  async save(workspace: SavedWorkspace, commit: () => boolean): Promise<void> {
    // Settings that exist but will not open are refused, never written over:
    // what they held is for the person to recover or discard.
    if (!this.#loaded) await this.loadIndex();
    const listed = new Set(
      (workspace.conversations ?? workspace.tasks).map((item) => item.id),
    );
    const writes: (() => Promise<void>)[] = [];
    for (const task of workspace.tasks) {
      if (!listed.has(task.id)) continue;
      // A listed conversation this store has not read yet is read first, so
      // only the difference is written; one that will not open is refused
      // rather than written over.
      if (!this.#conversations.has(task.id) && this.#onDisk.has(task.id))
        await this.open(task.id);
      const written = this.#conversations.get(task.id);
      if (!written) {
        writes.push(async () => {
          const log = await HistoryLog.create(
            this.#logOf(this.#folderOf(task.id)),
            task,
            this.#files,
          );
          const created = { log, state: task, lost: false };
          this.#conversations.set(task.id, created);
          this.#onDisk.add(task.id);
          await this.#writeMeta(created);
        });
        continue;
      }
      if (written.state === task) {
        if (this.#staleMeta.has(task.id))
          writes.push(() => this.#writeMeta(written));
        continue;
      }
      const changes = changesBetween(written.state, task);
      writes.push(async () => {
        await written.log.write(changes, task);
        written.state = task;
        await this.#writeMeta(written);
      });
    }
    const settings = readable({
      version: 3,
      ...settingsOf(workspace),
      selectedTaskId: workspace.selectedTaskId,
    });
    if (!commit()) return;
    try {
      await Promise.all(writes.map((write) => write()));
      if (settings !== this.#settings) {
        await this.#files.create(this.#settingsFile, settings);
        this.#settings = settings;
      }
    } catch (error) {
      throw new SessionStoreError(
        "unavailable",
        "Task history could not be saved.",
        { cause: error },
      );
    }
    for (const id of this.#onDisk) {
      if (listed.has(id)) continue;
      this.#onDisk.delete(id);
      this.#conversations.delete(id);
      this.#staleMeta.delete(id);
      const folder = this.#folderOf(id);
      await rename(folder, `${folder}${deleting}`)
        .then(() =>
          rm(`${folder}${deleting}`, { recursive: true, force: true }),
        )
        .catch(() => undefined);
    }
  }

  /** Every conversation folder, read without changing anything. */
  async #survey(): Promise<{
    readonly readable: Written[];
    readonly damaged: string[];
  }> {
    const found: Written[] = [];
    const damaged: string[] = [];
    for (const name of await this.#folders()) {
      try {
        const read = await HistoryLog.open(
          this.#logOf(join(this.#conversationsFolder, name)),
          this.#files,
        );
        if (!isWorkspaceTask(read.state))
          throw new Error("Not a conversation.");
        found.push({
          log: read.log,
          state: read.state as WorkspaceTask,
          lost: read.lost,
        });
      } catch {
        damaged.push(name);
      }
    }
    return { readable: found, damaged };
  }

  /**
   * What is left of a history whose settings will not open, without changing
   * it. `partial` means some conversations can still be read on their own.
   */
  async inspectDamage(): Promise<DamageReport> {
    const { readable: found, damaged } = await this.#survey();
    return found.length
      ? { kind: "partial", readable: found.length, damaged: damaged.length }
      : { kind: "unreadable" };
  }

  /**
   * Copies the settings and every conversation that will not open somewhere
   * they will not be written over, and leaves the originals where they are.
   * Every copy is kept: a second damaged launch must not erase the first's.
   */
  async preserveDamaged(): Promise<string> {
    const kept = join(
      this.#directory,
      "damaged-history",
      `history-${stampOf(this.#now())}`,
    );
    try {
      await mkdir(kept, { recursive: true });
      if ((await this.#files.size(this.#settingsFile)) !== undefined)
        await cp(this.#settingsFile, join(kept, "settings.json"));
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
   * Keeps the damage, then starts the settings afresh, keeping each one that
   * is sound on its own, with the conversations that open. A history with
   * nothing readable is refused rather than turned into an empty one: starting
   * over is the person's choice.
   */
  async recoverReadable(): Promise<{
    readonly recovered: number;
    readonly discarded: number;
    readonly kept: string;
  }> {
    const { readable: found, damaged } = await this.#survey();
    if (!found.length)
      throw new SessionStoreError(
        "corrupted",
        "Nothing in the saved history could be read, so there is nothing to recover.",
      );
    const kept = await this.preserveDamaged();
    const previous = await this.#previousSettings();
    // Each setting that is sound on its own survives, whatever else in the
    // settings was damaged: losing them would make recovery a fresh install.
    const settings = Object.fromEntries(
      (["preferences", "workspace", "recentWorkspaces"] as const)
        .filter(
          (key) =>
            previous?.[key] !== undefined &&
            isSavedSettings({
              version: 3,
              selectedTaskId: null,
              [key]: previous[key],
            }),
        )
        .map((key) => [key, previous?.[key]]),
    ) as Omit<SavedSettings, "selectedTaskId">;
    const tasks = found.map((item) => item.state);
    const selected =
      typeof previous?.selectedTaskId === "string" &&
      tasks.some((task) => task.id === previous.selectedTaskId)
        ? previous.selectedTaskId
        : ([...tasks].sort(newestFirst)[0]?.id ?? null);

    await rm(this.#settingsFile, { force: true });
    for (const name of damaged)
      await rm(join(this.#conversationsFolder, name), {
        recursive: true,
        force: true,
      });
    this.#settings = undefined;
    this.#conversations.clear();
    for (const item of found) {
      this.#conversations.set(item.state.id, item);
      this.#staleMeta.add(item.state.id);
    }
    this.#onDisk = new Set(tasks.map((task) => task.id));
    this.#loaded = true;
    await this.save(
      { ...settings, tasks, selectedTaskId: selected },
      () => true,
    );
    return { recovered: tasks.length, discarded: damaged.length, kept };
  }

  /** Whatever can still be read of damaged settings. */
  async #previousSettings(): Promise<Record<string, unknown> | undefined> {
    const settings = parsedJson(
      await this.#files.read(this.#settingsFile).catch(() => undefined),
    );
    return isRecord(settings) ? settings : undefined;
  }
}
