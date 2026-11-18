import type { TaskAction, TaskPhase, WorkspaceTask } from "@zhiyin/contract";

/** Each phase, and whether a turn is still going in it. */
const underWay: Readonly<Record<TaskPhase["kind"], boolean>> = {
  draft: false,
  working: true,
  approval: true,
  input: true,
  completed: false,
  failed: false,
  interrupted: false,
};

/**
 * Whether a conversation in this phase has a turn still going: the model at
 * work, or a question of the turn waiting on the person.
 */
export function turnUnderWay(kind: TaskPhase["kind"]): boolean {
  return underWay[kind];
}

/**
 * The actions of the turn the person's message opened, or nothing when the
 * conversation no longer holds that message. A turn runs until the person's
 * next message; an answer to a question is part of the turn that asked it.
 */
export function actionsOfTurn(
  task: Pick<WorkspaceTask, "messages" | "actions">,
  messageId: string,
): readonly TaskAction[] | undefined {
  const opening = task.messages.find((message) => message.id === messageId);
  if (!opening || opening.role !== "user" || opening.interactionId)
    return undefined;
  const start = opening.sequence;
  const end = task.messages
    .filter(
      (message) =>
        message.role === "user" &&
        !message.interactionId &&
        message.sequence > start,
    )
    .map((message) => message.sequence)
    .reduce((earliest, sequence) => Math.min(earliest, sequence), Infinity);
  return task.actions.filter(
    (action) => action.sequence > start && action.sequence < end,
  );
}

/**
 * Whether an action ran to its end, so what it would change was changed.
 * Everything that weighs an action's effects asks this one question.
 */
export function ranToItsEnd(action: Pick<TaskAction, "status">): boolean {
  return action.status === "completed" || action.status === "reported";
}
