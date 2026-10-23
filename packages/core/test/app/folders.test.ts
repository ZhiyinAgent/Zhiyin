/**
 * Which folder a conversation works in, which folders were worked in recently,
 * and what opening a conversation does to both. All of it is the core's: the
 * turn only asks to be put in its conversation's folder before it runs. Each
 * conversation has a folder of its own (ADR 0008).
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileSessions, type SavedWorkspace } from "@zhiyin/session";
import type { AppEvent } from "@zhiyin/contract";
import type { ModelRequest } from "@zhiyin/model-client";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import { WorkspaceTools } from "@zhiyin/tools";
import {
  loopFrom,
  pluginStore,
  pluginView,
  stubDependencies,
  until,
} from "./support.js";

const temporary = new TemporaryFolders();

afterEach(() => temporary.removeAll());

/**
 * The folders as the tools keep them, stood in for: each folder is named
 * `root.name` when entered, and `broken` names one that will not open.
 */
function folders(root: { name: string }, broken?: () => string | undefined) {
  const entered: (readonly [string, string])[] = [];
  const left: string[] = [];
  return {
    entered,
    left,
    workspace: {
      describeWorkspace: async () => ({
        rootName: root.name,
        entries: [],
        truncated: false,
      }),
      workspaceRoot: () => undefined,
      enterFolder: async (conversationId: string, path: string) => {
        if (path === broken?.()) throw new Error("The folder is gone.");
        entered.push([conversationId, path]);
        return root.name;
      },
      checkFolder: async (path: string) => {
        if (path === broken?.()) throw new Error("The folder is gone.");
        return root.name;
      },
      leaveFolder: (conversationId: string) => {
        left.push(conversationId);
      },
    },
  };
}

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
    const { workspace, entered } = folders(root);
    const loop = loopFrom({
      ...deps,
      workspace,
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
    expect(loop.snapshot().workspace).toEqual({
      path: "C:/work/notes",
      name: "notes",
    });
    // And the folder was not quietly recorded against the conversation that
    // happened to be open before, nor that conversation put in it.
    expect(
      loop.snapshot().tasks.find((task) => task.id === existing)?.workspace,
    ).toBeUndefined();
    expect(entered).toEqual([]);
  });

  it("gives a conversation created afterwards the folder that was chosen", async () => {
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      workspace: folders({ name: "notes" }).workspace,
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

  it("starts in the folder named at launch when the history names none", async () => {
    const deps = stubDependencies(() => {});
    const saved: SavedWorkspace[] = [];
    const loop = loopFrom({
      ...deps,
      sessions: {
        ...deps.sessions,
        saveWorkspace: async (snapshot) => {
          saved.push(snapshot);
        },
      },
      workspace: folders({ name: "zhiyin" }).workspace,
      startingFolder: "C:/src/zhiyin",
      newTaskId: () => `task-${Math.random()}`,
    });
    await loop.initialize();

    const fresh = await loop.createTask();
    const other = await loop.createTask();
    await loop.selectTask(fresh);
    await loop.selectTask(other);

    expect(loop.snapshot().workspace).toEqual({
      path: "C:/src/zhiyin",
      name: "zhiyin",
    });
    expect(
      loop.snapshot().tasks.find((task) => task.id === fresh)?.workspace,
    ).toEqual({ path: "C:/src/zhiyin", name: "zhiyin" });
    // Nobody chose it in the app, so it is not offered to go back to, and
    // is not kept as the folder shown: the next launch names its own.
    expect(loop.snapshot().recentWorkspaces).toEqual([]);
    expect(saved.map((snapshot) => snapshot.workspace)).not.toContainEqual(
      expect.objectContaining({ path: "C:/src/zhiyin" }),
    );

    // Chosen in the app, it is saved like any folder chosen.
    await loop.selectWorkspace("C:/src/zhiyin");
    expect(saved.at(-1)?.workspace).toEqual({
      path: "C:/src/zhiyin",
      name: "zhiyin",
    });
  });

  it("says so when the folder named at launch will not open", async () => {
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      workspace: folders({ name: "gone" }, () => "C:/src/gone").workspace,
      startingFolder: "C:/src/gone",
    });

    await loop.initialize();

    expect(loop.snapshot().workspace).toBeUndefined();
    expect(loop.snapshot().issues?.map((issue) => issue.message)).toContain(
      "The folder named at launch, C:/src/gone, could not be opened. Choose a folder before using files.",
    );
  });
});

describe("AgentLoop recent folders", () => {
  function loopOver(root: { name: string }) {
    const deps = stubDependencies(() => {});
    return loopFrom({ ...deps, workspace: folders(root).workspace });
  }

  it("keeps folders worked in, most recent first", async () => {
    const root = { name: "one" };
    const loop = loopOver(root);
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
    const loop = loopOver(root);
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
    const loop = loopOver(root);
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
  function loopOver(root: { name: string }, broken?: () => string) {
    const deps = stubDependencies(() => {});
    const stood = folders(root, broken);
    return {
      ...stood,
      loop: loopFrom({
        ...deps,
        workspace: stood.workspace,
        newTaskId: () => `task-${stood.entered.length}-${Math.random()}`,
      }),
    };
  }

  it("records the folder a conversation was last worked in, and puts the conversation in it", async () => {
    const root = { name: "reports" };
    const { loop, entered } = loopOver(root);
    await loop.initialize();
    const taskId = await loop.createTask();

    await loop.selectWorkspace("C:/work/reports");

    expect(
      loop.snapshot().tasks.find((task) => task.id === taskId)?.workspace,
    ).toEqual({ path: "C:/work/reports", name: "reports" });
    expect(entered).toEqual([[taskId, "C:/work/reports"]]);
  });

  it("shows a conversation's folder when it is reopened", async () => {
    const root = { name: "reports" };
    const { loop, entered } = loopOver(root);
    await loop.initialize();

    const reports = await loop.createTask();
    await loop.selectWorkspace("C:/work/reports");

    root.name = "notes";
    await loop.createTask();
    await loop.selectWorkspace("C:/work/notes");
    expect(loop.snapshot().workspace?.path).toBe("C:/work/notes");

    root.name = "reports";
    entered.length = 0;
    await loop.selectTask(reports);

    expect(entered).toEqual([[reports, "C:/work/reports"]]);
    expect(loop.snapshot().workspace).toEqual({
      path: "C:/work/reports",
      name: "reports",
    });
  });

  it("leaves a conversation that has never named a folder where it is", async () => {
    const root = { name: "reports" };
    const { loop, entered } = loopOver(root);
    await loop.initialize();

    // Created before any folder was chosen, so it names none.
    const fresh = await loop.createTask();
    await loop.selectNothing();
    await loop.selectWorkspace("C:/work/reports");
    await loop.createTask();

    entered.length = 0;
    await loop.selectTask(fresh);

    expect(
      loop.snapshot().tasks.find((task) => task.id === fresh)?.workspace,
    ).toBeUndefined();

    expect(entered).toEqual([]);
    expect(loop.snapshot().workspace?.path).toBe("C:/work/reports");
  });

  /**
   * The folder can be gone by the time the conversation is reopened. Selecting
   * it must still work, must not pretend the folder was restored, and must say
   * so rather than quietly running the next turn somewhere else.
   */
  it("says so when a conversation's folder can no longer be opened", async () => {
    const root = { name: "reports" };
    const broken = { path: "" };
    const { loop } = loopOver(root, () => broken.path);
    await loop.initialize();

    const reports = await loop.createTask();
    await loop.selectWorkspace("C:/work/reports");
    root.name = "notes";
    await loop.createTask();
    await loop.selectWorkspace("C:/work/notes");

    broken.path = "C:/work/reports";
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

  it("refuses a message in a conversation whose folder cannot be opened, rather than work in another", async () => {
    const root = { name: "reports" };
    const broken = { path: "" };
    const { loop } = loopOver(root, () => broken.path);
    await loop.initialize();
    const reports = await loop.createTask();
    await loop.selectWorkspace("C:/work/reports");
    root.name = "notes";
    await loop.createTask();
    await loop.selectWorkspace("C:/work/notes");
    broken.path = "C:/work/reports";
    await loop.selectTask(reports);

    await expect(loop.start(reports, "Summarize the reports")).rejects.toThrow(
      "The folder for this conversation could not be opened. Choose its new location, then send again.",
    );

    expect(loop.turns.running(reports)).toBe(false);
    expect(
      loop.snapshot().tasks.find((task) => task.id === reports)?.messages,
    ).toEqual([]);
  });

  it("forgets a deleted conversation's folder", async () => {
    const { loop, left } = loopOver({ name: "reports" });
    await loop.initialize();
    const reports = await loop.createTask();
    await loop.selectWorkspace("C:/work/reports");

    await loop.deleteTask(reports);

    expect(left).toEqual([reports]);
  });
});

describe("AgentLoop conversations working at the same time", () => {
  /**
   * Two conversations, each in a folder of its own with a note.txt of its own.
   * Each turn reads note.txt; the first turn's answer waits until the second
   * has read its note, so both are running at once.
   */
  it("lets a conversation work in its folder while another works in a different one", async () => {
    const reportsFolder = join(await temporary.make("zhiyin-both-"), "reports");
    const notesFolder = join(await temporary.make("zhiyin-both-"), "notes");
    await mkdir(reportsFolder);
    await mkdir(notesFolder);
    await writeFile(join(reportsFolder, "note.txt"), "The reports note.");
    await writeFile(join(notesFolder, "note.txt"), "The notes note.");
    const tools = new WorkspaceTools();
    const deps = stubDependencies(() => {});
    const requests: ModelRequest[] = [];
    let notesRead = () => {};
    const notesHaveRead = new Promise<void>((resolve) => (notesRead = resolve));
    const loop = loopFrom({
      ...deps,
      tools,
      workspace: tools,
      permissions: {
        decide: async () => ({ outcome: "allow" as const, reason: "Allowed." }),
      },
      model: {
        ...deps.model,
        send: async function* (request) {
          requests.push(request);
          const system = String(request.messages[0]?.content);
          const answered = request.messages.some(
            (message) => message.role === "tool",
          );
          if (!answered) {
            yield {
              kind: "toolCallDelta" as const,
              index: 0,
              callId: `call-${requests.length}`,
              name: "read_file",
              argumentsDelta: '{"path":"note.txt"}',
            };
          } else {
            if (system.includes("Current workspace: notes")) notesRead();
            else await notesHaveRead;
            yield { kind: "textDelta" as const, text: "Read." };
          }
          yield { kind: "done" as const };
        },
      },
      newTaskId: () => `task-${Math.random()}`,
    });
    await loop.initialize();
    const reports = await loop.createTask();
    await loop.selectWorkspace(reportsFolder);
    const notes = await loop.createTask();
    await loop.selectWorkspace(notesFolder);

    const reportsWorking = loop.start(reports, "Read the note.");
    await until(() => loop.turns.running(reports));
    await loop.start(notes, "Read the note.");
    await reportsWorking;

    const readIn = (name: string) =>
      requests
        .filter((request) =>
          String(request.messages[0]?.content).includes(
            `Current workspace: ${name}`,
          ),
        )
        .flatMap((request) => request.messages)
        .filter((message) => message.role === "tool")
        .map((message) => JSON.stringify(message.content));
    expect(readIn("reports").join(" ")).toContain("The reports note.");
    expect(readIn("reports").join(" ")).not.toContain("The notes note.");
    expect(readIn("notes").join(" ")).toContain("The notes note.");
    expect(readIn("notes").join(" ")).not.toContain("The reports note.");
    // The window keeps showing the conversation on screen's folder.
    expect(loop.snapshot().selectedTaskId).toBe(notes);
    expect(loop.snapshot().workspace?.path).toBe(notesFolder);
  });

  it("changes a conversation's folder while another conversation works, but not while it works itself", async () => {
    const root = { name: "reports" };
    const deps = stubDependencies(() => {});
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    const loop = loopFrom({
      ...deps,
      workspace: folders(root).workspace,
      model: {
        ...deps.model,
        send: async function* () {
          await held;
          yield { kind: "done" as const };
        },
      },
      newTaskId: () => `task-${Math.random()}`,
    });
    await loop.initialize();
    const reports = await loop.createTask();
    await loop.selectWorkspace("C:/work/reports");
    const working = loop.start(reports, "Summarize the reports");
    await until(() => loop.turns.running(reports));

    await expect(loop.selectWorkspace("C:/work/elsewhere")).rejects.toThrow(
      "Stop this conversation's work before changing its folder.",
    );
    root.name = "notes";
    const notes = await loop.createTask();
    await loop.selectWorkspace("C:/work/notes");

    expect(
      loop.snapshot().tasks.find((task) => task.id === notes)?.workspace,
    ).toEqual({ path: "C:/work/notes", name: "notes" });
    expect(
      loop.snapshot().tasks.find((task) => task.id === reports)?.workspace,
    ).toEqual({ path: "C:/work/reports", name: "reports" });
    release();
    await working;
  });

  it("leaves a conversation that is not on screen and names no folder without one, when its work starts", async () => {
    const deps = stubDependencies(() => {});
    const stood = folders({ name: "reports" });
    const loop = loopFrom({
      ...deps,
      workspace: stood.workspace,
      newTaskId: () => `task-${Math.random()}`,
    });
    await loop.initialize();
    const unfiled = await loop.createTask();
    await loop.selectNothing();
    await loop.selectWorkspace("C:/work/reports");
    await loop.createTask();

    await loop.start(unfiled, "Answer from memory.");

    expect(
      loop.snapshot().tasks.find((task) => task.id === unfiled)?.workspace,
    ).toBeUndefined();
    expect(stood.entered.map(([id]) => id)).not.toContain(unfiled);
  });

  it("does not change a conversation's folder while a command it started still runs", async () => {
    const deps = stubDependencies(() => {});
    const jobs = new Map<string, number>();
    const loop = loopFrom({
      ...deps,
      tools: {
        ...deps.tools,
        runningCommands: (conversationId: string) =>
          Array.from({ length: jobs.get(conversationId) ?? 0 }, (_, index) => ({
            id: `J${index + 1}`,
            command: "npm run build",
            explanation: "Builds the site.",
            startedAt: 0,
          })),
      },
      workspace: folders({ name: "reports" }).workspace,
      newTaskId: () => `task-${Math.random()}`,
    });
    await loop.initialize();
    const reports = await loop.createTask();
    await loop.selectWorkspace("C:/work/reports");
    jobs.set(reports, 1);

    await expect(loop.selectWorkspace("C:/work/notes")).rejects.toThrow(
      "Stop this conversation's work before changing its folder.",
    );
    jobs.set(reports, 0);
    await loop.selectWorkspace("C:/work/notes");

    expect(
      loop.snapshot().tasks.find((task) => task.id === reports)?.workspace
        ?.path,
    ).toBe("C:/work/notes");
  });

  /**
   * The person chooses a folder and sends at once. The message runs in the
   * folder chosen, once the change is done; the folder never changes under
   * it.
   */
  it("starts a turn sent while its conversation's folder is changing once the change is done, in the folder chosen", async () => {
    const deps = stubDependencies(() => {});
    const roots = new Map<string, string>();
    const describedIn: string[] = [];
    const changedWhileWorking: string[] = [];
    let working = false;
    let releaseModel = () => {};
    const modelHeld = new Promise<void>((resolve) => (releaseModel = resolve));
    let releaseNotes = () => {};
    const notesHeld = new Promise<void>((resolve) => (releaseNotes = resolve));
    let holdNotes = false;
    const loop = loopFrom({
      ...deps,
      workspace: {
        workspaceRoot: (id: string) => roots.get(id),
        describeWorkspace: async (id: string) => {
          describedIn.push(roots.get(id) ?? "none");
          return { rootName: "folder", entries: [], truncated: false };
        },
        enterFolder: async (id: string, path: string) => {
          if (path === "C:/work/notes" && holdNotes) await notesHeld;
          if (working && roots.get(id) !== path) changedWhileWorking.push(path);
          roots.set(id, path);
          return path.split("/").pop() as string;
        },
        checkFolder: async (path: string) => path.split("/").pop() as string,
        leaveFolder: (id: string) => {
          roots.delete(id);
        },
      },
      model: {
        ...deps.model,
        send: async function* () {
          working = true;
          await modelHeld;
          yield { kind: "textDelta" as const, text: "Done." };
          yield { kind: "done" as const };
          working = false;
        },
      },
      newTaskId: () => "task-b",
    });
    await loop.initialize();
    const conversation = await loop.createTask();
    await loop.selectWorkspace("C:/work/reports");

    holdNotes = true;
    const choosing = loop.selectWorkspace("C:/work/notes");
    const sending = loop.start(conversation, "Tidy the notes.");
    await until(() => loop.turns.running(conversation));
    releaseNotes();
    await choosing;
    releaseModel();
    await sending;

    expect(describedIn).toEqual(["C:/work/notes"]);
    expect(changedWhileWorking).toEqual([]);
    expect(
      loop.snapshot().tasks.find((task) => task.id === conversation)?.workspace
        ?.path,
    ).toBe("C:/work/notes");
  });

  /**
   * A folder choice whose save fails is undone for that conversation's folder
   * alone. What happened meanwhile, in it and in the other conversations,
   * stays.
   */
  it("undoes only the conversation's folder when the folder choice cannot be saved", async () => {
    const deps = stubDependencies(() => {});
    let failNext = false;
    let failHeld: (error: Error) => void = () => {};
    const loop = loopFrom({
      ...deps,
      sessions: {
        ...deps.sessions,
        saveWorkspace: (snapshot) => {
          if (!failNext) return deps.sessions.saveWorkspace(snapshot);
          failNext = false;
          return new Promise<void>((_resolve, reject) => (failHeld = reject));
        },
      },
      workspace: folders({ name: "folder" }).workspace,
      newTaskId: () => `task-${Math.random()}`,
    });
    await loop.initialize();
    const other = await loop.createTask();
    const conversation = await loop.createTask();
    await loop.selectWorkspace("C:/work/reports");

    failNext = true;
    const choosing = loop.selectWorkspace("C:/work/notes");
    await until(() =>
      loop
        .snapshot()
        .tasks.some((task) => task.workspace?.path === "C:/work/notes"),
    );
    const renaming = loop.renameTask(other, "Renamed meanwhile");
    await until(
      () =>
        loop.snapshot().tasks.find((task) => task.id === other)?.title ===
        "Renamed meanwhile",
    );
    failHeld(new Error("Task history could not be saved."));
    await expect(choosing).rejects.toThrow("Task history could not be saved.");
    await renaming;

    const task = (id: string) =>
      loop.snapshot().tasks.find((item) => item.id === id);
    expect(task(conversation)?.workspace?.path).toBe("C:/work/reports");
    expect(task(other)?.title).toBe("Renamed meanwhile");
  });

  it("takes the folder shown for a conversation on screen that names none, when its work starts", async () => {
    const deps = stubDependencies(() => {});
    const stood = folders({ name: "reports" });
    const loop = loopFrom({
      ...deps,
      workspace: stood.workspace,
      newTaskId: () => `task-${Math.random()}`,
    });
    await loop.initialize();
    const unfiled = await loop.createTask();
    await loop.selectNothing();
    await loop.selectWorkspace("C:/work/reports");
    await loop.selectTask(unfiled);

    await loop.start(unfiled, "Summarise the reports.");

    expect(
      loop.snapshot().tasks.find((task) => task.id === unfiled)?.workspace,
    ).toEqual({ path: "C:/work/reports", name: "reports" });
    expect(stood.entered).toEqual([[unfiled, "C:/work/reports"]]);
  });
});

/**
 * A folder change takes a moment: the folder is checked, then saved. What the
 * person does meanwhile, going to another conversation or deleting this one,
 * is not undone by it.
 */
describe("AgentLoop a folder change while the person moves on", () => {
  function fixture() {
    const events: AppEvent[] = [];
    const deps = stubDependencies((event) => events.push(event));
    const roots = new Map<string, string>();
    const held = new Map<string, Promise<void>>();
    const broken = new Set<string>();
    /** Each conversation a folder was asked to open for, in order. */
    const asked: string[] = [];
    let failNext = false;
    let failHeld: (error: Error) => void = () => {};
    let holdNext = false;
    let releaseHeld: () => void = () => {};
    /** Every snapshot given to be saved, in the order given. */
    const saved: SavedWorkspace[] = [];
    const loop = loopFrom({
      ...deps,
      sessions: {
        ...deps.sessions,
        saveWorkspace: (snapshot, options) => {
          saved.push(snapshot);
          if (holdNext) {
            holdNext = false;
            return new Promise<void>((resolve) => (releaseHeld = resolve)).then(
              () => deps.sessions.saveWorkspace(snapshot, options),
            );
          }
          if (!failNext) return deps.sessions.saveWorkspace(snapshot, options);
          failNext = false;
          return new Promise<void>((_resolve, reject) => (failHeld = reject));
        },
      },
      workspace: {
        workspaceRoot: (id: string) => roots.get(id),
        describeWorkspace: async () => ({
          rootName: "folder",
          entries: [],
          truncated: false,
        }),
        enterFolder: async (id: string, path: string) => {
          asked.push(id);
          await held.get(path);
          if (broken.has(path)) throw new Error("The folder is gone.");
          roots.set(id, path);
          return path.split("/").pop() as string;
        },
        checkFolder: async (path: string) => path.split("/").pop() as string,
        leaveFolder: (id: string) => {
          roots.delete(id);
        },
      },
      newTaskId: () => `task-${Math.random()}`,
    });
    return {
      loop,
      roots,
      broken,
      asked,
      /**
       * The conversation the window shows: the one named by the last event
       * that tells it which conversation is selected.
       */
      windowSelection() {
        let selected: string | null | undefined;
        for (const event of events) {
          if (event.kind === "taskSelectionChanged")
            selected = event.data.taskId;
          if (event.kind === "taskRemoved")
            selected = event.data.selectedTaskId;
        }
        return selected;
      },
      /** Holds the opening of a folder until the returned function is called. */
      hold(path: string) {
        let release = () => {};
        held.set(path, new Promise<void>((resolve) => (release = resolve)));
        return () => {
          held.delete(path);
          release();
        };
      },
      saved,
      failNextSave: () => (failNext = true),
      /** Holds the next save until `releaseHeldSave`, then lets it succeed. */
      holdNextSave: () => (holdNext = true),
      releaseHeldSave: () => releaseHeld(),
      failHeldSave: (error: Error) => failHeld(error),
    };
  }

  async function twoConversations(stood: ReturnType<typeof fixture>) {
    await stood.loop.initialize();
    const reports = await stood.loop.createTask();
    await stood.loop.selectWorkspace("C:/work/reports");
    const notes = await stood.loop.createTask();
    await stood.loop.selectWorkspace("C:/work/notes");
    return { reports, notes };
  }

  it("keeps showing the folder of the conversation the person went to", async () => {
    const stood = fixture();
    const { reports, notes } = await twoConversations(stood);
    await stood.loop.selectTask(reports);
    const release = stood.hold("C:/work/elsewhere");

    const choosing = stood.loop.selectWorkspace("C:/work/elsewhere");
    await stood.loop.selectTask(notes);
    release();
    await choosing;

    expect(stood.loop.snapshot().workspace?.path).toBe("C:/work/notes");
    expect(
      stood.loop.snapshot().tasks.find((task) => task.id === reports)?.workspace
        ?.path,
    ).toBe("C:/work/elsewhere");
    const fresh = await stood.loop.createTask();
    expect(
      stood.loop.snapshot().tasks.find((task) => task.id === fresh)?.workspace
        ?.path,
    ).toBe("C:/work/notes");
  });

  it("does not put back the folder of a conversation the person left, when its folder choice cannot be saved", async () => {
    const stood = fixture();
    const { reports, notes } = await twoConversations(stood);
    await stood.loop.selectTask(reports);
    stood.failNextSave();

    const choosing = stood.loop.selectWorkspace("C:/work/elsewhere");
    await until(
      () =>
        stood.loop.snapshot().tasks.find((task) => task.id === reports)
          ?.workspace?.path === "C:/work/elsewhere",
    );
    await stood.loop.selectTask(notes);
    stood.failHeldSave(new Error("Task history could not be saved."));
    await expect(choosing).rejects.toThrow();

    expect(stood.loop.snapshot().selectedTaskId).toBe(notes);
    expect(stood.loop.snapshot().workspace?.path).toBe("C:/work/notes");
    expect(
      stood.loop.snapshot().tasks.find((task) => task.id === reports)?.workspace
        ?.path,
    ).toBe("C:/work/reports");
  });

  it("leaves no folder behind for a conversation deleted while its folder was changing", async () => {
    const stood = fixture();
    const { reports, notes } = await twoConversations(stood);
    const release = stood.hold("C:/work/elsewhere");

    const choosing = stood.loop.selectWorkspace("C:/work/elsewhere");
    await stood.loop.deleteTask(notes);
    release();
    await choosing;

    expect(stood.roots.has(notes)).toBe(false);
    expect(stood.loop.snapshot().selectedTaskId).toBe(reports);
    expect(stood.loop.snapshot().workspace?.path).toBe("C:/work/reports");
  });

  it("makes a second folder choice, queued behind a first, and starts a turn sent after both in it", async () => {
    const stood = fixture();
    await stood.loop.initialize();
    const conversation = await stood.loop.createTask();
    await stood.loop.selectWorkspace("C:/work/reports");
    const release = stood.hold("C:/work/drafts");

    const first = stood.loop.selectWorkspace("C:/work/drafts");
    const second = stood.loop.selectWorkspace("C:/work/final");
    const sending = stood.loop.start(conversation, "Tidy it.");
    await until(() => stood.loop.turns.running(conversation));
    release();
    await first;
    await second;
    await sending;

    expect(stood.roots.get(conversation)).toBe("C:/work/final");
    expect(
      stood.loop.snapshot().tasks.find((task) => task.id === conversation)
        ?.workspace?.path,
    ).toBe("C:/work/final");
  });

  it("keeps showing the folder of the conversation the person went to, while the one they left was still being opened", async () => {
    const stood = fixture();
    const { reports, notes } = await twoConversations(stood);
    const release = stood.hold("C:/work/reports");

    const goingToReports = stood.loop.selectTask(reports);
    await stood.loop.selectTask(notes);
    release();
    await goingToReports;

    expect(stood.loop.snapshot().selectedTaskId).toBe(notes);
    expect(stood.windowSelection()).toBe(notes);
    expect(stood.loop.snapshot().workspace?.path).toBe("C:/work/notes");
  });

  it("keeps the window on no conversation when the person left one that was still being opened", async () => {
    const stood = fixture();
    const { reports } = await twoConversations(stood);
    const release = stood.hold("C:/work/reports");

    const goingToReports = stood.loop.selectTask(reports);
    await until(() => stood.loop.snapshot().selectedTaskId === reports);
    await stood.loop.selectNothing();
    release();
    await goingToReports;

    expect(stood.loop.snapshot().selectedTaskId).toBeNull();
    expect(stood.windowSelection()).toBeNull();
  });

  it("does not show a conversation deleted while it was being opened", async () => {
    const stood = fixture();
    const { reports, notes } = await twoConversations(stood);
    const release = stood.hold("C:/work/reports");

    const goingToReports = stood.loop.selectTask(reports);
    await until(() => stood.loop.snapshot().selectedTaskId === reports);
    await stood.loop.deleteTask(reports);
    release();
    await goingToReports;

    expect(stood.loop.snapshot().selectedTaskId).toBe(notes);
    expect(stood.windowSelection()).toBe(notes);
  });

  it("reports nothing about the folder of a conversation deleted while it was failing to open", async () => {
    const stood = fixture();
    const { reports } = await twoConversations(stood);
    stood.broken.add("C:/work/reports");
    const release = stood.hold("C:/work/reports");

    const goingToReports = stood.loop.selectTask(reports);
    await until(() => stood.loop.snapshot().selectedTaskId === reports);
    await stood.loop.deleteTask(reports);
    release();
    await goingToReports;

    expect(stood.loop.snapshot().issues ?? []).toEqual([]);
  });

  it("starts a new conversation in the folder chosen for the one on screen, though that choice was still under way", async () => {
    const stood = fixture();
    await twoConversations(stood);
    const release = stood.hold("C:/work/elsewhere");

    const choosing = stood.loop.selectWorkspace("C:/work/elsewhere");
    const creating = stood.loop.createTask();
    release();
    await choosing;
    const created = await creating;

    expect(
      stood.loop.snapshot().tasks.find((task) => task.id === created)?.workspace
        ?.path,
    ).toBe("C:/work/elsewhere");
  });

  it("keeps a folder chosen while another change of the same conversation was being saved", async () => {
    const stood = fixture();
    const { notes } = await twoConversations(stood);
    stood.holdNextSave();
    const renaming = stood.loop.renameTask(notes, "Meeting notes");

    await stood.loop.selectWorkspace("C:/work/elsewhere");
    stood.releaseHeldSave();
    await renaming;

    const record = stood.loop
      .snapshot()
      .tasks.find((task) => task.id === notes);
    expect(record?.title).toBe("Meeting notes");
    expect(record?.workspace?.path).toBe("C:/work/elsewhere");
    // The choice's own save writes the rename too, in the folder chosen.
    expect(
      stood.saved.some((snapshot) => {
        const written = snapshot.tasks.find((task) => task.id === notes);
        return (
          written?.title === "Meeting notes" &&
          written.workspace?.path === "C:/work/elsewhere"
        );
      }),
    ).toBe(true);
    expect(stood.roots.get(notes)).toBe("C:/work/elsewhere");
  });

  it("shows a conversation's folder once it opens again on reopening the conversation, and withdraws the report that it would not", async () => {
    const stood = fixture();
    const { reports, notes } = await twoConversations(stood);
    stood.broken.add("C:/work/reports");
    await stood.loop.selectTask(reports);
    expect(stood.loop.snapshot().issues?.length).toBe(1);
    stood.broken.delete("C:/work/reports");

    await stood.loop.selectTask(notes);
    await stood.loop.selectTask(reports);

    expect(stood.loop.snapshot().workspace?.path).toBe("C:/work/reports");
    expect(stood.loop.snapshot().issues ?? []).toEqual([]);
  });

  it("forgets the folder of a conversation deleted while its turn was entering it", async () => {
    const stood = fixture();
    const { reports } = await twoConversations(stood);
    const release = stood.hold("C:/work/reports");
    stood.asked.length = 0;

    const sending = stood.loop
      .start(reports, "Summarise the reports.")
      .catch(() => undefined);
    await until(() => stood.asked.includes(reports));
    await stood.loop.deleteTask(reports);
    release();
    await sending;

    expect(stood.roots.has(reports)).toBe(false);
  });

  it("shows a conversation's folder once it opens again for a turn, and withdraws the report that it would not", async () => {
    const stood = fixture();
    const { reports } = await twoConversations(stood);
    stood.broken.add("C:/work/reports");
    await stood.loop.selectTask(reports);
    expect(stood.loop.snapshot().issues?.length).toBe(1);
    stood.broken.delete("C:/work/reports");

    await stood.loop.start(reports, "Summarise the reports.");

    expect(stood.roots.get(reports)).toBe("C:/work/reports");
    expect(stood.loop.snapshot().workspace?.path).toBe("C:/work/reports");
    expect(stood.loop.snapshot().issues ?? []).toEqual([]);
  });

  it("makes a folder chosen while the conversation was still being opened its folder, on screen and in the tools", async () => {
    const stood = fixture();
    const { reports } = await twoConversations(stood);
    const release = stood.hold("C:/work/reports");

    const goingToReports = stood.loop.selectTask(reports);
    await until(() => stood.loop.snapshot().selectedTaskId === reports);
    const choosing = stood.loop.selectWorkspace("C:/work/elsewhere");
    // Everything that can run now runs: a choice that did not wait for the
    // opening would be done before the opening finishes.
    await new Promise((resolve) => setTimeout(resolve, 0));
    release();
    await goingToReports;
    await choosing;

    expect(
      stood.loop.snapshot().tasks.find((task) => task.id === reports)?.workspace
        ?.path,
    ).toBe("C:/work/elsewhere");
    expect(stood.loop.snapshot().workspace?.path).toBe("C:/work/elsewhere");
    expect(stood.roots.get(reports)).toBe("C:/work/elsewhere");
  });

  it("leaves no folder behind for a conversation deleted while its folder choice was being saved, when the save fails", async () => {
    const stood = fixture();
    const { notes } = await twoConversations(stood);
    stood.failNextSave();

    const choosing = stood.loop.selectWorkspace("C:/work/elsewhere");
    await until(
      () =>
        stood.loop.snapshot().tasks.find((task) => task.id === notes)?.workspace
          ?.path === "C:/work/elsewhere",
    );
    const deleting = stood.loop.deleteTask(notes);
    await until(() => !stood.roots.has(notes));
    stood.failHeldSave(new Error("Task history could not be saved."));
    await expect(choosing).rejects.toThrow();
    await deleting;

    expect(stood.roots.has(notes)).toBe(false);
  });

  it("refuses a folder for a conversation on screen that could not be opened", async () => {
    const root = await temporary.make("zhiyin-damaged-");
    const sessions = new FileSessions(root);
    const deps = stubDependencies(() => {});
    let created = 0;
    const seed = loopFrom({
      ...deps,
      sessions,
      workspace: folders({ name: "reports" }).workspace,
      newTaskId: () => `task-${(created += 1)}`,
    });
    await seed.initialize();
    const damaged = await seed.createTask();
    await seed.selectWorkspace("C:/work/reports");
    await seed.start(damaged, "Hello");
    await writeFile(
      join(
        root,
        "history",
        "conversations",
        `c-${damaged}`,
        "conversation.jsonl",
      ),
      "not json",
      "utf8",
    );
    await seed.createTask();
    const loop = loopFrom({
      ...deps,
      sessions: new FileSessions(root),
      workspace: folders({ name: "notes" }).workspace,
    });
    await loop.initialize();
    await loop.selectTask(damaged);

    await expect(loop.selectWorkspace("C:/work/notes")).rejects.toThrow(
      "This conversation could not be opened, so it has no folder to change.",
    );
    expect(loop.snapshot().recentWorkspaces.map((item) => item.path)).toEqual([
      "C:/work/reports",
    ]);
  });
});

describe("AgentLoop the folder named at launch, chosen in a choice that cannot be saved", () => {
  it("is still not saved as the folder shown", async () => {
    const deps = stubDependencies(() => {});
    const saved: SavedWorkspace[] = [];
    let failNext = false;
    const loop = loopFrom({
      ...deps,
      sessions: {
        ...deps.sessions,
        saveWorkspace: async (snapshot) => {
          if (failNext) {
            failNext = false;
            throw new Error("Task history could not be saved.");
          }
          saved.push(snapshot);
        },
      },
      workspace: folders({ name: "zhiyin" }).workspace,
      startingFolder: "C:/src/zhiyin",
      newTaskId: () => `task-${Math.random()}`,
    });
    await loop.initialize();
    failNext = true;

    await expect(loop.selectWorkspace("C:/src/zhiyin")).rejects.toThrow();
    await loop.createTask();

    expect(saved.at(-1)?.workspace).toBeUndefined();
  });
});

describe("AgentLoop the folder named at launch, chosen with no conversation open", () => {
  it("is saved as the folder shown and offered among recent folders", async () => {
    const deps = stubDependencies(() => {});
    const saved: SavedWorkspace[] = [];
    const loop = loopFrom({
      ...deps,
      sessions: {
        ...deps.sessions,
        saveWorkspace: async (snapshot) => {
          saved.push(snapshot);
        },
      },
      workspace: standIn(),
      startingFolder: "C:/src/zhiyin",
      newTaskId: () => `task-${Math.random()}`,
    });
    await loop.initialize();
    expect(loop.snapshot().selectedTaskId).toBeNull();

    await loop.selectWorkspace("C:/src/zhiyin");
    await loop.createTask();

    expect(saved.at(-1)?.workspace?.path).toBe("C:/src/zhiyin");
    expect(saved.at(-1)?.launchFolders).toBeUndefined();
    expect(loop.snapshot().recentWorkspaces.map((item) => item.path)).toEqual([
      "C:/src/zhiyin",
    ]);
  });
});

describe("AgentLoop folders named at launch", () => {
  it("are remembered as unchosen for the latest twenty launches", async () => {
    const root = await temporary.make("zhiyin-launches-");
    let number = 0;
    const deps = stubDependencies(() => {});
    for (let launch = 1; launch <= 21; launch += 1) {
      const loop = loopFrom({
        ...deps,
        sessions: new FileSessions(root),
        workspace: standIn(),
        startingFolder: `C:/src/launch-${launch}`,
        newTaskId: () => `task-${++number}`,
      });
      await loop.initialize();
      const started = await loop.createTask();
      await loop.start(started, "Hello");
    }

    const saved = await new FileSessions(root).loadWorkspace();
    expect(saved?.launchFolders).toEqual(
      Array.from({ length: 20 }, (_, index) => `C:/src/launch-${21 - index}`),
    );
  });
});

describe("AgentLoop the folder an earlier launch named, nobody chose since", () => {
  /** A first launch names the folder, and two conversations start in it. */
  async function startedAtLaunch() {
    let number = 0;
    const root = await temporary.make("zhiyin-relaunch-");
    const deps = stubDependencies(() => {});
    const first = loopFrom({
      ...deps,
      sessions: new FileSessions(root),
      workspace: folders({ name: "zhiyin" }).workspace,
      startingFolder: "C:/src/zhiyin",
      newTaskId: () => `task-${++number}`,
    });
    await first.initialize();
    const also = await first.createTask();
    await first.start(also, "Hello");
    const started = await first.createTask();
    await first.start(started, "Hello");
    const sessions = new FileSessions(root);
    const saved: SavedWorkspace[] = [];
    const save = sessions.saveWorkspace.bind(sessions);
    sessions.saveWorkspace = async (snapshot, options) => {
      saved.push(snapshot);
      return save(snapshot, options);
    };
    return { deps, sessions, saved, started, also };
  }

  it("is shown with its conversation at a later launch, but neither offered among recent folders nor saved as the folder shown", async () => {
    const { deps, sessions, saved, started } = await startedAtLaunch();
    const later = loopFrom({
      ...deps,
      sessions,
      workspace: folders({ name: "zhiyin" }).workspace,
      startingFolder: "C:/src/other",
    });
    await later.initialize();
    await later.renameTask(started, "Renamed");

    expect(later.snapshot().workspace?.path).toBe("C:/src/zhiyin");
    expect(later.snapshot().recentWorkspaces).toEqual([]);
    expect(saved.length).toBeGreaterThan(0);
    expect(saved.map((snapshot) => snapshot.workspace?.path)).not.toContain(
      "C:/src/zhiyin",
    );
  });

  it("is offered among recent folders and saved as the folder shown once the person chooses it, with every conversation in it", async () => {
    const { deps, sessions, saved, started, also } = await startedAtLaunch();
    const later = loopFrom({
      ...deps,
      sessions,
      workspace: folders({ name: "zhiyin" }).workspace,
    });
    await later.initialize();

    await later.selectWorkspace("C:/src/zhiyin");

    expect(later.snapshot().recentWorkspaces.map((item) => item.path)).toEqual([
      "C:/src/zhiyin",
    ]);
    expect(saved.at(-1)?.workspace?.path).toBe("C:/src/zhiyin");
    await later.renameTask(started, "Renamed");
    expect(saved.at(-1)?.workspace?.path).toBe("C:/src/zhiyin");
    await later.selectTask(also);
    expect(later.snapshot().workspace?.path).toBe("C:/src/zhiyin");
    expect(saved.at(-1)?.workspace?.path).toBe("C:/src/zhiyin");
  });
});

describe("AgentLoop restarted without the folder named at launch", () => {
  it("shows the folder of the conversation on screen, which it was started in", async () => {
    const root = await temporary.make("zhiyin-relaunch-");
    const deps = stubDependencies(() => {});
    const first = loopFrom({
      ...deps,
      sessions: new FileSessions(root),
      workspace: folders({ name: "zhiyin" }).workspace,
      startingFolder: "C:/src/zhiyin",
      newTaskId: () => "task-a",
    });
    await first.initialize();
    const started = await first.createTask();
    await first.start(started, "Hello");

    const second = loopFrom({
      ...deps,
      sessions: new FileSessions(root),
      workspace: folders({ name: "zhiyin" }).workspace,
    });
    await second.initialize();

    expect(second.snapshot().selectedTaskId).toBe(started);
    expect(second.snapshot().workspace).toEqual({
      path: "C:/src/zhiyin",
      name: "zhiyin",
    });
  });
});

describe("AgentLoop a folder change while a specialist works on", () => {
  it("is refused while a specialist the conversation's turn started still works, after that turn ended", async () => {
    const deps = stubDependencies(() => {});
    let finishSpecialist = () => {};
    const specialistDone = new Promise<void>(
      (resolve) => (finishSpecialist = resolve),
    );
    let specialistStarted = false;
    const loop = loopFrom({
      ...deps,
      plugins: pluginStore([
        {
          ...pluginView({ name: "engineering" }),
          specialists: [
            {
              id: "engineering/reviewer",
              name: "Reviewer",
              description: "Reviews behavior and regressions.",
              instructions: "Inspect the evidence and report concrete risks.",
              enabled: true,
            },
          ],
        },
      ]),
      workspace: folders({ name: "reports" }).workspace,
      model: {
        ...deps.model,
        send: async function* (request) {
          const text = JSON.stringify(request.messages);
          if (text.includes("You are the Reviewer specialist")) {
            specialistStarted = true;
            await specialistDone;
            yield {
              kind: "toolCallDelta" as const,
              index: 0,
              callId: "finish-1",
              name: "finish_specialist",
              argumentsDelta: JSON.stringify({ report: "Covered." }),
            };
            yield { kind: "done" as const };
            return;
          }
          if (
            !request.tools?.some((tool) => tool.name === "delegate_specialist")
          ) {
            yield {
              kind: "toolCallDelta" as const,
              index: 0,
              callId: "activate-1",
              name: "activate_plugin",
              argumentsDelta: JSON.stringify({ id: "engineering" }),
            };
            yield { kind: "done" as const };
            return;
          }
          if (!text.includes("Review the reports.")) {
            yield {
              kind: "toolCallDelta" as const,
              index: 0,
              callId: "delegate-1",
              name: "delegate_specialist",
              argumentsDelta: JSON.stringify({
                id: "engineering/reviewer",
                task: "Review the reports.",
              }),
            };
            yield { kind: "done" as const };
            return;
          }
          yield { kind: "textDelta" as const, text: "Waiting for the review." };
          yield { kind: "done" as const };
        },
      },
      newTaskId: () => `task-${Math.random()}`,
    });
    await loop.initialize();
    const taskId = await loop.createTask();
    await loop.selectWorkspace("C:/work/reports");
    await loop.start(taskId, "Have the reports reviewed.");
    await until(() => specialistStarted);
    await until(
      () =>
        loop.snapshot().tasks.find((task) => task.id === taskId)?.phase.kind !==
        "working",
    );

    await expect(loop.selectWorkspace("C:/work/notes")).rejects.toThrow(
      "Stop this conversation's work before changing its folder.",
    );
    expect(
      loop.snapshot().tasks.find((task) => task.id === taskId)?.workspace?.path,
    ).toBe("C:/work/reports");
    finishSpecialist();
  });
});

/**
 * Folders that stand in for the tools: each opens under its last path segment,
 * and one named in `broken` will not open.
 */
function standIn(broken: Set<string> = new Set()) {
  return {
    describeWorkspace: async () => ({
      rootName: "folder",
      entries: [],
      truncated: false,
    }),
    workspaceRoot: () => undefined,
    enterFolder: async (_id: string, path: string) => {
      if (broken.has(path)) throw new Error("The folder is gone.");
      return path.split("/").pop() as string;
    },
    checkFolder: async (path: string) => {
      if (broken.has(path)) throw new Error("The folder is gone.");
      return path.split("/").pop() as string;
    },
    leaveFolder: () => {},
  };
}

describe("AgentLoop the folder named at launch, once the person chooses it", () => {
  it("stays chosen for every conversation started in it, after five other folders were worked in", async () => {
    const deps = stubDependencies(() => {});
    const saved: SavedWorkspace[] = [];
    const loop = loopFrom({
      ...deps,
      sessions: {
        ...deps.sessions,
        saveWorkspace: async (snapshot) => {
          saved.push(snapshot);
        },
      },
      workspace: standIn(),
      startingFolder: "C:/src/zhiyin",
      newTaskId: () => `task-${Math.random()}`,
    });
    await loop.initialize();
    const startedThere = await loop.createTask();
    await loop.createTask();
    await loop.selectWorkspace("C:/src/zhiyin");
    for (const name of ["one", "two", "three", "four", "five"]) {
      await loop.createTask();
      await loop.selectWorkspace(`C:/work/${name}`);
    }

    await loop.selectTask(startedThere);

    expect(loop.snapshot().workspace?.path).toBe("C:/src/zhiyin");
    expect(saved.at(-1)?.workspace?.path).toBe("C:/src/zhiyin");
    expect(loop.snapshot().recentWorkspaces[0]?.path).toBe("C:/src/zhiyin");
  });

  it("stays chosen when another conversation's folder choice made meanwhile fails", async () => {
    const deps = stubDependencies(() => {});
    const saved: SavedWorkspace[] = [];
    let holdNext = false;
    let failHeld: (error: Error) => void = () => {};
    const loop = loopFrom({
      ...deps,
      sessions: {
        ...deps.sessions,
        saveWorkspace: (snapshot) => {
          if (holdNext) {
            holdNext = false;
            return new Promise<void>((_resolve, reject) => (failHeld = reject));
          }
          saved.push(snapshot);
          return Promise.resolve();
        },
      },
      workspace: standIn(),
      startingFolder: "C:/src/zhiyin",
      newTaskId: () => `task-${Math.random()}`,
    });
    await loop.initialize();
    const failing = await loop.createTask();
    const choosing = await loop.createTask();
    await loop.selectTask(failing);
    holdNext = true;
    const failedChoice = loop.selectWorkspace("C:/work/reports");
    await until(
      () =>
        loop.snapshot().tasks.find((task) => task.id === failing)?.workspace
          ?.path === "C:/work/reports",
    );
    await loop.selectTask(choosing);
    await loop.selectWorkspace("C:/src/zhiyin");

    failHeld(new Error("Task history could not be saved."));
    await expect(failedChoice).rejects.toThrow();
    await loop.renameTask(choosing, "Renamed");

    expect(saved.at(-1)?.workspace?.path).toBe("C:/src/zhiyin");
  });

  it("is saved as the folder shown at a later launch that names it, having been chosen at an earlier one", async () => {
    const root = await temporary.make("zhiyin-relaunch-");
    let number = 0;
    const deps = stubDependencies(() => {});
    const first = loopFrom({
      ...deps,
      sessions: new FileSessions(root),
      workspace: standIn(),
      startingFolder: "C:/src/first",
      newTaskId: () => `task-${++number}`,
    });
    await first.initialize();
    const startedAtLaunch = await first.createTask();
    await first.start(startedAtLaunch, "Hello");
    const chosen = await first.createTask();
    await first.selectWorkspace("C:/work/chosen");
    await first.start(chosen, "Hello");
    await first.selectTask(startedAtLaunch);

    const sessions = new FileSessions(root);
    const saved: SavedWorkspace[] = [];
    const save = sessions.saveWorkspace.bind(sessions);
    sessions.saveWorkspace = async (snapshot, options) => {
      saved.push(snapshot);
      return save(snapshot, options);
    };
    const second = loopFrom({
      ...deps,
      sessions,
      workspace: standIn(),
      startingFolder: "C:/work/chosen",
      newTaskId: () => `task-${++number}`,
    });
    await second.initialize();
    await second.selectTask(chosen);

    expect(second.snapshot().workspace?.path).toBe("C:/work/chosen");
    expect(saved.at(-1)?.workspace?.path).toBe("C:/work/chosen");
  });

  it("counts a folder chosen at an earlier launch as unchosen again when a launch names it after it left the recent folders", async () => {
    const root = await temporary.make("zhiyin-relaunch-");
    let number = 0;
    const deps = stubDependencies(() => {});
    const first = loopFrom({
      ...deps,
      sessions: new FileSessions(root),
      workspace: standIn(),
      startingFolder: "C:/src/first",
      newTaskId: () => `task-${++number}`,
    });
    await first.initialize();
    const startedAtLaunch = await first.createTask();
    await first.start(startedAtLaunch, "Hello");
    const chosen = await first.createTask();
    await first.selectWorkspace("C:/work/chosen");
    await first.start(chosen, "Hello");
    for (const name of ["one", "two", "three", "four", "five"]) {
      await first.createTask();
      await first.selectWorkspace(`C:/work/${name}`);
    }
    await first.selectTask(startedAtLaunch);

    const sessions = new FileSessions(root);
    const saved: SavedWorkspace[] = [];
    const save = sessions.saveWorkspace.bind(sessions);
    sessions.saveWorkspace = async (snapshot, options) => {
      saved.push(snapshot);
      return save(snapshot, options);
    };
    const second = loopFrom({
      ...deps,
      sessions,
      workspace: standIn(),
      startingFolder: "C:/work/chosen",
      newTaskId: () => `task-${++number}`,
    });
    await second.initialize();
    await second.selectTask(chosen);

    expect(second.snapshot().workspace?.path).toBe("C:/work/chosen");
    expect(saved.at(-1)?.workspace).toBeUndefined();
    expect(
      second.snapshot().recentWorkspaces.map((item) => item.path),
    ).not.toContain("C:/work/chosen");
  });
});

describe("AgentLoop folder reports", () => {
  it("withdraws the report that a conversation's folder would not open once it opens, though the conversation was renamed since", async () => {
    const broken = new Set<string>();
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      workspace: standIn(broken),
      newTaskId: () => `task-${Math.random()}`,
    });
    await loop.initialize();
    const reports = await loop.createTask();
    await loop.selectWorkspace("C:/work/reports");
    await loop.createTask();
    await loop.selectWorkspace("C:/work/notes");
    broken.add("C:/work/reports");
    await loop.selectTask(reports);
    expect(loop.snapshot().issues?.length).toBe(1);
    await loop.renameTask(reports, "Quarterly reports");
    broken.delete("C:/work/reports");

    await loop.selectNothing();
    await loop.selectTask(reports);

    expect(loop.snapshot().workspace?.path).toBe("C:/work/reports");
    expect(loop.snapshot().issues ?? []).toEqual([]);
  });

  it("keeps saying the folder shown is gone when a folder chosen for a conversation applies after the person left it", async () => {
    const root = await temporary.make("zhiyin-gone-");
    const broken = new Set<string>();
    const deps = stubDependencies(() => {});
    const first = loopFrom({
      ...deps,
      sessions: new FileSessions(root),
      workspace: standIn(broken),
      newTaskId: () => `task-${Math.random()}`,
    });
    await first.initialize();
    await first.selectWorkspace("C:/work/gone");
    broken.add("C:/work/gone");
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    const tools = standIn(broken);
    const second = loopFrom({
      ...deps,
      sessions: new FileSessions(root),
      workspace: {
        ...tools,
        enterFolder: async (id: string, path: string) => {
          await held;
          return tools.enterFolder(id, path);
        },
      },
      newTaskId: () => `task-${Math.random()}`,
    });
    await second.initialize();
    expect(second.snapshot().issues?.map((issue) => issue.message)).toEqual([
      "The selected folder is unavailable. Choose its new location before using files.",
    ]);
    await second.createTask();

    const choosing = second.selectWorkspace("C:/work/elsewhere");
    await second.selectNothing();
    release();
    await choosing;

    expect(second.snapshot().workspace?.path).toBe("C:/work/gone");
    expect(second.snapshot().issues?.map((issue) => issue.message)).toEqual([
      "The selected folder is unavailable. Choose its new location before using files.",
    ]);
  });
});

describe("AgentLoop folder reports withdrawn by a choice", () => {
  it("no longer says the folder shown is gone once another is chosen with no conversation open", async () => {
    const root = await temporary.make("zhiyin-gone-");
    const broken = new Set<string>();
    const deps = stubDependencies(() => {});
    const first = loopFrom({
      ...deps,
      sessions: new FileSessions(root),
      workspace: standIn(broken),
      newTaskId: () => `task-${Math.random()}`,
    });
    await first.initialize();
    await first.selectWorkspace("C:/work/gone");
    broken.add("C:/work/gone");
    const second = loopFrom({
      ...deps,
      sessions: new FileSessions(root),
      workspace: standIn(broken),
      newTaskId: () => `task-${Math.random()}`,
    });
    await second.initialize();
    expect(second.snapshot().selectedTaskId).toBeNull();
    expect(second.snapshot().issues?.map((issue) => issue.message)).toEqual([
      "The selected folder is unavailable. Choose its new location before using files.",
    ]);

    await second.selectWorkspace("C:/work/elsewhere");

    expect(second.snapshot().workspace?.path).toBe("C:/work/elsewhere");
    expect(second.snapshot().issues ?? []).toEqual([]);
  });

  it("no longer says a conversation's folder would not open once a new folder is chosen for it", async () => {
    const broken = new Set<string>();
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      workspace: standIn(broken),
      newTaskId: () => `task-${Math.random()}`,
    });
    await loop.initialize();
    const reports = await loop.createTask();
    await loop.selectWorkspace("C:/work/reports");
    await loop.createTask();
    await loop.selectWorkspace("C:/work/notes");
    broken.add("C:/work/reports");
    await loop.selectTask(reports);
    expect(loop.snapshot().issues?.length).toBe(1);

    await loop.selectWorkspace("C:/work/archive");

    expect(
      loop.snapshot().tasks.find((task) => task.id === reports)?.workspace
        ?.path,
    ).toBe("C:/work/archive");
    expect(loop.snapshot().issues ?? []).toEqual([]);
  });
});

describe("AgentLoop folder choices with no conversation open", () => {
  it("starts a conversation created while a folder choice is still being checked in that folder", async () => {
    let releaseCheck = () => {};
    const checkHeld = new Promise<void>((resolve) => (releaseCheck = resolve));
    const tools = standIn();
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      workspace: {
        ...tools,
        checkFolder: async (path: string) => {
          if (path === "C:/work/notes") await checkHeld;
          return tools.checkFolder(path);
        },
      },
      newTaskId: () => `task-${Math.random()}`,
    });
    await loop.initialize();
    await loop.selectWorkspace("C:/work/reports");

    const choosing = loop.selectWorkspace("C:/work/notes");
    const creating = loop.createTask();
    releaseCheck();
    await choosing;
    const created = await creating;

    expect(
      loop.snapshot().tasks.find((task) => task.id === created)?.workspace
        ?.path,
    ).toBe("C:/work/notes");
  });

  it("keeps the folder chosen last, though the one chosen before it was slower to check", async () => {
    let releaseFirst = () => {};
    const firstHeld = new Promise<void>((resolve) => (releaseFirst = resolve));
    const tools = standIn();
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      workspace: {
        ...tools,
        checkFolder: async (path: string) => {
          if (path === "C:/work/first") await firstHeld;
          return tools.checkFolder(path);
        },
      },
      newTaskId: () => `task-${Math.random()}`,
    });
    await loop.initialize();

    const first = loop.selectWorkspace("C:/work/first");
    const second = loop.selectWorkspace("C:/work/second");
    releaseFirst();
    await first;
    await second;

    expect(loop.snapshot().workspace?.path).toBe("C:/work/second");
  });
});
