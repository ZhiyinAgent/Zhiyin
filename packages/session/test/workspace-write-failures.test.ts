/** Filesystem failures must never replace the last committed history. */

import { appendFile, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
  emptyConversationLists,
  type WorkspaceSnapshot,
} from "@zhiyin/contract";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import { FileSessions, historyFiles, type HistoryFiles } from "../src/index.js";

async function temporaryRoot(): Promise<string> {
  return folders.make("zhiyin-write-failure-");
}

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

function snapshot(title: string): WorkspaceSnapshot {
  return {
    runtime: { tasks: "available", capabilities: "available" },
    selectedTaskId: "task-1",
    recentWorkspaces: [],
    plugins: [],
    tasks: [
      {
        id: "task-1",
        title,
        titleSource: "generated",
        updatedAt: "2026-09-10T12:00:00.000Z",
        updatedLabel: "Now",
        messages: [],
        ...emptyConversationLists,
        phase: { kind: "draft" },
      },
    ],
    mcpServers: [],
    usage: { status: "unavailable", reason: "No usage." },
  };
}

async function expectPriorCommitSurvives(
  failures: Partial<HistoryFiles>,
): Promise<void> {
  const root = await temporaryRoot();
  await new FileSessions(root).saveWorkspace(snapshot("Committed"));
  const failing = new FileSessions(root, {
    historyFiles: { ...historyFiles, ...failures },
  });

  await expect(failing.saveWorkspace(snapshot("Uncommitted"))).rejects.toThrow(
    "Task history could not be saved.",
  );

  await expect(new FileSessions(root).loadWorkspace()).resolves.toMatchObject({
    tasks: [{ title: "Committed" }],
  });
}

function diskFull(): never {
  const error = new Error("Disk full") as NodeJS.ErrnoException;
  error.code = "ENOSPC";
  throw error;
}

describe("history write failures", () => {
  it("keeps the prior commit when the disk refuses the write", async () => {
    await expectPriorCommitSurvives({
      append: async () => diskFull(),
      create: async () => diskFull(),
    });
  });

  it("keeps the prior commit when only part of the new file is written", async () => {
    await expectPriorCommitSurvives({
      append: async (path, text) => {
        await appendFile(path, text.slice(0, 20), "utf8");
        throw new Error("Write stopped early");
      },
      create: async (path, text) => {
        await writeFile(`${path}.tmp`, text.slice(0, 20), "utf8");
        throw new Error("Write stopped early");
      },
    });
  });

  it("keeps the prior commit when a part-written save cannot be cut back off", async () => {
    await expectPriorCommitSurvives({
      append: async (path, text) => {
        await appendFile(path, text.slice(0, 20), "utf8");
        throw new Error("Write stopped early");
      },
      truncate: async () => {
        throw new Error("Truncate failed");
      },
    });
  });
});
