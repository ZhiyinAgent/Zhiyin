/** Filesystem failures must never replace the last committed history. */

import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkspaceSnapshot } from "@zhiyin/contract";
import { FileSessions } from "../src/index.js";

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
  workspaceFiles: ConstructorParameters<typeof FileSessions>[1] extends infer O
    ? O extends { workspaceFiles?: infer F }
      ? F
      : never
    : never,
): Promise<void> {
  const root = await temporaryRoot();
  await new FileSessions(root).saveWorkspace(snapshot("Committed"));
  const failing = new FileSessions(root, { workspaceFiles });

  await expect(failing.saveWorkspace(snapshot("Uncommitted"))).rejects.toThrow(
    "Task history could not be saved.",
  );

  await expect(new FileSessions(root).loadWorkspace()).resolves.toMatchObject({
    tasks: [{ title: "Committed" }],
  });
}

describe("workspace replacement failures", () => {
  it("keeps the prior commit when the disk refuses the write", async () => {
    await expectPriorCommitSurvives({
      write: async () => {
        const error = new Error("Disk full") as NodeJS.ErrnoException;
        error.code = "ENOSPC";
        throw error;
      },
      replace: rename,
      remove: (path) => rm(path, { force: true }),
    });
  });

  it("keeps the prior commit when only part of the new file is written", async () => {
    await expectPriorCommitSurvives({
      write: async (path, source) => {
        await writeFile(path, source.slice(0, 20), "utf8");
        throw new Error("Write stopped early");
      },
      replace: rename,
      remove: (path) => rm(path, { force: true }),
    });
  });

  it("keeps the prior commit when replacing the file fails", async () => {
    await expectPriorCommitSurvives({
      write: (path, source) => writeFile(path, source, "utf8"),
      replace: async () => {
        throw new Error("Rename failed");
      },
      remove: (path) => rm(path, { force: true }),
    });
  });
});
