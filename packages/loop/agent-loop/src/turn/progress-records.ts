/**
 * The progress a person watches while a turn works: the answer as it streams,
 * coalesced so a token does not resend the whole conversation, and the steps
 * shown as the turn works, beside a question still waiting when there is one.
 */

import type {
  ReasoningTrace,
  ToolCallInspection,
  WorkStep,
  WorkspaceTask,
} from "@zhiyin/contract";
import type { TaskStore } from "./task-store.js";
import type { AssembledToolCall, PresentedAction } from "./turn-shared.js";

/** About one animation frame. Long enough to coalesce a burst of tokens. */
const progressEmitIntervalMs = 40;

/**
 * Whether the phase shows a question for the person: an approval or a request
 * for input. Only its answer or a stop takes it off screen. Work going on
 * beside it, a specialist's or the turn's, must not replace it, or the run that
 * asked would wait for an answer nobody can give.
 */
export function showsPrompt(
  phase: WorkspaceTask["phase"],
): phase is Extract<
  WorkspaceTask["phase"],
  { readonly kind: "approval" | "input" }
> {
  return phase.kind === "approval" || phase.kind === "input";
}

export class ProgressRecords {
  readonly #store: TaskStore;
  readonly #checkpoints = new Map<string, number>();
  readonly #emits = new Map<string, number>();

  constructor(store: TaskStore) {
    this.#store = store;
  }

  /** Drops the timing a finished turn kept for coalescing its progress. */
  forget(taskId: string): void {
    this.#checkpoints.delete(taskId);
    this.#emits.delete(taskId);
  }

  async assistant(
    taskId: string,
    assistantId: string,
    assistantText: string,
    sequence: number,
    reasoning?: ReasoningTrace,
  ): Promise<void> {
    const task = this.#store.task(taskId);
    const previousMessage = task.messages.find(
      (message) => message.id === assistantId,
    );
    const exists = Boolean(previousMessage);
    const reasoningChanged =
      reasoning?.status !== previousMessage?.reasoning?.status;
    const now = Date.now();
    const checkpoint =
      !exists ||
      reasoningChanged ||
      now - (this.#checkpoints.get(taskId) ?? 0) >= 1000;
    if (checkpoint) this.#checkpoints.set(taskId, now);
    // Every token would otherwise send the entire task across the bridge,
    // which grows with the conversation while the reason for sending it does
    // not. The interface paces the text it has anyway, so a frame's worth of
    // coalescing here is not visible there.
    const announce =
      !exists ||
      reasoningChanged ||
      now - (this.#emits.get(taskId) ?? 0) >= progressEmitIntervalMs;
    if (announce) this.#emits.set(taskId, now);
    await this.#store.replaceTask(
      {
        ...task,
        messages: exists
          ? task.messages.map((message) =>
              message.id === assistantId
                ? {
                    ...message,
                    text: assistantText,
                    ...(reasoning ? { reasoning } : {}),
                  }
                : message,
            )
          : [
              ...task.messages,
              {
                id: assistantId,
                role: "assistant",
                text: assistantText,
                sequence,
                ...(reasoning ? { reasoning } : {}),
              },
            ],
        phase:
          task.phase.kind === "working" || showsPrompt(task.phase)
            ? task.phase
            : { kind: "working", steps: [] },
      },
      checkpoint,
      announce,
    );
  }

  /**
   * Takes an answer back out of the conversation, when the round that was
   * writing it failed and is starting again. What was withdrawn is recorded
   * against the round, not kept on screen.
   */
  async withdraw(taskId: string, assistantId: string): Promise<void> {
    const task = this.#store.task(taskId);
    if (!task.messages.some((message) => message.id === assistantId)) return;
    await this.#store.replaceTask({
      ...task,
      messages: task.messages.filter((message) => message.id !== assistantId),
    });
  }

  async working(
    taskId: string,
    note: string | undefined,
    steps: readonly WorkStep[],
    retry?: { readonly readyAt: string; readonly count?: string },
  ): Promise<void> {
    const task = this.#store.task(taskId);
    await this.#store.replaceTask({
      ...task,
      // Beside a question still waiting, the work shows as its steps.
      phase: showsPrompt(task.phase)
        ? { ...task.phase, steps }
        : {
            kind: "working",
            ...(note ? { note } : {}),
            steps,
            ...(retry ? { retry } : {}),
          },
    });
  }

  steps(taskId: string): readonly WorkStep[] {
    const phase = this.#store.task(taskId).phase;
    return phase.kind === "working" ||
      phase.kind === "approval" ||
      phase.kind === "input"
      ? phase.steps
      : [];
  }

  async tool(
    taskId: string,
    call: AssembledToolCall,
    inspection: Extract<ToolCallInspection, { readonly ok: true }>,
    presentation: PresentedAction,
    status: "active" | "complete" | "failed",
  ): Promise<void> {
    const id = `tool-${call.callId}`;
    await this.working(taskId, undefined, [
      ...this.steps(taskId).filter((step) => step.id !== id),
      {
        id,
        label: presentation.title,
        detail: inspection.target,
        status,
      },
    ]);
  }
}
