/**
 * Memory as the app keeps it (ADR 0026): the Memory page's changes, the
 * conversation's card, and the conversation's own choice of project.
 */

import { writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  emptyConversationLists,
  type AppEvent,
  type MemoryChange,
  type WorkspaceTask,
} from "@zhiyin/contract";
import { ConversationRewind } from "@zhiyin/rewind-planner";
import { FileMemory } from "@zhiyin/memory";
import { FileRecovery } from "@zhiyin/recovery";
import { FileSessions } from "@zhiyin/session";
import { TemporaryFolders } from "@zhiyin/test-support";
import { WorkspaceTools } from "@zhiyin/tools";
import {
  calls,
  loopFrom,
  storedIn,
  stubDependencies,
  until,
  type ModelStep,
} from "./support.js";

const folders = new TemporaryFolders();
afterEach(() => folders.removeAll());

async function memoryAt(folder?: string) {
  return new FileMemory({
    folder: folder ?? join(await folders.make("zhiyin-core-memory-"), "memory"),
    now: () => new Date("2026-10-31T09:00:00.000Z"),
    newId: (() => {
      let id = 0;
      return () => `write-${(id += 1)}`;
    })(),
    broadFolders: [],
    recycle: async () => {},
  });
}

const typst = {
  section: "knowledge" as const,
  scope: "everything",
  title: "Typst over LaTeX",
  summary: "The university template needs a grid",
  text: "Chosen on 3 October.",
};

/** The app with `memory`, its model making `steps` in turn, hearing every event. */
async function appWith(options: {
  readonly memory?: FileMemory;
  readonly root?: string;
  readonly steps?: readonly ModelStep[];
  /** A conversation saved before the app started. */
  readonly saved?: WorkspaceTask;
  /** The saved conversation is listed but not opened. */
  readonly unopened?: true;
  /** A folder the model writes in, its changes allowed and kept for undo. */
  readonly folder?: string;
}) {
  const events: AppEvent[] = [];
  let created = 0;
  const deps = stubDependencies((event) => events.push(event));
  const workspace =
    options.folder && new WorkspaceTools(options.folder, { shell: undefined });
  const app = loopFrom({
    ...deps,
    ...(workspace
      ? {
          tools: workspace,
          workspace,
          permissions: {
            decide: async () => ({
              outcome: "allow" as const,
              reason: "Test policy.",
            }),
          },
          recovery: new FileRecovery(
            await folders.make("zhiyin-core-recovery-"),
          ),
        }
      : {}),
    rewind: new ConversationRewind(() => "rewind-1"),
    newTaskId: () => `task-${++created}`,
    ...(options.saved
      ? {
          sessions: {
            ...deps.sessions,
            loadWorkspace: async () => ({
              tasks: [options.saved!],
              selectedTaskId: options.unopened ? null : options.saved!.id,
              recentWorkspaces: [],
            }),
          },
        }
      : storedIn(
          new FileSessions(
            options.root ?? (await folders.make("zhiyin-core-history-")),
          ),
        )),
    ...(options.memory ? { memory: options.memory } : {}),
    model: { ...deps.model, send: calls(...(options.steps ?? [])) },
  });
  await app.initialize();
  const memoryEvents = () =>
    events.flatMap((event) =>
      event.kind === "memoryChanged" ? [event.data] : [],
    );
  return { app, events, memoryEvents };
}

const task = (app: { snapshot(): { tasks: readonly WorkspaceTask[] } }) =>
  app.snapshot().tasks[0]!;

describe("the Memory page", () => {
  it("shows nothing where memory is not kept, and refuses a change", async () => {
    const { app } = await appWith({});

    expect(await app.memory.state()).toBeUndefined();
    expect(
      await app.memory.change({ kind: "createProject", name: "Thesis" }),
    ).toEqual({ ok: false, reason: "Memory is not kept here." });
  });

  it("makes the person's change and tells the window what memory now holds", async () => {
    const memory = await memoryAt();
    const { app, memoryEvents } = await appWith({ memory });

    const added = await app.memory.change({ kind: "add", draft: typst });

    expect(added).toEqual({ ok: true, number: 1 });
    await until(() => memoryEvents().length > 0);
    expect(memoryEvents().at(-1)?.entries).toEqual([
      expect.objectContaining({ number: 1, title: "Typst over LaTeX" }),
    ]);
  });

  it("tells the window when the model keeps something", async () => {
    const memory = await memoryAt();
    const { app, memoryEvents } = await appWith({
      memory,
      steps: [["remember", typst]],
    });
    const taskId = await app.createTask();

    await app.start(taskId, "We chose Typst for the thesis.");

    await until(() => memoryEvents().length > 0);
    expect(memoryEvents().at(-1)?.entries).toHaveLength(1);
  });

  it("asks for a folder to link, and links nothing when none is chosen", async () => {
    const memory = await memoryAt();
    const { app } = await appWith({ memory });
    const made = await app.memory.change({
      kind: "createProject",
      name: "Thesis",
    });
    const id = made.ok ? made.project!.id : "";

    await app.memory.change({ kind: "linkFolder", id }, async () => undefined);
    const unlinked = (await memory.projects())[0]!.folders;
    await app.memory.change(
      { kind: "linkFolder", id },
      async () => "C:/Users/me/Thesis",
    );

    expect(unlinked).toEqual([]);
    expect((await memory.projects())[0]!.folders).toEqual([
      "C:/Users/me/Thesis",
    ]);
  });
});

describe("a conversation's card", () => {
  it("undoes what the model kept, and the card says it was undone", async () => {
    const memory = await memoryAt();
    const { app } = await appWith({ memory, steps: [["remember", typst]] });
    const taskId = await app.createTask();
    await app.start(taskId, "We chose Typst for the thesis.");
    const kept = task(app).actions.find((action) => action.memory)!.memory!;

    const undone = await app.memory.change({
      kind: "undo",
      writeId: kept.writeId,
    });

    expect(undone).toEqual({ ok: true });
    expect((await memory.state()).entries).toEqual([]);
    expect(
      task(app).actions.find((action) => action.memory)?.memory?.state,
    ).toBe("undone");
  });

  it("keeps or drops a change that waited for the person, and the card says which", async () => {
    const memory = await memoryAt();
    const asked = (id: string) =>
      memory.remember(
        {
          section: "how",
          scope: "everything",
          rule: `Cite sources as footnotes (${id}).`,
          quote: `Cite sources as footnotes (${id}).`,
        },
        {
          conversation: { id: "task-1", title: "Sources" },
          personsWords: [`Cite sources as footnotes (${id}).`],
          held: { outside: true, because: "content from a web page" },
        },
      );
    const first = await asked("a");
    const second = await asked("b");
    if (!first.ok || !second.ok) throw new Error("not waiting");
    const { app } = await appWith({
      memory,
      saved: savedWith([first.change, second.change]),
    });

    await app.memory.change({
      kind: "keep",
      waitingId: first.change.waiting!.id,
    });
    await app.memory.change({
      kind: "discard",
      waitingId: second.change.waiting!.id,
    });

    expect(task(app).actions.map((action) => action.memory?.state)).toEqual([
      "kept",
      "discarded",
    ]);
    expect((await memory.state()).waiting).toEqual([]);
  });
});

const grid = {
  section: "knowledge" as const,
  scope: "everything",
  title: "Grid from the template",
  summary: "Margins of 25 mm",
  text: "Read from the university template.",
};

describe("going back past a turn that kept something", () => {
  it("takes back what that turn and later ones kept, and nothing kept before", async () => {
    const memory = await memoryAt();
    const { app } = await appWith({
      memory,
      steps: [["remember", typst], "answer", ["remember", grid]],
    });
    const taskId = await app.createTask();
    await app.start(taskId, "We chose Typst for the thesis.");
    await app.start(taskId, "The template sets the grid.");
    const second = task(app).messages.filter(
      (message) => message.role === "user",
    )[1]!;

    const preview = await app.rewinds.preview(taskId, second.id);
    await app.commitRewind(taskId, preview.id, "keep");

    expect((await memory.state()).entries.map((entry) => entry.title)).toEqual([
      "Typst over LaTeX",
    ]);
  });

  it("leaves an entry the person changed since as they left it", async () => {
    const memory = await memoryAt();
    const { app } = await appWith({ memory, steps: [["remember", typst]] });
    const taskId = await app.createTask();
    await app.start(taskId, "We chose Typst for the thesis.");
    await memory.edit(1, { text: "Chosen on 3 October, for its speed." });

    const preview = await app.rewinds.preview(
      taskId,
      task(app).messages[0]!.id,
    );
    await app.commitRewind(taskId, preview.id, "keep");

    expect((await memory.state()).entries).toEqual([
      expect.objectContaining({
        number: 1,
        text: "Chosen on 3 October, for its speed.",
      }),
    ]);
  });
});

describe("forgetting a deleted conversation", () => {
  it("removes each Knowledge entry it kept, and nothing anyone else kept", async () => {
    const memory = await memoryAt();
    const from = (id: string) => ({
      conversation: { id, title: "Thesis" },
      personsWords: ["Answer in French."],
      held: {},
    });
    await memory.add({
      scope: "everything",
      section: "how",
      text: "- Cite in APA.",
    });
    // A rule it added makes How to work its own write, which stays.
    await memory.remember(
      {
        section: "how",
        scope: "everything",
        rule: "Answer in French.",
        quote: "Answer in French.",
      },
      from("task-1"),
    );
    await memory.remember(typst, from("task-1"));
    await memory.remember(grid, from("task-2"));
    await memory.add({ ...typst, title: "Written by hand" });
    const { app } = await appWith({ memory });

    const outcome = await app.memory.change({
      kind: "forgetConversation",
      taskId: "task-1",
      own: true,
      general: true,
    });

    expect(outcome).toEqual({ ok: true });
    expect((await memory.state()).entries.map((entry) => entry.title)).toEqual([
      "How to work",
      "Grid from the template",
      "Written by hand",
    ]);
  });
});

describe("deleting a conversation", () => {
  it("keeps what it wrote, and lets go of what undid it, whose cards are gone", async () => {
    const memory = await memoryAt();
    const { app } = await appWith({ memory });
    const taskId = await app.createTask();
    const kept = await memory.remember(typst, {
      conversation: { id: taskId, title: "Thesis" },
      personsWords: [],
      held: {},
    });
    if (!kept.ok) throw new Error(kept.reason);

    await app.deleteTask(taskId);

    expect((await memory.state()).entries.map((entry) => entry.title)).toEqual([
      typst.title,
    ]);
    expect(await memory.undo(kept.change.writeId)).toEqual({
      ok: false,
      reason: "That change is no longer known.",
    });
  });
});

describe("going back while memory cannot be written", () => {
  it("still goes back, and what the turn kept stays kept", async () => {
    class Unwritable extends FileMemory {
      override undo(): never {
        throw new Error("The memory folder could not be written.");
      }
    }
    const memory = new Unwritable({
      folder: join(await folders.make("zhiyin-core-memory-"), "memory"),
      now: () => new Date("2026-10-31T09:00:00.000Z"),
      newId: () => "write-1",
      broadFolders: [],
      recycle: async () => {},
    });
    const { app } = await appWith({ memory, steps: [["remember", typst]] });
    const taskId = await app.createTask();
    await app.start(taskId, "We chose Typst for the thesis.");

    const preview = await app.rewinds.preview(
      taskId,
      task(app).messages[0]!.id,
    );
    await app.commitRewind(taskId, preview.id, "keep");

    expect(task(app).messages).toEqual([]);
    expect((await memory.state()).entries).toHaveLength(1);
  });
});

describe("undoing a turn's changes", () => {
  it("takes back what the turn kept too, and its card says so", async () => {
    const folder = await folders.make("zhiyin-core-undo-");
    await writeFile(join(folder, "notes.md"), "my notes", "utf8");
    const memory = await memoryAt();
    const { app } = await appWith({
      memory,
      folder,
      steps: [
        ["write_file", { path: "notes.md", content: "Typst it is." }],
        ["remember", typst],
      ],
    });
    await app.selectWorkspace(folder);
    const taskId = await app.createTask();
    await app.start(taskId, "We chose Typst for the thesis.");

    const preview = await app.rewinds.previewUndo(
      taskId,
      task(app).messages[0]!.id,
    );
    await app.commitUndo(taskId, preview.id);

    expect((await memory.state()).entries).toEqual([]);
    expect(
      task(app).actions.find((action) => action.memory)?.memory?.state,
    ).toBe("undone");
  });
});

/** A conversation saved in `folder`, before the app started. */
function inFolder(folder: string): WorkspaceTask {
  return {
    ...savedWith([]),
    workspace: { path: folder, name: basename(folder) },
  };
}

/** A settled conversation whose actions kept `changes`. */
function savedWith(changes: readonly MemoryChange[]): WorkspaceTask {
  return {
    id: "task-1",
    title: "Sources",
    titleSource: "manual",
    updatedLabel: "Earlier",
    updatedAt: "2026-10-31T08:00:00.000Z",
    ...emptyConversationLists,
    messages: [],
    actions: changes.map((change, index) => ({
      id: `action-${index}`,
      action: "Keep in memory",
      target: change.title,
      sequence: index,
      status: "completed" as const,
      memory: change,
    })),
    phase: {
      kind: "completed",
      outcome: { title: "Response complete", summary: "Done." },
    },
  };
}

describe("a change kept from the Memory page", () => {
  it("is marked on the card of the conversation it came from, opened or not", async () => {
    const memory = await memoryAt();
    const waiting = await memory.remember(
      {
        section: "how",
        scope: "everything",
        rule: "Cite sources as footnotes.",
        quote: "Cite sources as footnotes.",
      },
      {
        conversation: { id: "task-1", title: "Sources" },
        personsWords: ["Cite sources as footnotes."],
        held: { outside: true, because: "content from a web page" },
      },
    );
    if (!waiting.ok) throw new Error(waiting.reason);
    const { app } = await appWith({
      memory,
      saved: savedWith([waiting.change]),
      unopened: true,
    });
    const openedBefore = app.snapshot().tasks.length;

    await app.memory.change({
      kind: "keep",
      waitingId: waiting.change.waiting!.id,
    });

    expect(openedBefore).toBe(0);
    expect(task(app).actions[0]?.memory?.state).toBe("kept");
  });
});

describe("a conversation's choice", () => {
  it("puts the conversation in a project, in none, or keeps nothing from it", async () => {
    const memory = await memoryAt();
    const { app } = await appWith({ memory });
    const made = await app.memory.change({
      kind: "createProject",
      name: "Thesis",
    });
    const id = made.ok ? made.project!.id : "";
    const taskId = await app.createTask();

    await app.memory.setConversation(taskId, { project: id });
    const inProject = task(app).project;
    await app.memory.setConversation(taskId, { project: null, off: true });

    expect(inProject).toBe(id);
    expect(task(app).project).toBeNull();
    expect(task(app).memoryOff).toBe(true);
    await expect(
      app.memory.setConversation(taskId, { project: "gone" }),
    ).rejects.toThrow("That project is no longer kept.");
  });

  it("links the conversation's folder to the project too, when the person asks", async () => {
    const folder = await folders.make("zhiyin-thesis-");
    const memory = await memoryAt();
    const { app } = await appWith({ memory, saved: inFolder(folder) });
    const made = await app.memory.change({
      kind: "createProject",
      name: "Thesis",
    });
    const id = made.ok ? made.project!.id : "";
    const taskId = "task-1";

    await app.memory.setConversation(taskId, { project: id, linkFolder: true });

    expect(task(app).project).toBe(id);
    expect((await memory.projects())[0]?.folders).toEqual([folder]);
  });
});

describe("a folder link memory refuses", () => {
  it("leaves the conversation where it was, saying why", async () => {
    const folder = await folders.make("zhiyin-thesis-");
    const memory = await memoryAt();
    await memory.createProject("Thesis", [folder]);
    const { app } = await appWith({ memory, saved: inFolder(folder) });
    const made = await app.memory.change({
      kind: "createProject",
      name: "Defence",
    });
    const id = made.ok ? made.project!.id : "";

    await expect(
      app.memory.setConversation("task-1", { project: id, linkFolder: true }),
    ).rejects.toThrow(`${folder} is already linked to Thesis.`);
    expect(task(app).project).toBeUndefined();
  });
});

describe("a project made from a conversation", () => {
  it("is named after the conversation's folder, linked to it, and holds the conversation", async () => {
    const folder = await folders.make("zhiyin-thesis-");
    const memory = await memoryAt();
    const { app } = await appWith({ memory, saved: inFolder(folder) });
    const taskId = "task-1";

    const made = await app.memory.change({
      kind: "projectFromConversation",
      taskId,
    });

    const project = made.ok ? made.project : undefined;
    expect(project).toMatchObject({
      name: basename(folder),
      folders: [folder],
    });
    expect(task(app).project).toBe(project?.id);
  });

  it("is made without the folder where work of every kind passes", async () => {
    const folder = await folders.make("zhiyin-documents-");
    const memory = new FileMemory({
      folder: join(await folders.make("zhiyin-core-memory-"), "memory"),
      now: () => new Date("2026-10-31T09:00:00.000Z"),
      newId: () => "write-1",
      broadFolders: [folder],
      recycle: async () => {},
    });
    const { app } = await appWith({ memory, saved: inFolder(folder) });
    const taskId = "task-1";

    const made = await app.memory.change({
      kind: "projectFromConversation",
      taskId,
    });

    const project = made.ok ? made.project : undefined;
    expect(project?.folders).toEqual([]);
    expect(task(app).project).toBe(project?.id);
  });

  it("is refused, saying why, when a project already has the folder's name", async () => {
    const folder = await folders.make("zhiyin-thesis-");
    const memory = await memoryAt();
    const { app } = await appWith({ memory, saved: inFolder(folder) });
    await app.memory.change({ kind: "createProject", name: basename(folder) });
    const taskId = "task-1";

    const made = await app.memory.change({
      kind: "projectFromConversation",
      taskId,
    });

    expect(made).toEqual({
      ok: false,
      reason: `A project is already called ${basename(folder)}.`,
    });
    expect(task(app).project).toBeUndefined();
  });
});

describe("a memory that cannot be read", () => {
  it("still opens the app", async () => {
    const root = await folders.make("zhiyin-core-history-");
    // A file stands where the memory folder should be.
    const place = join(await folders.make("zhiyin-core-memory-"), "memory");
    await writeFile(place, "not a folder");

    const { app } = await appWith({ root, memory: await memoryAt(place) });

    expect(app.snapshot().runtime.tasks).toBe("available");
  });
});
