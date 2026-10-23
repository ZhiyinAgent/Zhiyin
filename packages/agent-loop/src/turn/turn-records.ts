import type {
  ActionDetail,
  ActionApproval,
  ActionRecovery,
  ConversationPermission,
  ReasoningTrace,
  TaskAction,
  ToolCallInspection,
  ToolInvocationResult,
  UserInputRequest,
  UserInputResponse,
  WorkStep,
  WorkspaceTask,
  TaskGuidance,
} from "@zhiyin/contract";
import { settleGuidance } from "./turn-guidance.js";
import { writtenFiles } from "./written-files.js";
import { describeInvocation } from "../tools/invocation.js";
import { evidenceText } from "../context/evidence.js";
import type { AgentLoopDependencies } from "../dependencies.js";
import { type AssembledToolCall, type PresentedAction } from "./turn-shared.js";

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

/**
 * Writes what a turn does onto its conversation: the actions it takes, the
 * answers it is given, the pictures it keeps, and the progress a person watches.
 */
export class TurnRecords {
  readonly #deps: AgentLoopDependencies;
  readonly #storeGuard: (task: WorkspaceTask) => () => boolean;
  readonly #progressCheckpoints = new Map<string, number>();
  readonly #progressEmits = new Map<string, number>();
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
    deps: AgentLoopDependencies,
    storeGuard: (task: WorkspaceTask) => () => boolean,
  ) {
    this.#deps = deps;
    this.#storeGuard = storeGuard;
  }

  async queueGuidance(taskId: string, guidance: TaskGuidance): Promise<void> {
    const task = this.task(taskId);
    await this.replaceTask({
      ...task,
      guidance: [...task.guidance, guidance],
    });
  }

  async deliverGuidance(taskId: string, guidanceId: string): Promise<void> {
    const task = this.task(taskId);
    const guidance = task.guidance.find((item) => item.id === guidanceId);
    if (!guidance || guidance.status !== "pending") return;
    if (
      !task.modelHistory.some(
        (entry) => entry.kind === "notice" && entry.messageId === guidanceId,
      )
    )
      throw new Error("Guidance was not recorded in model history.");
    await this.replaceTask({
      ...task,
      guidance: task.guidance.filter((item) => item.id !== guidanceId),
      messages: [
        ...task.messages,
        {
          id: guidance.id,
          role: "user",
          text: guidance.text,
          ...(guidance.attachments?.length
            ? { attachments: guidance.attachments }
            : {}),
          sequence: this.nextTimelineSequence(task),
        },
      ],
    });
  }

  async releaseGuidance(taskId: string, onlyId?: string): Promise<void> {
    const task = this.task(taskId);
    const settled = settleGuidance(task, onlyId);
    if (settled !== task) await this.replaceTask(settled);
  }

  async markHandoffDelivered(taskId: string, runId: string): Promise<void> {
    const task = this.task(taskId);
    await this.replaceTask({
      ...task,
      specialistRuns: task.specialistRuns.map((run) =>
        run.id === runId ? { ...run, handoffDelivered: true } : run,
      ),
    });
  }

  async grantConversationPermission(
    taskId: string,
    permission: ConversationPermission,
  ): Promise<void> {
    const task = this.task(taskId);
    await this.replaceTask({
      ...task,
      conversationPermissions: [...task.conversationPermissions, permission],
    });
  }

  async revokeConversationPermission(
    taskId: string,
    permissionId: string,
  ): Promise<void> {
    const task = this.task(taskId);
    await this.replaceTask({
      ...task,
      conversationPermissions: task.conversationPermissions.filter(
        (permission) => permission.id !== permissionId,
      ),
    });
  }

  /** Drops the timing a finished turn kept for coalescing its progress. */
  forgetProgress(taskId: string): void {
    this.#progressCheckpoints.delete(taskId);
    this.#progressEmits.delete(taskId);
  }

  humanizeIdentifier(value: string): string {
    const words = value.replace(/[_-]+/g, " ").trim();
    return words
      ? `${words.charAt(0).toUpperCase()}${words.slice(1)}`
      : "Unavailable action";
  }

  async showAssistantProgress(
    taskId: string,
    assistantId: string,
    assistantText: string,
    sequence: number,
    reasoning?: ReasoningTrace,
  ): Promise<void> {
    const task = this.task(taskId);
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
      now - (this.#progressCheckpoints.get(taskId) ?? 0) >= 1000;
    if (checkpoint) this.#progressCheckpoints.set(taskId, now);
    // Every token would otherwise send the entire task across the bridge,
    // which grows with the conversation while the reason for sending it does
    // not. The interface paces the text it has anyway, so a frame's worth of
    // coalescing here is not visible there.
    const announce =
      !exists ||
      reasoningChanged ||
      now - (this.#progressEmits.get(taskId) ?? 0) >= progressEmitIntervalMs;
    if (announce) this.#progressEmits.set(taskId, now);
    await this.replaceTask(
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
  async withdrawAssistantMessage(
    taskId: string,
    assistantId: string,
  ): Promise<void> {
    const task = this.task(taskId);
    if (!task.messages.some((message) => message.id === assistantId)) return;
    await this.replaceTask({
      ...task,
      messages: task.messages.filter((message) => message.id !== assistantId),
    });
  }

  async showWorking(
    taskId: string,
    note: string | undefined,
    steps: readonly WorkStep[],
    retry?: { readonly readyAt: string; readonly count?: string },
  ): Promise<void> {
    const task = this.task(taskId);
    await this.replaceTask({
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

  visibleSteps(taskId: string): readonly WorkStep[] {
    const phase = this.task(taskId).phase;
    return phase.kind === "working" ||
      phase.kind === "approval" ||
      phase.kind === "input"
      ? phase.steps
      : [];
  }

  async showToolProgress(
    taskId: string,
    call: AssembledToolCall,
    inspection: Extract<ToolCallInspection, { readonly ok: true }>,
    presentation: PresentedAction,
    status: "active" | "complete" | "failed",
  ): Promise<void> {
    const id = `tool-${call.callId}`;
    await this.showWorking(taskId, undefined, [
      ...this.visibleSteps(taskId).filter((step) => step.id !== id),
      {
        id,
        label: presentation.title,
        detail: inspection.target,
        status,
      },
    ]);
  }

  /**
   * Records what happened to a picture between the tool producing it and the
   * model being shown it.
   *
   * Kept as an ordinary detail on the action rather than beside the stored
   * picture: the question it answers — was the model looking at this, or at
   * something smaller — is asked while reading the action, not the store.
   */
  async notePictureFitting(
    taskId: string,
    actionId: string,
    notes: readonly string[],
  ): Promise<void> {
    const task = this.task(taskId);
    const actions = task.actions;
    if (!actions.some((action) => action.id === actionId)) return;
    const detail = {
      kind: "text" as const,
      label:
        notes.length > 1
          ? "Pictures were changed to fit"
          : "Picture was changed to fit",
      text: notes.join(" "),
    };
    await this.replaceTask({
      ...task,
      actions: actions.map((action) =>
        action.id === actionId
          ? { ...action, details: [...(action.details ?? []), detail] }
          : action,
      ),
    });
  }

  /**
   * A name no other action in this conversation has had.
   *
   * The display position is deliberately absent from the identity. Rewind can
   * remove an action from active history, and a later action at that position
   * must still receive a fresh authority token.
   */
  nextActionId(taskId: string): string {
    return `${taskId}-action-${this.#deps.newActionId()}`;
  }

  /**
   * The next free position on the timeline, counting everything that occupies
   * one, views included: two drawings made in the same turn and the action
   * after them each take a position of their own, and sort in the order they
   * were made.
   */
  nextTimelineSequence(task: WorkspaceTask): number {
    const explicit = [
      ...task.messages.map((message) => message.sequence),
      ...task.actions.map((action) => action.sequence),
      ...task.views.map((view) => view.sequence),
      ...task.interactions.map((interaction) => interaction.sequence),
      ...task.specialistRuns.map((run) => run.sequence),
    ];
    const explicitNext = explicit.length > 0 ? Math.max(...explicit) + 1 : 0;
    return Math.max(
      explicitNext,
      task.messages.length +
        task.actions.length +
        task.views.length +
        task.interactions.length +
        task.specialistRuns.length,
    );
  }

  async recordUserInteraction(
    taskId: string,
    call: AssembledToolCall,
    request: UserInputRequest,
    response: UserInputResponse,
    result: ToolInvocationResult,
  ): Promise<void> {
    const task = this.task(taskId);
    const interactionId = `interaction-${call.callId}`;
    const sequence = this.nextTimelineSequence(task);
    const steps = this.visibleSteps(taskId);
    await this.replaceTask({
      ...task,
      interactions: [
        ...task.interactions.filter((item) => item.id !== interactionId),
        {
          id: interactionId,
          callId: call.callId,
          request,
          response,
          sequence,
        },
      ],
      messages: [
        ...task.messages,
        {
          id: `${interactionId}-answer`,
          role: "user",
          text: `Structured user response: ${JSON.stringify(result.ok ? result.value : response)}`,
          interactionId,
          sequence: sequence + 1,
        },
      ],
      phase: showsPrompt(task.phase) ? task.phase : { kind: "working", steps },
    });
  }

  /**
   * Puts a picture an action produced where a conversation can find it again.
   *
   * The record keeps the name, not the picture. A conversation's saved state is
   * rewritten whenever anything in it changes; a screenshot living inside that
   * file would be re-encoded and rewritten with it, and would still be lost the
   * moment the file had to be trimmed.
   *
   * A picture that cannot be stored is left out rather than half-recorded: a
   * detail naming a picture nobody can read is worse than no detail.
   */
  async #keepPictures(
    taskId: string,
    result: ToolInvocationResult | undefined,
    title: string,
    from: "tool" | "connector",
  ): Promise<readonly ActionDetail[]> {
    if (!result?.ok || !result.images?.length) return [];
    const kept: ActionDetail[] = [];
    for (const [index, image] of result.images.entries()) {
      try {
        const source = await this.#deps.sessions.savePicture(
          taskId,
          image,
          from,
        );
        kept.push({
          kind: "image",
          label: result.images.length > 1 ? `Picture ${index + 1}` : "Picture",
          mediaType: image.mediaType,
          source,
          alt: `A picture from ${title}`,
        });
      } catch {
        // Recorded as nothing rather than as a picture that cannot be opened.
      }
    }
    return kept;
  }

  async recordToolAction(
    taskId: string,
    id: string,
    {
      inspection,
      presentation,
      status,
      reason,
      call,
      approval,
      specialistRunId,
      evidence,
      readOnly,
      recovery,
      folder,
    }: {
      readonly inspection: Extract<ToolCallInspection, { readonly ok: true }>;
      readonly presentation: PresentedAction;
      readonly status: TaskAction["status"];
      readonly reason?: string;
      readonly call?: AssembledToolCall;
      readonly approval?: ActionApproval;
      readonly specialistRunId?: string;
      /** What the model was answered, for a call that never reached a tool. */
      readonly evidence?: string;
      /** Known to change nothing; see `TaskAction.readOnly`. */
      readonly readOnly?: boolean;
      /** The copy taken before the change, when one was. */
      readonly recovery?: ActionRecovery;
      /** The conversation's folder, for an action that begins running. */
      readonly folder?: string | undefined;
    },
  ): Promise<void> {
    const task = this.task(taskId);
    const actions = task.actions;
    const existing = actions.find((item) => item.id === id);
    const action: TaskAction = {
      id,
      ...(specialistRunId ? { specialistRunId } : {}),
      action: presentation.title,
      ...(presentation.description
        ? { description: presentation.description }
        : {}),
      target: inspection.target,
      command: evidenceText(inspection.command),
      ...(inspection.detail ? { detail: inspection.detail } : {}),
      ...(inspection.claim ? { claim: inspection.claim } : {}),
      ...(inspection.changes ? { changes: inspection.changes } : {}),
      ...(call
        ? {
            toolName: call.name,
            invocation:
              inspection.invocation ??
              describeInvocation(
                call.name,
                call.arguments,
                inspection.destination,
              ),
          }
        : {}),
      ...(approval ? { approval } : {}),
      ...(evidence ? { evidence } : {}),
      ...(readOnly ? { readOnly: true as const } : {}),
      ...(recovery ? { recovery } : {}),
      ...(existing?.startedAt
        ? { startedAt: existing.startedAt }
        : status === "running"
          ? { startedAt: this.#deps.now().toISOString() }
          : {}),
      ...(existing?.folder
        ? { folder: existing.folder }
        : folder
          ? { folder }
          : {}),
      status,
      sequence: existing?.sequence ?? this.nextTimelineSequence(task),
      ...(reason ? { reason } : {}),
    };
    await this.replaceTask({
      ...task,
      actions: existing
        ? actions.map((item) => (item.id === id ? action : item))
        : [...actions, action],
    });
  }

  /** An action's label, replaced by the one written for it in the background. */
  async relabelAction(
    taskId: string,
    actionId: string,
    label: { readonly title: string; readonly description: string },
  ): Promise<void> {
    const task = this.task(taskId);
    if (!task.actions.some((item) => item.id === actionId)) return;
    await this.replaceTask({
      ...task,
      actions: task.actions.map((item) =>
        item.id === actionId
          ? { ...item, action: label.title, description: label.description }
          : item,
      ),
    });
  }

  async finishToolAction(
    taskId: string,
    call: AssembledToolCall,
    actionId: string,
    {
      inspection,
      presentation,
      status,
      reason,
      result,
      from = "tool",
    }: {
      readonly inspection: Extract<ToolCallInspection, { readonly ok: true }>;
      readonly presentation: PresentedAction;
      readonly status: "completed" | "reported" | "failed";
      readonly reason?: string | undefined;
      readonly result?: ToolInvocationResult;
      /** Whose pictures these are: a connector's are kept apart from the tools'. */
      readonly from?: "tool" | "connector";
    },
  ): Promise<void> {
    const task = this.task(taskId);
    const existing = task.actions.find((item) => item.id === actionId);
    const pictures = await this.#keepPictures(
      taskId,
      result,
      presentation.title,
      from,
    );
    const action: TaskAction = {
      ...existing,
      id: actionId,
      action: presentation.title,
      ...(presentation.description
        ? { description: presentation.description }
        : {}),
      target: inspection.target,
      command: evidenceText(inspection.command),
      toolName: call.name,
      invocation:
        inspection.invocation ??
        describeInvocation(call.name, call.arguments, inspection.destination),
      // Kept past the approval: what a change was going to do and what it did
      // are the same question, and the second is the harder one to answer from
      // a summary written after the fact.
      ...(inspection.detail ? { detail: inspection.detail } : {}),
      ...(inspection.claim ? { claim: inspection.claim } : {}),
      ...(inspection.changes ? { changes: inspection.changes } : {}),
      ...(result?.commandChanges
        ? { commandChanges: result.commandChanges }
        : {}),
      ...(pictures.length || result?.details
        ? { details: [...pictures, ...(result?.details ?? [])] }
        : {}),
      // Without the pictures: what is written down names them, and the store
      // holds them. An encoded image inside the saved conversation would be
      // rewritten every time anything in that conversation changed.
      ...(result
        ? { evidence: evidenceText({ ...result, images: undefined }) }
        : {}),
      finishedAt: this.#deps.now().toISOString(),
      status,
      sequence: existing?.sequence ?? this.nextTimelineSequence(task),
      ...(reason ? { reason } : {}),
    };
    // A drawing that arrived is its own record. Keeping the request beside it
    // says the same thing twice, once in the words of the call and once as the
    // picture the call was for. A drawing that failed keeps its row, because
    // then the row is the only account of what was attempted.
    const drawn = result?.ok === true && result.view !== undefined;
    const actions = drawn
      ? task.actions.filter((item) => item.id !== actionId)
      : task.actions.map((item) => (item.id === actionId ? action : item));
    const produced = result?.produced ?? [];
    const artifacts = produced.length
      ? this.#deps.artifacts.record(
          task.artifacts,
          produced,
          this.#deps.now(),
          task.workspace?.path,
        )
      : task.artifacts;
    const view = result?.ok ? result.view : undefined;
    const views = view
      ? [
          ...task.views.filter((item) => item.callId !== call.callId),
          {
            ...view,
            id: `view-${call.callId}`,
            callId: call.callId,
            sequence: this.nextTimelineSequence(task),
          },
        ]
      : task.views;
    const stepId = `tool-${call.callId}`;
    const steps = this.visibleSteps(taskId).filter(
      (step) => step.id !== stepId,
    );
    await this.replaceTask({
      ...task,
      actions,
      artifacts,
      views,
      phase: showsPrompt(task.phase)
        ? { ...task.phase, steps }
        : { kind: "working", steps },
    });
    await this.announceWritten(
      taskId,
      writtenFiles(produced, result?.commandChanges),
    );
  }

  /**
   * Tells the app around the turn which workspace files were written, so a
   * document among them is shown. Showing one never fails the turn.
   */
  async announceWritten(
    taskId: string,
    paths: readonly string[],
  ): Promise<void> {
    if (!paths.length) return;
    await this.#deps.host.filesWritten(taskId, paths).catch(() => undefined);
  }

  task(taskId: string): WorkspaceTask {
    const task = this.#deps.host.find(taskId);
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
    const commit = this.#storeGuard(task);
    if (!commit()) return false;
    this.#unsaved.set(task.id, task);
    const saving = this.#deps.host.store(task, {
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
   * it again changes nothing more.
   */
  async changeOutsideTurns(
    taskId: string,
    change: (task: WorkspaceTask) => WorkspaceTask | undefined,
  ): Promise<boolean> {
    // A stop ends its turn, so a second write meets no stopped turn; a third
    // covers another turn started and stopped meanwhile.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (!this.#deps.host.find(taskId)) return false;
      const changed = change(this.task(taskId));
      if (!changed) return attempt > 0;
      if (!(await this.replaceTask(changed))) continue;
      const earlier = [...(this.#saving.get(taskId) ?? [])];
      if (!earlier.length) return true;
      await Promise.allSettled(earlier);
    }
    return false;
  }

  /**
   * Ends a turn the person paused, with the progress report it asked for, or
   * says the report never came.
   */
  async finishPausedReport(taskId: string, report: string): Promise<void> {
    const task = this.task(taskId);
    await this.replaceTask({
      ...task,
      phase: report.trim()
        ? {
            kind: "completed",
            outcome: { title: "Work paused", summary: report },
          }
        : {
            kind: "interrupted",
            reason:
              "Work paused, but the model did not return the requested progress report.",
          },
    });
  }

  async interrupt(taskId: string, reason?: string): Promise<void> {
    const task = this.#deps.host.find(taskId);
    if (!task) return;
    const actions = task.actions.map((action) =>
      action.status === "running"
        ? {
            ...action,
            status: "cancelled" as const,
            reason: action.toolName?.startsWith("mcp__")
              ? "Stopped. The action may already have taken effect; check what it changes before retrying."
              : "The action stopped before it completed.",
          }
        : action,
    );
    if (
      task.phase.kind === "interrupted" &&
      !reason &&
      actions.every((action, index) => action === task.actions[index])
    ) {
      return;
    }
    await this.replaceTask({
      ...task,
      actions,
      phase: { kind: "interrupted", ...(reason ? { reason } : {}) },
    });
  }
}
