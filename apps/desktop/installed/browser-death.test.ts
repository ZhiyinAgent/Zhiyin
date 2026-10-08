/**
 * The installed app is destroyed, and its browser does not outlive it.
 *
 * The process-ownership feature's own tests show containment working against
 * fixtures. This one shows the shipped application uses it: the browser it
 * starts is inside the container it opened, and nothing in the real
 * composition starts one outside.
 *
 * No model and no provider key: the browser is opened through the window's own
 * bridge, which is the same path the panel uses when a person drives it.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { emptyConversationLists } from "@zhiyin/contract";
import type { SavedWorkspace } from "@zhiyin/session";
import {
  closeEverything,
  shows,
  launch,
  plantHistory,
  temporaryDataDirectory,
} from "./launch.js";

const run = promisify(execFile);

afterEach(closeEverything);

/** One conversation, selected, because the browser belongs to one. */
const oneConversation = JSON.stringify({
  preferences: { onboarded: true, interests: ["research"] },
  recentWorkspaces: [],
  selectedTaskId: "t1",
  tasks: [
    {
      ...emptyConversationLists,
      id: "t1",
      title: "Look something up",
      titleSource: "generated",
      updatedAt: "2026-09-14T09:00:00.000Z",
      updatedLabel: "Now",
      messages: [
        { id: "t1-m0", role: "user", text: "A question", sequence: 0 },
      ],
      phase: {
        kind: "completed",
        outcome: { title: "Done", summary: "Done." },
      },
    },
  ],
} satisfies SavedWorkspace);

type RunningProcess = {
  readonly pid: number;
  readonly parent: number;
  readonly name: string;
  readonly command: string;
};

async function processTable(): Promise<RunningProcess[]> {
  const { stdout } = await run(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress",
    ],
    { maxBuffer: 32 * 1024 * 1024 },
  );
  const rows: unknown = JSON.parse(stdout);
  return (Array.isArray(rows) ? rows : [rows]).map((row) => {
    const value = row as {
      ProcessId?: number;
      ParentProcessId?: number;
      Name?: string;
      CommandLine?: string | null;
    };
    return {
      pid: value.ProcessId ?? 0,
      parent: value.ParentProcessId ?? 0,
      name: value.Name ?? "",
      command: value.CommandLine ?? "",
    };
  });
}

/** Enough of a process to say which browser it belongs to, in a failure. */
function describeProcess(item: RunningProcess): string {
  return `${item.pid} (parent ${item.parent}) ${item.command.slice(0, 120)}`;
}

/** The browser tree carrying this application's profile marker. */
function browsersFor(
  table: readonly RunningProcess[],
  owner: number,
): RunningProcess[] {
  const marker = `zhiyin-browser-${owner}-`;
  const roots = table.filter(
    (item) =>
      /^(msedge|chrome)\.exe$/i.test(item.name) &&
      item.command.includes("--headless=new") &&
      item.command.includes("--remote-debugging-pipe") &&
      item.command.includes(marker),
  );
  const children = new Map<number, RunningProcess[]>();
  for (const item of table) {
    const siblings = children.get(item.parent) ?? [];
    siblings.push(item);
    children.set(item.parent, siblings);
  }
  const found = new Map<number, RunningProcess>();
  const walk = (pid: number, depth: number): void => {
    if (depth > 12) return;
    for (const child of children.get(pid) ?? []) {
      if (/^(msedge|chrome)\.exe$/i.test(child.name))
        found.set(child.pid, child);
      walk(child.pid, depth + 1);
    }
  };
  for (const root of roots) {
    found.set(root.pid, root);
    walk(root.pid, 0);
  }
  return [...found.values()];
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "EPERM"
    );
  }
}

async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs: number,
  // Built when it fails, not when the wait starts: a message composed up front
  // describes the state before anything was waited for, which is the one state
  // nobody needs to read about.
  whatFailed: string | (() => string),
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await condition()) return;
    if (Date.now() > deadline)
      throw new Error(
        typeof whatFailed === "function" ? whatFailed() : whatFailed,
      );
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

describe.runIf(process.platform === "win32")(
  "the installed app's browser",
  () => {
    /*
     * `ElectronApplication.process()` reports the command shell that launches
     * Electron on Windows, not the main process. Killing that wrapper proves
     * nothing about application death. The test asks the running main process
     * for its own pid and uses the pid carried in its isolated browser profile
     * to identify exactly the processes that belong to it.
     */
    it(
      "does not outlive the application being destroyed",
      { timeout: 120_000 },
      async () => {
        const dataDirectory = await temporaryDataDirectory();
        await plantHistory(dataDirectory, oneConversation);

        const launched = await launch({ dataDirectory });
        const electron = await launched.app.evaluate(() => process.pid);
        expect(typeof electron).toBe("number");

        // The app has to have finished opening its history before a
        // conversation can be driven — the same wait a person's first click
        // makes for them.
        await shows(
          launched.window.getByText("Look something up").first(),
          "the restored conversation",
        );

        // Opened the way the panel opens it, through the window's own bridge.
        // A turn would need a model and a key; this needs neither, and exercises
        // the same composition.
        await launched.window.evaluate(async () => {
          const bridge = (
            window as unknown as {
              zhiyin: { driveBrowser(intent: unknown): Promise<void> };
            }
          ).zhiyin;
          await bridge.driveBrowser({
            kind: "open",
            url: "data:text/html,<title>Contained</title>",
          });
        });

        let started: RunningProcess[] = [];
        await waitFor(
          async () => {
            started = browsersFor(await processTable(), electron);
            return started.length > 0;
          },
          30_000,
          `The installed app (pid ${String(electron)}) never started its marked browser process.`,
        );

        // Destroyed outright, and deliberately without /T: killing the tree
        // would take the browser down directly and prove nothing about whether
        // the app had contained it.
        await run("taskkill", ["/pid", String(electron), "/F"]).catch(
          () => undefined,
        );
        await waitFor(
          () => !alive(electron as number),
          30_000,
          "The application survived being destroyed.",
        );

        /*
         * Containment is kill-on-close: the job dies with the handle, so the
         * browser goes with the application rather than some minutes later.
         * Timed rather than merely waited for, because "never dies" and "dies
         * late" are two different defects and only a measurement separates
         * them.
         */
        const killedAt = Date.now();
        let died: number | undefined;
        await waitFor(
          async () => {
            if (browsersFor(await processTable(), electron).length === 0) {
              died ??= Date.now() - killedAt;
              return true;
            }
            return false;
          },
          20_000,
          () =>
            [
              `The browser outlived the application (pid ${String(electron)}) by more than 20s:`,
              ...started
                .filter((item) => alive(item.pid))
                .map((item) => `  ${describeProcess(item)}`),
            ].join("\n"),
        );

        // Promptly, not eventually. The number is in the failure so that a
        // regression says how much slower it got, not merely that it is slow.
        expect({
          diedWithinMs: died ?? -1,
          promptly: (died ?? -1) <= 15_000,
        }).toMatchObject({ promptly: true });
      },
    );
  },
);
