import { describe, expect, it } from "vitest";
import type { ModelEvent, ModelRequest } from "@zhiyin/model-client";
import { stubDependencies, loopFrom } from "./support.js";

/**
 * The auxiliary calls ask the model for a specific object, never for
 * conversation. Three request shapes can express that, and they are not
 * equally supported: measured across the 24 OpenRouter endpoints serving the
 * default model, `tools` was accepted by 24, plain `response_format` by 22,
 * and schema-enforcing `structured_outputs` by 17.
 *
 * A tool call carries the same schema guarantee as structured outputs through
 * the field every provider implements, so it is the one shape that needs no
 * per-provider branch.
 */
function guidance(
  requests: ModelRequest[],
  reply: (request: ModelRequest) => readonly ModelEvent[],
) {
  return {
    send: async function* (request: ModelRequest) {
      requests.push(request);
      for (const event of reply(request)) yield event;
      yield { kind: "done" as const };
    },
  };
}

function toolCall(name: string, args: unknown): readonly ModelEvent[] {
  return [
    {
      kind: "toolCallDelta",
      index: 0,
      callId: "call-1",
      name,
      argumentsDelta: JSON.stringify(args),
    },
  ];
}

describe("auxiliary model calls", () => {
  it("asks for its answer as one tool", async () => {
    const requests: ModelRequest[] = [];
    const deps = stubDependencies(() => {}, [{ kind: "done" }]);
    const loop = loopFrom({
      ...deps,
      guidanceModel: guidance(requests, () => []),
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Review the launch readiness material");

    const nameRequest = requests[0];
    expect(nameRequest?.tools).toHaveLength(1);
    expect(nameRequest?.tools?.[0]?.inputSchema).toMatchObject({
      type: "object",
    });
  });

  /**
   * Providers disagree about `tool_choice` and a request carrying it is not
   * portable: Z.AI, which advertises no support, answers `400 Tool choice
   * must be auto` rather than ignoring the field. It would force a
   * per-provider branch to buy a guarantee the prose fallback below already
   * covers, so it is never sent.
   */
  it("never constrains tool choice", async () => {
    const requests: ModelRequest[] = [];
    const deps = stubDependencies(() => {}, [{ kind: "done" }]);
    const loop = loopFrom({
      ...deps,
      guidanceModel: guidance(requests, () => []),
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Review the launch readiness material");

    for (const request of requests) {
      expect(request).not.toHaveProperty("toolChoice");
    }
  });

  it("reads the conversation name from the tool call arguments", async () => {
    const requests: ModelRequest[] = [];
    const deps = stubDependencies(() => {}, [{ kind: "done" }]);
    const loop = loopFrom({
      ...deps,
      guidanceModel: guidance(requests, () =>
        toolCall("record_conversation_title", {
          title: "Review launch readiness",
        }),
      ),
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Review the launch readiness material");

    expect(loop.snapshot().tasks[0]).toMatchObject({
      title: "Review launch readiness",
    });
  });

  /**
   * Without `tool_choice`, a model may answer in prose instead of calling the
   * tool. The parsers read the same object from the message body, and treat
   * an unusable answer as "no answer" rather than failing the task.
   */
  it("still reads an answer the model wrote as prose", async () => {
    const requests: ModelRequest[] = [];
    const deps = stubDependencies(() => {}, [{ kind: "done" }]);
    const loop = loopFrom({
      ...deps,
      guidanceModel: guidance(requests, () => [
        {
          kind: "textDelta",
          text: JSON.stringify({ title: "Review launch readiness" }),
        },
      ]),
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Review the launch readiness material");

    expect(loop.snapshot().tasks[0]).toMatchObject({
      title: "Review launch readiness",
    });
  });
});
