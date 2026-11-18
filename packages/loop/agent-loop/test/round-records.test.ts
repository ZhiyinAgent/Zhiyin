/**
 * Each request's record names the round it answered, and so does the history
 * entry that keeps that round's words and calls: a reader can tell what each
 * request cost without guessing from the order, which a stopped or quietly
 * corrected round would upset.
 */

import { describe, expect, it } from "vitest";
import type { ModelHistoryEntry } from "@zhiyin/contract";
import { withPlan } from "./plan-fixture.js";

/** The rounds the history keeps, as kind and round. */
function roundsKept(history: readonly ModelHistoryEntry[]) {
  return history.flatMap((entry) =>
    (entry.kind === "calls" || entry.kind === "message") && entry.roundId
      ? [{ kind: entry.kind, round: entry.roundId }]
      : [],
  );
}

describe("what each request answered", () => {
  it("names the round whose calls and answer the history keeps", async () => {
    const fixture = withPlan({
      reports: true,
      script: (request) =>
        request === 1
          ? {
              calls: [
                { name: "list_directory", args: { path: "reports" }, id: "ls" },
              ],
            }
          : { text: "There are two reports." },
    });
    const taskId = await fixture.loop.createTask();

    await fixture.loop.start(taskId, "Which reports are there?");

    const task = fixture.loop.snapshot().tasks[0]!;
    const kept = roundsKept(task.modelHistory);
    expect(kept.map((round) => round.kind)).toEqual(["calls", "message"]);
    expect(
      task.modelResponses.map((response) => ({
        round: response.roundId,
        input: response.usage?.inputTokens,
      })),
    ).toEqual([
      { round: kept[0]?.round, input: 100 },
      { round: kept[1]?.round, input: 200 },
    ]);
    expect(kept[0]?.round).not.toBe(kept[1]?.round);
  });
});
