/**
 * A model's turn goes back to it with its reasoning and whatever its provider
 * needs to continue from it (ADR 0024): kept beside the turn's words, never in
 * them, and the same after the app restarts.
 */

import { describe, expect, it } from "vitest";
import type { ModelReplay, WorkspaceTask } from "@zhiyin/contract";
import type {
  ModelEvent,
  ModelMessage,
  ModelRequest,
} from "@zhiyin/model-client";
import {
  loopAndHost,
  loopFrom,
  stubDependencies,
  type LoopTestDependencies,
} from "./support.js";
import { sharedPrefix } from "./request-prefix.js";

const readReplay: ModelReplay = {
  provider: "test-provider",
  format: "test-format",
  data: { signed: "after-reading" },
};
const answerReplay: ModelReplay = {
  provider: "test-provider",
  format: "test-format",
  data: { signed: "after-answering" },
};

/**
 * A model that reads a note once after each message the person sends, then
 * answers; it thinks before each, and its provider hands back a replay record.
 */
async function* readsThenAnswers(
  request: ModelRequest,
): AsyncIterable<ModelEvent> {
  const last = request.messages.at(-1);
  if (last?.role !== "tool") {
    yield { kind: "reasoningDelta", text: "Read the note first." };
    yield {
      kind: "toolCallDelta",
      index: 0,
      callId: `call-${request.messages.length}`,
      name: "read_note",
      argumentsDelta: "{}",
    };
    yield { kind: "done", finishReason: "tool_calls", replay: readReplay };
    return;
  }
  yield { kind: "reasoningDelta", text: "The note answers it." };
  yield { kind: "textDelta", text: "The answer." };
  yield { kind: "done", finishReason: "stop", replay: answerReplay };
}

function withNoteTool(
  requests: ModelMessage[][],
  deps: LoopTestDependencies = stubDependencies(() => {}),
): LoopTestDependencies {
  return {
    ...deps,
    tools: {
      list: () => [
        {
          name: "read_note",
          description: "Reads the note.",
          inputSchema: { type: "object" },
        },
      ],
      inspect: async () => ({
        ok: true,
        action: "Read the note",
        target: "note",
        command: "read_note({})",
        access: "read",
        scope: "workspace",
      }),
      execute: async () => ({ ok: true, value: "The note." }),
    },
    permissions: {
      decide: async () => ({ outcome: "allow" as const, reason: "Allowed" }),
    },
    model: {
      ...deps.model,
      send: (request) => {
        requests.push([...request.messages]);
        return readsThenAnswers(request);
      },
    },
  };
}

const assistantTurns = (messages: readonly ModelMessage[]) =>
  messages.filter((message) => message.role === "assistant");

describe("a model's turn sent back to it", () => {
  it("carries a round's reasoning and replay record with that round's calls", async () => {
    const requests: ModelMessage[][] = [];
    const loop = loopFrom(withNoteTool(requests));
    const taskId = await loop.createTask();

    await loop.start(taskId, "What does the note say?");

    expect(assistantTurns(requests[1] ?? [])).toEqual([
      expect.objectContaining({
        content: "",
        toolCalls: [expect.objectContaining({ name: "read_note" })],
        reasoning: "Read the note first.",
        replay: readReplay,
      }),
    ]);
  });

  it("carries a final answer's reasoning and replay record into the next turn, and after the app restarts", async () => {
    const before: ModelMessage[][] = [];
    const deps = stubDependencies(() => {});
    const first = loopFrom(withNoteTool(before, deps));
    const taskId = await first.createTask();
    await first.start(taskId, "What does the note say?");
    await first.start(taskId, "And now?");

    const answer = expect.objectContaining({
      content: "The answer.",
      reasoning: "The note answers it.",
      replay: answerReplay,
    });
    expect(assistantTurns(before[2] ?? [])).toContainEqual(answer);

    const after: ModelMessage[][] = [];
    const { host } = loopAndHost(withNoteTool(after, deps));
    host.restore(
      JSON.parse(JSON.stringify(first.snapshot().tasks)) as WorkspaceTask[],
    );
    await host.app.start(taskId, "Once more?");

    const lastBefore = before.at(-1) ?? [];
    expect(sharedPrefix(lastBefore, after[0] ?? [])).toBe(lastBefore.length);
    expect(assistantTurns(after[0] ?? [])).toContainEqual(answer);
  });
});
