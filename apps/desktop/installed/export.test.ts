/**
 * Exporting a conversation in the built app: the menu, the save dialog, the
 * core reading the whole record, and the file on disk. The unit suites prove
 * each piece; this proves they are wired together.
 */

import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { emptyConversationLists } from "@zhiyin/contract";
import type { SavedWorkspace } from "@zhiyin/session";
import {
  closeEverything,
  launch,
  plantHistory,
  shows,
  temporaryDataDirectory,
} from "./launch.js";

const folders = new TemporaryFolders();

/** Windows' own tar, which a PATH with Git's tools would otherwise hide. */
const windowsTar = join(
  process.env["SystemRoot"] ?? "C:\\Windows",
  "System32",
  "tar.exe",
);

afterEach(async () => {
  await closeEverything();
  await folders.removeAll();
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
  const folder = await folders.make("zhiyin-installed-export-");
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

  // The app says so once the file is written whole; a file that merely
  // exists may still be empty.
  await shows(dialog.getByText("Saved", { exact: true }), "the export saved");
  return destination;
}

describe("the installed app exporting a conversation", () => {
  it("saves a page to read, with the command's credential removed", async () => {
    const page = await readFile(
      await exportAs(/A page to read/, "work.html"),
      "utf8",
    );

    expect(page).toContain("Yesterday&#39;s work");
    expect(page).toContain("Run a command");
    expect(page).not.toContain("installed-secret-42");
  });

  it("saves a trajectory for analysis, in a .zip Windows opens, with what was sent to the model", async () => {
    const zip = await exportAs(/Data to analyse/, "work.zip");
    const opened = await folders.make("zhiyin-installed-opened-");

    expect(spawnSync(windowsTar, ["-xf", zip, "-C", opened]).status).toBe(0);
    const text = await readFile(join(opened, "trajectory.json"), "utf8");
    const trajectory = JSON.parse(text) as {
      schema_version: string;
      steps: { source: string; message: string }[];
    };
    expect(trajectory.schema_version).toBe("ATIF-v1.8");
    expect(trajectory.steps).toMatchObject([
      { source: "user", message: "A question" },
    ]);
    expect(text).not.toContain("installed-secret-42");
  });
});
