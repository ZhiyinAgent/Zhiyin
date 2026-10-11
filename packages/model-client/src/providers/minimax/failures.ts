/**
 * What a MiniMax failure means. Its Anthropic-compatible API types every
 * error as Anthropic does, before the stream and inside it (API reference,
 * checked 2026-10-09), so the type decides and the status stands in where the
 * type is missing. An empty balance has no type of its own there; the native
 * API names it code 1008, "insufficient balance", which is what is looked for
 * in MiniMax's sentence.
 */

import {
  ModelClientError,
  retryAfterMs,
  saysTooLong,
  tokenLimitFrom,
  type FailureReport,
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

const cannotPay = /insufficient balance|\b1008\b/i;

export function classifyFailure(failure: FailureReport): ModelClientError {
  const error = failure.error as
    { readonly type?: unknown; readonly message?: unknown } | undefined;
  const type = typeof error?.type === "string" ? error.type : undefined;
  const status = (type && statusOfType[type]) || failure.status;
  const sentence =
    typeof error?.message === "string" && error.message.trim()
      ? error.message.trim()
      : undefined;
  const wait = retryAfterMs(failure.headers);

  if (sentence && cannotPay.test(sentence))
    return new ModelClientError(
      "outOfCredits",
      "The MiniMax account has run out of balance. Top it up, then try again.",
    );
  switch (status) {
    case 400: {
      if (!saysTooLong(sentence))
        return new ModelClientError(
          "requestRejected",
          sentence
            ? `MiniMax refused the request: ${sentence}`
            : "MiniMax refused the request (HTTP 400).",
        );
      const tokens = tokenLimitFrom(sentence);
      return new ModelClientError(
        "contextExceeded",
        "The request is too large for the selected model.",
        tokens ? { tokens } : {},
      );
    }
    case 413:
      return new ModelClientError(
        "contextExceeded",
        "The request is larger than MiniMax accepts.",
      );
    case 401:
      return new ModelClientError(
        "unauthorized",
        "MiniMax rejected the API key. Check it on the Model page.",
      );
    case 403:
    case 404:
      return new ModelClientError(
        "modelUnavailable",
        `MiniMax does not let this key use ${failure.model ?? "the chosen model"}. Choose another model on the Model page.`,
        { retryable: false },
      );
    case 429:
      return new ModelClientError(
        "rateLimited",
        "MiniMax is limiting how fast requests are sent. Trying again shortly.",
        wait === undefined ? {} : { retryAfterMs: wait },
      );
    case 529:
      return new ModelClientError(
        "modelUnavailable",
        "MiniMax is overloaded right now.",
        {
          retryable: true,
          ...(wait === undefined ? {} : { retryAfterMs: wait }),
        },
      );
    default:
      return status >= 500 || status === 0
        ? new ModelClientError(
            "unexplainedError",
            "MiniMax's server failed without saying why.",
          )
        : new ModelClientError(
            "requestRejected",
            sentence
              ? `MiniMax refused the request: ${sentence}`
              : `MiniMax refused the request (HTTP ${failure.status}).`,
          );
  }
}
