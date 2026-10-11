/**
 * What a Qwen failure means, on either platform. QwenCloud's error reference
 * (checked 2026-10-09) names each failure by status and code, in `{error:
 * {message, type, param, code}}`. A status alone can mislead: a 400 is also an
 * unpaid balance or the content check, and a 429 named `insufficient_quota`
 * is a tokens-per-minute limit, not an empty balance. Qwen's own sentence is
 * passed on where the failure is the request's.
 */

import {
  ModelClientError,
  retryAfterMs,
  type FailureReport,
} from "../../failures.js";

function said(failure: FailureReport): string | undefined {
  const message = failure.error?.message;
  return typeof message === "string" && message.trim()
    ? message.trim()
    : undefined;
}

function codeOf(failure: FailureReport): string {
  const code = failure.error?.code;
  return typeof code === "string" ? code.toLowerCase() : "";
}

/** "Range of input length should be [1, 991000]": the input's limit. */
function inputLimitFrom(sentence: string | undefined): number | undefined {
  const limit = /range of input length should be \[\d+,\s*(\d+)\]/i.exec(
    sentence ?? "",
  )?.[1];
  return limit === undefined ? undefined : Number(limit);
}

export function classifyFailure(failure: FailureReport): ModelClientError {
  const sentence = said(failure);
  const code = codeOf(failure);
  const wait = retryAfterMs(failure.headers);
  const waiting = wait === undefined ? {} : { retryAfterMs: wait };

  if (/^range of input length/i.test(sentence ?? "")) {
    const limit = inputLimitFrom(sentence);
    return new ModelClientError(
      "contextExceeded",
      "The request is too large for the selected model.",
      limit === undefined ? {} : { tokens: { limit } },
    );
  }
  if (code === "arrearage" || code.endsWith("billoverdue"))
    return new ModelClientError(
      "outOfCredits",
      "The Qwen account has an unpaid balance. Settle it in the platform's billing page, then try again.",
    );
  if (code === "allocationquota.freetieronly")
    return new ModelClientError(
      "outOfCredits",
      "The Qwen account's free quota has run out, and it is set to use only the free quota. Turn that off on the platform, then try again.",
    );
  if (code === "data_inspection_failed" || code === "datainspectionfailed")
    return new ModelClientError(
      "refused",
      sentence
        ? `Qwen's content check declined the request: ${sentence}`
        : "Qwen's content check declined the request.",
    );

  switch (failure.status) {
    case 401:
      return new ModelClientError(
        "unauthorized",
        "Qwen rejected the API key. Check it on the Model page.",
      );
    case 404:
      return new ModelClientError(
        "modelUnavailable",
        `Qwen does not offer the model "${failure.model ?? ""}". Choose another on the Model page.`,
        { retryable: false },
      );
    case 429:
      return new ModelClientError(
        "rateLimited",
        "Qwen is limiting how fast requests are sent. Trying again shortly.",
        waiting,
      );
  }
  if (failure.status >= 500 || failure.status === 0)
    return new ModelClientError(
      "unexplainedError",
      sentence
        ? `Qwen's server failed: ${sentence}`
        : "Qwen's server failed without saying why.",
    );
  return new ModelClientError(
    "requestRejected",
    sentence
      ? `Qwen refused the request: ${sentence}`
      : `Qwen refused the request (HTTP ${failure.status}).`,
  );
}
