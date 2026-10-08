/**
 * The app over history another version of Zhiyin saved, against the real
 * history store: what the window is told at launch, and what each answer to
 * the update question does. ADR 0022.
 */

import { mkdir, mkdtemp, readdir, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { emptyConversationLists, type WorkspaceTask } from "@zhiyin/contract";
import { FileSessions, type Formats } from "@zhiyin/session";
import { loopFrom, stubDependencies } from "./support.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "zhiyin-formats-"));
  roots.push(root);
  return root;
}

function conversation(index: number): WorkspaceTask {
  return {
    id: `task-${index}`,
    title: `Conversation ${index}`,
    titleSource: "manual",
    updatedAt: `2026-09-0${index + 1}T10:00:00.000Z`,
    updatedLabel: "Earlier",
    ...emptyConversationLists,
    messages: [{ id: `m-${index}`, role: "user", text: "Hello", sequence: 0 }],
    phase: { kind: "completed", outcome: { title: "Done", summary: "Done." } },
  };
}

/** A later release whose one change is to how a conversation is titled. */
const retitled: Formats = {
  first: 3,
  steps: [
    {
      conversation: (state) => ({
        ...(state as Record<string, unknown>),
        title: `${(state as { title: string }).title} (updated)`,
      }),
    },
  ],
};

async function plant(
  root: string,
  options: ConstructorParameters<typeof FileSessions>[1],
  count = 2,
) {
  const sessions = new FileSessions(root, options);
  await sessions.saveWorkspace({
    tasks: Array.from({ length: count }, (_, index) => conversation(index)),
    selectedTaskId: "task-1",
    recentWorkspaces: [],
  });
  await sessions.release();
}

function appOver(sessions: FileSessions) {
  const deps = stubDependencies(() => {});
  return loopFrom({ ...deps, sessions, revealDelayMs: 0 });
}

/** A Recycle Bin that moves what it is given into `bin`. */
function recycleBinIn(bin: string) {
  return {
    recyclable: async (paths: readonly string[]) =>
      new Map(paths.map((path) => [path, true])),
    recycle: async (path: string) => {
      await mkdir(bin, { recursive: true });
      await rename(path, join(bin, basename(path)));
    },
  };
}

describe("history an older version saved", () => {
  it("asks about conversations waiting for an update at launch, and opens none of them", async () => {
    const root = await temporaryRoot();
    await plant(root, { version: "0.1.0-alpha.1" });
    const app = appOver(
      new FileSessions(root, { version: "0.2.0", formats: retitled }),
    );

    await app.initialize();

    expect(app.snapshot().conversations).toEqual([
      expect.objectContaining({
        id: "task-1",
        needsUpdate: { writtenBy: "0.1.0-alpha.1" },
      }),
      expect.objectContaining({
        id: "task-0",
        needsUpdate: { writtenBy: "0.1.0-alpha.1" },
      }),
    ]);
    expect(app.snapshot().tasks).toEqual([]);
    expect(app.snapshot().selectedTaskId).toBe("task-1");
    expect(app.snapshot().issues).toEqual([
      {
        message:
          "“Conversation 1” was saved by Zhiyin 0.1.0-alpha.1 and needs an update before it opens.",
        conversationId: "task-1",
        canUpdate: true,
      },
    ]);
  });

  it("updates every waiting conversation when asked, and opens the selected one", async () => {
    const root = await temporaryRoot();
    await plant(root, { version: "0.1.0-alpha.1" });
    const app = appOver(
      new FileSessions(root, { version: "0.2.0", formats: retitled }),
    );
    await app.initialize();

    expect(await app.settleSavedConversations("update")).toEqual({
      done: 2,
      failed: 0,
    });

    expect(app.snapshot().conversations).toEqual([
      expect.not.objectContaining({ needsUpdate: expect.anything() }),
      expect.not.objectContaining({ needsUpdate: expect.anything() }),
    ]);
    expect(app.snapshot().conversations?.map((item) => item.title)).toEqual([
      "Conversation 1 (updated)",
      "Conversation 0 (updated)",
    ]);
    expect(app.snapshot().tasks.map((task) => task.id)).toEqual(["task-1"]);
    expect(app.snapshot().issues ?? []).toEqual([]);
  });

  it("moves waiting conversations to the Recycle Bin and out of the list", async () => {
    const root = await temporaryRoot();
    await plant(root, { version: "0.1.0-alpha.1" });
    const app = appOver(
      new FileSessions(root, {
        version: "0.2.0",
        formats: retitled,
        recycleBin: recycleBinIn(join(root, "bin")),
      }),
    );
    await app.initialize();

    expect(await app.settleSavedConversations("recycle")).toEqual({
      done: 2,
      failed: 0,
    });

    expect(app.snapshot().conversations).toEqual([]);
    expect(app.snapshot().selectedTaskId).toBeNull();
    expect(app.snapshot().issues ?? []).toEqual([]);
    expect((await readdir(join(root, "bin"))).sort()).toEqual([
      "c-task-0",
      "c-task-1",
    ]);
  });

  it("refuses to delete a waiting conversation from the list, which could not remove it", async () => {
    const root = await temporaryRoot();
    await plant(root, { version: "0.1.0-alpha.1" });
    const app = appOver(
      new FileSessions(root, { version: "0.2.0", formats: retitled }),
    );
    await app.initialize();

    await expect(app.deleteTask("task-0")).rejects.toThrow(
      "“Conversation 0” needs an update first. Update it, or move it to the Recycle Bin, from the question about saved conversations.",
    );
    expect(app.snapshot().conversations?.map((item) => item.id)).toEqual([
      "task-1",
      "task-0",
    ]);
  });
});

describe("history a newer version saved", () => {
  it("refuses a newer history without offering a fresh start", async () => {
    const root = await temporaryRoot();
    await plant(root, { version: "0.2.0", formats: retitled });
    const app = appOver(new FileSessions(root, { version: "0.1.0-alpha.1" }));

    await app.initialize();

    expect(app.snapshot().newerHistory).toEqual({ writtenBy: "0.2.0" });
    expect(app.snapshot().historyRecovery).toBeUndefined();
    expect(app.snapshot().runtime.tasks).toBe("unavailable");
    expect(app.snapshot().issues ?? []).toEqual([]);
    await expect(app.createTask()).rejects.toThrow();
    expect(await readdir(root)).not.toContain("damaged-history");
  });

  it("leaves out conversations a newer version saved, and says so", async () => {
    const root = await temporaryRoot();
    await plant(root, { version: "0.1.0-alpha.1" });
    const elsewhere = await temporaryRoot();
    await plant(elsewhere, { version: "0.2.0", formats: retitled }, 3);
    await rename(
      join(elsewhere, "history", "conversations", "c-task-2"),
      join(root, "history", "conversations", "c-task-2"),
    );
    const app = appOver(new FileSessions(root, { version: "0.1.0-alpha.1" }));

    await app.initialize();

    expect(app.snapshot().conversations?.map((item) => item.id)).toEqual([
      "task-1",
      "task-0",
    ]);
    expect(app.snapshot().issues).toEqual([
      {
        message:
          "One conversation was saved by a newer version of Zhiyin (0.2.0) and is not shown. It was left as it is.",
      },
    ]);
  });
});
