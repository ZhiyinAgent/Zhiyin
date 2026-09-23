/**
 * Every conversation the list shows, and the reading of one from disk the
 * first time it is opened.
 *
 * A launch reads the list alone, so starting the app costs the same with ten
 * conversations as with a thousand. A conversation is read when something
 * first needs it — the person selects it, or a rewind left unfinished by a
 * crash names it — and is settled then, as it would have been at launch.
 */

import type { ConversationSummary, WorkspaceTask } from "@zhiyin/contract";
import type { Sessions } from "@zhiyin/session";

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
 * The order the list shows: the conversation changed last first, then those
 * never dated; any tie by id, as the history store orders them at launch.
 */
function newestFirst(a: ConversationSummary, b: ConversationSummary): number {
  if (a.updatedAt !== b.updatedAt) {
    if (a.updatedAt === undefined) return 1;
    if (b.updatedAt === undefined) return -1;
    return a.updatedAt < b.updatedAt ? 1 : -1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** What opening a conversation found. */
export type Opening = {
  /** Absent when the conversation could not be read. */
  readonly task?: WorkspaceTask;
  /** Whether settling it changed it, so it needs saving. */
  readonly changed: boolean;
  /** Something the person should be told. */
  readonly issue?: string;
};

export class ConversationList {
  readonly #sessions: Sessions;
  readonly #settle: (task: WorkspaceTask) => WorkspaceTask;
  #summaries: ConversationSummary[] = [];
  /** One read per conversation, however many ask for it at once. */
  readonly #opening = new Map<string, Promise<Opening>>();

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
    const rest = shown.filter((item) => item.id !== id);
    return rest[Math.min(index, rest.length - 1)]?.id ?? null;
  }

  open(id: string): Promise<Opening> {
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
      if ((error as { code?: unknown }).code !== "corrupted")
        return {
          changed: false,
          issue: `“${title}” could not be read. Your files are unchanged. Try opening it again.`,
        };
      const kept = await this.#sessions
        .preserveDamaged()
        .catch(() => undefined);
      return {
        changed: false,
        issue: `“${title}” is damaged and could not be opened. Every other conversation is unaffected.${kept ? ` A copy was kept at ${kept}.` : ""}`,
      };
    }
    const titleSource =
      read.task.titleSource ??
      (read.task.title === "New task" && read.task.messages.length === 0
        ? "generated"
        : "manual");
    const settled = this.#settle(read.task);
    const task =
      settled.titleSource === titleSource
        ? settled
        : { ...settled, titleSource };
    return {
      task,
      changed: task !== read.task,
      ...(read.lost
        ? {
            issue: `The last moment of “${task.title}” before the app closed was not saved.`,
          }
        : {}),
    };
  }
}
