/**
 * How much of a tool's answer the model is shown: at most a bounded amount per
 * result and per round, with the whole kept where it can be read again.
 */

import { describe, expect, it } from "vitest";
import { estimatedTokens, type ToolInvocationResult } from "@zhiyin/contract";
import type {
  ModelEvent,
  ModelMessage,
  ModelRequest,
} from "@zhiyin/model-client";
import {
  loopFrom,
  stubDependencies,
  type LoopTestDependencies,
} from "./support.js";

/** A model that makes `calls` calls to `read` in one round, then answers. */
function oneRound(calls: number) {
  return async function* (request: ModelRequest): AsyncIterable<ModelEvent> {
    if (request.messages.some((message) => message.role === "tool"))
      yield { kind: "textDelta", text: "Done." };
    else
      for (let index = 0; index < calls; index += 1)
        yield {
          kind: "toolCallDelta",
          index,
          callId: `call-${index + 1}`,
          name: "read",
          argumentsDelta: "{}",
        };
    yield { kind: "done" };
  };
}

function withTool(
  answer: (call: number) => ToolInvocationResult,
  calls: number,
  requests: ModelMessage[][],
  kept: string[],
): LoopTestDependencies {
  const deps = stubDependencies(() => {});
  let call = 0;
  return {
    ...deps,
    tools: {
      list: () => [
        { name: "read", description: "Read.", inputSchema: { type: "object" } },
      ],
      inspect: async () => ({
        ok: true,
        action: "Read",
        target: "notes",
        command: "read({})",
        access: "read",
        scope: "workspace",
      }),
      execute: async () => answer(++call),
    },
    permissions: {
      decide: async () => ({ outcome: "allow" as const, reason: "Allowed" }),
    },
    sessions: {
      ...deps.sessions,
      keep: async (_kind, _conversationId, source) => {
        if (!("text" in source)) throw new Error("Only text is kept here.");
        kept.push(source.text);
        return {
          status: "kept",
          id: `kept-${kept.length}`,
          bytes: Buffer.byteLength(source.text),
        };
      },
    },
    model: {
      ...deps.model,
      send: (request) => {
        requests.push([...request.messages]);
        return oneRound(calls)(request);
      },
    },
  };
}

function results(messages: readonly ModelMessage[]): string[] {
  return messages.flatMap((message) =>
    message.role === "tool" ? [message.content] : [],
  );
}

/** Lines that say what they are, so the middle of an answer can be found. */
function lines(from: number, count: number): string {
  return Array.from(
    { length: count },
    (_, index) => `line ${from + index} of the report`,
  ).join("\n");
}

describe("a tool's answer the model is shown", () => {
  it("is its start and its end past 8k tokens, with the whole kept to read again", async () => {
    const requests: ModelMessage[][] = [];
    const kept: string[] = [];
    const loop = loopFrom(
      withTool(
        () => ({ ok: true, value: { text: lines(1, 5_000) } }),
        1,
        requests,
        kept,
      ),
    );
    const taskId = await loop.createTask();

    await loop.start(taskId, "Read the report");

    const [sent] = results(requests[1] ?? []);
    expect(estimatedTokens(sent ?? "")).toBeLessThanOrEqual(8_200);
    expect(sent).toContain("line 1 of the report");
    expect(sent).toContain("line 5000 of the report");
    expect(sent).toMatch(
      /Full output \(\d+ KB\) saved as output:\/\/kept-1; read it with read_file/,
    );
    // Kept a line at a time, so read_file can page to the middle of it.
    expect(kept[0]).toContain("\nline 2500 of the report\n");
  });

  it("keeps one round's answers together under 24k tokens", async () => {
    const requests: ModelMessage[][] = [];
    const kept: string[] = [];
    const loop = loopFrom(
      withTool(
        (call) => ({ ok: true, value: { text: lines(call * 1_000, 1_000) } }),
        6,
        requests,
        kept,
      ),
    );
    const taskId = await loop.createTask();

    await loop.start(taskId, "Read six reports");

    const sent = results(requests[1] ?? []);
    expect(sent).toHaveLength(6);
    const total = sent.reduce((sum, text) => sum + estimatedTokens(text), 0);
    // Each answer past the round's limit still shows a little of itself.
    expect(total).toBeLessThanOrEqual(24_000 + 3 * 250);
    expect(sent.at(-1)).toContain("saved as output://");
  });

  it("is what the tool answered, not the copy made for the person", async () => {
    const requests: ModelMessage[][] = [];
    const loop = loopFrom(
      withTool(
        () => ({
          ok: true,
          value: { text: "the file" },
          details: [
            { kind: "text", label: "Contents", text: "copy for the person" },
          ],
        }),
        1,
        requests,
        [],
      ),
    );
    const taskId = await loop.createTask();

    await loop.start(taskId, "Read it");

    const [sent] = results(requests[1] ?? []);
    expect(sent).toContain("the file");
    expect(sent).not.toContain("copy for the person");
  });
});
