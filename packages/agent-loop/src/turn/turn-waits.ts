import type {
  FolderInstructions,
  FolderInstructionsRequest,
  ToolCallInspection,
  ToolInvocationResult,
  UserInputRequest,
  UserInputResponse,
  WorkBudgetRequest,
} from "@zhiyin/contract";
import { VisibleError } from "@zhiyin/contract";
import { describeInvocation } from "../tools/invocation.js";
import type { FileBackup } from "@zhiyin/rewind";
import type { AgentLoopDependencies } from "../dependencies.js";
import type { TurnRecords } from "./turn-records.js";
import type { WorkCheckpoint } from "./work-limits.js";
import type { AssembledToolCall, PresentedAction } from "./turn-shared.js";
import type { PermissionScope } from "../tools/conversation-permissions.js";

const workBudgetQuestionId = "work-budget";
const folderInstructionsQuestionId = "folder-instructions";
export type ApprovalAnswer =
  | "allow"
  | "allow-conversation"
  | "cancelled"
  | {
      readonly kind: "deny";
      readonly reason?: string;
    };

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
      readonly conversationRule?: PermissionScope;
      readonly settle: (decision: ApprovalAnswer) => void;
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
    decision: "allow" | "allow-conversation" | "deny",
    reason?: string,
  ): Promise<void> {
    if (
      decision !== "allow" &&
      decision !== "allow-conversation" &&
      decision !== "deny"
    )
      throw new VisibleError("Choose Allow or Deny.");
    const pending = this.#pendingApprovals.get(
      this.#approvalKey(taskId, requestId),
    );
    if (!pending || pending.taskId !== taskId) {
      throw new Error("That permission request is no longer active.");
    }
    if (decision === "allow-conversation" && !pending.conversationRule)
      throw new VisibleError(
        "This action cannot be allowed for the conversation.",
      );
    pending.settle(
      decision === "deny"
        ? {
            kind: "deny",
            ...(reason?.trim() ? { reason: reason.trim() } : {}),
          }
        : decision,
    );
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
    /** A label being written in the background, shown once it arrives. */
    labelled?: Promise<
      { readonly title: string; readonly description: string } | undefined
    >,
    conversationRule?: PermissionScope,
  ): Promise<ApprovalAnswer> {
    return this.#withPromptSlot(taskId, async () => {
      const task = this.#records.task(taskId);
      const steps = this.#records.visibleSteps(taskId);
      const approvalId = this.#deps.newApprovalId();
      const decision = new Promise<ApprovalAnswer>((resolve) => {
        const settle = (choice: ApprovalAnswer) => {
          signal.removeEventListener("abort", cancel);
          this.#pendingApprovals.delete(this.#approvalKey(taskId, approvalId));
          resolve(choice);
        };
        const cancel = () => settle("cancelled");
        this.#pendingApprovals.set(this.#approvalKey(taskId, approvalId), {
          taskId,
          ...(conversationRule ? { conversationRule } : {}),
          settle,
        });
        signal.addEventListener("abort", cancel, { once: true });
        if (signal.aborted) cancel();
      });

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
            ...(conversationRule
              ? { conversationRule: { label: conversationRule.label } }
              : {}),
          },
        },
      });
      void labelled
        ?.then((label) => label && this.#relabel(taskId, approvalId, label))
        .catch(() => undefined);
      return await decision;
    });
  }

  async waitForUserInput(
    taskId: string,
    request: UserInputRequest | WorkBudgetRequest | FolderInstructionsRequest,
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
    checkpoint: WorkCheckpoint,
    signal: AbortSignal,
    reason?: string,
  ): Promise<"continue" | "pause" | "cancelled"> {
    const request: WorkBudgetRequest = {
      kind: "workBudget",
      title: "Keep working on this?",
      ...checkpoint,
      ...(reason ? { reason } : {}),
    };
    return this.#choose(
      taskId,
      request,
      workBudgetQuestionId,
      ["continue", "pause"],
      "Choose Continue or Pause.",
      signal,
    );
  }

  /**
   * Asks whether a folder's AGENTS.md may guide the work, showing its text.
   * Nothing of it reaches the model before the answer. ADR 0012.
   */
  waitForFolderInstructions(
    taskId: string,
    folder: FolderInstructions,
    signal: AbortSignal,
  ): Promise<"use" | "ignore" | "cancelled"> {
    return this.#choose(
      taskId,
      {
        kind: "folderInstructions",
        title: "Use these folder instructions?",
        path: folder.path,
        text: folder.text,
        truncated: folder.truncated,
      },
      folderInstructionsQuestionId,
      ["use", "ignore"],
      "Choose Use or Ignore.",
      signal,
    );
  }

  /** One question with a fixed set of answers, and the one chosen. */
  async #choose<Choice extends string>(
    taskId: string,
    request: WorkBudgetRequest | FolderInstructionsRequest,
    questionId: string,
    choices: readonly Choice[],
    refusal: string,
    signal: AbortSignal,
  ): Promise<Choice | "cancelled"> {
    const outcome = await this.waitForUserInput(
      taskId,
      request,
      async (response) => {
        const answer = response.answers?.[0];
        const decision = answer?.answerIds?.[0];
        if (
          response.answers.length !== 1 ||
          answer?.questionId !== questionId ||
          answer.answerIds?.length !== 1 ||
          answer.text !== undefined ||
          !choices.includes(decision as Choice)
        )
          return { ok: false, reason: refusal };
        return { ok: true, value: { decision } };
      },
      signal,
    );
    if (outcome.kind === "cancelled") return "cancelled";
    return outcome.response.answers[0]!.answerIds![0] as Choice;
  }

  /** The prompt still showing, given the label written for it. */
  async #relabel(
    taskId: string,
    approvalId: string,
    label: { readonly title: string; readonly description: string },
  ): Promise<void> {
    const task = this.#records.task(taskId);
    if (task.phase.kind !== "approval" || task.phase.prompt.id !== approvalId)
      return;
    await this.#records.replaceTask({
      ...task,
      phase: {
        ...task.phase,
        prompt: {
          ...task.phase.prompt,
          action: label.title,
          reason: label.description,
        },
      },
    });
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
