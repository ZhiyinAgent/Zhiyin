/** Recovery after the model client's bounded request retries are exhausted. */

import { VisibleError } from "@zhiyin/contract";
import type { ModelHistory } from "./model-history.js";
import type { TurnRecords } from "./turn-records.js";
import { modelFailure } from "./turn-shared.js";
import type { WorkLedger } from "./work-limits.js";

export async function recoverConnectionFailure(options: {
  readonly error: unknown;
  readonly taskId: string;
  readonly messagesBeforeRound: number;
  readonly previousRecoveries: number;
  readonly records: TurnRecords;
  readonly history: ModelHistory;
  readonly ledger: WorkLedger;
}): Promise<boolean> {
  const { error, taskId, records, history, ledger } = options;
  const failure = modelFailure(error);
  if (
    failure?.code !== "networkFailure" ||
    !failure.retryable ||
    ledger.completedToolRounds() === 0
  )
    return false;

  for (const message of records
    .task(taskId)
    .messages.slice(options.messagesBeforeRound))
    if (message.role === "assistant")
      await records.withdrawAssistantMessage(taskId, message.id);

  if (options.previousRecoveries > 0)
    throw new VisibleError(
      "The model connection stopped again. Completed actions are saved. Send a follow-up to continue from here.",
    );

  await records.showWorking(
    taskId,
    "Connection interrupted. Continuing from completed work…",
    records.visibleSteps(taskId),
  );
  await history.notice(
    "recovery",
    "The provider connection ended while you were answering. Earlier tool calls and their results are already recorded. Continue the person's task from those results. Do not repeat completed actions.",
  );
  return true;
}

export function turnFailureReason(
  error: unknown,
  completedToolRounds: number,
): string {
  const failure = modelFailure(error);
  if (failure?.code === "networkFailure")
    return completedToolRounds > 0
      ? "The model connection stopped. Completed actions are saved. Send a follow-up to continue from here."
      : "The model connection stopped. Try again.";
  return (
    failure?.message ??
    (error instanceof VisibleError
      ? error.message
      : "The model request failed. Try again.")
  );
}
