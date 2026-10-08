import type {
  RewindCommitResult,
  RewindPreview,
  TaskAction,
  WorkspaceTask,
} from "@zhiyin/contract";

export type { RewindPreview };

/** The file changes of one turn, bound to the conversation they were read from. */
export type UndoPlan = {
  readonly ok: true;
  readonly id: string;
  readonly taskId: string;
  readonly messageId: string;
  readonly actions: readonly TaskAction[];
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
  /** Records an undo on the conversation it was planned from, and nothing else. */
  applyUndo(
    task: WorkspaceTask,
    plan: UndoPlan,
    files: RewindCommitResult["files"],
    at: string,
  ): RewindApplication;
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
      action.status === "completed" || action.status === "reported"
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
    const opening = task.messages.find((message) => message.id === messageId);
    if (!opening || opening.role !== "user" || opening.interactionId)
      return {
        ok: false,
        reason: "That message is no longer in the conversation.",
      };
    const start = opening.sequence;
    // A turn runs until the person's next message; an answer to a question is
    // part of the turn that asked it.
    const end = task.messages
      .filter(
        (message) =>
          message.role === "user" &&
          !message.interactionId &&
          message.sequence > start,
      )
      .map((message) => message.sequence)
      .reduce((earliest, sequence) => Math.min(earliest, sequence), Infinity);
    const undone = new Set(task.undos.flatMap((undo) => undo.actionIds));
    const actions = task.actions.filter(
      (action) =>
        action.sequence > start &&
        action.sequence < end &&
        (action.status === "completed" || action.status === "reported") &&
        Boolean(action.changes?.length) &&
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
      source: JSON.stringify(task),
    };
  }

  applyUndo(
    task: WorkspaceTask,
    plan: UndoPlan,
    files: RewindCommitResult["files"],
    at: string,
  ): RewindApplication {
    if (task.id !== plan.taskId || JSON.stringify(task) !== plan.source)
      return {
        ok: false,
        reason:
          "The conversation changed while the undo was being reviewed. Review it again.",
      };
    return {
      ok: true,
      task: {
        ...task,
        undos: [
          ...task.undos,
          {
            id: plan.id,
            messageId: plan.messageId,
            actionIds: plan.actions.map((action) => action.id),
            at,
            files,
          },
        ],
      },
    };
  }
}

/**
 * What the model was sent before the first message the rewind removes. The
 * model's calls and results after it belong to the removed exchanges.
 */
function sentBefore(
  sent: WorkspaceTask["modelHistory"],
  retainedMessageIds: ReadonlySet<string>,
): WorkspaceTask["modelHistory"] {
  const cut = sent.findIndex(
    (entry) =>
      (entry.kind === "message" || entry.kind === "calls") &&
      entry.messageId !== undefined &&
      !retainedMessageIds.has(entry.messageId),
  );
  return cut < 0 ? sent : sent.slice(0, cut);
}
