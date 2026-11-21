import type { ApprovalRequest, WorkspaceTask } from "./windowState.js";
import {
  type CoreApi,
  type MessageAttachment,
  type ReasoningSelection,
} from "@zhiyin/contract";
import { turnUnderWay } from "@zhiyin/conversation-rules";

export async function sendComposerMessage(
  send: CoreApi["sendMessage"],
  {
    taskId,
    message,
    reasoning,
    attachments,
    running,
  }: {
    readonly taskId: string;
    readonly message: string;
    readonly reasoning: ReasoningSelection | undefined;
    readonly attachments: readonly MessageAttachment[] | undefined;
    /** While a turn runs, the message is guidance for it. */
    readonly running: boolean;
  },
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
    ...(prompt.reason ? { description: prompt.reason } : {}),
    ...(prompt.reasonByModel ? { descriptionByModel: true } : {}),
    ...(prompt.effect ? { effect: prompt.effect } : {}),
    ...(prompt.detail ? { detail: prompt.detail } : {}),
    ...(prompt.claim ? { claim: prompt.claim } : {}),
    // An empty place names nothing a person could read.
    ...(prompt.destinations?.some(Boolean)
      ? { destinations: prompt.destinations.filter(Boolean) }
      : {}),
    ...(prompt.invocation ? { invocation: prompt.invocation } : {}),
    ...(prompt.changes ? { changes: prompt.changes } : {}),
    ...(prompt.recovery ? { recovery: prompt.recovery } : {}),
    ...(prompt.effects ? { effects: prompt.effects } : {}),
    ...(prompt.why ? { why: prompt.why } : {}),
    ...(prompt.conversationRule
      ? { conversationRule: prompt.conversationRule }
      : {}),
    ...(prompt.fileRules ? { fileRules: prompt.fileRules } : {}),
    ...(prompt.reach ? { reach: prompt.reach } : {}),
  };
}

/**
 * Why the composer is closed, when it is: there is nothing connected to run a
 * task at all. It names the next step where a report above offers one.
 */
export function composerLock(tasksAvailable: boolean, retryOffered: boolean) {
  if (!tasksAvailable)
    return {
      disabledReason: retryOffered
        ? "Zhiyin can’t start tasks right now. Use Try again above."
        : "Zhiyin can’t start tasks right now.",
      disabledPlaceholder: "Not available right now",
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
  return task !== null && turnUnderWay(task.phase.kind);
}
