import { describe, expect, it } from "vitest";
import type { ModelHistoryEntry } from "@zhiyin/contract";
import type { Sessions } from "@zhiyin/session";
import type { ModelHistory } from "../src/context/model-history.js";
import { PendingHandoffs } from "../src/specialist/pending-handoffs.js";
import { CommandEndings } from "../src/tools/command-endings.js";
import { deliverBackgroundWork } from "../src/turn/background-deliveries.js";
import { harnessNotice } from "../src/turn/notices.js";
import type { TurnRecords } from "../src/turn/turn-records.js";

/**
 * Tells the job endings held for a task while the person stops the turn
 * during the first one, whose notice is saved or not by then.
 */
async function stoppedWhileTelling(saved: boolean) {
  const endings = new CommandEndings();
  endings.push("task", "Job J1 (npm test) finished.");
  endings.push("task", "Job J2 (npm run build) finished.");
  const stop = new AbortController();
  const modelHistory: ModelHistoryEntry[] = [];
  const records = {
    task: () => ({ specialistRuns: [], modelHistory, undos: [] }),
  } as unknown as TurnRecords;
  const history = {
    latestNotice: () => undefined,
    notice: async (kind: "job", text: string) => {
      if (saved)
        modelHistory.push({
          id: `n${modelHistory.length}`,
          kind: "notice",
          content: harnessNotice(kind, text),
        });
      stop.abort();
    },
  } as unknown as ModelHistory;

  await expect(
    deliverBackgroundWork("task", history, {
      records,
      pendingHandoffs: new PendingHandoffs(),
      commandEndings: endings,
      sessions: {} as Sessions,
      signal: stop.signal,
    }),
  ).rejects.toThrow();
  return { waking: endings.waiting("task"), held: endings.drain("task") };
}

describe("job endings told while the turn is stopped", () => {
  it("holds the one the stop kept out, and the rest, for the next turn without waking", async () => {
    expect(await stoppedWhileTelling(false)).toEqual({
      waking: false,
      held: ["Job J1 (npm test) finished.", "Job J2 (npm run build) finished."],
    });
  });

  it("does not hold again the one saved before the stop came", async () => {
    expect(await stoppedWhileTelling(true)).toEqual({
      waking: false,
      held: ["Job J2 (npm run build) finished."],
    });
  });
});
