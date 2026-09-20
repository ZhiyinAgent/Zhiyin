/**
 * What a turn leaves behind when it does not finish, and how it is settled.
 *
 * A turn cannot outlive the process running it, and reasoning cannot still be
 * arriving once a turn has ended. Both rules belong to the turn, so they are
 * written here rather than wherever a conversation happens to be read or saved.
 */

import type { WorkspaceTask } from "@zhiyin/contract";

/** The phases a turn passes through while it is still going. */
const unfinished = ["loading", "working", "approval", "input", "browser"];

const stoppedReasoning = (
  task: WorkspaceTask,
  status: "interrupted" | "complete",
): WorkspaceTask["messages"] =>
  task.messages.map((message) =>
    message.reasoning?.status === "streaming"
      ? { ...message, reasoning: { ...message.reasoning, status } }
      : message,
  );

/**
 * A conversation as it is found after a restart. An action that was running
 * stopped when the app closed, and a turn still under way is interrupted.
 *
 * A conversation with nothing to settle comes back as the same object, so the
 * caller can tell whether anything needed settling without comparing fields.
 */
export function settledAfterRestart(task: WorkspaceTask): WorkspaceTask {
  const actions = (task.actions ?? []).map((action) =>
    action.status === "running"
      ? {
          ...action,
          status: "cancelled" as const,
          reason: "The app closed before this action completed.",
        }
      : action,
  );
  const stoppedAction = actions.some(
    (action, index) => action !== task.actions?.[index],
  );
  const specialistRuns = (task.specialistRuns ?? []).map((run) =>
    run.status === "running"
      ? {
          ...run,
          status: "interrupted" as const,
          finishedAt: new Date().toISOString(),
          reason: "The app closed before this specialist completed.",
        }
      : run,
  );
  const stoppedSpecialist = specialistRuns.some(
    (run, index) => run !== task.specialistRuns?.[index],
  );
  const interrupted = unfinished.includes(task.phase.kind);
  if (!interrupted && !stoppedAction && !stoppedSpecialist) return task;
  return interrupted
    ? {
        ...task,
        actions,
        specialistRuns,
        messages: stoppedReasoning(task, "interrupted"),
        phase: { kind: "interrupted" as const },
      }
    : { ...task, actions, specialistRuns };
}

/**
 * A conversation whose turn has ended. Reasoning still marked as arriving is
 * settled with the turn: finished when the turn completed, interrupted when it
 * did not. A turn still running is left alone.
 */
export function settledWhenTurnEnded(task: WorkspaceTask): WorkspaceTask {
  if (!["failed", "interrupted", "completed"].includes(task.phase.kind))
    return task;
  return {
    ...task,
    messages: stoppedReasoning(
      task,
      task.phase.kind === "completed" ? "complete" : "interrupted",
    ),
  };
}
