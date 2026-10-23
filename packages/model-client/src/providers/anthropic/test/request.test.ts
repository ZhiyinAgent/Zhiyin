/**
 * What Anthropic is sent, and how its answer reads back. From Anthropic's API
 * documentation, checked 2026-10-09: one endpoint, the key as a bearer token
 * with the API version beside it, `max_tokens` on every request, adaptive
 * thinking with its summary shown, `output_config.effort`, thinking turned
 * off only where a model allows it, and no forced tool choice.
 */

import { describe, expect, it } from "vitest";
import type { ModelEvent, ModelMessage } from "../../../model-client.js";
import {
  answer,
  anthropicClient,
  drain,
  recording,
  streamOf,
  type Sent,
} from "./support.js";

const hello: ModelMessage[] = [{ role: "user", content: "Hello" }];

describe("a request to Anthropic", () => {
  it("goes to the Messages endpoint with the key as a bearer token and the API version", async () => {
    const sent: Sent[] = [];

    await drain(anthropicClient({ fetcher: recording(sent) }), {
      messages: hello,
    });

    expect(sent[0]?.url).toBe("https://api.anthropic.com/v1/messages");
    expect(sent[0]?.headers).toEqual({
      Authorization: "Bearer sk-ant-test",
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    });
  });

  it("names the model, streams, asks for its longest reply unless the request names one, and shows its thinking", async () => {
    const sent: Sent[] = [];
    const client = anthropicClient({ fetcher: recording(sent) });

    await drain(client, { messages: hello });
    await drain(client, { messages: hello, maximumOutputTokens: 4_000 });

    expect(sent[0]?.body).toEqual({
      model: "claude-opus-5-5",
      max_tokens: 128_000,
      thinking: { type: "adaptive", display: "summarized" },
      stream: true,
      messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
    });
    expect(sent[1]?.body["max_tokens"]).toBe(4_000);
  });

  it("offers tools and never forces one, which the current models refuse", async () => {
    const sent: Sent[] = [];

    await drain(anthropicClient({ fetcher: recording(sent) }), {
      messages: hello,
      tools: [
        {
          name: "read_note",
          description: "Reads the note.",
          inputSchema: { type: "object" },
        },
      ],
    });

    expect(sent[0]?.body["tools"]).toEqual([
      {
        name: "read_note",
        description: "Reads the note.",
        input_schema: { type: "object" },
      },
    ]);
    expect(sent[0]?.body).not.toHaveProperty("tool_choice");
  });

  it("sets the effort the person chose", async () => {
    const sent: Sent[] = [];

    await drain(anthropicClient({ fetcher: recording(sent) }), {
      messages: hello,
      reasoning: { enabled: true, effort: "xhigh" },
    });

    expect(sent[0]?.body).toMatchObject({
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: "xhigh" },
    });
  });

  it("turns thinking off the way each model allows: disabled on Haiku 5.5, no up-front thinking on Sonnet 5.5", async () => {
    const sent: Sent[] = [];

    for (const model of ["claude-haiku-5-5", "claude-sonnet-5-5"])
      await drain(anthropicClient({ model, fetcher: recording(sent) }), {
        messages: hello,
        reasoning: { enabled: false },
      });

    expect(sent.map(({ body }) => body["thinking"])).toEqual([
      { type: "disabled" },
      { type: "between_tools" },
    ]);
    expect(sent.map(({ body }) => body["output_config"])).toEqual([
      undefined,
      undefined,
    ]);
  });

  it.each(["claude-opus-5-5", "claude-fable-5-1"])(
    "refuses to turn thinking off on %s, where it is always on, before sending anything",
    async (model) => {
      const sent: Sent[] = [];

      await expect(
        drain(anthropicClient({ model, fetcher: recording(sent) }), {
          messages: hello,
          reasoning: { enabled: false },
        }),
      ).rejects.toMatchObject({ code: "unsupportedReasoning" });
      expect(sent).toEqual([]);
    },
  );

  it("refuses an effort Claude does not offer before sending anything", async () => {
    const sent: Sent[] = [];

    await expect(
      drain(anthropicClient({ fetcher: recording(sent) }), {
        messages: hello,
        reasoning: { enabled: true, effort: "minimal" },
      }),
    ).rejects.toMatchObject({ code: "unsupportedReasoning" });
    expect(sent).toEqual([]);
  });

  it("refuses a model not on Zhiyin's list before sending anything, having no longest reply to ask for", async () => {
    const sent: Sent[] = [];

    await expect(
      drain(
        anthropicClient({
          model: "claude-unknown-1",
          fetcher: recording(sent),
        }),
        { messages: hello },
      ),
    ).rejects.toMatchObject({ code: "modelUnavailable", retryable: false });
    expect(sent).toEqual([]);
  });

  it("marks where the next request will repeat this one, for the five minutes Anthropic keeps a cached start by default", async () => {
    const sent: Sent[] = [];

    await drain(anthropicClient({ fetcher: recording(sent) }), {
      messages: [{ role: "system", content: "You are Zhiyin." }, ...hello],
      cacheAfter: [0, 1],
    });

    expect(sent[0]?.body).toMatchObject({
      system: [
        {
          type: "text",
          text: "You are Zhiyin.",
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Hello",
              cache_control: { type: "ephemeral" },
            },
          ],
        },
      ],
    });
  });

  it("sends an earlier turn back with the thinking Anthropic gave it, and a turn another provider wrote with its words only", async () => {
    const first = await drain(
      anthropicClient({ fetcher: streamOf(answer()) }),
      {
        messages: hello,
      },
    );
    const done = first.find(
      (event): event is Extract<ModelEvent, { kind: "done" }> =>
        event.kind === "done",
    );
    const sent: Sent[] = [];

    await drain(anthropicClient({ fetcher: recording(sent) }), {
      messages: [
        ...hello,
        {
          role: "assistant",
          content: "Done.",
          reasoning: "Thinking.",
          ...(done?.replay ? { replay: done.replay } : {}),
        },
        { role: "user", content: "Again" },
        {
          role: "assistant",
          content: "Hi again.",
          reasoning: "Elsewhere.",
          replay: {
            provider: "openrouter",
            format: "chat-completions",
            data: {},
          },
        },
        { role: "user", content: "Once more" },
      ],
    });

    expect(done?.replay).toMatchObject({
      provider: "anthropic",
      format: "anthropic-messages",
    });
    expect(
      (sent[0]?.body["messages"] as { role: string; content: unknown }[])
        .filter((turn) => turn.role === "assistant")
        .map((turn) => turn.content),
    ).toEqual([
      [
        { type: "thinking", thinking: "Thinking.", signature: "sig-1" },
        { type: "text", text: "Done." },
      ],
      [{ type: "text", text: "Hi again." }],
    ]);
  });
});

describe("Anthropic's answer", () => {
  it("streams its thinking apart from its words, and reports what was read from and written to the cache", async () => {
    const events = await drain(anthropicClient({ fetcher: recording([]) }), {
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
        requestId: "msg_1",
        inputTokens: 1_000_000,
        cacheReadTokens: 850_000,
        cacheWriteTokens: 100_000,
        outputTokens: 100_000,
        reasoningTokens: 30_000,
      },
    });
  });

  it("is priced from Anthropic's list in US dollars, cache reads and five-minute writes at their own prices", async () => {
    const events = await drain(anthropicClient({ fetcher: recording([]) }), {
      messages: hello,
    });
    const usage = events.find((event) => event.kind === "usage");

    // Opus 5.5: 50k uncached at $4, 100k written at $5, 850k read at $0.20,
    // 100k out at $20.
    expect(usage?.kind === "usage" && usage.usage.estimatedCost).toEqual({
      amount: expect.closeTo(0.05 * 4 + 0.1 * 5 + 0.85 * 0.2 + 0.1 * 20, 10),
      currency: "USD",
      priceList: "2026-10-09",
    });
  });

  it("charges Haiku 5.5's higher prices for a whole request whose prompt, cached part included, passes 100,000 tokens", async () => {
    const cost = async (cached: number) => {
      const events = await drain(
        anthropicClient({
          model: "claude-haiku-5-5",
          fetcher: recording(
            [],
            streamOf(
              answer(
                {
                  input_tokens: 10_000,
                  cache_read_input_tokens: cached,
                  output_tokens: 1,
                },
                1_000,
              ),
            ),
          ),
        }),
        { messages: hello },
      );
      const usage = events.find((event) => event.kind === "usage");
      return usage?.kind === "usage" ? usage.usage.estimatedCost?.amount : 0;
    };

    expect(await cost(90_000)).toBeCloseTo(
      0.01 * 0.1 + 0.09 * 0.01 + 0.001 * 0.5,
      10,
    );
    expect(await cost(95_000)).toBeCloseTo(
      0.01 * 0.5 + 0.095 * 0.05 + 0.001 * 2.5,
      10,
    );
  });
});
