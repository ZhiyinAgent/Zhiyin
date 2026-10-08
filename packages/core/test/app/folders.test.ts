/**
 * Which folder a conversation works in, which folders were worked in recently,
 * and what opening a conversation does to both. All of it is the core's: the
 * turn only asks to be put in its conversation's folder before it runs.
 */

import { describe, expect, it } from "vitest";
import { stubDependencies, loopFrom } from "./support.js";

/**
 * Starting a new conversation and then choosing a folder for it. The folder
 * change re-sends the whole snapshot, and a snapshot carries which
 * conversation is open — so if the core still believes the previous one is
 * open, choosing a folder throws the person back into it.
 */
describe("AgentLoop starting fresh", () => {
  it("stays out of the old conversation when a folder is chosen for a new one", async () => {
    const root = { name: "reports" };
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      workspace: {
        ...deps.workspace,
        describeWorkspace: async () => ({
          rootName: root.name,
          entries: [],
          truncated: false,
        }),
        selectWorkspace: async () => {},
      },
      newTaskId: () => `task-${Math.random()}`,
    });
    await loop.initialize();
    const existing = await loop.createTask();
    expect(loop.snapshot().selectedTaskId).toBe(existing);

    await loop.selectNothing();
    expect(loop.snapshot().selectedTaskId).toBeNull();

    root.name = "notes";
    await loop.selectWorkspace("C:/work/notes");

    expect(loop.snapshot().selectedTaskId).toBeNull();
    // And the folder was not quietly recorded against the conversation that
    // happened to be open before.
    expect(
      loop.snapshot().tasks.find((task) => task.id === existing)?.workspace,
    ).toBeUndefined();
  });

  it("gives a conversation created afterwards the folder that was chosen", async () => {
    const root = { name: "notes" };
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      workspace: {
        ...deps.workspace,
        describeWorkspace: async () => ({
          rootName: root.name,
          entries: [],
          truncated: false,
        }),
        selectWorkspace: async () => {},
      },
      newTaskId: () => `task-${Math.random()}`,
    });
    await loop.initialize();
    await loop.selectNothing();
    await loop.selectWorkspace("C:/work/notes");

    const fresh = await loop.createTask();

    expect(
      loop.snapshot().tasks.find((task) => task.id === fresh)?.workspace,
    ).toEqual({ path: "C:/work/notes", name: "notes" });
  });
});

describe("AgentLoop recent folders", () => {
  function loopOver(root: { name: string }, failFor?: string) {
    const deps = stubDependencies(() => {});
    const chosen: string[] = [];
    return {
      chosen,
      loop: loopFrom({
        ...deps,
        workspace: {
          ...deps.workspace,
          describeWorkspace: async () => ({
            rootName: root.name,
            entries: [],
            truncated: false,
          }),
          selectWorkspace: async (path: string) => {
            if (path === failFor) throw new Error("The folder is gone.");
            chosen.push(path);
          },
        },
      }),
    };
  }

  it("keeps folders worked in, most recent first", async () => {
    const root = { name: "one" };
    const { loop } = loopOver(root);
    await loop.initialize();

    await loop.selectWorkspace("C:/work/one");
    root.name = "two";
    await loop.selectWorkspace("C:/work/two");

    expect(loop.snapshot().recentWorkspaces).toEqual([
      { path: "C:/work/two", name: "two" },
      { path: "C:/work/one", name: "one" },
    ]);
  });

  /**
   * The list exists so a person can get back to a folder they left. Counting
   * visits rather than folders would let a run of work in one folder push out
   * every folder the list was for.
   */
  it("counts a folder once however often it is returned to", async () => {
    const root = { name: "one" };
    const { loop } = loopOver(root);
    await loop.initialize();

    for (const [path, name] of [
      ["C:/work/one", "one"],
      ["C:/work/two", "two"],
      ["C:/work/one", "one"],
      ["C:/work/one", "one"],
    ] as const) {
      root.name = name;
      await loop.selectWorkspace(path);
    }

    expect(loop.snapshot().recentWorkspaces).toEqual([
      { path: "C:/work/one", name: "one" },
      { path: "C:/work/two", name: "two" },
    ]);
  });

  it("offers no more than five folders", async () => {
    const root = { name: "" };
    const { loop } = loopOver(root);
    await loop.initialize();

    for (let index = 1; index <= 7; index += 1) {
      root.name = `folder-${index}`;
      await loop.selectWorkspace(`C:/work/${index}`);
    }

    expect(loop.snapshot().recentWorkspaces).toEqual([
      { path: "C:/work/7", name: "folder-7" },
      { path: "C:/work/6", name: "folder-6" },
      { path: "C:/work/5", name: "folder-5" },
      { path: "C:/work/4", name: "folder-4" },
      { path: "C:/work/3", name: "folder-3" },
    ]);
  });
});

/**
 * A conversation is about the files it is about. Opening one from last week
 * should not silently point it at whatever folder happens to be selected now,
 * and a turn must run where its conversation lives rather than where the
 * window was last left.
 */
describe("AgentLoop per-conversation folders", () => {
  function loopOver(root: { name: string }, failFor?: string) {
    const deps = stubDependencies(() => {});
    const opened: string[] = [];
    return {
      opened,
      loop: loopFrom({
        ...deps,
        workspace: {
          ...deps.workspace,
          describeWorkspace: async () => ({
            rootName: root.name,
            entries: [],
            truncated: false,
          }),
          selectWorkspace: async (path: string) => {
            if (path === failFor) throw new Error("The folder is gone.");
            opened.push(path);
          },
        },
        newTaskId: () => `task-${opened.length}-${Math.random()}`,
      }),
    };
  }

  it("records the folder a conversation was last worked in", async () => {
    const root = { name: "reports" };
    const { loop } = loopOver(root);
    await loop.initialize();
    const taskId = await loop.createTask();

    await loop.selectWorkspace("C:/work/reports");

    expect(
      loop.snapshot().tasks.find((task) => task.id === taskId)?.workspace,
    ).toEqual({ path: "C:/work/reports", name: "reports" });
  });

  it("returns to a conversation's folder when it is reopened", async () => {
    const root = { name: "reports" };
    const { loop, opened } = loopOver(root);
    await loop.initialize();

    const reports = await loop.createTask();
    await loop.selectWorkspace("C:/work/reports");

    root.name = "notes";
    const notes = await loop.createTask();
    await loop.selectWorkspace("C:/work/notes");
    expect(loop.snapshot().workspace?.path).toBe("C:/work/notes");

    root.name = "reports";
    opened.length = 0;
    await loop.selectTask(reports);

    expect(opened).toEqual(["C:/work/reports"]);
    expect(loop.snapshot().workspace).toEqual({
      path: "C:/work/reports",
      name: "reports",
    });
    void notes;
  });

  it("leaves a conversation that has never named a folder where it is", async () => {
    const root = { name: "reports" };
    const { loop, opened } = loopOver(root);
    await loop.initialize();

    const first = await loop.createTask();
    await loop.selectWorkspace("C:/work/reports");
    const fresh = await loop.createTask();

    opened.length = 0;
    await loop.selectTask(fresh);

    expect(opened).toEqual([]);
    expect(loop.snapshot().workspace?.path).toBe("C:/work/reports");
    void first;
  });

  /**
   * The folder can be gone by the time the conversation is reopened. Selecting
   * it must still work, must not pretend the folder was restored, and must say
   * so rather than quietly running the next turn somewhere else.
   */
  it("says so when a conversation's folder can no longer be opened", async () => {
    const root = { name: "reports" };
    const deps = stubDependencies(() => {});
    let broken = false;
    const loop = loopFrom({
      ...deps,
      workspace: {
        ...deps.workspace,
        describeWorkspace: async () => ({
          rootName: root.name,
          entries: [],
          truncated: false,
        }),
        selectWorkspace: async (path: string) => {
          if (broken && path === "C:/work/reports")
            throw new Error("The folder is gone.");
        },
      },
      newTaskId: () => `task-${Math.random()}`,
    });
    await loop.initialize();

    const reports = await loop.createTask();
    await loop.selectWorkspace("C:/work/reports");
    root.name = "notes";
    await loop.createTask();
    await loop.selectWorkspace("C:/work/notes");

    broken = true;
    await loop.selectTask(reports);

    expect(loop.snapshot().selectedTaskId).toBe(reports);
    // Not silently relabelled as the folder it failed to open.
    expect(loop.snapshot().workspace?.path).toBe("C:/work/notes");
    expect(
      loop
        .snapshot()
        .issues?.map((issue) => issue.message)
        .join(" "),
    ).toMatch(/could not be opened/i);
  });
});
