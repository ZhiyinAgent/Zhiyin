/**
 * What a Xiaomi MiMo failure means. Xiaomi documents its failures by status
 * and cause (error codes page, checked 2026-10-09), not the body's shape or
 * wording, so the status decides. Only a sentence about the context length
 * makes a 400 a size problem, and a 400's sentence is passed on.
 */

import {
  ModelClientError,
  retryAfterMs,
  saysTooLong,
  type FailureReport,
  said,
  tooLarge,
  overloaded,
} from "../../failures.js";

function rejected(status: number, sentence: string | undefined) {
  return new ModelClientError(
    "requestRejected",
    sentence
      ? `Xiaomi MiMo refused the request: ${sentence}`
      : `Xiaomi MiMo refused the request (HTTP ${status}).`,
  );
}

export function classifyFailure(failure: FailureReport): ModelClientError {
  const sentence = said(failure);
  const wait = retryAfterMs(failure.headers);
  switch (failure.status) {
    case 400: {
      if (saysTooLong(sentence)) return tooLarge(sentence);
      return rejected(failure.status, sentence);
    }
    case 401:
      return new ModelClientError(
        "unauthorized",
        "Xiaomi MiMo rejected the API key. Check it on the Model page.",
      );
    case 402:
      return new ModelClientError(
        "outOfCredits",
        "The Xiaomi MiMo account has run out of balance. Top it up at platform.xiaomimimo.com, then try again.",
      );
    // Xiaomi gives two causes and the status alone cannot tell them apart.
    case 403:
      return new ModelClientError(
        "unauthorized",
        "Xiaomi MiMo refused access: its service is not available in this region, or the API key was restricted by its risk control. A new key can be added on the Model page.",
      );
    // Xiaomi's one documented cause: no image input on that model or endpoint.
    case 404:
      return new ModelClientError(
        "attachmentRejected",
        "Xiaomi MiMo says the chosen model or endpoint does not take pictures.",
      );
    // The sentence is not passed on: it may quote what was filtered.
    case 421:
      return new ModelClientError(
        "refused",
        "Xiaomi MiMo's content filter blocked the request.",
      );
    case 429:
      return new ModelClientError(
        "rateLimited",
        "Xiaomi MiMo is limiting how fast requests are sent. Trying again shortly.",
        wait === undefined ? {} : { retryAfterMs: wait },
      );
    case 503:
      return overloaded("Xiaomi MiMo is overloaded right now.", wait);
    default:
      return failure.status >= 500 || failure.status === 0
        ? new ModelClientError(
            "unexplainedError",
            "Xiaomi MiMo's server failed without saying why.",
          )
        : rejected(failure.status, sentence);
  }
}
