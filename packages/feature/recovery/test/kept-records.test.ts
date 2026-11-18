/**
 * The records recovery keeps of each action, read back by a later session:
 * one that is not a record of an action is not trusted, and the others carry
 * on without it.
 */

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import type { TaskAction } from "@zhiyin/contract";
import { FileRecovery } from "../src/index.js";

const folders = new TemporaryFolders();
afterEach(() => folders.removeAll());

const gib = 1024 * 1024 * 1024;

function wrote(id: string, path: string, sequence: number): TaskAction {
  return {
    id,
    action: "Write a file",
    target: path,
    status: "completed",
    startedAt: "2026-11-01T10:00:00.000Z",
    sequence,
    changes: [{ path, change: "updated" }],
  };
}

/** Where the store keeps the record of an action. */
function recordOf(storage: string, actionId: string): string {
  return join(
    storage,
    "recovery",
    createHash("sha256").update(actionId).digest("hex"),
    "manifest.json",
  );
}

/** A record as one is written, but for `changed`. */
const recordWith = (changed: Record<string, unknown>) => ({
  version: 1,
  actionId: "write-2",
  conversationId: "conversation-1",
  workspaceRoot: "C:\\",
  createdAt: new Date().toISOString(),
  phase: "committed",
  ...changed,
});

describe("a kept record of the wrong shape", () => {
  it.each([
    ["its files are not a list", recordWith({ files: "b.txt" })],
    ["it is not an object", [1, 2, 3]],
    [
      "a file in it names no path",
      recordWith({ files: [{ status: "protected", before: "file" }] }),
    ],
    [
      "a file in it is kept by contents that are not named",
      recordWith({
        files: [
          { path: "b.txt", status: "protected", before: "file", content: 7 },
        ],
      }),
    ],
    ["its phase is not one", recordWith({ phase: "done", files: [] })],
  ])(
    "is not trusted when %s, and the other actions are still put back",
    async (_, written) => {
      const root = await folders.make("zhiyin-records-workspace-");
      const storage = await folders.make("zhiyin-records-store-");
      await writeFile(join(root, "a.txt"), "a before");
      await writeFile(join(root, "b.txt"), "b before");
      const first = new FileRecovery(storage, {
        freeBytes: async () => 100 * gib,
      });
      for (const [actionId, path] of [
        ["write-1", "a.txt"],
        ["write-2", "b.txt"],
      ] as const) {
        await first.prepare(
          actionId,
          root,
          [{ path, change: "updated" }],
          "conversation-1",
        );
        await writeFile(join(root, path), `${path} after`);
        await first.commit(actionId);
      }
      await writeFile(recordOf(storage, "write-2"), JSON.stringify(written));

      const later = new FileRecovery(storage, {
        freeBytes: async () => 100 * gib,
      });
      await later.cleanup();
      const review = await later.review("review-1", root, [
        wrote("write-1", "a.txt", 0),
        wrote("write-2", "b.txt", 1),
      ]);
      await later.restore(review);

      expect(await readFile(join(root, "a.txt"), "utf8")).toBe("a before");
      expect(await readFile(join(root, "b.txt"), "utf8")).toBe("b.txt after");
      expect(review.files.find((file) => file.path === "b.txt")).toMatchObject({
        status: "unprotected",
      });
    },
  );
});
