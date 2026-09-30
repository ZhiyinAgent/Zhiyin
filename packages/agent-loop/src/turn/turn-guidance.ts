import type { WorkspaceTask } from "@zhiyin/contract";
import { modelText } from "../context/attachments.js";
import type { ModelHistory } from "../context/model-history.js";
import type { TurnRecords } from "./turn-records.js";

/** Deliver in order at a round boundary, after all preceding tool results. */
export async function deliverGuidance(
  taskId: string,
  records: TurnRecords,
  history: ModelHistory,
): Promise<boolean> {
  const pending = (records.task(taskId).guidance ?? []).filter(
    (item) => item.status === "pending",
  );
  for (const item of pending) {
    await history.notice(
      "guidance",
      `The user added this while you were working: ${modelText(item)}\nAcknowledge this briefly and give the updated plan in this response or immediately alongside it. Preserve completed work and useful progress. Revise only what the new guidance changes. If the goal or completion criteria changed, update the plan checklist before further dependent actions. A small correction needs no separate planning call.`,
      item.id,
    );
    await records.deliverGuidance(taskId, item.id);
  }
  return pending.length > 0;
}

/** Recover guidance after a stop or restart without sending it twice. */
export function settleGuidance(
  task: WorkspaceTask,
  onlyId?: string,
): WorkspaceTask {
  const pending = (task.guidance ?? []).filter(
    (item) => item.status === "pending" && (!onlyId || item.id === onlyId),
  );
  if (!pending.length) return task;
  const delivered = new Set(
    (task.modelHistory ?? []).flatMap((entry) =>
      entry.kind === "notice" && entry.messageId ? [entry.messageId] : [],
    ),
  );
  const settling = new Set(pending.map((item) => item.id));
  let sequence =
    Math.max(
      -1,
      ...task.messages.map((message) => message.sequence ?? -1),
      ...(task.actions ?? []).map((action) => action.sequence ?? -1),
      ...(task.views ?? []).map((view) => view.sequence ?? -1),
      ...(task.interactions ?? []).map(
        (interaction) => interaction.sequence ?? -1,
      ),
    ) + 1;
  return {
    ...task,
    guidance: (task.guidance ?? [])
      .filter((item) => !(settling.has(item.id) && delivered.has(item.id)))
      .map((item) =>
        settling.has(item.id) ? { ...item, status: "draft" as const } : item,
      ),
    messages: [
      ...task.messages,
      ...pending
        .filter((item) => delivered.has(item.id))
        .map((item) => ({
          id: item.id,
          role: "user" as const,
          text: item.text,
          ...(item.attachments?.length
            ? { attachments: item.attachments }
            : {}),
          sequence: sequence++,
        })),
    ],
  };
}
