/**
 * What Qwen is sent, and how its answer reads back. From the documentation of
 * QwenCloud (international) and 千问云 (mainland China), checked 2026-10-09:
 * one host per platform, thinking set per request with `enable_thinking`,
 * and earlier turns' `reasoning_content` read only with `preserve_thinking`.
 */

import { describe, expect, it } from "vitest";
import type { ModelMessage } from "../../../model-client.js";
import { drain, qwenClient, recording, type Sent } from "./support.js";

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

describe("a request to Qwen", () => {
  it("goes to QwenCloud from an international account and to 千问云 from a mainland one, with the key as a bearer token", async () => {
    const urls: Record<string, string | undefined> = {};
    for (const region of ["international", "mainland"] as const) {
      const sent: Sent[] = [];
      await drain(qwenClient({ region, fetcher: recording(sent) }), {
        messages: hello,
      });
      urls[region] = sent[0]?.url;
      expect(sent[0]?.headers["Authorization"]).toBe("Bearer sk-ws-test");
    }

    expect(urls).toEqual({
      international:
        "https://maas.qwencloudapi.com/compatible-mode/v1/chat/completions",
      mainland:
        "https://maas.qianwenaiapi.com/compatible-mode/v1/chat/completions",
    });
  });

  it("streams, asks for usage at the end, limits the whole reply, and keeps earlier reasoning in view", async () => {
    const sent: Sent[] = [];

    await drain(qwenClient({ fetcher: recording(sent) }), {
      messages: hello,
      maximumOutputTokens: 32_000,
      session: "conversation-1",
    });

    expect(sent[0]?.body).toEqual({
      model: "qwen3.8-max",
      stream: true,
      stream_options: { include_usage: true },
      max_completion_tokens: 32_000,
      enable_thinking: true,
      preserve_thinking: true,
      messages: [{ role: "user", content: "Hello" }],
    });
  });

  it("sends every earlier turn back with its reasoning, beside its words and calls", async () => {
    const sent: Sent[] = [];

    await drain(qwenClient({ fetcher: recording(sent) }), {
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
    expect(sent[0]?.body).not.toHaveProperty("tool_choice");
  });

  it("turns thinking off, or sets its effort, as the person chose", async () => {
    const sent: Sent[] = [];
    const client = qwenClient({ fetcher: recording(sent) });

    await drain(client, { messages: hello, reasoning: { enabled: false } });
    await drain(client, {
      messages: hello,
      reasoning: { enabled: true, effort: "medium" },
    });
    await drain(client, { messages: hello, reasoning: { enabled: true } });

    expect(
      sent.map(({ body }) => [
        body["enable_thinking"],
        body["reasoning_effort"],
      ]),
    ).toEqual([
      [false, undefined],
      [true, "medium"],
      [true, undefined],
    ]);
  });

  it("refuses an effort Qwen does not offer before sending anything", async () => {
    const sent: Sent[] = [];

    await expect(
      drain(qwenClient({ fetcher: recording(sent) }), {
        messages: hello,
        reasoning: { enabled: true, effort: "max" },
      }),
    ).rejects.toMatchObject({ code: "unsupportedReasoning" });
    expect(sent).toEqual([]);
  });

  it("sends a picture as a data URL", async () => {
    const sent: Sent[] = [];

    await drain(
      qwenClient({ model: "qwen3.8-flash", fetcher: recording(sent) }),
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

describe("Qwen's answer", () => {
  it("streams its reasoning apart from its words, and reports what was read from its cache", async () => {
    const events = await drain(qwenClient({ fetcher: recording([]) }), {
      messages: hello,
    });

    expect(
      events.filter((event) => event.kind !== "usage" && event.kind !== "done"),
    ).toEqual([
      { kind: "reasoningDelta", text: "Thinking." },
      { kind: "textDelta", text: "Done." },
    ]);
    expect(events.find((event) => event.kind === "usage")).toMatchObject({
      usage: {
        requestId: "chatcmpl-1",
        inputTokens: 1_000_000,
        cacheReadTokens: 400_000,
        outputTokens: 100_000,
        reasoningTokens: 30_000,
      },
    });
  });

  it("is priced from the platform's own list, in its own currency", async () => {
    const usage = async (region: "international" | "mainland") => {
      const events = await drain(
        qwenClient({ region, fetcher: recording([]) }),
        { messages: hello },
      );
      const found = events.find((event) => event.kind === "usage");
      return found?.kind === "usage" ? found.usage.estimatedCost : undefined;
    };

    // Max: 600k uncached, 400k from the cache, 100k out.
    expect(await usage("international")).toEqual({
      amount: expect.closeTo(0.6 * 2 + 0.4 * 0.25 + 0.1 * 6, 10),
      currency: "USD",
      priceList: "2026-10-09",
    });
    expect(await usage("mainland")).toEqual({
      amount: expect.closeTo(0.6 * 12 + 0.4 * 1.5 + 0.1 * 36, 10),
      currency: "CNY",
      priceList: "2026-10-09",
    });
  });
});
