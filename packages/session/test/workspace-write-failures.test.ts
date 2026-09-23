/** Filesystem failures must never replace the last committed history. */

import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkspaceSnapshot } from "@zhiyin/contract";
import { FileSessions, historyFiles, type HistoryFiles } from "../src/index.js";

const roots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "zhiyin-write-failure-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function snapshot(title: string): WorkspaceSnapshot {
  return {
    runtime: { tasks: "available", capabilities: "available" },
    selectedTaskId: "task-1",
    tasks: [
      {
        id: "task-1",
        title,
        messages: [],
        actions: [],
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
