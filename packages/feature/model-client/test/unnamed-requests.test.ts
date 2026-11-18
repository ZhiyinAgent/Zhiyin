/**
 * A request the provider gave no id is still a request of its own: usage is
 * counted by request, so two left unnamed must not be taken for one.
 */

import { describe, expect, it } from "vitest";
import { ModelClientError } from "../src/failures.js";
import type { ModelEvent, ModelFetch } from "../src/model-client.js";
import { sendChatCompletions } from "../src/wires/chat-completions/send.js";
import { sendResponses } from "../src/wires/responses/send.js";
import {
  answering,
  finished,
  labDialect,
} from "./anthropic-messages-support.js";
import { sendAnthropicMessages } from "../src/wires/anthropic-messages/send.js";

const encoder = new TextEncoder();

function streaming(text: string): ModelFetch {
  return async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    body: (async function* () {
      yield encoder.encode(text);
    })(),
  });
}

const refuse = () => new ModelClientError("refused", "Not expected here.");

const input = (fetcher: ModelFetch, endpoint: string) => ({
  endpoint,
  apiKey: "key",
  chosen: { model: "lab-model", providers: [] },
  request: { messages: [{ role: "user" as const, content: "Hello" }] },
  fetcher,
  stallTimeoutMs: 60_000,
});

async function requestIds(events: AsyncIterable<ModelEvent>) {
  const ids: string[] = [];
  for await (const event of events)
    if (event.kind === "usage") ids.push(event.usage.requestId);
  return ids;
}

/** A chat completion whose chunks carry no id. */
const chatWithoutId = () =>
  streaming(
    [
      { choices: [{ index: 0, delta: { content: "Hi" } }] },
      { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
      {
        choices: [],
        usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
      },
    ]
      .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
      .join("") + "data: [DONE]\n\n",
  );

/** A response whose events carry no id. */
const responseWithoutId = () =>
  streaming(
    [
      {
        type: "response.created",
        response: { model: "lab-model", status: "in_progress" },
      },
      {
        type: "response.completed",
        response: {
          model: "lab-model",
          status: "completed",
          output: [],
          usage: { input_tokens: 5, output_tokens: 1, total_tokens: 6 },
        },
      },
    ]
      .map(
        (event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
      )
      .join(""),
  );

/** A message whose start carries no id. */
const messageWithoutId = () => {
  const [start, ...rest] = finished("end_turn");
  const message = Object.fromEntries(
    Object.entries((start as { message: object }).message).filter(
      ([field]) => field !== "id",
    ),
  );
  return answering([{ ...start, message }, ...rest]);
};

describe("a request the provider gave no id", () => {
  it("is counted on its own over Chat Completions", async () => {
    const dialect = {
      name: "Test Lab",
      headers: () => ({}),
      classify: refuse,
      body: () => ({}),
    };
    const first = await requestIds(
      sendChatCompletions(dialect, input(chatWithoutId(), "https://lab.test")),
    );
    const second = await requestIds(
      sendChatCompletions(dialect, input(chatWithoutId(), "https://lab.test")),
    );

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(first[0]).not.toBe(second[0]);
  });

  it("is counted on its own over Responses", async () => {
    const dialect = {
      name: "Test Lab",
      provider: "lab",
      headers: () => ({}),
      classify: refuse,
      body: () => ({}),
    };
    const first = await requestIds(
      sendResponses(dialect, input(responseWithoutId(), "https://lab.test")),
    );
    const second = await requestIds(
      sendResponses(dialect, input(responseWithoutId(), "https://lab.test")),
    );

    expect(first).toHaveLength(1);
    expect(first[0]).not.toBe(second[0]);
  });

  it("is counted on its own over Anthropic Messages", async () => {
    const first = await requestIds(
      sendAnthropicMessages(
        labDialect(),
        input(messageWithoutId(), "https://lab.test"),
      ),
    );
    const second = await requestIds(
      sendAnthropicMessages(
        labDialect(),
        input(messageWithoutId(), "https://lab.test"),
      ),
    );

    expect(first).toHaveLength(1);
    expect(first[0]).not.toBe(second[0]);
  });
});
