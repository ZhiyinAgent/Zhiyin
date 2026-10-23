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

  it("says what a stretch of work spent in its own words, with each cost as an amount", () => {
    const ledger = new WorkLedger(limits, new Date("2026-09-16T18:00:00Z"));
    ledger.record({ requestId: "r", totalTokens: 1, costUsd: 0.5 });
    ledger.completeToolRound();
    ledger.completeToolRound();
    ledger.completeToolRound();

    const said = ledger.describe(new Date("2026-09-16T18:00:01Z"), [
      "toolRounds",
    ]);

    expect(said).toContain(
      "The work reached its tool-round limit after 3 tool rounds.",
    );
    expect(said).toContain("Provider-reported cost is $0.5000.");
    expect(said).toContain("The provider-cost limit is $10.0000.");
    // Only the person can renew a budget; a specialist's has no such choice.
    expect(said).not.toContain("Continue");
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

  it("reports the whole task beside the stretch once the person has chosen Continue", () => {
    const ledger = new WorkLedger(limits, new Date("2026-09-16T18:00:00Z"));
    expect(
      ledger.checkpoint(new Date("2026-09-16T18:00:01Z")),
    ).not.toHaveProperty("sinceStart");
    for (let round = 0; round < 3; round += 1) ledger.completeToolRound();
    ledger.record({ requestId: "first", totalTokens: 1, costUsd: 4 });

    ledger.renew(new Date("2026-09-16T18:00:30Z"));
    for (let round = 0; round < 6; round += 1) ledger.completeToolRound();
    ledger.record({ requestId: "second", totalTokens: 1, costUsd: 10.5 });

    expect(ledger.checkpoint(new Date("2026-09-16T18:01:30Z"))).toMatchObject({
      completedRounds: 6,
      elapsedMs: 60_000,
      costUsd: 10.5,
      sinceStart: { completedRounds: 9, elapsedMs: 90_000, costUsd: 14.5 },
    });
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

  it("keeps each currency apart in the whole task's cost", () => {
    const ledger = new WorkLedger(withYuan, new Date("2026-10-09T18:00:00Z"));
    ledger.record({
      requestId: "first",
      totalTokens: 1,
      estimatedCost: estimate(75, "CNY"),
    });
    ledger.renew(new Date("2026-10-09T18:00:02Z"));
    ledger.record({
      requestId: "second",
      totalTokens: 1,
      estimatedCost: estimate(2, "USD"),
    });

    const { sinceStart } = ledger.checkpoint(new Date("2026-10-09T18:00:03Z"));

    expect(sinceStart).not.toHaveProperty("costUsd");
    expect(sinceStart?.estimatedCosts).toEqual([
      { currency: "CNY", amount: 75 },
      { currency: "USD", amount: 2 },
    ]);
  });
});
