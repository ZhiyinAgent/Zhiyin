import type { Sessions } from "@zhiyin/session";
import type { ModelHistory } from "../context/model-history.js";
import type { PendingHandoffs } from "./pending-handoffs.js";
import type { TurnRecords } from "../turn/turn-records.js";
import {
  completeHandoffMessage,
  handoffMessage,
} from "./specialist-execution.js";

/** Saves a bounded notice; a long report and timeline can be paged with read_file. */
export async function deliverPendingHandoffs(
  taskId: string,
  pending: PendingHandoffs,
  records: TurnRecords,
  sessions: Sessions,
  history: ModelHistory,
): Promise<void> {
  const drained = pending.drain(taskId);
  for (let index = 0; index < drained.length; index++) {
    const settled = drained[index]!;
    try {
      const task = records.task(taskId);
      const alreadySent = task.modelHistory.some(
        (entry) =>
          entry.kind === "notice" &&
          entry.content.includes(`Run: ${settled.runId}.`),
      );
      if (!alreadySent) {
        const actions = task.actions
          .filter((action) => action.specialistRunId === settled.runId)
          .sort((a, b) => a.sequence - b.sequence);
        const complete = completeHandoffMessage(settled, actions);
        const saved =
          complete.length > 12_000
            ? await sessions.keep("output", taskId, { text: complete })
            : undefined;
        await history.notice(
          "handoff",
          handoffMessage(
            settled,
            actions,
            saved?.status === "kept" ? `output://${saved.id}` : undefined,
          ),
        );
      }
      await records.markHandoffDelivered(taskId, settled.runId);
    } catch (error) {
      for (const remaining of drained.slice(index)) {
        pending.push(taskId, remaining);
      }
      throw error;
    }
  }
}
