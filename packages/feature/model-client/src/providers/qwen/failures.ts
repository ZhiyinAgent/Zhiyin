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
  failedByStatus,
  saidTrimmed,
  type FailureReport,
} from "../../failures.js";

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
  const sentence = saidTrimmed(failure);
  const code = codeOf(failure);

  if (/range of input length/i.test(sentence ?? "")) {
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

  return failedByStatus("Qwen", failure);
}
