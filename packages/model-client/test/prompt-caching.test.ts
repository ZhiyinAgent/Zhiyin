/**
 * What a request asks the provider to keep, and what it reports it kept.
 *
 * Most providers behind OpenRouter reuse a cached request start on their own;
 * Anthropic and Alibaba's Qwen reuse only what the request marks. OpenRouter's
 * prompt caching guide, checked 2026-09-23.
 */

import { describe, expect, it } from "vitest";
import {
  OpenRouterModelClient,
  type ModelEvent,
  type ModelFetch,
  type ModelMessage,
} from "../src/index.js";

const done = "data: [DONE]\n\n";

function stream(chunks: string[]): Awaited<ReturnType<ModelFetch>> {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    body: (async function* () {
      const encoder = new TextEncoder();
      for (const chunk of chunks) yield encoder.encode(chunk);
    })(),
  };
}

async function sentBody(
  model: string,
  request: Partial<Parameters<OpenRouterModelClient["send"]>[0]>,
  chunks: string[] = [done],
) {
  const bodies: string[] = [];
  const events: ModelEvent[] = [];
  const client = new OpenRouterModelClient({
    retry: { wait: async () => {} },
    apiKey: async () => "key",
    model,
    fetcher: async (_url, init) => {
      bodies.push(init.body);
      return stream(chunks);
    },
  });
  for await (const event of client.send({ messages: conversation, ...request }))
    events.push(event);
  return {
    body: JSON.parse(bodies[0] ?? "{}") as Record<string, unknown>,
    text: bodies[0] ?? "",
    events,
  };
}

const conversation: ModelMessage[] = [
  { role: "system", content: "You are Zhiyin." },
  { role: "user", content: "Read the notes." },
  {
    role: "assistant",
    content: "",
    toolCalls: [{ id: "call-1", name: "read_note", arguments: "{}" }],
  },
  { role: "tool", toolCallId: "call-1", name: "read_note", content: "Notes." },
  { role: "user", content: "Thanks." },
];

describe("prompt caching", () => {
  it("names the conversation, so its requests stay with the provider holding its cache", async () => {
    const { body } = await sentBody("z-ai/glm-5.3-flash", {
      session: "task-1",
    });

    expect(body["session_id"]).toBe("task-1");
  });

  it.each(["anthropic/claude-sonnet-5", "qwen/qwen3-max"])(
    "marks where the next request will repeat this one for %s, which caches only what is marked",
    async (model) => {
      const { body, text } = await sentBody(model, { cacheAfter: [0, 3, 4] });

      const messages = body["messages"] as Record<string, unknown>[];
      const marked = { type: "ephemeral" };
      expect(messages[0]?.["content"]).toEqual([
        { type: "text", text: "You are Zhiyin.", cache_control: marked },
      ]);
      expect(messages[3]?.["content"]).toEqual([
        { type: "text", text: "Notes.", cache_control: marked },
      ]);
      expect(messages[4]?.["content"]).toEqual([
        { type: "text", text: "Thanks.", cache_control: marked },
      ]);
      expect(messages[1]?.["content"]).toBe("Read the notes.");
      expect(text.match(/cache_control/g)).toHaveLength(3);
    },
  );

  it("marks the last part of a message that carries a picture", async () => {
    const { body } = await sentBody("anthropic/claude-sonnet-5", {
      messages: [
        {
          role: "user",
          content: [
            { kind: "text", text: "The picture:" },
            { kind: "image", mediaType: "image/png", data: "AAAA" },
          ],
        },
      ],
      cacheAfter: [0],
    });

    const content = (body["messages"] as Record<string, unknown>[])[0]?.[
      "content"
    ] as Record<string, unknown>[];
    expect(content[0]).not.toHaveProperty("cache_control");
    expect(content[1]).toMatchObject({
      type: "image_url",
      cache_control: { type: "ephemeral" },
    });
  });

  it.each(["z-ai/glm-5.3-flash", "openai/gpt-5.5", "deepseek/deepseek-v4"])(
    "sends no marks to %s, which caches on its own",
    async (model) => {
      const { text } = await sentBody(model, {
        cacheAfter: [0, 3, 4],
        session: "task-1",
      });

      expect(text).not.toContain("cache_control");
    },
  );

  it("reports how much of the request was read from and written to the cache", async () => {
    const { events } = await sentBody("anthropic/claude-sonnet-5", {}, [
      'data: {"id":"gen-1","model":"anthropic/claude-sonnet-5","choices":[{"delta":{"content":"Hi"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1000,"completion_tokens":3,"total_tokens":1003,"prompt_tokens_details":{"cached_tokens":900,"cache_write_tokens":100}}}\n\n',
      done,
    ]);

    expect(events).toContainEqual({
      kind: "usage",
      usage: expect.objectContaining({
        inputTokens: 1000,
        cacheReadTokens: 900,
        cacheWriteTokens: 100,
      }) as unknown,
    });
  });
});
