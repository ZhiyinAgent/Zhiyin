/**
 * Every conversation the list shows, and the reading of one from disk the
 * first time it is opened.
 *
 * A launch reads the list alone, so starting the app costs the same with ten
 * conversations as with a thousand. A conversation is read when something
 * first needs it — the person selects it, or a rewind left unfinished by a
 * crash names it — and is settled then, as it would have been at launch.
 */

import type {
  ConversationSummary,
  WorkspaceTask,
  WorkspaceIssue,
} from "@zhiyin/contract";
import type { Sessions } from "@zhiyin/session";

function summaryOf(item: ConversationSummary): ConversationSummary {
  return {
    id: item.id,
    title: item.title,
    titleSource: item.titleSource,
    updatedAt: item.updatedAt,
    updatedLabel: item.updatedLabel,
    ...(item.needsUpdate ? { needsUpdate: item.needsUpdate } : {}),
  };
}

/**
 * The order the list shows: the conversation changed last first; any tie by
 * id, as the history store orders them at launch.
 */
function newestFirst(a: ConversationSummary, b: ConversationSummary): number {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** What opening a conversation found. */
export type Opening = {
  /** Absent when the conversation could not be read. */
  readonly task?: WorkspaceTask;
  /** Whether settling it changed it, so it needs saving. */
  readonly changed: boolean;
  /** Something the person should be told. */
  readonly issue?: WorkspaceIssue;
};

export class ConversationList {
  readonly #sessions: Sessions;
  readonly #settle: (task: WorkspaceTask) => WorkspaceTask;
  #summaries: ConversationSummary[] = [];
  /** One read per conversation, however many ask for it at once. */
  readonly #opening = new Map<string, Promise<Opening>>();
  /**
   * What was found the first time a conversation would not open. Asking again
   * answers the same, rather than reading it again and keeping another copy.
   */
  readonly #damaged = new Map<string, Opening>();
  /**
   * Where this launch kept its copy of the damaged history. The first damaged
   * conversation makes it, holding every damaged one; the rest point to it.
   */
  #kept: Promise<string | undefined> | undefined;

  constructor(
    sessions: Sessions,
    settle: (task: WorkspaceTask) => WorkspaceTask,
  ) {
    this.#sessions = sessions;
    this.#settle = settle;
  }

  replace(summaries: readonly ConversationSummary[]): void {
    this.#summaries = summaries.map(summaryOf);
  }

  /** The list in order, with what is open shown as it is now. */
  list(opened: readonly WorkspaceTask[]): ConversationSummary[] {
    const current = new Map(opened.map((task) => [task.id, task]));
    return this.#summaries
      .map((item) => summaryOf(current.get(item.id) ?? item))
      .sort(newestFirst);
  }

  has(id: string): boolean {
    return this.#summaries.some((item) => item.id === id);
  }

  /** The conversation an older version saved, while it waits for an update. */
  waiting(id: string): ConversationSummary | undefined {
    return this.#summaries.find((item) => item.id === id && item.needsUpdate);
  }

  /** Every conversation waiting for an update, in the order the list shows. */
  allWaiting(): ConversationSummary[] {
    return this.#summaries.filter((item) => item.needsUpdate);
  }

  /** Shows conversations as they are once updated, in their place. */
  updated(summaries: readonly ConversationSummary[]): void {
    const now = new Map(summaries.map((item) => [item.id, summaryOf(item)]));
    this.#summaries = this.#summaries.map((item) => now.get(item.id) ?? item);
  }

  add(task: WorkspaceTask): void {
    this.#summaries = [summaryOf(task), ...this.#summaries];
  }

  /**
   * Takes a conversation out, and answers the one that takes its place in the
   * list as it is shown.
   */
  remove(id: string, opened: readonly WorkspaceTask[]): string | null {
    const shown = this.list(opened);
    const index = shown.findIndex((item) => item.id === id);
    if (index < 0) return null;
    this.#summaries = this.#summaries.filter((item) => item.id !== id);
    this.#damaged.delete(id);
    const rest = shown.filter((item) => item.id !== id);
    return rest[Math.min(index, rest.length - 1)]?.id ?? null;
  }

  open(id: string): Promise<Opening> {
    const damaged = this.#damaged.get(id);
    if (damaged) return Promise.resolve(damaged);
    const pending = this.#opening.get(id);
    if (pending) return pending;
    const opening = this.#read(id).finally(() => this.#opening.delete(id));
    this.#opening.set(id, opening);
    return opening;
  }

  async #read(id: string): Promise<Opening> {
    const title =
      this.#summaries.find((item) => item.id === id)?.title ?? "A conversation";
    let read;
    try {
      read = await this.#sessions.openConversation(id);
    } catch (error) {
      const { code, writtenBy } = error as {
        code?: unknown;
        writtenBy?: unknown;
      };
      // Not damaged: it waits, as it is, for the person to update it.
      if (code === "outdated")
        return {
          changed: false,
          issue: {
            message: `“${title}” was saved by Zhiyin ${String(writtenBy)} and needs an update before it opens.`,
            conversationId: id,
            canUpdate: true,
          },
        };
      if (code !== "corrupted")
        return {
          changed: false,
          issue: {
            message: `“${title}” could not be read. Your files are unchanged. Try opening it again.`,
            conversationId: id,
          },
        };
      this.#kept ??= this.#sessions.preserveDamaged().catch(() => {
        this.#kept = undefined;
        return undefined;
      });
      const kept = await this.#kept;
      const damaged: Opening = {
        changed: false,
        issue: {
          message: `“${title}” is damaged and can't be opened. Your other conversations are unaffected.`,
          ...(kept ? { keptAt: kept } : {}),
          conversationId: id,
          canDelete: true,
        },
      };
      this.#damaged.set(id, damaged);
      return damaged;
    }
    const task = this.#settle(read.task);
    return {
      task,
      changed: task !== read.task,
      ...(read.lost
        ? {
            issue: {
              message: `The last moment of “${task.title}” before the app closed was not saved.`,
              conversationId: task.id,
            },
          }
        : {}),
    };
  }
}
