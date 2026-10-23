/**
 * OpenRouter is sent a conversation exactly as before reasoning was kept with
 * the model's turns: no reasoning and no replay record go back to it.
 */

import { describe, expect, it } from "vitest";
import type { ModelFetch, ModelMessage } from "../../../model-client.js";
import { OpenRouterModelClient } from "../client.js";

async function bodySent(messages: readonly ModelMessage[]) {
  const bodies: string[] = [];
  const fetcher: ModelFetch = async (_url, init) => {
    bodies.push(init.body);
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      body: (async function* () {
        yield new TextEncoder().encode("data: [DONE]\n\n");
      })(),
    };
  };
  const client = new OpenRouterModelClient({
    apiKey: async () => "key",
    fetcher,
    model: "deepseek/deepseek-v4-pro",
    retry: { wait: async () => {} },
  });
  for await (const event of client.send({ messages })) void event;
  return bodies[0];
}

describe("OpenRouter and the model's kept reasoning", () => {
  it("sends the same request whether or not a turn kept its reasoning and replay record", async () => {
    const turn = {
      role: "assistant" as const,
      content: "",
      toolCalls: [{ id: "call-1", name: "read_file", arguments: "{}" }],
    };
    const result = {
      role: "tool" as const,
      toolCallId: "call-1",
      name: "read_file",
      content: "notes",
    };

    const plain = await bodySent([
      { role: "user", content: "Read it" },
      turn,
      result,
    ]);
    const kept = await bodySent([
      { role: "user", content: "Read it" },
      {
        ...turn,
        reasoning: "Read the notes first.",
        replay: {
          provider: "openrouter",
          format: "chat-completions",
          data: { kept: true },
        },
      },
      result,
    ]);

    expect(kept).toBe(plain);
  });
});
