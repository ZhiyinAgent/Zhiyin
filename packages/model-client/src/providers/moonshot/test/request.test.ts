/**
 * What Moonshot's Kimi API is sent, and how its answer reads back. From the
 * Kimi API documentation, checked 2026-10-09: a host per platform, K3 always
 * reasoning at the effort named by `reasoning_effort`, K2.6 switched by
 * `thinking`, K2.7 Code always thinking with no control, and every earlier
 * turn sent back whole, its `reasoning_content` included.
 */

import { describe, expect, it } from "vitest";
import type { ModelMessage } from "../../../model-client.js";
import {
  answering,
  drain,
  moonshotClient,
  recording,
  type Sent,
} from "./support.js";

const tool = {
  name: "read_note",
  description: "Reads the note.",
  inputSchema: { type: "object" },
};

const hello = [{ role: "user" as const, content: "Hello" }];

const conversation: ModelMessage[] = [
  { role: "user", content: "What does the note say?" },
  {
    role: "assistant",
    content: "",
    reasoning: "Read the note first.",
    toolCalls: [{ id: "read_note:0", name: "read_note", arguments: "{}" }],
  },
  {
    role: "tool",
    content: "Buy milk.",
    toolCallId: "read_note:0",
    name: "read_note",
  },
  {
    role: "assistant",
    content: "It says to buy milk.",
    reasoning: "The note answers it.",
  },
  { role: "user", content: "Anything else?" },
];

describe("a request to Moonshot", () => {
  it("goes to the host of the platform the key belongs to, with the key as a bearer token", async () => {
    const sent: Sent[] = [];

    await drain(
      moonshotClient({ region: "international", fetcher: recording(sent) }),
      { messages: hello },
    );
    await drain(
      moonshotClient({ region: "mainland", fetcher: recording(sent) }),
      { messages: hello },
    );

    expect(sent.map(({ url }) => url)).toEqual([
      "https://api.moonshot.ai/v1/chat/completions",
      "https://api.moonshot.cn/v1/chat/completions",
    ]);
    expect(sent.map(({ headers }) => headers["Authorization"])).toEqual([
      "Bearer sk-test",
      "Bearer sk-test",
    ]);
  });

  it("streams, asks for usage at the end, names the reply's limit, and keys its cache to the conversation", async () => {
    const sent: Sent[] = [];

    await drain(moonshotClient({ fetcher: recording(sent) }), {
      messages: hello,
      maximumOutputTokens: 32_000,
      session: "conversation-1",
    });

    expect(sent[0]?.body).toEqual({
      model: "kimi-k3",
      stream: true,
      stream_options: { include_usage: true },
      max_completion_tokens: 32_000,
      prompt_cache_key: "conversation-1",
      messages: [{ role: "user", content: "Hello" }],
    });
  });

  it("asks for the model's longest reply, and keys no cache, when the request names neither", async () => {
    const sent: Sent[] = [];

    await drain(moonshotClient({ fetcher: recording(sent) }), {
      messages: hello,
    });

    // Kimi K3's limit; Kimi lowers it to fit what is left of the context.
    expect(sent[0]?.body).toMatchObject({ max_completion_tokens: 1_048_576 });
    expect(sent[0]?.body).not.toHaveProperty("max_tokens");
    expect(sent[0]?.body).not.toHaveProperty("prompt_cache_key");
  });

  it("sends every earlier turn back whole, its reasoning beside its words and calls", async () => {
    const sent: Sent[] = [];

    await drain(moonshotClient({ fetcher: recording(sent) }), {
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
            id: "read_note:0",
            type: "function",
            function: { name: "read_note", arguments: "{}" },
          },
        ],
      },
      {
        role: "tool",
        content: "Buy milk.",
        tool_call_id: "read_note:0",
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

  it("sends a turn kept without reasoning, such as one another provider wrote, with its words alone", async () => {
    const sent: Sent[] = [];

    await drain(moonshotClient({ fetcher: recording(sent) }), {
      messages: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi." },
        { role: "user", content: "Again?" },
      ],
    });

    expect(sent[0]?.body["messages"]).toEqual([
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi." },
      { role: "user", content: "Again?" },
    ]);
  });

  it("sets K3's reasoning effort as the person chose, and never sends a thinking switch to K3", async () => {
    const sent: Sent[] = [];
    const client = moonshotClient({ fetcher: recording(sent) });

    await drain(client, {
      messages: hello,
      reasoning: { enabled: true, effort: "low" },
    });
    await drain(client, { messages: hello, reasoning: { enabled: true } });
    await drain(client, { messages: hello });

    expect(
      sent.map(({ body }) => [body["reasoning_effort"], body["thinking"]]),
    ).toEqual([
      ["low", undefined],
      [undefined, undefined],
      [undefined, undefined],
    ]);
  });

  it("refuses to turn K3's reasoning off, or to ask it for an effort it does not offer, before sending anything", async () => {
    const sent: Sent[] = [];
    const client = moonshotClient({ fetcher: recording(sent) });

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

  it("switches K2.6's thinking off or on as the person chose, with no effort", async () => {
    const sent: Sent[] = [];
    const client = moonshotClient({
      model: "kimi-k2.6",
      fetcher: recording(sent),
    });

    await drain(client, { messages: hello, reasoning: { enabled: false } });
    await drain(client, { messages: hello, reasoning: { enabled: true } });
    await drain(client, { messages: hello });

    expect(
      sent.map(({ body }) => [body["thinking"], body["reasoning_effort"]]),
    ).toEqual([
      [{ type: "disabled" }, undefined],
      [{ type: "enabled" }, undefined],
      [undefined, undefined],
    ]);
  });

  it("sends K2.7 Code no reasoning control, and refuses to turn its thinking off", async () => {
    const sent: Sent[] = [];
    const client = moonshotClient({
      model: "kimi-k2.7-code",
      fetcher: recording(sent),
    });

    await drain(client, { messages: hello, reasoning: { enabled: true } });
    await expect(
      drain(client, { messages: hello, reasoning: { enabled: false } }),
    ).rejects.toMatchObject({ code: "unsupportedReasoning" });

    expect(sent).toHaveLength(1);
    expect(sent[0]?.body).not.toHaveProperty("thinking");
    expect(sent[0]?.body).not.toHaveProperty("reasoning_effort");
  });

  it("sends a picture as a data URL in an image part of the person's message", async () => {
    const sent: Sent[] = [];

    await drain(moonshotClient({ fetcher: recording(sent) }), {
      messages: [
        {
          role: "user",
          content: [
            { kind: "text", text: "What is this?" },
            { kind: "image", mediaType: "image/png", data: "AAAA" },
          ],
        },
      ],
    });

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

describe("Moonshot's answer", () => {
  it("streams its reasoning apart from its words, and reads the usage once, with what the cache served and stored", async () => {
    const events = await drain(moonshotClient({ fetcher: recording([]) }), {
      messages: hello,
    });

    expect(
      events.flatMap((event) =>
        event.kind === "reasoningDelta"
          ? [["reasoning", event.text]]
          : event.kind === "textDelta" && event.text
            ? [["words", event.text]]
            : [],
      ),
    ).toEqual([
      ["reasoning", "Thinking."],
      ["words", "Done."],
    ]);
    const usages = events.filter((event) => event.kind === "usage");
    expect(usages).toHaveLength(1);
    expect(usages[0]).toMatchObject({
      usage: {
        requestId: "answer-1",
        inputTokens: 1_000_000,
        cacheReadTokens: 400_000,
        cacheWriteTokens: 100_000,
        outputTokens: 100_000,
      },
    });
    expect(events.at(-1)).toMatchObject({
      kind: "done",
      finishReason: "stop",
      response: { complete: true },
    });
  });

  it("is priced from Moonshot's list in the platform's own currency, cache reads and writes each at their own price", async () => {
    const cost = async (region: "international" | "mainland") => {
      const events = await drain(
        moonshotClient({ region, fetcher: recording([]) }),
        { messages: hello },
      );
      const found = events.find((event) => event.kind === "usage");
      return found?.kind === "usage" ? found.usage.estimatedCost : undefined;
    };

    // K3: of 1M in, 400k read from the cache and 100k written to it, so 500k
    // uncached; 100k out.
    expect(await cost("international")).toEqual({
      amount: expect.closeTo(0.5 * 3 + 0.4 * 0.3 + 0.1 * 3 + 0.1 * 15, 10),
      currency: "USD",
      priceList: "2026-10-09",
    });
    expect(await cost("mainland")).toEqual({
      amount: expect.closeTo(0.5 * 20 + 0.4 * 2 + 0.1 * 20 + 0.1 * 100, 10),
      currency: "CNY",
      priceList: "2026-10-09",
    });
  });

  it("prices a K2 model, which writes nothing to the cache, from its own row of the list", async () => {
    const events = await drain(
      moonshotClient({
        model: "kimi-k2.6",
        region: "mainland",
        fetcher: recording(
          [],
          answering(
            {
              prompt: 1_000_000,
              cached: 400_000,
              written: 0,
              completion: 100_000,
            },
            "kimi-k2.6",
          ),
        ),
      }),
      { messages: hello },
    );

    expect(events.find((event) => event.kind === "usage")).toMatchObject({
      usage: {
        estimatedCost: {
          amount: expect.closeTo(0.6 * 6.5 + 0.4 * 1.1 + 0.1 * 27, 10),
          currency: "CNY",
        },
      },
    });
  });
});
