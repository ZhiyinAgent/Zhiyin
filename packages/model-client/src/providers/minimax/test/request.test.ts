/**
 * What MiniMax is sent, and how its answer reads back. From MiniMax's own
 * documentation of its Anthropic-compatible API, which it recommends (checked
 * 2026-10-09): one host per platform, thinking off by default on MiniMax-M3
 * and always on for M2.x, each turn's signed thinking sent back unchanged.
 */

import { describe, expect, it } from "vitest";
import type { ModelEvent } from "../../../model-client.js";
import { drain, miniMaxClient, recording, type Sent } from "./support.js";

const hello = [{ role: "user" as const, content: "Hello" }];

describe("a request to MiniMax", () => {
  it("goes to the Messages endpoint of the account's platform, with the key as a bearer token", async () => {
    const urls: Record<string, string | undefined> = {};
    for (const region of ["international", "mainland"] as const) {
      const sent: Sent[] = [];
      await drain(miniMaxClient({ region, fetcher: recording(sent) }), {
        messages: hello,
      });
      urls[region] = sent[0]?.url;
      expect(sent[0]?.headers["Authorization"]).toBe("Bearer sk-test");
    }

    expect(urls).toEqual({
      international: "https://api.minimax.io/anthropic/v1/messages",
      mainland: "https://api.minimax.cn/anthropic/v1/messages",
    });
  });

  it("names the model, streams, asks for its longest reply unless the request names one, and turns thinking on", async () => {
    const sent: Sent[] = [];
    const client = miniMaxClient({ fetcher: recording(sent) });

    await drain(client, { messages: hello });
    await drain(client, { messages: hello, maximumOutputTokens: 16_000 });

    expect(sent.map(({ body }) => body)).toEqual([
      {
        model: "MiniMax-M3",
        max_tokens: 131_072,
        thinking: { type: "adaptive" },
        stream: true,
        messages: [
          { role: "user", content: [{ type: "text", text: "Hello" }] },
        ],
      },
      expect.objectContaining({ max_tokens: 16_000 }),
    ]);
  });

  it("turns thinking off on MiniMax-M3 when the person chose so", async () => {
    const sent: Sent[] = [];

    await drain(miniMaxClient({ fetcher: recording(sent) }), {
      messages: hello,
      reasoning: { enabled: false },
    });

    expect(sent[0]?.body["thinking"]).toEqual({ type: "disabled" });
  });

  it("refuses to turn thinking off on MiniMax-M2.7, which always thinks, before sending anything", async () => {
    const sent: Sent[] = [];

    await expect(
      drain(
        miniMaxClient({ model: "MiniMax-M2.7", fetcher: recording(sent) }),
        { messages: hello, reasoning: { enabled: false } },
      ),
    ).rejects.toMatchObject({ code: "unsupportedReasoning" });
    expect(sent).toEqual([]);
  });

  it("refuses an effort, which neither model takes, before sending anything", async () => {
    const sent: Sent[] = [];

    await expect(
      drain(miniMaxClient({ fetcher: recording(sent) }), {
        messages: hello,
        reasoning: { enabled: true, effort: "high" },
      }),
    ).rejects.toMatchObject({ code: "unsupportedReasoning" });
    expect(sent).toEqual([]);
  });

  it("marks nothing for caching, which MiniMax does by itself", async () => {
    const sent: Sent[] = [];

    await drain(miniMaxClient({ fetcher: recording(sent) }), {
      messages: [
        { role: "system", content: "Be brief." },
        { role: "user", content: "Hello" },
      ],
      cacheAfter: [0, 1],
    });

    expect(JSON.stringify(sent[0]?.body)).not.toContain("cache_control");
  });

  it("sends a picture to MiniMax-M3 in the request itself", async () => {
    const sent: Sent[] = [];

    await drain(miniMaxClient({ fetcher: recording(sent) }), {
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
            type: "image",
            source: { type: "base64", media_type: "image/png", data: "AAAA" },
          },
        ],
      },
    ]);
  });

  it("sends an earlier turn back with the signed thinking MiniMax gave it, even after the conversation before it changed", async () => {
    const first = await drain(miniMaxClient({ fetcher: recording([]) }), {
      messages: hello,
    });
    const done = first.find(
      (event): event is Extract<ModelEvent, { kind: "done" }> =>
        event.kind === "done",
    );
    const sent: Sent[] = [];

    await drain(miniMaxClient({ fetcher: recording(sent) }), {
      messages: [
        // The start of the conversation is no longer what it was.
        { role: "user", content: "Hello, condensed" },
        {
          role: "assistant",
          content: "Done.",
          reasoning: "Thinking.",
          ...(done?.replay ? { replay: done.replay } : {}),
        },
        { role: "user", content: "Again" },
      ],
    });

    expect(done?.replay).toMatchObject({
      provider: "minimax",
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
    ]);
  });
});

describe("MiniMax's answer", () => {
  it("streams its thinking apart from its words, and counts its cached input in the input", async () => {
    const events = await drain(miniMaxClient({ fetcher: recording([]) }), {
      messages: hello,
    });

    expect(
      events.filter(
        (event) =>
          event.kind === "reasoningDelta" || event.kind === "textDelta",
      ),
    ).toEqual([
      { kind: "reasoningDelta", text: "Thinking." },
      { kind: "textDelta", text: "Done." },
    ]);
    expect(events.find((event) => event.kind === "usage")).toMatchObject({
      usage: {
        inputTokens: 1_000_000,
        cacheReadTokens: 850_000,
        outputTokens: 100_000,
      },
    });
  });

  it("is priced from the platform's own list in its own currency, at the higher rates past 512k input", async () => {
    const usage = async (region: "international" | "mainland") => {
      const events = await drain(
        miniMaxClient({ region, fetcher: recording([]) }),
        { messages: hello },
      );
      const found = events.find((event) => event.kind === "usage");
      return found?.kind === "usage" ? found.usage.estimatedCost : undefined;
    };

    // 1M input in all, past 512k: 150k new, 850k cached, 100k out.
    expect(await usage("international")).toEqual({
      amount: expect.closeTo(0.15 * 0.6 + 0.85 * 0.12 + 0.1 * 2.4, 10),
      currency: "USD",
      priceList: "2026-10-09",
    });
    expect(await usage("mainland")).toEqual({
      amount: expect.closeTo(0.15 * 4.2 + 0.85 * 0.84 + 0.1 * 16.8, 10),
      currency: "CNY",
      priceList: "2026-10-09",
    });
  });
});
