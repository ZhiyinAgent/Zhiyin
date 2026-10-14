import type { SpecialistExecutionResult } from "./specialist-execution.js";

/**
 * What a finished background specialist leaves for its task to pick up.
 * Pushed the moment a run settles, regardless of whether a turn is currently
 * live for that task; drained by whichever turn is live when it next checks —
 * the turn already running, or one freshly woken to receive it.
 */
export class PendingHandoffs {
  readonly #byTask = new Map<string, SpecialistExecutionResult[]>();

  push(taskId: string, result: SpecialistExecutionResult): void {
    const queued = this.#byTask.get(taskId) ?? [];
    queued.push(result);
    this.#byTask.set(taskId, queued);
  }

  /**
   * Whether a handoff is queued that should wake the task. One a stop ended
   * waits for the next turn the person starts: nothing resumes a stopped turn.
   */
  waiting(taskId: string): boolean {
    return (this.#byTask.get(taskId) ?? []).some(
      (result) => result.ok || !result.stopped,
    );
  }

  /** Everything queued for this task, removed in the same call. */
  drain(taskId: string): readonly SpecialistExecutionResult[] {
    const queued = this.#byTask.get(taskId);
    if (!queued) return [];
    this.#byTask.delete(taskId);
    return queued;
  }
}
