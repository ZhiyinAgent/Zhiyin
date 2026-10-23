/**
 * What an Anthropic failure means. Anthropic types every error, before the
 * stream and inside it, so the type decides and the status stands in only
 * where the type is missing, as on a 413 that Cloudflare returns before the
 * request reaches Anthropic. A few failures share a type and are told apart
 * by what Anthropic documents of them (errors page, rate limits page and API
 * credits page, checked 2026-10-09):
 *
 * - A spend limit the organization set is a 400 `invalid_request_error`
 *   whose sentence begins "You have reached your specified ... API usage
 *   limits".
 * - The tier's monthly spend cap is a 429 `rate_limit_error` whose
 *   `details.error_code` is `enforced_spend_limit_reached`, without
 *   `retry-after`, and fails until access resumes.
 * - An exhausted credit balance says "Your credit balance is too low"; its
 *   status and type are not documented.
 */

import {
  ModelClientError,
  retryAfterMs,
  said,
  saysTooLong,
  tokenLimitFrom,
  type FailureReport,
} from "../../failures.js";

/** The error object as Anthropic sends it. */
type AnthropicError = {
  readonly type?: unknown;
  readonly message?: unknown;
  readonly details?: unknown;
};

/** The status each documented type is sent with. */
const statusOfType: Readonly<Record<string, number>> = {
  invalid_request_error: 400,
  authentication_error: 401,
  billing_error: 402,
  permission_error: 403,
  not_found_error: 404,
  request_too_large: 413,
  rate_limit_error: 429,
  api_error: 500,
  timeout_error: 504,
  overloaded_error: 529,
};

const cannotPay =
  /credit balance is too low|reached your specified (?:workspace )?API usage limits/i;

function spendCapReached(error: AnthropicError | undefined): boolean {
  const details = error?.details;
  return (
    !!details &&
    typeof details === "object" &&
    (details as Record<string, unknown>)["error_code"] ===
      "enforced_spend_limit_reached"
  );
}

export function classifyFailure(failure: FailureReport): ModelClientError {
  const error = failure.error as AnthropicError | undefined;
  const type = typeof error?.type === "string" ? error.type : undefined;
  const status = (type && statusOfType[type]) || failure.status;
  const sentence = said(failure);
  const wait = retryAfterMs(failure.headers);
  const provider = type ? { provider: { errorType: type } } : {};
  const rejected = () =>
    new ModelClientError(
      "requestRejected",
      sentence
        ? `Anthropic refused the request: ${sentence}`
        : `Anthropic refused the request (HTTP ${failure.status}).`,
      provider,
    );
  const outOfCredits = () =>
    new ModelClientError(
      "outOfCredits",
      sentence
        ? `The Anthropic account cannot pay for more requests: ${sentence}`
        : "The Anthropic account cannot pay for more requests. Check Billing in the Claude Console, then try again.",
      provider,
    );

  if (sentence && cannotPay.test(sentence)) return outOfCredits();
  switch (status) {
    case 400: {
      if (!saysTooLong(sentence)) return rejected();
      const tokens = tokenLimitFrom(sentence);
      return new ModelClientError(
        "contextExceeded",
        "The request is too large for the selected model.",
        { ...provider, ...(tokens ? { tokens } : {}) },
      );
    }
    case 413:
      return new ModelClientError(
        "contextExceeded",
        "The request is larger than Anthropic accepts.",
        provider,
      );
    case 401:
    case 403:
      return new ModelClientError(
        "unauthorized",
        status === 401
          ? "Anthropic rejected the API key. Check it on the Model page."
          : `Anthropic does not let this API key make the request${sentence ? `: ${sentence}` : "."} Check the key on the Model page.`,
        provider,
      );
    case 402:
      return outOfCredits();
    case 404:
      return new ModelClientError(
        "modelUnavailable",
        `Anthropic does not offer ${failure.model ?? "the chosen model"} to this account. Choose another model on the Model page.`,
        { ...provider, retryable: false },
      );
    case 429:
      if (spendCapReached(error)) return outOfCredits();
      return new ModelClientError(
        "rateLimited",
        "Anthropic is limiting how fast requests are sent. Trying again shortly.",
        { ...provider, ...(wait === undefined ? {} : { retryAfterMs: wait }) },
      );
    case 504:
      return new ModelClientError(
        "modelUnavailable",
        "Anthropic took too long to answer.",
        { ...provider, retryable: true },
      );
    case 529:
      return new ModelClientError(
        "modelUnavailable",
        "Anthropic is overloaded right now.",
        {
          ...provider,
          retryable: true,
          ...(wait === undefined ? {} : { retryAfterMs: wait }),
        },
      );
    default:
      return status >= 500 || status === 0
        ? new ModelClientError(
            "unexplainedError",
            "Anthropic's server failed without saying why.",
            provider,
          )
        : rejected();
  }
}
