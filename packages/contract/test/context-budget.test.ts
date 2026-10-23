import { describe, expect, it } from "vitest";
import { contextBudgets, contextTarget } from "../src/index.js";

describe("the size a request is kept under", () => {
  it("is 128k, 262k and 850k on a 1M model for Low, Medium and Ultra", () => {
    const window = { contextWindow: 1_000_000, maximumOutputTokens: 131_072 };

    expect(contextBudgets(window)).toEqual([
      { budget: "low", targetTokens: 128_000 },
      { budget: "medium", targetTokens: 262_000 },
      { budget: "ultra", targetTokens: 850_000 },
    ]);
  });

  it("differs between two windows for the same choice", () => {
    expect(
      contextTarget("medium", { contextWindow: 262_144 }).targetTokens,
    ).toBe(222_822);
    expect(
      contextTarget("medium", { contextWindow: 131_072 }).targetTokens,
    ).toBe(108_518);
  });

  it("offers no Ultra below 300k, where Low and Medium take a larger share", () => {
    expect(contextBudgets({ contextWindow: 262_144 })).toEqual([
      { budget: "low", targetTokens: 128_000 },
      { budget: "medium", targetTokens: 222_822 },
    ]);
  });

  it("is Medium for a conversation set to Ultra on a model without it", () => {
    expect(contextTarget("ultra", { contextWindow: 262_144 })).toEqual({
      budget: "medium",
      targetTokens: 222_822,
    });
  });

  it("always leaves room for the reply and a margin", () => {
    // 131,072 − 14,000 for the reply − 6,553 margin, below Medium's 85 %.
    expect(
      contextTarget("medium", {
        contextWindow: 131_072,
        maximumOutputTokens: 14_000,
      }).targetTokens,
    ).toBe(110_518);
    // A reply limit above 16k still reserves only 16k.
    expect(
      contextTarget("medium", {
        contextWindow: 131_072,
        maximumOutputTokens: 65_536,
      }).targetTokens,
    ).toBe(108_518);
  });

  it("assumes the smallest window Zhiyin is built for when the model's is unknown", () => {
    expect(contextTarget("medium", {})).toEqual(
      contextTarget("medium", { contextWindow: 128_000 }),
    );
    expect(contextBudgets({}).map((option) => option.budget)).toEqual([
      "low",
      "medium",
    ]);
  });
});
