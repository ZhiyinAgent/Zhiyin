/**
 * How Mistral's answer reads back. From Mistral's reasoning guide and API
 * reference, checked 2026-10-09: while the model thinks, `delta.content` is a
 * list holding a thinking chunk; one list then closes the thinking and starts
 * the answer; after that `content` is plain text. Tool calls arrive in
 * OpenAI's delta form, and usage on the last chunk, with what was read from
 * the cache.
 */

import { describe, expect, it } from "vitest";
import type { ModelEvent } from "../../../model-client.js";
import {
  chunk,
  drain,
  drainUntilFailure,
  mistralClient,
  recording,
  streamOf,
} from "./support.js";

const hello = { messages: [{ role: "user" as const, content: "Hello" }] };

function thinking(text: string) {
  return { type: "thinking", thinking: [{ type: "text", text }] };
}

const words = (events: readonly ModelEvent[]) =>
  events.filter(
    (event) => event.kind === "reasoningDelta" || event.kind === "textDelta",
  );

describe("Mistral's answer", () => {
  it("streams its thinking chunks as reasoning, never as words, then its answer as words", async () => {
    const events = await drain(
      mistralClient({
        fetcher: streamOf([
          chunk({ role: "assistant", content: "" }),
          chunk({ content: [thinking("Seventeen times twenty is 340")] }),
          chunk({ content: [thinking(", and three more is 51.")] }),
          chunk({
            content: [thinking(" So 391."), { type: "text", text: "17 × 23" }],
          }),
          chunk({ content: " = 391." }, "stop", {
            prompt_tokens: 25,
            completion_tokens: 187,
            total_tokens: 212,
          }),
        ]),
      }),
      hello,
    );

    expect(words(events)).toEqual([
      { kind: "reasoningDelta", text: "Seventeen times twenty is 340" },
      { kind: "reasoningDelta", text: ", and three more is 51." },
      { kind: "reasoningDelta", text: " So 391." },
      { kind: "textDelta", text: "17 × 23" },
      { kind: "textDelta", text: " = 391." },
    ]);
    expect(events.at(-1)).toMatchObject({
      kind: "done",
      finishReason: "stop",
      response: { complete: true },
    });
  });

  it("reads a thinking chunk that closes without text, and words given as a text chunk alone", async () => {
    const events = await drain(
      mistralClient({
        fetcher: streamOf([
          chunk({ content: [thinking("Brief.")] }),
          chunk({ content: [{ type: "thinking", thinking: [] }] }),
          chunk({ content: [{ type: "text", text: "Yes." }] }, "stop"),
        ]),
      }),
      hello,
    );

    expect(words(events)).toEqual([
      { kind: "reasoningDelta", text: "Brief." },
      { kind: "textDelta", text: "Yes." },
    ]);
  });

  it("reads a tool call whether its arguments arrive whole or in pieces", async () => {
    const whole = await drain(
      mistralClient({
        fetcher: streamOf([
          chunk(
            {
              content: "",
              tool_calls: [
                {
                  id: "D681PevKs",
                  type: "function",
                  index: 0,
                  function: {
                    name: "read_note",
                    arguments: '{"path": "note.txt"}',
                  },
                },
                {
                  id: "Q2b7Rt9xP",
                  type: "function",
                  index: 1,
                  function: { name: "list_notes", arguments: "{}" },
                },
              ],
            },
            "tool_calls",
          ),
        ]),
      }),
      hello,
    );
    const pieces = await drain(
      mistralClient({
        fetcher: streamOf([
          chunk({
            tool_calls: [
              {
                id: "D681PevKs",
                index: 0,
                function: { name: "read_note", arguments: '{"path": ' },
              },
            ],
          }),
          chunk(
            {
              tool_calls: [
                { index: 0, function: { arguments: '"note.txt"}' } },
              ],
            },
            "tool_calls",
          ),
        ]),
      }),
      hello,
    );

    expect(whole.filter((event) => event.kind === "toolCallDelta")).toEqual([
      {
        kind: "toolCallDelta",
        index: 0,
        callId: "D681PevKs",
        name: "read_note",
        argumentsDelta: '{"path": "note.txt"}',
      },
      {
        kind: "toolCallDelta",
        index: 1,
        callId: "Q2b7Rt9xP",
        name: "list_notes",
        argumentsDelta: "{}",
      },
    ]);
    expect(pieces.filter((event) => event.kind === "toolCallDelta")).toEqual([
      {
        kind: "toolCallDelta",
        index: 0,
        callId: "D681PevKs",
        name: "read_note",
        argumentsDelta: '{"path": ',
      },
      { kind: "toolCallDelta", index: 0, argumentsDelta: '"note.txt"}' },
    ]);
    expect(whole.at(-1)).toMatchObject({
      kind: "done",
      finishReason: "tool_calls",
      response: { complete: true },
    });
  });

  it("reports its usage and what was read from the cache, priced from Mistral's list in US dollars", async () => {
    const events = await drain(
      mistralClient({ fetcher: recording([]) }),
      hello,
    );

    // Large 4 at its regular price: 600k uncached, 400k from the cache, 100k out.
    expect(events.find((event) => event.kind === "usage")).toEqual({
      kind: "usage",
      usage: {
        requestId: "answer-1",
        model: "mistral-large-4",
        inputTokens: 1_000_000,
        outputTokens: 100_000,
        totalTokens: 1_100_000,
        cacheReadTokens: 400_000,
        cacheWriteTokens: 0,
        estimatedCost: {
          amount: expect.closeTo(0.6 * 1.36 + 0.4 * 0.14 + 0.1 * 4.18, 10),
          currency: "USD",
          priceList: "2026-10-09",
        },
      },
    });
  });

  it("is priced from Medium 3.5's own list, cached input included", async () => {
    const events = await drain(
      mistralClient({ model: "mistral-medium-3-5", fetcher: recording([]) }),
      hello,
    );

    const usage = events.find((event) => event.kind === "usage");
    expect(usage?.kind === "usage" && usage.usage.estimatedCost).toEqual({
      amount: expect.closeTo(0.6 * 1.5 + 0.4 * 0.15 + 0.1 * 7.5, 10),
      currency: "USD",
      priceList: "2026-10-09",
    });
  });

  it("is a failure, not a finished answer, when it ends with the finish reason `error`", async () => {
    const { events, error } = await drainUntilFailure(
      mistralClient({
        fetcher: streamOf([
          chunk({ content: "The answer is" }),
          chunk({ content: "" }, "error", {
            prompt_tokens: 10,
            completion_tokens: 3,
            total_tokens: 13,
          }),
        ]),
      }),
      hello,
    );

    expect(error).toMatchObject({
      name: "ModelClientError",
      code: "unexplainedError",
      retryable: true,
    });
    expect(words(events)).toEqual([
      { kind: "textDelta", text: "The answer is" },
    ]);
    expect(events.map((event) => event.kind)).toContain("usage");
    expect(events.map((event) => event.kind)).not.toContain("done");
  });
});
