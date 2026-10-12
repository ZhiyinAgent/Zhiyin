/** A streamed answer's bytes, read as server-sent events and never waited on forever. */

import { ModelClientError } from "./failures.js";
import type { ModelFetch, ModelFetchResponse } from "./model-client.js";

/**
 * The same request, but an answer that has not started within
 * `startTimeoutMs` ends it instead of being waited on: no response at all, or
 * a response whose stream has not sent its first byte.
 *
 * A connection that never answers looks, from here, like a model that has not
 * begun. The request is abandoned rather than waited out, and its socket is
 * released; whether it is sent again is the retry policy's decision.
 */
export function startingWithin(
  fetcher: ModelFetch,
  startTimeoutMs: number,
  /** The provider, as the person reads its name. */
  provider: string,
): ModelFetch {
  return async (url, init) => {
    const givenUp = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tooLate = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        const late = new ModelClientError(
          "networkFailure",
          `${provider} did not start answering. Try again.`,
        );
        reject(late);
        givenUp.abort(late);
      }, startTimeoutMs);
    });
    // Nothing may be waiting on it by the time it is too late.
    tooLate.catch(() => undefined);
    const started = () => clearTimeout(timer);
    let response: ModelFetchResponse;
    try {
      const sent = fetcher(url, {
        ...init,
        signal: init.signal
          ? AbortSignal.any([init.signal, givenUp.signal])
          : givenUp.signal,
      });
      // Given up on, it may still fail later, with nobody left to tell.
      sent.catch(() => undefined);
      response = await Promise.race([sent, tooLate]);
    } catch (error) {
      started();
      throw error;
    }
    if (!response.body) {
      started();
      return response;
    }
    return {
      ok: response.ok,
      status: response.status,
      headers: response.headers,
      body: startedBy(response.body, tooLate, started),
    };
  };
}

/** The same bytes, the first of them awaited no longer than the start allows. */
async function* startedBy(
  body: AsyncIterable<Uint8Array>,
  tooLate: Promise<never>,
  started: () => void,
): AsyncIterable<Uint8Array> {
  const iterator = body[Symbol.asyncIterator]();
  try {
    let step: IteratorResult<Uint8Array>;
    try {
      step = await Promise.race([iterator.next(), tooLate]);
    } finally {
      started();
    }
    while (!step.done) {
      yield step.value;
      step = await iterator.next();
    }
  } finally {
    void iterator.return?.().catch(() => undefined);
  }
}

/**
 * The same bytes, but a gap longer than `stallTimeoutMs` between them ends the
 * stream instead of waiting on it.
 *
 * The underlying iterator is asked to close so the abandoned request releases
 * its socket, but that request is not waited on: an iterator suspended inside
 * the very read that stalled will not answer `return()` either, and waiting
 * for it would reintroduce the hang this exists to end.
 */
export async function* withoutStalling(
  body: AsyncIterable<Uint8Array>,
  stallTimeoutMs: number,
  /** The provider, as the person reads its name. */
  provider: string,
): AsyncIterable<Uint8Array> {
  const iterator = body[Symbol.asyncIterator]();
  try {
    for (;;) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const stalled = new Promise<"stalled">((resolve) => {
        timer = setTimeout(() => resolve("stalled"), stallTimeoutMs);
      });
      let step: IteratorResult<Uint8Array> | "stalled";
      try {
        step = await Promise.race([iterator.next(), stalled]);
      } finally {
        clearTimeout(timer);
      }
      if (step === "stalled") {
        throw new ModelClientError(
          "networkFailure",
          `${provider} stopped responding partway through. Try again.`,
        );
      }
      if (step.done) return;
      yield step.value;
    }
  } finally {
    void iterator.return?.().catch(() => undefined);
  }
}

export async function* serverSentEvents(body: AsyncIterable<Uint8Array>) {
  const decoder = new TextDecoder();
  let buffer = "";

  function takeEvent(): string | undefined {
    const boundary = /\r?\n\r?\n/.exec(buffer);
    if (!boundary || boundary.index === undefined) return undefined;
    const block = buffer.slice(0, boundary.index);
    buffer = buffer.slice(boundary.index + boundary[0].length);
    return block;
  }

  function dataFrom(block: string) {
    return block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
  }

  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let block = takeEvent();
    while (block !== undefined) {
      const data = dataFrom(block);
      if (data) yield data;
      block = takeEvent();
    }
  }

  buffer += decoder.decode();
  const data = dataFrom(buffer);
  if (data) yield data;
}
