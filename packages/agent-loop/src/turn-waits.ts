import type {
  ToolCallInspection,
  ToolInvocationResult,
  UserInputRequest,
  UserInputResponse,
  WorkBudgetRequest,
} from "@zhiyin/contract";
import { VisibleError } from "@zhiyin/contract";
import { describeInvocation } from "./invocation.js";
import type { FileBackup } from "@zhiyin/rewind";
import type { AgentLoopDependencies } from "./index.js";
import type { TurnRecords } from "./turn-records.js";
import type { AssembledToolCall, PresentedAction } from "./turn-shared.js";

const workBudgetQuestionId = "work-budget";

/**
 * What a turn waits on from the person: an approval, an answer, or a choice at
 * the work budget. Each is bound to an exact core-owned request id.
 */
export class TurnWaits {
  readonly #deps: AgentLoopDependencies;
  readonly #records: TurnRecords;
  readonly #promptSlots = new Map<string, Promise<void>>();
  readonly #pendingApprovals = new Map<
    string,
    {
      readonly taskId: string;
      readonly settle: (decision: "allow" | "deny" | "cancelled") => void;
    }
  >();
  readonly #pendingUserInputs = new Map<
    string,
    {
      readonly taskId: string;
      responding: boolean;
      readonly complete: (
        response: UserInputResponse,
      ) => Promise<ToolInvocationResult>;
      readonly settle: (
        outcome:
          | {
              readonly kind: "answered";
              readonly response: UserInputResponse;
              readonly result: ToolInvocationResult;
            }
          | { readonly kind: "cancelled" },
      ) => void;
    }
  >();

  constructor(
    deps: AgentLoopDependencies,
    parts: { readonly records: TurnRecords },
  ) {
    this.#deps = deps;
    this.#records = parts.records;
  }

  async resolveApproval(
    taskId: string,
    requestId: string,
    decision: "allow" | "deny",
  ): Promise<void> {
    if (decision !== "allow" && decision !== "deny")
      throw new VisibleError("Choose Allow or Deny.");
    const pending = this.#pendingApprovals.get(
      this.#approvalKey(taskId, requestId),
    );
    if (!pending || pending.taskId !== taskId) {
      throw new Error("That permission request is no longer active.");
    }
    pending.settle(decision);
  }

  async resolveUserInput(
    taskId: string,
    requestId: string,
    response: UserInputResponse,
  ): Promise<void> {
    const key = this.#approvalKey(taskId, requestId);
    const pending = this.#pendingUserInputs.get(key);
    if (!pending || pending.taskId !== taskId)
      throw new Error("That question request is no longer active.");
    if (pending.responding)
      throw new VisibleError("That answer is already being sent.");
    pending.responding = true;
    let result: ToolInvocationResult;
    try {
      result = await pending.complete(response);
    } catch {
      pending.responding = false;
      throw new VisibleError("The answer could not be checked. Try again.");
    }
    if (!result.ok) {
      pending.responding = false;
      throw new VisibleError(result.reason);
    }
    if (this.#pendingUserInputs.get(key) !== pending)
      throw new Error("That question request is no longer active.");
    pending.settle({ kind: "answered", response, result });
  }

  async waitForApproval(
    taskId: string,
    inspection: Extract<ToolCallInspection, { readonly ok: true }>,
    presentation: PresentedAction,
    backup: FileBackup | undefined,
    signal: AbortSignal,
    call?: AssembledToolCall,
  ): Promise<"allow" | "deny" | "cancelled"> {
    return this.#withPromptSlot(taskId, async () => {
      const task = this.#records.task(taskId);
      const steps = this.#records.visibleSteps(taskId);
      const approvalId = this.#deps.newApprovalId();
      const decision = new Promise<"allow" | "deny" | "cancelled">(
        (resolve) => {
          const settle = (choice: "allow" | "deny" | "cancelled") => {
            signal.removeEventListener("abort", cancel);
            this.#pendingApprovals.delete(
              this.#approvalKey(taskId, approvalId),
            );
            resolve(choice);
          };
          const cancel = () => settle("cancelled");
          this.#pendingApprovals.set(this.#approvalKey(taskId, approvalId), {
            taskId,
            settle,
          });
          signal.addEventListener("abort", cancel, { once: true });
          if (signal.aborted) cancel();
        },
      );

      await this.#records.replaceTask({
        ...task,
        phase: {
          kind: "approval",
          steps,
          prompt: {
            id: approvalId,
            action: presentation.title,
            target: inspection.target,
            reason: presentation.description,
            command: inspection.command,
            effect: inspection.action,
            ...(call
              ? {
                  invocation:
                    inspection.invocation ??
                    describeInvocation(
                      call.name,
                      call.arguments,
                      inspection.destination,
                    ),
                }
              : {}),
            ...(inspection.detail ? { detail: inspection.detail } : {}),
            ...(inspection.claim ? { claim: inspection.claim } : {}),
            ...(inspection.destination
              ? { destination: inspection.destination }
              : {}),
            ...(inspection.changes ? { changes: inspection.changes } : {}),
            ...(backup ? { recovery: { files: backup.files } } : {}),
          },
        },
      });
      return await decision;
    });
  }

  async waitForUserInput(
    taskId: string,
    request: UserInputRequest | WorkBudgetRequest,
    complete: (response: UserInputResponse) => Promise<ToolInvocationResult>,
    signal: AbortSignal,
  ): Promise<
    | {
        readonly kind: "answered";
        readonly response: UserInputResponse;
        readonly result: ToolInvocationResult;
      }
    | { readonly kind: "cancelled" }
  > {
    return this.#withPromptSlot(taskId, async () => {
      const task = this.#records.task(taskId);
      const steps = this.#records.visibleSteps(taskId);
      const requestId = this.#deps.newUserInputId();
      const key = this.#approvalKey(taskId, requestId);
      const answer = new Promise<
        | {
            readonly kind: "answered";
            readonly response: UserInputResponse;
            readonly result: ToolInvocationResult;
          }
        | { readonly kind: "cancelled" }
      >((resolve) => {
        const settle = (
          outcome:
            | {
                readonly kind: "answered";
                readonly response: UserInputResponse;
                readonly result: ToolInvocationResult;
              }
            | { readonly kind: "cancelled" },
        ) => {
          signal.removeEventListener("abort", cancel);
          this.#pendingUserInputs.delete(key);
          resolve(outcome);
        };
        const cancel = () => settle({ kind: "cancelled" });
        this.#pendingUserInputs.set(key, {
          taskId,
          responding: false,
          complete,
          settle,
        });
        signal.addEventListener("abort", cancel, { once: true });
        if (signal.aborted) cancel();
      });

      await this.#records.replaceTask({
        ...task,
        phase: {
          kind: "input",
          steps,
          prompt: { ...request, id: requestId },
        },
      });
      return await answer;
    });
  }

  async waitForWorkBudget(
    taskId: string,
    completedRounds: number,
    signal: AbortSignal,
  ): Promise<"continue" | "pause" | "cancelled"> {
    const request: WorkBudgetRequest = {
      kind: "workBudget",
      title: "Continue working?",
      completedRounds,
    };
    const outcome = await this.waitForUserInput(
      taskId,
      request,
      async (response) => {
        const answer = response.answers?.[0];
        const decision = answer?.answerIds?.[0];
        if (
          response.answers.length !== 1 ||
          answer?.questionId !== workBudgetQuestionId ||
          answer.answerIds?.length !== 1 ||
          answer.text !== undefined ||
          (decision !== "continue" && decision !== "pause")
        )
          return {
            ok: false,
            reason: "Choose Continue or Pause.",
          };
        return { ok: true, value: { decision } };
      },
      signal,
    );
    if (outcome.kind === "cancelled") return "cancelled";
    return outcome.response.answers[0]?.answerIds?.[0] === "continue"
      ? "continue"
      : "pause";
  }

  #approvalKey(taskId: string, callId: string): string {
    return `${taskId}:${callId}`;
  }

  /**
   * One prompt visible per task at a time. Concurrent children can each need
   * a person's decision at once; `task.phase` holds a single prompt, so a
   * second request waits its turn rather than overwriting the first's before
   * anyone could act on it.
   */
  async #withPromptSlot<T>(taskId: string, show: () => Promise<T>): Promise<T> {
    const ahead = this.#promptSlots.get(taskId) ?? Promise.resolve();
    let release!: () => void;
    const slot = new Promise<void>((resolve) => (release = resolve));
    this.#promptSlots.set(taskId, slot);
    await ahead;
    try {
      return await show();
    } finally {
      if (this.#promptSlots.get(taskId) === slot)
        this.#promptSlots.delete(taskId);
      release();
    }
  }

  /** Settles everything a turn is waiting on as cancelled, as the app shuts down. */
  cancelAll(): void {
    for (const pending of this.#pendingApprovals.values()) {
      pending.settle("cancelled");
    }
    for (const pending of this.#pendingUserInputs.values()) {
      pending.settle({ kind: "cancelled" });
    }
  }
}
