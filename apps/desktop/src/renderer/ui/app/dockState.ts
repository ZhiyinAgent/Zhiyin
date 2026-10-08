import type { ApprovalRequest, WorkspaceTask } from "./workspaceState.js";
import type {
  CoreApi,
  MessageAttachment,
  ReasoningSelection,
} from "@zhiyin/contract";

export async function sendComposerMessage(
  send: CoreApi["sendMessage"],
  taskId: string,
  message: string,
  reasoning: ReasoningSelection | undefined,
  attachments: readonly MessageAttachment[] | undefined,
  running: boolean,
): Promise<void> {
  const ids = attachments?.map((attachment) => attachment.id);
  if (running) return send(taskId, message, reasoning, ids, "guidance");
  if (ids?.length) return send(taskId, message, reasoning, ids);
  return send(taskId, message, reasoning);
}

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
    ...(prompt.conversationRule
      ? { conversationRule: prompt.conversationRule }
      : {}),
  };
}

/**
 * Why the composer is closed, when it is: the task is waiting on the person,
 * or there is nothing connected to run a task at all.
 */
export function composerLock(
  _task: WorkspaceTask | null,
  tasksAvailable: boolean,
) {
  if (!tasksAvailable)
    return {
      disabledReason: "Task execution is not connected yet",
      disabledPlaceholder: "Composer unavailable",
    };
  return {};
}

/** Guidance not delivered before Stop or restart returns to the composer. */
export function guidanceDraft(task: WorkspaceTask | null) {
  const drafts = (task?.guidance ?? []).filter(
    (item) => item.status === "draft",
  );
  if (!drafts.length) return undefined;
  return {
    id: drafts.map((item) => item.id).join(":"),
    text: drafts.map((item) => item.text).join("\n\n"),
    attachments: drafts.flatMap((item) => item.attachments ?? []),
  };
}

export function taskIsRunning(task: WorkspaceTask | null): boolean {
  return (
    task !== null &&
    ["working", "browser", "loading", "approval", "input"].includes(
      task.phase.kind,
    )
  );
}
