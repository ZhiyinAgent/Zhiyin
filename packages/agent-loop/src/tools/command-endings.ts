/**
 * What a conversation is told when a command that carried on as a job ends by
 * itself, held until a turn is live to tell it: the turn already running, at
 * its next request, or one woken for it. One the person stopped wakes nothing
 * and waits for the next turn, which may be the person's own.
 *
 * Only a sentence from Zhiyin saying how it ended, never what the command
 * printed: that is a tool's answer, read with the job tool and fenced like
 * one. Held in memory, because a job does not outlive Zhiyin either.
 */
export class CommandEndings {
  readonly #byTask = new Map<string, { notice: string; wakes: boolean }[]>();

  push(taskId: string, notice: string, wakes = true): void {
    this.#byTask.set(taskId, [
      ...(this.#byTask.get(taskId) ?? []),
      { notice, wakes },
    ]);
  }

  /** Whether something held for this task should wake it. */
  waiting(taskId: string): boolean {
    return this.#byTask.get(taskId)?.some((held) => held.wakes) ?? false;
  }

  /** Everything held for this task, removed in the same call. */
  drain(taskId: string): readonly string[] {
    const held = this.#byTask.get(taskId) ?? [];
    this.#byTask.delete(taskId);
    return held.map(({ notice }) => notice);
  }
}
