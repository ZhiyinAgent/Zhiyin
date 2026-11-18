/**
 * The conversations the core holds: every one listed, those opened so far,
 * and the one way a revision of one is kept (ADR 0007). A revision is
 * committed only once saved, so a save of anything else meanwhile writes the
 * newest revision, never the one before it, which would undo it on disk. A
 * conversation that has been deleted takes no further writes, however late
 * the work that produced them started.
 */

import type { ConversationSummary, WorkspaceTask } from "@zhiyin/contract";
import type { HistoryRepair, Sessions } from "@zhiyin/session";
import {
  ConversationList,
  type Opening,
  type RecordDamage,
} from "./conversation-list.js";
import { datedTurn, requiredTask } from "./workspace-tasks.js";

/** How a revision is kept: saved or not, and whether it still holds once saved. */
export type Revision = {
  readonly persist: boolean;
  /** Whether the revision still holds; asked again after the save. */
  readonly commit: () => boolean;
  /** Whether the window is told of it, asked once it has been kept. */
  readonly announce: () => boolean;
};

export type OpenConversationsDependencies = {
  readonly sessions: Sessions;
  readonly historyRepair: HistoryRepair;
  readonly now: () => Date;
  /** A conversation as read at launch: no turn outlives the process that ran it. */
  readonly settleAfterRestart: (task: WorkspaceTask) => WorkspaceTask;
  /** Reasoning still arriving when a turn ended is settled by the turn. */
  readonly settleEndedTurn: (task: WorkspaceTask) => WorkspaceTask;
  /** Saves the workspace, every conversation at its newest revision. */
  readonly save: (commit: () => boolean) => Promise<void>;
  /** Tells the window a conversation changed. */
  readonly announce: (task: WorkspaceTask) => void;
  readonly recordDamage?: RecordDamage | undefined;
};

/** A copy of a conversation, in the folder its record names now. */
function inFolderOf(copy: WorkspaceTask, record: WorkspaceTask): WorkspaceTask {
  if (copy.workspace === record.workspace) return copy;
  if (record.workspace) return { ...copy, workspace: record.workspace };
  const moved = { ...copy };
  delete moved.workspace;
  return moved;
}

export class OpenConversations {
  readonly #deps: OpenConversationsDependencies;
  /** The conversations opened so far; the list holds every one. */
  #tasks: WorkspaceTask[] = [];
  /** Each conversation's newest revision while it is being saved. */
  readonly #beingSaved = new Map<
    string,
    { readonly task: WorkspaceTask; readonly commit: () => boolean }
  >();
  readonly #list: ConversationList;

  constructor(deps: OpenConversationsDependencies) {
    this.#deps = deps;
    this.#list = new ConversationList(
      deps.sessions,
      deps.historyRepair,
      (task) =>
        datedTurn(
          task,
          deps.settleAfterRestart(task),
          deps.now().toISOString(),
        ),
      deps.recordDamage,
    );
  }

  /** The conversations opened so far, as committed. */
  opened(): readonly WorkspaceTask[] {
    return this.#tasks;
  }

  find(id: string): WorkspaceTask | undefined {
    return this.#tasks.find((task) => task.id === id);
  }

  /** An opened conversation, which the caller knows is there. */
  required(id: string): WorkspaceTask {
    return requiredTask(this.#tasks, id);
  }

  isOpen(id: string): boolean {
    return this.#tasks.some((task) => task.id === id);
  }

  /** Whether the conversation is one of the person's, opened or not. */
  has(id: string): boolean {
    return this.#list.has(id);
  }

  /** Every conversation, opened or only listed, in the list's order. */
  listed(): ConversationSummary[] {
    return this.#list.list(this.#tasks);
  }

  /** One an older version saved, waiting for an update, or nothing. */
  waiting(id: string): ConversationSummary | undefined {
    return this.#list.waiting(id);
  }

  /** Everything as read at launch, or after the history was replaced. */
  replaceAll(
    tasks: readonly WorkspaceTask[],
    listed: readonly ConversationSummary[],
  ): void {
    this.#tasks = [...tasks];
    this.#list.replace(listed);
  }

  /** Reads a listed conversation from disk; the caller keeps what it gives. */
  read(id: string): Promise<Opening> {
    return this.#list.open(id);
  }

  /** A conversation read from disk, unless another caller opened it first. */
  adopt(task: WorkspaceTask): void {
    if (!this.isOpen(task.id)) this.#tasks = [...this.#tasks, task];
  }

  /** A new conversation, first in the list. */
  add(task: WorkspaceTask): void {
    this.#tasks = [task, ...this.#tasks];
    this.#list.add(task);
  }

  /**
   * Takes a conversation off the list and out of what is open. Answers the
   * conversation now in its place, or nothing.
   */
  remove(id: string): string | null {
    this.#tasks = this.#tasks.filter((task) => task.id !== id);
    return this.#list.remove(id, this.#tasks);
  }

  /** Conversations an older version saved, now updated in place. */
  updated(summaries: readonly ConversationSummary[]): void {
    this.#list.updated(summaries);
  }

  /**
   * Moves a conversation to another folder. The folder is the folders' to
   * change: a revision being saved meanwhile keeps the folder its record has
   * by the time it is committed.
   */
  changeFolder(
    id: string,
    change: (task: WorkspaceTask) => WorkspaceTask,
  ): void {
    this.#tasks = this.#tasks.map((task) =>
      task.id === id ? change(task) : task,
    );
  }

  /** What a save writes: each conversation at its newest revision, committed yet or not. */
  forSave(tasks: readonly WorkspaceTask[]): WorkspaceTask[] {
    return tasks.map((task) => {
      const newer = this.#beingSaved.get(task.id);
      return newer?.commit() ? inFolderOf(newer.task, task) : task;
    });
  }

  /** The person's own change to a conversation: no turn owns it, so it is always kept. */
  replace(task: WorkspaceTask): Promise<void> {
    return this.store(task, {
      persist: true,
      commit: () => true,
      announce: () => true,
    });
  }

  /**
   * Keeps a new revision of a conversation. Whether the change is announced
   * is asked only once it has been saved, because a turn can be stopped
   * while the save is under way.
   */
  async store(task: WorkspaceTask, revision: Revision): Promise<void> {
    const committed = this.find(task.id);
    if (!committed) return;
    const now = this.#deps.now().toISOString();
    const updated = datedTurn(
      this.#beingSaved.get(task.id)?.task ?? committed,
      {
        ...this.#deps.settleEndedTurn(task),
        updatedAt: now,
        updatedLabel: "Now",
      },
      now,
    );
    // Only this conversation is replaced, in the list as it is by then: other
    // conversations are saved and committed while this save is under way, and
    // the list from before it would put each of them back as it was.
    const commit = () => {
      this.#tasks = this.#tasks.map((item) =>
        item.id === task.id ? inFolderOf(updated, item) : item,
      );
    };
    const held = { task: updated, commit: revision.commit };
    try {
      if (revision.persist) {
        this.#beingSaved.set(task.id, held);
        await this.#deps.save(revision.commit);
      }
      if (!revision.commit()) return;
      commit();
    } catch (error) {
      // A genuine failed save remains visible and is marked unsaved. A write
      // whose author lost ownership is discarded instead.
      if (revision.commit()) commit();
      throw error;
    } finally {
      if (this.#beingSaved.get(task.id) === held)
        this.#beingSaved.delete(task.id);
      const current = this.find(task.id);
      if (current && revision.announce()) this.#deps.announce(current);
    }
  }
}
