/**
 * Conversations an older version saved. Each waits, unopened and never
 * written over, until the person has it updated to the current format or
 * moved to the Recycle Bin. ADR 0025.
 */

import { join } from "node:path";
import type { ConversationSummary, WorkspaceTask } from "@zhiyin/contract";
import type { RecycleBin } from "@zhiyin/files";
import { HistoryLog } from "./history-log.js";
import { isWorkspaceTask } from "./saved-workspace.js";
import { SessionStoreError } from "./errors.js";
import {
  formatOf,
  migratedConversation,
  standingOf,
  type FileFormat,
} from "./formats.js";
import type { HistoryFolder } from "./history-folder.js";
import { newestFirst } from "@zhiyin/conversation-rules";
import { summaryOf, type HistoryStore, type Written } from "./history-store.js";

/** What became of the conversations waiting for an update. */
export type UpdateResult = {
  /** As the list now shows them, newest first. */
  readonly updated: readonly ConversationSummary[];
  /** Left exactly as they were, still waiting. */
  readonly failed: number;
};

export type RecycleResult = {
  /** The ids of those moved to the Recycle Bin, newest first. */
  readonly recycled: readonly string[];
  /** Left in place, still waiting. */
  readonly failed: number;
};

/** A conversation an older version saved, waiting for the person. */
type Waiting = {
  readonly name: string;
  readonly summary: ConversationSummary;
};

/** What the list can show of a conversation an older version saved. */
function waitingSummary(
  id: string,
  source: Record<string, unknown>,
  format: FileFormat,
): ConversationSummary {
  return {
    id,
    title: typeof source.title === "string" ? source.title : "A conversation",
    titleSource: source.titleSource === "manual" ? "manual" : "generated",
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : "",
    updatedLabel:
      typeof source.updatedLabel === "string" ? source.updatedLabel : "",
    needsUpdate: { writtenBy: format.writtenBy },
  };
}

/** The conversations found waiting when the list was last read, by id. */
export class WaitingConversations {
  readonly #waiting = new Map<string, Waiting>();

  /** Forgets them all, before the list is read again. */
  clear(): void {
    this.#waiting.clear();
  }

  /**
   * Notes the conversation in folder `name` as waiting, and answers what the
   * list shows of it, from its summary or its first line.
   */
  add(
    name: string,
    id: string,
    source: Record<string, unknown>,
    format: FileFormat,
  ): ConversationSummary {
    const summary = waitingSummary(id, source, format);
    this.#waiting.set(id, { name, summary });
    return summary;
  }

  /** The folders of those waiting, which no save may write over. */
  folders(): string[] {
    return [...this.#waiting.values()].map((item) => item.name);
  }

  /** Those waiting, as the list orders them. */
  inOrder(): [string, Waiting][] {
    return [...this.#waiting].sort(([, a], [, b]) =>
      newestFirst(a.summary, b.summary),
    );
  }

  delete(id: string): void {
    this.#waiting.delete(id);
  }
}

export class ConversationUpdates {
  readonly #folder: HistoryFolder;
  readonly #waiting: WaitingConversations;
  readonly #store: Pick<HistoryStore, "ensureLoaded" | "adopt">;

  constructor(
    folder: HistoryFolder,
    waiting: WaitingConversations,
    store: Pick<HistoryStore, "ensureLoaded" | "adopt">,
  ) {
    this.#folder = folder;
    this.#waiting = waiting;
    this.#store = store;
  }

  /**
   * Brings every conversation waiting for an update to the current format, one
   * at a time. One that cannot be updated is left exactly as it was, and is
   * still waiting.
   */
  async updateWaiting(): Promise<UpdateResult> {
    await this.#store.ensureLoaded();
    const updated: ConversationSummary[] = [];
    let failed = 0;
    for (const [id, waiting] of this.#waiting.inOrder())
      try {
        updated.push(summaryOf((await this.#update(id, waiting)).state));
      } catch {
        failed += 1;
      }
    return { updated, failed };
  }

  /**
   * The updated log is written beside the original and read back with this
   * version's reader; only a copy that reads back as the update made it is
   * renamed over the original, in one step.
   */
  async #update(id: string, waiting: Waiting): Promise<Written> {
    const folder = this.#folder;
    const path = folder.logOf(join(folder.conversationsFolder, waiting.name));
    const read = await HistoryLog.open(path, folder.files);
    const { standing, format } = standingOf(
      folder.formats,
      formatOf(read.header),
    );
    if (standing !== "older")
      throw new Error("This conversation is not waiting for an update.");
    const state = migratedConversation(
      folder.formats,
      read.state,
      format.format,
    );
    if (!isWorkspaceTask(state) || (state as WorkspaceTask).id !== id)
      throw new Error("The update does not make a conversation this reads.");
    // The updated copy takes the original's place only once it reads back
    // as it was made.
    await HistoryLog.create(
      path,
      state,
      folder.files,
      folder.format,
      async (written) => {
        const back = await HistoryLog.open(written, folder.files);
        if (
          back.lost ||
          standingOf(folder.formats, formatOf(back.header)).standing !==
            "current" ||
          JSON.stringify(back.state) !== JSON.stringify(state)
        )
          throw new Error("The updated copy does not read back as written.");
      },
    );
    const opened = await HistoryLog.open(path, folder.files, folder.format);
    const written = {
      log: opened.log,
      state: state as WorkspaceTask,
      lost: false,
    };
    this.#waiting.delete(id);
    await this.#store.adopt(written);
    return written;
  }

  /**
   * Moves every conversation waiting for an update to the Recycle Bin. Only
   * one Windows says it would recycle is moved; the rest stay where they are,
   * and nothing is deleted permanently.
   */
  async recycleWaiting(bin: RecycleBin | undefined): Promise<RecycleResult> {
    if (!bin)
      throw new SessionStoreError(
        "unavailable",
        "The Recycle Bin is not available here, so nothing was deleted.",
      );
    await this.#store.ensureLoaded();
    const waiting = this.#waiting.inOrder().map(([id, item]) => ({
      id,
      folder: join(this.#folder.conversationsFolder, item.name),
    }));
    const answers = await bin
      .recyclable(waiting.map((item) => item.folder))
      .catch(() => new Map<string, boolean>());
    const recycled: string[] = [];
    let failed = 0;
    for (const item of waiting) {
      if (answers.get(item.folder) !== true) {
        failed += 1;
        continue;
      }
      try {
        await bin.recycle(item.folder);
      } catch {
        failed += 1;
        continue;
      }
      this.#waiting.delete(item.id);
      recycled.push(item.id);
    }
    return { recycled, failed };
  }
}
