/**
 * Memory as the app keeps it (ADR 0026): the Memory page's changes, the
 * conversation's card, and the conversation's own choice of project.
 */

import { readFile, writeFile } from "node:fs/promises";
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

/** A model's send that writes down each request, as its text, when asked to. */
function heardBy(
  heard: string[] | undefined,
  send: ReturnType<typeof calls>,
): ReturnType<typeof calls> {
  if (!heard) return send;
  return (request, ...rest) => {
    heard.push(JSON.stringify(request.messages));
    return send(request, ...rest);
  };
}

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
  /** Where each request the model is sent is written down. */
  readonly heard?: string[];
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
    model: {
      ...deps.model,
      send: heardBy(options.heard, calls(...(options.steps ?? []))),
    },
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

  it("tells the model at its next request that the entry its card undid is no longer kept", async () => {
    const memory = await memoryAt();
    const heard: string[] = [];
    const { app } = await appWith({
      memory,
      heard,
      steps: [["remember", typst], "answer"],
    });
    const taskId = await app.createTask();
    await app.start(taskId, "We chose Typst for the thesis.");
    const kept = task(app).actions.find((action) => action.memory)!.memory!;
    await app.memory.change({ kind: "undo", writeId: kept.writeId });
    const before = heard.length;

    await app.start(taskId, "What do you remember about the thesis?");

    expect(heard[before]).toContain(
      "Taken back from memory, so no longer kept: #1 Typst over LaTeX.",
    );
    expect(heard[before]).toContain(
      'the one answering \\"We chose Typst for the thesis.\\"',
    );
  });

  it("names the one rule its card undid in About you, so the model does not take the rest for gone", async () => {
    const memory = await memoryAt();
    await memory.add({
      section: "about",
      scope: "everything",
      text: "- Their favourite colour is teal.",
    });
    const heard: string[] = [];
    const { app } = await appWith({
      memory,
      heard,
      steps: [
        [
          "remember",
          {
            section: "about",
            scope: "everything",
            rule: "Their favourite city is Porto.",
            quote: "my favourite city is Porto",
          },
        ],
        "answer",
      ],
    });
    const taskId = await app.createTask();
    await app.start(taskId, "Remember that my favourite city is Porto.");
    const kept = task(app).actions.find((action) => action.memory)!.memory!;
    await app.memory.change({ kind: "undo", writeId: kept.writeId });
    const before = heard.length;

    await app.start(taskId, "What do you remember about me?");

    expect(heard[before]).toContain(
      "Taken back from memory, so no longer kept: the rule “Their favourite city is Porto.” in About you.",
    );
    expect(heard[before]).toContain("The rest of About you stays as it is.");
    expect((await memory.state()).entries[0]?.text).toBe(
      "- Their favourite colour is teal.",
    );
  });

  it("marks the card removed when the person removes its entry on the Memory page, and tells the model", async () => {
    const memory = await memoryAt();
    const heard: string[] = [];
    const { app } = await appWith({
      memory,
      heard,
      steps: [["remember", typst], "answer"],
    });
    const taskId = await app.createTask();
    await app.start(taskId, "We chose Typst for the thesis.");

    await app.memory.change({ kind: "remove", number: 1 });
    const before = heard.length;
    await app.start(taskId, "What do you remember about the thesis?");

    const card = task(app).actions.find((action) => action.memory)!.memory!;
    expect(card.state).toBe("removed");
    expect(heard[before]).toContain(
      "The person removed from memory, on the Memory page, what an earlier turn kept",
    );
    expect(heard[before]).toContain("No longer kept: #1 Typst over LaTeX.");
  });

  it("shows the card as before when the person undoes a removal the model had not heard of, and tells it nothing", async () => {
    const memory = await memoryAt();
    const heard: string[] = [];
    const { app } = await appWith({
      memory,
      heard,
      steps: [["remember", typst], "answer"],
    });
    const taskId = await app.createTask();
    await app.start(taskId, "We chose Typst for the thesis.");
    const removed = await app.memory.change({ kind: "remove", number: 1 });

    await app.memory.change({
      kind: "undo",
      writeId: removed.ok ? removed.writeId! : "",
    });
    const before = heard.length;
    await app.start(taskId, "What did we choose?");

    const card = task(app).actions.find((action) => action.memory)!.memory!;
    expect(card.state).toBeUndefined();
    expect((await memory.state()).entries).toHaveLength(1);
    expect(heard[before]).not.toContain("Memory page");
  });

  it("tells the model an entry is kept again when the person undoes its removal after it heard of it", async () => {
    const memory = await memoryAt();
    const heard: string[] = [];
    const { app } = await appWith({
      memory,
      heard,
      steps: [["remember", typst], "answer", "answer"],
    });
    const taskId = await app.createTask();
    await app.start(taskId, "We chose Typst for the thesis.");
    const removed = await app.memory.change({ kind: "remove", number: 1 });
    await app.start(taskId, "Is it still kept?");

    await app.memory.change({
      kind: "undo",
      writeId: removed.ok ? removed.writeId! : "",
    });
    const before = heard.length;
    await app.start(taskId, "And now?");

    expect(heard[before]).toContain(
      "Kept in memory again: #1 Typst over LaTeX. Rely on it as before.",
    );
  });

  it("leaves out of a later review an entry the person removed on the Memory page", async () => {
    const memory = await memoryAt();
    const { app } = await appWith({ memory, steps: [["remember", typst]] });
    const taskId = await app.createTask();
    await app.start(taskId, "We chose Typst for the thesis.");
    await app.memory.change({ kind: "remove", number: 1 });

    const preview = await app.rewinds.preview(
      taskId,
      task(app).messages[0]!.id,
    );

    expect(preview.memory).toEqual([]);
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

  it("leaves an entry the person changed since as they left it, saying so in its review and after", async () => {
    const memory = await memoryAt();
    const { app } = await appWith({ memory, steps: [["remember", typst]] });
    const taskId = await app.createTask();
    await app.start(taskId, "We chose Typst for the thesis.");
    await memory.edit(1, { text: "Chosen on 3 October, for its speed." });
    const why =
      "#1 Typst over LaTeX was changed since, so it was left as it is.";

    const preview = await app.rewinds.preview(
      taskId,
      task(app).messages[0]!.id,
    );
    const result = await app.commitRewind(taskId, preview.id, "keep", "undo");

    expect(preview.memory).toMatchObject([
      { title: "Typst over LaTeX", status: "changed", reason: why },
    ]);
    expect(result.memory).toMatchObject([
      { title: "Typst over LaTeX", status: "refused", reason: why },
    ]);
    expect((await memory.state()).entries).toEqual([
      expect.objectContaining({
        number: 1,
        text: "Chosen on 3 October, for its speed.",
      }),
    ]);
  });

  it("shows the entry the turn kept as taken back in its review, and the Memory page agrees after", async () => {
    const memory = await memoryAt();
    const { app } = await appWith({ memory, steps: [["remember", typst]] });
    const taskId = await app.createTask();
    await app.start(taskId, "We chose Typst for the thesis.");
    const { writeId } = task(app).actions.find(
      (action) => action.memory,
    )!.memory!;

    const preview = await app.rewinds.preview(
      taskId,
      task(app).messages[0]!.id,
    );
    const result = await app.commitRewind(taskId, preview.id, "keep", "undo");

    expect(preview.memory).toEqual([
      { writeId, number: 1, title: "Typst over LaTeX", status: "undoable" },
    ]);
    expect(result.memory).toEqual([
      { writeId, number: 1, title: "Typst over LaTeX", status: "undone" },
    ]);
    expect((await app.memory.state())?.entries).toEqual([]);
  });

  it("names a waiting change the person already kept as theirs, and leaves it", async () => {
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
    const saved = savedWith([waiting.change]);
    const { app } = await appWith({
      memory,
      saved: {
        ...saved,
        messages: [
          { id: "u1", role: "user", text: "Cite as footnotes", sequence: -1 },
        ],
      },
    });
    await app.memory.change({
      kind: "keep",
      waitingId: waiting.change.waiting!.id,
    });

    const preview = await app.rewinds.preview("task-1", "u1");
    const result = await app.commitRewind("task-1", preview.id, "keep", "undo");

    expect(preview.memory).toMatchObject([
      { writeId: waiting.change.writeId, status: "decided" },
    ]);
    expect(result.memory).toMatchObject([{ status: "kept" }]);
    expect((await memory.state()).entries).toMatchObject([
      { section: "how", text: "- Cite sources as footnotes." },
    ]);
  });

  it("leaves out of its review a write already undone from its card", async () => {
    const memory = await memoryAt();
    const { app } = await appWith({ memory, steps: [["remember", typst]] });
    const taskId = await app.createTask();
    await app.start(taskId, "We chose Typst for the thesis.");
    const { writeId } = task(app).actions.find(
      (action) => action.memory,
    )!.memory!;
    await app.memory.change({ kind: "undo", writeId });

    const preview = await app.rewinds.preview(
      taskId,
      task(app).messages[0]!.id,
    );

    // Already undone from its card: nothing is left to say of it.
    expect(preview.memory).toEqual([]);
  });
});

describe("going back keeping memory", () => {
  it("leaves what the turn kept, with nothing left to undo it, while its files are put back", async () => {
    const folder = await folders.make("zhiyin-core-back-");
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
    const { writeId } = task(app).actions.find(
      (action) => action.memory,
    )!.memory!;

    const preview = await app.rewinds.preview(
      taskId,
      task(app).messages[0]!.id,
    );
    const result = await app.commitRewind(
      taskId,
      preview.id,
      "restore",
      "keep",
    );

    expect(await readFile(join(folder, "notes.md"), "utf8")).toBe("my notes");
    expect(result.memory).toMatchObject([{ writeId, status: "kept" }]);
    expect((await memory.state()).entries).toMatchObject([
      { number: 1, title: "Typst over LaTeX" },
    ]);
    expect(await memory.undoable(writeId)).toEqual({
      ok: false,
      reason: "That change is no longer known.",
    });
  });

  it("takes memory back while the files stay as the turn left them", async () => {
    const folder = await folders.make("zhiyin-core-back-");
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

    const preview = await app.rewinds.preview(
      taskId,
      task(app).messages[0]!.id,
    );
    await app.commitRewind(taskId, preview.id, "keep", "undo");

    expect(await readFile(join(folder, "notes.md"), "utf8")).toBe(
      "Typst it is.",
    );
    expect((await memory.state()).entries).toEqual([]);
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

  it("tells the model at its next request which entry was taken back, and a recall of its number says so", async () => {
    const folder = await folders.make("zhiyin-core-undo-");
    await writeFile(join(folder, "notes.md"), "my notes", "utf8");
    const memory = await memoryAt();
    const heard: string[] = [];
    const { app } = await appWith({
      memory,
      folder,
      heard,
      steps: [
        ["write_file", { path: "notes.md", content: "Typst it is." }],
        ["remember", typst],
        "answer",
        ["recall", { numbers: [1] }],
      ],
    });
    await app.selectWorkspace(folder);
    const taskId = await app.createTask();
    await app.start(taskId, "We chose Typst for the thesis.");
    const preview = await app.rewinds.previewUndo(
      taskId,
      task(app).messages[0]!.id,
    );
    await app.commitUndo(taskId, preview.id, "restore", "undo");
    const before = heard.length;

    await app.start(taskId, "What did we choose?");

    expect(heard[before]).toMatch(
      /Taken back from memory, so no longer kept: #1 Typst over LaTeX/,
    );
    expect(heard[before + 1]).toContain(
      "#1 was taken back when the person undid the turn that kept it.",
    );
  });

  it("keeps what the turn kept when the person undoes only its files", async () => {
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
    const result = await app.commitUndo(taskId, preview.id, "restore", "keep");

    expect(await readFile(join(folder, "notes.md"), "utf8")).toBe("my notes");
    expect(result.memory).toMatchObject([{ status: "kept" }]);
    expect((await memory.state()).entries).toHaveLength(1);
    expect(
      task(app).actions.find((action) => action.memory)?.memory?.state,
    ).toBeUndefined();
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
