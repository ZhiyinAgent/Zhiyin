/**
 * The history as the app uses it: the list read at launch, a conversation read
 * when it is first needed, and a save that writes what changed rather than
 * everything kept. These run the core against the real history store, since
 * what they are about is what reaches the disk.
 */

import { appendFile, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyConversationLists, type WorkspaceTask } from "@zhiyin/contract";
import { FileSessions, historyFiles, type Sessions } from "@zhiyin/session";
import { loopFrom, stubDependencies } from "./support.js";

const roots: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "zhiyin-opening-"));
  roots.push(root);
  return root;
}

function conversation(index: number): WorkspaceTask {
  return {
    id: `task-${index}`,
    title: `Conversation ${index}`,
    titleSource: "manual",
    // Before the test clock, so anything the app changes is newer.
    updatedAt: "2026-09-01T10:00:00.000Z",
    updatedLabel: "Earlier",
    ...emptyConversationLists,
    messages: Array.from({ length: 10 }, (_, turn) => ({
      id: `task-${index}-message-${turn}`,
      role: turn % 2 ? ("assistant" as const) : ("user" as const),
      text: `Message ${turn} of conversation ${index}. `.repeat(20),
      sequence: turn,
    })),
    actions: [],
    phase: { kind: "completed", outcome: { title: "Done", summary: "Done." } },
  };
}

async function plant(root: string, count: number, selected = "task-0") {
  await new FileSessions(root).saveWorkspace({
    tasks: Array.from({ length: count }, (_, index) => conversation(index)),
    selectedTaskId: selected,
    recentWorkspaces: [],
  });
}

/** The real store, with every conversation it reads counted. */
function counted(root: string, options = {}) {
  const sessions = new FileSessions(root, options);
  const opened: string[] = [];
  const counting = new Proxy(sessions, {
    get(target, key) {
      if (key === "openConversation")
        return (id: string) => {
          opened.push(id);
          return target.openConversation(id);
        };
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as Sessions;
  return { sessions: counting, opened };
}

function appOver(sessions: Sessions) {
  const deps = stubDependencies(() => {});
  return loopFrom({ ...deps, sessions, revealDelayMs: 0 });
}

describe("opening conversations", () => {
  it("reads only the selected conversation at launch, and another when it is selected", async () => {
    const root = await temporaryRoot();
    await plant(root, 3, "task-1");
    const { sessions, opened } = counted(root);
    const app = appOver(sessions);

    await app.initialize();

    expect(opened).toEqual(["task-1"]);
    expect(app.snapshot().tasks.map((task) => task.id)).toEqual(["task-1"]);
    expect(app.snapshot().conversations?.map((item) => item.id)).toEqual([
      "task-0",
      "task-1",
      "task-2",
    ]);

    await app.selectTask("task-2");

    expect(opened).toEqual(["task-1", "task-2"]);
    expect(app.snapshot().tasks.find((task) => task.id === "task-2")).toEqual(
      conversation(2),
    );
  });

  it("leaves a conversation nobody opened exactly as it was saved", async () => {
    const root = await temporaryRoot();
    await plant(root, 3);
    const app = appOver(new FileSessions(root));
    await app.initialize();

    await app.renameTask("task-0", "Renamed");

    const saved = await new FileSessions(root).loadWorkspace();
    expect(saved?.tasks.map((task) => task.title)).toEqual([
      "Renamed",
      "Conversation 1",
      "Conversation 2",
    ]);
    expect(saved?.tasks[2]).toEqual(conversation(2));
  });

  it("renames and deletes conversations from the list without their being opened first", async () => {
    const root = await temporaryRoot();
    await plant(root, 3);
    const app = appOver(new FileSessions(root));
    await app.initialize();

    await app.renameTask("task-2", "Renamed from the list");
    await app.deleteTask("task-1");

    expect(
      (await new FileSessions(root).loadIndex())?.conversations.map(
        (item) => item.title,
      ),
    ).toEqual(["Renamed from the list", "Conversation 0"]);
  });

  it("shows a damaged conversation as selected, with its report, keeps a copy, and opens every other", async () => {
    const root = await temporaryRoot();
    await plant(root, 3);
    await writeFile(
      join(root, "history", "conversations", "c-task-2", "conversation.jsonl"),
      "not json",
      "utf8",
    );
    const app = appOver(new FileSessions(root));
    await app.initialize();

    await app.selectTask("task-2");

    // Selected, so the window shows its report where the conversation would be.
    expect(app.snapshot().selectedTaskId).toBe("task-2");
    expect(app.snapshot().tasks.map((task) => task.id)).not.toContain("task-2");
    expect(app.snapshot().issues).toEqual([
      {
        message:
          "“Conversation 2” is damaged and can't be opened. Your other conversations are unaffected.",
        keptAt: expect.stringContaining("damaged-history"),
        conversationId: "task-2",
        canDelete: true,
      },
    ]);
    await app.selectTask("task-1");
    expect(app.snapshot().selectedTaskId).toBe("task-1");
  });

  it("reports a damaged conversation once and keeps one copy however often it is opened, and drops the report when it is deleted", async () => {
    const root = await temporaryRoot();
    await plant(root, 2);
    await writeFile(
      join(root, "history", "conversations", "c-task-1", "conversation.jsonl"),
      "not json",
      "utf8",
    );
    const app = appOver(new FileSessions(root));
    await app.initialize();

    for (let attempt = 0; attempt < 3; attempt += 1)
      await app.selectTask("task-1");

    expect(app.snapshot().issues).toHaveLength(1);
    expect(await readdir(join(root, "damaged-history"))).toHaveLength(1);

    await app.deleteTask("task-1");
    expect(app.snapshot().issues ?? []).toEqual([]);
    expect(app.snapshot().conversations?.map((item) => item.id)).toEqual([
      "task-0",
    ]);
  });

  it("keeps one copy of the damaged history per launch, however many damaged conversations are opened", async () => {
    const root = await temporaryRoot();
    await plant(root, 3);
    for (const id of ["task-1", "task-2"])
      await writeFile(
        join(root, "history", "conversations", `c-${id}`, "conversation.jsonl"),
        "not json",
        "utf8",
      );
    const app = appOver(new FileSessions(root));
    await app.initialize();

    await app.selectTask("task-1");
    await app.selectTask("task-2");

    expect(await readdir(join(root, "damaged-history"))).toHaveLength(1);
    const kept = (app.snapshot().issues ?? []).map((issue) => issue.keptAt);
    expect(kept).toHaveLength(2);
    expect(kept[0]).toBe(kept[1]);
  });

  it("keeps a damaged conversation selected at launch, so its report is what is shown", async () => {
    const root = await temporaryRoot();
    await plant(root, 2, "task-1");
    await writeFile(
      join(root, "history", "conversations", "c-task-1", "conversation.jsonl"),
      "not json",
      "utf8",
    );
    const app = appOver(new FileSessions(root));

    await app.initialize();

    expect(app.snapshot().selectedTaskId).toBe("task-1");
    expect(app.snapshot().issues).toEqual([
      expect.objectContaining({ conversationId: "task-1", canDelete: true }),
    ]);
  });

  it("lets a person dismiss a report", async () => {
    const root = await temporaryRoot();
    await plant(root, 2);
    await writeFile(
      join(root, "history", "conversations", "c-task-1", "conversation.jsonl"),
      "not json",
      "utf8",
    );
    const app = appOver(new FileSessions(root));
    await app.initialize();
    await app.selectTask("task-1");
    const [issue] = app.snapshot().issues ?? [];

    await app.dismissIssue(issue?.message ?? "");

    expect(app.snapshot().issues ?? []).toEqual([]);
  });

  it("lists the conversation changed last first", async () => {
    const root = await temporaryRoot();
    await plant(root, 3);
    const app = appOver(new FileSessions(root));
    await app.initialize();

    await app.renameTask("task-1", "Worked on just now");

    expect(app.snapshot().conversations?.map((item) => item.id)).toEqual([
      "task-1",
      "task-0",
      "task-2",
    ]);
  });

  it("says where conversations that could not be read at all were kept", async () => {
    const root = await temporaryRoot();
    await plant(root, 3);
    const folder = join(root, "history", "conversations", "c-task-2");
    for (const name of await readdir(folder))
      await writeFile(join(folder, name), "not json", "utf8");
    const app = appOver(new FileSessions(root));

    await app.initialize();

    expect(app.snapshot().conversations?.map((item) => item.id)).toEqual([
      "task-0",
      "task-1",
    ]);
    expect(app.snapshot().issues).toEqual([
      {
        message: expect.stringMatching(
          /^One saved conversation was damaged beyond reading/,
        ),
        keptAt: expect.stringContaining("damaged-history"),
      },
    ]);
  });

  it("says when the last moment before the app closed was not saved", async () => {
    const root = await temporaryRoot();
    await plant(root, 1);
    await appendFile(
      join(root, "history", "conversations", "c-task-0", "conversation.jsonl"),
      '{"changes":[{"p":',
      "utf8",
    );
    const app = appOver(new FileSessions(root));

    await app.initialize();

    expect(app.snapshot().tasks[0]).toEqual(conversation(0));
    expect(app.snapshot().issues).toContainEqual({
      message:
        "The last moment of “Conversation 0” before the app closed was not saved.",
      conversationId: "task-0",
    });
  });
});

describe("what a streamed reply costs on disk", () => {
  /*
   * A checkpoint writes what changed in one conversation. Rewriting the whole
   * history instead would be about 100 × 9 KB each second of streaming here.
   */
  it("writes under 200 KB to stream a 2,000-token reply in a history of 100 conversations", async () => {
    const root = await temporaryRoot();
    await plant(root, 100);
    let written = 0;
    const count = (text: string) => {
      written += Buffer.byteLength(text, "utf8");
    };
    const sessions = new FileSessions(root, {
      historyFiles: {
        ...historyFiles,
        append: (path, text) => {
          count(text);
          return historyFiles.append(path, text);
        },
        create: (path, text) => {
          count(text);
          return historyFiles.create(path, text);
        },
        write: (path, text) => {
          count(text);
          return historyFiles.write(path, text);
        },
      },
    });
    vi.useFakeTimers({ toFake: ["Date"] });
    const startedAt = new Date("2026-09-23T10:00:00.000Z").getTime();
    vi.setSystemTime(startedAt);
    const deps = stubDependencies(() => {});
    const app = loopFrom({
      ...deps,
      sessions,
      revealDelayMs: 0,
      model: {
        ...deps.model,
        // A token every 20 ms: fifty a second, a fast model's pace.
        send: async function* () {
          for (let token = 0; token < 2_000; token += 1) {
            vi.setSystemTime(startedAt + token * 20);
            yield { kind: "textDelta" as const, text: "word " };
          }
          yield { kind: "done" as const };
        },
      },
    });
    await app.initialize();
    written = 0;

    await app.start("task-0", "Write at length");

    const reply = app.snapshot().tasks[0]?.messages.at(-1)?.text ?? "";
    expect(reply.length).toBe(2_000 * "word ".length);
    expect(written).toBeLessThan(200 * 1024);
    // And what was written is the reply, whole, when the history is read again.
    const saved = await new FileSessions(root).loadWorkspace();
    expect(saved?.tasks[0]?.messages.at(-1)?.text).toBe(reply);
  });
});
