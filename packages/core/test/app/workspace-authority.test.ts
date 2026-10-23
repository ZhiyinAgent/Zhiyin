/**
 * The folder shown for a conversation and the folder the file tools give it
 * must never point at two different folders. A change that does not complete
 * leaves both where they were, or, when the old folder will not open either,
 * gives the tools none; anything else points the agent at one folder while
 * telling the person it is working in another.
 */

import { realpath, rename } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileSessions } from "@zhiyin/session";
import { WorkspaceTools } from "@zhiyin/tools";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import { stubDependencies, until, loopFrom } from "./support.js";

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

async function temporaryDirectory(label: string) {
  return folders.make(`zhiyin-${label}-`);
}

function loopWithFolders(options: {
  readonly failSaveAfter?: number;
  readonly failSelectFor?: string;
  /** Holds the model open so a turn stays running for as long as the test wants. */
  readonly holdTheTurn?: boolean;
}) {
  /** Each conversation's folder, as the file tools hold it. */
  const roots = new Map<string, string>();
  /** Folders that stopped opening during the test. */
  const broken = new Set<string>();
  const names = new Map<string, string>();
  let saves = 0;
  let releaseTurn = () => {};
  const held = new Promise<void>((resolve) => {
    releaseTurn = resolve;
  });
  const deps = stubDependencies(() => {});
  const loop = loopFrom({
    ...deps,
    model: {
      ...deps.model,
      send: async function* () {
        if (options.holdTheTurn) await held;
        yield { kind: "done" as const };
      },
    },
    sessions: {
      ...deps.sessions,
      saveWorkspace: async () => {
        saves += 1;
        if (
          options.failSaveAfter !== undefined &&
          saves > options.failSaveAfter
        )
          throw new Error("Task history could not be saved.");
      },
    },
    workspace: {
      ...deps.workspace,
      workspaceRoot: (conversationId: string) => roots.get(conversationId),
      enterFolder: async (conversationId: string, path: string) => {
        if (path === options.failSelectFor || broken.has(path))
          throw new Error("The folder is gone.");
        roots.set(conversationId, path);
        return names.get(path) ?? "workspace";
      },
      checkFolder: async (path: string) => {
        if (path === options.failSelectFor)
          throw new Error("The folder is gone.");
        return names.get(path) ?? "workspace";
      },
      leaveFolder: (conversationId: string) => {
        roots.delete(conversationId);
      },
    },
    newTaskId: () => `task-${roots.size}-${Math.random()}`,
  });
  return {
    loop,
    /** Where the file tools would run a conversation's calls right now. */
    toolRoot: (conversationId: string) => roots.get(conversationId),
    name: (path: string, rootName: string) => names.set(path, rootName),
    breaks: (path: string) => broken.add(path),
    releaseTurn: () => releaseTurn(),
  };
}

describe("AgentLoop folder authority", () => {
  it("keeps the shown folder and the tool root together when the folder cannot be saved", async () => {
    const fixture = loopWithFolders({ failSaveAfter: 2 });
    fixture.name("C:/work/reports", "reports");
    fixture.name("C:/work/notes", "notes");
    await fixture.loop.initialize();
    const taskId = await fixture.loop.createTask();
    await fixture.loop.selectWorkspace("C:/work/reports");
    expect(fixture.loop.snapshot().workspace?.path).toBe("C:/work/reports");

    await expect(
      fixture.loop.selectWorkspace("C:/work/notes"),
    ).rejects.toThrow();

    expect(fixture.loop.snapshot().workspace).toEqual({
      path: "C:/work/reports",
      name: "reports",
    });
    expect(fixture.toolRoot(taskId)).toBe("C:/work/reports");
  });

  it("does not record a folder in the recent list when its selection could not be saved", async () => {
    const fixture = loopWithFolders({ failSaveAfter: 2 });
    fixture.name("C:/work/reports", "reports");
    fixture.name("C:/work/notes", "notes");
    await fixture.loop.initialize();
    await fixture.loop.createTask();
    await fixture.loop.selectWorkspace("C:/work/reports");

    await expect(
      fixture.loop.selectWorkspace("C:/work/notes"),
    ).rejects.toThrow();

    expect(fixture.loop.snapshot().recentWorkspaces).toEqual([
      { path: "C:/work/reports", name: "reports" },
    ]);
  });

  it("leaves the open conversation in the folder it was already working in when the save fails", async () => {
    const fixture = loopWithFolders({ failSaveAfter: 2 });
    fixture.name("C:/work/reports", "reports");
    fixture.name("C:/work/notes", "notes");
    await fixture.loop.initialize();
    const taskId = await fixture.loop.createTask();
    await fixture.loop.selectWorkspace("C:/work/reports");

    await expect(
      fixture.loop.selectWorkspace("C:/work/notes"),
    ).rejects.toThrow();

    expect(
      fixture.loop.snapshot().tasks.find((task) => task.id === taskId)
        ?.workspace,
    ).toEqual({ path: "C:/work/reports", name: "reports" });
  });

  /**
   * The choice cannot be saved, and the folder it had will not open any more
   * either. The conversation is then in no folder rather than in the one it is
   * no longer shown in, so its next turn is refused.
   */
  it("takes the conversation out of the folder it was moved to when the save fails and its old folder is gone", async () => {
    const fixture = loopWithFolders({ failSaveAfter: 2 });
    fixture.name("C:/work/reports", "reports");
    fixture.name("C:/work/notes", "notes");
    await fixture.loop.initialize();
    const taskId = await fixture.loop.createTask();
    await fixture.loop.selectWorkspace("C:/work/reports");
    fixture.breaks("C:/work/reports");

    await expect(
      fixture.loop.selectWorkspace("C:/work/notes"),
    ).rejects.toThrow();

    expect(fixture.toolRoot(taskId)).toBeUndefined();
    expect(
      fixture.loop.snapshot().tasks.find((task) => task.id === taskId)
        ?.workspace?.path,
    ).toBe("C:/work/reports");
  });

  /**
   * A folder that will not open never moved anything, so there is nothing to
   * put back — but the person still has to be left looking at the truth.
   */
  it("keeps the shown folder and the tool root together when the folder will not open", async () => {
    const fixture = loopWithFolders({ failSelectFor: "C:/work/notes" });
    fixture.name("C:/work/reports", "reports");
    await fixture.loop.initialize();
    const taskId = await fixture.loop.createTask();
    await fixture.loop.selectWorkspace("C:/work/reports");

    await expect(
      fixture.loop.selectWorkspace("C:/work/notes"),
    ).rejects.toThrow();

    expect(fixture.loop.snapshot().workspace).toEqual({
      path: "C:/work/reports",
      name: "reports",
    });
    expect(fixture.toolRoot(taskId)).toBe("C:/work/reports");
  });

  /**
   * A running turn was approved and planned against one folder. Moving the
   * boundary underneath it would let the rest of that turn act somewhere
   * nobody agreed to.
   */
  it("refuses to move a conversation's folder while its turn is running and leaves its tool root alone", async () => {
    const fixture = loopWithFolders({ holdTheTurn: true });
    fixture.name("C:/work/reports", "reports");
    fixture.name("C:/work/notes", "notes");
    await fixture.loop.initialize();
    const taskId = await fixture.loop.createTask();
    await fixture.loop.selectWorkspace("C:/work/reports");

    const turn = fixture.loop.start(taskId, "Summarise the folder");
    await until(
      () =>
        fixture.loop.snapshot().tasks.find((task) => task.id === taskId)?.phase
          .kind === "working",
    );

    await expect(fixture.loop.selectWorkspace("C:/work/notes")).rejects.toThrow(
      "Stop this conversation's work before changing its folder.",
    );
    expect(fixture.toolRoot(taskId)).toBe("C:/work/reports");
    expect(fixture.loop.snapshot().workspace?.path).toBe("C:/work/reports");

    fixture.releaseTurn();
    await turn;
  });
});

/**
 * The same folder, the same saved file, a new process. These use the real
 * store and the real file tools, because what is being asserted is that the
 * folder a person is shown after a restart is the folder the agent may write
 * in — and neither a fake store nor a fake boundary can establish that.
 */
describe("AgentLoop folder authority across a restart", () => {
  async function launch(dataDirectory: string) {
    const deps = stubDependencies(() => {});
    const tools = new WorkspaceTools();
    const sessions = new FileSessions(dataDirectory);
    const loop = loopFrom({
      ...deps,
      sessions: {
        ...deps.sessions,
        loadWorkspace: () => sessions.loadWorkspace(),
        saveWorkspace: (snapshot) => sessions.saveWorkspace(snapshot),
      },
      workspace: tools,
      newTaskId: () => `task-${Math.random()}`,
    });
    await loop.initialize();
    return { loop, tools };
  }

  it("comes back to the same folder the file tools are rooted in", async () => {
    const data = await temporaryDirectory("data");
    const work = await temporaryDirectory("work");
    const first = await launch(data);
    const taskId = await first.loop.createTask();
    await first.loop.selectWorkspace(work);
    const shown = first.loop.snapshot().workspace;

    const second = await launch(data);
    await second.loop.start(taskId, "List the folder.");

    expect(second.loop.snapshot().workspace).toEqual(shown);
    expect(second.tools.workspaceRoot(taskId)).toBe(await realpath(work));
    expect(second.loop.snapshot().issues ?? []).toEqual([]);
  });

  it("says the folder has moved instead of rooting the tools somewhere else", async () => {
    const data = await temporaryDirectory("data");
    const work = await temporaryDirectory("work");
    const first = await launch(data);
    const taskId = await first.loop.createTask();
    await first.loop.selectWorkspace(work);

    await rename(work, join(await temporaryDirectory("moved"), "work"));
    const second = await launch(data);

    await expect(second.loop.start(taskId, "List the folder.")).rejects.toThrow(
      "The folder for this conversation could not be opened.",
    );
    expect(second.tools.workspaceRoot(taskId)).toBeUndefined();
    expect(
      second.loop
        .snapshot()
        .issues?.map((issue) => issue.message)
        .join(" "),
    ).toContain("Choose its new location before using files.");
  });

  it("says once, about the conversation on screen, that its folder has moved", async () => {
    const data = await temporaryDirectory("data");
    const work = await temporaryDirectory("work");
    const first = await launch(data);
    const taskId = await first.loop.createTask();
    await first.loop.selectWorkspace(work);

    await rename(work, join(await temporaryDirectory("moved"), "work"));
    const second = await launch(data);

    expect(second.loop.snapshot().issues).toEqual([
      {
        message:
          "The folder for “New task” could not be opened. Choose its new location before using files.",
        conversationId: taskId,
      },
    ]);
  });
});

describe("the folder shown, gone at launch", () => {
  async function launch(dataDirectory: string) {
    const deps = stubDependencies(() => {});
    const sessions = new FileSessions(dataDirectory);
    const loop = loopFrom({
      ...deps,
      sessions: {
        ...deps.sessions,
        loadWorkspace: () => sessions.loadWorkspace(),
        saveWorkspace: (snapshot) => sessions.saveWorkspace(snapshot),
      },
      workspace: new WorkspaceTools(),
      newTaskId: () => `task-${Math.random()}`,
    });
    await loop.initialize();
    return loop;
  }

  it("is still reported after another conversation's folder opens off screen", async () => {
    const data = await temporaryDirectory("data");
    const gone = await temporaryDirectory("gone");
    const here = await temporaryDirectory("here");
    const first = await launch(data);
    const other = await first.createTask();
    await first.selectWorkspace(here);
    await first.start(other, "Hello");
    await first.createTask();
    await first.selectWorkspace(gone);
    await first.selectNothing();

    await rename(gone, join(await temporaryDirectory("moved"), "gone"));
    const second = await launch(data);
    await second.openTask(other);
    await second.start(other, "Again");

    expect(second.snapshot().selectedTaskId).toBeNull();
    expect(second.snapshot().workspace?.path).toBe(gone);
    expect(second.snapshot().issues).toEqual([
      {
        message:
          "The selected folder is unavailable. Choose its new location before using files.",
      },
    ]);
  });
});

describe("a conversation whose folder moved", () => {
  it("says so about that conversation alone, so it is not shown over the others", async () => {
    const data = await temporaryDirectory("data");
    const gone = await temporaryDirectory("gone");
    const here = await temporaryDirectory("here");
    const deps = stubDependencies(() => {});
    const tools = new WorkspaceTools();
    const sessions = new FileSessions(data);
    const loop = loopFrom({
      ...deps,
      sessions: {
        ...deps.sessions,
        loadWorkspace: () => sessions.loadWorkspace(),
        saveWorkspace: (snapshot) => sessions.saveWorkspace(snapshot),
      },
      workspace: tools,
      newTaskId: () => `task-${Math.random()}`,
    });
    await loop.initialize();
    const moved = await loop.createTask();
    await loop.selectWorkspace(gone);
    const other = await loop.createTask();
    await loop.selectWorkspace(here);
    await rename(gone, join(await temporaryDirectory("moved"), "gone"));

    await loop.selectTask(moved);

    expect(loop.snapshot().issues).toEqual([
      expect.objectContaining({
        conversationId: moved,
        message: expect.stringContaining("could not be opened"),
      }),
    ]);
    await loop.selectTask(other);
    expect(loop.snapshot().selectedTaskId).toBe(other);
  });
});
