/**
 * What each answer cost, who served it and when, kept with the conversation
 * for whoever audits it later. Nothing of it is shown in the conversation.
 */

import { describe, expect, it } from "vitest";
import type { ToolCallInspection } from "@zhiyin/contract";
import type { ModelRequest } from "@zhiyin/model-client";
import { loopFrom, stubDependencies } from "./support.js";

/** A clock that moves a second each time it is read. */
function ticking() {
  let second = 0;
  return () => new Date(Date.UTC(2026, 9, 2, 9, 0, second++));
}

describe("what is kept about each answer", () => {
  it("keeps the upstream, the times and the usage of each, so two upstreams stay apart", async () => {
    const providers = ["Fireworks", "Together"];
    let turn = 0;
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      now: ticking(),
      model: {
        ...deps.model,
        send: async function* () {
          const provider = providers[turn++]!;
          yield { kind: "reasoningDelta" as const, text: "Thinking." };
          yield { kind: "textDelta" as const, text: "Answer." };
          yield {
            kind: "usage" as const,
            usage: {
              requestId: `gen-${turn}`,
              model: "z-ai/glm-5.3",
              provider,
              inputTokens: 100,
              outputTokens: 20,
              totalTokens: 120,
              reasoningTokens: 8,
              cacheReadTokens: 64,
              costUsd: 0.0004,
            },
          };
          yield {
            kind: "done" as const,
            finishReason: "stop",
            response: {
              requestId: `gen-${turn}`,
              model: "z-ai/glm-5.3",
              provider,
              finishReason: "stop",
              termination: "finishReason" as const,
              complete: true,
            },
          };
        },
      },
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "First question");
    await loop.start(taskId, "Second question");

    const responses = loop.snapshot().tasks[0]?.modelResponses ?? [];
    expect(responses.map((response) => response.provider)).toEqual([
      "Fireworks",
      "Together",
    ]);
    for (const response of responses) {
      expect(response.usage).toEqual({
        inputTokens: 100,
        outputTokens: 20,
        reasoningTokens: 8,
        cacheReadTokens: 64,
        costUsd: 0.0004,
      });
      const started = Date.parse(response.startedAt ?? "");
      const firstToken = Date.parse(response.firstTokenAt ?? "");
      const finished = Date.parse(response.finishedAt ?? "");
      expect(started).toBeLessThan(firstToken);
      expect(firstToken).toBeLessThan(finished);
    }
  });

  it("keeps when an action started running and when it finished", async () => {
    let turn = 0;
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      now: ticking(),
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
        execute: async () => ({ ok: true as const, value: { exitCode: 0 } }),
      },
      permissions: {
        decide: async () => ({ outcome: "allow" as const, reason: "Approved" }),
      },
      model: {
        ...deps.model,
        send: async function* (request: ModelRequest) {
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
        },
      },
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Convert it");

    const [action] = loop.snapshot().tasks[0]?.actions ?? [];
    expect(action?.status).toBe("completed");
    expect(Date.parse(action?.startedAt ?? "")).toBeLessThan(
      Date.parse(action?.finishedAt ?? ""),
    );
  });
});
