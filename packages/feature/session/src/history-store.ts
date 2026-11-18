/**
 * How the history is read and how a save reaches it.
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
 *
 * Every file says which format it is in and which version wrote it. Settings
 * in an older format are brought to the current one as they are read; a
 * conversation in an older format waits, unopened, until the person updates
 * it; anything a newer version saved is refused and never written over.
 */

import { mkdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ConversationSummary, WorkspaceTask } from "@zhiyin/contract";
import { newestFirst } from "@zhiyin/conversation-rules";
import { changesBetween } from "./history-changes.js";
import { HistoryLog } from "./history-log.js";
import { conversationProblem, isWorkspaceTask } from "./saved-workspace.js";
import { isFolder, isRecord } from "./saved-values.js";
import {
  isConversationSummary,
  isSavedSettings,
  withoutUnlistedLook,
} from "./saved-index.js";
import { personalSettingsOf } from "./saved-settings.js";
import { SessionStoreError } from "./errors.js";
import {
  formatOf,
  migratedSettings,
  standingOf,
  type FileFormat,
} from "./formats.js";
import {
  deleting,
  folderName,
  parsedJson,
  readable,
  stampOf,
  unreachable,
  type HistoryFolder,
} from "./history-folder.js";
import type { WaitingConversations } from "./history-updates.js";
import type { SavedWorkspace } from "./session.js";

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
  /**
   * Conversations a newer version saved. They are not listed, and are left
   * exactly as they are.
   */
  readonly newer?: {
    readonly count: number;
    readonly writtenBy: readonly string[];
  };
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
type Meta = FileFormat &
  ConversationSummary & { readonly conversationBytes: number };

/** A conversation as it was last written, and the log it was written to. */
export type Written = {
  readonly log: HistoryLog;
  state: WorkspaceTask;
  /** A save cut off by a crash was dropped, and nobody has been told yet. */
  lost: boolean;
};

/** What the folder of one conversation was found to hold. */
type Found =
  | { readonly kind: "listed"; readonly summary: ConversationSummary }
  | { readonly kind: "newer"; readonly writtenBy: string }
  | { readonly kind: "lost" };

/**
 * A summary as the list shows it. Its project and folder are passed on only
 * when well formed: one that is not is the conversation's to refuse, when it
 * is opened.
 */
export function summaryOf(item: ConversationSummary): ConversationSummary {
  return {
    id: item.id,
    title: item.title,
    titleSource: item.titleSource,
    updatedAt: item.updatedAt,
    updatedLabel: item.updatedLabel,
    ...(item.project === null || typeof item.project === "string"
      ? { project: item.project }
      : {}),
    ...(isFolder(item.workspace) ? { workspace: item.workspace } : {}),
    ...(item.memoryOff === true ? { memoryOff: true as const } : {}),
  };
}

/** The choices a person made, and nothing only true while the app runs. */
function settingsOf(
  workspace: SavedSettings,
): Omit<SavedSettings, "selectedTaskId"> {
  return {
    ...personalSettingsOf(workspace),
    ...(workspace.workspace ? { workspace: workspace.workspace } : {}),
    ...(workspace.launchFolders?.length
      ? { launchFolders: workspace.launchFolders }
      : {}),
    recentWorkspaces: workspace.recentWorkspaces,
  };
}

export class HistoryStore {
  readonly #folder: HistoryFolder;
  /** Conversations an older version saved, until they are updated. */
  readonly #waiting: WaitingConversations;
  /** Whether what is on disk has been read, so a save knows what it replaces. */
  #loaded = false;
  /** The conversations on disk. */
  #onDisk = new Set<string>();
  /** The settings as last written, to write them only when they change. */
  #settings: string | undefined;
  readonly #conversations = new Map<string, Written>();
  /** Conversations whose summary on disk is missing, broken or behind. */
  readonly #staleMeta = new Set<string>();
  /** The folders of conversations a newer version saved. */
  #newer = new Set<string>();

  constructor(folder: HistoryFolder, waiting: WaitingConversations) {
    this.#folder = folder;
    this.#waiting = waiting;
  }

  /**
   * The light or dark choice alone, read before anything else is. Whatever is
   * wrong with the file is left for the full read to report; this answers
   * nothing instead.
   */
  async savedAppearance(): Promise<SavedSettings["appearance"]> {
    try {
      const bytes = await this.#folder.files.read(this.#folder.settingsFile);
      return bytes ? this.#settingsIn(parsedJson(bytes)).appearance : undefined;
    } catch {
      return undefined;
    }
  }

  /** The look alone, read before anything else is, as the appearance is. */
  async savedLook(): Promise<SavedSettings["look"]> {
    try {
      const bytes = await this.#folder.files.read(this.#folder.settingsFile);
      return bytes ? this.#settingsIn(parsedJson(bytes)).look : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Settings as the current format holds them, from what the file held: an
   * older format is brought to this one, and a newer one is refused.
   */
  #settingsIn(value: unknown): SavedSettings {
    const formats = this.#folder.formats;
    const { standing, format } = standingOf(formats, formatOf(value));
    if (standing === "newer")
      throw new SessionStoreError(
        "newer",
        `Saved task history was saved by Zhiyin ${format.writtenBy}, a newer version, and was left as it is.`,
        { writtenBy: format.writtenBy },
      );
    let settings: unknown = value;
    if (standing === "older")
      try {
        settings = migratedSettings(
          formats,
          value as Record<string, unknown>,
          format.format,
        );
      } catch {
        settings = undefined;
      }
    settings = withoutUnlistedLook(settings);
    if (standing === "unknown" || !isSavedSettings(settings))
      throw new SessionStoreError(
        "corrupted",
        "Saved task history is damaged and cannot be opened safely.",
      );
    return settings;
  }

  /** The settings, or nothing if they were never written. */
  async #readSettings(): Promise<SavedSettings | undefined> {
    let bytes;
    try {
      bytes = await this.#folder.files.read(this.#folder.settingsFile);
    } catch (error) {
      throw new SessionStoreError(
        "unavailable",
        "Saved task history could not be read.",
        { cause: error },
      );
    }
    if (!bytes) return undefined;
    const settings = this.#settingsIn(parsedJson(bytes));
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
   * opened; one with neither is nothing to list. One an older version saved
   * is listed as waiting for an update, from its summary or its first line;
   * one a newer version saved is not listed at all.
   */
  async #summaryIn(name: string): Promise<Found> {
    const history = this.#folder;
    const folder = join(history.conversationsFolder, name);
    let meta: unknown;
    let size: number | undefined;
    try {
      [meta, size] = await Promise.all([
        history.files.read(history.metaOf(folder)).then(parsedJson),
        history.files.size(history.logOf(folder)),
      ]);
    } catch (error) {
      throw new SessionStoreError(
        "unavailable",
        "Saved task history could not be read.",
        { cause: error },
      );
    }
    const { standing: metaStanding, format: metaFormat } = standingOf(
      history.formats,
      formatOf(meta),
    );
    const summary =
      metaStanding === "current" &&
      isConversationSummary(meta) &&
      folderName(meta.id) === name
        ? summaryOf(meta)
        : undefined;
    if (
      isRecord(meta) &&
      meta.conversationBytes === size &&
      size !== undefined &&
      typeof meta.id === "string" &&
      folderName(meta.id) === name
    ) {
      if (summary) return { kind: "listed", summary };
      if (metaStanding === "newer")
        return { kind: "newer", writtenBy: metaFormat.writtenBy };
      if (metaStanding === "older")
        return {
          kind: "listed",
          summary: this.#waiting.add(name, meta.id, meta, metaFormat),
        };
    }
    try {
      const read = await HistoryLog.open(
        history.logOf(folder),
        history.files,
        history.format,
      );
      const { standing, format } = standingOf(
        history.formats,
        formatOf(read.header),
      );
      if (standing === "newer")
        return { kind: "newer", writtenBy: format.writtenBy };
      const id = isRecord(read.state) ? read.state.id : undefined;
      if (
        standing === "older" &&
        typeof id === "string" &&
        folderName(id) === name
      )
        return {
          kind: "listed",
          summary: this.#waiting.add(
            name,
            id,
            read.state as Record<string, unknown>,
            format,
          ),
        };
      if (
        standing !== "current" ||
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
      return { kind: "listed", summary: summaryOf(task) };
    } catch (error) {
      if (unreachable(error))
        throw new SessionStoreError(
          "unavailable",
          "Saved task history could not be read.",
          { cause: error },
        );
      return summary ? { kind: "listed", summary } : { kind: "lost" };
    }
  }

  /** Moves folders that hold nothing readable out of the history, together. */
  async #setAside(names: readonly string[]): Promise<string> {
    const folder = this.#folder;
    const kept = join(
      folder.directory,
      "damaged-history",
      `conversations-${stampOf(folder.now())}`,
    );
    await mkdir(kept, { recursive: true });
    for (const name of names)
      await rename(join(folder.conversationsFolder, name), join(kept, name));
    return kept;
  }

  /** The list and the choices, or nothing on a first launch. */
  async loadIndex(): Promise<SavedIndex | undefined> {
    const settings = await this.#readSettings();
    const names = await this.#folder.folders();
    this.#waiting.clear();
    this.#newer = new Set();
    if (!settings && !names.length) {
      this.#loaded = true;
      return undefined;
    }
    const found = await Promise.all(
      names.map(async (name) => ({
        name,
        found: await this.#summaryIn(name),
      })),
    );
    const conversations = found
      .flatMap((item) =>
        item.found.kind === "listed" ? [item.found.summary] : [],
      )
      .sort(newestFirst);
    const lost = found
      .filter((item) => item.found.kind === "lost")
      .map((item) => item.name);
    const newer = found.flatMap((item) =>
      item.found.kind === "newer" ? [item.found.writtenBy] : [],
    );
    this.#newer = new Set(
      found
        .filter((item) => item.found.kind === "newer")
        .map((item) => item.name),
    );
    const keptAt = lost.length
      ? await this.#setAside(lost).catch(() => this.#folder.conversationsFolder)
      : undefined;
    this.#onDisk = new Set(
      conversations.filter((item) => !item.needsUpdate).map((item) => item.id),
    );
    this.#loaded = true;
    return {
      ...(settings ? settingsOf(settings) : { recentWorkspaces: [] }),
      // A selection names a conversation listed here; one gone from disk is none.
      selectedTaskId: conversations.some(
        (item) => item.id === settings?.selectedTaskId,
      )
        ? settings!.selectedTaskId
        : null,
      conversations,
      ...(keptAt ? { setAside: { count: lost.length, keptAt } } : {}),
      ...(newer.length
        ? { newer: { count: newer.length, writtenBy: [...new Set(newer)] } }
        : {}),
    };
  }

  /**
   * Reads what is on disk if it has not been read yet, so a write knows what
   * it replaces.
   */
  async ensureLoaded(): Promise<void> {
    if (!this.#loaded) await this.loadIndex();
  }

  /** One conversation, read from its own file the first time it is asked for. */
  async open(id: string): Promise<OpenedConversation> {
    const written = this.#conversations.get(id);
    if (written) {
      const lost = written.lost;
      written.lost = false;
      return { task: written.state, lost };
    }
    const folder = this.#folder;
    let read;
    try {
      read = await HistoryLog.open(
        folder.logOf(folder.folderOf(id)),
        folder.files,
        folder.format,
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
    const { standing, format } = standingOf(
      folder.formats,
      formatOf(read.header),
    );
    if (standing === "newer")
      throw new SessionStoreError(
        "newer",
        `This conversation was saved by Zhiyin ${format.writtenBy}, a newer version, and was left as it is.`,
        { writtenBy: format.writtenBy },
      );
    if (standing === "older")
      throw new SessionStoreError(
        "outdated",
        `This conversation was saved by Zhiyin ${format.writtenBy} and needs an update before it opens.`,
        { writtenBy: format.writtenBy },
      );
    const problem =
      standing !== "current"
        ? "it was saved in a form this version does not read"
        : (conversationProblem(read.state) ??
          ((read.state as { id: unknown }).id !== id
            ? "it is saved where another conversation belongs"
            : undefined));
    if (problem)
      throw new SessionStoreError(
        "corrupted",
        `This conversation is damaged and cannot be opened safely: ${problem}.`,
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
    const folder = this.#folder;
    const meta: Meta = {
      ...folder.format,
      ...summaryOf(written.state),
      conversationBytes: written.log.size,
    };
    await folder.files
      .write(folder.metaOf(folder.folderOf(written.state.id)), readable(meta))
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
    const folder = this.#folder;
    // Settings that exist but will not open are refused, never written over:
    // what they held is for the person to recover or discard.
    await this.ensureLoaded();
    const listed = new Set(
      (workspace.conversations ?? workspace.tasks).map((item) => item.id),
    );
    const writes: (() => Promise<void>)[] = [];
    // A conversation another version saved is never written over: one an
    // older version saved waits for the person, one a newer saved is theirs.
    const untouchable = new Set([...this.#waiting.folders(), ...this.#newer]);
    for (const task of workspace.tasks) {
      if (!listed.has(task.id) || untouchable.has(folderName(task.id)))
        continue;
      // A listed conversation this store has not read yet is read first, so
      // only the difference is written; one that will not open is refused
      // rather than written over.
      if (!this.#conversations.has(task.id) && this.#onDisk.has(task.id))
        await this.open(task.id);
      const written = this.#conversations.get(task.id);
      if (!written) {
        writes.push(async () => {
          const log = await HistoryLog.create(
            folder.logOf(folder.folderOf(task.id)),
            task,
            folder.files,
            folder.format,
          );
          const created = { log, state: task, lost: false };
          this.#conversations.set(task.id, created);
          this.#onDisk.add(task.id);
          await this.#writeMeta(created);
        });
        continue;
      }
      const changes =
        written.state === task ? [] : changesBetween(written.state, task);
      if (!changes.length) {
        // A save a crash cut off was reported when the conversation was read;
        // cut off at the next save, it is not reported again. A cut the disk
        // refuses just now is tried again at the save after.
        if (written.log.cutOff || this.#staleMeta.has(task.id))
          writes.push(async () => {
            await written.log.settle().catch(() => undefined);
            await this.#writeMeta(written);
          });
        continue;
      }
      writes.push(async () => {
        await written.log.write(changes, task);
        written.state = task;
        await this.#writeMeta(written);
      });
    }
    const settings = readable({
      ...folder.format,
      ...settingsOf(workspace),
      selectedTaskId: workspace.selectedTaskId,
    });
    if (!commit()) return;
    try {
      // Every write ends before the save does, failed or not: one still under
      // way when the next save begins would have that save write its edits
      // again.
      const failed = (
        await Promise.allSettled(writes.map((write) => write()))
      ).find((result) => result.status === "rejected");
      if (failed) throw failed.reason;
      if (settings !== this.#settings) {
        await folder.files.create(folder.settingsFile, settings);
        this.#settings = settings;
      }
    } catch (error) {
      throw new SessionStoreError(
        "unavailable",
        "Task history could not be saved.",
        { cause: error },
      );
    }
    for (const id of [...this.#onDisk]) {
      if (listed.has(id)) continue;
      this.#conversations.delete(id);
      this.#staleMeta.delete(id);
      const removed = folder.folderOf(id);
      // A folder Windows will not let go of, such as one holding a file
      // another program has open, stays on disk: the next save tries again.
      const moved = await rename(removed, `${removed}${deleting}`).then(
        () => true,
        (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT",
      );
      if (!moved) continue;
      this.#onDisk.delete(id);
      await rm(`${removed}${deleting}`, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
  }

  /**
   * Starts over from these conversations alone, as read from disk, with no
   * settings written yet: what repairing a damaged history leaves.
   */
  restart(readable: readonly Written[]): void {
    this.#settings = undefined;
    this.#conversations.clear();
    this.#staleMeta.clear();
    for (const item of readable) {
      this.#conversations.set(item.state.id, item);
      this.#staleMeta.add(item.state.id);
    }
    this.#onDisk = new Set(readable.map((item) => item.state.id));
    this.#loaded = true;
  }

  /** Takes in a conversation just updated on disk, and writes its summary. */
  async adopt(written: Written): Promise<void> {
    this.#conversations.set(written.state.id, written);
    this.#onDisk.add(written.state.id);
    await this.#writeMeta(written);
  }

  /** Whether a conversation's folder is still on disk. */
  holds(id: string): boolean {
    return this.#onDisk.has(id);
  }

  /** The same, asked of the disk, before the history is read. */
  async hasFolder(id: string): Promise<boolean> {
    return stat(this.#folder.folderOf(id)).then(
      () => true,
      (error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
      },
    );
  }
}
