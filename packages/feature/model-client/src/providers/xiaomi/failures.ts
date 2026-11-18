/**
 * What a Xiaomi MiMo failure means. Xiaomi documents its failures by status
 * and cause (error codes page, checked 2026-10-09), not the body's shape or
 * wording, so the status decides. Its own are an empty balance (402), a
 * region or risk-control refusal (403), a picture the model does not take
 * (404), its content filter (421) and an overloaded server (503).
 */

import {
  ModelClientError,
  failedByStatus,
  retryAfterMs,
  type FailureReport,
  said,
  overloaded,
} from "../../failures.js";

export function classifyFailure(failure: FailureReport): ModelClientError {
  const sentence = said(failure);
  switch (failure.status) {
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
    // Not found. Xiaomi's one documented cause is a picture sent to a model
    // or endpoint that takes none; without a picture, it is the model.
    case 404:
      return failure.withPictures
        ? new ModelClientError(
            "attachmentRejected",
            "Xiaomi MiMo says the chosen model or endpoint does not take pictures.",
          )
        : new ModelClientError(
            "modelUnavailable",
            sentence
              ? `Xiaomi MiMo could not find the chosen model (“${sentence}”). Choose another model on the Model page.`
              : "Xiaomi MiMo could not find the chosen model. Choose another model on the Model page.",
            { retryable: false },
          );
    // The sentence is not passed on: it may quote what was filtered.
    case 421:
      return new ModelClientError(
        "refused",
        "Xiaomi MiMo's content filter blocked the request.",
      );
    case 503:
      return overloaded(
        "Xiaomi MiMo is overloaded right now.",
        retryAfterMs(failure.headers),
      );
    default:
      return failedByStatus("Xiaomi MiMo", failure);
  }
}
