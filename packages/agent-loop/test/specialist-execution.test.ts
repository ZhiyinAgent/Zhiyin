import { describe, expect, it, vi } from "vitest";
import type { TaskAction, ToolCallInspection } from "@zhiyin/contract";
import type { ModelEvent } from "@zhiyin/model-client";
import type { WorkLimits } from "../src/index.js";
import {
  completeHandoffMessage,
  handoffMessage,
} from "../src/specialist/specialist-execution.js";
import {
  loopFrom,
  pluginOffering,
  pluginsOffering,
  stubDependencies,
  until,
} from "./support.js";

describe("specialist child execution", () => {
  it("refuses a read specialist's write before permission is requested", async () => {
    const base = stubDependencies(() => {});
    const permission = vi.fn(async () => ({
      outcome: "ask" as const,
      reason: "Approval required.",
    }));
    const inspect = vi.fn(async (): Promise<ToolCallInspection> => ({
      ok: true,
      action: "Write a file",
      target: "report.md",
      command: "write_file(report.md)",
      access: "change",
      scope: "workspace",
    }));
    const childRequests: string[] = [];
    let childRound = 0;
    const loop = loopFrom({
      ...base,
      plugins: pluginsOffering([
        pluginOffering({
          name: "engineering",
          specialists: [
            {
              id: "reviewer",
              name: "Reviewer",
              description: "Read-only review.",
              instructions: "Review.",
              access: "read",
            },
          ],
        }),
      ]),
      tools: {
        list: () => [
          {
            name: "write_file",
            description: "Write.",
            inputSchema: { type: "object" },
          },
        ],
        inspect,
        execute: vi.fn(async () => ({ ok: true as const })),
      },
      permissions: { decide: permission },
      model: {
        ...base.model,
        send: async function* (request) {
          const text = JSON.stringify(request.messages);
          if (text.includes("You are the Reviewer specialist")) {
            childRequests.push(text);
            childRound += 1;
            yield childRound === 1
              ? {
                  kind: "toolCallDelta" as const,
                  index: 0,
                  callId: "write-1",
                  name: "write_file",
                  argumentsDelta: '{"path":"report.md","text":"bad"}',
                }
              : {
                  kind: "toolCallDelta" as const,
                  index: 0,
                  callId: "finish-1",
                  name: "finish_specialist",
                  argumentsDelta: JSON.stringify({
                    summary: "Could only read.",
                    findings: [],
                    recommendations: [],
                    limitations: [],
                  }),
                };
          } else if (!text.includes("Read-only review task")) {
            yield {
              kind: "toolCallDelta" as const,
              index: 0,
              callId: "delegate-1",
              name: "delegate_specialist",
              argumentsDelta: JSON.stringify({
                id: "engineering/reviewer",
                task: "Read-only review task",
              }),
            };
          } else
            yield { kind: "textDelta" as const, text: "Review delegated." };
          yield { kind: "done" as const };
        },
      },
    });
    const taskId = await loop.createTask(["engineering"]);
    await loop.start(taskId, "Review this safely");
    await until(
      () =>
        loop.snapshot().tasks[0]?.specialistRuns?.[0]?.status === "completed",
    ).catch(() => {
      throw new Error(JSON.stringify(loop.snapshot().tasks[0]?.specialistRuns));
    });

    expect(permission).not.toHaveBeenCalled();
    expect(inspect).not.toHaveBeenCalled();
    expect(childRequests[1]).toContain("This specialist can only read.");
    expect(loop.snapshot().tasks[0]?.actions).toEqual([
      expect.objectContaining({
        status: "blocked",
        specialistRunId: expect.any(String),
      }),
    ]);
  });
  it("gives the parent ordered outcomes and a page reference for a long timeline", () => {
    const specialist = {
      id: "engineering/reviewer",
      name: "Reviewer",
      description: "Reviews changes.",
      instructions: "Read evidence.",
      provenance: { source: "plugin" as const, pluginId: "engineering" },
    };
    const result = {
      ok: true as const,
      runId: "review-1",
      specialist,
      handoff: {
        summary: "Reviewed.",
        findings: [],
        recommendations: [],
        limitations: [],
      },
    };
    const actions: TaskAction[] = Array.from({ length: 130 }, (_, index) => ({
      id: `action-${index}`,
      action: "Read evidence",
      toolName: "read_file",
      target: `src/long-evidence-${index}.ts`,
      status: index === 1 ? "denied" : index === 2 ? "failed" : "completed",
      sequence: index + 1,
      specialistRunId: "review-1",
    }));
    const full = completeHandoffMessage(result, actions);
    const notice = handoffMessage(result, actions, "output://saved-trace");

    expect(full).toContain('"actionId":"action-129"');
    expect(full).toContain('"outcome":"denied"');
    expect(full).toContain('"outcome":"failed"');
    expect(notice).toContain("120 calls omitted");
    expect(notice).toContain('read_file({"path":"output://saved-trace"})');
    expect(notice).not.toContain('"actionId":"action-129"');
  });
  it("attributes interleaved parent and specialist actions to their actual owner", async () => {
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
          if (!text.includes("parent-read")) {
            yield {
              kind: "toolCallDelta" as const,
              index: 0,
              callId: "parent-read",
              name: "read_file",
              argumentsDelta: JSON.stringify({ path: "src/parent.ts" }),
            };
            yield { kind: "done" as const };
            return;
          }
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

    expect(execute).toHaveBeenCalledTimes(2);
    const actions = loop.snapshot().tasks[0]?.actions ?? [];
    expect(actions).toHaveLength(2);
    expect(
      actions.filter((action) => action.specialistRunId === "specialist-1"),
    ).toHaveLength(1);
    expect(actions.filter((action) => !action.specialistRunId)).toHaveLength(1);
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
        actionIds: [
          actions.find((action) => action.specialistRunId === "specialist-1")
            ?.id,
        ],
        handoff: {
          summary: "The change is covered.",
          findings: ["A regression test exercises the behavior."],
          recommendations: ["Keep the test in the release gate."],
          limitations: [],
        },
      }),
    ]);
  });

  it("delivers a handoff that arrived while the parent was answering its last request", async () => {
    const base = stubDependencies(() => {});
    let answering = false;
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
      model: {
        ...base.model,
        send: async function* (request) {
          const text = JSON.stringify(request.messages);
          if (text.includes("You are the Reviewer specialist")) {
            // Settles only once the parent is answering its last request.
            await until(() => answering);
            yield {
              kind: "toolCallDelta" as const,
              index: 0,
              callId: "finish-1",
              name: "finish_specialist",
              argumentsDelta: JSON.stringify({
                summary: "The change is covered.",
                findings: [],
                recommendations: [],
                limitations: [],
              }),
            };
          } else if (!text.includes("Review the proposed change.")) {
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
          } else if (text.includes("finished in the background")) {
            yield { kind: "textDelta" as const, text: "Review complete." };
          } else {
            // The parent's last request is still being answered when the
            // specialist settles.
            answering = true;
            await until(
              () =>
                loop.snapshot().tasks[0]?.specialistRuns?.[0]?.status ===
                "completed",
            );
            yield { kind: "textDelta" as const, text: "Waiting for it." };
          }
          yield { kind: "done" as const };
        },
      },
      newSpecialistRunId: () => "specialist-1",
    });
    const taskId = await loop.createTask(["engineering"]);

    await loop.start(taskId, "Review this change");
    await until(() => {
      const phase = loop.snapshot().tasks[0]?.phase;
      return (
        phase?.kind === "completed" &&
        phase.outcome.summary === "Review complete."
      );
    });
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

  /**
   * One delegation to a reviewer whose every round is scripted. The parent
   * delegates once and then answers; `specialist` says what the reviewer does
   * on its nth request, and is given the tools it was offered.
   */
  function delegatingLoop(options: {
    readonly workLimits?: WorkLimits;
    readonly specialistWorkLimits?: WorkLimits;
    readonly specialist: (
      round: number,
      tools: readonly string[],
      messages: string,
    ) => readonly ModelEvent[];
  }) {
    const base = stubDependencies(() => {});
    let specialistRound = 0;
    return loopFrom({
      ...base,
      ...(options.workLimits ? { workLimits: options.workLimits } : {}),
      ...(options.specialistWorkLimits
        ? { specialistWorkLimits: options.specialistWorkLimits }
        : {}),
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
            specialistRound += 1;
            yield* options.specialist(
              specialistRound,
              request.tools.map((tool) => tool.name),
              text,
            );
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
  }

  const readsAFile = (round: number): ModelEvent => ({
    kind: "toolCallDelta",
    index: 0,
    callId: `read-${round}`,
    name: "read_file",
    argumentsDelta: JSON.stringify({ path: "x" }),
  });

  const finishes = (summary: string): ModelEvent => ({
    kind: "toolCallDelta",
    index: 0,
    callId: "finish",
    name: "finish_specialist",
    argumentsDelta: JSON.stringify({
      summary,
      findings: [],
      recommendations: [],
      limitations: [],
    }),
  });

  async function settled(loop: ReturnType<typeof delegatingLoop>) {
    const taskId = await loop.createTask(["engineering"]);
    await loop.start(taskId, "Review this change");
    await until(
      () => loop.snapshot().tasks[0]?.specialistRuns?.[0]?.status !== "running",
    );
    return loop.snapshot().tasks[0]?.specialistRuns?.[0];
  }

  it("does not count a specialist's spending against the main task's budget", async () => {
    const loop = delegatingLoop({
      // A cost the specialist alone goes far past. It has to finish, and the
      // main task has to go on, without being asked to continue.
      workLimits: {
        maximumElapsedMs: 60_000,
        maximumProviderCostUsd: 0.1,
      },
      specialist: (round) =>
        round === 1
          ? [
              {
                kind: "usage",
                usage: {
                  requestId: "specialist-usage-1",
                  model: "test",
                  inputTokens: 90,
                  outputTokens: 30,
                  totalTokens: 120,
                  costUsd: 5,
                },
              },
              readsAFile(round),
            ]
          : [finishes("Done.")],
    });

    const run = await settled(loop);

    expect(run).toMatchObject({ status: "completed" });
    expect(loop.snapshot().tasks[0]?.phase.kind).not.toBe("input");
  });

  it("asks a specialist that reached its own budget to report what it has", async () => {
    const offered: (readonly string[])[] = [];
    let wrapUp = "";
    const loop = delegatingLoop({
      specialistWorkLimits: {
        maximumElapsedMs: 60_000,
        maximumProviderCostUsd: 10,
        maximumToolRounds: 2,
      },
      specialist: (round, tools, messages) => {
        offered.push(tools);
        if (round <= 2) return [readsAFile(round)];
        wrapUp = messages;
        return [finishes("Partial: two files read.")];
      },
    });

    const run = await settled(loop);

    expect(run).toMatchObject({
      status: "completed",
      handoff: { summary: "Partial: two files read." },
    });
    // Only the way out is on offer once the budget is spent.
    expect(offered.at(-1)).toEqual(["finish_specialist"]);
    expect(wrapUp).toContain("work budget is used up");
  });

  it("stops a specialist that will not report once its budget is spent", async () => {
    const loop = delegatingLoop({
      specialistWorkLimits: {
        maximumElapsedMs: 60_000,
        maximumProviderCostUsd: 10,
        maximumToolRounds: 1,
      },
      specialist: (round) => [readsAFile(round)],
    });

    const run = await settled(loop);

    expect(run).toMatchObject({
      status: "interrupted",
      reason: expect.stringContaining("budget"),
    });
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

  it("shows a specialist the start and end of a large answer, and keeps the whole", async () => {
    const execute = vi.fn(async () => ({
      ok: true as const,
      value: {
        text: "start of the file " + "x".repeat(100_000) + " end of the file",
      },
      details: [
        {
          kind: "text" as const,
          label: "Contents",
          text: "copy for the person",
        },
      ],
    }));
    const base = stubDependencies(() => {});
    const specialistRequests: string[] = [];
    const loop = loopFrom({
      ...base,
      permissions: {
        decide: async () => ({ outcome: "allow" as const, reason: "Allowed" }),
      },
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
                  argumentsDelta: '{"path":"src/change.ts"}',
                }
              : {
                  kind: "toolCallDelta" as const,
                  index: 0,
                  callId: "finish-1",
                  name: "finish_specialist",
                  argumentsDelta: JSON.stringify({
                    summary: "Read.",
                    findings: [],
                    recommendations: [],
                    limitations: [],
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

    expect(execute).toHaveBeenCalled();
    const sent = specialistRequests[1] ?? "";
    expect(sent).toContain("start of the file");
    expect(sent).toContain("end of the file");
    expect(sent).toContain("saved as output://");
    expect(sent).not.toContain("copy for the person");
    expect(sent.length).toBeLessThan(40_000);
  });
});
