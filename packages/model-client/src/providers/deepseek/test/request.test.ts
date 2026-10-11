/**
 * What DeepSeek is sent, and how its answer reads back. From DeepSeek's API
 * documentation, checked 2026-10-09: one host for every account, thinking on
 * unless turned off, and with tools in a request, every earlier turn's
 * `reasoning_content` sent back or the request is refused.
 */

import { describe, expect, it } from "vitest";
import type { ModelMessage } from "../../../model-client.js";
import { deepSeekClient, drain, recording, type Sent } from "./support.js";

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

describe("a request to DeepSeek", () => {
  it("goes to DeepSeek's one host from either platform, with the key as a bearer token", async () => {
    for (const region of ["international", "mainland"] as const) {
      const sent: Sent[] = [];
      await drain(deepSeekClient({ region, fetcher: recording(sent) }), {
        messages: [{ role: "user", content: "Hello" }],
      });

      expect(sent[0]?.url).toBe("https://api.deepseek.com/chat/completions");
      expect(sent[0]?.headers["Authorization"]).toBe("Bearer sk-test");
    }
  });

  it("streams, asks for usage at the end, and names the model and the reply's limit", async () => {
    const sent: Sent[] = [];

    await drain(deepSeekClient({ fetcher: recording(sent) }), {
      messages: [{ role: "user", content: "Hello" }],
      maximumOutputTokens: 32_000,
      session: "conversation-1",
    });

    expect(sent[0]?.body).toEqual({
      model: "deepseek-v4-pro",
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: 32_000,
      messages: [{ role: "user", content: "Hello" }],
    });
  });

  it("sends every earlier turn back with its reasoning, beside its words and calls", async () => {
    const sent: Sent[] = [];

    await drain(deepSeekClient({ fetcher: recording(sent) }), {
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

  it("sends a turn kept without reasoning back with an empty one, which DeepSeek accepts", async () => {
    // Checked live 2026-10-09: without the field, DeepSeek refuses a tool
    // conversation in thinking mode; with it empty, it answers.
    const sent: Sent[] = [];

    await drain(deepSeekClient({ fetcher: recording(sent) }), {
      messages: [
        { role: "user", content: "What does the note say?" },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "call-1", name: "read_note", arguments: "{}" }],
        },
        {
          role: "tool",
          content: "Buy milk.",
          toolCallId: "call-1",
          name: "read_note",
        },
      ],
      tools: [tool],
    });

    expect(sent[0]?.body["messages"]).toContainEqual({
      role: "assistant",
      content: "",
      reasoning_content: "",
      tool_calls: [
        {
          id: "call-1",
          type: "function",
          function: { name: "read_note", arguments: "{}" },
        },
      ],
    });
  });

  it("turns thinking off, or sets its effort, as the person chose", async () => {
    const sent: Sent[] = [];
    const client = deepSeekClient({ fetcher: recording(sent) });
    const hello = [{ role: "user" as const, content: "Hello" }];

    await drain(client, { messages: hello, reasoning: { enabled: false } });
    await drain(client, {
      messages: hello,
      reasoning: { enabled: true, effort: "max" },
    });
    await drain(client, { messages: hello, reasoning: { enabled: true } });

    expect(
      sent.map(({ body }) => [body["thinking"], body["reasoning_effort"]]),
    ).toEqual([
      [{ type: "disabled" }, undefined],
      [{ type: "enabled" }, "max"],
      [{ type: "enabled" }, undefined],
    ]);
  });

  it("refuses an effort DeepSeek does not offer before sending anything", async () => {
    const sent: Sent[] = [];

    await expect(
      drain(deepSeekClient({ fetcher: recording(sent) }), {
        messages: [{ role: "user", content: "Hello" }],
        reasoning: { enabled: true, effort: "medium" },
      }),
    ).rejects.toMatchObject({ code: "unsupportedReasoning" });
    expect(sent).toEqual([]);
  });

  it("sends a picture to the model that reads them, as a data URL", async () => {
    const sent: Sent[] = [];

    await drain(
      deepSeekClient({ model: "deepseek-flash", fetcher: recording(sent) }),
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

describe("DeepSeek's answer", () => {
  it("streams its reasoning apart from its words, and reports what was read from its cache", async () => {
    const events = await drain(deepSeekClient({ fetcher: recording([]) }), {
      messages: [{ role: "user", content: "Hello" }],
    });

    expect(
      events.filter((event) => event.kind !== "usage" && event.kind !== "done"),
    ).toEqual([
      { kind: "reasoningDelta", text: "Thinking." },
      { kind: "textDelta", text: "Done." },
    ]);
    expect(events.find((event) => event.kind === "usage")).toMatchObject({
      usage: {
        requestId: "answer-1",
        inputTokens: 1_000_000,
        cacheReadTokens: 400_000,
        outputTokens: 100_000,
        reasoningTokens: 30_000,
      },
    });
  });

  it("is priced from DeepSeek's list in the platform's own currency, at peak rates in its busy hours", async () => {
    const usage = async (region: "international" | "mainland", at: string) => {
      const events = await drain(
        deepSeekClient({ region, at, fetcher: recording([]) }),
        { messages: [{ role: "user", content: "Hello" }] },
      );
      const found = events.find((event) => event.kind === "usage");
      return found?.kind === "usage" ? found.usage.estimatedCost : undefined;
    };

    // Pro: 600k uncached, 400k from the cache, 100k out. Peak is 01:00-04:00
    // and 06:00-10:00 UTC on weekdays; 2026-10-08 is a Thursday.
    expect(await usage("international", "2026-10-08T12:00:00Z")).toEqual({
      amount: expect.closeTo(0.6 * 0.66 + 0.4 * 0.022 + 0.1 * 1.98, 10),
      currency: "USD",
      priceList: "2026-10-09",
    });
    expect(await usage("international", "2026-10-08T07:00:00Z")).toMatchObject({
      amount: expect.closeTo(0.6 * 1.32 + 0.4 * 0.044 + 0.1 * 3.96, 10),
    });
    expect(await usage("mainland", "2026-10-08T12:00:00Z")).toEqual({
      amount: expect.closeTo(0.6 * 4.5 + 0.4 * 0.15 + 0.1 * 13.5, 10),
      currency: "CNY",
      priceList: "2026-10-09",
    });
  });
});
