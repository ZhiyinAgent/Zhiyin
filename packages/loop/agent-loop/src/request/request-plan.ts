/**
 * The conversation's history as every request to its model is built from it,
 * whether a turn sends it or a condensing the person asked for between turns.
 */

import { ModelHistory } from "../context/model-history.js";
import type { TurnRecords } from "../turn/turn-records.js";
import type { AgentLoopDependencies } from "../dependencies.js";

/** What opening a conversation's history uses. */
export type HistoryDependencies = Pick<
  AgentLoopDependencies,
  "kept" | "newMessageId"
>;

/** The conversation's history as saved, saving back every change to it. */
export function openTaskHistory(
  deps: HistoryDependencies,
  records: TurnRecords,
  taskId: string,
): Promise<ModelHistory> {
  return ModelHistory.open(records.task(taskId), {
    newId: () => deps.newMessageId(),
    readPicture: (source) => deps.kept.readPicture(source),
    save: async (modelHistory) => {
      await records.replaceTask({ ...records.task(taskId), modelHistory });
    },
  });
}
