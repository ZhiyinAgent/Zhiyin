/**
 * An answer Z.ai stops with a failure. Once a stream has begun, Z.ai does not
 * send an error code: it ends the answer with a finish reason that names the
 * failure, `sensitive`, `network_error` or `model_context_window_exceeded`
 * (error codes page and API reference of both platforms, checked 2026-10-09).
 * Such an answer is a failed request, never a finished one.
 */

import { describe, expect, it } from "vitest";
import { drain, endingWith, untilFailure, zaiClient } from "./support.js";

const hello = { messages: [{ role: "user" as const, content: "Hello" }] };

async function stoppedWith(finishReason: string) {
  return untilFailure(zaiClient({ fetcher: endingWith(finishReason) }), hello);
}

describe("an answer Z.ai stops with a failure", () => {
  it("is a refusal when Z.ai's content filter stopped it, and is not sent again", async () => {
    const { events, error } = await stoppedWith("sensitive");

    expect(error).toMatchObject({ code: "refused", retryable: false });
    expect(events.some((event) => event.kind === "done")).toBe(false);
  });

  it("is a network failure worth sending again when Z.ai's model failed while answering", async () => {
    const { error } = await stoppedWith("network_error");

    expect(error).toMatchObject({ code: "networkFailure", retryable: true });
  });

  it("is a conversation too large for the model when it outgrew the context window", async () => {
    const { error } = await stoppedWith("model_context_window_exceeded");

    expect(error).toMatchObject({ code: "contextExceeded", retryable: false });
  });

  it("keeps the words that arrived before it, and still reports what the request used", async () => {
    const { events } = await stoppedWith("sensitive");

    expect(
      events
        .flatMap((event) => (event.kind === "textDelta" ? [event.text] : []))
        .join(""),
    ).toBe("Done.");
    expect(events.find((event) => event.kind === "usage")).toMatchObject({
      usage: { inputTokens: 1_000_000, outputTokens: 100_000 },
    });
  });

  it("does not turn an answer cut off at the output limit into a failure", async () => {
    const events = await drain(
      zaiClient({ fetcher: endingWith("length") }),
      hello,
    );

    expect(events.at(-1)).toMatchObject({
      kind: "done",
      finishReason: "length",
      response: { complete: false },
    });
  });
});
