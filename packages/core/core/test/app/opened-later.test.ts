/** A conversation on screen that could not be read, read later by another route. */

import { describe, expect, it } from "vitest";
import type { SavedWorkspace } from "@zhiyin/session";
import { emptyConversationLists } from "@zhiyin/contract";
import { loopFrom, stubDependencies } from "./support.js";

type Folder = { path: string; name: string };
const folder = (name: string): Folder => ({ path: `C:/work/${name}`, name });

function conversation(id: string, title: string, workspace?: Folder) {
  return {
    id,
    title,
    titleSource: "generated" as const,
    updatedAt: "2026-09-01T10:00:00.000Z",
    updatedLabel: "Earlier",
    ...emptyConversationLists,
    messages: [],
    actions: [],
    phase: { kind: "draft" as const },
    ...(workspace ? { workspace } : {}),
  };
}

function tools() {
  const at = new Map<string, string>();
  return {
    at,
    workspace: {
      describeWorkspace: async () => ({
        rootName: "x",
        entries: [],
        truncated: false,
      }),
      workspaceRoot: (id: string | undefined) =>
        id === undefined ? undefined : at.get(id),
      enterFolder: async (id: string, path: string) => {
        at.set(id, path);
        return path.split("/").at(-1) ?? path;
      },
      checkFolder: async (path: string) => path.split("/").at(-1) ?? path,
      leaveFolder: (id: string) => {
        at.delete(id);
      },
    },
  };
}

async function app(
  saved: SavedWorkspace,
  options: { failFirstRead?: string } = {},
) {
  const deps = stubDependencies(() => {});
  let failed = false;
  const stood = tools();
  const loop = loopFrom({
    ...deps,
    sessions: {
      ...deps.sessions,
      loadWorkspace: async () => saved,
      async openConversation(id: string) {
        if (id === options.failFirstRead && !failed) {
          failed = true;
          throw new Error("The disk did not answer.");
        }
        const task = saved.tasks.find((item) => item.id === id);
        if (!task) throw new Error("No such conversation is saved.");
        return { task, lost: false };
      },
    },
    workspace: stood.workspace,
    newTaskId: () => "fresh",
  });
  await loop.initialize();
  return {
    loop,
    tools: stood,
  };
}

describe("AgentLoop a conversation on screen that could not be read, read later for its permissions", () => {
  it("shows its folder once it opens, so New task starts where the person is looking", async () => {
    const app_ = await app(
      {
        tasks: [
          conversation("a", "Alpha", folder("f1")),
          conversation("b", "Beta", folder("f2")),
        ],
        selectedTaskId: "a",
        workspace: folder("f1"),
        recentWorkspaces: [folder("f1")],
      },
      { failFirstRead: "b" },
    );
    // Going to b: it cannot be read, so it is on screen with its report.
    await app_.loop.selectTask("b");
    expect(app_.loop.snapshot().selectedTaskId).toBe("b");
    expect(app_.loop.snapshot().tasks.some((t) => t.id === "b")).toBe(false);

    // The person opens b's permissions: b is read this time, and is now the
    // conversation on screen, open.
    await app_.loop.openTask("b");
    const snapshot = app_.loop.snapshot();
    expect(snapshot.selectedTaskId).toBe("b");
    expect(snapshot.tasks.some((t) => t.id === "b")).toBe(true);

    expect(snapshot.workspace?.path).toBe("C:/work/f2");
    const created = await app_.loop.createTask();
    expect(
      app_.loop.snapshot().tasks.find((t) => t.id === created)?.workspace?.path,
    ).toBe("C:/work/f2");
  });

  it("shows its folder once renaming it reads it", async () => {
    const app_ = await app(
      {
        tasks: [
          conversation("a", "Alpha", folder("f1")),
          conversation("b", "Beta", folder("f2")),
        ],
        selectedTaskId: "a",
        workspace: folder("f1"),
        recentWorkspaces: [folder("f1")],
      },
      { failFirstRead: "b" },
    );
    await app_.loop.selectTask("b");
    await app_.loop.renameTask("b", "Renamed");
    const snapshot = app_.loop.snapshot();
    expect(snapshot.selectedTaskId).toBe("b");
    expect(snapshot.tasks.some((t) => t.id === "b")).toBe(true);
    expect(snapshot.workspace?.path).toBe("C:/work/f2");
  });
});
