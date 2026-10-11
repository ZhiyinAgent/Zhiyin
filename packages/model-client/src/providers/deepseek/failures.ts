/**
 * What a DeepSeek failure means. DeepSeek documents its failures by status
 * alone (error codes page, checked 2026-10-09) and not the body's shape, so
 * the status decides and the body's sentence, where there is one, is passed
 * on. Only a sentence about the context length makes a 400 a size problem.
 */

import {
  ModelClientError,
  retryAfterMs,
  saysTooLong,
  tokenLimitFrom,
  type FailureReport,
} from "../../failures.js";

function said(failure: FailureReport): string | undefined {
  const message = failure.error?.message;
  return typeof message === "string" && message.trim() ? message : undefined;
}

export function classifyFailure(failure: FailureReport): ModelClientError {
  const sentence = said(failure);
  const wait = retryAfterMs(failure.headers);
  switch (failure.status) {
    case 400:
    case 422: {
      if (saysTooLong(sentence)) {
        const tokens = tokenLimitFrom(sentence);
        return new ModelClientError(
          "contextExceeded",
          "The request is too large for the selected model.",
          tokens ? { tokens } : {},
        );
      }
      return new ModelClientError(
        "requestRejected",
        sentence
          ? `DeepSeek refused the request: ${sentence}`
          : `DeepSeek refused the request (HTTP ${failure.status}).`,
      );
    }
    case 401:
      return new ModelClientError(
        "unauthorized",
        "DeepSeek rejected the API key. Check it on the Model page.",
      );
    case 402:
      return new ModelClientError(
        "outOfCredits",
        "The DeepSeek account has run out of balance. Top it up at platform.deepseek.com, then try again.",
      );
    case 429:
      return new ModelClientError(
        "rateLimited",
        "DeepSeek is limiting how fast requests are sent. Trying again shortly.",
        wait === undefined ? {} : { retryAfterMs: wait },
      );
    case 503:
      return new ModelClientError(
        "modelUnavailable",
        "DeepSeek is overloaded right now.",
        {
          retryable: true,
          ...(wait === undefined ? {} : { retryAfterMs: wait }),
        },
      );
    default:
      return failure.status >= 500 || failure.status === 0
        ? new ModelClientError(
            "unexplainedError",
            "DeepSeek's server failed without saying why.",
          )
        : new ModelClientError(
            "requestRejected",
            sentence
              ? `DeepSeek refused the request: ${sentence}`
              : `DeepSeek refused the request (HTTP ${failure.status}).`,
          );
  }
}
