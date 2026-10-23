/**
 * What opening a conversation does when the person, or the conversation's own
 * work, moves on while it is still being read or its folder opened.
 */

import { rename } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  emptyConversationLists,
  type AppEvent,
  type WorkspaceTask,
} from "@zhiyin/contract";
import { FileSessions, type Sessions } from "@zhiyin/session";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import { WorkspaceTools } from "@zhiyin/tools";
import { loopFrom, stubDependencies, until } from "./support.js";

const temporary = new TemporaryFolders();

afterEach(() => temporary.removeAll());

function conversation(index: number): WorkspaceTask {
  return {
    id: `task-${index}`,
    title: `Conversation ${index}`,
    titleSource: "manual",
    updatedAt: "2026-09-01T10:00:00.000Z",
    updatedLabel: "Earlier",
    ...emptyConversationLists,
    messages: [],
    actions: [],
    phase: { kind: "completed", outcome: { title: "Done", summary: "Done." } },
  };
}

/**
 * Three saved conversations, the reading of the third held until released;
 * with folders, each in its own.
 */
async function readingHeld(options: { readonly folders?: boolean } = {}) {
  const root = await temporary.make("zhiyin-reading-");
  await new FileSessions(root).saveWorkspace({
    tasks: [0, 1, 2].map((index) =>
      options.folders
        ? {
            ...conversation(index),
            workspace: { path: `C:/work/f${index}`, name: `f${index}` },
          }
        : conversation(index),
    ),
    selectedTaskId: "task-1",
    recentWorkspaces: [],
  });
  const sessions = new FileSessions(root);
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  const reading: string[] = [];
  const slow: Sessions = new Proxy(sessions, {
    get(target, key) {
      if (key === "openConversation")
        return async (id: string) => {
          reading.push(id);
          if (id === "task-2") await held;
          return target.openConversation(id);
        };
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const events: AppEvent[] = [];
  const loop = loopFrom({
    ...stubDependencies((event) => events.push(event)),
    sessions: slow,
    revealDelayMs: 0,
    newTaskId: () => "fresh-task",
    ...(options.folders
      ? {
          workspace: {
            workspaceRoot: () => undefined,
            describeWorkspace: async () => ({
              rootName: "folder",
              entries: [],
              truncated: false,
            }),
            enterFolder: async (_id: string, path: string) =>
              path.split("/").pop() ?? path,
            checkFolder: async (path: string) => path.split("/").pop() ?? path,
            leaveFolder: () => {},
          },
        }
      : {}),
  });
  await loop.initialize();
  /** The conversation the window was last told is on screen. */
  const windowSelection = () => {
    let selected: string | null | undefined;
    for (const event of events) {
      if (event.kind === "taskSelectionChanged") selected = event.data.taskId;
      if (event.kind === "taskRemoved") selected = event.data.selectedTaskId;
    }
    return selected;
  };
  return { loop, release, reading, windowSelection };
}

describe("AgentLoop a conversation still being read when the person moves on", () => {
  it("does not take the window back from the one the person went to", async () => {
    const { loop, release, reading } = await readingHeld();
    const going = loop.selectTask("task-2");
    await until(() => reading.includes("task-2"));
    await loop.selectTask("task-0");

    release();
    await going;

    expect(loop.snapshot().selectedTaskId).toBe("task-0");
  });

  it("does not take the window back when the person went to no conversation", async () => {
    const { loop, release, reading } = await readingHeld();
    const going = loop.selectTask("task-2");
    await until(() => reading.includes("task-2"));
    await loop.selectNothing();

    release();
    await going;

    expect(loop.snapshot().selectedTaskId).toBeNull();
  });

  it("neither shows nor reopens one deleted while it was read", async () => {
    const { loop, release, reading } = await readingHeld();
    const going = loop.selectTask("task-2");
    await until(() => reading.includes("task-2"));
    await loop.deleteTask("task-2");

    release();
    await going.catch(() => undefined);

    expect(loop.snapshot().selectedTaskId).not.toBe("task-2");
    expect(loop.snapshot().tasks.map((task) => task.id)).not.toContain(
      "task-2",
    );
    expect(
      (loop.snapshot().conversations ?? []).map((item) => item.id),
    ).not.toContain("task-2");
    expect(loop.snapshot().issues ?? []).toEqual([]);
  });
});

describe("AgentLoop deleting the conversation on screen while the next one is still read", () => {
  it("keeps the window, and its folder, on the conversation the person went to", async () => {
    const { loop, release, reading, windowSelection } = await readingHeld({
      folders: true,
    });
    await loop.selectTask("task-0");
    await loop.selectTask("task-1");
    const deleting = loop.deleteTask("task-1");
    await until(() => reading.includes("task-2"));
    await loop.selectTask("task-0");

    release();
    await deleting;

    expect(loop.snapshot().selectedTaskId).toBe("task-0");
    expect(windowSelection()).toBe("task-0");
    expect(loop.snapshot().workspace?.path).toBe("C:/work/f0");
  });

  it("keeps a conversation created meanwhile on screen", async () => {
    const { loop, release, reading, windowSelection } = await readingHeld({
      folders: true,
    });
    const deleting = loop.deleteTask("task-1");
    await until(() => reading.includes("task-2"));
    const fresh = await loop.createTask();

    release();
    await deleting;

    expect(loop.snapshot().selectedTaskId).toBe(fresh);
    expect(windowSelection()).toBe(fresh);
  });
});

describe("AgentLoop a conversation still being read when a new one is created", () => {
  it("does not take the window back from the new one", async () => {
    const { loop, release, reading } = await readingHeld();
    const going = loop.selectTask("task-2");
    await until(() => reading.includes("task-2"));
    const fresh = await loop.createTask();

    release();
    await going;

    expect(loop.snapshot().selectedTaskId).toBe(fresh);
  });
});

describe("AgentLoop a conversation woken off screen whose folder will not open", () => {
  it("is reported about that conversation, and the model is not asked", async () => {
    const root = await temporary.make("zhiyin-resume-");
    const waiting: WorkspaceTask = {
      ...conversation(1),
      workspace: { path: "C:/work/gone", name: "gone" },
      specialistRuns: [
        {
          id: "saved-review",
          specialist: {
            id: "engineering/reviewer",
            name: "Reviewer",
            description: "Reviews work.",
            instructions: "Review evidence.",
            provenance: { source: "plugin", pluginId: "engineering" },
          },
          task: "Review the change",
          depth: 1,
          sequence: 1,
          status: "completed",
          startedAt: "2026-09-01T09:00:00.000Z",
          finishedAt: "2026-09-01T09:01:00.000Z",
          actionIds: [],
          handoff: { report: "All clear." },
          handoffDelivered: false,
        },
      ],
    };
    await new FileSessions(root).saveWorkspace({
      tasks: [conversation(0), waiting],
      selectedTaskId: "task-0",
      recentWorkspaces: [],
    });
    const deps = stubDependencies(() => {});
    const tried: string[] = [];
    const asked: string[] = [];
    const loop = loopFrom({
      ...deps,
      sessions: new FileSessions(root),
      revealDelayMs: 0,
      workspace: {
        describeWorkspace: async () => ({
          rootName: "folder",
          entries: [],
          truncated: false,
        }),
        workspaceRoot: () => undefined,
        enterFolder: async (id: string, path: string) => {
          tried.push(`${id} ${path}`);
          if (path === "C:/work/gone") throw new Error("The folder is gone.");
          return "folder";
        },
        checkFolder: async () => "folder",
        leaveFolder: () => {},
      },
      model: {
        ...deps.model,
        send: async function* (request) {
          asked.push(JSON.stringify(request.messages));
          yield { kind: "textDelta" as const, text: "I read the review." };
          yield { kind: "done" as const };
        },
      },
    });
    await loop.initialize();
    await loop.connectionsReady();

    await loop.openTask("task-1");
    await until(() => tried.includes("task-1 C:/work/gone"));
    await until(() => (loop.snapshot().issues ?? []).length > 0);

    expect(asked).toEqual([]);
    expect(loop.snapshot().issues).toEqual([
      {
        message:
          "The folder for “Conversation 1” could not be opened. Choose its new location before using files.",
        conversationId: "task-1",
      },
    ]);
  });
});

describe("AgentLoop the folder shown, gone at launch, when a working conversation is gone to", () => {
  it("is no longer reported once that conversation's folder is shown in its place", async () => {
    const data = await temporary.make("zhiyin-data-");
    const gone = await temporary.make("zhiyin-gone-");
    const here = await temporary.make("zhiyin-here-");
    let holdModel = false;
    let asked = false;
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    const launch = async () => {
      const deps = stubDependencies(() => {});
      const sessions = new FileSessions(data);
      const loop = loopFrom({
        ...deps,
        sessions: {
          ...deps.sessions,
          loadWorkspace: () => sessions.loadWorkspace(),
          saveWorkspace: (snapshot) => sessions.saveWorkspace(snapshot),
        },
        workspace: new WorkspaceTools(),
        model: {
          ...deps.model,
          send: async function* () {
            if (holdModel) {
              asked = true;
              await held;
            }
            yield { kind: "done" as const };
          },
        },
        newTaskId: () => `task-${Math.random()}`,
      });
      await loop.initialize();
      return loop;
    };
    const first = await launch();
    const working = await first.createTask();
    await first.selectWorkspace(here);
    await first.start(working, "Hello");
    await first.createTask();
    await first.selectWorkspace(gone);
    await first.selectNothing();
    await rename(gone, join(await temporary.make("zhiyin-moved-"), "gone"));
    const second = await launch();
    await second.openTask(working);
    holdModel = true;
    const turn = second.start(working, "Again");
    await until(() => asked);

    await second.selectTask(working);

    expect(second.snapshot().workspace?.path).toBe(here);
    expect(second.snapshot().issues ?? []).toEqual([]);
    release();
    await turn;
  });
});

describe("AgentLoop going back to a conversation whose turn is still entering its folder", () => {
  it("does not show that folder, nor start a new conversation in it, once it fails to open", async () => {
    const held = new Map<string, Promise<void>>();
    const broken = new Set<string>();
    let number = 0;
    const loop = loopFrom({
      ...stubDependencies(() => {}),
      workspace: {
        workspaceRoot: () => undefined,
        describeWorkspace: async () => ({
          rootName: "folder",
          entries: [],
          truncated: false,
        }),
        enterFolder: async (_id: string, path: string) => {
          await held.get(path);
          if (broken.has(path)) throw new Error("The folder is gone.");
          return path.split("/").pop() ?? path;
        },
        checkFolder: async (path: string) => {
          await held.get(path);
          if (broken.has(path)) throw new Error("The folder is gone.");
          return path.split("/").pop() ?? path;
        },
        leaveFolder: () => {},
      },
      newTaskId: () => `task-${++number}`,
    });
    await loop.initialize();
    const reports = await loop.createTask();
    await loop.selectWorkspace("C:/work/reports");
    const notes = await loop.createTask();
    await loop.selectWorkspace("C:/work/notes");
    await loop.selectTask(reports);
    // The reports folder goes away, and its turn is slow to find out.
    broken.add("C:/work/reports");
    let release = () => {};
    held.set(
      "C:/work/reports",
      new Promise<void>((resolve) => (release = resolve)),
    );
    const sending = loop.start(reports, "Tidy it.").catch(() => undefined);
    await until(() => loop.turns.running(reports));
    await loop.selectTask(notes);

    const back = loop.selectTask(reports);
    held.delete("C:/work/reports");
    release();
    await back;
    await sending;

    expect(
      (loop.snapshot().issues ?? []).some((issue) =>
        issue.message.includes("could not be opened"),
      ),
    ).toBe(true);
    expect(loop.snapshot().workspace?.path).toBe("C:/work/notes");
    const fresh = await loop.createTask();
    expect(
      loop.snapshot().tasks.find((task) => task.id === fresh)?.workspace?.path,
    ).toBe("C:/work/notes");
  });
});

/** Four saved conversations, task-1 on screen; reading any other is held until released. */
async function eachReadingHeld() {
  const root = await temporary.make("zhiyin-r10-");
  await new FileSessions(root).saveWorkspace({
    tasks: [0, 1, 2, 3].map((index) => ({
      ...conversation(index),
    })),
    selectedTaskId: "task-1",
    recentWorkspaces: [],
  });
  const sessions = new FileSessions(root);
  const gates = new Map<string, () => void>();
  const holding = new Set<string>();
  const reading: string[] = [];
  const slow: Sessions = new Proxy(sessions, {
    get(target, key) {
      if (key === "openConversation")
        return async (id: string) => {
          reading.push(id);
          if (holding.has(id))
            await new Promise<void>((resolve) => gates.set(id, resolve));
          return target.openConversation(id);
        };
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const events: AppEvent[] = [];
  const loop = loopFrom({
    ...stubDependencies((event) => events.push(event)),
    sessions: slow,
    revealDelayMs: 0,
    newTaskId: () => "fresh-task",
  });
  await loop.initialize();
  reading.length = 0;
  for (const id of ["task-0", "task-2", "task-3"]) holding.add(id);
  const windowSelection = () => {
    let selected: string | null | undefined;
    for (const event of events) {
      if (event.kind === "taskSelectionChanged") selected = event.data.taskId;
      if (event.kind === "taskRemoved") selected = event.data.selectedTaskId;
    }
    return selected;
  };
  const release = async (id: string) => {
    await until(() => gates.has(id));
    gates.get(id)?.();
  };
  return { loop, reading, release, windowSelection };
}

describe("AgentLoop deleting the conversation on screen while the next one is read, and another one is gone to", () => {
  it("never leaves the deleted conversation as the one on screen", async () => {
    const { loop, reading, release } = await eachReadingHeld();
    const deleting = loop.deleteTask("task-1");
    await until(() => reading.length > 0);
    const next = reading[0] as string;
    const other = ["task-0", "task-2", "task-3"].find((id) => id !== next)!;
    const going = loop.selectTask(other);
    await until(() => reading.includes(other));
    // The conversation gone to is deleted too, before it was read.
    await loop.deleteTask(other);
    await release(next);
    await deleting;
    await release(other);
    await going.catch(() => undefined);

    const selected = loop.snapshot().selectedTaskId;
    expect(selected).not.toBe("task-1");
    expect(selected).not.toBe(other);
  });

  it("does not tell the window the deleted conversation is on screen", async () => {
    const { loop, reading, release, windowSelection } = await eachReadingHeld();
    const deleting = loop.deleteTask("task-1");
    await until(() => reading.length > 0);
    const next = reading[0] as string;
    const other = ["task-0", "task-2", "task-3"].find((id) => id !== next)!;
    const going = loop.selectTask(other);
    await until(() => reading.includes(other));
    await release(next);
    await deleting;

    expect(windowSelection()).not.toBe("task-1");
    expect(loop.snapshot().selectedTaskId).not.toBe("task-1");
    await release(other);
    await going;
    expect(loop.snapshot().selectedTaskId).toBe(other);
  });
});

describe("AgentLoop going to a conversation, then to a new one while that is still being saved", () => {
  it("leaves the window told the conversation the core has open", async () => {
    const events: AppEvent[] = [];
    const deps = stubDependencies((event) => events.push(event));
    let holdNext = false;
    let release: (() => void) | undefined;
    const inFolder = (index: number): WorkspaceTask => ({
      ...conversation(index),
      workspace: { path: "C:/work/f", name: "f" },
    });
    const loop = loopFrom({
      ...deps,
      sessions: {
        ...deps.sessions,
        loadWorkspace: async () => ({
          tasks: [inFolder(0), inFolder(1)],
          selectedTaskId: "task-0",
          workspace: { path: "C:/work/f", name: "f" },
          recentWorkspaces: [{ path: "C:/work/f", name: "f" }],
        }),
        saveWorkspace: async () => {
          if (!holdNext) return;
          holdNext = false;
          await new Promise<void>((resolve) => (release = resolve));
        },
      },
      workspace: {
        workspaceRoot: () => undefined,
        describeWorkspace: async () => ({
          rootName: "folder",
          entries: [],
          truncated: false,
        }),
        enterFolder: async (_id: string, path: string) =>
          path.split("/").pop() ?? path,
        checkFolder: async (path: string) => path.split("/").pop() ?? path,
        leaveFolder: () => {},
      },
      newTaskId: () => "fresh-task",
    });
    await loop.initialize();

    holdNext = true;
    const going = loop.selectTask("task-1");
    await until(() => release !== undefined);
    await loop.selectNothing();
    const fresh = await loop.createTask();
    release?.();
    await going;

    const told = events.filter(
      (event) =>
        event.kind === "taskSelectionChanged" ||
        event.kind === "workspaceSnapshot",
    );
    const last = told.at(-1);
    const toldOnScreen =
      last?.kind === "workspaceSnapshot"
        ? last.data.selectedTaskId
        : last?.kind === "taskSelectionChanged"
          ? last.data.taskId
          : undefined;
    expect(loop.snapshot().selectedTaskId).toBe(fresh);
    expect(toldOnScreen).toBe(fresh);
  });
});
