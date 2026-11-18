/**
 * What a MiniMax failure means. Its Anthropic-compatible API types every
 * error as Anthropic does, before the stream and inside it (API reference,
 * checked 2026-10-09), so the type decides and the status stands in where the
 * type is missing. An empty balance has no type of its own there; the native
 * API names it code 1008, "insufficient balance", which is what is looked for
 * in MiniMax's sentence: the words, or the code standing as one, not any
 * number 1008 the sentence happens to hold.
 */

import {
  ModelClientError,
  failedByStatus,
  retryAfterMs,
  saidTrimmed,
  type FailureReport,
  overloaded,
} from "../../failures.js";

/** The status each documented type is sent with. */
const statusOfType: Readonly<Record<string, number>> = {
  invalid_request_error: 400,
  authentication_error: 401,
  permission_error: 403,
  not_found_error: 404,
  request_too_large: 413,
  rate_limit_error: 429,
  api_error: 500,
  overloaded_error: 529,
};

const cannotPay =
  /insufficient balance|^\s*\(?1008\)?\b|\(1008\)\s*\.?$|\bcode\W{0,3}1008\b/i;

export function classifyFailure(failure: FailureReport): ModelClientError {
  const error = failure.error as
    { readonly type?: unknown; readonly message?: unknown } | undefined;
  const type = typeof error?.type === "string" ? error.type : undefined;
  const status = (type && statusOfType[type]) || failure.status;
  const sentence = saidTrimmed(failure);

  if (sentence && cannotPay.test(sentence))
    return new ModelClientError(
      "outOfCredits",
      "The MiniMax account has run out of balance. Top it up, then try again.",
    );
  switch (status) {
    case 413:
      return new ModelClientError(
        "contextExceeded",
        "The request is larger than MiniMax accepts.",
      );
    case 403:
    case 404:
      return new ModelClientError(
        "modelUnavailable",
        `MiniMax does not let this key use ${failure.model ?? "the chosen model"}. Choose another model on the Model page.`,
        { retryable: false },
      );
    case 529:
      return overloaded(
        "MiniMax is overloaded right now.",
        retryAfterMs(failure.headers),
      );
    default:
      return failedByStatus("MiniMax", { ...failure, status });
  }
}
