import { describe, expect, it, vi } from "vitest";
import type { ViewCheckRequest } from "@zhiyin/contract";
import { PendingViewChecks } from "../src/index.js";

/** Collects what was asked, so a test can answer it the way a surface would. */
function asked(): {
  requests: ViewCheckRequest[];
  ask: (request: ViewCheckRequest) => void;
} {
  const requests: ViewCheckRequest[] = [];
  return { requests, ask: (request) => requests.push(request) };
}

describe("PendingViewChecks", () => {
  it("carries a question to the surface and its answer back", async () => {
    const { requests, ask } = asked();
    const checks = new PendingViewChecks({ ask });

    const answer = checks.validate("diagram", "flowchart TD\n  A --> B");
    expect(requests).toHaveLength(1);
    expect(requests[0]?.kind).toBe("diagram");
    expect(requests[0]?.source).toBe("flowchart TD\n  A --> B");

    checks.answer(requests[0]!.id, { ok: true });
    await expect(answer).resolves.toEqual({ ok: true });
  });

  it("keeps the drawing library's own complaint, for the repair to work from", async () => {
    const { requests, ask } = asked();
    const checks = new PendingViewChecks({ ask });

    const answer = checks.validate("diagram", "flowchart TD\n  A[");
    checks.answer(requests[0]!.id, {
      ok: false,
      reason: "Parse error on line 2",
    });

    await expect(answer).resolves.toEqual({
      ok: false,
      reason: "Parse error on line 2",
    });
  });

  it("answers overlapping questions each with its own answer", async () => {
    const { requests, ask } = asked();
    const checks = new PendingViewChecks({ ask });

    const first = checks.validate("diagram", "one");
    const second = checks.validate("diagram", "two");
    const third = checks.validate("diagram", "three");
    expect(new Set(requests.map((item) => item.id)).size).toBe(3);

    // Deliberately out of order: nothing may depend on answers coming back in
    // the order they were asked.
    checks.answer(requests[2]!.id, { ok: false, reason: "third" });
    checks.answer(requests[0]!.id, { ok: true });
    checks.answer(requests[1]!.id, { ok: false, reason: "second" });

    await expect(first).resolves.toEqual({ ok: true });
    await expect(second).resolves.toEqual({ ok: false, reason: "second" });
    await expect(third).resolves.toEqual({ ok: false, reason: "third" });
  });

  it("gives up on a surface that never answers instead of stalling the turn", async () => {
    vi.useFakeTimers();
    try {
      const { ask } = asked();
      const checks = new PendingViewChecks({ ask, timeoutMs: 5_000 });

      const answer = checks.validate("diagram", "flowchart TD\n  A --> B");
      await vi.advanceTimersByTimeAsync(5_000);

      // Unvalidated, not invalid. The source was never judged, and saying it
      // was would put a made-up complaint in front of the model repairing it.
      await expect(answer).resolves.toEqual({
        ok: false,
        reason: "The view could not be checked in time.",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores an answer to a question it is no longer waiting for", async () => {
    vi.useFakeTimers();
    try {
      const { requests, ask } = asked();
      const checks = new PendingViewChecks({ ask, timeoutMs: 5_000 });

      const answer = checks.validate("diagram", "flowchart TD\n  A --> B");
      await vi.advanceTimersByTimeAsync(5_000);
      await expect(answer).resolves.toEqual({
        ok: false,
        reason: "The view could not be checked in time.",
      });

      // A late answer, and an invented one, are the same thing from here.
      expect(() => checks.answer(requests[0]!.id, { ok: true })).not.toThrow();
      expect(() => checks.answer("never-asked", { ok: true })).not.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops waiting when the surface it was asking has gone", async () => {
    const { ask } = asked();
    const checks = new PendingViewChecks({ ask });

    const first = checks.validate("diagram", "one");
    const second = checks.validate("diagram", "two");
    checks.abandon();

    for (const answer of [first, second])
      await expect(answer).resolves.toEqual({
        ok: false,
        reason: "The view could not be checked in time.",
      });
  });

  it("reports a surface that cannot even be asked, rather than waiting for it", async () => {
    const checks = new PendingViewChecks({
      ask: () => {
        throw new Error("no window");
      },
    });

    await expect(checks.validate("diagram", "one")).resolves.toEqual({
      ok: false,
      reason: "The view could not be checked in time.",
    });
  });
});
