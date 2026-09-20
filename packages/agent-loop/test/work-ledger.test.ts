import { describe, expect, it } from "vitest";
import { WorkLedger } from "../src/index.js";

const limits = {
  maximumElapsedMs: 60_000,
  maximumTokens: 1_000,
  maximumProviderCostUsd: 10,
  maximumToolRounds: 3,
};

describe("a shared parent work ledger", () => {
  it("shares model usage and tool rounds with child work", () => {
    const parent = new WorkLedger(limits, new Date("2026-09-16T18:00:00Z"));
    const child = parent;

    parent.completeToolRound();
    child.record({ requestId: "child-request", totalTokens: 600 });
    child.completeToolRound();
    parent.completeToolRound();

    expect(parent.completedToolRounds()).toBe(3);
    expect(parent.reached(new Date("2026-09-16T18:00:01Z"))).toEqual([
      "toolRounds",
    ]);
    expect(
      parent.describe(new Date("2026-09-16T18:00:01Z"), ["toolRounds"]),
    ).toContain("3 tool rounds");
  });

  it("renews the one tranche for parent and child together", () => {
    const parent = new WorkLedger(limits, new Date("2026-09-16T18:00:00Z"));
    const child = parent;
    child.completeToolRound();
    child.record({ requestId: "child-request", totalTokens: 900 });

    parent.renew(new Date("2026-09-16T18:00:02Z"));

    expect(child.completedToolRounds()).toBe(0);
    expect(child.reached(new Date("2026-09-16T18:00:03Z"))).toEqual([]);
  });
});
