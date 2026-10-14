/** Recovery after the model client's bounded request retries are exhausted. */

import { VisibleError, type TurnRemedy } from "@zhiyin/contract";
import type { ModelClientErrorCode } from "@zhiyin/model-client";
import type { ModelHistory } from "../context/model-history.js";
import type { TurnRecords } from "./turn-records.js";
import { modelFailure, TurnFailure } from "./turn-shared.js";
import type { WorkLedger } from "./work-limits.js";

/** Withdraws what the model answered since the round began, leaving no empty answer behind. */
async function withdrawRound(
  records: TurnRecords,
  taskId: string,
  messagesBeforeRound: number,
): Promise<void> {
  for (const message of records
    .task(taskId)
    .messages.slice(messagesBeforeRound))
    if (message.role === "assistant")
      await records.withdrawAssistantMessage(taskId, message.id);
}

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

  await withdrawRound(records, taskId, options.messagesBeforeRound);

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

/**
 * A request stopped for reasoning at length without answering or acting is
 * asked again, once, told to decide; what it reasoned leaves no empty answer
 * in the conversation. Stopped a second time in a row, the turn ends.
 */
export async function recoverLongThought(options: {
  readonly taskId: string;
  readonly messagesBeforeRound: number;
  /** The request before this one was stopped the same way. */
  readonly again: boolean;
  readonly records: TurnRecords;
  readonly history: ModelHistory;
}): Promise<void> {
  const { taskId, records, history } = options;
  if (options.again)
    throw new TurnFailure(
      "The model kept reasoning without answering or acting, and was stopped twice. Try again, or choose less reasoning or another model.",
      ["tryAgain", "chooseModel"],
    );
  await withdrawRound(records, taskId, options.messagesBeforeRound);
  await records.showWorking(
    taskId,
    "The model reasoned at length without acting. Asking it to decide",
    records.visibleSteps(taskId),
  );
  await history.notice(
    "thinking",
    "Your last request was stopped: you reasoned at length without answering, calling a tool or asking anything, and that reasoning is gone. Do not start the analysis over. Decide with what you know now: call a tool, give your answer, or ask the person one question.",
  );
}

/**
 * A request the person stopped to have the answer now is asked again, told to
 * answer; what it reasoned leaves no empty answer in the conversation. The
 * notice carries the words Anthropic documents for asking a model that
 * chooses its own reasoning to skip it, which is all that can be asked of one
 * whose reasoning cannot be turned off.
 */
export async function recoverAnswerNow(options: {
  readonly taskId: string;
  readonly messagesBeforeRound: number;
  readonly records: TurnRecords;
  readonly history: ModelHistory;
}): Promise<void> {
  const { taskId, records, history } = options;
  await withdrawRound(records, taskId, options.messagesBeforeRound);
  await records.showWorking(
    taskId,
    "Answering now",
    records.visibleSteps(taskId),
  );
  await history.notice(
    "answerNow",
    "The person asked for your answer now. Your last request was stopped while you were reasoning, and that reasoning is gone. Answer directly without deliberating: give your answer from what you know now, or, where the task still needs a step, call the tool for it directly.",
  );
}

/**
 * A request the person stopped to have their message read now is asked
 * again, and the message goes with it as any added message does; what was
 * reasoned leaves no empty answer in the conversation.
 */
export async function recoverSentNow(options: {
  readonly taskId: string;
  readonly messagesBeforeRound: number;
  readonly records: TurnRecords;
}): Promise<void> {
  const { taskId, records } = options;
  await withdrawRound(records, taskId, options.messagesBeforeRound);
  await records.showWorking(
    taskId,
    "Reading your message",
    records.visibleSteps(taskId),
  );
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
 * An error neither the model client nor the loop accounts for: a defect of
 * Zhiyin's own, which nothing the person set up is the cause of.
 */
export function isOwnDefect(error: unknown): boolean {
  return !modelFailure(error) && !(error instanceof VisibleError);
}

/**
 * What a person can do about a failed turn, from the model client's account of
 * the failure. Starting again would redo work already done, so a failure that
 * passes on its own also offers to carry on from it, and so does a defect of
 * Zhiyin's own.
 */
export function turnFailureRemedies(
  error: unknown,
  completedToolRounds: number,
): readonly TurnRemedy[] {
  if (error instanceof TurnFailure) return error.remedies;
  const failure = modelFailure(error);
  if (!failure)
    return isOwnDefect(error)
      ? completedToolRounds > 0
        ? ["continue", "tryAgain"]
        : ["tryAgain"]
      : [];
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
  if (failure) return failure.message;
  if (error instanceof VisibleError) return error.message;
  // Its cause is kept for whoever looks into it, and is not the person's to fix.
  return completedToolRounds > 0
    ? "Zhiyin stopped on an error of its own. Completed actions are saved. Send a follow-up to continue from here."
    : "Zhiyin stopped on an error of its own. Try again.";
}
