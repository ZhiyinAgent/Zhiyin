import {
  turnUnderWay,
  type TaskArtifact,
  type TaskView,
  type WorkspaceTask,
} from "@zhiyin/contract";
import type { AgentLoop } from "@zhiyin/agent-loop";

/** What the workspace asks of whoever runs turns. */
export type WorkspaceTurns = Pick<
  AgentLoop,
  | "send"
  | "start"
  | "cancel"
  | "answerNow"
  | "sendNow"
  | "takeBack"
  | "condenseNow"
  | "shutdown"
  | "resolveApproval"
  | "revokeConversationPermission"
  | "resolveUserInput"
  | "running"
  | "anyRunning"
  | "settleAfterRestart"
  | "wakeSaved"
  | "settleEndedTurn"
>;

export function requiredTask(
  tasks: readonly WorkspaceTask[],
  taskId: string,
): WorkspaceTask {
  const task = tasks.find((item) => item.id === taskId);
  if (!task) throw new Error("The task does not exist.");
  return task;
}

/**
 * How far a conversation has come: the order number of its latest message,
 * action or view. Going back cuts at an order number, so whatever came at or
 * after it is gone.
 */
export function reached(task: WorkspaceTask): number {
  let latest = 0;
  for (const message of task.messages)
    latest = Math.max(latest, message.sequence ?? 0);
  for (const each of [...task.actions, ...task.views])
    latest = Math.max(latest, each.sequence);
  return latest;
}

export function taskArtifact(
  tasks: readonly WorkspaceTask[],
  taskId: string,
  path: string,
): TaskArtifact | undefined {
  return tasks
    .find((item) => item.id === taskId)
    ?.artifacts.find((item) => item.path === path);
}

export function taskView(
  tasks: readonly WorkspaceTask[],
  taskId: string,
  viewId: string,
): TaskView | undefined {
  return tasks
    .find((item) => item.id === taskId)
    ?.views.find((item) => item.id === viewId);
}

/**
 * The next revision of a conversation, with when its turn began: the moment
 * one starts running, kept for as long as it runs, and gone once it ends.
 */
export function datedTurn(
  previous: WorkspaceTask,
  next: WorkspaceTask,
  now: string,
): WorkspaceTask {
  // The previous revision is the authority on a turn already running; a turn
  // only spreads the conversation it was handed, which may predate the stamp.
  const started = !turnUnderWay(next.phase.kind)
    ? undefined
    : turnUnderWay(previous.phase.kind)
      ? (previous.turnStartedAt ?? next.turnStartedAt ?? now)
      : now;
  // The same conversation comes back when its date is already right.
  if (next.turnStartedAt === started) return next;
  const dated: { -readonly [K in keyof WorkspaceTask]: WorkspaceTask[K] } = {
    ...next,
  };
  if (started) dated.turnStartedAt = started;
  else delete dated.turnStartedAt;
  return dated;
}
