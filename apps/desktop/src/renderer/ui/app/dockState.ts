import type { ApprovalRequest, WorkspaceTask } from "./workspaceState.js";

/** What the permission request shows, taken from the request the core sent. */
export function approvalPromptDetails(prompt: ApprovalRequest) {
  return {
    title: prompt.action,
    target: prompt.target,
    command: prompt.command,
    ...(prompt.reason ? { description: prompt.reason } : {}),
    ...(prompt.effect ? { effect: prompt.effect } : {}),
    ...(prompt.detail ? { detail: prompt.detail } : {}),
    ...(prompt.claim ? { claim: prompt.claim } : {}),
    ...(prompt.destination ? { destination: prompt.destination } : {}),
    ...(prompt.invocation ? { invocation: prompt.invocation } : {}),
    ...(prompt.changes ? { changes: prompt.changes } : {}),
    ...(prompt.recovery ? { recovery: prompt.recovery } : {}),
  };
}

/**
 * Why the composer is closed, when it is: the task is waiting on the person,
 * or there is nothing connected to run a task at all.
 */
export function composerLock(
  task: WorkspaceTask | null,
  tasksAvailable: boolean,
) {
  if (task?.phase.kind === "approval")
    return {
      disabledReason: "Answer the permission request first",
      disabledPlaceholder: "Waiting for your decision",
    };
  if (task?.phase.kind === "input") {
    if (task.phase.prompt.kind === "quiz")
      return {
        disabledReason: "Answer the quiz first",
        disabledPlaceholder: "Finish the quiz to keep chatting",
      };
    if (task.phase.prompt.kind === "workBudget")
      return {
        disabledReason: "Choose whether the task should continue or pause",
        disabledPlaceholder: "Waiting for your work-budget choice",
      };
    return {
      disabledReason: "Answer the questions first",
      disabledPlaceholder: "Waiting for your answers",
    };
  }
  if (!tasksAvailable)
    return {
      disabledReason: "Task execution is not connected yet",
      disabledPlaceholder: "Composer unavailable",
    };
  return {};
}
