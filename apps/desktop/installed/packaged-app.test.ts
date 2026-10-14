/**
 * The packaged executable, started as a person starts it.
 *
 * The rest of this suite runs the built app, or its archive, under the
 * development Electron. Only the packaged executable carries the fuses: it
 * loads the app from its archive alone and checks the archive against the
 * hash built into it, so a packaging mistake can leave an app that never
 * opens. It refuses every way a program could drive it, Playwright's included,
 * so its window is read from outside instead, through UI Automation, as a
 * screen reader reads it.
 *
 * Runs when `ZHIYIN_PACKAGED_APP` names the executable, as the full gate does
 * after packaging.
 */

import {
  execFile,
  spawn,
  spawnSync,
  type ChildProcess,
  type StdioOptions,
} from "node:child_process";
import { once } from "node:events";
import { readdir, readFile } from "node:fs/promises";
import { connect, createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { emptyConversationLists, type WorkspaceTask } from "@zhiyin/contract";
import type { SavedWorkspace } from "@zhiyin/session";
import {
  closeEverything,
  plantHistory,
  temporaryDataDirectory,
} from "./launch.js";

const executable = process.env["ZHIYIN_PACKAGED_APP"];
const here = dirname(fileURLToPath(import.meta.url));
const systemRoot = process.env["SystemRoot"] ?? "C:\\Windows";

let started: ChildProcess | undefined;

afterEach(async () => {
  if (started?.pid && started.exitCode === null) {
    // Its data folder is removed next, which Windows refuses while it is open.
    const ended = once(started, "exit");
    spawnSync(join(systemRoot, "System32", "taskkill.exe"), [
      "/T",
      "/F",
      "/PID",
      String(started.pid),
    ]);
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

/** Whether anything answers on a local port. */
function answers(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(port, "127.0.0.1");
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

/** The packaged app, started with these switches and none of a test's keys. */
function start(
  dataDirectory: string,
  switches: readonly string[],
  stdio: StdioOptions = "ignore",
): ChildProcess {
  return spawn(executable!, [`--user-data-dir=${dataDirectory}`, ...switches], {
    env: Object.fromEntries(
      Object.entries({ ...process.env, ZHIYIN_WORKSPACE: "" }).filter(
        ([name]) => !name.endsWith("_API_KEY"),
      ),
    ),
    stdio,
  });
}

/** Waits until the process's window shows the text, read from outside it. */
function windowShows(pid: number, text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      join(
        systemRoot,
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      ),
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        join(here, "window-text.ps1"),
        "-ProcessId",
        String(pid),
        "-Text",
        text,
        "-Seconds",
        "60",
      ],
      (error, stdout) =>
        error
          ? reject(
              new Error(`The packaged app never showed ${text}: ${stdout}`),
            )
          : resolve(),
    );
  });
}

/** What the app's diagnostic log says, all days together. */
async function logged(dataDirectory: string): Promise<string> {
  const folder = join(dataDirectory, "logs");
  const days = await readdir(folder).catch(() => []);
  const lines = await Promise.all(
    days.map((day) => readFile(join(folder, day), "utf8")),
  );
  return lines.join("");
}

/** The exit code of a process that should end of its own accord. */
async function exitCodeOf(child: ChildProcess): Promise<number | null> {
  const [code] = (await Promise.race([
    once(child, "exit"),
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error("The packaged app went on running.")),
        30_000,
      ),
    ),
  ])) as [number | null];
  return code;
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
    started = start(dataDirectory, []);
    await windowShows(started.pid!, "Yesterday's work");
  }, 90_000);

  it("will not start with a debugging port, and says why in its log", async () => {
    const dataDirectory = await temporaryDataDirectory();
    const port = await freePort();
    const child = start(dataDirectory, [`--remote-debugging-port=${port}`]);
    started = child;
    // Asked again and again for as long as the app runs, and once after.
    let answered = false;
    const watching = (async () => {
      do {
        if (await answers(port)) answered = true;
        await new Promise((resolve) => setTimeout(resolve, 100));
      } while (child.exitCode === null);
    })();

    expect(await exitCodeOf(child)).not.toBe(0);
    await watching;
    expect(answered).toBe(false);
    expect(await logged(dataDirectory)).toContain("--remote-debugging-port");
  }, 60_000);

  it("will not start with a debugging pipe, and says why in its log", async () => {
    const dataDirectory = await temporaryDataDirectory();
    // The pipe's two ends are the third and fourth handles, as Chromium wants.
    started = start(
      dataDirectory,
      ["--remote-debugging-pipe"],
      ["ignore", "ignore", "ignore", "pipe", "pipe"],
    );

    expect(await exitCodeOf(started)).not.toBe(0);
    expect(await logged(dataDirectory)).toContain("--remote-debugging-pipe");
  }, 60_000);
});
