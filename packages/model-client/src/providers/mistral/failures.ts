/**
 * What a Mistral failure means. Mistral documents its failures by status,
 * with a body that carries its sentence at the top level rather than under
 * `error`, and lists what failed validation under `detail` for a 422 (error
 * glossary, first request quickstart and API reference, checked 2026-10-09).
 * The status decides; the sentence is passed on. Only a sentence about the
 * context length makes a 400 a size problem.
 */

import {
  ModelClientError,
  retryAfterMs,
  saysTooLong,
  type FailureReport,
  type ProviderError,
  said,
  tooLarge,
  overloaded,
} from "../../failures.js";

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Mistral's explanation in a refusal's body, in either of its two forms. */
export function refusalFrom(body: unknown): ProviderError | undefined {
  const fields = record(body);
  if (!fields) return undefined;
  if (typeof fields["message"] === "string")
    return { message: fields["message"], code: fields["code"] };
  if (!Array.isArray(fields["detail"])) return undefined;
  const problems = fields["detail"].flatMap((problem: unknown) => {
    const message = record(problem)?.["msg"];
    return typeof message === "string" && message.trim() ? [message] : [];
  });
  return problems.length ? { message: problems.join(" ") } : undefined;
}

function refused(failure: FailureReport, sentence: string | undefined) {
  return new ModelClientError(
    "requestRejected",
    sentence
      ? `Mistral refused the request: ${sentence}`
      : `Mistral refused the request (HTTP ${failure.status}).`,
  );
}

function unknownModel(failure: FailureReport, sentence: string | undefined) {
  const model = failure.model ? `"${failure.model}"` : "this model";
  return new ModelClientError(
    "modelUnavailable",
    sentence
      ? `Mistral does not offer ${model} to this account: ${sentence}`
      : `Mistral does not offer ${model} to this account. Choose another on the Model page.`,
    { retryable: false },
  );
}

export function classifyFailure(failure: FailureReport): ModelClientError {
  const sentence = said(failure);
  const wait = retryAfterMs(failure.headers);
  if (failure.error?.code === "unknown_model")
    return unknownModel(failure, sentence);
  switch (failure.status) {
    case 400:
    case 422: {
      if (saysTooLong(sentence)) return tooLarge(sentence);
      return refused(failure, sentence);
    }
    case 401:
      return new ModelClientError(
        "unauthorized",
        "Mistral rejected the API key. Check it on the Model page.",
      );
    case 402:
      return new ModelClientError(
        "outOfCredits",
        sentence
          ? `The Mistral account cannot pay for requests: ${sentence} Check its payment method and credits at admin.mistral.ai, then try again.`
          : "The Mistral account cannot pay for requests. Check its payment method and credits at admin.mistral.ai, then try again.",
      );
    // Mistral's causes for a 403: a model the plan does not include, or
    // workspace permissions.
    case 403:
    case 404:
      return unknownModel(failure, sentence);
    case 429:
      return new ModelClientError(
        "rateLimited",
        "Mistral is limiting how fast requests are sent. Trying again shortly.",
        wait === undefined ? {} : { retryAfterMs: wait },
      );
    case 503:
      return overloaded(
        "Mistral is overloaded or under maintenance right now.",
        wait,
      );
    default:
      return failure.status >= 500 || failure.status === 0
        ? new ModelClientError(
            "unexplainedError",
            "Mistral's server failed without saying why.",
          )
        : refused(failure, sentence);
  }
}

/**
 * A stream Mistral ends with the finish reason `error` failed partway: its
 * reference lists the value and says nothing more about it.
 */
export function failedFinish(
  finishReason: string,
): ModelClientError | undefined {
  return finishReason === "error"
    ? new ModelClientError(
        "unexplainedError",
        "Mistral's server failed partway through the answer without saying why.",
      )
    : undefined;
}
