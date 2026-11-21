import type {
  ActionDetail,
  ActionApproval,
  ActionRecovery,
  TaskAction,
  ToolCallInspection,
  ToolInvocationResult,
  UserInputRequest,
  UserInputResponse,
  WorkspaceTask,
} from "@zhiyin/contract";
import { GrantRecords } from "./grant-records.js";
import { GuidanceRecords } from "./guidance-records.js";
import { ProgressRecords, showsPrompt } from "./progress-records.js";
import { TaskStore } from "./task-store.js";
import { nextTimelineSequence } from "./timeline.js";
import { writtenFiles } from "./written-files.js";
import { describeInvocation } from "../tools/invocation.js";
import { mayTakeEffect } from "../tools/declared-effects.js";
import { evidenceText } from "../context/evidence.js";
import type { AgentLoopDependencies } from "../dependencies.js";
import { type AssembledToolCall, type PresentedAction } from "./turn-shared.js";

/**
 * Whether an action stopped while it ran may have done something already:
 * any but one its record says changes, sends and acts as no one, or, when it
 * declared no effects, one Zhiyin's code knows to change nothing.
 */
function mayHaveTakenEffect(action: TaskAction): boolean {
  return action.effects ? mayTakeEffect(action.effects) : !action.readOnly;
}

/**
 * What every record of an action holds of its call, however far it got: its
 * heading and description, what it does as its tool declared it, and, for a
 * call the model made, the call as it was made.
 */
function actionFields(
  inspection: Extract<ToolCallInspection, { readonly ok: true }>,
  presentation: PresentedAction,
  call: AssembledToolCall | undefined,
) {
  return {
    action: presentation.title,
    ...(presentation.description
      ? {
          description: presentation.description,
          ...(presentation.byModel ? { descriptionBy: "model" as const } : {}),
        }
      : {}),
    ...(inspection.effects ? { effects: inspection.effects } : {}),
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
              inspection.destinations?.join(", "),
            ),
        }
      : {}),
  } satisfies Partial<TaskAction>;
}

/** What the turn's records use. */
export type TurnRecordsDependencies = Pick<
  AgentLoopDependencies,
  "artifacts" | "host" | "kept" | "newActionId" | "now" | "rewind"
>;

/**
 * Writes what a turn does onto its conversation: the actions it takes, the
 * answers it is given, the pictures it keeps, and the progress a person watches.
 */
export class TurnRecords {
  readonly #deps: TurnRecordsDependencies;
  readonly #store: TaskStore;
  /** What the person says while the turn works, and specialists' hand-offs. */
  readonly guidance: GuidanceRecords;
  /** The grants the conversation holds. */
  readonly grants: GrantRecords;
  /** The progress the person watches. */
  readonly progress: ProgressRecords;

  constructor(
    deps: TurnRecordsDependencies,
    storeGuard: (task: WorkspaceTask) => () => boolean,
  ) {
    this.#deps = deps;
    this.#store = new TaskStore(deps.host, storeGuard, deps.rewind);
    this.guidance = new GuidanceRecords(this.#store);
    this.grants = new GrantRecords(this.#store);
    this.progress = new ProgressRecords(this.#store);
  }

  /** The conversation as the turn last wrote it. */
  task(taskId: string): WorkspaceTask {
    return this.#store.task(taskId);
  }

  /** Writes the conversation; false when the turn's guard refused it. */
  replaceTask(
    task: WorkspaceTask,
    persist = true,
    emit = true,
  ): Promise<boolean> {
    return this.#store.replaceTask(task, persist, emit);
  }

  /** A change made on no turn's behalf, made again when a stop lost it. */
  changeOutsideTurns(
    taskId: string,
    change: (task: WorkspaceTask) => WorkspaceTask | undefined,
  ): Promise<boolean> {
    return this.#store.changeOutsideTurns(taskId, change);
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

  async recordUserInteraction(
    taskId: string,
    call: AssembledToolCall,
    request: UserInputRequest,
    response: UserInputResponse,
    result: ToolInvocationResult,
  ): Promise<void> {
    const task = this.task(taskId);
    const interactionId = `interaction-${call.callId}`;
    const sequence = nextTimelineSequence(task);
    const steps = this.progress.steps(taskId);
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
        const source = await this.#deps.kept.savePicture(taskId, image, from);
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
      marks,
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
      /** What it brings into the conversation; see `TaskAction.brings`. */
      readonly marks?: Pick<TaskAction, "brings" | "reachesPrivate">;
    },
  ): Promise<void> {
    const task = this.task(taskId);
    const actions = task.actions;
    const existing = actions.find((item) => item.id === id);
    const action: TaskAction = {
      id,
      ...(specialistRunId ? { specialistRunId } : {}),
      ...actionFields(inspection, presentation, call),
      ...(inspection.readsText?.length
        ? { readText: inspection.readsText }
        : {}),
      ...(call ? { callId: call.callId } : {}),
      ...(approval ? { approval } : {}),
      ...(evidence ? { evidence } : {}),
      ...(readOnly ? { readOnly: true as const } : {}),
      ...(marks ?? {}),
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
      sequence: existing?.sequence ?? nextTimelineSequence(task),
      // Bounded as the evidence is: the model was shown its own sized copy.
      ...(reason ? { reason: evidenceText(reason) } : {}),
    };
    await this.replaceTask({
      ...task,
      actions: existing
        ? actions.map((item) => (item.id === id ? action : item))
        : [...actions, action],
    });
  }

  /** An action's description, written for it by the model in the background. */
  async describeAction(
    taskId: string,
    actionId: string,
    description: string,
  ): Promise<void> {
    const task = this.task(taskId);
    if (!task.actions.some((item) => item.id === actionId)) return;
    await this.replaceTask({
      ...task,
      actions: task.actions.map((item) =>
        item.id === actionId
          ? // The title stays Zhiyin's; the model's account is kept as its words.
            {
              ...item,
              description,
              descriptionBy: "model" as const,
            }
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
    const pictures = await this.#keepPictures(
      taskId,
      result,
      presentation.title,
      from,
    );
    // Read once the pictures are kept: what changed while they were, such as
    // a specialist's end, stays.
    const task = this.task(taskId);
    const existing = task.actions.find((item) => item.id === actionId);
    const action: TaskAction = {
      ...existing,
      id: actionId,
      // Kept past the approval: what a change was going to do and what it did
      // are the same question, and the second is the harder one to answer from
      // a summary written after the fact.
      ...actionFields(inspection, presentation, call),
      ...(result?.commandChanges
        ? { commandChanges: result.commandChanges }
        : {}),
      ...(result?.brings === "outside" ? { brings: "outside" as const } : {}),
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
      sequence: existing?.sequence ?? nextTimelineSequence(task),
      // Bounded as the evidence is: the model was shown its own sized copy.
      ...(reason ? { reason: evidenceText(reason) } : {}),
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
            sequence: nextTimelineSequence(task),
          },
        ]
      : task.views;
    const stepId = `tool-${call.callId}`;
    const steps = this.progress
      .steps(taskId)
      .filter((step) => step.id !== stepId);
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
            paused: true,
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
            reason: mayHaveTakenEffect(action)
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
