/**
 * What an OpenRouter failure means, decided once for both places one can
 * arrive: the status line of a refused request, and an error chunk inside a
 * stream whose status already went out as 200.
 *
 * OpenRouter tags each failure with a typed `error_type` (errors reference,
 * https://openrouter.ai/docs/api-reference/errors). That type is read first.
 * The status and the provider's sentence decide only when the type is absent,
 * `unmapped`, or one this code does not know - the list grows, and a new value
 * must fall back rather than throw.
 */

import {
  ModelClientError,
  retryAfterMs,
  saysTooLong,
  tokenLimitFrom,
  type FailureReport,
  type ModelClientErrorCode,
  type ProviderFailureDetail,
} from "../../failures.js";

/**
 * Whether a refusal is about the model id rather than the request.
 *
 * Verified against the live provider: an id OpenRouter does not recognise is
 * refused with 400 "<id> is not a valid model ID", while a model that existed
 * and has since been retired answers 404 "No endpoints found for <id>".
 * Checked before the typed field, because the first arrives as a generic
 * invalid request and still means the stored choice is dead.
 */
function refusesTheModel(message: string | undefined): boolean {
  return (
    message !== undefined &&
    /not a valid model|no endpoints found/i.test(message)
  );
}

/**
 * OpenRouter's sentence for an upstream that failed without explaining, with
 * any status. Seen on a request that went through when sent again; nothing in
 * it says the request itself was at fault.
 */
function saysNothing(message: string | undefined): boolean {
  return (
    message !== undefined &&
    /^provider returned error\.?$/i.test(message.trim())
  );
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function detailFrom(metadata: unknown): ProviderFailureDetail | undefined {
  if (!metadata || typeof metadata !== "object") return undefined;
  const fields = metadata as Record<string, unknown>;
  const reasons = Array.isArray(fields.reasons)
    ? fields.reasons
        .filter((reason): reason is string => typeof reason === "string")
        .map((reason) => reason.slice(0, 200))
        .slice(0, 10)
    : [];
  const errorType = text(fields.error_type);
  const code = text(fields.provider_code);
  const name = text(fields.provider_name);
  const detail = {
    ...(errorType ? { errorType: errorType.slice(0, 100) } : {}),
    ...(code ? { code: code.slice(0, 100) } : {}),
    ...(name ? { name: name.slice(0, 100) } : {}),
    ...(reasons.length ? { reasons } : {}),
  };
  return Object.keys(detail).length ? detail : undefined;
}

type Classified = {
  readonly code: ModelClientErrorCode;
  readonly message: string;
  readonly retryable?: boolean;
  /**
   * Whether the wording above already carries the provider's sentence, or
   * must not: a masked server error's sentence says nothing.
   */
  readonly ownWording?: boolean;
};

type Circumstances = {
  readonly status: number;
  readonly said: string | undefined;
  readonly detail: ProviderFailureDetail | undefined;
  readonly model: string | undefined;
  readonly retryAfter: number | undefined;
};

function unexplained(detail: ProviderFailureDetail | undefined): Classified {
  return {
    code: "unexplainedError",
    retryable: true,
    ownWording: true,
    message: `${detail?.name ?? "The provider"} returned an error without saying why.`,
  };
}

function unavailableModel(model: string | undefined): Classified {
  /*
   * Routing matched nobody: an allowlist naming no provider that serves this
   * model, or a request parameter none of the allowed providers support. A
   * model the provider has withdrawn arrives here too, and is the case a
   * person can actually do something about - so the stored id is named, and
   * so is the page where it is changed.
   */
  return {
    code: "modelUnavailable",
    retryable: false,
    message: model
      ? `No allowed provider can serve “${model}”. If that model has been withdrawn, choose another on the Model page.`
      : "No allowed provider can serve the selected model.",
  };
}

function unrecognisedModel(model: string | undefined): Classified {
  return {
    code: "modelUnavailable",
    retryable: false,
    ownWording: true,
    message: model
      ? `OpenRouter does not recognise “${model}”. It may have been withdrawn; choose another model on the Model page.`
      : "OpenRouter does not recognise the selected model. Choose another on the Model page.",
  };
}

const tooLarge: Classified = {
  code: "contextExceeded",
  message: "The request is too large for the selected model.",
  retryable: false,
};

const rateLimited: Classified = {
  code: "rateLimited",
  message:
    "Every allowed provider is out of capacity for this model. Try again shortly.",
  retryable: true,
};

/**
 * A 429 from OpenRouter itself rather than an upstream: one that names no
 * upstream and says which of OpenRouter's limits it hit, such as
 * "free-models-per-day" (limits page, read 2026-10-20). The daily limit on
 * free models lasts until the next day or until credits are bought, so it is
 * not sent again; any other is.
 */
function ownLimit(facts: Circumstances): Classified | undefined {
  const { said, detail } = facts;
  if (!said || detail?.name || detail?.code) return undefined;
  if (/free-models-per-day/i.test(said))
    return {
      code: "outOfCredits",
      retryable: false,
      ownWording: true,
      message: `OpenRouter's daily limit on free models was reached: ${said.trim()}`,
    };
  if (/free-models-per-/i.test(said))
    return {
      code: "rateLimited",
      retryable: true,
      ownWording: true,
      message: `OpenRouter is limiting this account's requests: ${said.trim()}`,
    };
  return undefined;
}

const busy: Classified = {
  code: "modelUnavailable",
  message: "The selected model is not available right now.",
  retryable: true,
};

function passingTrouble(status: number, masked = false): Classified {
  return {
    code: "networkFailure",
    retryable: true,
    ownWording: masked,
    message:
      status > 0
        ? `OpenRouter could not complete the request (HTTP ${status}).`
        : "OpenRouter could not complete the request.",
  };
}

function withSaid(lead: string, said: string | undefined): string {
  return said ? `${lead}: ${said}` : `${lead}.`;
}

function rejected(said: string | undefined, status: number): Classified {
  return {
    code: "requestRejected",
    retryable: false,
    ownWording: true,
    message: said
      ? withSaid("The provider refused the request", said)
      : `The provider refused the request (HTTP ${status}).`,
  };
}

function refusal(
  said: string | undefined,
  detail: ProviderFailureDetail | undefined,
): Classified {
  const reasons = detail?.reasons?.length
    ? detail.reasons.join(", ")
    : undefined;
  return {
    code: "refused",
    retryable: false,
    ownWording: true,
    message: withSaid(
      `${detail?.name ?? "The provider"} declined this request`,
      reasons ?? said,
    ),
  };
}

function outOfCredits(retryAfter: number | undefined): Classified {
  /*
   * A 402 with Retry-After is OpenRouter's in-flight spending budget, which
   * clears as running requests finish. Without the header, waiting changes
   * nothing: somebody has to add credits.
   */
  return {
    code: "outOfCredits",
    retryable: retryAfter !== undefined,
    message:
      "The OpenRouter account is out of credits. Add credits at openrouter.ai, then try again.",
  };
}

const spendingCap: Classified = {
  code: "outOfCredits",
  retryable: false,
  message:
    "A spending limit on this OpenRouter key was reached. Raise it on openrouter.ai, or wait for it to reset.",
};

function fromType(type: string, facts: Circumstances): Classified | undefined {
  const { said, detail, retryAfter, model } = facts;
  switch (type) {
    case "context_length_exceeded":
    case "payload_too_large":
      return tooLarge;
    case "token_limit_exceeded":
      return spendingCap;
    case "payment_required":
      return outOfCredits(retryAfter);
    case "max_tokens_exceeded":
    case "string_too_long":
    case "invalid_request":
    case "invalid_prompt":
    case "precondition_failed":
    case "unprocessable":
      return rejected(said, facts.status);
    case "not_found":
      return unavailableModel(model);
    case "authentication":
      return {
        code: "unauthorized",
        message: "OpenRouter rejected the API key.",
        ownWording: true,
      };
    case "permission_denied":
      return {
        code: "refused",
        retryable: false,
        ownWording: true,
        message:
          "OpenRouter declined this request: the key lacks permission for it, or an account guardrail blocked it. Check the key's settings on openrouter.ai.",
      };
    case "rate_limit_exceeded":
      return ownLimit(facts) ?? rateLimited;
    case "provider_overloaded":
      return busy;
    case "provider_unavailable":
    case "timeout":
      return passingTrouble(facts.status);
    case "server":
      return passingTrouble(facts.status, true);
    case "content_policy_violation":
    case "refusal":
      return refusal(said, detail);
    case "invalid_image":
    case "image_too_large":
    case "image_too_small":
    case "unsupported_image_format":
    case "image_not_found":
    case "image_download_failed":
      return {
        code: "attachmentRejected",
        retryable: false,
        ownWording: true,
        message: withSaid("The model could not use an attached picture", said),
      };
    default:
      return undefined;
  }
}

function fromStatus(facts: Circumstances): Classified {
  const { status, said, model, retryAfter } = facts;
  if (status === 401) {
    return {
      code: "unauthorized",
      message: "OpenRouter rejected the API key.",
      ownWording: true,
    };
  }
  if (status === 403) {
    return said && /\bkey\b/i.test(said)
      ? {
          code: "unauthorized",
          message: "OpenRouter rejected the API key.",
          ownWording: true,
        }
      : refusal(said, facts.detail);
  }
  if (status === 402) return outOfCredits(retryAfter);
  if (status === 404) return unavailableModel(model);
  if (status === 413) return tooLarge;
  if (status === 429) return ownLimit(facts) ?? rateLimited;
  if (status === 503) return busy;
  if (status === 400)
    return saysTooLong(said) ? tooLarge : rejected(said, status);
  if (status === 408 || status === 0 || status >= 500)
    return passingTrouble(status);
  if (status >= 400) return rejected(said, status);
  return passingTrouble(status);
}

/**
 * One failure, wherever it was reported.
 *
 * `inStream` is where the provider's sentence stands in for this code's own
 * wording: a stream failure is usually an upstream's, and its own explanation
 * is the better one. Two explanations of one failure read as two failures, so
 * it replaces rather than joins.
 */
export function classifyFailure(options: FailureReport): ModelClientError {
  const said = text(options.error?.message);
  const detail = detailFrom(options.error?.metadata);
  const facts: Circumstances = {
    status: options.status,
    said,
    detail,
    model: options.model,
    retryAfter: retryAfterMs(options.headers),
  };
  const typed =
    detail?.errorType && detail.errorType !== "unmapped"
      ? fromType(detail.errorType, facts)
      : undefined;
  // A type says what happened; the bare sentence says only that something did.
  const classified = refusesTheModel(said)
    ? unrecognisedModel(options.model)
    : (typed ?? (saysNothing(said) ? unexplained(detail) : fromStatus(facts)));
  const message =
    options.inStream && said && !classified.ownWording
      ? said
      : classified.message;
  const tokens =
    classified.code === "contextExceeded" ? tokenLimitFrom(said) : undefined;
  return new ModelClientError(classified.code, message, {
    ...(classified.retryable === undefined
      ? {}
      : { retryable: classified.retryable }),
    ...(facts.retryAfter === undefined
      ? {}
      : { retryAfterMs: facts.retryAfter }),
    ...(detail ? { provider: detail } : {}),
    ...(tokens ? { tokens } : {}),
  });
}
