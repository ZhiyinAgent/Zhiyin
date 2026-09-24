import { describe, expect, it, vi } from "vitest";
import type { ToolCallInspection } from "@zhiyin/contract";
import type { ModelRequest } from "@zhiyin/model-client";
import type { TestApp as AgentLoop } from "./support.js";
import { stubDependencies, loopFrom } from "./support.js";

async function until(predicate: () => boolean, attempts = 500): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Condition was not reached.");
}

function workTool(execute: ReturnType<typeof vi.fn>) {
  return {
    list: () => [
      {
        name: "inspect_progress",
        description: "Inspect the next piece of work.",
        inputSchema: { type: "object" },
      },
    ],
    inspect: async (): Promise<ToolCallInspection> => ({
      ok: true,
      action: "Inspect progress",
      target: "workspace",
      command: "inspect_progress({})",
      access: "read",
      scope: "workspace",
    }),
    execute,
  };
}

function repeatedWork(
  toolRequests: number,
  requests: ModelRequest[],
  report = "Completed the inventory. The comparison remains.",
) {
  let requestNumber = 0;
  return async function* (request: ModelRequest) {
    requests.push(request);
    requestNumber += 1;
    if (request.tools.length === 0) {
      yield { kind: "textDelta" as const, text: report };
    } else if (requestNumber <= toolRequests) {
      yield {
        kind: "toolCallDelta" as const,
        index: 0,
        callId: `call-${requestNumber}`,
        name: "inspect_progress",
        argumentsDelta: "{}",
      };
    } else {
      yield { kind: "textDelta" as const, text: "All work is complete." };
    }
    yield { kind: "done" as const };
  };
}

function budgetPrompt(loop: AgentLoop, taskId: string) {
  const phase = loop.snapshot().tasks.find((task) => task.id === taskId)?.phase;
  if (phase?.kind !== "input" || phase.prompt.kind !== "workBudget")
    throw new Error("No pending work-budget decision.");
  return phase.prompt;
}

describe("AgentLoop renewable work budget", () => {
  it("pauses before an action when measured token or provider-cost limits are reached", async () => {
    const execute = vi.fn(async () => ({ ok: true as const, value: "seen" }));
    const base = stubDependencies(() => {});
    let request = 0;
    const loop = loopFrom({
      ...base,
      workLimits: {
        maximumElapsedMs: 60_000,
        maximumTokens: 100,
        maximumProviderCostUsd: 0.1,
      },
      tools: workTool(execute),
      permissions: {
        decide: async () => ({ outcome: "allow" as const, reason: "Read" }),
      },
      model: {
        ...base.model,
        send: async function* () {
          request += 1;
          if (request === 1) {
            yield {
              kind: "usage" as const,
              usage: {
                requestId: "request-1",
                model: "test",
                inputTokens: 90,
                outputTokens: 30,
                totalTokens: 120,
                costUsd: 0.12,
              },
            };
            yield {
              kind: "toolCallDelta" as const,
              index: 0,
              callId: "call-1",
              name: "inspect_progress",
              argumentsDelta: "{}",
            };
          } else {
            yield { kind: "textDelta" as const, text: "Paused safely." };
          }
          yield { kind: "done" as const };
        },
      },
      newUserInputId: () => "limit-1",
    });
    const taskId = await loop.createTask();

    const running = loop.start(taskId, "Inspect everything");
    await until(() => loop.snapshot().tasks[0]?.phase.kind === "input");

    expect(execute).not.toHaveBeenCalled();
    expect(budgetPrompt(loop, taskId).completedRounds).toBe(0);
    expect(budgetPrompt(loop, taskId)).not.toHaveProperty("message");
    await loop.resolveUserInput(taskId, "limit-1", {
      answers: [{ questionId: "work-budget", answerIds: ["pause"] }],
    });
    await running;
  });

  it("labels token use as estimated when the provider reports no usage", async () => {
    const execute = vi.fn(async () => ({ ok: true as const, value: "seen" }));
    const base = stubDependencies(() => {});
    const loop = loopFrom({
      ...base,
      workLimits: {
        maximumElapsedMs: 60_000,
        maximumTokens: 1,
        maximumProviderCostUsd: 1,
      },
      tools: workTool(execute),
      permissions: {
        decide: async () => ({ outcome: "allow" as const, reason: "Read" }),
      },
      model: { ...base.model, send: repeatedWork(1, []) },
      newUserInputId: () => "limit-1",
    });
    const taskId = await loop.createTask();

    const running = loop.start(taskId, "Inspect everything");
    await until(() => loop.snapshot().tasks[0]?.phase.kind === "input");

    expect(execute).not.toHaveBeenCalled();
    expect(budgetPrompt(loop, taskId).completedRounds).toBe(0);
    await loop.resolveUserInput(taskId, "limit-1", {
      answers: [{ questionId: "work-budget", answerIds: ["pause"] }],
    });
    await running;
  });

  it("pauses before another action when elapsed work reaches its limit", async () => {
    let now = new Date("2026-09-13T10:00:00.000Z");
    const execute = vi.fn(async () => ({ ok: true as const, value: "seen" }));
    const base = stubDependencies(() => {});
    const loop = loopFrom({
      ...base,
      now: () => now,
      workLimits: {
        maximumElapsedMs: 1_000,
        maximumTokens: 1_000_000,
        maximumProviderCostUsd: 10,
      },
      tools: workTool(execute),
      permissions: {
        decide: async () => ({ outcome: "allow" as const, reason: "Read" }),
      },
      model: {
        ...base.model,
        send: async function* () {
          now = new Date("2026-09-13T10:00:02.000Z");
          yield {
            kind: "toolCallDelta" as const,
            index: 0,
            callId: "call-1",
            name: "inspect_progress",
            argumentsDelta: "{}",
          };
          yield { kind: "done" as const };
        },
      },
      newUserInputId: () => "limit-1",
    });
    const taskId = await loop.createTask();

    const running = loop.start(taskId, "Inspect everything");
    await until(() => loop.snapshot().tasks[0]?.phase.kind === "input");

    expect(execute).not.toHaveBeenCalled();
    expect(budgetPrompt(loop, taskId).completedRounds).toBe(0);
    await loop.resolveUserInput(taskId, "limit-1", {
      answers: [{ questionId: "work-budget", answerIds: ["pause"] }],
    });
    await running;
  });

  it("refreshes another 24-round tranche every time the person continues", async () => {
    const requests: ModelRequest[] = [];
    const execute = vi.fn(async () => ({ ok: true as const, value: "seen" }));
    const base = stubDependencies(() => {});
    let inputNumber = 0;
    const loop = loopFrom({
      ...base,
      tools: workTool(execute),
      permissions: {
        decide: async () => ({
          outcome: "allow" as const,
          reason: "Read only",
        }),
      },
      model: { ...base.model, send: repeatedWork(49, requests) },
      newUserInputId: () => `budget-${++inputNumber}`,
    });
    const taskId = await loop.createTask();

    const running = loop.start(taskId, "Inspect everything");
    await until(
      () =>
        loop.snapshot().tasks[0]?.phase.kind === "input" &&
        budgetPrompt(loop, taskId).id === "budget-1",
    );
    expect(execute).toHaveBeenCalledTimes(24);
    await expect(
      loop.resolveUserInput(taskId, "stale-budget", {
        answers: [{ questionId: "work-budget", answerIds: ["continue"] }],
      }),
    ).rejects.toThrow("no longer active");
    await expect(
      loop.resolveUserInput(taskId, "budget-1", {
        answers: [{ questionId: "work-budget", answerIds: ["something-else"] }],
      }),
    ).rejects.toThrow("Choose Continue or Pause");
    expect(budgetPrompt(loop, taskId).id).toBe("budget-1");
    await loop.resolveUserInput(taskId, "budget-1", {
      answers: [{ questionId: "work-budget", answerIds: ["continue"] }],
    });

    await until(
      () =>
        loop.snapshot().tasks[0]?.phase.kind === "input" &&
        budgetPrompt(loop, taskId).id === "budget-2",
    );
    expect(execute).toHaveBeenCalledTimes(48);
    await loop.resolveUserInput(taskId, "budget-2", {
      answers: [{ questionId: "work-budget", answerIds: ["continue"] }],
    });
    await running;

    expect(execute).toHaveBeenCalledTimes(49);
    expect(loop.snapshot().tasks[0]?.phase).toMatchObject({
      kind: "completed",
      outcome: { title: "Response complete", summary: "All work is complete." },
    });
    expect(requests).toHaveLength(50);
  });

  it("uses exactly one tool-free model call to report progress, then pauses", async () => {
    const requests: ModelRequest[] = [];
    const execute = vi.fn(async () => ({ ok: true as const, value: "seen" }));
    const base = stubDependencies(() => {});
    const loop = loopFrom({
      ...base,
      tools: workTool(execute),
      permissions: {
        decide: async () => ({
          outcome: "allow" as const,
          reason: "Read only",
        }),
      },
      model: { ...base.model, send: repeatedWork(25, requests) },
      newUserInputId: () => "budget-1",
    });
    const taskId = await loop.createTask();

    const running = loop.start(taskId, "Inspect everything");
    await until(() => loop.snapshot().tasks[0]?.phase.kind === "input");
    expect(budgetPrompt(loop, taskId)).toMatchObject({
      id: "budget-1",
      kind: "workBudget",
      completedRounds: 24,
    });

    await loop.resolveUserInput(taskId, "budget-1", {
      answers: [{ questionId: "work-budget", answerIds: ["pause"] }],
    });
    await running;

    expect(execute).toHaveBeenCalledTimes(24);
    expect(requests).toHaveLength(26);
    expect(requests.at(-1)?.tools).toEqual([]);
    expect(JSON.stringify(requests.at(-1)?.messages)).toContain(
      "Do not call tools or continue the work",
    );
    expect(loop.snapshot().tasks[0]?.phase).toMatchObject({
      kind: "completed",
      outcome: {
        title: "Work paused",
        summary: "Completed the inventory. The comparison remains.",
      },
    });
  });

  it("condenses a long run where it crosses its context budget, and carries it across the renewal", async () => {
    const requests: ModelRequest[] = [];
    const execute = vi.fn(async () => ({ ok: true as const, value: "seen" }));
    const base = stubDependencies(() => {});
    let requestNumber = 0;
    const loop = loopFrom({
      ...base,
      // A 6,800-token Medium budget, crossed about two thirds of the way in.
      modelWindow: {
        model: "small",
        contextWindow: 8_000,
        maximumOutputTokens: 100,
      },
      tools: workTool(execute),
      permissions: {
        decide: async () => ({
          outcome: "allow" as const,
          reason: "Read only",
        }),
      },
      model: {
        ...base.model,
        send: async function* (request) {
          requests.push(request);
          if (JSON.stringify(request.messages.at(-1)).includes("condense")) {
            yield {
              kind: "textDelta" as const,
              text: JSON.stringify({
                title: "Continue inspection",
                summary: "The first inspection rounds completed.",
              }),
            };
            yield { kind: "done" as const };
            return;
          }
          requestNumber += 1;
          if (requestNumber <= 25) {
            yield {
              kind: "textDelta" as const,
              text:
                requestNumber === 1
                  ? `OLD-FIRST-MARKER ${"detail ".repeat(90)}`
                  : `Inspection round ${requestNumber}. ${"detail ".repeat(90)}`,
            };
            yield {
              kind: "toolCallDelta" as const,
              index: 0,
              callId: `call-${requestNumber}`,
              name: "inspect_progress",
              argumentsDelta: "{}",
            };
          } else {
            yield { kind: "textDelta" as const, text: "Inspection complete." };
          }
          yield { kind: "done" as const };
        },
      },
      newUserInputId: () => "budget-1",
    });
    const taskId = await loop.createTask();

    const running = loop.start(taskId, "Inspect everything");
    await until(() => loop.snapshot().tasks[0]?.phase.kind === "input");
    await loop.resolveUserInput(taskId, "budget-1", {
      answers: [{ questionId: "work-budget", answerIds: ["continue"] }],
    });
    await running;

    expect(loop.snapshot().tasks[0]?.compaction).toMatchObject({
      revision: 1,
      summary: "The first inspection rounds completed.",
    });
    const resumed = JSON.stringify(requests.at(-1)?.messages);
    expect(resumed).toContain("The first inspection rounds completed.");
    expect(resumed).toContain("fresh budget of 24 tool rounds");
    expect(resumed).not.toContain("OLD-FIRST-MARKER");
  });
});
