import { describe, expect, it } from "vitest";
import { emptyConversationLists, type WorkspaceTask } from "@zhiyin/contract";
import type { ModelEvent, ModelRequest } from "@zhiyin/model-client";
import {
  loopAndHost,
  pluginOffering,
  pluginsOffering,
  stubDependencies,
  until,
} from "./support.js";

/** What every request reports, as the provider would. */
function usage(requestId: string): ModelEvent {
  return {
    kind: "usage",
    usage: {
      requestId,
      model: "test/model",
      inputTokens: 10,
      outputTokens: 2,
      totalTokens: 12,
      costUsd: 0.001,
    },
  };
}

/** Each recorded request's conversation and purpose. */
function attributed(recorded: readonly unknown[]) {
  return recorded.map((entry) => {
    const { conversationId, purpose } = entry as Record<string, unknown>;
    return { conversationId, purpose };
  });
}

let requestNumber = 0;

describe("what a request's usage is recorded against", () => {
  it("names the conversation, and a turn apart from the work that names it", async () => {
    const deps = stubDependencies(() => {});
    const { host } = loopAndHost({
      ...deps,
      model: {
        ...deps.model,
        send: async function* () {
          yield { kind: "textDelta" as const, text: "Answered." };
          yield usage(`turn-${++requestNumber}`);
          yield { kind: "done" as const };
        },
      },
      guidanceModel: {
        send: async function* () {
          yield { kind: "textDelta" as const, text: '{"title":"A name"}' };
          yield usage(`name-${++requestNumber}`);
          yield { kind: "done" as const };
        },
      },
    });
    const taskId = await host.app.createTask();

    await host.app.start(taskId, "What is in this folder?");
    await until(() => host.usage.length === 2);

    expect(attributed(host.usage)).toEqual(
      expect.arrayContaining([
        { conversationId: taskId, purpose: "turn" },
        { conversationId: taskId, purpose: "background" },
      ]),
    );
  });

  it("records a condensing against the conversation it condensed", async () => {
    const deps = stubDependencies(() => {});
    const { host } = loopAndHost({
      ...deps,
      modelWindow: {
        model: "small",
        contextWindow: 16_000,
        maximumOutputTokens: 100,
      },
      model: {
        ...deps.model,
        send: async function* () {
          yield {
            kind: "textDelta" as const,
            text: JSON.stringify({ summary: "The older material was read." }),
          };
          yield usage(`condense-${++requestNumber}`);
          yield { kind: "done" as const };
        },
      },
    });
    const settled: WorkspaceTask = {
      id: "task-1",
      title: "Release discussion",
      titleSource: "manual",
      updatedLabel: "Earlier",
      updatedAt: "2026-10-05T09:00:00.000Z",
      ...emptyConversationLists,
      messages: [
        { id: "m1", role: "user", text: "Read it", sequence: 0 },
        {
          id: "m2",
          role: "assistant",
          text: "OLDER MATERIAL ".repeat(800),
          sequence: 1,
        },
        { id: "m3", role: "user", text: "Next step", sequence: 2 },
        { id: "m4", role: "assistant", text: "Next answer", sequence: 3 },
      ],
      actions: [],
      phase: {
        kind: "completed",
        outcome: { title: "Response complete", summary: "Done." },
      },
    };
    host.app.restore([settled]);

    await host.app.condenseNow("task-1");

    expect(attributed(host.usage)).toEqual([
      { conversationId: "task-1", purpose: "condensing" },
    ]);
  });

  it("records a specialist's requests against the conversation that delegated", async () => {
    const deps = stubDependencies(() => {});
    const { host } = loopAndHost({
      ...deps,
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
      model: {
        ...deps.model,
        send: async function* (request: ModelRequest) {
          const text = JSON.stringify(request.messages);
          if (text.includes("You are the Reviewer specialist"))
            yield {
              kind: "toolCallDelta" as const,
              index: 0,
              callId: "finish-1",
              name: "finish_specialist",
              argumentsDelta: JSON.stringify({
                summary: "Looked.",
                findings: [],
                recommendations: [],
                limitations: [],
              }),
            };
          else if (!text.includes("Review task"))
            yield {
              kind: "toolCallDelta" as const,
              index: 0,
              callId: "delegate-1",
              name: "delegate_specialist",
              argumentsDelta: JSON.stringify({
                id: "engineering/reviewer",
                task: "Review task",
              }),
            };
          else yield { kind: "textDelta" as const, text: "Delegated." };
          yield usage(`request-${++requestNumber}`);
          yield { kind: "done" as const };
        },
      },
    });
    const taskId = await host.app.createTask(["engineering"]);

    await host.app.start(taskId, "Review this");
    await until(
      () =>
        host.app.snapshot().tasks[0]?.specialistRuns?.[0]?.status ===
        "completed",
    );

    expect(attributed(host.usage)).toContainEqual({
      conversationId: taskId,
      purpose: "specialist",
    });
    expect(
      attributed(host.usage).every((entry) => entry.conversationId === taskId),
    ).toBe(true);
  });
});
