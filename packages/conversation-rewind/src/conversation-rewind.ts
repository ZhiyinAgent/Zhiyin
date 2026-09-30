import type {
  RewindPreview,
  TaskAction,
  WorkspaceTask,
} from "@zhiyin/contract";

export type { RewindPreview };

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

export interface RewindPlanner {
  plan(task: WorkspaceTask, messageId: string): RewindPlanning;
  apply(task: WorkspaceTask, plan: RewindPlan): RewindApplication;
}

function sequenceOf(value: { readonly sequence?: number }): number | undefined {
  return value.sequence;
}

function before<T extends { readonly sequence?: number }>(
  values: readonly T[] | undefined,
  boundary: number,
): readonly T[] {
  return (values ?? []).filter(
    (value) => (sequenceOf(value) ?? boundary) < boundary,
  );
}

function supportsExactBoundary(task: WorkspaceTask): boolean {
  return [
    ...task.messages,
    ...(task.actions ?? []),
    ...(task.views ?? []),
    ...(task.interactions ?? []),
  ].every((entry) => entry.sequence !== undefined);
}

function retainedArtifacts(
  task: WorkspaceTask,
  actions: readonly TaskAction[],
): NonNullable<WorkspaceTask["artifacts"]> {
  const retainedPaths = new Set(
    actions.flatMap((action) =>
      action.status === "completed" || action.status === "reported"
        ? (action.changes ?? []).map((change) => change.path)
        : [],
    ),
  );
  return (task.artifacts ?? []).filter((artifact) =>
    retainedPaths.has(artifact.path),
  );
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
    if (!supportsExactBoundary(task) || selected.sequence === undefined)
      return {
        ok: false,
        reason:
          "This older conversation does not contain the exact history needed for a safe rewind.",
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
      ...(task.modelHistory
        ? { modelHistory: sentBefore(task.modelHistory, retainedMessageIds) }
        : {}),
      messages,
      actions,
      plan: [],
      artifacts: retainedArtifacts(task, actions),
      views,
      interactions,
      // Set even when empty, or the spread above would keep what was dropped.
      condensings,
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
        discardedActions: (task.actions ?? []).filter(
          (action) => (action.sequence as number) >= boundary,
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
}

/**
 * What the model was sent before the first message the rewind removes. The
 * model's calls and results after it belong to the removed exchanges.
 */
function sentBefore(
  sent: NonNullable<WorkspaceTask["modelHistory"]>,
  retainedMessageIds: ReadonlySet<string>,
): NonNullable<WorkspaceTask["modelHistory"]> {
  const cut = sent.findIndex(
    (entry) =>
      (entry.kind === "message" || entry.kind === "calls") &&
      entry.messageId !== undefined &&
      !retainedMessageIds.has(entry.messageId),
  );
  return cut < 0 ? sent : sent.slice(0, cut);
}
