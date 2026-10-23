/**
 * What Z.ai is sent, and how its answer reads back. From Z.ai's and BigModel's
 * API documentation, checked 2026-10-09: each platform its own host, thinking
 * always on for the GLM-5.3 models, every earlier turn's `reasoning_content`
 * sent back and kept in the context with `clear_thinking: false`, tool
 * arguments streamed with `tool_stream`, and usage on the last chunk.
 */

import { describe, expect, it } from "vitest";
import type { ModelMessage } from "../../../model-client.js";
import { drain, recording, zaiClient, type Sent } from "./support.js";

const tool = {
  name: "read_note",
  description: "Reads the note.",
  inputSchema: { type: "object" },
};

const conversation: ModelMessage[] = [
  { role: "user", content: "What does the note say?" },
  {
    role: "assistant",
    content: "",
    reasoning: "Read the note first.",
    toolCalls: [{ id: "call-1", name: "read_note", arguments: "{}" }],
  },
  {
    role: "tool",
    content: "Buy milk.",
    toolCallId: "call-1",
    name: "read_note",
  },
  {
    role: "assistant",
    content: "It says to buy milk.",
    reasoning: "The note answers it.",
  },
  { role: "user", content: "Anything else?" },
];

const hello = [{ role: "user" as const, content: "Hello" }];

describe("a request to Z.ai", () => {
  it("goes to the chosen platform's own host, with the key as a bearer token", async () => {
    const hosts: Record<string, string | undefined> = {};
    for (const region of ["international", "mainland"] as const) {
      const sent: Sent[] = [];
      await drain(zaiClient({ region, fetcher: recording(sent) }), {
        messages: hello,
      });
      hosts[region] = sent[0]?.url;
      expect(sent[0]?.headers["Authorization"]).toBe("Bearer zai-test-key");
    }

    expect(hosts).toEqual({
      international: "https://api.z.ai/api/paas/v4/chat/completions",
      mainland: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    });
  });

  it("streams, keeps earlier reasoning in the model's context, and names the model and the reply's limit", async () => {
    const sent: Sent[] = [];

    await drain(zaiClient({ fetcher: recording(sent) }), {
      messages: hello,
      maximumOutputTokens: 32_000,
      session: "conversation-1",
    });

    expect(sent[0]?.body).toEqual({
      model: "glm-5.3",
      stream: true,
      max_tokens: 32_000,
      thinking: { type: "enabled", clear_thinking: false },
      messages: [{ role: "user", content: "Hello" }],
    });
  });

  it("sends every earlier turn back with its reasoning, and asks for tool arguments as they are written", async () => {
    const sent: Sent[] = [];

    await drain(zaiClient({ fetcher: recording(sent) }), {
      messages: conversation,
      tools: [tool],
    });

    expect(sent[0]?.body["messages"]).toEqual([
      { role: "user", content: "What does the note say?" },
      {
        role: "assistant",
        content: "",
        reasoning_content: "Read the note first.",
        tool_calls: [
          {
            id: "call-1",
            type: "function",
            function: { name: "read_note", arguments: "{}" },
          },
        ],
      },
      {
        role: "tool",
        content: "Buy milk.",
        tool_call_id: "call-1",
        name: "read_note",
      },
      {
        role: "assistant",
        content: "It says to buy milk.",
        reasoning_content: "The note answers it.",
      },
      { role: "user", content: "Anything else?" },
    ]);
    expect(sent[0]?.body["tools"]).toEqual([
      {
        type: "function",
        function: {
          name: "read_note",
          description: "Reads the note.",
          parameters: { type: "object" },
        },
      },
    ]);
    expect(sent[0]?.body["tool_stream"]).toBe(true);
    expect(sent[0]?.body).not.toHaveProperty("tool_choice");
  });

  it("sets the reasoning effort the person chose, and leaves Z.ai's default otherwise", async () => {
    const sent: Sent[] = [];
    const client = zaiClient({ fetcher: recording(sent) });

    await drain(client, {
      messages: hello,
      reasoning: { enabled: true, effort: "low" },
    });
    await drain(client, {
      messages: hello,
      reasoning: { enabled: true, effort: "max" },
    });
    await drain(client, { messages: hello, reasoning: { enabled: true } });

    expect(
      sent.map(({ body }) => [body["thinking"], body["reasoning_effort"]]),
    ).toEqual([
      [{ type: "enabled", clear_thinking: false }, "low"],
      [{ type: "enabled", clear_thinking: false }, "max"],
      [{ type: "enabled", clear_thinking: false }, undefined],
    ]);
  });

  it("refuses to turn thinking off, or an effort Z.ai does not offer, before sending anything", async () => {
    const sent: Sent[] = [];
    const client = zaiClient({ fetcher: recording(sent) });

    await expect(
      drain(client, { messages: hello, reasoning: { enabled: false } }),
    ).rejects.toMatchObject({ code: "unsupportedReasoning" });
    await expect(
      drain(client, {
        messages: hello,
        reasoning: { enabled: true, effort: "medium" },
      }),
    ).rejects.toMatchObject({ code: "unsupportedReasoning" });
    expect(sent).toEqual([]);
  });

  it("sends a picture to a model that reads them, as a data URL", async () => {
    const sent: Sent[] = [];

    await drain(
      zaiClient({ model: "glm-5.3-flash", fetcher: recording(sent) }),
      {
        messages: [
          {
            role: "user",
            content: [
              { kind: "text", text: "What is this?" },
              { kind: "image", mediaType: "image/png", data: "AAAA" },
            ],
          },
        ],
      },
    );

    expect(sent[0]?.body["messages"]).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "What is this?" },
          {
            type: "image_url",
            image_url: { url: "data:image/png;base64,AAAA" },
          },
        ],
      },
    ]);
  });
});

describe("Z.ai's answer", () => {
  it("streams its reasoning apart from its words, and reports the usage on its last chunk", async () => {
    const events = await drain(zaiClient({ fetcher: recording([]) }), {
      messages: hello,
    });

    const streamed = (kind: "reasoningDelta" | "textDelta") =>
      events
        .flatMap((event) => (event.kind === kind ? [event.text] : []))
        .join("");
    expect(streamed("reasoningDelta")).toBe("Thinking.");
    expect(streamed("textDelta")).toBe("Done.");
    expect(events.find((event) => event.kind === "usage")).toMatchObject({
      usage: {
        requestId: "answer-1",
        inputTokens: 1_000_000,
        cacheReadTokens: 400_000,
        outputTokens: 100_000,
      },
    });
    expect(events.at(-1)).toMatchObject({
      kind: "done",
      finishReason: "stop",
      response: { complete: true },
    });
  });

  it("is priced from the platform's own list, in its own currency", async () => {
    const estimate = async (region: "international" | "mainland") => {
      const events = await drain(
        zaiClient({ region, fetcher: recording([]) }),
        { messages: hello },
      );
      const found = events.find((event) => event.kind === "usage");
      return found?.kind === "usage" ? found.usage.estimatedCost : undefined;
    };

    // GLM-5.3: 600k uncached, 400k from the cache, 100k out.
    expect(await estimate("international")).toEqual({
      amount: expect.closeTo(0.6 * 1.4 + 0.4 * 0.26 + 0.1 * 4.4, 10),
      currency: "USD",
      priceList: "2026-10-09",
    });
    expect(await estimate("mainland")).toEqual({
      amount: expect.closeTo(0.6 * 8 + 0.4 * 2 + 0.1 * 28, 10),
      currency: "CNY",
      priceList: "2026-10-09",
    });
  });
});
