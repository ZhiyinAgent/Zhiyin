import {
  type RewindCommitResult,
  type RewindPreview,
  type TaskAction,
  type WorkspaceTask,
} from "@zhiyin/contract";
import { actionsOfTurn, ranToItsEnd } from "@zhiyin/conversation-rules";

export type { RewindPreview };

/** The file changes of one turn, bound to the conversation they were read from. */
export type UndoPlan = {
  readonly ok: true;
  readonly id: string;
  readonly taskId: string;
  readonly messageId: string;
  /** The actions whose file changes are undone. */
  readonly actions: readonly TaskAction[];
  /** Every action of the turn, those that kept something in memory among them. */
  readonly turn: readonly TaskAction[];
  /** Exact authority binding. Never sent to the renderer. */
  readonly source: string;
};

export type RewindPlan = {
  readonly ok: true;
  readonly preview: RewindPreview;
  readonly task: WorkspaceTask;
  /** Exact authority binding. Never sent to the renderer. */
  readonly source: string;
};

export type RewindRefusal = { readonly ok: false; readonly reason: string };
export type RewindPlanning = RewindPlan | RewindRefusal;
export type RewindApplication =
  { readonly ok: true; readonly task: WorkspaceTask } | RewindRefusal;
export type UndoPlanning = UndoPlan | RewindRefusal;

export interface RewindPlanner {
  plan(task: WorkspaceTask, messageId: string): RewindPlanning;
  apply(task: WorkspaceTask, plan: RewindPlan): RewindApplication;
  /** The file changes of the turn the message opened, still to be undone. */
  planUndo(task: WorkspaceTask, messageId: string): UndoPlanning;
  /**
   * Records an undo on the conversation it was planned from, with what became
   * of the turn's memory writes, each taken back marked undone on its card,
   * and nothing else.
   */
  applyUndo(
    task: WorkspaceTask,
    plan: UndoPlan,
    files: RewindCommitResult["files"],
    at: string,
    memory?: RewindCommitResult["memory"],
  ): RewindApplication;
}

/**
 * Whether a shell command was found to create or change a file: going back
 * can remove a file the turn made, however many commands changed it after.
 */
function changedByCommand(action: TaskAction): boolean {
  const found = action.commandChanges;
  return (
    found?.status === "checked" &&
    found.files.some((file) => file.change !== "deleted")
  );
}

/**
 * What the timeline held before the boundary. Specialist runs are cut the same
 * way: one left behind would go on being announced to the model and drawn in
 * the timeline, telling of work the rewind took away.
 */
function before<T extends { readonly sequence: number }>(
  values: readonly T[],
  boundary: number,
): readonly T[] {
  return values.filter((value) => value.sequence < boundary);
}

function retainedArtifacts(
  task: WorkspaceTask,
  actions: readonly TaskAction[],
): WorkspaceTask["artifacts"] {
  const retainedPaths = new Set(
    actions.flatMap((action) =>
      ranToItsEnd(action)
        ? (action.changes ?? []).map((change) => change.path)
        : [],
    ),
  );
  return task.artifacts.filter((artifact) => retainedPaths.has(artifact.path));
}

export class ConversationRewind implements RewindPlanner {
  readonly #newId: () => string;

  constructor(newId: () => string) {
    this.#newId = newId;
  }

  plan(task: WorkspaceTask, messageId: string): RewindPlanning {
    const selected = task.messages.find((message) => message.id === messageId);
    if (!selected)
      return {
        ok: false,
        reason: "That message is no longer in the conversation.",
      };
    if (selected.role !== "user")
      return { ok: false, reason: "Only a message you wrote can be rewound." };
    if (selected.interactionId)
      return {
        ok: false,
        reason: "Only an ordinary message can be edited and rewound.",
      };
    const boundary = selected.sequence;
    const messages = before(task.messages, boundary);
    const actions = before(task.actions, boundary);
    const views = before(task.views, boundary);
    const interactions = before(task.interactions, boundary);
    const condensings = before(task.condensings, boundary);
    const retainedMessageIds = new Set(messages.map((message) => message.id));
    const { compaction: previousCompaction, ...taskWithoutCompaction } = task;
    const compaction =
      previousCompaction &&
      retainedMessageIds.has(previousCompaction.throughMessageId)
        ? {
            ...previousCompaction,
            retainedActionIds: previousCompaction.retainedActionIds.filter(
              (id) => actions.some((action) => action.id === id),
            ),
          }
        : undefined;
    const proposed: WorkspaceTask = {
      ...taskWithoutCompaction,
      modelHistory: sentBefore(task.modelHistory, retainedMessageIds),
      messages,
      actions,
      plan: [],
      artifacts: retainedArtifacts(task, actions),
      views,
      interactions,
      condensings,
      undos: task.undos.filter((undo) =>
        retainedMessageIds.has(undo.messageId),
      ),
      specialistRuns: before(task.specialistRuns, boundary),
      phase: { kind: "draft" },
      ...(compaction ? { compaction } : {}),
    };
    return {
      ok: true,
      source: JSON.stringify(task),
      task: proposed,
      preview: {
        id: this.#newId(),
        taskId: task.id,
        messageId,
        draft: selected.text,
        discardedMessages: task.messages.length - messages.length,
        laterUserMessages: task.messages.filter(
          (message) => message.role === "user" && message.sequence > boundary,
        ).length,
        discardedActions: task.actions.filter(
          (action) => action.sequence >= boundary,
        ),
        files: [],
        memory: [],
      },
    };
  }

  apply(task: WorkspaceTask, plan: RewindPlan): RewindApplication {
    if (task.id !== plan.preview.taskId || JSON.stringify(task) !== plan.source)
      return {
        ok: false,
        reason:
          "The conversation changed while the rewind was being reviewed. Review it again.",
      };
    return { ok: true, task: plan.task };
  }

  planUndo(task: WorkspaceTask, messageId: string): UndoPlanning {
    const turn = actionsOfTurn(task, messageId);
    if (!turn)
      return {
        ok: false,
        reason: "That message is no longer in the conversation.",
      };
    const undone = new Set(task.undos.flatMap((undo) => undo.actionIds));
    const actions = turn.filter(
      (action) =>
        ranToItsEnd(action) &&
        (Boolean(action.changes?.length) || changedByCommand(action)) &&
        !undone.has(action.id),
    );
    if (!actions.length)
      return {
        ok: false,
        reason: "This turn has no file changes left to undo.",
      };
    return {
      ok: true,
      id: this.#newId(),
      taskId: task.id,
      messageId,
      actions,
      turn,
      source: JSON.stringify(task),
    };
  }

  applyUndo(
    task: WorkspaceTask,
    plan: UndoPlan,
    files: RewindCommitResult["files"],
    at: string,
    memory?: RewindCommitResult["memory"],
  ): RewindApplication {
    if (task.id !== plan.taskId || JSON.stringify(task) !== plan.source)
      return {
        ok: false,
        reason:
          "The conversation changed while the undo was being reviewed. Review it again.",
      };
    const undone = new Set(
      (memory ?? [])
        .filter((write) => write.status === "undone")
        .map((write) => write.writeId),
    );
    return {
      ok: true,
      task: {
        ...task,
        actions: task.actions.map((action) =>
          action.memory && undone.has(action.memory.writeId)
            ? {
                ...action,
                memory: { ...action.memory, state: "undone" as const },
              }
            : action,
        ),
        undos: [
          ...task.undos,
          {
            id: plan.id,
            messageId: plan.messageId,
            actionIds: plan.actions.map((action) => action.id),
            at,
            files,
            ...(memory?.length ? { memory } : {}),
          },
        ],
      },
    };
  }
}

/**
 * What the model was sent before the first message the rewind removes, as a
 * message, a round of calls or guidance delivered as a notice. The model's
 * calls and results after it belong to the removed exchanges.
 */
function sentBefore(
  sent: WorkspaceTask["modelHistory"],
  retainedMessageIds: ReadonlySet<string>,
): WorkspaceTask["modelHistory"] {
  const cut = sent.findIndex(
    (entry) =>
      (entry.kind === "message" ||
        entry.kind === "calls" ||
        entry.kind === "notice") &&
      entry.messageId !== undefined &&
      !retainedMessageIds.has(entry.messageId),
  );
  return cut < 0 ? sent : sent.slice(0, cut);
}
