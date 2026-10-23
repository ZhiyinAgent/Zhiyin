/**
 * Folder reports and folder choices that fail: what is said about which
 * conversation, and what a choice that could not be saved leaves behind.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  emptyConversationLists,
  type MessageAttachment,
  type WorkspaceTask,
} from "@zhiyin/contract";
import type { SavedWorkspace } from "@zhiyin/session";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import { WorkspaceTools } from "@zhiyin/tools";
import { loopFrom, stubDependencies, until } from "./support.js";

const made = new TemporaryFolders();
afterEach(() => made.removeAll());

const moved =
  "The selected folder is unavailable. Choose its new location before using files.";

function conversation(
  id: string,
  title: string,
  folder?: { path: string; name: string },
): WorkspaceTask {
  return {
    id,
    title,
    titleSource: "generated",
    updatedAt: "2026-09-01T10:00:00.000Z",
    updatedLabel: "Earlier",
    ...emptyConversationLists,
    messages: [],
    actions: [],
    phase: { kind: "draft" },
    ...(folder ? { workspace: folder } : {}),
  };
}

/** Folders as the tools keep them; `broken` lists paths that will not open. */
function folders(broken: Set<string>) {
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

describe("AgentLoop unopened-folder reports of two conversations with the same title", () => {
  it("reports the second conversation's folder about that conversation", async () => {
    const broken = new Set(["C:/usb/one", "C:/usb/two"]);
    const deps = stubDependencies(() => {});
    const saved: SavedWorkspace = {
      tasks: [
        conversation("a", "New task", { path: "C:/usb/one", name: "one" }),
        conversation("b", "New task", { path: "C:/usb/two", name: "two" }),
      ],
      selectedTaskId: "a",
      recentWorkspaces: [],
    };
    const loop = loopFrom({
      ...deps,
      sessions: { ...deps.sessions, loadWorkspace: async () => saved },
      workspace: folders(broken).workspace,
    });
    await loop.initialize();
    expect(
      loop.snapshot().issues?.some((issue) => issue.conversationId === "a"),
    ).toBe(true);

    await loop.selectTask("b");

    // The window shows a conversation's report only while that conversation
    // is open, so b's must be about b.
    expect(loop.snapshot().issues ?? []).toContainEqual(
      expect.objectContaining({ conversationId: "b" }),
    );
  });

  it("keeps the second conversation's report when the first one's folder is replaced", async () => {
    const broken = new Set(["C:/usb/one", "C:/usb/two"]);
    const deps = stubDependencies(() => {});
    const saved: SavedWorkspace = {
      tasks: [
        conversation("a", "New task", { path: "C:/usb/one", name: "one" }),
        conversation("b", "New task", { path: "C:/usb/two", name: "two" }),
      ],
      selectedTaskId: "b",
      recentWorkspaces: [],
    };
    const loop = loopFrom({
      ...deps,
      sessions: { ...deps.sessions, loadWorkspace: async () => saved },
      workspace: folders(broken).workspace,
    });
    await loop.initialize();
    await loop.selectTask("a");
    await loop.selectWorkspace("C:/work/fresh");
    await loop.selectTask("b");

    // b's folder still will not open.
    expect(loop.snapshot().issues ?? []).toContainEqual(
      expect.objectContaining({ conversationId: "b" }),
    );
  });
});

describe("AgentLoop a folder change whose save fails while another save succeeds", () => {
  it("leaves the saved record in the folder memory rolled back to", async () => {
    const deps = stubDependencies(() => {});
    const saved: SavedWorkspace = {
      tasks: [
        conversation("a", "Alpha", { path: "C:/work/f1", name: "f1" }),
        conversation("b", "Beta", { path: "C:/work/f1", name: "f1" }),
      ],
      selectedTaskId: "a",
      recentWorkspaces: [{ path: "C:/work/f1", name: "f1" }],
    };
    let disk: SavedWorkspace | undefined;
    let holdNext = false;
    let failHeld: (() => void) | undefined;
    const loop = loopFrom({
      ...deps,
      sessions: {
        ...deps.sessions,
        loadWorkspace: async () => saved,
        saveWorkspace: async (snapshot) => {
          if (holdNext) {
            holdNext = false;
            await new Promise<void>((_, reject) => {
              failHeld = () => reject(new Error("The disk is busy."));
            });
          }
          disk = structuredClone(snapshot);
        },
      },
      workspace: folders(new Set()).workspace,
    });
    await loop.initialize();
    await loop.openTask("b");

    holdNext = true;
    const moving = loop.selectWorkspace("C:/work/f2");
    await until(() => failHeld !== undefined);
    // Another save, of another conversation, succeeds meanwhile.
    await loop.renameTask("b", "Beta renamed");
    failHeld?.();
    await expect(moving).rejects.toThrow("The disk is busy.");

    const inMemory = loop.snapshot().tasks.find((task) => task.id === "a");
    const onDisk = disk?.tasks.find((task) => task.id === "a");
    expect(inMemory?.workspace?.path).toBe("C:/work/f1");
    expect(onDisk?.workspace?.path).toBe(inMemory?.workspace?.path);
  });
});

describe("AgentLoop a folder change whose save fails after the person went to another conversation", () => {
  it("leaves the recent folders as going to the other conversation left them", async () => {
    const deps = stubDependencies(() => {});
    const saved: SavedWorkspace = {
      tasks: [
        conversation("a", "Alpha", { path: "C:/work/f1", name: "f1" }),
        conversation("b", "Beta", { path: "C:/work/f3", name: "f3" }),
      ],
      selectedTaskId: "a",
      recentWorkspaces: [
        { path: "C:/work/f1", name: "f1" },
        { path: "C:/work/f3", name: "f3" },
      ],
    };
    let holdNext = false;
    let failHeld: (() => void) | undefined;
    const loop = loopFrom({
      ...deps,
      sessions: {
        ...deps.sessions,
        loadWorkspace: async () => saved,
        saveWorkspace: async () => {
          if (holdNext) {
            holdNext = false;
            await new Promise<void>((_, reject) => {
              failHeld = () => reject(new Error("The disk is busy."));
            });
          }
        },
      },
      workspace: folders(new Set()).workspace,
    });
    await loop.initialize();
    await loop.openTask("b");

    holdNext = true;
    const moving = loop.selectWorkspace("C:/work/f2");
    await until(() => failHeld !== undefined);
    await loop.selectTask("b");
    failHeld?.();
    await expect(moving).rejects.toThrow("The disk is busy.");

    expect(
      loop.snapshot().tasks.find((t) => t.id === "a")?.workspace?.path,
    ).toBe("C:/work/f1");
    // Something else changed the recent folders meanwhile, and that stands.
    expect(loop.snapshot().recentWorkspaces.map((f) => f.path)).toEqual([
      "C:/work/f3",
      "C:/work/f2",
      "C:/work/f1",
    ]);
  });
});

describe("AgentLoop a folder chosen with none open whose save fails", () => {
  it("keeps saying the folder shown is gone once it is shown again", async () => {
    const deps = stubDependencies(() => {});
    const saved: SavedWorkspace = {
      tasks: [],
      selectedTaskId: null,
      workspace: { path: "C:/work/gone", name: "gone" },
      recentWorkspaces: [{ path: "C:/work/gone", name: "gone" }],
    };
    const loop = loopFrom({
      ...deps,
      sessions: {
        ...deps.sessions,
        loadWorkspace: async () => saved,
        saveWorkspace: async () => {
          throw new Error("The disk is full.");
        },
      },
      workspace: folders(new Set(["C:/work/gone"])).workspace,
    });
    await loop.initialize();
    expect(loop.snapshot().issues?.map((issue) => issue.message)).toContain(
      moved,
    );

    await expect(loop.selectWorkspace("C:/work/new")).rejects.toThrow(
      "The disk is full.",
    );

    // Nothing moved: the gone folder is the one shown again.
    expect(loop.snapshot().workspace?.path).toBe("C:/work/gone");
    expect(loop.snapshot().issues?.map((issue) => issue.message)).toContain(
      moved,
    );
  });
});

describe("AgentLoop a conversation deleted while a failed folder change puts it back", () => {
  it("reports nothing for it and the tools keep no folder for it", async () => {
    const deps = stubDependencies(() => {});
    const saved: SavedWorkspace = {
      tasks: [
        conversation("a", "Alpha", { path: "C:/work/old", name: "old" }),
        conversation("b", "Beta", { path: "C:/work/b", name: "b" }),
      ],
      selectedTaskId: "a",
      recentWorkspaces: [],
    };
    let failSave = false;
    const tools = folders(new Set());
    let holdOld = false;
    let releaseOld = () => {};
    let oldAsked = false;
    const loop = loopFrom({
      ...deps,
      sessions: {
        ...deps.sessions,
        loadWorkspace: async () => saved,
        saveWorkspace: async () => {
          if (failSave) {
            failSave = false;
            throw new Error("The disk is full.");
          }
        },
      },
      workspace: {
        ...tools.workspace,
        enterFolder: async (id: string, path: string) => {
          if (holdOld && path === "C:/work/old") {
            oldAsked = true;
            await new Promise<void>((resolve) => (releaseOld = resolve));
          }
          return tools.workspace.enterFolder(id, path);
        },
      },
    });
    await loop.initialize();
    expect(tools.at.get("a")).toBe("C:/work/old");

    failSave = true;
    holdOld = true;
    const moving = loop.selectWorkspace("C:/work/new").catch(() => undefined);
    await until(() => oldAsked);
    await loop.deleteTask("a");
    releaseOld();
    await moving;

    expect(loop.snapshot().tasks.some((task) => task.id === "a")).toBe(false);
    expect(tools.at.has("a")).toBe(false);
  });

  it("does not report the old folder as gone for a conversation deleted meanwhile", async () => {
    const deps = stubDependencies(() => {});
    const saved: SavedWorkspace = {
      tasks: [
        conversation("a", "Alpha", { path: "C:/work/old", name: "old" }),
        conversation("b", "Beta", { path: "C:/work/b", name: "b" }),
      ],
      selectedTaskId: "a",
      recentWorkspaces: [],
    };
    let failSave = false;
    const broken = new Set<string>();
    const tools = folders(broken);
    let holdOld = false;
    let releaseOld = () => {};
    let oldAsked = false;
    const loop = loopFrom({
      ...deps,
      sessions: {
        ...deps.sessions,
        loadWorkspace: async () => saved,
        saveWorkspace: async () => {
          if (failSave) {
            failSave = false;
            throw new Error("The disk is full.");
          }
        },
      },
      workspace: {
        ...tools.workspace,
        enterFolder: async (id: string, path: string) => {
          if (holdOld && path === "C:/work/old") {
            oldAsked = true;
            await new Promise<void>((resolve) => (releaseOld = resolve));
          }
          return tools.workspace.enterFolder(id, path);
        },
      },
    });
    await loop.initialize();

    failSave = true;
    holdOld = true;
    const moving = loop.selectWorkspace("C:/work/new").catch(() => undefined);
    await until(() => oldAsked);
    broken.add("C:/work/old");
    await loop.deleteTask("a");
    releaseOld();
    await moving;

    expect(
      (loop.snapshot().issues ?? []).filter((issue) =>
        issue.message.includes("old"),
      ),
    ).toEqual([]);
  });
});

describe("AgentLoop a folder named at launch, then chosen", () => {
  it.each([
    ["with a trailing separator", (folder: string) => `${folder}\\`],
    ["in other letter case", (folder: string) => folder.toUpperCase()],
    ["with forward slashes", (folder: string) => folder.replaceAll("\\", "/")],
  ])(
    "counts as chosen when the launch named it %s and the picker spells it its own way",
    async (_spelling, spelled) => {
      const folder = await made.make("zr9-");
      const deps = stubDependencies(() => {});
      const loop = loopFrom({
        ...deps,
        workspace: new WorkspaceTools(),
        startingFolder: spelled(folder),
        newTaskId: () => `task-${Math.random()}`,
      });
      await loop.initialize();
      expect(loop.snapshot().launchFolders).toEqual([spelled(folder)]);
      const first = await loop.createTask();

      // The person chooses the very folder shown, as the folder dialog spells it.
      await loop.selectWorkspace(folder);
      await loop.createTask();
      await loop.selectTask(first);

      expect(loop.snapshot().launchFolders ?? []).toEqual([]);
    },
  );
});

const folder = (name: string) => ({ path: `C:/work/${name}`, name });

/** A loop over saved history whose next save is held, then fails. */
async function heldSave(saved: SavedWorkspace, broken = new Set<string>()) {
  const deps = stubDependencies(() => {});
  let holdNext = false;
  let failHeld: (() => void) | undefined;
  let disk: SavedWorkspace | undefined;
  const tools = folders(broken);
  const loop = loopFrom({
    ...deps,
    sessions: {
      ...deps.sessions,
      loadWorkspace: async () => saved,
      saveWorkspace: async (snapshot) => {
        if (holdNext) {
          holdNext = false;
          await new Promise<void>((_, reject) => {
            failHeld = () => reject(new Error("The disk is busy."));
          });
        }
        disk = structuredClone(snapshot);
      },
    },
    workspace: tools.workspace,
  });
  await loop.initialize();
  return {
    loop,
    tools,
    disk: () => disk,
    hold: () => {
      holdNext = true;
    },
    held: () => failHeld !== undefined,
    fail: () => failHeld?.(),
  };
}

describe("AgentLoop a folder change whose save fails, recents full", () => {
  it("puts back the recent folder the choice pushed off the list", async () => {
    const app = await heldSave({
      tasks: [
        conversation("a", "Alpha", folder("f1")),
        conversation("b", "Beta", folder("f3")),
      ],
      selectedTaskId: "a",
      recentWorkspaces: [
        folder("f1"),
        folder("f3"),
        folder("x"),
        folder("y"),
        folder("z"),
      ],
    });
    await app.loop.openTask("b");

    app.hold();
    const moving = app.loop.selectWorkspace("C:/work/f2");
    await until(app.held);
    app.fail();
    await expect(moving).rejects.toThrow("The disk is busy.");

    // z, which the choice pushed off the end, is back.
    expect(app.loop.snapshot().recentWorkspaces.map((f) => f.path)).toEqual([
      "C:/work/f1",
      "C:/work/f3",
      "C:/work/x",
      "C:/work/y",
      "C:/work/z",
    ]);
  });
});

describe("AgentLoop a folder change whose save fails after another conversation in that folder is shown", () => {
  it("keeps the folder shown among the recent ones", async () => {
    const app = await heldSave({
      tasks: [
        conversation("a", "Alpha", folder("f1")),
        conversation("b", "Beta", folder("f2")),
      ],
      selectedTaskId: "a",
      recentWorkspaces: [folder("f1")],
    });
    await app.loop.openTask("b");

    app.hold();
    const moving = app.loop.selectWorkspace("C:/work/f2");
    await until(app.held);
    const going = app.loop.selectTask("b");
    app.fail();
    await expect(moving).rejects.toThrow("The disk is busy.");
    await going;

    expect(app.loop.snapshot().selectedTaskId).toBe("b");
    expect(app.loop.snapshot().workspace?.path).toBe("C:/work/f2");
    // b is on screen in f2, as going to it showed: f2 was worked in recently.
    expect(app.loop.snapshot().recentWorkspaces.map((f) => f.path)).toContain(
      "C:/work/f2",
    );
  });
});

describe("AgentLoop a folder change whose save fails when the old folder will not open again", () => {
  it("reports the old folder about its conversation, and only while it is on screen", async () => {
    const broken = new Set<string>();
    const app = await heldSave(
      {
        tasks: [
          conversation("a", "Alpha", folder("old")),
          conversation("b", "Beta", folder("b")),
        ],
        selectedTaskId: "a",
        recentWorkspaces: [],
      },
      broken,
    );
    await app.loop.openTask("b");

    app.hold();
    const moving = app.loop.selectWorkspace("C:/work/new");
    await until(app.held);
    broken.add("C:/work/old");
    app.fail();
    await expect(moving).rejects.toThrow("The disk is busy.");

    const aboutOld = () =>
      (app.loop.snapshot().issues ?? []).filter((issue) =>
        issue.message.includes("old"),
      );
    expect(aboutOld().length).toBe(1);
    expect(aboutOld()[0]?.conversationId).toBe("a");
  });

  it("withdraws that report once the old folder opens again", async () => {
    const broken = new Set<string>();
    const app = await heldSave(
      {
        tasks: [
          conversation("a", "Alpha", folder("old")),
          conversation("b", "Beta", folder("b")),
        ],
        selectedTaskId: "a",
        recentWorkspaces: [],
      },
      broken,
    );
    await app.loop.openTask("b");

    app.hold();
    const moving = app.loop.selectWorkspace("C:/work/new");
    await until(app.held);
    broken.add("C:/work/old");
    app.fail();
    await expect(moving).rejects.toThrow("The disk is busy.");

    // The drive comes back; the person goes away and back to the conversation.
    broken.delete("C:/work/old");
    await app.loop.selectTask("b");
    await app.loop.selectTask("a");

    expect(app.tools.at.get("a")).toBe("C:/work/old");
    expect(
      (app.loop.snapshot().issues ?? []).filter((issue) =>
        issue.message.includes("old"),
      ),
    ).toEqual([]);
  });
});

describe("AgentLoop a folder change whose save fails after the same folder was chosen for another conversation", () => {
  it("leaves the other conversation's choice as it was made", async () => {
    const app = await heldSave({
      tasks: [
        conversation("a", "Alpha", folder("f1")),
        conversation("b", "Beta", folder("f3")),
      ],
      selectedTaskId: "a",
      recentWorkspaces: [folder("f1"), folder("f3")],
    });
    await app.loop.openTask("b");

    app.hold();
    const moving = app.loop.selectWorkspace("C:/work/f2");
    await until(app.held);
    const going = app.loop.selectTask("b");
    await until(() => app.loop.snapshot().selectedTaskId === "b");
    const choosing = app.loop.selectWorkspace("C:/work/f2");
    app.fail();
    await expect(moving).rejects.toThrow("The disk is busy.");
    await going;
    await choosing;

    const snapshot = app.loop.snapshot();
    expect(snapshot.tasks.find((t) => t.id === "b")?.workspace?.path).toBe(
      "C:/work/f2",
    );
    expect(snapshot.workspace?.path).toBe("C:/work/f2");
    // b's choice of f2 succeeded, so f2 is the folder worked in most recently.
    expect(snapshot.recentWorkspaces.map((f) => f.path)[0]).toBe("C:/work/f2");
    expect(app.disk()?.recentWorkspaces.map((f) => f.path)[0]).toBe(
      "C:/work/f2",
    );
  });
});

const paste: MessageAttachment = {
  kind: "pastedText",
  id: "pasted-2026-09-24-101500.txt",
  bytes: 48_000,
  lines: 1_200,
};

describe("AgentLoop going back to a conversation whose turn has not yet begun entering its folder", () => {
  it("does not show that folder, nor start a new conversation in it, once it fails to open", async () => {
    const broken = new Set<string>();
    const tools = folders(broken);
    const deps = stubDependencies(() => {});
    const saved: SavedWorkspace = {
      tasks: [
        conversation("reports", "Reports", {
          path: "C:/work/reports",
          name: "reports",
        }),
        conversation("notes", "Notes", {
          path: "C:/work/notes",
          name: "notes",
        }),
      ],
      selectedTaskId: "reports",
      recentWorkspaces: [],
    };
    let releaseClaim = () => {};
    let claiming = false;
    const loop = loopFrom({
      ...deps,
      sessions: {
        ...deps.sessions,
        loadWorkspace: async () => saved,
        claimDrafts: async (_id, ids) => {
          claiming = true;
          await new Promise<void>((resolve) => (releaseClaim = resolve));
          return ids.includes(paste.id) ? [paste] : [];
        },
      },
      workspace: tools.workspace,
      newTaskId: () => "fresh",
    });
    await loop.initialize();
    await loop.openTask("notes");
    expect(loop.snapshot().workspace?.path).toBe("C:/work/reports");

    // The reports folder goes away; a message with a paste is sent in it,
    // and the paste is slow to be claimed.
    broken.add("C:/work/reports");
    const sending = loop
      .start("reports", "Tidy it.", undefined, [paste.id])
      .catch(() => undefined);
    await until(() => claiming);
    await loop.selectTask("notes");
    await loop.selectTask("reports");
    releaseClaim();
    await sending;

    expect(
      (loop.snapshot().issues ?? []).some(
        (issue) =>
          issue.conversationId === "reports" &&
          issue.message.includes("could not be opened"),
      ),
    ).toBe(true);
    // The folder that would not open is not the one shown.
    expect(loop.snapshot().workspace?.path).toBe("C:/work/notes");
    const fresh = await loop.createTask();
    expect(
      loop.snapshot().tasks.find((task) => task.id === fresh)?.workspace?.path,
    ).toBe("C:/work/notes");
  });
});

describe("AgentLoop dismissing one conversation's unopened-folder report when another of the same title has one", () => {
  it("keeps the other conversation's report", async () => {
    const broken = new Set(["C:/usb/one", "C:/usb/two"]);
    const deps = stubDependencies(() => {});
    const saved: SavedWorkspace = {
      tasks: [
        conversation("a", "New task", { path: "C:/usb/one", name: "one" }),
        conversation("b", "New task", { path: "C:/usb/two", name: "two" }),
      ],
      selectedTaskId: "a",
      recentWorkspaces: [],
    };
    const loop = loopFrom({
      ...deps,
      sessions: { ...deps.sessions, loadWorkspace: async () => saved },
      workspace: folders(broken).workspace,
    });
    await loop.initialize();
    await loop.selectTask("b");
    await loop.selectTask("a");
    const aboutA = (loop.snapshot().issues ?? []).find(
      (issue) => issue.conversationId === "a",
    );
    expect(aboutA).toBeDefined();

    await loop.dismissIssue(aboutA!.message, "a");

    expect(loop.snapshot().issues ?? []).not.toContainEqual(
      expect.objectContaining({ conversationId: "a" }),
    );
    expect(loop.snapshot().issues ?? []).toContainEqual(
      expect.objectContaining({ conversationId: "b" }),
    );
  });
});

describe("AgentLoop recent folders spelled two ways", () => {
  it("are offered once", async () => {
    const deps = stubDependencies(() => {});
    let number = 0;
    const loop = loopFrom({
      ...deps,
      workspace: folders(new Set()).workspace,
      newTaskId: () => `task-${++number}`,
    });
    await loop.initialize();
    await loop.createTask();
    await loop.selectWorkspace("C:/Work/Reports");
    await loop.createTask();
    await loop.selectWorkspace("c:/work/reports/");

    expect(loop.snapshot().recentWorkspaces.map((item) => item.path)).toEqual([
      "c:/work/reports/",
    ]);
  });
});
