/**
 * Two ways the app can get stuck that only a real launch can show: a window
 * left blank after its page died, and a quit that never finishes because
 * something will not close, leaving the data folder held so the next launch
 * is told another copy is running.
 */

import { readdir, readFile } from "node:fs/promises";
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

afterEach(async () => {
  await closeEverything();
});

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

async function logged(dataDirectory: string) {
  const folder = join(dataDirectory, "logs");
  const entries: Record<string, unknown>[] = [];
  for (const name of await readdir(folder).catch(() => []))
    for (const line of (await readFile(join(folder, name), "utf8"))
      .split("\n")
      .filter(Boolean))
      entries.push(JSON.parse(line) as Record<string, unknown>);
  return entries;
}

describe("the installed app when something fails", () => {
  it("brings its window back after the page's process is killed, with the work intact", async () => {
    const dataDirectory = await temporaryDataDirectory();
    await plantHistory(dataDirectory, history);
    const { app, window } = await launch({ dataDirectory });
    await shows(window.getByText("Yesterday's work"), "the saved conversation");

    // As Task Manager would: the page's own process, ended from outside.
    const pagePid = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.webContents.getOSProcessId(),
    );
    process.kill(pagePid);

    // Playwright keeps treating a page whose process crashed as gone, even
    // once the window has loaded it again, so the reloaded window is read
    // through the main process instead.
    // A page asked before it has been loaded again never answers, and for a
    // moment after the kill the window does not yet know its page is gone.
    const shown = async () =>
      app.evaluate(({ BrowserWindow }) => {
        const page = BrowserWindow.getAllWindows()[0]!.webContents;
        if (!page.getURL().includes("restarted") || page.isLoading()) return "";
        return Promise.race([
          page.executeJavaScript("document.body.innerText") as Promise<string>,
          new Promise<string>((resolve) =>
            setTimeout(() => resolve(""), 2_000),
          ),
        ]);
      });
    await expect
      .poll(shown, { timeout: 30_000 })
      .toContain("The window restarted after a problem.");
    expect(await shown()).toContain("Your work is intact.");
    expect(await shown()).toContain("Yesterday's work");
    expect(
      (await logged(dataDirectory)).filter(
        (entry) => entry["source"] === "window",
      ),
    ).toHaveLength(1);
  });

  it(
    "gives up on a connection that never finishes closing at its deadline, quits, and the next launch starts",
    { timeout: 90_000 },
    async () => {
      const dataDirectory = await temporaryDataDirectory();
      await plantHistory(dataDirectory, history);
      const { app, window } = await launch({
        dataDirectory,
        connectionsNeverClose: true,
      });
      await shows(window.getByText("Yesterday's work"), "the first launch");
      const exited = new Promise((resolve) =>
        app.process().once("exit", resolve),
      );
      const started = Date.now();

      await app.evaluate(({ app }) => app.quit()).catch(() => undefined);
      await exited;
      const exitedAfter = Date.now() - started;

      const gaveUp = (await logged(dataDirectory)).find(
        (entry) =>
          entry["source"] === "shutdown" &&
          String(entry["message"]).includes("browsers and connections"),
      );
      expect(gaveUp).toBeDefined();
      // The five-second deadline is timed by the app's own log, written when
      // it gives up. The exit after it is Electron closing its windows and
      // helpers, which can take a few seconds on a shared runner.
      expect(Date.parse(String(gaveUp?.["time"])) - started).toBeLessThan(
        7_000,
      );
      expect(exitedAfter).toBeLessThan(20_000);
      const next = await launch({ dataDirectory });
      await shows(
        next.window.getByText("Yesterday's work"),
        "the saved conversation in the next launch",
      );
    },
  );
});
