/**
 * The packaged executable, started as a person starts it.
 *
 * The rest of this suite runs the built app, or its archive, under the
 * development Electron. Only the packaged executable carries the fuses: it
 * loads the app from its archive alone and checks the archive against the
 * hash built into it, so a packaging mistake can leave an app that never
 * opens. It refuses the inspector Playwright usually drives Electron through,
 * so the window is reached over Chromium's own debugging port instead.
 *
 * Runs when `ZHIYIN_PACKAGED_APP` names the executable, as the full gate does
 * after packaging.
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { chromium, type Browser } from "playwright-core";
import { emptyConversationLists, type WorkspaceTask } from "@zhiyin/contract";
import type { SavedWorkspace } from "@zhiyin/session";
import {
  closeEverything,
  plantHistory,
  shows,
  temporaryDataDirectory,
} from "./launch.js";

const executable = process.env["ZHIYIN_PACKAGED_APP"];

let started: ChildProcess | undefined;
let attached: Browser | undefined;

afterEach(async () => {
  await attached?.close().catch(() => undefined);
  attached = undefined;
  if (started?.pid && started.exitCode === null) {
    // Its data folder is removed next, which Windows refuses while it is open.
    const ended = once(started, "exit");
    spawnSync(
      join(
        process.env["SystemRoot"] ?? "C:\\Windows",
        "System32",
        "taskkill.exe",
      ),
      ["/T", "/F", "/PID", String(started.pid)],
    );
    await ended;
  }
  started = undefined;
  await closeEverything();
});

/** A port nothing is listening on now. */
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  if (!address || typeof address === "string") throw new Error("No port.");
  return address.port;
}

/** The app's debugging port, once it answers, within a deadline. */
async function attach(port: number): Promise<Browser> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    } catch (error) {
      if (Date.now() > deadline)
        throw new Error("The packaged app never opened its window.", {
          cause: error,
        });
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

const saved: WorkspaceTask = {
  ...emptyConversationLists,
  id: "packaged-task",
  title: "Yesterday's work",
  titleSource: "generated",
  updatedAt: "2026-09-13T09:00:00.000Z",
  updatedLabel: "Today",
  messages: [{ id: "u1", role: "user", text: "Hello", sequence: 0 }],
  phase: { kind: "completed", outcome: { title: "Done", summary: "Done." } },
};

describe.runIf(executable)("the packaged app", () => {
  it("opens and shows the conversations it saved", async () => {
    const dataDirectory = await temporaryDataDirectory();
    await plantHistory(
      dataDirectory,
      JSON.stringify({
        preferences: { onboarded: true, interests: [] },
        recentWorkspaces: [],
        selectedTaskId: saved.id,
        tasks: [saved],
      } satisfies SavedWorkspace),
    );
    const port = await freePort();
    started = spawn(
      executable!,
      [`--user-data-dir=${dataDirectory}`, `--remote-debugging-port=${port}`],
      {
        env: Object.fromEntries(
          Object.entries({ ...process.env, ZHIYIN_WORKSPACE: "" }).filter(
            ([name]) => !name.endsWith("_API_KEY"),
          ),
        ),
        stdio: "ignore",
      },
    );

    attached = await attach(port);
    const window = attached.contexts()[0]?.pages()[0];
    if (!window) throw new Error("The packaged app has no window.");
    await shows(window.getByText("Yesterday's work"), "the saved conversation");
  }, 90_000);
});
