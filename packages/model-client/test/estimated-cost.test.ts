/**
 * A cost the provider does not report is estimated from the shipped price
 * list (ADR 0015): in the list's currency, never converted, and saying which
 * list it came from. A request whose price is not known stays unpriced.
 */

import { describe, expect, it } from "vitest";
import { ProviderModelClient } from "../src/client.js";
import type { ModelEvent, ModelUsage } from "../src/index.js";
import { fromModelList, type ModelList } from "../src/model-list.js";
import type { Provider } from "../src/provider.js";
import { twoRegionProvider } from "./test-provider.js";

const reasoning = {
  status: "unavailable" as const,
  reason: "Not stated.",
};

const list: ModelList = {
  checked: "2026-10-09",
  models: [
    {
      id: "cached",
      name: "Cached",
      contextWindow: 1_000_000,
      acceptsImages: false,
      reasoning,
      offered: {
        international: {
          currency: "USD",
          input: 2,
          cacheRead: 0.2,
          cacheWrite: 2.5,
          output: 10,
          tiers: [
            {
              aboveInputTokens: 272_000,
              input: 4,
              cacheRead: 0.4,
              cacheWrite: 5,
              output: 15,
            },
          ],
        },
        mainland: { currency: "CNY", input: 4, cacheRead: 1, output: 16 },
      },
    },
    {
      id: "peak",
      name: "Peak",
      contextWindow: 1_000_000,
      acceptsImages: false,
      reasoning,
      offered: {
        international: {
          currency: "USD",
          input: 0.66,
          cacheRead: 0.022,
          output: 1.98,
          peak: {
            weekdaysUtc: [1, 2, 3, 4, 5],
            hoursUtc: [
              [1, 4],
              [6, 10],
            ],
            input: 1.32,
            cacheRead: 0.044,
            output: 3.96,
          },
        },
      },
    },
    {
      id: "no-cache-price",
      name: "No cache price",
      contextWindow: 128_000,
      acceptsImages: false,
      reasoning,
      offered: { international: { currency: "USD", input: 1, output: 2 } },
    },
    {
      id: "unpriced",
      name: "Unpriced",
      contextWindow: 128_000,
      acceptsImages: false,
      reasoning,
      offered: { international: null },
    },
  ],
};

const used = (usage: Partial<ModelUsage> = {}): ModelUsage => ({
  requestId: "request-1",
  model: "cached",
  inputTokens: 1_000_000,
  outputTokens: 100_000,
  totalTokens: 1_100_000,
  ...usage,
});

/** What a provider reports for one request, and nothing else. */
function reporting(usage: ModelUsage): Provider {
  return twoRegionProvider([], {
    ...fromModelList(list),
    send: async function* () {
      yield { kind: "usage", usage };
      yield { kind: "done", finishReason: "stop" };
    },
  });
}

async function estimated(
  usage: ModelUsage,
  options: { model?: string; region?: string; at?: string } = {},
) {
  const client = new ProviderModelClient(reporting(usage), {
    apiKey: async () => "key",
    model: options.model ?? usage.model,
    region: options.region ?? "international",
    now: () => new Date(options.at ?? "2026-10-10T12:00:00Z"),
  });
  const events: ModelEvent[] = [];
  for await (const event of client.send({
    messages: [{ role: "user", content: "Hello" }],
  }))
    events.push(event);
  const reported = events.find((event) => event.kind === "usage");
  return reported?.kind === "usage" ? reported.usage : undefined;
}

describe("a cost the provider does not report", () => {
  it("is estimated from the list: uncached input, cache reads and writes, and output, each at its price", async () => {
    const usage = await estimated(
      used({
        inputTokens: 250_000,
        cacheReadTokens: 50_000,
        cacheWriteTokens: 20_000,
        outputTokens: 100_000,
      }),
    );

    // 180k uncached at $2, 50k read at $0.20, 20k written at $2.50, 100k out
    // at $10, all per million.
    expect(usage?.estimatedCost).toEqual({
      amount: expect.closeTo(0.36 + 0.01 + 0.05 + 1, 10),
      currency: "USD",
      priceList: "2026-10-09",
    });
    expect(usage?.costUsd).toBeUndefined();
  });

  it("is priced at the higher tier, for the whole request, once its input passes the tier's size", async () => {
    const usage = await estimated(
      used({ inputTokens: 300_000, outputTokens: 10_000 }),
    );

    expect(usage?.estimatedCost?.amount).toBeCloseTo(0.3 * 4 + 0.01 * 15, 10);
  });

  it("is kept in the platform's own currency, never converted", async () => {
    const usage = await estimated(
      used({ inputTokens: 1_000_000, outputTokens: 0, totalTokens: 1_000_000 }),
      { region: "mainland" },
    );

    expect(usage?.estimatedCost).toEqual({
      amount: 4,
      currency: "CNY",
      priceList: "2026-10-09",
    });
  });

  it("is priced at the lab's peak rate during its peak hours on a weekday, and at its usual rate otherwise", async () => {
    const usage = used({
      model: "peak",
      inputTokens: 1_000_000,
      outputTokens: 0,
      totalTokens: 1_000_000,
    });

    const weekdayPeak = await estimated(usage, { at: "2026-10-08T07:30:00Z" });
    const weekdayQuiet = await estimated(usage, { at: "2026-10-08T05:00:00Z" });
    const saturday = await estimated(usage, { at: "2026-10-10T07:30:00Z" });

    expect(weekdayPeak?.estimatedCost?.amount).toBeCloseTo(1.32, 10);
    expect(weekdayQuiet?.estimatedCost?.amount).toBeCloseTo(0.66, 10);
    expect(saturday?.estimatedCost?.amount).toBeCloseTo(0.66, 10);
  });

  it("stays unpriced when the model has no known price on that platform", async () => {
    const usage = await estimated(used({ model: "unpriced" }));

    expect(usage?.estimatedCost).toBeUndefined();
    expect(usage?.inputTokens).toBe(1_000_000);
  });

  it("stays unpriced when it used tokens of a kind the list gives no price for", async () => {
    const usage = await estimated(
      used({ model: "no-cache-price", cacheReadTokens: 10_000 }),
    );

    expect(usage?.estimatedCost).toBeUndefined();
  });

  it("stays unpriced for a model that is not on the list", async () => {
    const usage = await estimated(used({ model: "elsewhere" }));

    expect(usage?.estimatedCost).toBeUndefined();
  });

  it("is never added to a cost the provider reported", async () => {
    const usage = await estimated(used({ costUsd: 0.5 }));

    expect(usage?.costUsd).toBe(0.5);
    expect(usage?.estimatedCost).toBeUndefined();
  });
});

describe("a request that ended before the provider counted it", () => {
  const client = (model: string) =>
    new ProviderModelClient(reporting(used()), {
      apiKey: async () => "key",
      model,
      region: "international",
      now: () => new Date("2026-10-10T12:00:00Z"),
    });

  it("is taken to have used what the caller counted, for the chosen model, at the list's prices", async () => {
    const counted = {
      inputTokens: 120_000,
      cacheReadTokens: 100_000,
      outputTokens: 30_000,
      reasoningTokens: 30_000,
    };

    const usage = await client("cached").uncounted(counted);
    const again = await client("cached").uncounted(counted);

    // 20k uncached at $2, 100k read at $0.20, 30k out at $10, per million.
    expect(usage).toMatchObject({
      model: "cached",
      ...counted,
      totalTokens: 150_000,
      estimatedCost: {
        amount: expect.closeTo(0.04 + 0.02 + 0.3, 10),
        currency: "USD",
        priceList: "2026-10-09",
      },
    });
    expect(usage?.costUsd).toBeUndefined();
    // Two requests are two records, whatever they are called.
    expect(usage?.requestId).not.toBe(again?.requestId);
  });

  it("counts the input as uncached where the list has no price for a cache read", async () => {
    const usage = await client("no-cache-price").uncounted({
      inputTokens: 120_000,
      cacheReadTokens: 100_000,
      outputTokens: 30_000,
    });

    expect(usage?.cacheReadTokens).toBeUndefined();
    expect(usage?.estimatedCost?.amount).toBeCloseTo(0.12 + 0.06, 10);
  });

  it("is counted without a cost for a model the list has no price for", async () => {
    const usage = await client("unpriced").uncounted({
      inputTokens: 1_000,
      outputTokens: 500,
    });

    expect(usage).toMatchObject({ model: "unpriced", totalTokens: 1_500 });
    expect(usage?.estimatedCost).toBeUndefined();
  });
});
