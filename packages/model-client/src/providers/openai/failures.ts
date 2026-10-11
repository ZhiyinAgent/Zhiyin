/**
 * What an OpenAI failure means (error codes guide, streaming events reference
 * and the openai-node types, checked 2026-10-09). The body is
 * `{error: {message, type, param, code}}`. A 429 is a rate limit unless its
 * `code` names exhausted credits or a reached spending or usage limit, which
 * OpenAI says sending again does not cure; such an error's `type` may still be
 * `insufficient_quota`. A failure after the status went out carries one of
 * the codes a failed response lists, and is read by that code alone.
 * OpenAI documents no sentence or code for a conversation too long for the
 * model, so only a sentence that says so makes a 400 a size problem.
 */

import {
  ModelClientError,
  retryAfterMs,
  saysTooLong,
  tokenLimitFrom,
  type FailureReport,
} from "../../failures.js";

/** Billing and limit codes of a 429, and what the person is told. */
const outOfCredits: Readonly<Record<string, string>> = {
  credit_balance_exhausted:
    "The OpenAI account has no prepaid credits left. Add credits at platform.openai.com, then try again.",
  organization_spend_limit_exceeded:
    "The OpenAI organization reached its spend limit. Raise it at platform.openai.com, or wait for the monthly reset.",
  project_spend_limit_exceeded:
    "The OpenAI project reached its spend limit. Raise it at platform.openai.com, or wait for the monthly reset.",
  organization_usage_limit_exceeded:
    "The OpenAI organization reached the usage limit OpenAI set for it. Ask OpenAI for a higher limit at platform.openai.com.",
};

/** Codes of a failed response that block the request on policy. */
const policyCodes: ReadonlySet<string> = new Set([
  "bio_policy",
  "misalignment_policy_violation",
  "image_content_policy_violation",
]);

/** Codes of a failed response about a picture in the request. */
const pictureCodes: ReadonlySet<string> = new Set([
  "invalid_image",
  "invalid_image_format",
  "invalid_base64_image",
  "invalid_image_url",
  "image_too_large",
  "image_too_small",
  "image_parse_error",
  "invalid_image_mode",
  "image_file_too_large",
  "unsupported_image_media_type",
  "empty_image_file",
  "failed_to_download_image",
  "image_file_not_found",
]);

function said(failure: FailureReport): string | undefined {
  const message = failure.error?.message;
  return typeof message === "string" && message.trim() ? message : undefined;
}

function field(failure: FailureReport, name: "code" | "type") {
  const value = (failure.error as Record<string, unknown> | undefined)?.[name];
  return typeof value === "string" ? value : undefined;
}

/** A refusal in OpenAI's words, or else named by what it carried. */
function rejected(sentence: string | undefined, carried: string) {
  return new ModelClientError(
    "requestRejected",
    sentence
      ? `OpenAI refused the request: ${sentence}`
      : `OpenAI refused the request (${carried}).`,
  );
}

/** A failure inside a stream whose status already went out as 200. */
function inStream(
  code: string | undefined,
  sentence: string | undefined,
): ModelClientError {
  const outOf = code === undefined ? undefined : outOfCredits[code];
  if (outOf) return new ModelClientError("outOfCredits", outOf);
  if (code === "server_error" || code === "vector_store_timeout" || !code)
    return new ModelClientError(
      "unexplainedError",
      sentence
        ? `OpenAI failed partway through: ${sentence}`
        : "OpenAI failed partway through without saying why.",
    );
  if (code === "rate_limit_exceeded")
    return new ModelClientError(
      "rateLimited",
      "OpenAI is limiting how fast requests are sent. Trying again shortly.",
    );
  if (policyCodes.has(code))
    return new ModelClientError(
      "refused",
      sentence
        ? `OpenAI declined the request: ${sentence}`
        : "OpenAI declined the request.",
    );
  if (pictureCodes.has(code))
    return new ModelClientError(
      "attachmentRejected",
      sentence
        ? `OpenAI could not use a picture: ${sentence}`
        : "OpenAI could not use a picture in the request.",
    );
  return rejected(sentence, code);
}

export function classifyFailure(failure: FailureReport): ModelClientError {
  const sentence = said(failure);
  const code = field(failure, "code");
  const wait = retryAfterMs(failure.headers);
  if (failure.inStream) return inStream(code, sentence);
  switch (failure.status) {
    case 400: {
      if (saysTooLong(sentence)) {
        const tokens = tokenLimitFrom(sentence);
        return new ModelClientError(
          "contextExceeded",
          "The request is too large for the selected model.",
          tokens ? { tokens } : {},
        );
      }
      return rejected(sentence, `HTTP ${failure.status}`);
    }
    case 401:
      return new ModelClientError(
        "unauthorized",
        "OpenAI rejected the API key. Check it on the Model page.",
      );
    case 429: {
      const outOf = code === undefined ? undefined : outOfCredits[code];
      if (outOf) return new ModelClientError("outOfCredits", outOf);
      if (field(failure, "type") === "insufficient_quota")
        return new ModelClientError(
          "outOfCredits",
          "The OpenAI account has run out of quota. Check its credits and limits at platform.openai.com.",
        );
      return new ModelClientError(
        "rateLimited",
        "OpenAI is limiting how fast requests are sent. Trying again shortly.",
        wait === undefined ? {} : { retryAfterMs: wait },
      );
    }
    case 503:
      return new ModelClientError(
        "modelUnavailable",
        "The model is overloaded at OpenAI right now.",
        {
          retryable: true,
          ...(wait === undefined ? {} : { retryAfterMs: wait }),
        },
      );
    default:
      return failure.status >= 500 || failure.status === 0
        ? new ModelClientError(
            "unexplainedError",
            "OpenAI's server failed without saying why.",
          )
        : rejected(sentence, `HTTP ${failure.status}`);
  }
}
