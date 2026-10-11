import { describe, expect, it } from "vitest";
import { WorkLedger } from "../src/index.js";

const limits = {
  maximumElapsedMs: 60_000,
  maximumProviderCostUsd: 10,
  maximumToolRounds: 3,
};

describe("a work ledger", () => {
  it("stops at its tool-round limit", () => {
    const ledger = new WorkLedger(limits, new Date("2026-09-16T18:00:00Z"));

    ledger.completeToolRound();
    ledger.completeToolRound();
    ledger.completeToolRound();

    expect(ledger.reached(new Date("2026-09-16T18:00:01Z"))).toEqual([
      "toolRounds",
    ]);
    expect(
      ledger.describe(new Date("2026-09-16T18:00:01Z"), ["toolRounds"]),
    ).toContain("3 tool rounds");
  });

  it("does not stop on how many tokens were read, however many", () => {
    const ledger = new WorkLedger(limits, new Date("2026-09-16T18:00:00Z"));

    // Each request is counted whole, so a long conversation re-reads its own
    // history every round: size is not a measure of work done.
    for (let request = 0; request < 50; request += 1)
      ledger.record({ requestId: `request-${request}`, totalTokens: 200_000 });

    expect(ledger.reached(new Date("2026-09-16T18:00:01Z"))).toEqual([]);
  });

  it("renews rounds and cost together", () => {
    const ledger = new WorkLedger(limits, new Date("2026-09-16T18:00:00Z"));
    ledger.completeToolRound();
    ledger.record({ requestId: "r", totalTokens: 1, costUsd: 11 });
    expect(ledger.reached(new Date("2026-09-16T18:00:01Z"))).toEqual([
      "providerCost",
    ]);

    ledger.renew(new Date("2026-09-16T18:00:02Z"));

    expect(ledger.completedToolRounds()).toBe(0);
    expect(ledger.reached(new Date("2026-09-16T18:00:03Z"))).toEqual([]);
  });
});

describe("a work ledger's cost limit", () => {
  const withYuan = { ...limits, maximumProviderCosts: { CNY: 70 } };
  const estimate = (amount: number, currency: string) => ({
    amount,
    currency,
    priceList: "2026-10-09",
  });

  it("counts estimated dollars toward the dollar limit", () => {
    const ledger = new WorkLedger(withYuan, new Date("2026-10-09T18:00:00Z"));

    ledger.record({ requestId: "reported", totalTokens: 1, costUsd: 5 });
    ledger.record({
      requestId: "estimated",
      totalTokens: 1,
      estimatedCost: estimate(5, "USD"),
    });

    expect(ledger.reached(new Date("2026-10-09T18:00:01Z"))).toEqual([
      "providerCost",
    ]);
  });

  it("stops at the yuan limit on costs in yuan, never converting them to dollars", () => {
    const ledger = new WorkLedger(withYuan, new Date("2026-10-09T18:00:00Z"));
    const now = new Date("2026-10-09T18:00:01Z");

    ledger.record({
      requestId: "first",
      totalTokens: 1,
      estimatedCost: estimate(60, "CNY"),
    });
    expect(ledger.reached(now)).toEqual([]);

    ledger.record({
      requestId: "second",
      totalTokens: 1,
      estimatedCost: estimate(15, "CNY"),
    });
    expect(ledger.reached(now)).toEqual(["providerCost"]);
    expect(ledger.checkpoint(now)).toMatchObject({
      estimatedCosts: [{ currency: "CNY", amount: 75 }],
      allowance: {
        providerCostUsd: 10,
        providerCosts: [{ currency: "CNY", amount: 70 }],
      },
    });
    expect(ledger.checkpoint(now)).not.toHaveProperty("costUsd");
    expect(ledger.describe(now, ["providerCost"])).toContain(
      "estimated from price lists: ¥75.0000",
    );
  });

  it("never stops on a currency it has no limit for", () => {
    const ledger = new WorkLedger(limits, new Date("2026-10-09T18:00:00Z"));

    ledger.record({
      requestId: "elsewhere",
      totalTokens: 1,
      estimatedCost: estimate(1_000, "CNY"),
    });

    expect(ledger.reached(new Date("2026-10-09T18:00:01Z"))).toEqual([]);
  });

  it("starts estimated costs again when the person chooses Continue", () => {
    const ledger = new WorkLedger(withYuan, new Date("2026-10-09T18:00:00Z"));
    ledger.record({
      requestId: "first",
      totalTokens: 1,
      estimatedCost: estimate(75, "CNY"),
    });

    ledger.renew(new Date("2026-10-09T18:00:02Z"));

    expect(ledger.reached(new Date("2026-10-09T18:00:03Z"))).toEqual([]);
    expect(
      ledger.checkpoint(new Date("2026-10-09T18:00:03Z")),
    ).not.toHaveProperty("estimatedCosts");
  });
});
