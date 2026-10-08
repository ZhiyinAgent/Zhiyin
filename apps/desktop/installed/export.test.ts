/**
 * Exporting a conversation in the built app: the menu, the save dialog, the
 * core reading the whole record, and the file on disk. The unit suites prove
 * each piece; this proves they are wired together.
 */

import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { emptyConversationLists } from "@zhiyin/contract";
import type { SavedWorkspace } from "@zhiyin/session";
import {
  closeEverything,
  launch,
  plantHistory,
  shows,
  temporaryDataDirectory,
} from "./launch.js";

const folders: string[] = [];

afterEach(async () => {
  await closeEverything();
  await Promise.all(
    folders.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

const secret = 'curl -H "Authorization: Bearer installed-secret-42" https://x';

const history = JSON.stringify({
  preferences: { onboarded: true, interests: ["writing"] },
  recentWorkspaces: [],
  selectedTaskId: "task-1",
  tasks: [
    {
      ...emptyConversationLists,
      id: "task-1",
      title: "Yesterday's work",
      titleSource: "generated",
      updatedAt: "2026-10-04T09:00:00.000Z",
      updatedLabel: "Yesterday",
      messages: [{ id: "m1", role: "user", text: "A question", sequence: 0 }],
      actions: [
        {
          id: "a1",
          action: "Run a command",
          target: secret,
          command: secret,
          approval: { by: "you", at: "2026-10-04T09:00:01.000Z" },
          status: "completed",
          sequence: 1,
        },
      ],
      modelHistory: [{ id: "h1", kind: "message", messageId: "m1" }],
      phase: {
        kind: "completed",
        outcome: { title: "Done", summary: "Done." },
      },
    },
  ],
} satisfies SavedWorkspace);

async function exportAs(format: RegExp, file: string) {
  const dataDirectory = await temporaryDataDirectory();
  await plantHistory(dataDirectory, history);
  const folder = await mkdtemp(join(tmpdir(), "zhiyin-installed-export-"));
  folders.push(folder);
  const destination = join(folder, file);
  const { app, window } = await launch({ dataDirectory });
  await shows(window.getByText("Yesterday's work").first(), "the conversation");
  await app.evaluate(({ dialog }, chosen) => {
    Object.defineProperty(dialog, "showSaveDialog", {
      configurable: true,
      value: async () => ({ canceled: false, filePath: chosen }),
    });
  }, destination);

  await window
    .getByRole("button", { name: "Options for Yesterday's work" })
    .click();
  await window.getByRole("menuitem", { name: "Export…" }).click();
  const dialog = window.getByRole("dialog", { name: "Export conversation" });
  await dialog.getByRole("radio", { name: format }).check();
  await dialog.getByRole("button", { name: "Export…" }).click();

  await expect
    .poll(
      () =>
        stat(destination).then(
          () => true,
          () => false,
        ),
      {
        timeout: 10_000,
      },
    )
    .toBe(true);
  return readFile(destination, "utf8");
}

describe("the installed app exporting a conversation", () => {
  it("saves a page to read, with the command's credential removed", async () => {
    const page = await exportAs(/A page to read/, "work.html");

    expect(page).toContain("Yesterday&#39;s work");
    expect(page).toContain("Run a command");
    expect(page).not.toContain("installed-secret-42");
  });

  it("saves the whole record for analysis, with what was sent to the model", async () => {
    const record = JSON.parse(
      await exportAs(/Data to analyse/, "work.json"),
    ) as { conversation: { modelHistory: unknown[] } };

    expect(record.conversation.modelHistory).toEqual([
      { id: "h1", kind: "message", messageId: "m1" },
    ]);
    expect(JSON.stringify(record)).not.toContain("installed-secret-42");
  });
});
