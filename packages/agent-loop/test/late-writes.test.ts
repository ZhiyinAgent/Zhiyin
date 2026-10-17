/**
 * What a stopped turn may still write.
 *
 * Stop ends a turn while parts of it are still waiting: on the permission
 * engine, on a tool, on the model. When one of them answers after the stop,
 * the turn must not put the conversation back to working, to a question, or
 * to an action running: the person was told it stopped.
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ModelEvent } from "@zhiyin/model-client";
import {
  GuardedPermissionEngine,
  type Decision,
} from "@zhiyin/permission-engine";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import { WorkspaceTools } from "@zhiyin/tools";
import { loopAndHost, loopFrom, stubDependencies, until } from "./support.js";

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

function readingTurn(decision: Decision) {
  let decide = () => {};
  const decided = new Promise<void>((resolve) => (decide = resolve));
  let asked = false;
  let executed = false;
  const deps = stubDependencies(() => {}, [
    {
      kind: "toolCallDelta",
      index: 0,
      callId: "call-1",
      name: "run",
      argumentsDelta: "{}",
    },
    { kind: "done", finishReason: "tool_calls" },
  ] satisfies ModelEvent[]);
  const loop = loopFrom({
    ...deps,
    tools: {
      list: () => [
        { name: "run", description: "Run.", inputSchema: { type: "object" } },
      ],
      inspect: async () => ({
        ok: true,
        action: "Run",
        target: "build",
        command: "run({})",
        access: "change",
        scope: "workspace",
      }),
      execute: async () => {
        executed = true;
        return { ok: true, value: "ran" };
      },
    },
    permissions: {
      decide: async () => {
        asked = true;
        await decided;
        return decision;
      },
    },
  });
  return {
    loop,
    decide,
    asked: () => asked,
    executed: () => executed,
  };
}

describe("a turn stopped while the permission engine decides", () => {
  it.each([
    { outcome: "ask", reason: "Changes are asked for." },
    { outcome: "allow", reason: "Allowed for this conversation." },
  ] satisfies Decision[])(
    "stays stopped when the decision ($outcome) arrives after the stop",
    async (decision) => {
      const turn = readingTurn(decision);
      const taskId = await turn.loop.createTask();
      const running = turn.loop.start(taskId, "Build it");
      await until(turn.asked);

      await turn.loop.cancel(taskId);
      turn.decide();
      await running;
      await new Promise((resolve) => setTimeout(resolve, 10));

      const task = turn.loop.snapshot().tasks[0];
      expect(task?.phase.kind).toBe("interrupted");
      expect(task?.actions.some((action) => action.status === "running")).toBe(
        false,
      );
      expect(turn.executed()).toBe(false);
    },
  );
});

describe("a turn stopped while a connector is still connecting", () => {
  it("stays stopped when the connector answers after the stop", async () => {
    let connect = () => {};
    const connected = new Promise<void>((resolve) => (connect = resolve));
    let connecting = false;
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      mcp: {
        ...deps.mcp,
        availableTools: async (_scope, _withheld, onConnecting) => {
          onConnecting?.("Mail");
          connecting = true;
          await connected;
          return [];
        },
      },
    });
    const taskId = await loop.createTask();
    const running = loop.start(taskId, "Read my mail").catch(() => undefined);
    await until(() => connecting);

    await loop.cancel(taskId);
    connect();
    await running;
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(loop.snapshot().tasks[0]?.phase.kind).toBe("interrupted");
  });
});

describe("a turn stopped before its folder's instructions were decided", () => {
  it("asks nothing about them once the connector answers after the stop", async () => {
    let connect = () => {};
    const connected = new Promise<void>((resolve) => (connect = resolve));
    let connecting = false;
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      workspace: {
        ...deps.workspace,
        workspaceRoot: () => "/work/reports",
        folderInstructions: async () => ({
          path: "AGENTS.md",
          text: "Invoices live in /finance.",
          bytes: 26,
          truncated: false,
          hash: "never-seen",
        }),
      },
      mcp: {
        ...deps.mcp,
        availableTools: async (_scope, _withheld, onConnecting) => {
          onConnecting?.("Mail");
          connecting = true;
          await connected;
          return [];
        },
      },
    });
    const taskId = await loop.createTask();
    const running = loop.start(taskId, "Read my mail").catch(() => undefined);
    await until(() => connecting);

    await loop.cancel(taskId);
    connect();
    await running;
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(loop.snapshot().tasks[0]?.phase.kind).toBe("interrupted");
  });
});

describe("a turn stopped while a conversation permission is being saved", () => {
  it("records no action as running, and runs none", async () => {
    const root = await folders.make("zhiyin-late-write-");
    await mkdir(join(root, "reports"));
    const workspace = new WorkspaceTools(root, { shell: undefined });
    const deps = stubDependencies(() => {});
    const { host } = loopAndHost({
      ...deps,
      permissions: new GuardedPermissionEngine(),
      tools: workspace,
      workspace,
      model: {
        ...deps.model,
        send: async function* () {
          yield {
            kind: "toolCallDelta" as const,
            index: 0,
            callId: "write-1",
            name: "write_file",
            argumentsDelta: JSON.stringify({
              path: "reports/first.md",
              content: "Report",
            }),
          };
          yield { kind: "done" as const };
        },
      },
    });
    const loop = host.app;
    let saveGrant = () => {};
    const grantSaved = new Promise<void>((resolve) => (saveGrant = resolve));
    let savingGrant = false;
    const store = host.store.bind(host);
    host.store = async (task, options) => {
      if (task.conversationPermissions.length && !savingGrant) {
        savingGrant = true;
        await grantSaved;
      }
      await store(task, options);
    };
    const taskId = await loop.createTask();
    const running = loop
      .start(taskId, "Write the report")
      .catch(() => undefined);
    await until(() => loop.snapshot().tasks[0]?.phase.kind === "approval");
    const phase = loop.snapshot().tasks[0]?.phase;
    if (phase?.kind !== "approval") throw new Error("No approval.");

    void loop.resolveApproval(taskId, phase.prompt.id, "allow-conversation");
    await until(() => savingGrant);
    await loop.cancel(taskId);
    saveGrant();
    await running;
    await new Promise((resolve) => setTimeout(resolve, 10));

    const task = loop.snapshot().tasks[0];
    expect(task?.phase.kind).toBe("interrupted");
    expect(task?.actions.some((action) => action.status === "running")).toBe(
      false,
    );
    await expect(readFile(join(root, "reports", "first.md"))).rejects.toThrow();
  });
});
