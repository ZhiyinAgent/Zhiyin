/**
 * Notifications as the app sends them: from the conversations as they change,
 * through whatever notifier the application supplies, and only as long as the
 * person has not turned them off.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CHANNEL, type ToolCallInspection } from "@zhiyin/contract";
import type { ModelRequest } from "@zhiyin/model-client";
import { FileSessions } from "@zhiyin/session";
import { Core } from "../../src/index.js";
import type { Notice } from "../../src/attention.js";
import {
  currentApprovalId,
  loopFrom,
  stubDependencies,
  until,
} from "./support.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

/** An app whose model asks to write one file, which the person must approve. */
async function asking(root: string) {
  const shown: { notice: Notice; open: () => void }[] = [];
  let created = 0;
  let request = 0;
  const deps = stubDependencies(() => {});
  const app = loopFrom({
    ...deps,
    newTaskId: () => `task-${++created}`,
    sessions: new FileSessions(root),
    notifier: {
      focused: () => false,
      notify: (notice, open) => shown.push({ notice, open }),
    },
    permissions: {
      decide: async () => ({
        outcome: "ask" as const,
        reason: "Changes a file.",
      }),
    },
    tools: {
      list: () => [
        {
          name: "write_file",
          description: "Write a file.",
          inputSchema: { type: "object" },
        },
      ],
      inspect: async (): Promise<ToolCallInspection> => ({
        ok: true,
        action: "Write the report",
        target: "report.md",
        command: "write_file({})",
        access: "change",
        scope: "workspace",
        changes: [{ path: "report.md", change: "created", after: "r" }],
      }),
      execute: async () => ({ ok: true, value: {} }),
    },
    model: {
      ...deps.model,
      send: async function* (sent: ModelRequest) {
        void sent;
        request += 1;
        if (request % 2 === 1)
          yield {
            kind: "toolCallDelta" as const,
            index: 0,
            callId: `call-${request}`,
            name: "write_file",
            argumentsDelta: "{}",
          };
        else yield { kind: "textDelta" as const, text: "Written." };
        yield { kind: "done" as const };
      },
    },
  });
  await app.initialize();
  return { app, shown };
}

describe("notifications", () => {
  it("tell the person a turn needs their approval, and open that conversation when clicked", async () => {
    const root = await mkdtemp(join(tmpdir(), "zhiyin-notify-"));
    roots.push(root);
    const { app, shown } = await asking(root);
    const first = await app.createTask();
    const second = await app.createTask();
    expect(app.snapshot().selectedTaskId).toBe(second);

    const running = app.start(first, "Write the report");
    await until(() => shown.length > 0);
    shown[0]!.open();

    expect(shown.map(({ notice }) => notice)).toEqual([
      {
        taskId: first,
        title: expect.any(String),
        body: "Needs your approval to change 1 file",
      },
    ]);
    await until(() => app.snapshot().selectedTaskId === first);
    await app.resolveApproval(first, currentApprovalId(app, first), "deny");
    await running;
  });

  it("stay off once the person turns them off, across a restart", async () => {
    const root = await mkdtemp(join(tmpdir(), "zhiyin-notify-"));
    roots.push(root);
    const before = await asking(root);
    await before.app.choices.setNotifications(false);
    await before.app.shutdown();

    const { app, shown } = await asking(root);
    expect(app.snapshot().notifications).toBe("off");
    const taskId = await app.createTask();
    const running = app.start(taskId, "Write the report");
    await until(() => app.snapshot().tasks.at(-1)?.phase.kind === "approval");
    await app.resolveApproval(taskId, currentApprovalId(app, taskId), "deny");
    await running;

    expect(shown).toEqual([]);
  });

  it("are turned on or off from the window with a yes or no, and nothing else", async () => {
    const app = loopFrom(stubDependencies(() => {}));
    await app.initialize();
    const core = new Core({
      workspace: app,
      ownership: { claim: async () => {}, release: async () => {} },
      viewChecks: { answer: () => {}, abandon: () => {} },
      commands: {
        runningCommands: () => [],
        commandOutput: async () => undefined,
        stopCommandForPerson: async () => {},
        onCommandsChanged: () => {},
      },
      chooseFolder: async () => undefined,
      chooseSaveLocation: async () => undefined,
      openExternal: async () => {},
      openPath: async () => {},
      showInFolder: async () => {},
      version: "1.0.0",
    });

    await core.receive(CHANNEL.setNotifications, [false]);
    expect(app.snapshot().notifications).toBe("off");
    await core.receive(CHANNEL.setNotifications, [true]);
    expect(app.snapshot().notifications).toBeUndefined();
    await expect(
      core.receive(CHANNEL.setNotifications, ["off"]),
    ).rejects.toThrow();
  });
});
