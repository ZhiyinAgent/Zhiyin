/**
 * An answer over Anthropic Messages, read from its server-sent events as
 * Anthropic's streaming guide and Messages API reference describe them
 * (checked 2026-10-09): `message_start`, content blocks that start, change and
 * stop, `message_delta` with the stop reason and cumulative usage, then
 * `message_stop`; `ping` anywhere, `error` inside a 200 stream, and new event
 * types to be ignored.
 */

import { describe, expect, it } from "vitest";
import type { FailureReport } from "../src/failures.js";
import type { ModelEvent, ModelFetch } from "../src/model-client.js";
import {
  answering,
  attempt,
  block,
  finished,
  labDialect,
  message,
  sendOnce,
  sse,
  streaming,
} from "./anthropic-messages-support.js";

const hello = { messages: [{ role: "user" as const, content: "Hello" }] };

function without(kinds: readonly string[], events: readonly ModelEvent[]) {
  return events.filter((event) => !kinds.includes(event.kind));
}

describe("an answer over Anthropic Messages", () => {
  it("streams words, readable thinking and tool calls, each call indexed from zero in the order it began", async () => {
    const events = await sendOnce(hello, {
      fetcher: answering(
        message(
          [
            block.thinking(0, "Check the note.", "sig-1"),
            block.text(1, "Reading."),
            block.toolUse(2, "toolu_a", "read_note", '{"name":"todo"}'),
            block.toolUse(3, "toolu_b", "list_notes", "{}"),
          ],
          "tool_use",
        ),
      ),
    });

    expect(without(["usage", "done"], events)).toEqual([
      { kind: "reasoningDelta", text: "Check the note." },
      { kind: "textDelta", text: "Reading." },
      {
        kind: "toolCallDelta",
        index: 0,
        callId: "toolu_a",
        name: "read_note",
      },
      { kind: "toolCallDelta", index: 0, argumentsDelta: '{"name":"todo"}' },
      {
        kind: "toolCallDelta",
        index: 1,
        callId: "toolu_b",
        name: "list_notes",
      },
      { kind: "toolCallDelta", index: 1, argumentsDelta: "{}" },
    ]);
  });

  it("reads a tool call that streamed no input as the input it began with", async () => {
    const events = await sendOnce(hello, {
      fetcher: answering(
        message(
          [
            [
              {
                type: "content_block_start",
                index: 0,
                content_block: {
                  type: "tool_use",
                  id: "toolu_a",
                  name: "list_notes",
                  input: {},
                },
              },
              { type: "content_block_stop", index: 0 },
            ],
          ],
          "tool_use",
        ),
      ),
    });

    expect(without(["usage", "done"], events)).toEqual([
      {
        kind: "toolCallDelta",
        index: 0,
        callId: "toolu_a",
        name: "list_notes",
      },
      { kind: "toolCallDelta", index: 0, argumentsDelta: "{}" },
    ]);
  });

  it("counts cache reads and writes in the input, and takes the cumulative counts the stream ends with", async () => {
    const events = await sendOnce(hello, {
      fetcher: answering([
        {
          type: "message_start",
          message: {
            id: "msg_7",
            type: "message",
            role: "assistant",
            content: [],
            model: "lab-model-snapshot",
            stop_reason: null,
            usage: {
              input_tokens: 50,
              cache_creation_input_tokens: 2_000,
              cache_read_input_tokens: 100_000,
              output_tokens: 1,
            },
          },
        },
        ...block.text(0, "Done."),
        {
          type: "message_delta",
          delta: { stop_reason: "end_turn", stop_sequence: null },
          usage: {
            output_tokens: 900,
            output_tokens_details: { thinking_tokens: 600 },
          },
        },
        { type: "message_stop" },
      ]),
    });

    expect(events.filter((event) => event.kind === "usage")).toEqual([
      {
        kind: "usage",
        usage: {
          requestId: "msg_7",
          model: "lab-model-snapshot",
          inputTokens: 102_050,
          outputTokens: 900,
          totalTokens: 102_950,
          cacheReadTokens: 100_000,
          cacheWriteTokens: 2_000,
          reasoningTokens: 600,
        },
      },
    ]);
  });

  it("ends with Anthropic's stop reason, and a finished answer is complete", async () => {
    const events = await sendOnce(hello, {
      fetcher: answering(finished("end_turn")),
    });

    expect(events.at(-1)).toEqual({
      kind: "done",
      finishReason: "end_turn",
      response: {
        requestId: "msg_1",
        model: "lab-model",
        finishReason: "end_turn",
        termination: "finishReason",
        complete: true,
      },
    });
  });

  it.each(["max_tokens", "model_context_window_exceeded"])(
    "marks an answer that stopped for %s as cut off and incomplete",
    async (reason) => {
      const events = await sendOnce(hello, {
        fetcher: answering(finished(reason)),
      });

      expect(events.at(-1)).toMatchObject({
        kind: "done",
        finishReason: "length",
        response: { finishReason: "length", complete: false },
      });
    },
  );

  it("ignores pings and events it does not know", async () => {
    const [start, ...rest] = finished("end_turn");
    const events = await sendOnce(hello, {
      fetcher: answering([
        start ?? {},
        { type: "ping" },
        { type: "a_future_event", detail: 1 },
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "a_future_block" },
        },
        { type: "content_block_stop", index: 0 },
        ...rest.map((event) =>
          "index" in event ? { ...event, index: 1 } : event,
        ),
      ]),
    });

    expect(without(["usage", "done"], events)).toEqual([
      { kind: "textDelta", text: "Done." },
    ]);
    expect(events.at(-1)).toMatchObject({
      kind: "done",
      finishReason: "end_turn",
    });
  });

  it("fails as the dialect reads an error inside the stream, after passing on what arrived, with no done", async () => {
    const reports: FailureReport[] = [];
    const [start] = finished("end_turn");

    const { events, failure } = await attempt(hello, {
      dialect: labDialect(reports),
      fetcher: answering([
        start ?? {},
        ...block.text(0, "Partly"),
        {
          type: "error",
          error: { type: "overloaded_error", message: "Overloaded" },
        },
      ]),
    });

    expect(failure).toMatchObject({
      code: "modelUnavailable",
      retryable: true,
    });
    expect(reports).toEqual([
      {
        status: 0,
        error: { type: "overloaded_error", message: "Overloaded" },
        model: "lab-model",
        inStream: true,
      },
    ]);
    expect(events).toEqual([{ kind: "textDelta", text: "Partly" }]);
  });

  it("reports a refusal as refused with the lab's explanation, after its usage, and never as a finished answer", async () => {
    const [start] = finished("refusal");

    const { events, failure } = await attempt(hello, {
      fetcher: answering([
        start ?? {},
        ...block.text(0, "Here is how"),
        {
          type: "message_delta",
          delta: {
            stop_reason: "refusal",
            stop_details: {
              type: "refusal",
              category: "cyber",
              explanation:
                "This request was declined because it could enable cyber harm.",
            },
          },
          usage: { output_tokens: 4 },
        },
        { type: "message_stop" },
      ]),
    });

    expect(failure).toMatchObject({
      name: "ModelClientError",
      code: "refused",
      retryable: false,
      message:
        "Test Lab declined the request: This request was declined because it could enable cyber harm.",
      provider: { errorType: "refusal", reasons: ["cyber"] },
    });
    expect(events.map((event) => event.kind)).toEqual(["textDelta", "usage"]);
  });

  it("fails as malformed when the stream ends before Anthropic says it stopped", async () => {
    const [start] = finished("end_turn");

    await expect(
      sendOnce(hello, {
        fetcher: answering([start ?? {}, ...block.text(0, "Partly")]),
      }),
    ).rejects.toMatchObject({ code: "malformedResponse" });
  });

  it("fails as malformed on an event it cannot read", async () => {
    await expect(
      sendOnce(hello, {
        fetcher: streaming("event: message_start\ndata: {not json\n\n"),
      }),
    ).rejects.toMatchObject({ code: "malformedResponse" });
  });

  it("hands a refusal in the status line to the dialect with its status, headers and body", async () => {
    const reports: FailureReport[] = [];
    const headers: Record<string, string> = { "retry-after": "7" };
    const refused: ModelFetch = async () => ({
      ok: false,
      status: 429,
      headers: { get: (name) => headers[name.toLowerCase()] ?? null },
      body: (async function* () {
        yield new TextEncoder().encode(
          JSON.stringify({
            type: "error",
            error: { type: "rate_limit_error", message: "Slow down." },
            request_id: "req_1",
          }),
        );
      })(),
    });

    await expect(
      sendOnce(hello, { dialect: labDialect(reports), fetcher: refused }),
    ).rejects.toMatchObject({ code: "rateLimited" });
    expect(reports).toMatchObject([
      {
        status: 429,
        error: { type: "rate_limit_error", message: "Slow down." },
        model: "lab-model",
      },
    ]);
    expect(reports[0]?.headers?.get("retry-after")).toBe("7");
  });

  it("says the lab could not be reached when the connection fails", async () => {
    await expect(
      sendOnce(hello, {
        fetcher: async () => {
          throw new TypeError("fetch failed");
        },
      }),
    ).rejects.toMatchObject({
      code: "networkFailure",
      message: "Could not reach Test Lab. Check the connection and try again.",
    });
  });

  it("reports a request its caller cancelled as cancelled, not as a failed connection", async () => {
    const cancel = new AbortController();
    const sent = sendOnce(
      { ...hello, signal: cancel.signal },
      {
        fetcher: (_url, init) =>
          new Promise((_resolve, reject) => {
            if (init.signal?.aborted) reject(init.signal.reason);
            init.signal?.addEventListener(
              "abort",
              () => reject(init.signal?.reason),
              { once: true },
            );
          }),
      },
    );
    cancel.abort();

    await expect(sent).rejects.toBe(cancel.signal.reason);
  });

  it("gives up on a stream that stops arriving and never closes", async () => {
    const [start] = finished("end_turn");

    await expect(
      sendOnce(hello, {
        stallTimeoutMs: 50,
        fetcher: async () => ({
          ok: true,
          status: 200,
          headers: { get: () => null },
          body: (async function* () {
            yield new TextEncoder().encode(sse([start ?? {}]));
            await new Promise(() => {
              /* Never resolves: the lab went quiet mid-stream. */
            });
          })(),
        }),
      }),
    ).rejects.toMatchObject({ code: "networkFailure" });
  });
});
