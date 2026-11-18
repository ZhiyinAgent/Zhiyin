import type { WorkspaceTask } from "@zhiyin/contract";
import type { KeptStore } from "@zhiyin/session";
import type { ModelHistory } from "../context/model-history.js";
import type { PendingHandoffs } from "./pending-handoffs.js";
import type { TurnRecords } from "../turn/turn-records.js";
import {
  completeHandoffMessage,
  handoffMessage,
  handoffReportTool,
} from "./handoff-message.js";

/**
 * Whether the model was told of this run, read from what it was sent: a
 * rewind or a condensing that took the notice away has it told again.
 */
export function toldOf(task: WorkspaceTask, runId: string): boolean {
  return task.modelHistory.some(
    (entry) => entry.kind === "notice" && entry.runId === runId,
  );
}

/** Saves a bounded notice; a long report and timeline can be paged with read_file. */
export async function deliverPendingHandoffs(
  taskId: string,
  pending: PendingHandoffs,
  records: TurnRecords,
  kept: KeptStore,
  history: ModelHistory,
  signal?: AbortSignal,
): Promise<void> {
  const drained = pending.drain(taskId);
  for (let index = 0; index < drained.length; index++) {
    const settled = drained[index]!;
    try {
      const task = records.task(taskId);
      const alreadySent = toldOf(task, settled.runId);
      if (!alreadySent) {
        const actions = task.actions
          .filter((action) => action.specialistRunId === settled.runId)
          .sort((a, b) => a.sequence - b.sequence);
        const complete = completeHandoffMessage(settled, actions);
        const saved =
          complete.length > 12_000
            ? await kept.keep("output", taskId, { text: complete })
            : undefined;
        const { notice, report } = handoffMessage(
          settled,
          actions,
          saved?.status === "kept" ? `output://${saved.id}` : undefined,
        );
        await history.notice("handoff", notice, {
          runId: settled.runId,
          output: { tool: handoffReportTool, content: report },
        });
      }
      // A stop while it was told may have kept it out: it and the rest wait
      // for the next turn the person starts, which tells each once.
      signal?.throwIfAborted();
      await records.guidance.handoffDelivered(taskId, settled.runId);
    } catch (error) {
      for (const remaining of drained.slice(index)) {
        if (signal?.aborted) pending.push(taskId, remaining, false);
        else pending.push(taskId, remaining);
      }
      throw error;
    }
  }
}
