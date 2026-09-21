import { describe, expect, it } from "vitest";
import type { ModelEvent, ModelRequest } from "@zhiyin/model-client";
import { stubDependencies, loopFrom } from "./support.js";

/**
 * The auxiliary calls ask the model for a specific object, never for
 * conversation. Three request shapes can express that, and they are not
 * equally supported: measured 2026-09-07 across the 24 OpenRouter endpoints
 * serving the default model, `tools` was accepted by 24, plain
 * `response_format` by 22, and schema-enforcing `structured_outputs` by 17.
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
  it("asks for one tool instead of a JSON-mode reply", async () => {
    const requests: ModelRequest[] = [];
    const deps = stubDependencies(() => {}, [{ kind: "done" }]);
    const loop = loopFrom({
      ...deps,
      guidanceModel: guidance(requests, () => []),
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Review the launch readiness material");

    const planRequest = requests[0];
    expect(planRequest?.jsonMode).toBeUndefined();
    expect(planRequest?.responseFormat).toBeUndefined();
    expect(planRequest?.tools).toHaveLength(1);
    expect(planRequest?.tools?.[0]?.inputSchema).toMatchObject({
      type: "object",
    });
  });

  /**
   * Providers disagree about `tool_choice` and a request carrying it is not
   * portable: Z.AI, which advertises no support, answers `400 Tool choice
   * must be auto` rather than ignoring the field (verified 2026-09-07). It
   * would force a per-provider branch to buy a guarantee the prose fallback
   * below already covers, so it is never sent.
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

  it("reads the plan from the tool call arguments", async () => {
    const requests: ModelRequest[] = [];
    const deps = stubDependencies(() => {}, [{ kind: "done" }]);
    const loop = loopFrom({
      ...deps,
      guidanceModel: guidance(requests, (request) =>
        request.tools?.[0]?.name === "record_plan"
          ? toolCall("record_plan", {
              conversationTitle: "Review launch readiness",
              items: [
                { title: "Read the material", criterion: "The file is read" },
              ],
            })
          : [],
      ),
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Review the launch readiness material");

    expect(loop.snapshot().tasks[0]).toMatchObject({
      title: "Review launch readiness",
      plan: [{ title: "Read the material", criterion: "The file is read" }],
    });
  });

  it("retries the first title separately when the planning answer omits it", async () => {
    const requests: ModelRequest[] = [];
    const deps = stubDependencies(() => {}, [{ kind: "done" }]);
    const loop = loopFrom({
      ...deps,
      guidanceModel: guidance(requests, (request) => {
        const tool = request.tools?.[0]?.name;
        if (tool === "record_plan")
          return toolCall("record_plan", {
            items: [
              {
                title: "Inspect the checklist",
                criterion: "The launch checklist has been reviewed.",
              },
            ],
          });
        if (tool === "record_conversation_title")
          return toolCall("record_conversation_title", {
            title: "Assess launch readiness",
          });
        return [];
      }),
    });
    const taskId = await loop.createTask();

    await loop.start(
      taskId,
      "Please inspect the launch checklist before tomorrow's review",
    );

    expect(requests.map((request) => request.tools?.[0]?.name)).toEqual([
      "record_plan",
      "record_conversation_title",
    ]);
    expect(loop.snapshot().tasks[0]).toMatchObject({
      title: "Assess launch readiness",
      plan: [{ title: "Inspect the checklist" }],
    });
  });

  /**
   * Without `tool_choice`, a model may answer in prose instead of calling the
   * tool. That was already the outcome when JSON mode returned well-formed
   * JSON with the wrong keys, and the parsers already treat it as "no answer"
   * rather than failing the task — so the object still arrives when the model
   * puts it in the message body.
   */
  it("still reads an answer the model wrote as prose", async () => {
    const requests: ModelRequest[] = [];
    const deps = stubDependencies(() => {}, [{ kind: "done" }]);
    const loop = loopFrom({
      ...deps,
      guidanceModel: guidance(requests, () => [
        {
          kind: "textDelta",
          text: JSON.stringify({
            conversationTitle: "Review launch readiness",
            items: [
              { title: "Read the material", criterion: "The file is read" },
            ],
          }),
        },
      ]),
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Review the launch readiness material");

    expect(loop.snapshot().tasks[0]).toMatchObject({
      title: "Review launch readiness",
      plan: [{ title: "Read the material", criterion: "The file is read" }],
    });
  });
});
