import type { SpecialistExecutionResult } from "./specialist-execution.js";

/**
 * What a finished background specialist leaves for its task to pick up.
 * Pushed the moment a run settles, regardless of whether a turn is currently
 * live for that task; drained by whichever turn is live when it next checks —
 * the turn already running, or one freshly woken to receive it.
 */
export class PendingHandoffs {
  readonly #byTask = new Map<
    string,
    { result: SpecialistExecutionResult; wakes: boolean }[]
  >();

  /** Queued to wake the task unless a stop ended it or wakes says not. */
  push(
    taskId: string,
    result: SpecialistExecutionResult,
    wakes = !result.stopped,
  ): void {
    this.#byTask.set(taskId, [
      ...(this.#byTask.get(taskId) ?? []),
      { result, wakes },
    ]);
  }

  /**
   * Whether a handoff is queued that should wake the task. One a stop ended,
   * or one waiting when the person stopped the task, waits for the next turn
   * they start: nothing resumes a stopped turn.
   */
  waiting(taskId: string): boolean {
    return (this.#byTask.get(taskId) ?? []).some(({ wakes }) => wakes);
  }

  /** What is queued for this task now waits for the next turn, waking none. */
  quiet(taskId: string): void {
    const queued = this.#byTask.get(taskId);
    if (queued)
      this.#byTask.set(
        taskId,
        queued.map(({ result }) => ({ result, wakes: false })),
      );
  }

  /** Whether this run's handoff already waits for its task. */
  holds(taskId: string, runId: string): boolean {
    return (this.#byTask.get(taskId) ?? []).some(
      ({ result }) => result.runId === runId,
    );
  }

  /** Everything queued for this task, removed in the same call. */
  drain(taskId: string): readonly SpecialistExecutionResult[] {
    const queued = this.#byTask.get(taskId);
    if (!queued) return [];
    this.#byTask.delete(taskId);
    return queued.map(({ result }) => result);
  }
}
