/** A streamed answer's bytes, read as server-sent events and never waited on forever. */

import { ModelClientError } from "./failures.js";

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
          "OpenRouter stopped responding partway through. Try again.",
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
