/**
 * The two things that are only true of a real launch: one app owns the data,
 * and the folder the window shows is the folder the app is actually rooted in.
 *
 * Neither can be established by composing the parts in a test process. A second
 * instance is a second process, and a folder that has moved since the last
 * launch is a fact about the disk.
 */

import { access, mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { emptyConversationLists } from "@zhiyin/contract";
import type { SavedWorkspace } from "@zhiyin/session";
import {
  closeEverything,
  hides,
  launch,
  launchSecondCopy,
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

async function workspaceFolder() {
  const path = await mkdtemp(join(tmpdir(), "zhiyin-installed-work-"));
  folders.push(path);
  return path;
}

async function chooseOnNextNativeDialog(
  app: Awaited<ReturnType<typeof launch>>["app"],
  folder: string,
): Promise<void> {
  await app.evaluate(({ dialog }, selected) => {
    Object.defineProperty(dialog, "showOpenDialog", {
      configurable: true,
      value: async () => ({ canceled: false, filePaths: [selected] }),
    });
  }, folder);
}

function savedIn(folder: string | undefined) {
  return JSON.stringify({
    preferences: { onboarded: true, interests: ["writing"] },
    recentWorkspaces: [],
    selectedTaskId: "task-1",
    ...(folder ? { workspace: { path: folder, name: basename(folder) } } : {}),
    tasks: [
      {
        ...emptyConversationLists,
        id: "task-1",
        title: "Yesterday's work",
        titleSource: "generated",
        updatedAt: "2026-09-09T09:00:00.000Z",
        updatedLabel: "Yesterday",
        messages: [{ id: "m1", role: "user", text: "A question", sequence: 0 }],
        phase: {
          kind: "completed",
          outcome: { title: "Done", summary: "Done." },
        },
      },
    ],
  } satisfies SavedWorkspace);
}

describe("the installed app and its data", () => {
  it("comes back to the conversations and the folder it was left in", async () => {
    const dataDirectory = await temporaryDataDirectory();
    const folder = await workspaceFolder();
    await plantHistory(dataDirectory, savedIn(folder));

    const { window } = await launch({ dataDirectory });

    await shows(window.getByText("Yesterday's work"), "the saved conversation");
    await shows(
      window.getByText(basename(folder), { exact: false }).first(),
      "the folder it was left in",
    );
  });

  it("selects a workspace through the native folder picker", async () => {
    const dataDirectory = await temporaryDataDirectory();
    const folder = await workspaceFolder();
    await plantHistory(dataDirectory, savedIn(undefined));
    const { app, window } = await launch({ dataDirectory });
    await chooseOnNextNativeDialog(app, folder);

    await window.getByRole("button", { name: /^Workspace folder/ }).click();
    await window.getByRole("menuitem", { name: "Choose a folder…" }).click();

    await shows(
      window.getByRole("button", {
        name: `Workspace folder: ${basename(folder)}`,
      }),
      "the folder selected through the native picker",
    );
  });

  it("says the folder has moved rather than rooting itself somewhere else", async () => {
    const dataDirectory = await temporaryDataDirectory();
    const folder = await workspaceFolder();
    await plantHistory(dataDirectory, savedIn(folder));
    await rename(folder, `${folder}-moved`);
    folders.push(`${folder}-moved`);

    const { window } = await launch({ dataDirectory });

    await shows(
      window.getByText(/Choose its new location before using files/),
      "that the folder is no longer where it was",
    );
    // The conversations are still there to come back to.
    await shows(window.getByText("Yesterday's work"), "the saved conversation");
  });

  it("recovers a moved workspace through the native folder picker", async () => {
    const dataDirectory = await temporaryDataDirectory();
    const folder = await workspaceFolder();
    const moved = `${folder}-moved`;
    await plantHistory(dataDirectory, savedIn(folder));
    await rename(folder, moved);
    folders.push(moved);
    const { app, window } = await launch({ dataDirectory });
    await shows(
      window.getByText(/Choose its new location before using files/),
      "the moved-folder notice",
    );
    await chooseOnNextNativeDialog(app, moved);

    await window.getByRole("button", { name: /^Workspace folder/ }).click();
    await window
      .getByRole("menuitem", { name: "Choose another folder…" })
      .click();

    await shows(
      window.getByRole("button", {
        name: `Workspace folder: ${basename(moved)}`,
      }),
      "the moved folder in its new location",
    );
    await hides(
      window.getByText(/Choose its new location before using files/),
      "the moved-folder notice after recovery",
    );
  });

  it("turns a second copy away rather than letting two write to one history", async () => {
    const dataDirectory = await temporaryDataDirectory();
    await plantHistory(dataDirectory, savedIn(undefined));
    const first = await launch({ dataDirectory });
    await shows(
      first.window.getByText("Yesterday's work"),
      "the saved conversation",
    );

    const second = await launchSecondCopy(dataDirectory);

    // The second copy never gets a window of its own to write from.
    expect(second.gotAWindow).toBe(false);
    // And the first is still working.
    await hides(
      first.window.getByText(/could not be saved/i),
      "a save failure in the copy that owns the data",
    );
  });

  it("releases the data lock on an ordinary quit", async () => {
    const dataDirectory = await temporaryDataDirectory();
    const launched = await launch({ dataDirectory });
    const lock = join(dataDirectory, "owner.lock");
    await expect(access(lock)).resolves.toBeUndefined();

    await launched.close();

    await expect(access(lock)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
