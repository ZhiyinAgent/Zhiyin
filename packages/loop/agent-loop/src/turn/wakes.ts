/**
 * When a conversation whose turn has ended is woken: a specialist it started
 * settled, or a command it started ended, and nothing runs to be told. Several
 * arriving close together wake it once, and that turn takes them all. While a
 * stop is being written, what arrives waits for the person's next turn, as
 * what was waiting at the stop does.
 */

import type { WorkspaceTask } from "@zhiyin/contract";
import type { CommandEndings } from "../tools/command-endings.js";
import type { PendingHandoffs } from "../specialist/pending-handoffs.js";
import type { SpecialistExecutionResult } from "../specialist/specialist-execution.js";
import { toldOf } from "../specialist/specialist-handoff-delivery.js";
import { isOwnDefect } from "./turn-recovery.js";

export type WakeParts = {
  readonly handoffs: PendingHandoffs;
  readonly endings: CommandEndings;
  /** Whether a turn runs in the conversation, to be told itself. */
  readonly running: (taskId: string) => boolean;
  /**
   * Runs a turn that takes what is queued. True when it ran and was not
   * stopped, so what arrived during its last request can wake it again.
   */
  readonly resume: (taskId: string) => Promise<boolean>;
  readonly recordDefect?:
    | ((defect: { readonly taskId: string; readonly error: unknown }) => void)
    | undefined;
};

export class Wakes {
  readonly #parts: WakeParts;
  /** The wake under way for each conversation, so only its own end clears it. */
  readonly #scheduled = new Map<string, object>();
  /** Stops still being written, counted: the person can stop again meanwhile. */
  readonly #stopping = new Map<string, number>();

  constructor(parts: WakeParts) {
    this.#parts = parts;
  }

  /**
   * A command the conversation started, carried on as a job, ended. One that
   * `wakes` nothing waits for the next turn.
   */
  commandEnded(taskId: string, notice: string, wakes: boolean): void {
    const waking = wakes && !this.#stopping.has(taskId);
    this.#parts.endings.push(taskId, notice, waking);
    if (waking) this.wakeIfQueued(taskId);
  }

  /** A specialist the conversation started settled, with its handoff. */
  handoffSettled(taskId: string, result: SpecialistExecutionResult): void {
    if (this.#stopping.has(taskId)) {
      this.#parts.handoffs.push(taskId, result, false);
      return;
    }
    this.#parts.handoffs.push(taskId, result);
    this.wakeIfQueued(taskId);
  }

  /**
   * Wakes the conversation for a handoff or a command ending still queued.
   * Asked as one arrives, and again as each turn ends: one that arrived after
   * the running turn last looked would otherwise wait for the person's next
   * message.
   */
  wakeIfQueued(taskId: string): void {
    const { handoffs, endings, running, resume, recordDefect } = this.#parts;
    if (!handoffs.waiting(taskId) && !endings.waiting(taskId)) return;
    if (running(taskId)) return;
    if (this.#scheduled.has(taskId)) return;
    const wake = {};
    this.#scheduled.set(taskId, wake);
    const over = () => {
      if (this.#scheduled.get(taskId) === wake) this.#scheduled.delete(taskId);
    };
    // What is queued stays queued for the next turn when this one cannot
    // start; a failure that is Zhiyin's own is kept for whoever looks into it.
    void resume(taskId)
      .then((ran) => {
        // This wake is over: anything that arrived during its last request
        // wakes the conversation again.
        over();
        if (ran) this.wakeIfQueued(taskId);
      })
      .catch((error: unknown) => {
        if (isOwnDefect(error)) recordDefect?.({ taskId, error });
      })
      .finally(over);
  }

  /**
   * Writes a stop. What waited for the stopped turn is told to the next one
   * the person starts, and wakes nothing, now or after a restart; so does what
   * arrives while the stop is written.
   */
  async stopping(taskId: string, stop: () => Promise<void>): Promise<void> {
    this.#stopping.set(taskId, (this.#stopping.get(taskId) ?? 0) + 1);
    this.#parts.handoffs.quiet(taskId);
    this.#parts.endings.quiet(taskId);
    try {
      await stop();
    } finally {
      const left = (this.#stopping.get(taskId) ?? 1) - 1;
      if (left > 0) this.#stopping.set(taskId, left);
      else this.#stopping.delete(taskId);
    }
  }

  /**
   * Queues the handoffs saved conversations still owe their model, as they are
   * read, and wakes each that has one. A handoff already waiting, or already
   * told, is not queued again.
   */
  restore(tasks: readonly WorkspaceTask[]): void {
    for (const task of tasks) {
      for (const run of task.specialistRuns) {
        if (run.handoffDelivered !== false || run.status === "running")
          continue;
        if (this.#parts.handoffs.holds(task.id, run.id)) continue;
        if (toldOf(task, run.id)) continue;
        this.#parts.handoffs.push(
          task.id,
          run.handoff
            ? {
                ok: true,
                runId: run.id,
                specialist: run.specialist,
                handoff: run.handoff,
                ...(run.quiet ? { stopped: true as const } : {}),
              }
            : {
                ok: false,
                runId: run.id,
                specialist: run.specialist,
                reason:
                  run.reason ?? "The specialist stopped before finishing.",
                // One the person stopped stays stopped after a restart too.
                ...(run.quiet ? { stopped: true as const } : {}),
              },
        );
      }
      this.wakeIfQueued(task.id);
    }
  }
}
