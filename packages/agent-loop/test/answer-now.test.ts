/**
 * A person who has waited long enough on a model's reasoning can ask for the
 * answer now. The request is stopped, what it reasoned is dropped, and the
 * model is asked again and told to answer directly, for the rest of the turn
 * with the least reasoning the model can be asked for: none where it allows
 * that, and otherwise its lowest effort.
 */

import { describe, expect, it } from "vitest";
import type {
  AppEvent,
  ReasoningSelection,
  WorkspaceTask,
} from "@zhiyin/contract";
import type { ModelEvent, ModelRequest } from "@zhiyin/model-client";
import { notices } from "./plan-fixture.js";
import { loopAndHost, stubDependencies, until } from "./support.js";

/** Reasons for as long as anyone listens. */
async function* reasonsWithoutEnd(
  request: ModelRequest,
): AsyncGenerator<ModelEvent> {
  while (!request.signal?.aborted) {
    yield { kind: "reasoningDelta", text: "Weighing it. " };
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function* answers(text: string): AsyncGenerator<ModelEvent> {
  yield { kind: "textDelta", text };
  yield { kind: "done", finishReason: "stop" };
}

function setUp(
  answer: (request: ModelRequest, number: number) => AsyncIterable<ModelEvent>,
  {
    leastReasoning = { enabled: false },
  }: {
    /** The least reasoning the model can be asked for; `null` for no less. */
    readonly leastReasoning?: ReasoningSelection | null;
  } = {},
) {
  const requests: ModelRequest[] = [];
  const seen: AppEvent[] = [];
  const deps = stubDependencies((event) => seen.push(event));
  const { host } = loopAndHost({
    ...deps,
    revealDelayMs: 0,
    ...(leastReasoning ? { leastReasoning } : {}),
    model: {
      ...deps.model,
      send: (request) => {
        requests.push(request);
        return answer(request, requests.length);
      },
    },
  });
  const notes = () =>
    seen.flatMap((event) => {
      if (event.kind !== "taskChanged") return [];
      const phase = (event.data as WorkspaceTask).phase;
      return phase.kind === "working" && phase.note ? [phase.note] : [];
    });
  /** The model is reasoning, and the conversation says so. */
  const thinking = () =>
    until(() => host.app.snapshot().tasks[0]?.phase.kind === "working").then(
      () => until(() => notes().at(-1) === "Thinking"),
    );
  return { loop: host.app, requests, notes, thinking };
}

describe("asking for the answer now", () => {
  it("stops the reasoning, drops it, and asks again without reasoning", async () => {
    const { loop, requests, notes, thinking } = setUp((request, number) =>
      number === 1 ? reasonsWithoutEnd(request) : answers("A wedge, 60°."),
    );
    const taskId = await loop.createTask();
    const turn = loop.start(taskId, "Design a phone stand", {
      enabled: true,
      effort: "high",
    });
    await thinking();

    expect(await loop.answerNow(taskId)).toBe(true);
    await turn;

    expect(requests).toHaveLength(2);
    expect(requests[0]?.signal?.aborted).toBe(true);
    expect(requests[0]?.reasoning).toEqual({ enabled: true, effort: "high" });
    expect(requests[1]?.reasoning).toEqual({ enabled: false });
    const told = notices(requests[1], "answerNow");
    expect(told).toHaveLength(1);
    expect(told[0]?.content).toContain("asked for your answer now");
    // The words Anthropic documents for asking a model to skip reasoning.
    expect(told[0]?.content).toContain("Answer directly without deliberating");
    expect(notes()).toContain("Answering now");
    const task = loop.snapshot().tasks[0];
    expect(task?.phase.kind).toBe("completed");
    // What was reasoned leaves no empty answer behind it.
    expect(
      task?.messages.map((message) => [message.role, message.text]),
    ).toEqual([
      ["user", "Design a phone stand"],
      ["assistant", "A wedge, 60°."],
    ]);
  });

  it("asks again at the model's lowest effort, and still says to answer, where the model cannot stop reasoning", async () => {
    const { loop, requests, thinking } = setUp(
      (request, number) =>
        number === 1 ? reasonsWithoutEnd(request) : answers("A wedge."),
      { leastReasoning: { enabled: true, effort: "low" } },
    );
    const taskId = await loop.createTask();
    const turn = loop.start(taskId, "Design a phone stand", {
      enabled: true,
      effort: "high",
    });
    await thinking();

    expect(await loop.answerNow(taskId)).toBe(true);
    await turn;

    expect(requests[1]?.reasoning).toEqual({ enabled: true, effort: "low" });
    expect(notices(requests[1], "answerNow")).toHaveLength(1);
    expect(loop.snapshot().tasks[0]?.phase.kind).toBe("completed");
  });

  it("asks again as before, and still says to answer, where the model can be asked for no less reasoning", async () => {
    const { loop, requests, thinking } = setUp(
      (request, number) =>
        number === 1 ? reasonsWithoutEnd(request) : answers("A wedge."),
      { leastReasoning: null },
    );
    const taskId = await loop.createTask();
    const turn = loop.start(taskId, "Design a phone stand", {
      enabled: true,
      effort: "high",
    });
    await thinking();

    expect(await loop.answerNow(taskId)).toBe(true);
    await turn;

    expect(requests[1]?.reasoning).toEqual({ enabled: true, effort: "high" });
    expect(notices(requests[1], "answerNow")).toHaveLength(1);
    expect(loop.snapshot().tasks[0]?.phase.kind).toBe("completed");
  });

  it("keeps reasoning off for the rest of that turn, and gives it back to the next", async () => {
    const { loop, requests, thinking } = setUp(
      async function* (request, number) {
        if (number === 1) return yield* reasonsWithoutEnd(request);
        if (number === 2) {
          yield {
            kind: "toolCallDelta",
            index: 0,
            callId: "call-1",
            name: "list_directory",
            argumentsDelta: '{"path":"."}',
          };
          yield { kind: "done", finishReason: "tool_calls" };
          return;
        }
        yield* answers("Done.");
      },
    );
    const taskId = await loop.createTask();
    const turn = loop.start(taskId, "Design a phone stand");
    await thinking();
    await loop.answerNow(taskId);
    await turn;

    await loop.start(taskId, "And a taller one");

    expect(requests).toHaveLength(4);
    expect(requests.map((request) => request.reasoning)).toEqual([
      undefined,
      { enabled: false },
      { enabled: false },
      undefined,
    ]);
    // Said once, not again with each request.
    expect(notices(requests[2], "answerNow")).toHaveLength(1);
  });

  it("changes nothing once the answer has begun, or when no turn is reasoning", async () => {
    let finish!: () => void;
    const held = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const { loop, requests } = setUp(async function* () {
      yield { kind: "reasoningDelta", text: "Weighing it. " };
      yield { kind: "textDelta", text: "A wedge" };
      await held;
      yield { kind: "textDelta", text: ", 60°." };
      yield { kind: "done", finishReason: "stop" };
    });
    const taskId = await loop.createTask();
    expect(await loop.answerNow(taskId)).toBe(false);
    const turn = loop.start(taskId, "Design a phone stand");
    await until(() =>
      Boolean(
        loop.snapshot().tasks[0]?.messages.at(-1)?.text.includes("wedge"),
      ),
    );

    expect(await loop.answerNow(taskId)).toBe(false);
    finish();
    await turn;

    expect(requests).toHaveLength(1);
    expect(requests[0]?.signal?.aborted).toBe(false);
    expect(loop.snapshot().tasks[0]?.messages.at(-1)?.text).toBe(
      "A wedge, 60°.",
    );
    expect(await loop.answerNow(taskId)).toBe(false);
  });

  it("takes what the person added while the model reasoned along with the new request", async () => {
    const { loop, requests, thinking } = setUp((request, number) =>
      number === 1 ? reasonsWithoutEnd(request) : answers("One flat base."),
    );
    const taskId = await loop.createTask();
    const turn = loop.start(taskId, "Design a phone stand");
    await thinking();
    await loop.send(
      taskId,
      "Keep it simple: one flat base.",
      undefined,
      [],
      "guidance",
    );

    await loop.answerNow(taskId);
    await turn;

    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests[1]?.messages)).toContain(
      "Keep it simple: one flat base.",
    );
    expect(notices(requests[1], "answerNow")).toHaveLength(1);
  });

  it("is the person's stop that ends the turn, when they stop it afterwards", async () => {
    const { loop, requests, thinking } = setUp((request) =>
      reasonsWithoutEnd(request),
    );
    const taskId = await loop.createTask();
    const turn = loop.start(taskId, "Design a phone stand");
    await thinking();
    await loop.answerNow(taskId);
    await until(() => requests.length === 2);

    await loop.cancel(taskId);
    await turn;

    expect(loop.snapshot().tasks[0]?.phase.kind).toBe("interrupted");
  });
});
