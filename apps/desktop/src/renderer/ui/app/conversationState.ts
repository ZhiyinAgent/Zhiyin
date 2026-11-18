import type {
  ConversationSummary,
  WorkspaceTask as CoreWorkspaceTask,
} from "@zhiyin/contract";

/**
 * A conversation as the window holds it: the parts of the core's it shows.
 * The record of model requests and what the model was sent stay in the core.
 */
export type WorkspaceTask = Pick<
  CoreWorkspaceTask,
  | "reasoning"
  | "contextBudget"
  | "contextUsage"
  | "condensings"
  | "standingInstructions"
  | "id"
  | "title"
  | "workspace"
  | "project"
  | "memoryOff"
  | "updatedAt"
  | "updatedLabel"
  | "messages"
  | "guidance"
  | "actions"
  | "conversationPermissions"
  | "plan"
  | "artifacts"
  | "specialistRuns"
  | "views"
  | "interactions"
  | "undos"
  | "phase"
> & {
  /** The last message the model now knows only from a summary. */
  readonly condensedThrough?: string;
};

/**
 * The list the sidebar shows: every conversation the core listed, an opened
 * one as it is now, and one opened since the last list — a new conversation —
 * first; then the one changed last first. Undated conversations and ties keep
 * the order the core gave.
 */
export function listedConversations(state: {
  readonly tasks: readonly WorkspaceTask[];
  readonly conversations: readonly ConversationSummary[];
}): {
  readonly id: string;
  readonly title: string;
  readonly updatedAt: string;
  readonly updatedLabel: string;
  readonly needsUpdate?: { readonly writtenBy: string };
  readonly project?: string | null;
  readonly workspace?: { readonly path: string; readonly name: string };
  readonly memoryOff?: true;
}[] {
  const listed = new Set(state.conversations.map((item) => item.id));
  const opened = new Map(state.tasks.map((task) => [task.id, task]));
  return [
    ...state.tasks.filter((task) => !listed.has(task.id)),
    ...state.conversations.map((item) => opened.get(item.id) ?? item),
  ]
    .sort((a, b) =>
      a.updatedAt === b.updatedAt ? 0 : a.updatedAt < b.updatedAt ? 1 : -1,
    )
    .map((item) => ({
      id: item.id,
      title: item.title,
      updatedAt: item.updatedAt,
      updatedLabel: item.updatedLabel,
      ...("needsUpdate" in item && item.needsUpdate
        ? { needsUpdate: item.needsUpdate }
        : {}),
      ...(item.project !== undefined ? { project: item.project } : {}),
      ...(item.workspace ? { workspace: item.workspace } : {}),
      ...(item.memoryOff ? { memoryOff: true as const } : {}),
    }));
}

/**
 * Each part of a conversation the core sent, converted once. The core sends
 * what changed and keeps the rest as it was, so an unchanged message, action
 * or view stays the same object here too, and is not drawn again.
 */
const converted = new WeakMap<object, object>();

function once<From extends object, To extends object>(
  item: From,
  convert: (item: From) => To,
): To {
  const known = converted.get(item);
  if (known) return known as To;
  const made = convert(item);
  converted.set(item, made);
  return made;
}

/** The conversation the core sent, as the window holds it. */
export function taskFromCore(task: CoreWorkspaceTask): WorkspaceTask {
  return once(task, convertTask);
}

function convertTask(task: CoreWorkspaceTask): WorkspaceTask {
  const phase =
    task.phase.kind === "working"
      ? { ...task.phase, steps: task.phase.steps.map((step) => ({ ...step })) }
      : task.phase.kind === "approval"
        ? {
            ...task.phase,
            steps: task.phase.steps.map((step) => ({ ...step })),
            prompt: { ...task.phase.prompt },
          }
        : task.phase.kind === "input"
          ? {
              ...task.phase,
              steps: task.phase.steps.map((step) => ({ ...step })),
              prompt: { ...task.phase.prompt },
            }
          : task.phase.kind === "completed"
            ? {
                ...task.phase,
                outcome: { ...task.phase.outcome },
                ...(task.phase.backgroundSpecialistIds
                  ? {
                      backgroundSpecialistIds: [
                        ...task.phase.backgroundSpecialistIds,
                      ],
                    }
                  : {}),
              }
            : { ...task.phase };

  return {
    id: task.id,
    title: task.title,
    ...(task.reasoning ? { reasoning: { ...task.reasoning } } : {}),
    ...(task.contextBudget ? { contextBudget: task.contextBudget } : {}),
    ...(task.contextUsage ? { contextUsage: task.contextUsage } : {}),
    condensings: task.condensings,
    standingInstructions: task.standingInstructions,
    ...(task.compaction
      ? { condensedThrough: task.compaction.throughMessageId }
      : {}),
    ...(task.workspace ? { workspace: { ...task.workspace } } : {}),
    updatedAt: task.updatedAt,
    updatedLabel: task.updatedLabel,
    messages: task.messages.map((message) => once(message, copied)),
    guidance: task.guidance.map((item) => once(item, copied)),
    actions: task.actions.map((action) => once(action, copied)),
    conversationPermissions: task.conversationPermissions,
    plan: task.plan.map((item) => once(item, copied)),
    artifacts: task.artifacts.map((item) => once(item, copied)),
    specialistRuns: task.specialistRuns.map((run) => once(run, copied)),
    views: task.views.map((item) => once(item, copied)),
    interactions: task.interactions.map((item) =>
      once(item, (interaction) => ({
        ...interaction,
        request: { ...interaction.request },
        response: { ...interaction.response },
      })),
    ),
    undos: task.undos,
    phase,
  };
}

function copied<T extends object>(item: T): T {
  return { ...item };
}
