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
