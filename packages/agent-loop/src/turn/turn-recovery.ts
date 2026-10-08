/** Recovery after the model client's bounded request retries are exhausted. */

import { VisibleError, type TurnRemedy } from "@zhiyin/contract";
import type { ModelClientErrorCode } from "@zhiyin/model-client";
import type { ModelHistory } from "../context/model-history.js";
import type { TurnRecords } from "./turn-records.js";
import { modelFailure, TurnFailure } from "./turn-shared.js";
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
    throw new TurnFailure(
      "The model connection stopped again. Completed actions are saved. Send a follow-up to continue from here.",
      ["continue", "tryAgain"],
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

const remediesFor: Record<ModelClientErrorCode, readonly TurnRemedy[]> = {
  noModel: ["chooseModel"],
  missingCredential: ["updateApiKey"],
  unauthorized: ["updateApiKey"],
  credentialUnavailable: ["openSettings"],
  rateLimited: ["tryAgain"],
  networkFailure: ["tryAgain"],
  malformedResponse: ["tryAgain"],
  requestRejected: ["tryAgain"],
  unexplainedError: ["tryAgain"],
  modelUnavailable: ["chooseModel", "tryAgain"],
  unsupportedReasoning: ["chooseModel", "tryAgain"],
  contextExceeded: ["chooseLargerModel", "tryAgain"],
  outOfCredits: ["addCredits", "tryAgain"],
  attachmentRejected: ["editMessage"],
  // The provider's reason is the whole answer; nothing here changes it.
  refused: [],
};

/** Failures that pass on their own, after which work already done can go on. */
const passing: ReadonlySet<ModelClientErrorCode> = new Set([
  "rateLimited",
  "networkFailure",
  "malformedResponse",
  "unexplainedError",
]);

/**
 * What a person can do about a failed turn, from the model client's account of
 * the failure. Starting again would redo work already done, so a failure that
 * passes on its own also offers to carry on from it.
 */
export function turnFailureRemedies(
  error: unknown,
  completedToolRounds: number,
): readonly TurnRemedy[] {
  if (error instanceof TurnFailure) return error.remedies;
  const failure = modelFailure(error);
  if (!failure) return [];
  if (passing.has(failure.code) && completedToolRounds > 0)
    return ["continue", "tryAgain"];
  return remediesFor[failure.code];
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
