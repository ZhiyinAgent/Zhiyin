import { describe, expect, it, vi } from "vitest";
import type { ToolCallInspection } from "@zhiyin/contract";
import {
  loopFrom,
  pluginOffering,
  pluginsOffering,
  stubDependencies,
  until,
} from "./support.js";

describe("specialist child execution", () => {
  it("runs a specialist through the parent's tools and permission boundary, without blocking the parent", async () => {
    const execute = vi.fn(async () => ({
      ok: true as const,
      value: "The file has a regression test.",
    }));
    const base = stubDependencies(() => {});
    let specialistRound = 0;
    const loop = loopFrom({
      ...base,
      plugins: pluginsOffering([
        pluginOffering({
          name: "engineering",
          specialists: [
            {
              id: "reviewer",
              name: "Reviewer",
              description: "Reviews behavior and regressions.",
              instructions: "Inspect the evidence and report concrete risks.",
            },
          ],
        }),
      ]),
      tools: {
        list: () => [
          {
            name: "read_file",
            description: "Read one project file.",
            inputSchema: {
              type: "object",
              properties: { path: { type: "string" } },
              required: ["path"],
              additionalProperties: false,
            },
          },
        ],
        inspect: async (): Promise<ToolCallInspection> => ({
          ok: true,
          action: "Read file",
          target: "src/change.ts",
          command: "read_file(src/change.ts)",
          access: "read",
          scope: "workspace",
        }),
        execute,
      },
      permissions: {
        decide: async () => ({
          outcome: "allow" as const,
          reason: "Read only",
        }),
      },
      model: {
        ...base.model,
        // Which conversation is asking is read from the message content, not
        // request order: with the specialist running in the background, the
        // parent and its child now genuinely interleave.
        send: async function* (request) {
          const text = JSON.stringify(request.messages);
          if (text.includes("You are the Reviewer specialist")) {
            specialistRound += 1;
            if (specialistRound === 1) {
              expect(text).toContain(
                "Inspect the evidence and report concrete risks.",
              );
              yield {
                kind: "toolCallDelta" as const,
                index: 0,
                callId: "read-1",
                name: "read_file",
                argumentsDelta: JSON.stringify({ path: "src/change.ts" }),
              };
            } else {
              yield {
                kind: "toolCallDelta" as const,
                index: 0,
                callId: "finish-1",
                name: "finish_specialist",
                argumentsDelta: JSON.stringify({
                  summary: "The change is covered.",
                  findings: ["A regression test exercises the behavior."],
                  recommendations: ["Keep the test in the release gate."],
                  limitations: [],
                }),
              };
            }
            yield { kind: "done" as const };
            return;
          }
          // "delegated to so far" is the specialists notice sent whenever a
          // specialist's standing changes, and it stays in the conversation,
          // so it is what marks "already delegated" here too.
          if (!text.includes("Review the proposed change.")) {
            expect(request.tools?.map((tool) => tool.name)).toContain(
              "delegate_specialist",
            );
            yield {
              kind: "toolCallDelta" as const,
              index: 0,
              callId: "delegate-1",
              name: "delegate_specialist",
              argumentsDelta: JSON.stringify({
                id: "engineering/reviewer",
                task: "Review the proposed change.",
              }),
            };
            yield { kind: "done" as const };
            return;
          }
          // The parent's own round right after delegating: the ack it gets
          // back is a "started" receipt, never the handoff itself.
          if (!text.includes("finished in the background")) {
            expect(text).toContain("started");
            expect(text).not.toContain("The change is covered.");
          }
          yield {
            kind: "textDelta" as const,
            text: text.includes("finished in the background")
              ? "Review complete."
              : "Checking back once the review finishes.",
          };
          yield { kind: "done" as const };
        },
      },
      newSpecialistRunId: () => "specialist-1",
    });
    const taskId = await loop.createTask(["engineering"]);

    await loop.start(taskId, "Review this change");
    await until(
      () =>
        loop.snapshot().tasks[0]?.phase.kind === "completed" &&
        (loop.snapshot().tasks[0]?.phase as { outcome?: { summary?: string } })
          .outcome?.summary === "Review complete.",
    );

    expect(execute).toHaveBeenCalledTimes(1);
    expect(loop.snapshot().tasks[0]?.specialistRuns).toEqual([
      expect.objectContaining({
        id: "specialist-1",
        specialist: expect.objectContaining({
          id: "engineering/reviewer",
          provenance: { source: "plugin", pluginId: "engineering" },
        }),
        task: "Review the proposed change.",
        depth: 1,
        status: "completed",
        actionIds: [expect.stringContaining("action-")],
        handoff: {
          summary: "The change is covered.",
          findings: ["A regression test exercises the behavior."],
          recommendations: ["Keep the test in the release gate."],
          limitations: [],
        },
      }),
    ]);
  });

  it("cancels a running specialist with its parent and retains the interruption", async () => {
    const base = stubDependencies(() => {});
    let requestNumber = 0;
    let childStarted = false;
    const loop = loopFrom({
      ...base,
      plugins: pluginsOffering([
        pluginOffering({
          name: "engineering",
          specialists: [
            {
              id: "reviewer",
              name: "Reviewer",
              description: "Reviews work.",
              instructions: "Review the evidence.",
            },
          ],
        }),
      ]),
      model: {
        ...base.model,
        send: async function* (request) {
          requestNumber += 1;
          if (requestNumber === 1) {
            yield {
              kind: "toolCallDelta" as const,
              index: 0,
              callId: "delegate-1",
              name: "delegate_specialist",
              argumentsDelta: JSON.stringify({
                id: "engineering/reviewer",
                task: "Wait for evidence.",
              }),
            };
            yield { kind: "done" as const };
            return;
          }
          childStarted = true;
          await new Promise<void>((resolve) =>
            request.signal?.addEventListener("abort", () => resolve(), {
              once: true,
            }),
          );
        },
      },
      newSpecialistRunId: () => "specialist-cancelled",
    });
    const taskId = await loop.createTask(["engineering"]);

    const running = loop.start(taskId, "Review this change");
    await until(() => childStarted);
    await loop.cancel(taskId);
    await running;

    expect(loop.snapshot().tasks[0]?.specialistRuns).toMatchObject([
      {
        id: "specialist-cancelled",
        status: "interrupted",
        reason: "The specialist stopped before it completed.",
        finishedAt: expect.any(String),
      },
    ]);
    expect(loop.snapshot().tasks[0]?.phase.kind).toBe("interrupted");
  });

  it("never offers a running specialist its own delegate tool", async () => {
    const base = stubDependencies(() => {});
    const loop = loopFrom({
      ...base,
      plugins: pluginsOffering([
        pluginOffering({
          name: "engineering",
          specialists: [
            {
              id: "reviewer",
              name: "Reviewer",
              description: "Reviews work.",
              instructions: "Review the evidence.",
            },
          ],
        }),
      ]),
      model: {
        ...base.model,
        send: async function* (request) {
          const text = JSON.stringify(request.messages);
          if (text.includes("You are the Reviewer specialist")) {
            expect(
              request.tools?.some(
                (tool) => tool.name === "delegate_specialist",
              ),
            ).toBe(false);
            yield {
              kind: "toolCallDelta" as const,
              index: 0,
              callId: "finish-1",
              name: "finish_specialist",
              argumentsDelta: JSON.stringify({
                summary: "Done.",
                findings: [],
                recommendations: [],
                limitations: [],
              }),
            };
            yield { kind: "done" as const };
            return;
          }
          if (!text.includes("Review this.")) {
            yield {
              kind: "toolCallDelta" as const,
              index: 0,
              callId: "delegate-1",
              name: "delegate_specialist",
              argumentsDelta: JSON.stringify({
                id: "engineering/reviewer",
                task: "Review this.",
              }),
            };
            yield { kind: "done" as const };
            return;
          }
          yield { kind: "textDelta" as const, text: "Noted." };
          yield { kind: "done" as const };
        },
      },
      newSpecialistRunId: () => "specialist-1",
    });
    const taskId = await loop.createTask(["engineering"]);

    await loop.start(taskId, "Review this change");
    await until(
      () => loop.snapshot().tasks[0]?.specialistRuns?.[0]?.status !== "running",
    );

    expect(loop.snapshot().tasks[0]?.specialistRuns).toMatchObject([
      { id: "specialist-1", status: "completed" },
    ]);
  });

  it("refuses a fourth delegation in the same turn", async () => {
    const base = stubDependencies(() => {});
    let parentAttempt = 0;
    let runId = 0;
    const loop = loopFrom({
      ...base,
      plugins: pluginsOffering([
        pluginOffering({
          name: "engineering",
          specialists: [
            {
              id: "reviewer",
              name: "Reviewer",
              description: "Reviews work.",
              instructions: "Review the evidence.",
            },
          ],
        }),
      ]),
      model: {
        ...base.model,
        send: async function* (request) {
          const delegating = request.tools?.some(
            (tool) => tool.name === "delegate_specialist",
          );
          if (delegating) {
            const attempt = ++parentAttempt;
            if (attempt === 4) {
              expect(JSON.stringify(request.messages)).toContain(
                "already delegated to 3 specialists",
              );
              yield { kind: "textDelta" as const, text: "Stopping here." };
              yield { kind: "done" as const };
              return;
            }
            yield {
              kind: "toolCallDelta" as const,
              index: 0,
              callId: `delegate-${attempt}`,
              name: "delegate_specialist",
              argumentsDelta: JSON.stringify({
                id: "engineering/reviewer",
                task: `Task ${attempt}`,
              }),
            };
            yield { kind: "done" as const };
            return;
          }
          yield {
            kind: "toolCallDelta" as const,
            index: 0,
            callId: "finish",
            name: "finish_specialist",
            argumentsDelta: JSON.stringify({
              summary: "Done.",
              findings: [],
              recommendations: [],
              limitations: [],
            }),
          };
          yield { kind: "done" as const };
        },
      },
      newSpecialistRunId: () => `specialist-${++runId}`,
    });
    const taskId = await loop.createTask(["engineering"]);

    await loop.start(taskId, "Review this change");
    await until(
      () =>
        (loop.snapshot().tasks[0]?.specialistRuns ?? []).length === 3 &&
        (loop.snapshot().tasks[0]?.specialistRuns ?? []).every(
          (run) => run.status !== "running",
        ),
    );

    const runs = loop.snapshot().tasks[0]?.specialistRuns ?? [];
    expect(runs).toHaveLength(3);
    expect(runs.every((run) => run.status === "completed")).toBe(true);
  });

  it("stops itself when the shared work budget is reached while it is running alone", async () => {
    const base = stubDependencies(() => {});
    const loop = loopFrom({
      ...base,
      workLimits: {
        maximumElapsedMs: 60_000,
        maximumTokens: 100,
        maximumProviderCostUsd: 10,
      },
      plugins: pluginsOffering([
        pluginOffering({
          name: "engineering",
          specialists: [
            {
              id: "reviewer",
              name: "Reviewer",
              description: "Reviews work.",
              instructions: "Review the evidence.",
            },
          ],
        }),
      ]),
      tools: {
        list: () => [
          {
            name: "read_file",
            description: "Read one project file.",
            inputSchema: {
              type: "object",
              properties: { path: { type: "string" } },
              required: ["path"],
              additionalProperties: false,
            },
          },
        ],
        inspect: async (): Promise<ToolCallInspection> => ({
          ok: true,
          action: "Read file",
          target: "x",
          command: "read_file(x)",
        }),
        execute: async () => ({ ok: true as const, value: "seen" }),
      },
      permissions: {
        decide: async () => ({ outcome: "allow" as const, reason: "Read" }),
      },
      model: {
        ...base.model,
        send: async function* (request) {
          const text = JSON.stringify(request.messages);
          if (text.includes("You are the Reviewer specialist")) {
            yield {
              kind: "usage" as const,
              usage: {
                requestId: "specialist-usage-1",
                model: "test",
                inputTokens: 90,
                outputTokens: 30,
                totalTokens: 120,
              },
            };
            yield {
              kind: "toolCallDelta" as const,
              index: 0,
              callId: "read-1",
              name: "read_file",
              argumentsDelta: JSON.stringify({ path: "x" }),
            };
            yield { kind: "done" as const };
            return;
          }
          if (!text.includes("Review this.")) {
            // A small measured usage, not the estimate fallback: the parent's
            // own round must not itself trip the tiny shared budget below —
            // this test is about the specialist tripping it on top.
            yield {
              kind: "usage" as const,
              usage: {
                requestId: "parent-usage-1",
                model: "test",
                inputTokens: 5,
                outputTokens: 5,
                totalTokens: 10,
              },
            };
            yield {
              kind: "toolCallDelta" as const,
              index: 0,
              callId: "delegate-1",
              name: "delegate_specialist",
              argumentsDelta: JSON.stringify({
                id: "engineering/reviewer",
                task: "Review this.",
              }),
            };
            yield { kind: "done" as const };
            return;
          }
          yield {
            kind: "usage" as const,
            usage: {
              requestId: "parent-usage-2",
              model: "test",
              inputTokens: 5,
              outputTokens: 5,
              totalTokens: 10,
            },
          };
          yield { kind: "textDelta" as const, text: "Noted." };
          yield { kind: "done" as const };
        },
      },
      newSpecialistRunId: () => "specialist-1",
    });
    const taskId = await loop.createTask(["engineering"]);

    await loop.start(taskId, "Review this change");
    await until(
      () => loop.snapshot().tasks[0]?.specialistRuns?.[0]?.status !== "running",
    );

    expect(loop.snapshot().tasks[0]?.specialistRuns).toMatchObject([
      {
        id: "specialist-1",
        status: "interrupted",
        reason: expect.stringContaining("shared work budget"),
      },
    ]);
  });

  it("answers a specialist's unreadable tool input instead of failing the specialist", async () => {
    const execute = vi.fn(async () => ({ ok: true as const, value: "text" }));
    const base = stubDependencies(() => {});
    const specialistRequests: string[] = [];
    const loop = loopFrom({
      ...base,
      plugins: pluginsOffering([
        pluginOffering({
          name: "engineering",
          specialists: [
            {
              id: "reviewer",
              name: "Reviewer",
              description: "Reviews behavior and regressions.",
              instructions: "Inspect the evidence and report concrete risks.",
            },
          ],
        }),
      ]),
      tools: {
        list: () => [
          {
            name: "read_file",
            description: "Read one project file.",
            inputSchema: {
              type: "object",
              properties: { path: { type: "string" } },
            },
          },
        ],
        inspect: async (): Promise<ToolCallInspection> => ({
          ok: true,
          action: "Read file",
          target: "src/change.ts",
          command: "read_file(src/change.ts)",
        }),
        execute,
      },
      model: {
        ...base.model,
        send: async function* (request) {
          const text = JSON.stringify(request.messages);
          if (text.includes("You are the Reviewer specialist")) {
            specialistRequests.push(text);
            yield specialistRequests.length === 1
              ? {
                  kind: "toolCallDelta" as const,
                  index: 0,
                  callId: "read-1",
                  name: "read_file",
                  argumentsDelta: '{"path":"src/cha',
                }
              : {
                  kind: "toolCallDelta" as const,
                  index: 0,
                  callId: "finish-1",
                  name: "finish_specialist",
                  argumentsDelta: JSON.stringify({
                    summary: "Nothing was read.",
                    findings: [],
                    recommendations: [],
                    limitations: ["The file was not read."],
                  }),
                };
            yield { kind: "done" as const };
            return;
          }
          if (!text.includes("Review the proposed change.")) {
            yield {
              kind: "toolCallDelta" as const,
              index: 0,
              callId: "delegate-1",
              name: "delegate_specialist",
              argumentsDelta: JSON.stringify({
                id: "engineering/reviewer",
                task: "Review the proposed change.",
              }),
            };
          } else {
            yield { kind: "textDelta" as const, text: "Waiting." };
          }
          yield { kind: "done" as const };
        },
      },
      newSpecialistRunId: () => "specialist-1",
    });
    const taskId = await loop.createTask(["engineering"]);

    await loop.start(taskId, "Review this change");
    await until(
      () =>
        loop.snapshot().tasks[0]?.specialistRuns?.[0]?.status === "completed",
    );

    expect(execute).not.toHaveBeenCalled();
    expect(specialistRequests[1]).toContain("cut off");
  });
});
