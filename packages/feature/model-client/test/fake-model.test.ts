/**
 * What the packages above the model client rely on its fake to answer, held
 * to the real client: the same expectations run against both (ADR 0002).
 */

import { describe, expect, it } from "vitest";
import { ProviderModelClient } from "../src/client.js";
import type { ModelClient, ModelEvent, ModelRequest } from "../src/index.js";
import { fakeModel } from "./fakes.js";
import { testProvider } from "./test-provider.js";

const answer: readonly ModelEvent[] = [
  { kind: "textDelta", text: "Hello" },
  {
    kind: "toolCallDelta",
    index: 0,
    callId: "call-1",
    name: "read_file",
    argumentsDelta: '{"path":"notes.txt"}',
  },
  { kind: "done", finishReason: "tool_calls" },
];

type Answer =
  readonly ModelEvent[] | ((request: ModelRequest) => readonly ModelEvent[]);

const clients: readonly [string, (events: Answer) => ModelClient][] = [
  [
    "the real client",
    (events) =>
      new ProviderModelClient(
        testProvider([], {
          send: async function* ({ request }) {
            const answer =
              typeof events === "function" ? events(request) : events;
            for (const event of answer) yield event;
          },
        }),
        { apiKey: async () => "key", model: "model-1" },
      ),
  ],
  ["the fake", fakeModel],
];

async function received(
  client: ModelClient,
  said = "Hi",
): Promise<ModelEvent[]> {
  const events: ModelEvent[] = [];
  for await (const event of client.send({
    messages: [{ role: "user", content: said }],
  }))
    events.push(event);
  return events;
}

describe.each(clients)("%s", (_, make) => {
  it("streams the model's answer to each request, in order, ending with done", async () => {
    const client = make(answer);

    expect(await received(client)).toEqual(answer);
    expect(await received(client)).toEqual(answer);
  });

  it("answers each request with what the answer given for that request is", async () => {
    const client = make((request) => {
      const last = request.messages.at(-1);
      const text = last?.role === "user" ? String(last.content) : "";
      return [
        { kind: "textDelta", text: `You said ${text}` },
        { kind: "done" },
      ];
    });

    expect(await received(client, "one")).toEqual([
      { kind: "textDelta", text: "You said one" },
      { kind: "done" },
    ]);
    expect(await received(client, "two")).toEqual([
      { kind: "textDelta", text: "You said two" },
      { kind: "done" },
    ]);
  });
});
