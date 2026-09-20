import { describe, expect, it, vi } from "vitest";
import { loopFrom, stubDependencies } from "./support.js";

describe("private execution evidence", () => {
  it("shows retained corrections, recovery limits, and deletion boundaries", async () => {
    const base = stubDependencies(() => {});
    const clearCorrections = vi.fn(async () => {});
    const clearRecovery = vi.fn(async () => {});
    const app = loopFrom({
      ...base,
      audit: {
        record: async () => {},
        read: async () => [
          {
            at: "2026-09-13T10:00:00.000Z",
            taskId: "task-1",
            toolName: "multi_edit",
            kind: "repair-rejected" as const,
            cause: "content-changed" as const,
            reason: "The repair changed protected content.",
          },
        ],
        clear: clearCorrections,
        retentionLimit: () => 5_000,
      },
      recovery: {
        ...base.recovery,
        storage: async () => ({
          usedBytes: 6,
          retainedFiles: 1,
          excludedFiles: 2,
          limits: {
            totalBytes: 256 * 1024 * 1024,
            fileBytes: 10 * 1024 * 1024,
            versionsPerPath: 10,
            maximumAgeDays: 30,
          },
        }),
        clear: clearRecovery,
      },
    });
    await app.initialize();

    await expect(app.evidence()).resolves.toMatchObject({
      corrections: {
        retainedEntries: 1,
        shownEntries: 1,
        maximumEntries: 5_000,
        entries: [
          {
            toolName: "multi_edit",
            cause: "content-changed",
          },
        ],
      },
      recovery: {
        usedBytes: 6,
        retainedFiles: 1,
        excludedFiles: 2,
        limits: { maximumAgeDays: 30 },
      },
      policy: {
        correctionRedaction: expect.stringContaining(
          "cannot be detected reliably",
        ),
        taskDeletion: expect.stringContaining("derived compacted context"),
        privateStorage: expect.stringContaining("not added"),
      },
    });

    await app.clearEvidence("corrections");
    await app.clearEvidence("recovery");
    expect(clearCorrections).toHaveBeenCalledOnce();
    expect(clearRecovery).toHaveBeenCalledOnce();
  });
});
