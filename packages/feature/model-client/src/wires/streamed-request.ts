/**
 * What every wire does the same way: send one request, say what went wrong
 * before an answer began, and hand on the answer as the events it is sent in.
 * How a request is put together and what its events mean is each wire's own.
 */

import { randomUUID } from "node:crypto";
import {
  ModelClientError,
  refusalBody,
  type FailureReport,
  type ProviderError,
} from "../failures.js";
import type { ModelFetchResponse } from "../model-client.js";
import type { SendInput } from "../provider.js";
import { serverSentEvents, withoutStalling } from "../stream.js";

/**
 * The id of a request the provider named none for. Usage is counted by
 * request, so two unnamed requests must not be taken for one.
 */
export function unnamedRequest(): string {
  return `unnamed-${randomUUID()}`;
}

/** What sending needs of a provider, whichever wire it speaks. */
export type StreamingDialect = {
  /** How the person reads the provider's name in a failure. */
  readonly name: string;
  headers(apiKey: string): Readonly<Record<string, string>>;
  classify(failure: FailureReport): ModelClientError;
  /**
   * Where a refused request's body explains itself, for a provider that does
   * not put it under `error`.
   */
  readonly refusal?: (body: unknown) => ProviderError | undefined;
};

/**
 * Sends one request and yields each event of the answer, as the text the
 * provider sent. Before the first it throws the caller's own reason when the
 * caller cancelled, a network failure when nothing answered, the dialect's
 * reading of a refusal, and a malformed response when an accepted request
 * comes back with nothing to read.
 *
 * The request is cancelled once its events stop being read, for whatever
 * reason, so the provider is told to stop a stream given up on.
 */
export async function* streamedEvents(
  dialect: StreamingDialect,
  input: SendInput,
  body: unknown,
): AsyncIterable<string> {
  const { request } = input;
  const ended = new AbortController();
  const signal = request.signal
    ? AbortSignal.any([request.signal, ended.signal])
    : ended.signal;
  try {
    yield* sent(dialect, input, body, signal);
  } finally {
    ended.abort();
  }
}

async function* sent(
  dialect: StreamingDialect,
  input: SendInput,
  body: unknown,
  signal: AbortSignal,
): AsyncIterable<string> {
  const { chosen, request } = input;
  let response: ModelFetchResponse;
  try {
    response = await input.fetcher(input.endpoint, {
      method: "POST",
      headers: dialect.headers(input.apiKey),
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    // Cancelled by the caller, which is not a connection that failed.
    if (request.signal?.aborted) throw request.signal.reason;
    // Already said for what it is, such as an answer that never started.
    if (error instanceof ModelClientError) throw error;
    // Chromium's network names a certificate it refuses (ADR 0004). That is
    // not a blip a repeat gets past, and the key went nowhere.
    if (error instanceof Error && /^net::ERR_CERT_/.test(error.message))
      throw new ModelClientError(
        "networkFailure",
        `${dialect.name}'s certificate is not trusted on this computer, so Zhiyin did not send the request.`,
        { cause: error, retryable: false },
      );
    throw new ModelClientError(
      "networkFailure",
      `Could not reach ${dialect.name}. Check the connection and try again.`,
      { cause: error },
    );
  }

  if (!response.ok)
    throw dialect.classify({
      status: response.status,
      headers: response.headers,
      model: chosen.model,
      ...(request.messages.some(
        (message) =>
          message.role === "user" &&
          typeof message.content !== "string" &&
          message.content.some((part) => part.kind === "image"),
      )
        ? { withPictures: true }
        : {}),
      ...(await refusalBody(response.body, dialect.refusal).then((error) =>
        error ? { error } : {},
      )),
    });
  if (!response.body)
    throw new ModelClientError(
      "malformedResponse",
      `${dialect.name} returned an empty response stream.`,
    );

  yield* serverSentEvents(
    withoutStalling(
      response.body,
      input.stallTimeoutMs,
      dialect.name,
      request.signal,
    ),
  );
}

/** One event as the object it carries; text that is none ends the request. */
export function eventIn<Event>(data: string, dialect: StreamingDialect): Event {
  try {
    return JSON.parse(data) as Event;
  } catch (error) {
    throw new ModelClientError(
      "malformedResponse",
      `${dialect.name} returned an unreadable response.`,
      { cause: error },
    );
  }
}

/** An answer whose stream closed before anything said it was finished. */
export function endedEarly(dialect: StreamingDialect): ModelClientError {
  return new ModelClientError(
    "malformedResponse",
    `${dialect.name} ended the response before completion.`,
  );
}
