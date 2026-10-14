/**
 * The outcomes a failed request is reported as, whichever provider failed.
 * What a provider's own failure means is decided in that provider's folder,
 * once for both places one can arrive: the status line of a refused request,
 * and an error inside a stream whose status already went out as 200.
 */

export type ModelClientErrorCode =
  /** Nobody has chosen a model yet; nothing was sent. */
  | "noModel"
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
  | "requestRejected"
  /** An upstream failed and said nothing about why. */
  | "unexplainedError";

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
  "unexplainedError",
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

/**
 * The same failure with every quotation of the key taken out. Its cause, which
 * may hold the lab's answer as it came, is left behind.
 */
export function withoutKey(
  error: ModelClientError,
  key: string,
): ModelClientError {
  const hide = (text: string) => text.replaceAll(key, "[your key]");
  const detail = error.provider;
  const quoted = [
    error.message,
    detail?.errorType,
    detail?.code,
    detail?.name,
    ...(detail?.reasons ?? []),
  ].some((text) => text?.includes(key));
  if (!key || !quoted) return error;
  return new ModelClientError(error.code, hide(error.message), {
    retryable: error.retryable,
    ...(error.retryAfterMs === undefined
      ? {}
      : { retryAfterMs: error.retryAfterMs }),
    ...(error.tokens ? { tokens: error.tokens } : {}),
    ...(detail
      ? {
          provider: {
            ...(detail.errorType ? { errorType: hide(detail.errorType) } : {}),
            ...(detail.code ? { code: hide(detail.code) } : {}),
            ...(detail.name ? { name: hide(detail.name) } : {}),
            ...(detail.reasons ? { reasons: detail.reasons.map(hide) } : {}),
          },
        }
      : {}),
  });
}

/**
 * The phrasings providers use for a conversation that no longer fits, in the
 * form OpenAI's API gave it and others copied. Only these make an untyped 400
 * a size problem: anything else reported as "too large" sends somebody to
 * throw their conversation away over a problem that was never its length.
 */
export function saysTooLong(message: string | undefined): boolean {
  return (
    message !== undefined &&
    /maximum context length|context[_ ]length[_ ]exceeded|prompt is too long/i.test(
      message,
    )
  );
}

/** The size sent and the limit, where a provider's sentence states them. */
export function tokenLimitFrom(
  message: string | undefined,
): TokenLimitDetail | undefined {
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

/** The error object as a provider sends it, before anything is trusted. */
export type ProviderError = {
  readonly code?: unknown;
  readonly message?: unknown;
  readonly metadata?: unknown;
};

/** One failure as it arrived, for its provider to say what it means. */
export type FailureReport = {
  readonly status: number;
  readonly error?: ProviderError;
  readonly headers?: FailureHeaders;
  readonly model?: string;
  /** Inside a stream whose status already went out as 200. */
  readonly inStream?: boolean;
};

/** The `error` object most providers wrap their explanation in. */
function errorObject(parsed: unknown): ProviderError | undefined {
  const { error } = parsed as { error?: unknown };
  return error && typeof error === "object"
    ? (error as ProviderError)
    : undefined;
}

/**
 * The provider's explanation of a refusal in the status line, where it gave
 * one. The body is read rather than discarded because the status alone cannot
 * tell one refusal from another that shares its code. `explanation` finds it
 * in a provider's body; by default, under `error`.
 */
export async function refusalBody(
  body: AsyncIterable<Uint8Array> | null,
  explanation: (parsed: unknown) => ProviderError | undefined = errorObject,
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
    return explanation(JSON.parse(text));
  } catch {
    return undefined;
  }
}
