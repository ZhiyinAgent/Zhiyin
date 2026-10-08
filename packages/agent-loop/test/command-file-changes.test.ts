/**
 * A command's file changes are only known once it has run, so they arrive
 * with its answer, or later, when the job it carried on as ends. Either way
 * they are kept on the action that ran it, and never among the changes a
 * backup was taken for.
 */

import { describe, expect, it } from "vitest";
import {
  emptyConversationLists,
  type CommandFileChanges,
  type ToolCallInspection,
  type ToolInvocationResult,
  type WorkspaceTask,
} from "@zhiyin/contract";
import type { ModelRequest } from "@zhiyin/model-client";
import { AgentLoop, type AgentLoopDependencies } from "../src/index.js";
import { loopAndHost, stubDependencies, until } from "./support.js";

type JobChanges = (
  conversationId: string,
  job: string,
  changes: CommandFileChanges,
) => void;

function callsBashOnce() {
  let turn = 0;
  return async function* (request: ModelRequest) {
    void request;
    turn += 1;
    if (turn === 1)
      yield {
        kind: "toolCallDelta" as const,
        index: 0,
        callId: "call-1",
        name: "bash",
        argumentsDelta: "{}",
      };
    else yield { kind: "textDelta" as const, text: "Done." };
    yield { kind: "done" as const };
  };
}

function running(result: ToolInvocationResult) {
  let announce: JobChanges | undefined;
  const deps = stubDependencies(() => {});
  const { host } = loopAndHost({
    ...deps,
    tools: {
      list: () => [
        {
          name: "bash",
          description: "Run one bash command.",
          inputSchema: { type: "object" },
        },
      ],
      inspect: async (): Promise<ToolCallInspection> => ({
        ok: true,
        action: "Run a command",
        target: "python convert.py",
        command: 'bash({"command":"python convert.py"})',
        access: "change",
      }),
      execute: async () => result,
      onJobChanges: (watcher) => {
        announce = watcher;
      },
    },
    permissions: {
      decide: async () => ({ outcome: "allow" as const, reason: "Approved" }),
    },
    model: { ...deps.model, send: callsBashOnce() },
  });
  return {
    loop: host.app,
    host,
    announce: (...args: Parameters<JobChanges>) => announce?.(...args),
  };
}

const converted: CommandFileChanges = {
  status: "checked",
  files: [{ path: "out.csv", change: "created" }],
};

const rendered: CommandFileChanges = {
  status: "checked",
  files: [
    { path: "charts/q3.png", change: "created" },
    { path: "report.pdf", change: "updated" },
    { path: "old.pdf", change: "deleted" },
  ],
};

describe("what changed while a command ran", () => {
  it("is kept on the command's action, apart from the changes a copy was taken for", async () => {
    const { loop } = running({
      ok: true,
      value: { exitCode: 0 },
      commandChanges: converted,
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Convert the data");

    const action = loop.snapshot().tasks[0]?.actions?.[0];
    expect(action?.commandChanges).toEqual(converted);
    expect(action?.changes).toBeUndefined();
    expect(action?.recovery).toBeUndefined();
  });

  it("is kept for a command that failed after changing files", async () => {
    const { loop } = running({
      ok: false,
      reported: true,
      reason: "The command exited with code 2.",
      commandChanges: converted,
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Convert the data");

    expect(loop.snapshot().tasks[0]?.actions?.[0]).toMatchObject({
      status: "reported",
      commandChanges: converted,
    });
  });

  it("arrives on the action that started a job when the job ends, and only on that one", async () => {
    const { loop, announce } = running({
      ok: true,
      value: { job: "J1", status: "running" },
      commandChanges: { status: "running", job: "J1" },
    });
    const taskId = await loop.createTask();
    await loop.start(taskId, "Convert the data");
    expect(loop.snapshot().tasks[0]?.actions?.[0]?.commandChanges).toEqual({
      status: "running",
      job: "J1",
    });

    const ended: CommandFileChanges = { ...converted, job: "J1" };
    announce("other-conversation", "J1", ended);
    announce(taskId, "J2", ended);
    announce(taskId, "J1", ended);

    await until(
      () =>
        loop.snapshot().tasks[0]?.actions?.[0]?.commandChanges?.status ===
        "checked",
    );
    expect(loop.snapshot().tasks[0]?.actions?.[0]?.commandChanges).toEqual(
      ended,
    );
  });

  it("tells the app around the turn which files it created or changed, so a document among them is shown", async () => {
    const { loop, host } = running({
      ok: true,
      value: { exitCode: 0 },
      commandChanges: rendered,
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Draw the chart");

    expect(host.writtenFiles).toEqual([
      { taskId, paths: ["charts/q3.png", "report.pdf"] },
    ]);
  });

  it("tells the app around the turn which files an action produced", async () => {
    const { loop, host } = running({
      ok: true,
      value: {},
      produced: [{ path: "brief.pdf", change: "created", bytes: 3 }],
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Write the brief");

    expect(host.writtenFiles).toEqual([{ taskId, paths: ["brief.pdf"] }]);
  });

  it("tells the app around the turn what a job wrote when it ends", async () => {
    const { loop, host, announce } = running({
      ok: true,
      value: { job: "J1", status: "running" },
      commandChanges: { status: "running", job: "J1" },
    });
    const taskId = await loop.createTask();
    await loop.start(taskId, "Draw the chart");
    expect(host.writtenFiles).toEqual([]);

    announce(taskId, "J1", { ...rendered, job: "J1" });

    await until(() => host.writtenFiles.length > 0);
    expect(host.writtenFiles).toEqual([
      { taskId, paths: ["charts/q3.png", "report.pdf"] },
    ]);
  });

  it("is said to be unchecked for a job Zhiyin closed on", () => {
    const settled = new AgentLoop(
      {} as AgentLoopDependencies,
    ).settleAfterRestart({
      id: "task-1",
      title: "A conversation",
      updatedLabel: "Now",
      titleSource: "generated",
      updatedAt: "2026-10-05T09:00:00.000Z",
      ...emptyConversationLists,
      messages: [],
      actions: [
        {
          id: "bash-1",
          action: "Run a command",
          target: "python convert.py",
          status: "completed",
          commandChanges: { status: "running", job: "J1" },
        },
      ],
      phase: { kind: "completed", outcome: { title: "Done", summary: "" } },
    } satisfies WorkspaceTask);

    expect(settled.actions?.[0]?.commandChanges).toEqual({
      status: "unchecked",
      reason:
        "Zhiyin closed before this command finished, so what it changed was not checked.",
    });
  });
});
