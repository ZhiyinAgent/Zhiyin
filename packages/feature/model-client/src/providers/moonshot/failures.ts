/**
 * What a Moonshot failure means. Moonshot's error codes page (checked
 * 2026-10-09) gives each failure a body of `{error: {type, message}}`. The type
 * decides first: a 429 is a rate limit, an overloaded service or an account
 * that cannot pay, and only the type tells which. The status decides where
 * the type is missing, and Moonshot's sentence is passed on where there is one.
 */

import {
  ModelClientError,
  failedByStatus,
  overloaded,
  retryAfterMs,
  saysTooLong,
  type FailureReport,
  said,
  tooLarge,
} from "../../failures.js";

/**
 * The sentences Moonshot documents for input that does not fit the model:
 * input past its window, and input that leaves no room for the reply asked
 * for. Either is cured by a shorter conversation.
 */
function doesNotFit(sentence: string | undefined): boolean {
  return (
    sentence !== undefined &&
    (/input token length too long|prompt tokens \+ max_tokens exceeds/i.test(
      sentence,
    ) ||
      saysTooLong(sentence))
  );
}

function typeOf(failure: FailureReport): string | undefined {
  const error = failure.error;
  return error && "type" in error && typeof error.type === "string"
    ? error.type
    : undefined;
}

/**
 * A rate limit, told as the account's own limit where Moonshot names it. Its
 * limits rise with what the account has been topped up by (rate limits page,
 * checked 2026-10-15); a new account takes one request at a time. Moonshot's
 * sentence names the organization and the key, which the message leaves out.
 */
function rateLimit(sentence: string | undefined): string {
  const raises = "Kimi raises the limit as the account is topped up.";
  const concurrency = /max organization concurrency: (\d+)/i.exec(
    sentence ?? "",
  );
  if (concurrency) {
    const open = Number(concurrency[1]);
    return `This Kimi account takes ${open} request${open === 1 ? "" : "s"} at a time, and another was still open. ${raises}`;
  }
  if (/\bRPM\b/.test(sentence ?? ""))
    return `This Kimi account reached the number of requests it may send in a minute. ${raises}`;
  return sentence
    ? `Kimi is limiting how fast requests are sent: ${sentence}`
    : "Kimi is limiting how fast requests are sent. Trying again shortly.";
}

export function classifyFailure(failure: FailureReport): ModelClientError {
  const sentence = said(failure);
  const wait = retryAfterMs(failure.headers);
  const type = typeOf(failure);

  if (type === "content_filter")
    return new ModelClientError(
      "refused",
      sentence
        ? `Kimi declined the request: ${sentence}`
        : "Kimi's content check declined the request.",
    );
  if (type === "exceeded_current_quota_error")
    return new ModelClientError(
      "outOfCredits",
      `The Kimi account cannot pay for this request${
        sentence ? `: ${sentence.replace(/\.$/, "")}` : ""
      }. Top it up on its platform, then try again.`,
    );
  if (type === "engine_overloaded_error")
    return overloaded("Kimi is overloaded right now.", wait);
  if (type === "rate_limit_reached_error")
    return new ModelClientError(
      "rateLimited",
      rateLimit(sentence),
      wait === undefined ? {} : { retryAfterMs: wait },
    );

  switch (failure.status) {
    case 400:
      return doesNotFit(sentence)
        ? tooLarge(sentence)
        : failedByStatus("Kimi", failure);
    case 401:
      return new ModelClientError(
        "unauthorized",
        "Kimi rejected the API key. Check it on the Model page: a key works only on the platform it was made on, platform.kimi.ai for International and platform.kimi.com for Mainland China.",
      );
    case 503:
      return overloaded("Kimi is temporarily unavailable.", wait);
    default:
      return failedByStatus("Kimi", failure);
  }
}
