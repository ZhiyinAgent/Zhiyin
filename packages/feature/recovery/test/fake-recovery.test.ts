/**
 * What the packages above recovery rely on its fake to answer, held to the
 * real recovery: the same expectations run against both (ADR 0002).
 */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import type { FileChange } from "@zhiyin/contract";
import { FileRecovery, type Recovery } from "../src/index.js";
import { fakeRecovery } from "./fakes.js";

const folders = new TemporaryFolders();
afterEach(() => folders.removeAll());

const gib = 1024 * 1024 * 1024;

/** A folder holding `notes.txt`, and recovery to keep its changes. */
type Made = { readonly recovery: Recovery; readonly workspace: string };

const recoveries: readonly [string, () => Promise<Made>][] = [
  [
    "the real recovery",
    async () => {
      const workspace = await folders.make("zhiyin-fake-recovery-workspace-");
      await writeFile(join(workspace, "notes.txt"), "before");
      const storage = await folders.make("zhiyin-fake-recovery-store-");
      return {
        recovery: new FileRecovery(storage, {
          freeBytes: async () => 100 * gib,
        }),
        workspace,
      };
    },
  ],
  [
    "the fake",
    async () => ({ recovery: fakeRecovery(), workspace: "C:\\workspace" }),
  ],
];

const changes: readonly FileChange[] = [
  { path: "notes.txt", change: "updated", before: "before", after: "after" },
  { path: "new.txt", change: "created", after: "new" },
];

describe.each(recoveries)("%s", (_, make) => {
  it("answers each small declared change as protected, under the action's id", async () => {
    const { recovery, workspace } = await make();

    expect(
      await recovery.prepare("action-1", workspace, changes, "conversation-1"),
    ).toEqual({
      actionId: "action-1",
      files: [
        { path: "notes.txt", status: "protected" },
        { path: "new.txt", status: "protected" },
      ],
    });
  });

  it("finds a prepared action still valid when nothing changed since", async () => {
    const { recovery, workspace } = await make();
    await recovery.prepare("action-1", workspace, changes, "conversation-1");

    expect(await recovery.validate("action-1")).toEqual({ ok: true });
  });

  it("finds no files to put back in a review of no actions", async () => {
    const { recovery, workspace } = await make();

    expect(await recovery.review("review-1", workspace, [])).toEqual({
      id: "review-1",
      workspaceRoot: workspace,
      files: [],
      targets: [],
    });
  });
});
