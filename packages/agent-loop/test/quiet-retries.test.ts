import { describe, expect, it } from "vitest";
import type { ToolCallInspection } from "@zhiyin/contract";
import type { ModelMessage, ModelRequest } from "@zhiyin/model-client";
import { stubDependencies, loopFrom } from "./support.js";

/**
 * A tool that refuses the first `failures` attempts as model-correctable and
 * accepts everything after that, so a test can watch what the person and the
 * model are each shown while the model corrects itself.
 */
function selfCorrectingTool(failures: number, correctable = true) {
  let attempts = 0;
  return {
    attempts: () => attempts,
    registry: {
      list: () => [
        {
          name: "multi_edit",
          description: "Edit files.",
          inputSchema: { type: "object" },
        },
      ],
      inspect: async (): Promise<ToolCallInspection> => {
        attempts += 1;
        return attempts <= failures
          ? {
              ok: false,
              reason: "“old text” was not found in notes.md.",
              ...(correctable ? { correctable: true } : {}),
            }
          : {
              ok: true,
              action: "Edit a workspace file",
              target: "notes.md",
              command: "multi_edit({})",
            };
      },
      execute: async () => ({ ok: true as const, value: { edited: true } }),
    },
  };
}

function repeatsOneCall(name: string, finalText: string, calls: number) {
  let turn = 0;
  return async function* (request: ModelRequest) {
    turn += 1;
    if (turn <= calls) {
      yield {
        kind: "toolCallDelta" as const,
        index: 0,
        callId: `call-${turn}`,
        name,
        argumentsDelta: "{}",
      };
    } else {
      yield { kind: "textDelta" as const, text: finalText };
    }
    void request;
    yield { kind: "done" as const };
  };
}

describe("AgentLoop quiet corrections", () => {
  it("lets the model correct a rejected edit without showing it to the person", async () => {
    const tool = selfCorrectingTool(2);
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      tools: tool.registry,
      permissions: {
        decide: async () => ({ outcome: "allow" as const, reason: "Approved" }),
      },
      model: {
        ...deps.model,
        send: repeatsOneCall("multi_edit", "The edit is in place.", 3),
      },
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Fix the owner line");

    // Two refusals, then the accepted call.
    expect(tool.attempts()).toBeGreaterThanOrEqual(3);
    const task = loop.snapshot().tasks[0];
    expect(task?.phase.kind).toBe("completed");
    // Nothing about the two dead ends reached the person.
    expect(task?.actions?.map((action) => action.status)).toEqual([
      "completed",
    ]);
    expect(JSON.stringify(task)).not.toContain("was not found");
  });

  it("removes the corrected attempts from what the model is asked next", async () => {
    const tool = selfCorrectingTool(2);
    const deps = stubDependencies(() => {});
    const requests: ModelMessage[][] = [];
    const loop = loopFrom({
      ...deps,
      tools: tool.registry,
      permissions: {
        decide: async () => ({ outcome: "allow" as const, reason: "Approved" }),
      },
      model: {
        ...deps.model,
        send: (() => {
          const inner = repeatsOneCall("multi_edit", "Done.", 3);
          return async function* (request: ModelRequest) {
            requests.push([...request.messages]);
            yield* inner(request);
          };
        })(),
      },
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Fix the owner line");

    // While correcting, the model does see its own failed attempt.
    const whileCorrecting = JSON.stringify(requests[1]);
    expect(whileCorrecting).toContain("was not found");

    // After the tool succeeds, they are gone: the model is not left re-reading
    // dead ends as though they still described the workspace.
    const afterSuccess = requests.at(-1) ?? [];
    expect(JSON.stringify(afterSuccess)).not.toContain("was not found");
    expect(
      afterSuccess.filter(
        (message) => message.role === "tool" && message.name === "multi_edit",
      ),
    ).toHaveLength(1);
    // No tool result is left pointing at a call the assistant no longer made.
    const announced = new Set(
      afterSuccess.flatMap((message) =>
        message.role === "assistant"
          ? (message.toolCalls ?? []).map((call) => call.id)
          : [],
      ),
    );
    for (const message of afterSuccess)
      if (message.role === "tool")
        expect(announced.has(message.toolCallId)).toBe(true);
  });

  it("shows the person a correctable failure once the model has run out of tries", async () => {
    const tool = selfCorrectingTool(99);
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      tools: tool.registry,
      permissions: {
        decide: async () => ({ outcome: "allow" as const, reason: "Approved" }),
      },
      model: {
        ...deps.model,
        send: repeatsOneCall("multi_edit", "I could not apply the edit.", 4),
      },
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Fix the owner line");

    const actions = loop.snapshot().tasks[0]?.actions ?? [];
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      status: "failed",
      reason: "“old text” was not found in notes.md.",
    });
  });

  it("never hides a refusal the tool did not mark correctable", async () => {
    const tool = selfCorrectingTool(1, false);
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      tools: tool.registry,
      permissions: {
        decide: async () => ({ outcome: "allow" as const, reason: "Approved" }),
      },
      model: {
        ...deps.model,
        send: repeatsOneCall("multi_edit", "Done.", 1),
      },
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Fix the owner line");

    const actions = loop.snapshot().tasks[0]?.actions ?? [];
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ status: "failed" });
  });
});
