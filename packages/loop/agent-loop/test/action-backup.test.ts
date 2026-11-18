/**
 * The backups around one declared file change, as the loop takes them from
 * file recovery: an action is never stopped by a backup that could not be
 * made, and is told when its change cannot be undone.
 */

import { describe, expect, it } from "vitest";
import type { CommandFileChange, FileChange } from "@zhiyin/contract";
import { fakeRecovery } from "@zhiyin/recovery/testing";
import { backUpFiles, keepWhatRanChanged } from "../src/tools/action-backup.js";

const changes: readonly FileChange[] = [
  { path: "notes.md", change: "updated" },
];
const created: readonly CommandFileChange[] = [
  { path: "card.pdf", change: "created" },
];

describe("backing up a file change", () => {
  it("keeps a copy of what the change would overwrite in the workspace", async () => {
    expect(
      await backUpFiles(fakeRecovery(), {
        actionId: "action-1",
        folder: "C:/work",
        changes,
        taskId: "conversation-1",
      }),
    ).toEqual({
      actionId: "action-1",
      files: [{ path: "notes.md", status: "protected" }],
    });
  });

  it("says a change is unprotected when there is no folder or nowhere to keep a copy", async () => {
    const full = fakeRecovery({
      prepare: async () => {
        throw new Error("No space.");
      },
    });

    expect(
      await backUpFiles(full, {
        actionId: "action-1",
        folder: undefined,
        changes,
        taskId: "conversation-1",
      }),
    ).toEqual({
      actionId: "action-1",
      files: [
        {
          path: "notes.md",
          status: "unprotected",
          reason: "No workspace was available for recovery.",
        },
      ],
    });
    expect(
      await backUpFiles(full, {
        actionId: "action-2",
        folder: "C:/work",
        changes,
        taskId: "conversation-1",
      }),
    ).toEqual({
      actionId: "action-2",
      files: [
        {
          path: "notes.md",
          status: "unprotected",
          reason: "Recovery storage was unavailable before this action.",
        },
      ],
    });
  });
});

describe("keeping what a command changed", () => {
  it("records what a command created in the conversation's folder, and nothing without one", async () => {
    const kept: unknown[] = [];
    const recovery = fakeRecovery({
      keepCommandChanges: async (actionId, folder, files) =>
        void kept.push([actionId, folder, files]),
    });
    const ran = (
      actionId: string,
      folder: string | undefined,
      files = created,
    ) =>
      keepWhatRanChanged(recovery, {
        actionId,
        folder,
        taskId: "conversation-1",
        recorded: undefined,
        changes: { status: "checked", files },
      });

    await ran("action-1", "C:/work");
    await ran("action-2", undefined);
    await ran("action-3", "C:/work", []);

    expect(kept).toEqual([["action-1", "C:/work", created]]);
  });

  it("lets a command's action finish when its created files cannot be recorded", async () => {
    const recovery = fakeRecovery({
      keepCommandChanges: async () => {
        throw new Error("No space.");
      },
    });

    await expect(
      keepWhatRanChanged(recovery, {
        actionId: "action-1",
        folder: "C:/work",
        taskId: "conversation-1",
        recorded: undefined,
        changes: { status: "checked", files: created },
      }),
    ).resolves.toBeUndefined();
  });
});
