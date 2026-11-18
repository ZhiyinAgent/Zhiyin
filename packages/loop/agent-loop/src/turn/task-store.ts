/**
 * The one way a turn writes its conversation (ADR 0007): each write is checked
 * by the turn's guard as it begins and as it ends, and is read back at once
 * while it is still being saved, so work in the background builds on it and
 * no save that finishes later undoes it.
 *
 * While a conversation's files are being put back, the conversation is the
 * rewind's: it saves the conversation it planned before the files went back,
 * and its record of the operation holds that conversation, so a write landing
 * meanwhile would be undone by the save, or leave the conversation one a
 * restart could not finish the rewind from. Every write is refused then, and
 * a change made on no turn's behalf waits and is made on what the rewind saved.
 */

import type { WorkspaceTask } from "@zhiyin/contract";
import type { AgentLoopDependencies } from "../dependencies.js";

export class TaskStore {
  readonly #host: Pick<AgentLoopDependencies["host"], "find" | "store">;
  readonly #guard: (task: WorkspaceTask) => () => boolean;
  readonly #rewind: AgentLoopDependencies["rewind"];
  /**
   * Each task's latest write while it is still being saved. The app commits a
   * write only once it is saved, so without this a read in between would
   * return the task from before it, work in the background (an action's
   * label) would build on that, and whichever save finished last would undo
   * the other.
   */
  readonly #unsaved = new Map<string, WorkspaceTask>();
  /** Each task's writes still being saved. */
  readonly #saving = new Map<string, Set<Promise<void>>>();

  constructor(
    host: Pick<AgentLoopDependencies["host"], "find" | "store">,
    guard: (task: WorkspaceTask) => () => boolean,
    rewind: AgentLoopDependencies["rewind"],
  ) {
    this.#host = host;
    this.#guard = guard;
    this.#rewind = rewind;
  }

  task(taskId: string): WorkspaceTask {
    const task = this.#host.find(taskId);
    if (!task) throw new Error("The task does not exist.");
    return this.#unsaved.get(taskId) ?? task;
  }

  /**
   * Writes the task; false when the write was refused, as it began or ended.
   *
   * `emit = false` updates the task without announcing it. Only streaming text
   * uses it, and only to coalesce: a token arriving is a state change worth
   * keeping but not worth serialising the whole task for, and the next change
   * of any other kind announces the accumulated text along with itself.
   */
  async replaceTask(
    task: WorkspaceTask,
    persist = true,
    emit = true,
  ): Promise<boolean> {
    const guarded = this.#guard(task);
    const commit = () => !this.#rewind.restoring(task.id) && guarded();
    if (!commit()) return false;
    this.#unsaved.set(task.id, task);
    const saving = this.#host.store(task, {
      persist,
      commit,
      announce: () => emit && commit(),
    });
    const held = this.#saving.get(task.id) ?? new Set<Promise<void>>();
    held.add(saving);
    this.#saving.set(task.id, held);
    try {
      await saving;
    } finally {
      held.delete(saving);
      if (!held.size && this.#saving.get(task.id) === held)
        this.#saving.delete(task.id);
      if (this.#unsaved.get(task.id) === task) this.#unsaved.delete(task.id);
    }
    return commit();
  }

  /**
   * A change made on no turn's behalf, such as the end of a job or of a
   * specialist, to the conversation as it stands; `change` says undefined
   * when there is nothing to change. A stop that lands while it is saved
   * refuses the write, which holds the conversation from before the stop, so
   * the change is made again on what the stop left. A write begun before it
   * from the conversation as saved, as the stop's is, can land after it and
   * over it, so once such writes have landed the change is made again if it
   * was lost. `change` says undefined once what it sets is there, so making
   * it again changes nothing more. While the conversation's files are being
   * put back, the change waits for the rewind to be saved.
   */
  async changeOutsideTurns(
    taskId: string,
    change: (task: WorkspaceTask) => WorkspaceTask | undefined,
  ): Promise<boolean> {
    // A stop ends its turn, so a second write meets no stopped turn; a third
    // covers another turn started and stopped meanwhile.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (this.#rewind.restoring(taskId)) await this.#rewind.settled(taskId);
      if (!this.#host.find(taskId)) return false;
      const changed = change(this.task(taskId));
      if (!changed) return attempt > 0;
      if (!(await this.replaceTask(changed))) continue;
      const earlier = [...(this.#saving.get(taskId) ?? [])];
      if (!earlier.length) return true;
      await Promise.allSettled(earlier);
    }
    return false;
  }
}
