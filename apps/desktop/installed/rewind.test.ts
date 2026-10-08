import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { emptyConversationLists, type WorkspaceTask } from "@zhiyin/contract";
import { FileSessions, type SavedWorkspace } from "@zhiyin/session";
import {
  closeEverything,
  launch,
  plantHistory,
  shows,
  temporaryDataDirectory,
} from "./launch.js";

afterEach(closeEverything);

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

function task(messages: WorkspaceTask["messages"]): WorkspaceTask {
  return {
    ...emptyConversationLists,
    id: "rewind-task",
    title: "Interrupted rewind",
    titleSource: "generated",
    updatedAt: "2026-09-13T09:00:00.000Z",
    updatedLabel: "Today",
    messages,
    phase: { kind: "completed", outcome: { title: "Done", summary: "Done." } },
  };
}

const originalTask = task([
  { id: "u1", role: "user", text: "Keep this", sequence: 0 },
  { id: "a1", role: "assistant", text: "Discard this", sequence: 1 },
]);
const rewoundTask = task([]);

function workspace(savedTask: WorkspaceTask) {
  return JSON.stringify({
    preferences: { onboarded: true, interests: [] },
    recentWorkspaces: [],
    selectedTaskId: savedTask.id,
    tasks: [savedTask],
  } satisfies SavedWorkspace);
}

async function plantInterruptedRewind(options: {
  readonly dataDirectory: string;
  readonly workspaceDirectory: string;
  readonly conversationSaved: boolean;
}) {
  const changed = "changed by discarded work";
  const restored = "original bytes";
  const target = join(options.workspaceDirectory, "notes.txt");
  const backup = join(options.dataDirectory, "rewind-backup.bin");
  await mkdir(options.workspaceDirectory, { recursive: true });
  await writeFile(
    target,
    options.conversationSaved ? restored : changed,
    "utf8",
  );
  await writeFile(backup, restored, "utf8");
  await plantHistory(
    options.dataDirectory,
    workspace(options.conversationSaved ? rewoundTask : originalTask),
  );
  const id = options.conversationSaved ? "after-save" : "before-save";
  const operation = {
    version: 1,
    id,
    conversationId: originalTask.id,
    source: JSON.stringify(originalTask),
    task: rewoundTask,
    review: {
      id,
      workspaceRoot: options.workspaceDirectory,
      files: [{ path: "notes.txt", action: "restore", status: "recoverable" }],
      targets: [
        {
          path: "notes.txt",
          absolute: target,
          expected: digest(changed),
          restored: digest(restored),
          action: "restore",
          backup,
        },
      ],
    },
    ...(options.conversationSaved
      ? { result: { files: [{ path: "notes.txt", status: "restored" }] } }
      : {}),
  };
  const journal = join(options.dataDirectory, "pending-rewinds");
  await mkdir(journal, { recursive: true });
  await writeFile(
    join(journal, `${digest(id)}.json`),
    JSON.stringify(operation),
    "utf8",
  );
  return { target, journal };
}

describe("installed rewind crash recovery", () => {
  it("finishes file restoration and conversation persistence after a stop before save", async () => {
    const dataDirectory = await temporaryDataDirectory();
    const workspaceDirectory = join(dataDirectory, "work");
    const planted = await plantInterruptedRewind({
      dataDirectory,
      workspaceDirectory,
      conversationSaved: false,
    });

    const { window } = await launch({ dataDirectory });
    await shows(
      window.getByText("Interrupted rewind"),
      "the resumed conversation",
    );

    // The title shows from the saved list before recovery has run, so the
    // outcome is waited for rather than read once.
    await expect
      .poll(() => readFile(planted.target, "utf8"), { timeout: 15_000 })
      .toBe("original bytes");
    await expect
      .poll(
        async () => {
          const saved = await new FileSessions(dataDirectory).loadWorkspace();
          return saved?.tasks[0]?.messages;
        },
        { timeout: 15_000 },
      )
      .toEqual([]);
    await expect
      .poll(() => readdir(planted.journal), { timeout: 15_000 })
      .toEqual([]);
  });

  it("only clears durable intent after a stop following conversation persistence", async () => {
    const dataDirectory = await temporaryDataDirectory();
    const planted = await plantInterruptedRewind({
      dataDirectory,
      workspaceDirectory: join(dataDirectory, "work"),
      conversationSaved: true,
    });

    const { window } = await launch({ dataDirectory });
    await shows(
      window.getByText("Interrupted rewind"),
      "the rewound conversation",
    );

    await expect
      .poll(() => readdir(planted.journal), { timeout: 15_000 })
      .toEqual([]);
    expect(await readFile(planted.target, "utf8")).toBe("original bytes");
  });
});
