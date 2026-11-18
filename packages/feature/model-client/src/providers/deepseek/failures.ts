/**
 * What a DeepSeek failure means. DeepSeek documents its failures by status
 * alone (error codes page, checked 2026-10-09) and not the body's shape, so
 * the status decides and the body's sentence, where there is one, is passed
 * on. Its own are an empty balance (402) and an overloaded server (503).
 */

import {
  ModelClientError,
  failedByStatus,
  retryAfterMs,
  type FailureReport,
  overloaded,
} from "../../failures.js";

/**
 * The failures DeepSeek names as the reason an answer stopped, besides the
 * content filter every Chat Completions provider may name (API reference,
 * create chat completion, checked 2026-10-14).
 */
export function failedFinish(reason: string): ModelClientError | undefined {
  switch (reason) {
    case "insufficient_system_resource":
      return new ModelClientError(
        "modelUnavailable",
        "DeepSeek ran out of capacity partway through the answer.",
        { retryable: true },
      );
    case "aborted":
      return new ModelClientError(
        "networkFailure",
        "DeepSeek interrupted the answer partway through.",
      );
    default:
      return undefined;
  }
}

export function classifyFailure(failure: FailureReport): ModelClientError {
  switch (failure.status) {
    case 402:
      return new ModelClientError(
        "outOfCredits",
        "The DeepSeek account has run out of balance. Top it up at platform.deepseek.com, then try again.",
      );
    case 503:
      return overloaded(
        "DeepSeek is overloaded right now.",
        retryAfterMs(failure.headers),
      );
    default:
      return failedByStatus("DeepSeek", failure);
  }
}
