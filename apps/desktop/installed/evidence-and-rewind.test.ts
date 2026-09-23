import { createHash } from "node:crypto";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileSessions } from "@zhiyin/session";
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

function task(messages: readonly object[]) {
  return {
    id: "rewind-task",
    title: "Interrupted rewind",
    titleSource: "generated",
    updatedAt: "2026-09-13T09:00:00.000Z",
    updatedLabel: "Today",
    messages,
    actions: [],
    phase: { kind: "completed", outcome: { title: "Done", summary: "Done." } },
  };
}

const originalTask = task([
  { id: "u1", role: "user", text: "Keep this", sequence: 0 },
  { id: "a1", role: "assistant", text: "Discard this", sequence: 1 },
]);
const rewoundTask = task([]);

function workspace(savedTask: ReturnType<typeof task>) {
  return JSON.stringify({
    version: 1,
    preferences: { onboarded: true, interests: [] },
    runtime: { tasks: "available", capabilities: "available" },
    selectedTaskId: savedTask.id,
    tasks: [savedTask],
    skills: [],
    subagents: [],
    mcpServers: [],
    usage: { status: "unavailable", reason: "None." },
  });
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

    expect(await readFile(planted.target, "utf8")).toBe("original bytes");
    const saved = await new FileSessions(dataDirectory).loadWorkspace();
    expect(saved?.tasks[0]?.messages).toEqual([]);
    expect(await readdir(planted.journal)).toEqual([]);
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

    expect(await readFile(planted.target, "utf8")).toBe("original bytes");
    expect(await readdir(planted.journal)).toEqual([]);
  });
});

describe("installed private evidence", () => {
  it("shows limits at minimum size and deletes corrections by keyboard with reduced motion", async () => {
    const dataDirectory = await temporaryDataDirectory();
    await plantHistory(dataDirectory, workspace(originalTask));
    await writeFile(
      join(dataDirectory, "corrections.log"),
      `${JSON.stringify({
        at: "2026-09-13T09:00:00.000Z",
        taskId: originalTask.id,
        toolName: "write_file",
        kind: "repair-rejected",
        reason: "The requested path changed.",
        cause: "content-changed",
      })}\n`,
      "utf8",
    );
    const launched = await launch({ dataDirectory });
    await launched.window.emulateMedia({ reducedMotion: "reduce" });
    await launched.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(720, 480);
    });
    await launched.window
      .getByRole("button", { name: "Open navigation" })
      .click();
    await launched.window
      .getByRole("button", { name: "Open app menu" })
      .click();
    await launched.window
      .getByRole("menuitem", { name: "Evidence & recovery" })
      .click();

    await shows(
      launched.window.getByRole("region", { name: "Private evidence" }),
      "private evidence",
    );
    await shows(
      launched.window.getByText(/256.0 MiB total/),
      "recovery limits",
    );
    await shows(
      launched.window.getByText(/Newest 1 shown/),
      "correction usage",
    );
    expect(
      await launched.window.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);

    const remove = launched.window.getByRole("button", {
      name: "Delete correction log",
    });
    await remove.focus();
    await launched.window.keyboard.press("Enter");
    const confirm = launched.window.getByRole("button", {
      name: "Delete",
      exact: true,
    });
    await confirm.focus();
    await launched.window.keyboard.press("Enter");
    await shows(
      launched.window.getByText("Nothing recorded"),
      "the empty correction log",
    );
    await expect(
      access(join(dataDirectory, "corrections.log")),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
