import { describe, expect, it, vi } from "vitest";
import type { Sessions } from "@zhiyin/session";
import { deliverPendingHandoffs } from "../src/specialist-handoff-delivery.js";
import { PendingHandoffs } from "../src/pending-handoffs.js";
import type { ModelHistory } from "../src/model-history.js";
import type { TurnRecords } from "../src/turn-records.js";

describe("specialist handoff delivery", () => {
  it("keeps later handoffs queued when an earlier notice cannot be saved", async () => {
    const pending = new PendingHandoffs();
    const specialist = {
      id: "reviewer",
      name: "Reviewer",
      description: "Reviews work.",
      instructions: "Review.",
      provenance: { source: "plugin" as const, pluginId: "engineering" },
    };
    for (const runId of ["first", "second"]) {
      pending.push("task", {
        ok: false,
        runId,
        specialist,
        reason: "Stopped.",
      });
    }
    const records = {
      task: () => ({ actions: [] }),
      markHandoffDelivered: vi.fn(),
    } as unknown as TurnRecords;
    const history = {
      notice: vi.fn().mockRejectedValueOnce(new Error("Store unavailable")),
    } as unknown as ModelHistory;

    await expect(
      deliverPendingHandoffs("task", pending, records, {} as Sessions, history),
    ).rejects.toThrow("Store unavailable");
    expect(pending.drain("task").map((result) => result.runId)).toEqual([
      "first",
      "second",
    ]);
  });
});
