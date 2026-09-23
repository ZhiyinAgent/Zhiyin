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
import type { WorkspaceTask } from "@zhiyin/contract";
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
    updatedAt: "2026-09-20T10:00:00.000Z",
    updatedLabel: "Earlier",
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
    ).toEqual(["Conversation 0", "Renamed from the list"]);
  });

  it("reports a damaged conversation, keeps a copy, and opens every other", async () => {
    const root = await temporaryRoot();
    await plant(root, 3);
    const folder = join(root, "history", "conversations", "c-task-2");
    for (const name of await readdir(folder))
      await writeFile(join(folder, name), "not json", "utf8");
    const app = appOver(new FileSessions(root));
    await app.initialize();

    await app.selectTask("task-2");

    expect(app.snapshot().selectedTaskId).toBe("task-0");
    expect(app.snapshot().issues?.join(" ")).toMatch(
      /“Conversation 2” is damaged.*A copy was kept at/,
    );
    await app.selectTask("task-1");
    expect(app.snapshot().selectedTaskId).toBe("task-1");
  });

  it("says when the last moment before the app closed was not saved", async () => {
    const root = await temporaryRoot();
    await plant(root, 1);
    const folder = join(root, "history", "conversations", "c-task-0");
    const [name] = await readdir(folder);
    await appendFile(join(folder, name!), '{"changes":[{"p":', "utf8");
    const app = appOver(new FileSessions(root));

    await app.initialize();

    expect(app.snapshot().tasks[0]).toEqual(conversation(0));
    expect(app.snapshot().issues).toContain(
      "The last moment of “Conversation 0” before the app closed was not saved.",
    );
  });
});

describe("what a streamed reply costs on disk", () => {
  /*
   * Before conversations were kept apart, every checkpoint rewrote the whole
   * history: here, about 100 × 9 KB each second of streaming.
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
