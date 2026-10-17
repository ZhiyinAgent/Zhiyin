/**
 * Where Stop takes effect inside a round of calls: the person presses it while
 * one call of the round is being answered, or at the work-budget checkpoint
 * before the round, and nothing after that point runs: no tool, and no
 * specialist handed work.
 */

import { describe, expect, it } from "vitest";
import type { WorkspaceTask } from "@zhiyin/contract";
import type { ModelEvent } from "@zhiyin/model-client";
import {
  loopFrom,
  pluginOffering,
  pluginsOffering,
  stubDependencies,
  until,
  type TurnTestApp,
} from "./support.js";

function call(
  index: number,
  callId: string,
  name: string,
  args: object = {},
): ModelEvent {
  return {
    kind: "toolCallDelta",
    index,
    callId,
    name,
    argumentsDelta: JSON.stringify(args),
  };
}

const delegate = (index: number, callId: string, task: string) =>
  call(index, callId, "delegate_specialist", {
    id: "engineering/checker",
    task,
  });

/**
 * A conversation with two read-only tools and the Checker specialist, whose
 * model answers every request with `round`. `onFirst` runs while the tool
 * `first` is being answered, and `onSave` while the conversation is saved;
 * each is handed the person's Stop. `requests` counts what the
 * conversation's own model was asked; `asked` collects the tasks the Checker
 * was given.
 */
function setup(options: {
  readonly round: readonly ModelEvent[];
  readonly onFirst?: (
    signal: AbortSignal | undefined,
    stop: () => void,
  ) => Promise<void>;
  readonly onSave?: (task: WorkspaceTask, stop: () => void) => void;
  readonly onRound?: () => void;
  readonly now?: () => Date;
  readonly workLimits?: Parameters<typeof loopFrom>[0]["workLimits"];
}) {
  const ran: string[] = [];
  const asked: string[] = [];
  const requests = { count: 0 };
  const deps = stubDependencies(() => {});
  const stop = () => {
    const taskId = loop.snapshot().tasks[0]?.id;
    if (taskId) void loop.cancel(taskId);
  };
  const loop: TurnTestApp = loopFrom({
    ...deps,
    ...(options.now ? { now: options.now } : {}),
    ...(options.workLimits ? { workLimits: options.workLimits } : {}),
    // Not a refusal: what is being saved, seen once the write shows and
    // before the turn hears it is saved, as while the disk writes it.
    refusesSave: (task) => {
      queueMicrotask(() => options.onSave?.(task, stop));
      return false;
    },
    plugins: pluginsOffering([
      pluginOffering({
        name: "engineering",
        specialists: [
          {
            id: "checker",
            name: "Checker",
            description: "Runs the checks.",
            instructions: "Run the checks you are asked for and report.",
          },
        ],
      }),
    ]),
    tools: {
      list: () => [
        {
          name: "first",
          description: "The first step.",
          inputSchema: { type: "object" },
        },
        {
          name: "second",
          description: "The second step.",
          inputSchema: { type: "object" },
        },
      ],
      inspect: async (name) => ({
        ok: true as const,
        action: `Do the ${name} step`,
        target: name,
        command: `${name}({})`,
        access: "read" as const,
        scope: "workspace" as const,
      }),
      execute: async (name, _args, signal) => {
        ran.push(name);
        if (name === "first") await options.onFirst?.(signal, stop);
        return { ok: true as const, value: `${name} done` };
      },
    },
    permissions: {
      decide: async () => ({ outcome: "allow" as const, reason: "Read" }),
    },
    model: {
      ...deps.model,
      send: async function* (request) {
        const text = JSON.stringify(request.messages);
        if (text.includes("You are the Checker specialist")) {
          for (const task of ["Check the site.", "Check the docs."])
            if (text.includes(task)) asked.push(task);
          yield call(0, "finish-1", "finish_specialist", {
            summary: "Checked.",
            findings: [],
            recommendations: [],
            limitations: [],
          });
          yield { kind: "done" as const };
          return;
        }
        requests.count += 1;
        if (requests.count > 1) {
          // Asked again after the stop: answered, so the test can say so.
          yield { kind: "textDelta" as const, text: "Picked up again." };
          yield { kind: "done" as const };
          return;
        }
        options.onRound?.();
        yield* options.round;
        yield { kind: "done" as const, finishReason: "tool_calls" };
      },
    },
    newSpecialistRunId: () =>
      `specialist-${loop.snapshot().tasks[0]?.specialistRuns.length ?? 0}`,
  });
  return { loop, ran, asked, requests };
}

/** Nothing runs in the conversation, and none of it shows as running. */
const settled = (loop: TurnTestApp, taskId: string) =>
  !loop.running(taskId) &&
  !["working", "input"].includes(loop.snapshot().tasks[0]?.phase.kind ?? "");

describe("a turn stopped inside a round", () => {
  it("runs none of the round's later tools once the person stops during an earlier one", async () => {
    const { loop, ran, requests } = setup({
      round: [call(0, "call-1", "first"), call(1, "call-2", "second")],
      onFirst: async (signal, stop) => {
        stop();
        await until(() => signal?.aborted === true);
      },
    });
    const taskId = await loop.createTask(["engineering"]);

    await loop.start(taskId, "Do both steps");
    await until(() => settled(loop, taskId));

    expect(ran).toEqual(["first"]);
    expect(requests.count).toBe(1);
  });

  it("hands no specialist the round's later work once the person stops during an earlier call", async () => {
    const { loop, asked, requests } = setup({
      round: [
        call(0, "call-1", "first"),
        delegate(1, "delegate-1", "Check the site."),
      ],
      onFirst: async (signal, stop) => {
        stop();
        await until(() => signal?.aborted === true);
      },
    });
    const taskId = await loop.createTask(["engineering"]);

    await loop.start(taskId, "Do the step, then have the site checked");
    await until(() => settled(loop, taskId));

    expect(asked).toEqual([]);
    expect(loop.snapshot().tasks[0]?.specialistRuns).toEqual([]);
    expect(requests.count).toBe(1);
  });

  it("hands no specialist the round's later work once the person stops while an earlier one's answer is saved", async () => {
    let stopped = false;
    const { loop, asked, requests } = setup({
      round: [
        delegate(0, "delegate-1", "Check the site."),
        delegate(1, "delegate-2", "Check the docs."),
      ],
      onSave: (task, stop) => {
        // Once: a later save of the same history is not the person again.
        if (stopped) return;
        stopped = task.modelHistory.some(
          (entry) => entry.kind === "result" && entry.callId === "delegate-1",
        );
        if (stopped) stop();
      },
    });
    const taskId = await loop.createTask(["engineering"]);

    await loop.start(taskId, "Have the site and the docs checked");
    await until(() => settled(loop, taskId));

    expect(asked).not.toContain("Check the docs.");
    expect(requests.count).toBe(1);
  });

  it("answers none of the round's calls once the person stops at the work-budget checkpoint", async () => {
    let now = new Date("2026-09-13T10:00:00.000Z");
    const { loop, ran, asked, requests } = setup({
      round: [
        delegate(0, "delegate-1", "Check the site."),
        call(1, "call-1", "first"),
      ],
      now: () => now,
      onRound: () => {
        now = new Date("2026-09-13T10:00:02.000Z");
      },
      workLimits: { maximumElapsedMs: 1_000, maximumProviderCostUsd: 10 },
    });
    const taskId = await loop.createTask(["engineering"]);

    const running = loop.start(
      taskId,
      "Do the step, then have the site checked",
    );
    await until(() => loop.snapshot().tasks[0]?.phase.kind === "input");
    await loop.cancel(taskId);
    await running;
    await until(() => settled(loop, taskId));

    expect(ran).toEqual([]);
    expect(asked).toEqual([]);
    expect(loop.snapshot().tasks[0]?.specialistRuns).toEqual([]);
    expect(requests.count).toBe(1);
  });
});
