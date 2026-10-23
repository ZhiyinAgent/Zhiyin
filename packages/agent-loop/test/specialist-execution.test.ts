import { describe, expect, it, vi } from "vitest";
import {
  estimatedTokens,
  type ModelWindow,
  type ReasoningCapabilities,
  type ReasoningSelection,
  type TaskAction,
  type ToolCallInspection,
  type WorkspaceTask,
} from "@zhiyin/contract";
import {
  ModelClientError,
  type ModelEvent,
  type ModelRequest,
} from "@zhiyin/model-client";
import type { WorkLimits } from "../src/index.js";
import {
  completeHandoffMessage,
  handoffMessage,
} from "../src/specialist/specialist-execution.js";
import { notices } from "./plan-fixture.js";
import {
  loopAndHost,
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
        execute: vi.fn(async () => ({ ok: true as const, value: "Written." })),
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
                    report: "Could only read.",
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
  it("offers a read specialist the connector tools a plugin declares as reading, and no other connector tool", async () => {
    const base = stubDependencies(() => {});
    const tool = (name: string, access?: "read") => ({
      name,
      description: `The ${name} tool.`,
      inputSchema: { type: "object" },
      ...(access ? { access } : {}),
    });
    let offered: string[] = [];
    const loop = loopFrom({
      ...base,
      plugins: pluginsOffering([
        pluginOffering({
          name: "research",
          specialists: [
            {
              id: "fact-checker",
              name: "Fact-checker",
              description: "Checks facts.",
              instructions: "Check.",
              access: "read",
            },
          ],
        }),
      ]),
      tools: {
        ...base.tools,
        list: () => [tool("read_file", "read"), tool("write_file")],
      },
      mcp: {
        ...base.mcp,
        availableTools: async () => [
          // Marked by the connection feature from the plugin's declaration.
          tool("mcp__research__tavily__tavily_search", "read"),
          tool("mcp__research__tavily__tavily_feedback"),
        ],
      },
      model: {
        ...base.model,
        send: async function* (request) {
          const text = JSON.stringify(request.messages);
          if (text.includes("You are the Fact-checker specialist")) {
            offered = (request.tools ?? []).map((offer) => offer.name);
            yield finishes("Checked.");
          } else if (!text.includes("Check the figures.")) {
            yield {
              kind: "toolCallDelta" as const,
              index: 0,
              callId: "delegate-1",
              name: "delegate_specialist",
              argumentsDelta: JSON.stringify({
                id: "research/fact-checker",
                task: "Check the figures.",
              }),
            };
          } else yield { kind: "textDelta" as const, text: "Delegated." };
          yield { kind: "done" as const };
        },
      },
    });
    const taskId = await loop.createTask(["research"]);
    await loop.start(taskId, "Check this guide");
    await until(
      () =>
        loop.snapshot().tasks[0]?.specialistRuns?.[0]?.status === "completed",
    );

    expect(offered.sort()).toEqual([
      "finish_specialist",
      "mcp__research__tavily__tavily_search",
      "read_file",
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
        report: "Reviewed.",
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
    const { notice, report } = handoffMessage(
      result,
      actions,
      "output://saved-trace",
    );

    expect(full).toContain('"actionId":"action-129"');
    expect(full).toContain('"outcome":"denied"');
    expect(full).toContain('"outcome":"failed"');
    expect(report).toContain("120 calls omitted");
    expect(notice).toContain('read_file({"path":"output://saved-trace"})');
    expect(report).not.toContain('"actionId":"action-129"');
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
        // parent and its child interleave.
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
                  report: "The change is covered.",
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
          report: "The change is covered.",
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
                report: "The change is covered.",
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

  it("starts nothing when a stopped turn's specialist settles", async () => {
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
    const requestsAtStop = requestNumber;
    // Nothing is awaited that could start a turn: a wake would have begun by now.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(requestNumber).toBe(requestsAtStop);
    expect(loop.running(taskId)).toBe(false);
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
                report: "Done.",
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
    let afterFourth: ModelRequest | undefined;
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
            if (attempt === 5) {
              afterFourth = request;
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
              report: "Done.",
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
    expect(JSON.stringify(afterFourth?.messages)).toContain(
      "already delegated to 3 specialists",
    );
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
      request: ModelRequest,
    ) => readonly ModelEvent[];
    /** Whether a tool may run; allowed when left out. */
    readonly decide?: () => Promise<{
      readonly outcome: "allow";
      readonly reason: string;
    }>;
    readonly recordDefect?: (defect: {
      readonly taskId: string;
      readonly error: unknown;
    }) => void;
    /** Saving a conversation in this state fails, as on a full disk. */
    readonly refusesSaving?: (task: WorkspaceTask) => boolean;
    readonly longestThoughtTokens?: number;
    readonly leastReasoning?: ReasoningSelection;
    readonly reasoningControls?: ReasoningCapabilities;
    readonly modelWindow?: ModelWindow & { readonly model: string };
    /** What the read tool answers; "seen" when left out. */
    readonly answer?: () => string;
    /** Hears how much of its answer the read tool is told will be shown. */
    readonly told?: (answerTokens: number | undefined) => void;
    /** Every input the read tool was asked to inspect, in order. */
    readonly inspected?: unknown[];
    /** A request the provider refuses, by the reviewer's round. */
    readonly refuses?: (round: number) => Error | undefined;
    /** How the read tool describes itself; one line when left out. */
    readonly toolDescription?: string;
    /** Hears every output saved for the conversation. */
    readonly onKeep?: (text: string) => void;
    /** The clock and the person's time zone; the stubs' when left out. */
    readonly clock?: { readonly now: Date; readonly timeZone: string };
    /** Hears the host, to read the window planned with afterwards. */
    readonly onHost?: (host: {
      modelWindow(): ModelWindow & { readonly model: string };
    }) => void;
  }) {
    const base = stubDependencies(() => {});
    let specialistRound = 0;
    const { host } = loopAndHost({
      ...base,
      sessions: {
        ...base.sessions,
        keep: async (kind, conversationId, source) => {
          if ("text" in source) options.onKeep?.(source.text);
          return base.sessions.keep(kind, conversationId, source);
        },
      },
      ...(options.modelWindow ? { modelWindow: options.modelWindow } : {}),
      ...(options.longestThoughtTokens
        ? { longestThoughtTokens: options.longestThoughtTokens }
        : {}),
      ...(options.leastReasoning
        ? { leastReasoning: options.leastReasoning }
        : {}),
      ...(options.reasoningControls
        ? { reasoningControls: options.reasoningControls }
        : {}),
      ...(options.recordDefect ? { recordDefect: options.recordDefect } : {}),
      ...(options.clock
        ? {
            now: () => options.clock?.now ?? new Date(),
            timeZone: options.clock.timeZone,
          }
        : {}),
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
            description: options.toolDescription ?? "Read one project file.",
            inputSchema: {
              type: "object",
              properties: { path: { type: "string" } },
              required: ["path"],
              additionalProperties: false,
            },
          },
        ],
        inspect: async (_name, args): Promise<ToolCallInspection> => {
          options.inspected?.push(args);
          return {
            ok: true,
            action: "Read file",
            target: "x",
            command: "read_file(x)",
          };
        },
        execute: async (
          _name: string,
          _args: unknown,
          _signal?: AbortSignal,
          _conversationId?: string,
          answerTokens?: number,
        ) => {
          options.told?.(answerTokens);
          return { ok: true as const, value: options.answer?.() ?? "seen" };
        },
      },
      permissions: {
        decide:
          options.decide ??
          (async () => ({ outcome: "allow" as const, reason: "Read" })),
      },
      model: {
        ...base.model,
        send: async function* (request) {
          const text = JSON.stringify(request.messages);
          if (text.includes("You are the Reviewer specialist")) {
            specialistRound += 1;
            const refusal = options.refuses?.(specialistRound);
            if (refusal) throw refusal;
            yield* options.specialist(
              specialistRound,
              (request.tools ?? []).map((tool) => tool.name),
              text,
              request,
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
    options.onHost?.(host);
    const refuses = options.refusesSaving;
    if (refuses) {
      const store = host.store.bind(host);
      host.store = async (task, saving) => {
        if (refuses(task)) throw new Error("The disk is full.");
        await store(task, saving);
      };
    }
    return host.app;
  }

  const readsAFile = (round: number): ModelEvent => ({
    kind: "toolCallDelta",
    index: 0,
    callId: `read-${round}`,
    name: "read_file",
    argumentsDelta: JSON.stringify({ path: "x" }),
  });

  const finishes = (report: string): ModelEvent => ({
    kind: "toolCallDelta",
    index: 0,
    callId: "finish",
    name: "finish_specialist",
    argumentsDelta: JSON.stringify({
      report,
    }),
  });

  async function settled(
    loop: ReturnType<typeof delegatingLoop>,
    reasoning?: ReasoningSelection,
  ) {
    const taskId = await loop.createTask(["engineering"]);
    await loop.start(taskId, "Review this change", reasoning);
    await until(
      () => loop.snapshot().tasks[0]?.specialistRuns?.[0]?.status !== "running",
    );
    return loop.snapshot().tasks[0]?.specialistRuns?.[0];
  }

  it("tells a specialist today's date where the person is, not in UTC", async () => {
    let first: ModelRequest | undefined;
    const loop = delegatingLoop({
      // 04:00 on Sunday 18 October in Beijing, still the 17th in UTC and Europe.
      clock: {
        now: new Date("2026-10-17T20:00:00.000Z"),
        timeZone: "Asia/Shanghai",
      },
      specialist: (round, _tools, _messages, request) => {
        if (round === 1) first = request;
        return [finishes("Done.")];
      },
    });

    await settled(loop);

    expect(first?.messages[0]?.content).toContain(
      "Today is Sunday, 18 October 2026.",
    );
  });

  it("hands a specialist its task as Zhiyin's first message to it, after its instructions", async () => {
    let first: ModelRequest | undefined;
    const loop = delegatingLoop({
      specialist: (round, _tools, _messages, request) => {
        if (round === 1) first = request;
        return [finishes("Done.")];
      },
    });

    await settled(loop);

    const roles = first?.messages.map((message) => message.role) ?? [];
    const firstUser = roles.indexOf("user");
    // A request of system messages alone reaches Anthropic with no message.
    expect(firstUser).toBeGreaterThan(0);
    expect(roles.slice(0, firstUser).every((role) => role === "system")).toBe(
      true,
    );
    expect(notices(first, "delegation")).toEqual([
      expect.objectContaining({
        content: expect.stringContaining("Review this."),
      }),
    ]);
    expect(JSON.stringify(first?.messages.slice(0, firstUser))).not.toContain(
      "Review this.",
    );
  });

  it("asks with the conversation's reasoning, names the conversation as its session, and marks what its next request reuses", async () => {
    const requests: ModelRequest[] = [];
    const loop = delegatingLoop({
      specialist: (round, _tools, _messages, request) => {
        requests.push(request);
        return round === 1 ? [readsAFile(round)] : [finishes("Done.")];
      },
    });

    await settled(loop, { enabled: true, effort: "high" });
    const taskId = loop.snapshot().tasks[0]!.id;

    expect(requests.map((request) => request.reasoning)).toEqual([
      { enabled: true, effort: "high" },
      { enabled: true, effort: "high" },
    ]);
    expect(requests.map((request) => request.session)).toEqual([
      taskId,
      taskId,
    ]);
    const [first, second] = requests;
    const lastInstruction =
      first!.messages.findIndex((message) => message.role !== "system") - 1;
    expect(first?.cacheAfter).toContain(lastInstruction);
    expect(second?.cacheAfter).toEqual(
      expect.arrayContaining([
        lastInstruction,
        first!.messages.length - 1,
        second!.messages.length - 1,
      ]),
    );
  });

  it("asks with the model's default effort where the conversation's is one the model does not offer", async () => {
    const requests: ModelRequest[] = [];
    const loop = delegatingLoop({
      reasoningControls: {
        status: "available",
        required: false,
        defaultEnabled: true,
        defaultEffort: "medium",
        efforts: ["low", "medium", "high"],
      },
      specialist: (round, _tools, _messages, request) => {
        requests.push(request);
        return round === 1 ? [readsAFile(round)] : [finishes("Done.")];
      },
    });

    await settled(loop, { enabled: true, effort: "xhigh" });

    expect(requests.map((request) => request.reasoning)).toEqual([
      { enabled: true, effort: "medium" },
      { enabled: true, effort: "medium" },
    ]);
  });

  it("asks each of a specialist's calls what it is for, and takes that off before the tool sees the call", async () => {
    const inspected: unknown[] = [];
    let offered: ModelRequest["tools"];
    const loop = delegatingLoop({
      inspected,
      specialist: (round, _tools, _messages, request) => {
        if (round > 1) return [finishes("x says seen.")];
        offered = request.tools;
        return [
          {
            ...readsAFile(round),
            argumentsDelta: JSON.stringify({
              path: "x",
              purpose: "Check what x says.",
            }),
          },
        ];
      },
    });

    const run = await settled(loop);

    const required = (name: string) =>
      (
        offered?.find((tool) => tool.name === name)?.inputSchema as {
          readonly required?: readonly string[];
        }
      ).required;
    expect(run).toMatchObject({ status: "completed" });
    expect(required("read_file")).toContain("purpose");
    expect(required("finish_specialist")).not.toContain("purpose");
    expect(inspected).toEqual([{ path: "x" }, { path: "x" }]);
    expect(loop.snapshot().tasks[0]?.actions?.[0]).toMatchObject({
      description: "Check what x says.",
    });
  });

  it("takes a specialist's report as one text, and answers a finish without one so it can try again", async () => {
    const requests: ModelRequest[] = [];
    const loop = delegatingLoop({
      specialist: (round, _tools, _messages, request) => {
        requests.push(request);
        return round === 1
          ? [
              {
                ...finishes(""),
                argumentsDelta: JSON.stringify({ report: " " }),
              },
            ]
          : [finishes("## Findings\n\n- x says seen.")];
      },
    });

    const run = await settled(loop);

    expect(run).toMatchObject({
      status: "completed",
      handoff: { report: "## Findings\n\n- x says seen." },
    });
    expect(
      requests[0]?.tools?.find((tool) => tool.name === "finish_specialist")
        ?.inputSchema,
    ).toEqual({
      type: "object",
      properties: { report: expect.objectContaining({ type: "string" }) },
      required: ["report"],
      additionalProperties: false,
    });
    expect(JSON.stringify(requests[1]?.messages)).toContain(
      "Call finish_specialist again with your whole report",
    );
  });

  it("fails a specialist that sends no usable report four times in a row", async () => {
    let rounds = 0;
    const loop = delegatingLoop({
      specialist: () => {
        rounds += 1;
        return [
          {
            ...finishes(""),
            argumentsDelta: JSON.stringify({ summary: "The old shape." }),
          },
        ];
      },
    });

    const run = await settled(loop);

    expect(rounds).toBe(4);
    expect(run).toMatchObject({
      status: "failed",
      reason: "The specialist did not send a usable report.",
    });
  });

  it("gives a specialist no second try at a report once its budget is spent", async () => {
    let rounds = 0;
    const loop = delegatingLoop({
      specialistWorkLimits: {
        maximumElapsedMs: 60_000,
        maximumProviderCostUsd: 10,
        maximumToolRounds: 1,
      },
      specialist: (round, tools) => {
        rounds += 1;
        return tools.length === 1
          ? [{ ...finishes(""), argumentsDelta: "{}" }]
          : [readsAFile(round)];
      },
    });

    const run = await settled(loop);

    expect(rounds).toBe(2);
    expect(run).toMatchObject({
      status: "interrupted",
      reason: expect.stringContaining("did not report"),
    });
  });

  it("tells a specialist its work budget is spent in Zhiyin's voice, never the person's", async () => {
    let wrapUp: ModelRequest | undefined;
    const loop = delegatingLoop({
      specialistWorkLimits: {
        maximumElapsedMs: 60_000,
        maximumProviderCostUsd: 10,
        maximumToolRounds: 1,
      },
      specialist: (round, tools, _messages, request) => {
        if (tools.length > 1) return [readsAFile(round)];
        wrapUp = request;
        return [finishes("Partial.")];
      },
    });

    await settled(loop);

    expect(notices(wrapUp, "wrapUp")).toEqual([
      expect.objectContaining({
        content: expect.stringContaining("work budget is used up"),
      }),
    ]);
    expect(
      wrapUp?.messages.filter(
        (message) =>
          message.role === "user" &&
          !String(message.content).startsWith("<zhiyin-notice"),
      ),
    ).toEqual([]);
  });

  /** A 40,000-token model: a medium budget of 22,000, and 1,100 for one result. */
  const smallModel = {
    model: "small",
    contextWindow: 40_000,
    maximumOutputTokens: 16_000,
  };

  it("cuts what a tool answers a specialist to the share of the conversation's budget one result may take", async () => {
    let second: ModelRequest | undefined;
    const loop = delegatingLoop({
      modelWindow: smallModel,
      answer: () => "start " + "x".repeat(60_000) + " end",
      specialist: (round, _tools, _messages, request) => {
        if (round === 1) return [readsAFile(round)];
        second = request;
        return [finishes("Read.")];
      },
    });

    await settled(loop);

    const answer = String(
      second?.messages.find((message) => message.role === "tool")?.content,
    );
    expect(answer).toContain("saved as output://");
    expect(estimatedTokens(answer)).toBeLessThanOrEqual(1_250);
  });

  it("tells each of a specialist's calls what is left of its round's room", async () => {
    const told: (number | undefined)[] = [];
    const text = "y".repeat(3_000);
    const loop = delegatingLoop({
      modelWindow: smallModel,
      answer: () => text,
      told: (answerTokens) => told.push(answerTokens),
      specialist: (round) =>
        round === 1
          ? [0, 1, 2, 3].map((index) => ({
              kind: "toolCallDelta" as const,
              index,
              callId: `read-1-${index}`,
              name: "read_file",
              argumentsDelta: JSON.stringify({ path: `x${index}` }),
            }))
          : [finishes("Read.")],
    });

    await settled(loop);

    // A 22,000-token budget: 1,100 for one answer, 3,300 for the round, and
    // the fourth is told what the first three left.
    const each = estimatedTokens(JSON.stringify({ ok: true, value: text }));
    expect(told).toEqual([1_100, 1_100, 1_100, 3_300 - 3 * each]);
  });

  it("tells a specialist's call the room left beside the note Zhiyin sends with its answer", async () => {
    const told: (number | undefined)[] = [];
    const loop = delegatingLoop({
      modelWindow: smallModel,
      told: (answerTokens) => told.push(answerTokens),
      specialist: (round) =>
        round === 1
          ? [
              {
                kind: "toolCallDelta" as const,
                index: 0,
                callId: "read-1",
                name: "read_file",
                // A trailing comma Zhiyin corrects, and says so beside it.
                argumentsDelta: '{"path":"x",}',
              },
            ]
          : [finishes("Read.")],
    });

    await settled(loop);

    expect(told).toHaveLength(1);
    expect(told[0]).toBeLessThan(1_100);
    expect(told[0]).toBeGreaterThan(1_020);
  });

  it("asks a specialist to report before its request would pass the conversation's budget", async () => {
    const requests: ModelRequest[] = [];
    const loop = delegatingLoop({
      modelWindow: smallModel,
      // About 1,000 tokens each, within what one result may take.
      answer: () => "y".repeat(3_000),
      specialist: (_round, tools, _messages, request) => {
        requests.push(request);
        return tools.length === 1
          ? [finishes("What fitted.")]
          : [readsAFile(requests.length)];
      },
    });

    const run = await settled(loop);

    expect(run).toMatchObject({
      status: "completed",
      handoff: { report: "What fitted." },
    });
    const last = requests.at(-1)!;
    expect(last.tools?.map((tool) => tool.name)).toEqual(["finish_specialist"]);
    expect(notices(last, "wrapUp")).toEqual([
      expect.objectContaining({
        content: expect.stringContaining("conversation's context budget"),
      }),
    ]);
    // Never past the budget, the request asking for the report included:
    // the results it already read are put aside for it.
    for (const request of requests)
      expect(
        estimatedTokens(JSON.stringify(request.messages)) +
          estimatedTokens(JSON.stringify(request.tools)),
      ).toBeLessThan(22_000);
    // Only the oldest are set aside; the newest stays for the report.
    const results = last.messages
      .filter((message) => message.role === "tool")
      .map((message) => String(message.content));
    expect(results[0]).toContain("set aside");
    expect(results.at(-1)).toContain("yyyy");
    // What stands in for a result names no tool it has no longer.
    expect(
      results.filter((result) => result.includes("set aside")).join(""),
    ).not.toContain("read_file");
  });

  it("fits the request for a specialist's report to the budget when its work budget is spent", async () => {
    const requests: ModelRequest[] = [];
    const loop = delegatingLoop({
      modelWindow: { ...smallModel, reasoningSentBack: true },
      specialistWorkLimits: {
        maximumElapsedMs: 60_000,
        maximumProviderCostUsd: 10,
        maximumToolRounds: 2,
      },
      answer: () => "y".repeat(3_000),
      specialist: (round, tools, _messages, request) => {
        requests.push(request);
        if (tools.length === 1) return [finishes("What fitted.")];
        return [
          // Its second round reasons at length: about 18,000 tokens.
          ...(round === 2
            ? [{ kind: "reasoningDelta" as const, text: "z".repeat(54_000) }]
            : []),
          readsAFile(round),
        ];
      },
    });

    const run = await settled(loop);

    expect(run).toMatchObject({
      status: "completed",
      handoff: { report: "What fitted." },
    });
    const last = requests.at(-1)!;
    expect(notices(last, "wrapUp")).toEqual([
      expect.objectContaining({
        content: expect.stringContaining("work budget is used up"),
      }),
    ]);
    expect(
      estimatedTokens(JSON.stringify(last.messages)) +
        estimatedTokens(JSON.stringify(last.tools)),
    ).toBeLessThan(22_000);
    expect(JSON.stringify(last.messages)).toContain("set aside");
  });

  it("counts the reasoning a specialist's rounds send back toward the budget", async () => {
    const requests: ModelRequest[] = [];
    const loop = delegatingLoop({
      modelWindow: { ...smallModel, reasoningSentBack: true },
      specialist: (_round, tools, _messages, request) => {
        requests.push(request);
        if (tools.length === 1) return [finishes("What fitted.")];
        return [
          // About 1,500 tokens of reasoning a round, sent back with it.
          { kind: "reasoningDelta" as const, text: "z".repeat(4_500) },
          readsAFile(requests.length),
        ];
      },
    });

    const run = await settled(loop);

    expect(run).toMatchObject({ status: "completed" });
    expect(requests.at(-1)?.tools?.map((tool) => tool.name)).toEqual([
      "finish_specialist",
    ]);
    const size = (request: ModelRequest) =>
      estimatedTokens(JSON.stringify(request.messages)) +
      estimatedTokens(JSON.stringify(request.tools));
    for (const request of requests.slice(0, -1))
      expect(size(request)).toBeLessThan(22_000);
    // Asking for the report adds its last round's reasoning, never past the
    // window less the room kept for the reply.
    expect(size(requests.at(-1)!)).toBeLessThan(24_000);
  });

  it("plans a specialist's next request from the provider's count of its last one", async () => {
    const offered: (readonly string[])[] = [];
    const requests: ModelRequest[] = [];
    const loop = delegatingLoop({
      modelWindow: smallModel,
      answer: () => "y".repeat(3_000),
      specialist: (round, tools, _messages, request) => {
        offered.push(tools);
        requests.push(request);
        if (tools.length === 1) return [finishes("What fitted.")];
        return [
          readsAFile(round),
          // Far more than the estimate of so short a request.
          {
            kind: "usage" as const,
            usage: {
              requestId: "r",
              model: "small",
              inputTokens: 21_990,
              outputTokens: 10,
              totalTokens: 22_000,
            },
          },
        ];
      },
    });

    const run = await settled(loop);

    expect(run).toMatchObject({
      status: "completed",
      handoff: { report: "What fitted." },
    });
    expect(offered).toHaveLength(2);
    expect(offered[1]).toEqual(["finish_specialist"]);
    // Fitted by the count too: far under the budget by its estimate alone,
    // the request for the report still sets its result aside.
    expect(
      requests[1]?.messages.find((message) => message.role === "tool")?.content,
    ).toContain("set aside");
  });

  const tooLong = () =>
    new ModelClientError(
      "contextExceeded",
      "The request is too large for the selected model.",
      {},
    );

  it("asks a specialist to report when a request of its is refused as too long", async () => {
    const offered: (readonly string[])[] = [];
    const loop = delegatingLoop({
      refuses: (round) => (round === 2 ? tooLong() : undefined),
      specialist: (round, tools) => {
        offered.push(tools);
        return tools.length === 1
          ? [finishes("What I had.")]
          : [readsAFile(round)];
      },
    });

    const run = await settled(loop);

    expect(run).toMatchObject({
      status: "completed",
      handoff: { report: "What I had." },
    });
    expect(offered.at(-1)).toEqual(["finish_specialist"]);
  });

  it("puts a specialist's results aside before asking for its report after a refusal, and plans with the smaller window", async () => {
    const requests: ModelRequest[] = [];
    let window: (() => ModelWindow) | undefined;
    const loop = delegatingLoop({
      modelWindow: { ...smallModel, contextWindow: 400_000 },
      answer: () => "y".repeat(3_000),
      onHost: (host) => {
        window = () => host.modelWindow();
      },
      refuses: (round) =>
        round === 3
          ? new ModelClientError("contextExceeded", "Too long.", {
              tokens: { limit: 2_000, sent: 2_500 },
            })
          : undefined,
      specialist: (round, tools, _messages, request) => {
        requests.push(request);
        return tools.length === 1
          ? [finishes("What I had.")]
          : [readsAFile(round)];
      },
    });

    const run = await settled(loop);

    expect(run).toMatchObject({
      status: "completed",
      handoff: { report: "What I had." },
    });
    const results = (request: ModelRequest | undefined) =>
      (request?.messages ?? [])
        .filter((message) => message.role === "tool")
        .map((message) => String(message.content));
    // The two results it had read go back as saved copies it was told of.
    expect(results(requests.at(-1))).toEqual([
      expect.stringContaining("output://"),
      expect.stringContaining("output://"),
    ]);
    expect(results(requests.at(-1)).join("")).not.toContain("yyyy");
    expect(results(requests.at(-1)).join("")).not.toContain("read_file");
    expect(window?.().contextWindow).toBe(2_000);
  });

  it("fits a request for a specialist's report again, once, when it is refused as too long", async () => {
    const requests: ModelRequest[] = [];
    const loop = delegatingLoop({
      modelWindow: smallModel,
      answer: () => "y".repeat(3_000),
      refuses: (round) =>
        round === 3
          ? new ModelClientError("contextExceeded", "Too long.", {
              tokens: { limit: 39_000 },
            })
          : round === 4
            ? new ModelClientError("contextExceeded", "Too long.", {
                tokens: { limit: 2_000 },
              })
            : undefined,
      specialist: (round, tools, _messages, request) => {
        requests.push(request);
        return tools.length === 1
          ? [finishes("What I had.")]
          : [readsAFile(round)];
      },
    });

    const run = await settled(loop);

    expect(run).toMatchObject({
      status: "completed",
      handoff: { report: "What I had." },
    });
    const results = (requests.at(-1)?.messages ?? [])
      .filter((message) => message.role === "tool")
      .map((message) => String(message.content));
    expect(results).toEqual([
      expect.stringContaining("set aside"),
      expect.stringContaining("set aside"),
    ]);
  });

  it("fits the request for a specialist's report by the size a refusal says was sent, where the window it states is no smaller", async () => {
    const requests: ModelRequest[] = [];
    const loop = delegatingLoop({
      modelWindow: smallModel,
      answer: () => "y".repeat(3_000),
      // Counted far above its estimate, at a limit no lower than the window.
      refuses: (round) =>
        round === 4
          ? new ModelClientError("contextExceeded", "Too long.", {
              tokens: { limit: 40_000, sent: 30_000 },
            })
          : undefined,
      specialist: (round, tools, _messages, request) => {
        requests.push(request);
        return tools.length === 1
          ? [finishes("What I had.")]
          : [readsAFile(round)];
      },
    });

    const run = await settled(loop);

    expect(run).toMatchObject({
      status: "completed",
      handoff: { report: "What I had." },
    });
    const results = (requests.at(-1)?.messages ?? [])
      .filter((message) => message.role === "tool")
      .map((message) => String(message.content));
    expect(results[0]).toContain("set aside");
  });

  it("lowers the window from a refused request for the report as the provider would count it, not from the estimate alone", async () => {
    let window: (() => ModelWindow) | undefined;
    const loop = delegatingLoop({
      modelWindow: smallModel,
      answer: () => "y".repeat(3_000),
      onHost: (host) => {
        window = () => host.modelWindow();
      },
      // Its request for the report is refused, saying nothing of its size.
      refuses: (round) => (round === 2 ? tooLong() : undefined),
      specialist: (round, tools) =>
        tools.length === 1
          ? [finishes("What I had.")]
          : [
              readsAFile(round),
              // Counted far above the estimate of so short a request.
              {
                kind: "usage" as const,
                usage: {
                  requestId: "r",
                  model: "small",
                  inputTokens: 21_990,
                  outputTokens: 10,
                  totalTokens: 22_000,
                },
              },
            ],
    });

    await settled(loop);

    // Nine tenths of what the provider would have counted, not of the few
    // thousand tokens its bytes come to.
    expect(window?.().contextWindow).toBeGreaterThan(10_000);
    expect(window?.().contextWindow).toBeLessThan(40_000);
  });

  it("fits the request for a specialist's report by the provider's last count, after an answered call was withdrawn from it", async () => {
    const requests: ModelRequest[] = [];
    const counted = (inputTokens: number) => ({
      kind: "usage" as const,
      usage: {
        requestId: "r",
        model: "small",
        inputTokens,
        outputTokens: 10,
        totalTokens: inputTokens + 10,
      },
    });
    const loop = delegatingLoop({
      modelWindow: smallModel,
      specialistWorkLimits: {
        maximumElapsedMs: 60_000,
        maximumProviderCostUsd: 10,
        maximumToolRounds: 3,
      },
      answer: () => "y".repeat(3_000),
      specialist: (round, tools, _messages, request) => {
        requests.push(request);
        if (tools.length === 1) return [finishes("What fitted.")];
        // Its second call arrives cut off and is answered so it can send it
        // again; the third, which works, withdraws that exchange.
        if (round === 2)
          return [
            { ...readsAFile(round), argumentsDelta: '{"path": "x"' },
            counted(15_000),
          ];
        return [readsAFile(round), counted(round === 3 ? 30_000 : 15_000)];
      },
    });

    const run = await settled(loop);

    expect(run).toMatchObject({
      status: "completed",
      handoff: { report: "What fitted." },
    });
    expect(JSON.stringify(requests.at(-1)?.messages)).toContain("set aside");
  });

  it("fits the request for a specialist's report, which offers no other tool, as if the tools its count included cost nothing", async () => {
    const requests: ModelRequest[] = [];
    const loop = delegatingLoop({
      modelWindow: smallModel,
      // A tool estimated at about 15,000 tokens, which the count may have
      // put at far less.
      toolDescription: "Read one project file. ".repeat(2_000),
      specialistWorkLimits: {
        maximumElapsedMs: 60_000,
        maximumProviderCostUsd: 10,
        maximumToolRounds: 2,
      },
      answer: () => "y".repeat(3_000),
      specialist: (round, tools, _messages, request) => {
        requests.push(request);
        if (tools.length === 1) return [finishes("What fitted.")];
        return [
          readsAFile(round),
          {
            kind: "usage" as const,
            usage: {
              requestId: "r",
              model: "small",
              inputTokens: 18_000,
              outputTokens: 10,
              totalTokens: 18_010,
            },
          },
        ];
      },
    });

    const run = await settled(loop);

    expect(run).toMatchObject({
      status: "completed",
      handoff: { report: "What fitted." },
    });
    expect(JSON.stringify(requests.at(-1)?.messages)).toContain("set aside");
  });

  it("says a refused request of a specialist's was the size the provider counted, where its count stands under it", async () => {
    let window:
      (() => ModelWindow & { readonly refusedTokens?: number }) | undefined;
    const loop = delegatingLoop({
      modelWindow: smallModel,
      // Tools estimated at about 15,000 tokens, which must not be counted
      // twice in the size said to be refused.
      toolDescription: "Read one project file. ".repeat(2_000),
      answer: () => "y".repeat(3_000),
      onHost: (host) => {
        window = () => host.modelWindow();
      },
      refuses: (round) => (round === 2 ? tooLong() : undefined),
      specialist: (round, tools) =>
        tools.length === 1
          ? [finishes("What I had.")]
          : [
              readsAFile(round),
              {
                kind: "usage" as const,
                usage: {
                  requestId: "r",
                  model: "small",
                  inputTokens: 10_000,
                  outputTokens: 10,
                  totalTokens: 10_010,
                },
              },
            ],
    });

    await settled(loop);

    // The count of the request before, and the one result added since.
    expect(window?.().refusedTokens).toBeGreaterThan(10_000);
    expect(window?.().refusedTokens).toBeLessThan(12_500);
  });

  it("saves only the results it sets aside, none too short to gain from it", async () => {
    const kept: string[] = [];
    const loop = delegatingLoop({
      modelWindow: smallModel,
      onKeep: (text) => kept.push(text),
      specialist: (round, tools) =>
        tools.length === 1
          ? [finishes("What fitted.")]
          : [
              readsAFile(round),
              {
                kind: "usage" as const,
                usage: {
                  requestId: "r",
                  model: "small",
                  inputTokens: 30_000,
                  outputTokens: 10,
                  totalTokens: 30_010,
                },
              },
            ],
    });

    const run = await settled(loop);

    expect(run).toMatchObject({ status: "completed" });
    // Its one result, "seen", is shorter than anything that could stand in
    // for it.
    expect(kept).toEqual([]);
  });

  it("fails a specialist whose request to report is refused as too long as well, once nothing is left to set aside", async () => {
    let asked = 0;
    const loop = delegatingLoop({
      answer: () => "y".repeat(3_000),
      refuses: (round) => {
        asked = round;
        return round >= 2 ? tooLong() : undefined;
      },
      specialist: (round) => [readsAFile(round)],
    });

    const run = await settled(loop);

    expect(run).toMatchObject({
      status: "failed",
      reason: "The request is too large for the selected model.",
    });
    // Its first request, then the request for the report, refused; what
    // stands in for its one result is never set aside again.
    expect(asked).toBe(3);
  });

  it("lets go of a specialist whose end cannot be saved, so nothing is left running", async () => {
    const loop = delegatingLoop({
      specialist: () => [finishes("Read it.")],
      refusesSaving: (task) =>
        task.specialistRuns.some((run) => run.status !== "running"),
    });
    const taskId = await loop.createTask(["engineering"]);

    await loop.start(taskId, "Review this change");
    await until(
      () =>
        loop.snapshot().tasks[0]?.phase.kind === "completed" &&
        loop.snapshot().tasks[0]?.specialistRuns.length === 1,
    );

    await until(() => !loop.anyRunning());
    expect(loop.running(taskId)).toBe(false);
  });

  it("answers a specialist that finishes in the same breath as another call, and takes its report once it finishes alone", async () => {
    let secondRequest = "";
    const loop = delegatingLoop({
      specialist: (round, _tools, messages) => {
        if (round === 1)
          return [readsAFile(round), { ...finishes("Too early."), index: 1 }];
        secondRequest = messages;
        return [finishes("Read x: it says seen.")];
      },
    });

    const run = await settled(loop);

    expect(run).toMatchObject({
      status: "completed",
      handoff: { report: "Read x: it says seen." },
    });
    // The read it asked for was carried out, and the early finish answered.
    expect(secondRequest).toContain("seen");
    expect(secondRequest).toContain("finish_specialist on its own");
    expect(loop.snapshot().tasks[0]?.actions).toEqual([
      expect.objectContaining({ status: "completed" }),
    ]);
  });

  it("sends a specialist's own reasoning back with its next request, as some providers require", async () => {
    let second: ModelRequest | undefined;
    const loop = delegatingLoop({
      specialist: (round, _tools, _messages, request) => {
        if (round === 1)
          return [
            { kind: "reasoningDelta", text: "I should read x first." },
            readsAFile(round),
          ];
        second = request;
        return [finishes("Read x: it says seen.")];
      },
    });

    await settled(loop);

    expect(second?.messages).toContainEqual(
      expect.objectContaining({
        role: "assistant",
        reasoning: "I should read x first.",
        toolCalls: [expect.objectContaining({ name: "read_file" })],
      }),
    );
  });

  it("takes a specialist's report once its budget is spent, even with another call beside it", async () => {
    const loop = delegatingLoop({
      specialistWorkLimits: {
        maximumElapsedMs: 60_000,
        maximumProviderCostUsd: 10,
        maximumToolRounds: 1,
      },
      specialist: (round) =>
        round === 1
          ? [readsAFile(round)]
          : [readsAFile(round), { ...finishes("What I found."), index: 1 }],
    });

    const run = await settled(loop);

    expect(run).toMatchObject({
      status: "completed",
      handoff: { report: "What I found." },
    });
  });

  it("asks for a specialist's answer to be started again should it drop midway, as a turn's is", async () => {
    const restartable: unknown[] = [];
    const loop = delegatingLoop({
      specialist: (_round, _tools, _messages, request) => {
        restartable.push(request.restartable);
        return [finishes("Done.")];
      },
    });

    await settled(loop);

    expect(restartable).toEqual([true]);
  });

  it("takes a specialist's report from the answer that followed a restart, and nothing of the attempt it replaced", async () => {
    const loop = delegatingLoop({
      specialist: () => [
        { kind: "textDelta", text: "I will rep" },
        {
          kind: "toolCallDelta",
          index: 0,
          callId: "finish",
          name: "finish_specialist",
          argumentsDelta: '{"summary":"Half a rep',
        },
        // The connection dropped mid-answer: what came before is void.
        {
          kind: "restarting",
          restart: 1,
          maximumRestarts: 2,
          delayMs: 0,
          reason: "networkFailure",
          message: "The connection dropped.",
        },
        { kind: "textDelta", text: "Reporting now." },
        finishes("The whole report."),
      ],
    });

    const run = await settled(loop);

    expect(run).toMatchObject({
      status: "completed",
      handoff: { report: "The whole report." },
    });
    // What a specialist says while it works is its own: none of it is shown
    // as the conversation's answer, before the restart or after.
    const said = loop
      .snapshot()
      .tasks[0]?.messages.map((message) => message.text)
      .join("\n");
    expect(said).not.toContain("I will rep");
    expect(said).not.toContain("Reporting now.");
  });

  it("keeps a specialist's card where it was delegated, ahead of everything that came after", async () => {
    const loop = delegatingLoop({
      specialist: (round) =>
        round === 1 ? [readsAFile(round)] : [finishes("Done.")],
    });

    await settled(loop);
    const task = loop.snapshot().tasks[0]!;
    const run = task.specialistRuns![0]!;
    const later = [
      ...task.messages.filter((message) => message.text === "Noted."),
      ...(task.actions ?? []),
    ];

    expect(run.sequence).toEqual(expect.any(Number));
    expect(later.length).toBeGreaterThan(1);
    for (const item of later)
      expect(item.sequence).toBeGreaterThan(run.sequence!);
  });

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
      handoff: { report: "Partial: two files read." },
    });
    // Only the way out is on offer once the budget is spent.
    expect(offered.at(-1)).toEqual(["finish_specialist"]);
    expect(wrapUp).toContain("work budget is used up");
  });

  /** Reasoning the loop counts as about 200 tokens, past a limit of 100. */
  const reasonsAtLength: ModelEvent = {
    kind: "reasoningDelta",
    text: "x".repeat(200 * 4.5),
  };

  it("stops a specialist that reasons at length without acting, and asks it once to decide with the least reasoning", async () => {
    const requests: ModelRequest[] = [];
    const loop = delegatingLoop({
      longestThoughtTokens: 100,
      leastReasoning: { enabled: false },
      specialist: (round, _tools, _messages, request) => {
        requests.push(request);
        return round === 1 ? [reasonsAtLength] : [finishes("Decided.")];
      },
    });

    const run = await settled(loop);

    expect(run).toMatchObject({
      status: "completed",
      handoff: { report: "Decided." },
    });
    expect(requests).toHaveLength(2);
    expect(requests[0]?.reasoning).toBeUndefined();
    expect(requests[1]?.reasoning).toEqual({ enabled: false });
    const told = notices(requests[1], "thinking");
    expect(told).toHaveLength(1);
    // It has no person to ask: it is told its own ways out.
    expect(told[0]?.content).toContain(
      "call a tool, or call finish_specialist with what you have found",
    );
    expect(told[0]?.content).not.toContain("ask the person");
  });

  it("settles a specialist stopped twice in a row for reasoning at length as failed, saying why", async () => {
    const requests: ModelRequest[] = [];
    const loop = delegatingLoop({
      longestThoughtTokens: 100,
      leastReasoning: { enabled: true, effort: "low" },
      specialist: (_round, _tools, _messages, request) => {
        requests.push(request);
        return [reasonsAtLength];
      },
    });

    const run = await settled(loop);

    expect(requests.map((request) => request.reasoning)).toEqual([
      undefined,
      { enabled: true, effort: "low" },
    ]);
    expect(run).toMatchObject({
      status: "failed",
      reason:
        "The model kept reasoning without answering or acting, and was stopped twice.",
    });
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

  it("says an error of Zhiyin's own that stops a specialist is Zhiyin's, keeps its cause out of the conversation, and records it", async () => {
    const thrown = new TypeError("Cannot read properties of undefined");
    const kept: { taskId: string; error: unknown }[] = [];
    const loop = delegatingLoop({
      specialist: (round) => [readsAFile(round)],
      decide: async () => {
        throw thrown;
      },
      recordDefect: (defect) => kept.push(defect),
    });

    const run = await settled(loop);

    expect(run).toMatchObject({
      status: "failed",
      reason:
        "Zhiyin stopped on an error of its own while this specialist was working.",
    });
    expect(JSON.stringify(loop.snapshot())).not.toContain(
      "Cannot read properties",
    );
    expect(kept).toEqual([
      { taskId: loop.snapshot().tasks[0]?.id, error: thrown },
    ]);
  });

  it("keeps a specialist's own account of why it stopped, and records no error of Zhiyin's for it", async () => {
    const kept: unknown[] = [];
    const loop = delegatingLoop({
      // It answers in words and reports nothing.
      specialist: () => [{ kind: "textDelta", text: "All good." }],
      recordDefect: (defect) => kept.push(defect),
    });

    const run = await settled(loop);

    expect(run).toMatchObject({
      status: "failed",
      reason: "The specialist stopped without reporting.",
    });
    expect(kept).toEqual([]);
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
                    report: "Nothing was read.",
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
    expect(specialistRequests[1]).toContain("never closed");
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
                    report: "Read.",
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
