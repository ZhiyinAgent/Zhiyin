import { describe, expect, it } from "vitest";
import { dataEnds, dataSpan, lineAxis, roundTicks } from "./chartAxes.js";

describe("an axis's span and its labels", () => {
  it.each([
    ["two values a floating-point step apart", [0.3, 0.30000000000000004]],
    ["two huge values two apart", [1e16, 1e16 + 2]],
    ["values far below one", [1e-120, 3e-120]],
    ["values around a million", [1_000_000, 1_000_400]],
  ])("labels %s at a few finite values", (_, values) => {
    const ticks = roundTicks(dataSpan(values));

    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks.length).toBeLessThanOrEqual(12);
    for (const tick of ticks) {
      expect(Number.isFinite(tick.value)).toBe(true);
      // No floating-point noise, such as 0.30000000000000004.
      expect(tick.label).not.toMatch(/\.\d*0{6,}[1-9]|NaN/);
    }
  });

  it.each([
    [0.3, 0.30000000000000004],
    [1e16, 1e16 + 2],
  ] as const)(
    "labels a span from %s to %s that the numbers cannot step through at its ends",
    (low, high) => {
      const ticks = roundTicks([low, high]);

      expect(ticks.length).toBeGreaterThan(0);
      expect(ticks.length).toBeLessThanOrEqual(12);
    },
  );

  it("spans values the numbers can barely hold apart as it spans one value", () => {
    const [low, high] = dataSpan([0.3, 0.30000000000000004]);

    expect(high - low).toBeGreaterThan(0.05);
  });

  it("gives an axis of one repeated huge value room to draw on", () => {
    const [low, high] = dataEnds([1e17, 1e17]);

    expect(high).toBeGreaterThan(low);
  });
});

describe("a line chart's shared categories", () => {
  it("keeps a series' later values after the ones another series fills in between", () => {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
    const axis = lineAxis([
      { points: months.map((x) => ({ x })) },
      { points: ["Jan", "Apr", "Jul", "Oct"].map((x) => ({ x })) },
    ]);

    expect(axis).toEqual({
      kind: "category",
      order: [...months, "Jul", "Oct"],
    });
  });
});

describe("a line chart's x axis", () => {
  it("is numeric when every x is a number written as text, and keeps names in order otherwise", () => {
    expect(
      lineAxis([{ points: ["3.5", "-1", "2e1"].map((x) => ({ x })) }]),
    ).toEqual({ kind: "number", domain: [-1, 20] });
    expect(
      lineAxis([{ points: ["1", "2", "Q3"].map((x) => ({ x })) }]),
    ).toEqual({ kind: "category", order: ["1", "2", "Q3"] });
  });
});
