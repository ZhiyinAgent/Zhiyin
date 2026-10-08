import type {
  TaskArtifact,
  TaskView,
  WorkspaceSnapshot,
  WorkspaceTask,
} from "@zhiyin/contract";
import type { AgentLoop } from "@zhiyin/agent-loop";

/** What the workspace asks of whoever runs turns. */
export type WorkspaceTurns = Pick<
  AgentLoop,
  | "start"
  | "cancel"
  | "condenseNow"
  | "shutdown"
  | "resolveApproval"
  | "revokeConversationPermission"
  | "resolveUserInput"
  | "running"
  | "anyRunning"
  | "accepts"
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

export function stampTaskWorkspace(
  tasks: readonly WorkspaceTask[],
  selectedTaskId: string | null,
  folder: WorkspaceSnapshot["workspace"],
): WorkspaceTask[] {
  if (!folder || !selectedTaskId) return [...tasks];
  return tasks.map((task) =>
    task.id === selectedTaskId ? { ...task, workspace: folder } : task,
  );
}
