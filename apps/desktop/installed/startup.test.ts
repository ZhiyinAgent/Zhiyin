/**
 * The app, started for real, on data that is in trouble.
 *
 * The unit suites prove each piece behaves. What they cannot prove is that the
 * pieces are wired to each other in the built app: that the damaged-history
 * question actually reaches the window, that the answer actually reaches the
 * store, and that the bytes really are still on disk afterwards.
 */

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { emptyConversationLists, type WorkspaceTask } from "@zhiyin/contract";
import type { SavedWorkspace } from "@zhiyin/session";
import {
  closeEverything,
  hides,
  historySettingsFile,
  launch,
  plantHistory,
  shows,
  temporaryDataDirectory,
} from "./launch.js";

afterEach(closeEverything);

/** The saved settings, as the bytes on disk. */
function settingsText(file: string): Promise<string> {
  return readFile(file, "utf8");
}

function conversation(id: string): WorkspaceTask {
  return {
    ...emptyConversationLists,
    id,
    title: `Conversation ${id}`,
    titleSource: "generated",
    updatedAt: "2026-09-08T09:00:00.000Z",
    updatedLabel: "Tuesday",
    messages: [
      { id: `${id}-m1`, role: "user", text: "A question", sequence: 0 },
    ],
    phase: { kind: "completed", outcome: { title: "Done", summary: "Done." } },
  };
}

/**
 * Somebody who has been using the app: they have answered the first-run
 * questions, and their history has since been damaged — one setting and one
 * conversation. Without the preferences a damaged file is indistinguishable
 * from a fresh install, and recovery would correctly drop them into
 * onboarding instead of their conversations.
 */
const damagedButPartlyReadable = JSON.stringify({
  preferences: { onboarded: true, interests: ["writing"] },
  recentWorkspaces: [],
  // A folder that is not one: the settings are damaged.
  workspace: { path: 42 },
  selectedTaskId: "keep-1",
  tasks: [
    conversation("keep-1"),
    { ...conversation("broken"), phase: { kind: "invented" } },
    conversation("keep-2"),
  ],
});

const ordinaryWorkspace = JSON.stringify({
  preferences: { onboarded: true, interests: [] },
  recentWorkspaces: [],
  selectedTaskId: "keep-1",
  tasks: [conversation("keep-1")],
} satisfies SavedWorkspace);

describe("the installed app on damaged history", () => {
  it("asks what to do instead of starting empty or refusing to start", async () => {
    const dataDirectory = await temporaryDataDirectory();
    await plantHistory(dataDirectory, damagedButPartlyReadable);

    const { window } = await launch({ dataDirectory });

    await shows(
      window.getByText(/could not be opened/i),
      "the recovery question",
    );
    await shows(
      window.getByRole("button", { name: /Open the 2 conversations/ }),
      "the offer to open what survived",
    );
  });

  it("fits the minimum window and can recover using only the keyboard", async () => {
    const dataDirectory = await temporaryDataDirectory();
    await plantHistory(dataDirectory, damagedButPartlyReadable);
    const { app, window } = await launch({ dataDirectory });
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(720, 480);
    });
    const recover = window.getByRole("button", {
      name: /Open the 2 conversations/,
    });
    await shows(recover, "the recovery action at minimum size");
    expect(
      await window.evaluate(
        () => document.documentElement.scrollWidth <= globalThis.innerWidth,
      ),
    ).toBe(true);

    await window.bringToFront();
    let focused = false;
    for (let press = 0; press < 12; press += 1) {
      await window.keyboard.press("Tab");
      focused = await recover.evaluate(
        (element) => element === document.activeElement,
      );
      if (focused) break;
    }
    expect(focused).toBe(true);
    await recover.press("Enter");

    await hides(
      window.getByText(/could not be opened/i),
      "the recovery question after its keyboard action",
    );
    await shows(window.getByText("A question"), "the recovered conversation");
  });

  it("still holds the damaged bytes on disk while the question is open", async () => {
    const dataDirectory = await temporaryDataDirectory();
    await plantHistory(dataDirectory, damagedButPartlyReadable);
    const planted = await settingsText(historySettingsFile(dataDirectory));

    const { window } = await launch({ dataDirectory });
    await shows(
      window.getByText(/could not be opened/i),
      "the recovery question",
    );

    const kept = await readdir(join(dataDirectory, "damaged-history"));
    expect(kept).toHaveLength(1);
    expect(
      await settingsText(
        join(dataDirectory, "damaged-history", kept[0]!, "settings.json"),
      ),
    ).toBe(planted);
    // And the settings it came from have not been written over.
    expect(await settingsText(historySettingsFile(dataDirectory))).toBe(
      planted,
    );
  });

  it("opens the conversations that survived when that is chosen", async () => {
    const dataDirectory = await temporaryDataDirectory();
    await plantHistory(dataDirectory, damagedButPartlyReadable);

    const { window } = await launch({ dataDirectory });
    await window
      .getByRole("button", { name: /Open the 2 conversations/ })
      .click({ timeout: 30_000 });

    await shows(
      window.getByText("Conversation keep-1"),
      "a conversation that survived",
    );
  });

  it("comes back to the recovered conversations on the next launch", async () => {
    const dataDirectory = await temporaryDataDirectory();
    await plantHistory(dataDirectory, damagedButPartlyReadable);

    const first = await launch({ dataDirectory });
    await first.window
      .getByRole("button", { name: /Open the 2 conversations/ })
      .click({ timeout: 30_000 });
    await shows(
      first.window.getByText("Conversation keep-1"),
      "a conversation that survived",
    );
    await first.close();

    const second = await launch({ dataDirectory });

    await shows(
      second.window.getByText("Conversation keep-1"),
      "the recovered conversations on the next launch",
    );
    await hides(
      second.window.getByText(/could not be opened/i),
      "the recovery question after it was answered",
    );
  });

  it("keeps the settings that survived, so recovery is not a fresh install", async () => {
    const dataDirectory = await temporaryDataDirectory();
    await plantHistory(dataDirectory, damagedButPartlyReadable);

    const { window } = await launch({ dataDirectory });
    await window
      .getByRole("button", { name: /Open the 2 conversations/ })
      .click({ timeout: 30_000 });

    await shows(
      window.getByText("Conversation keep-1"),
      "a conversation that survived",
    );
    await hides(
      window.getByText(/WELCOME TO ZHIYIN/),
      "the first-run questions to somebody who had already answered them",
    );
  });

  it("starts on a clean slate only when that is chosen, and still keeps the damaged copy", async () => {
    const dataDirectory = await temporaryDataDirectory();
    await plantHistory(dataDirectory, "this is not a workspace at all");

    const { window } = await launch({ dataDirectory });
    await window
      .getByRole("button", { name: "Start with a clean slate" })
      .click({ timeout: 30_000 });

    await hides(
      window.getByText(/could not be opened/i),
      "the recovery question after it was answered",
    );
    const kept = await readdir(join(dataDirectory, "damaged-history"));
    expect(kept).toHaveLength(1);
    expect(
      await settingsText(
        join(dataDirectory, "damaged-history", kept[0]!, "settings.json"),
      ),
    ).toBe("this is not a workspace at all");
  });
});

describe("the installed app on ordinary data", () => {
  it("opens without a recovery question when nothing is damaged", async () => {
    const { window } = await launch();

    await hides(
      window.getByText(/could not be opened/i),
      "a recovery question it had no reason to ask",
    );
  });

  it("keeps its data in a folder named Zhiyin when no other is given", async () => {
    const { app } = await launch();

    // Electron puts the data folder under the app's name; a test names its own
    // folder, so the default is read rather than used.
    const folder = await app.evaluate(({ app }) => app.getName());

    expect(folder).toBe("Zhiyin");
  });

  it("opens and reports unavailable secure credential storage", async () => {
    const dataDirectory = await temporaryDataDirectory();
    await plantHistory(dataDirectory, ordinaryWorkspace);
    const { window } = await launch({
      dataDirectory,
      credentialsUnavailable: true,
    });
    await window.getByRole("button", { name: "Open app menu" }).click();
    await window.getByRole("menuitem", { name: "Model" }).click();
    await window.getByRole("button", { name: "API key" }).click();

    await shows(
      window.getByText("Secure key storage is unavailable."),
      "the credential-storage failure",
    );
    await shows(
      window.getByText("Storage unavailable"),
      "the credential status",
    );
  });
});
