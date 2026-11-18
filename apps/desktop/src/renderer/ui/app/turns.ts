import type { WaitingOn } from "../conversation/index.js";
import type { WorkspaceTask } from "./conversationState.js";

/**
 * The specialists a finished turn left running, which is all the conversation
 * is waiting on; nothing while the turn itself is still working.
 */
function waitingOn(task: WorkspaceTask): WaitingOn | undefined {
  if (task.phase.kind !== "completed") return undefined;
  const running = task.specialistRuns.filter((run) => run.status === "running");
  if (running.length === 0) return undefined;
  const ids = new Set(running.map((run) => run.id));
  const calls = new Set([
    ...running.flatMap((run) => run.actionIds),
    ...task.actions
      .filter(
        (action) => action.specialistRunId && ids.has(action.specialistRunId),
      )
      .map((action) => action.id),
  ]).size;
  return {
    names: [...new Set(running.map((run) => run.specialist.name))],
    calls,
    since: running
      .map((run) => run.startedAt)
      .reduce((earliest, startedAt) =>
        Date.parse(startedAt) < Date.parse(earliest) ? startedAt : earliest,
      ),
  };
}

/**
 * The task as the conversation draws it. A specialist's own actions are drawn
 * under its run, not a second time in the main history. A look back's are
 * drawn on no row: what it kept shows on the turn's Memory card (ADR 0026).
 */
export function timelineTask(
  task: WorkspaceTask,
  /** When its earlier part began being summarised, while it is. */
  compactingSince?: string,
) {
  const specialistOwned = new Set([
    ...task.specialistRuns.flatMap((run) => run.actionIds),
    ...task.actions
      .filter((action) => action.specialistRunId)
      .map((action) => action.id),
  ]);
  const waiting = waitingOn(task);
  return {
    ...task,
    ...(waiting ? { waitingOn: waiting } : {}),
    ...(compactingSince ? { compacting: true, compactingSince } : {}),
    actions: task.actions.filter(
      (action) => !specialistOwned.has(action.id) && !action.lookBack,
    ),
  };
}

/**
 * The message a failed turn answered: the last one the person wrote that is
 * not an answer to a question.
 */
export function answeredMessage(task: WorkspaceTask) {
  return task.messages.findLast(
    (message) => message.role === "user" && !message.interactionId,
  );
}
