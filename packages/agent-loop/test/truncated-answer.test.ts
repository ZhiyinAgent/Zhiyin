import { describe, expect, it } from "vitest";
import {
  OpenRouterModelClient,
  type ModelEvent,
  type ModelFetch,
} from "@zhiyin/model-client";
import { stubDependencies, loopFrom } from "./support.js";

/**
 * A provider that answers once and says why it stopped: here, the model is
 * part-way through writing a page when the answer reaches the output ceiling.
 */
function answering(events: readonly ModelEvent[]) {
  return async function* () {
    for (const event of events) yield event;
  };
}

async function phaseAfter(events: readonly ModelEvent[]) {
  const deps = stubDependencies(() => {});
  const loop = loopFrom({
    ...deps,
    model: { ...deps.model, send: answering(events) },
  });
  const taskId = await loop.createTask();
  await loop.start(taskId, "Build me a landing page");
  return loop.snapshot().tasks[0]?.phase;
}

async function taskAfter(events: readonly ModelEvent[]) {
  const deps = stubDependencies(() => {});
  const loop = loopFrom({
    ...deps,
    model: { ...deps.model, send: answering(events) },
  });
  const taskId = await loop.createTask();
  await loop.start(taskId, "Build me a landing page");
  return loop.snapshot().tasks[0];
}

function streamResponse(chunks: readonly string[]) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    body: (async function* () {
      for (const chunk of chunks) yield new TextEncoder().encode(chunk);
    })(),
  };
}

describe("an answer that ran out of room", () => {
  it("is not presented as a finished one", async () => {
    expect(
      await phaseAfter([
        { kind: "textDelta", text: "Now I'll build the landing page with" },
        { kind: "done", finishReason: "length" },
      ]),
    ).toEqual({
      kind: "interrupted",
      reason:
        "The answer was cut off before it was finished. Ask again to carry on from here.",
    });
  });

  it("leaves an ordinary answer finished", async () => {
    expect(
      await phaseAfter([
        { kind: "textDelta", text: "Here you go." },
        { kind: "done", finishReason: "stop" },
      ]),
    ).toMatchObject({ kind: "completed" });
  });

  it("leaves a provider that said nothing about why it stopped alone", async () => {
    expect(
      await phaseAfter([
        { kind: "textDelta", text: "Here you go." },
        { kind: "done" },
      ]),
    ).toMatchObject({ kind: "completed" });
  });

  it("interrupts a reasoning-only response and retains its terminal evidence", async () => {
    const task = await taskAfter([
      {
        kind: "reasoningDelta",
        text: "I will write the page now, then evaluate document",
      },
      {
        kind: "done",
        response: {
          requestId: "gen-incomplete",
          model: "z-ai/glm-5.3-flash-20260826",
          provider: "Z.AI",
          finishReason: null,
          termination: "sentinel",
          complete: true,
        },
      },
    ]);

    expect(task).toMatchObject({
      phase: {
        kind: "interrupted",
        reason:
          "The model stopped before returning an answer or action. Ask again to continue.",
      },
      messages: [{}, { reasoning: { status: "interrupted" } }],
      modelResponses: [
        {
          requestId: "gen-incomplete",
          provider: "Z.AI",
          finishReason: null,
          termination: "sentinel",
          complete: false,
        },
      ],
    });
  });

  it("reproduces the saved reasoning-only stream through the real parser", async () => {
    const fetcher: ModelFetch = async () =>
      streamResponse([
        'data: {"id":"gen-reasoning-only","model":"z-ai/glm-5.3-flash-20260826","provider":"Z.AI","choices":[{"delta":{"reasoning":"Let me write the code now. After writing, evaluate (document"},"finish_reason":null}]}\n\n',
        'data: {"id":"gen-reasoning-only","model":"z-ai/glm-5.3-flash-20260826","provider":"Z.AI","choices":[],"usage":{"prompt_tokens":41724,"completion_tokens":1478,"total_tokens":43202}}\n\n',
        "data: [DONE]\n\n",
      ]);
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      model: new OpenRouterModelClient({
        apiKey: async () => "secret",
        fetcher,
        model: "z-ai/glm-5.3-flash",
      }),
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Go ahead.");

    expect(loop.snapshot().tasks[0]).toMatchObject({
      phase: { kind: "interrupted" },
      modelResponses: [
        {
          requestId: "gen-reasoning-only",
          provider: "Z.AI",
          finishReason: null,
          termination: "sentinel",
          complete: false,
        },
      ],
    });
  });
});
