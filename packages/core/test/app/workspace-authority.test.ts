/**
 * The folder shown in the window and the folder the file tools may touch are
 * two pieces of state that must never disagree. A change that does not
 * complete has to leave both where they were; anything else points the agent
 * at one folder while telling the person it is working in another.
 */

import { mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileSessions } from "@zhiyin/session";
import { WorkspaceTools } from "@zhiyin/tools";
import { stubDependencies, until, loopFrom } from "./support.js";

const temporary: string[] = [];

async function temporaryDirectory(label: string) {
  const path = await mkdtemp(join(tmpdir(), `zhiyin-${label}-`));
  temporary.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

function loopWithFolders(options: {
  readonly failSaveAfter?: number;
  readonly failSelectFor?: string;
  /** Holds the model open so a turn stays running for as long as the test wants. */
  readonly holdTheTurn?: boolean;
}) {
  const opened: string[] = [];
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
      describeWorkspace: async () => ({
        rootName: names.get(opened.at(-1) ?? "") ?? "workspace",
        entries: [],
        truncated: false,
      }),
      workspaceRoot: () => opened.at(-1),
      selectWorkspace: async (path: string) => {
        if (path === options.failSelectFor)
          throw new Error("The folder is gone.");
        opened.push(path);
      },
    },
    newTaskId: () => `task-${opened.length}-${Math.random()}`,
  });
  return {
    loop,
    /** Where the file tools would actually run right now. */
    toolRoot: () => opened.at(-1),
    name: (path: string, rootName: string) => names.set(path, rootName),
    releaseTurn: () => releaseTurn(),
  };
}

describe("AgentLoop folder authority", () => {
  it("keeps the shown folder and the tool root together when the folder cannot be saved", async () => {
    const fixture = loopWithFolders({ failSaveAfter: 2 });
    fixture.name("C:/work/reports", "reports");
    fixture.name("C:/work/notes", "notes");
    await fixture.loop.initialize();
    await fixture.loop.createTask();
    await fixture.loop.selectWorkspace("C:/work/reports");
    expect(fixture.loop.snapshot().workspace?.path).toBe("C:/work/reports");

    await expect(
      fixture.loop.selectWorkspace("C:/work/notes"),
    ).rejects.toThrow();

    expect(fixture.loop.snapshot().workspace).toEqual({
      path: "C:/work/reports",
      name: "reports",
    });
    expect(fixture.toolRoot()).toBe("C:/work/reports");
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
   * A folder that will not open never moved anything, so there is nothing to
   * put back — but the person still has to be left looking at the truth.
   */
  it("keeps the shown folder and the tool root together when the folder will not open", async () => {
    const fixture = loopWithFolders({ failSelectFor: "C:/work/notes" });
    fixture.name("C:/work/reports", "reports");
    await fixture.loop.initialize();
    await fixture.loop.createTask();
    await fixture.loop.selectWorkspace("C:/work/reports");

    await expect(
      fixture.loop.selectWorkspace("C:/work/notes"),
    ).rejects.toThrow();

    expect(fixture.loop.snapshot().workspace).toEqual({
      path: "C:/work/reports",
      name: "reports",
    });
    expect(fixture.toolRoot()).toBe("C:/work/reports");
  });

  /**
   * A running turn was approved and planned against one folder. Moving the
   * boundary underneath it would let the rest of that turn act somewhere
   * nobody agreed to.
   */
  it("refuses to move the folder while a turn is running and leaves the tool root alone", async () => {
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
      "Stop running tasks before changing the folder.",
    );
    expect(fixture.toolRoot()).toBe("C:/work/reports");
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
        list: () => sessions.list(),
      },
      workspace: {
        describeWorkspace: () => tools.describeWorkspace(),
        workspaceRoot: () => tools.workspaceRoot(),
        selectWorkspace: (path: string) => tools.selectWorkspace(path),
      },
      newTaskId: () => `task-${Math.random()}`,
    });
    await loop.initialize();
    return { loop, tools };
  }

  it("comes back to the same folder the file tools are rooted in", async () => {
    const data = await temporaryDirectory("data");
    const work = await temporaryDirectory("work");
    const first = await launch(data);
    await first.loop.createTask();
    await first.loop.selectWorkspace(work);
    const shown = first.loop.snapshot().workspace;

    const second = await launch(data);

    expect(second.loop.snapshot().workspace).toEqual(shown);
    expect(second.tools.workspaceRoot()).toBeDefined();
    expect(second.loop.snapshot().issues ?? []).toEqual([]);
  });

  it("says the folder has moved instead of rooting the tools somewhere else", async () => {
    const data = await temporaryDirectory("data");
    const work = await temporaryDirectory("work");
    const first = await launch(data);
    await first.loop.createTask();
    await first.loop.selectWorkspace(work);

    await rename(work, `${work}-moved`);
    temporary.push(`${work}-moved`);
    const second = await launch(data);

    expect(second.tools.workspaceRoot()).toBeUndefined();
    expect(
      second.loop
        .snapshot()
        .issues?.map((issue) => issue.message)
        .join(" "),
    ).toContain("Choose its new location before using files.");
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
        list: () => sessions.list(),
      },
      workspace: {
        describeWorkspace: () => tools.describeWorkspace(),
        workspaceRoot: () => tools.workspaceRoot(),
        selectWorkspace: (path: string) => tools.selectWorkspace(path),
      },
      newTaskId: () => `task-${Math.random()}`,
    });
    await loop.initialize();
    const moved = await loop.createTask();
    await loop.selectWorkspace(gone);
    const other = await loop.createTask();
    await loop.selectWorkspace(here);
    await rename(gone, `${gone}-moved`);
    temporary.push(`${gone}-moved`);

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
