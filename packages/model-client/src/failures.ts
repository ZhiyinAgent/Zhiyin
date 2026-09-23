/**
 * What a provider failure means, decided once for both places one can arrive:
 * the status line of a refused request, and an error chunk inside a stream
 * whose status already went out as 200.
 *
 * OpenRouter tags each failure with a typed `error_type` (errors reference,
 * https://openrouter.ai/docs/api-reference/errors, read 2026-09-23). That type
 * is read first. The status and the provider's sentence decide only when the
 * type is absent, `unmapped`, or one this code does not know - the list grows,
 * and a new value must fall back rather than throw.
 */

export type ModelClientErrorCode =
  | "unsupportedReasoning"
  | "missingCredential"
  | "unauthorized"
  | "rateLimited"
  | "modelUnavailable"
  | "contextExceeded"
  | "credentialUnavailable"
  | "networkFailure"
  | "malformedResponse"
  /** Declined by a content filter, a moderation check or the model itself. */
  | "refused"
  /** No credits left, or a spending cap on the key was reached. */
  | "outOfCredits"
  /** A picture in the request could not be used. */
  | "attachmentRejected"
  /** Refused for something in the request that is not its size. */
  | "requestRejected";

/**
 * The provider's account of a failure, kept for diagnosis. An allowlist rather
 * than the metadata as sent: the metadata can carry the person's flagged words
 * and the upstream's raw payload, and neither belongs in a record that outlives
 * the request.
 */
export type ProviderFailureDetail = {
  readonly errorType?: string;
  /** The upstream's own code for the failure, where OpenRouter passed it on. */
  readonly code?: string;
  /** Which upstream declined. */
  readonly name?: string;
  /** Why a moderation check flagged the request. */
  readonly reasons?: readonly string[];
};

/** What an oversized request cost and what it was allowed, where the provider said. */
export type TokenLimitDetail = {
  readonly sent?: number;
  readonly limit?: number;
};

/**
 * Failures that are worth the same request again, when nothing says otherwise.
 * A code with more than one cause (an unavailable model is withdrawn or merely
 * busy) is decided where it is raised.
 */
const retryableByDefault: ReadonlySet<ModelClientErrorCode> = new Set([
  "rateLimited",
  "networkFailure",
  "malformedResponse",
]);

export class ModelClientError extends Error {
  readonly code: ModelClientErrorCode;
  readonly retryAfterMs?: number;
  /**
   * Whether sending the same request again could succeed. Decided here, where
   * the cause is known, so a caller deciding whether to retry does not have to
   * re-derive it from a code that two causes share.
   */
  readonly retryable: boolean;
  readonly provider?: ProviderFailureDetail;
  readonly tokens?: TokenLimitDetail;

  constructor(
    code: ModelClientErrorCode,
    message: string,
    options: {
      retryAfterMs?: number;
      retryable?: boolean;
      provider?: ProviderFailureDetail;
      tokens?: TokenLimitDetail;
      cause?: unknown;
    } = {},
  ) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "ModelClientError";
    this.code = code;
    this.retryable = options.retryable ?? retryableByDefault.has(code);
    if (options.retryAfterMs !== undefined)
      this.retryAfterMs = options.retryAfterMs;
    if (options.provider !== undefined) this.provider = options.provider;
    if (options.tokens !== undefined) this.tokens = options.tokens;
  }
}

export type FailureHeaders = { get(name: string): string | null };

export function retryAfterMs(headers: FailureHeaders | undefined) {
  const value = headers?.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now());
}

/**
 * How much of a refusal body is read. Providers explain in a sentence, but the
 * metadata beside it can carry the upstream's raw payload, and a body cut
 * short is not JSON - which would lose the sentence along with the rest.
 */
const refusalBodyLimit = 32_768;

/** The error object as OpenRouter sends it, before anything is trusted. */
export type ProviderError = {
  readonly code?: unknown;
  readonly message?: unknown;
  readonly metadata?: unknown;
};

/**
 * The provider's explanation of a refusal in the status line, where it gave
 * one. The body is read rather than discarded because the status alone cannot
 * tell one refusal from another that shares its code.
 */
export async function refusalBody(
  body: AsyncIterable<Uint8Array> | null,
): Promise<ProviderError | undefined> {
  if (!body) return undefined;
  const decoder = new TextDecoder();
  let text = "";
  try {
    for await (const chunk of body) {
      text += decoder.decode(chunk, { stream: true });
      if (text.length >= refusalBodyLimit) break;
    }
  } catch {
    return undefined;
  }
  try {
    const parsed = JSON.parse(text) as { error?: unknown };
    return parsed.error && typeof parsed.error === "object"
      ? (parsed.error as ProviderError)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether a refusal is about the model id rather than the request.
 *
 * Verified against the live provider on 2026-09-13: an id OpenRouter does not
 * recognise is refused with 400 "<id> is not a valid model ID", while a model
 * that existed and has since been retired answers 404 "No endpoints found for
 * <id>". Checked before the typed field, because the first arrives as a
 * generic invalid request and still means the stored choice is dead.
 */
function refusesTheModel(message: string | undefined): boolean {
  return (
    message !== undefined &&
    /not a valid model|no endpoints found/i.test(message)
  );
}

/**
 * The phrasings upstreams use for a conversation that no longer fits. Only
 * these make an untyped 400 a size problem: anything else reported as "too
 * large" sends somebody to throw their conversation away over a problem that
 * was never its length.
 */
function saysTooLong(message: string | undefined): boolean {
  return (
    message !== undefined &&
    /maximum context length|context[_ ]length[_ ]exceeded|prompt is too long/i.test(
      message,
    )
  );
}

function tokensFrom(message: string | undefined): TokenLimitDetail | undefined {
  if (!message) return undefined;
  const limit = /maximum context length is (\d+)/i.exec(message)?.[1];
  const sent =
    /(?:you requested|resulted in|requested) (?:about )?(\d+) tokens/i.exec(
      message,
    )?.[1];
  if (limit === undefined && sent === undefined) return undefined;
  return {
    ...(sent === undefined ? {} : { sent: Number(sent) }),
    ...(limit === undefined ? {} : { limit: Number(limit) }),
  };
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
      ? `No allowed provider can serve “${model}”. If that model has been withdrawn, choose another in Settings.`
      : "No allowed provider can serve the selected model.",
  };
}

function unrecognisedModel(model: string | undefined): Classified {
  return {
    code: "modelUnavailable",
    retryable: false,
    ownWording: true,
    message: model
      ? `OpenRouter does not recognise “${model}”. It may have been withdrawn; choose another model in Settings.`
      : "OpenRouter does not recognise the selected model. Choose another in Settings.",
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
      return rateLimited;
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
  if (status === 429) return rateLimited;
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
export function classifyFailure(options: {
  readonly status: number;
  readonly error?: ProviderError;
  readonly headers?: FailureHeaders;
  readonly model?: string;
  readonly inStream?: boolean;
}): ModelClientError {
  const said = text(options.error?.message);
  const detail = detailFrom(options.error?.metadata);
  const facts: Circumstances = {
    status: options.status,
    said,
    detail,
    model: options.model,
    retryAfter: retryAfterMs(options.headers),
  };
  const classified = refusesTheModel(said)
    ? unrecognisedModel(options.model)
    : ((detail?.errorType && detail.errorType !== "unmapped"
        ? fromType(detail.errorType, facts)
        : undefined) ?? fromStatus(facts));
  const message =
    options.inStream && said && !classified.ownWording
      ? said
      : classified.message;
  const tokens =
    classified.code === "contextExceeded" ? tokensFrom(said) : undefined;
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
