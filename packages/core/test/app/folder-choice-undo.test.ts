/**
 * A folder choice that cannot be saved, when other folder state moved on
 * while it was being saved.
 */

import { describe, expect, it } from "vitest";
import type { SavedWorkspace } from "@zhiyin/session";
import { emptyConversationLists } from "@zhiyin/contract";
import { loopFrom, stubDependencies, until } from "./support.js";

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

function tools(broken: Set<string>) {
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
        if (broken.has(path)) throw new Error("The folder is gone.");
        at.set(id, path);
        return path.split("/").at(-1) ?? path;
      },
      checkFolder: async (path: string) => {
        if (broken.has(path)) throw new Error("The folder is gone.");
        return path.split("/").at(-1) ?? path;
      },
      leaveFolder: (id: string) => {
        at.delete(id);
      },
    },
  };
}

/** A loop over saved history whose next save is held, then fails or goes through. */
async function heldSave(
  saved: SavedWorkspace,
  options: { broken?: Set<string>; startingFolder?: string } = {},
) {
  const deps = stubDependencies(() => {});
  let holdNext = false;
  let failHeld: (() => void) | undefined;
  let passHeld: (() => void) | undefined;
  let disk: SavedWorkspace | undefined;
  const stood = tools(options.broken ?? new Set());
  const loop = loopFrom({
    ...deps,
    sessions: {
      ...deps.sessions,
      loadWorkspace: async () => saved,
      saveWorkspace: async (snapshot: SavedWorkspace) => {
        if (holdNext) {
          holdNext = false;
          await new Promise<void>((resolve, reject) => {
            failHeld = () => reject(new Error("The disk is busy."));
            passHeld = resolve;
          });
        }
        disk = structuredClone(snapshot);
      },
    },
    workspace: stood.workspace,
    ...(options.startingFolder
      ? { startingFolder: options.startingFolder }
      : {}),
    newTaskId: () => `task-${Math.random()}`,
  });
  await loop.initialize();
  return {
    loop,
    tools: stood,
    disk: () => disk,
    hold: () => {
      holdNext = true;
    },
    held: () => failHeld !== undefined,
    fail: () => failHeld?.(),
    release: () => passHeld?.(),
  };
}

describe("AgentLoop the folder named at launch, chosen in a choice that fails after the person went elsewhere", () => {
  it("is not both unchosen and offered among the recent folders", async () => {
    const app = await heldSave(
      {
        tasks: [
          conversation("a", "Alpha", folder("f1")),
          conversation("b", "Beta", folder("f3")),
        ],
        selectedTaskId: "a",
        recentWorkspaces: [folder("f1"), folder("f3")],
      },
      { startingFolder: "C:/src/zhiyin" },
    );
    expect(app.loop.snapshot().launchFolders).toEqual(["C:/src/zhiyin"]);
    await app.loop.openTask("b");

    app.hold();
    const moving = app.loop.selectWorkspace("C:/src/zhiyin");
    await until(app.held);
    await app.loop.selectTask("b");
    app.fail();
    await expect(moving).rejects.toThrow("The disk is busy.");

    const snapshot = app.loop.snapshot();
    const unchosen = (snapshot.launchFolders ?? []).includes("C:/src/zhiyin");
    const offered = snapshot.recentWorkspaces.some(
      (f) => f.path === "C:/src/zhiyin",
    );
    // README: until the person chooses it, it is never offered among the
    // recent ones.
    expect({ unchosen, offered }).not.toEqual({
      unchosen: true,
      offered: true,
    });
    const disk = app.disk();
    expect({
      unchosen: (disk?.launchFolders ?? []).includes("C:/src/zhiyin"),
      offered: disk?.recentWorkspaces.some(
        (f: Folder) => f.path === "C:/src/zhiyin",
      ),
    }).not.toEqual({ unchosen: true, offered: true });
  });
});

describe("AgentLoop a conversation created while the folder choice of the one on screen is saved", () => {
  it("waits for it, and starts where the person is looking once it fails", async () => {
    const app = await heldSave({
      tasks: [conversation("a", "Alpha", folder("f"))],
      selectedTaskId: "a",
      workspace: folder("f"),
      recentWorkspaces: [folder("f")],
    });
    app.hold();
    const moving = app.loop.selectWorkspace("C:/work/g");
    await until(app.held);

    const creating = app.loop.createTask();
    app.fail();
    await expect(moving).rejects.toThrow("The disk is busy.");
    const created = await creating;

    const snapshot = app.loop.snapshot();
    expect(snapshot.tasks.find((t) => t.id === created)?.workspace?.path).toBe(
      "C:/work/f",
    );
    expect(snapshot.workspace?.path).toBe("C:/work/f");
  });
});

describe("AgentLoop a first message from New task while its folder is being saved", () => {
  it("creates the conversation and leaves the window on the one the person opened meanwhile", async () => {
    const app = await heldSave({
      tasks: [
        conversation("a", "Alpha", folder("f")),
        conversation("b", "Beta", folder("f")),
      ],
      selectedTaskId: "a",
      workspace: folder("f"),
      recentWorkspaces: [folder("f")],
    });
    await app.loop.selectNothing();
    app.hold();
    const choosing = app.loop.selectWorkspace("C:/work/g");
    await until(app.held);

    const creating = app.loop.createTask();
    const opening = app.loop.selectTask("b");
    app.release();
    await choosing;
    const created = await creating;
    await opening;

    const snapshot = app.loop.snapshot();
    expect(snapshot.selectedTaskId).toBe("b");
    expect(snapshot.tasks.find((t) => t.id === created)?.workspace?.path).toBe(
      "C:/work/g",
    );
  });

  it("starts it in the folder from before the choice when that choice cannot be saved", async () => {
    const app = await heldSave({
      tasks: [
        conversation("a", "Alpha", folder("f")),
        conversation("b", "Beta", folder("h")),
      ],
      selectedTaskId: "a",
      workspace: folder("f"),
      recentWorkspaces: [folder("f"), folder("h")],
    });
    await app.loop.selectNothing();
    app.hold();
    const choosing = app.loop.selectWorkspace("C:/work/g");
    await until(app.held);

    const creating = app.loop.createTask();
    const opening = app.loop.selectTask("b");
    app.fail();
    await expect(choosing).rejects.toThrow("The disk is busy.");
    const created = await creating;
    await opening;

    const snapshot = app.loop.snapshot();
    expect(snapshot.selectedTaskId).toBe("b");
    expect(snapshot.tasks.find((t) => t.id === created)?.workspace?.path).toBe(
      "C:/work/f",
    );
  });
});

describe("AgentLoop a folder change that fails when the old folder, unopened before, opens again", () => {
  it("shows the folder the conversation on screen is put back in", async () => {
    const broken = new Set(["C:/work/old"]);
    const app = await heldSave(
      {
        tasks: [
          conversation("a", "Alpha", folder("old")),
          conversation("b", "Beta", folder("x")),
        ],
        selectedTaskId: "a",
        workspace: folder("x"),
        recentWorkspaces: [folder("x")],
      },
      { broken },
    );
    // a's folder did not open at launch: reported, and x stays shown.
    expect(app.loop.snapshot().selectedTaskId).toBe("a");
    expect(app.loop.snapshot().workspace?.path).toBe("C:/work/x");
    expect(
      (app.loop.snapshot().issues ?? []).some((i) => i.conversationId === "a"),
    ).toBe(true);

    // The drive comes back; the person chooses a new folder for a, and the
    // choice cannot be saved.
    broken.delete("C:/work/old");
    app.hold();
    const moving = app.loop.selectWorkspace("C:/work/new");
    await until(app.held);
    app.fail();
    await expect(moving).rejects.toThrow("The disk is busy.");

    const snapshot = app.loop.snapshot();
    expect(snapshot.selectedTaskId).toBe("a");
    expect(snapshot.tasks.find((t) => t.id === "a")?.workspace?.path).toBe(
      "C:/work/old",
    );
    expect(app.tools.at.get("a")).toBe("C:/work/old");
    // README: the folder shown, the one recorded and the tools' folder stay
    // together; once it opens again it is shown while its conversation is on
    // screen.
    expect(snapshot.workspace?.path).toBe("C:/work/old");
  });

  it("starts a new conversation where the one on screen works", async () => {
    const broken = new Set(["C:/work/old"]);
    const app = await heldSave(
      {
        tasks: [
          conversation("a", "Alpha", folder("old")),
          conversation("b", "Beta", folder("x")),
        ],
        selectedTaskId: "a",
        workspace: folder("x"),
        recentWorkspaces: [folder("x")],
      },
      { broken },
    );
    broken.delete("C:/work/old");
    app.hold();
    const moving = app.loop.selectWorkspace("C:/work/new");
    await until(app.held);
    app.fail();
    await expect(moving).rejects.toThrow("The disk is busy.");

    const fresh = await app.loop.createTask();
    expect(
      app.loop.snapshot().tasks.find((t) => t.id === fresh)?.workspace?.path,
    ).toBe("C:/work/old");
  });
});

describe("AgentLoop a conversation created after New task while the folder choice of the one left is still saving", () => {
  it("is shown in the folder it was created in once that choice fails", async () => {
    const app = await heldSave({
      tasks: [conversation("a", "Alpha", folder("f"))],
      selectedTaskId: "a",
      workspace: folder("f"),
      recentWorkspaces: [folder("f")],
    });
    expect(app.loop.snapshot().workspace?.path).toBe("C:/work/f");

    app.hold();
    const moving = app.loop.selectWorkspace("C:/work/g");
    await until(app.held);
    // New task, then a first message: the window calls these two.
    await app.loop.selectNothing();
    const fresh = await app.loop.createTask();
    const created = app.loop.snapshot().tasks.find((t) => t.id === fresh);
    expect(created?.workspace?.path).toBe("C:/work/g");

    app.fail();
    await expect(moving).rejects.toThrow("The disk is busy.");

    const snapshot = app.loop.snapshot();
    expect(snapshot.selectedTaskId).toBe(fresh);
    const onScreen = snapshot.tasks.find((t) => t.id === fresh);
    // The conversation on screen works in g (its record), so the folder shown
    // must be g; a new conversation then starts where the person looks.
    expect({
      shown: snapshot.workspace?.path,
      recorded: onScreen?.workspace?.path,
    }).toEqual({ shown: "C:/work/g", recorded: "C:/work/g" });
    // Worked in now, so offered among the recent folders.
    expect(snapshot.recentWorkspaces.map((item) => item.path)).toContain(
      "C:/work/g",
    );
  });
});

describe("AgentLoop New task from that conversation, after the choice failed", () => {
  it("starts where the person was looking", async () => {
    const app = await heldSave({
      tasks: [conversation("a", "Alpha", folder("f"))],
      selectedTaskId: "a",
      workspace: folder("f"),
      recentWorkspaces: [folder("f")],
    });
    app.hold();
    const moving = app.loop.selectWorkspace("C:/work/g");
    await until(app.held);
    await app.loop.selectNothing();
    const fresh = await app.loop.createTask();
    app.fail();
    await expect(moving).rejects.toThrow("The disk is busy.");
    // The person is on the new conversation, in g, and asks for another.
    await app.loop.selectNothing();
    const next = await app.loop.createTask();
    const tasks = app.loop.snapshot().tasks;
    expect(tasks.find((t) => t.id === next)?.workspace?.path).toBe(
      tasks.find((t) => t.id === fresh)?.workspace?.path,
    );
  });
});

const launch = { path: "C:/src/zhiyin", name: "zhiyin" };

describe("AgentLoop a failed folder choice, when a conversation is created meanwhile in another folder", () => {
  it("does not leave the failed folder among the recent ones", async () => {
    const a = await heldSave({
      tasks: [
        conversation("a", "Alpha", folder("f")),
        conversation("b", "Beta", launch),
      ],
      selectedTaskId: "a",
      workspace: folder("f"),
      launchFolders: [launch.path],
      recentWorkspaces: [folder("f")],
    });
    await a.loop.openTask("b");
    expect(a.loop.snapshot().recentWorkspaces.map((f) => f.path)).toEqual([
      "C:/work/f",
    ]);

    a.hold();
    const moving = a.loop.selectWorkspace("C:/work/g");
    await until(a.held);
    // The person goes to b, then New task and a first message.
    await a.loop.selectTask("b");
    await a.loop.selectNothing();
    const fresh = await a.loop.createTask();
    expect(
      a.loop.snapshot().tasks.find((t) => t.id === fresh)?.workspace?.path,
    ).toBe(launch.path);

    a.fail();
    await expect(moving).rejects.toThrow("The disk is busy.");

    const snapshot = a.loop.snapshot();
    // a is back in f; nothing works in g, nor shows it.
    expect(snapshot.tasks.find((t) => t.id === "a")?.workspace?.path).toBe(
      "C:/work/f",
    );
    expect(snapshot.workspace?.path).toBe(launch.path);
    // Nothing else changed the recent list, so it goes back.
    expect(snapshot.recentWorkspaces.map((f) => f.path)).toEqual(["C:/work/f"]);
    expect(a.disk()?.recentWorkspaces.map((f) => f.path)).toEqual([
      "C:/work/f",
    ]);
  });
});
