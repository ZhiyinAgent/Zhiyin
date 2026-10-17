/**
 * A model that reasons on and on without answering, calling a tool or asking
 * anything is stopped and asked to decide, once, with the least reasoning it
 * can be asked for; a second time ends the turn with the reason. Reasoning
 * that leads somewhere is left alone.
 */

import { describe, expect, it } from "vitest";
import type {
  AppEvent,
  ReasoningSelection,
  WorkspaceTask,
} from "@zhiyin/contract";
import type { ModelEvent, ModelRequest } from "@zhiyin/model-client";
import { notices } from "./plan-fixture.js";
import { loopFrom, stubDependencies, until } from "./support.js";

/** Reasoning the loop counts as about this many tokens. */
const thought = (tokens: number) => "x".repeat(tokens * 4.5);

/** Reasons for as long as anyone listens. */
async function* reasonsWithoutEnd(
  request: ModelRequest,
): AsyncGenerator<ModelEvent> {
  while (!request.signal?.aborted) {
    yield { kind: "reasoningDelta", text: thought(20) };
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function setUp(
  answer: (request: ModelRequest, number: number) => AsyncIterable<ModelEvent>,
  options: {
    readonly longestThoughtTokens?: number;
    /** The least reasoning the model can be asked for; none to lower to when absent. */
    readonly leastReasoning?: ReasoningSelection;
  } = { longestThoughtTokens: 100 },
) {
  const requests: ModelRequest[] = [];
  const seen: AppEvent[] = [];
  const deps = stubDependencies((event) => seen.push(event));
  const loop = loopFrom({
    ...deps,
    revealDelayMs: 0,
    ...options,
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
  return { loop, requests, notes };
}

describe("a model that reasons at length", () => {
  it("is stopped when it has answered and called nothing, and is asked once to decide", async () => {
    const { loop, requests } = setUp(async function* (request, number) {
      if (number === 1) return yield* reasonsWithoutEnd(request);
      yield { kind: "textDelta", text: "Which side should the cable leave?" };
      yield { kind: "done", finishReason: "stop" };
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Design a phone stand");

    expect(requests).toHaveLength(2);
    expect(requests[0]?.signal?.aborted).toBe(true);
    expect(notices(requests[0], "thinking")).toHaveLength(0);
    const told = notices(requests[1], "thinking");
    expect(told).toHaveLength(1);
    expect(told[0]?.content).toContain(
      "call a tool, give your answer, or ask the person one question",
    );
    const task = loop.snapshot().tasks[0];
    expect(task?.phase.kind).toBe("completed");
    // The reasoning that led nowhere leaves no empty answer behind it.
    expect(
      task?.messages.map((message) => [message.role, message.text]),
    ).toEqual([
      ["user", "Design a phone stand"],
      ["assistant", "Which side should the cable leave?"],
    ]);
  });

  it("ends the turn, saying why, when it does so twice in a row", async () => {
    const { loop, requests } = setUp((request) => reasonsWithoutEnd(request));
    const taskId = await loop.createTask();

    await loop.start(taskId, "Design a phone stand");

    expect(requests).toHaveLength(2);
    expect(loop.snapshot().tasks[0]?.phase).toMatchObject({
      kind: "failed",
      reason:
        "The model kept reasoning without answering or acting, and was stopped twice. Try again, or choose less reasoning or another model.",
      remedies: ["tryAgain", "chooseModel"],
    });
  });

  /** Reasons without end on its first request, and answers the next. */
  const decidesWhenAskedAgain = (request: ModelRequest, number: number) =>
    number === 1
      ? reasonsWithoutEnd(request)
      : (async function* (): AsyncGenerator<ModelEvent> {
          yield { kind: "textDelta", text: "A wedge, 60°." };
          yield { kind: "done", finishReason: "stop" };
        })();
  const chosen = { enabled: true, effort: "high" } as const;

  it("is asked again without reasoning where the model can be asked that", async () => {
    const { loop, requests } = setUp(decidesWhenAskedAgain, {
      longestThoughtTokens: 100,
      leastReasoning: { enabled: false },
    });

    await loop.start(await loop.createTask(), "Design a stand", chosen);

    expect(requests[0]?.reasoning).toEqual(chosen);
    expect(requests[1]?.reasoning).toEqual({ enabled: false });
    expect(notices(requests[1], "thinking")).toHaveLength(1);
    expect(loop.snapshot().tasks[0]?.phase.kind).toBe("completed");
  });

  it("is asked again at the model's lowest effort where its reasoning cannot be turned off", async () => {
    const { loop, requests } = setUp(decidesWhenAskedAgain, {
      longestThoughtTokens: 100,
      leastReasoning: { enabled: true, effort: "low" },
    });

    await loop.start(await loop.createTask(), "Design a stand", chosen);

    expect(requests[1]?.reasoning).toEqual({ enabled: true, effort: "low" });
  });

  it("is asked again with the reasoning chosen where the model can be asked for no less", async () => {
    const { loop, requests } = setUp(decidesWhenAskedAgain);

    await loop.start(await loop.createTask(), "Design a stand", chosen);

    expect(requests[1]?.reasoning).toEqual(chosen);
    expect(notices(requests[1], "thinking")).toHaveLength(1);
  });

  it("has the reasoning chosen back once it has acted", async () => {
    const { loop, requests } = setUp(
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
        yield { kind: "textDelta", text: "Done." };
        yield { kind: "done", finishReason: "stop" };
      },
      { longestThoughtTokens: 100, leastReasoning: { enabled: false } },
    );

    await loop.start(await loop.createTask(), "Design a stand", chosen);

    expect(requests.map((request) => request.reasoning)).toEqual([
      chosen,
      { enabled: false },
      chosen,
    ]);
  });

  it("is asked again each time it happens after an answer in between", async () => {
    const { loop, requests } = setUp(async function* (request, number) {
      if (number === 1 || number === 3)
        return yield* reasonsWithoutEnd(request);
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
      yield { kind: "textDelta", text: "Done." };
      yield { kind: "done", finishReason: "stop" };
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Design a phone stand");

    expect(requests).toHaveLength(4);
    expect(loop.snapshot().tasks[0]?.phase.kind).toBe("completed");
  });

  it("is left alone when its reasoning ends in an answer within the limit, or goes on once the answer has begun", async () => {
    const { loop, requests } = setUp(async function* () {
      yield { kind: "reasoningDelta", text: thought(60) };
      yield { kind: "textDelta", text: "Here is the plan." };
      yield { kind: "reasoningDelta", text: thought(400) };
      yield { kind: "textDelta", text: " And the detail." };
      yield { kind: "done", finishReason: "stop" };
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Design a phone stand");

    expect(requests).toHaveLength(1);
    expect(loop.snapshot().tasks[0]?.messages.at(-1)?.text).toBe(
      "Here is the plan. And the detail.",
    );
  });

  it("is not stopped before a wordy model has reasoned 50,000 of its own tokens", async () => {
    // DeepSeek V4.1 Flash wrote 4.48 bytes of reasoning a token: 160 KB is
    // about 36,000 of its tokens, a hard step it then acts on.
    const { loop, requests } = setUp(async function* () {
      for (let sent = 0; sent < 160_000; sent += 4_000)
        yield { kind: "reasoningDelta", text: "x".repeat(4_000) };
      yield { kind: "textDelta", text: "Decided." };
      yield { kind: "done", finishReason: "stop" };
    }, {});

    await loop.start(await loop.createTask(), "Design a stand");

    expect(requests).toHaveLength(1);
    expect(loop.snapshot().tasks[0]?.messages.at(-1)?.text).toBe("Decided.");
  });

  it("is held to the same limit whatever reasoning effort the person chose", async () => {
    const { loop, requests } = setUp(async function* () {
      yield { kind: "reasoningDelta", text: thought(150) };
      yield { kind: "textDelta", text: "Decided." };
      yield { kind: "done", finishReason: "stop" };
    });

    await loop.start(await loop.createTask(), "Design a stand", {
      enabled: true,
      effort: "max",
    });

    expect(requests).toHaveLength(2);
  });

  it("is shown as thinking while it only reasons, and no longer once it answers", async () => {
    let answer!: () => void;
    const held = new Promise<void>((resolve) => {
      answer = resolve;
    });
    const { loop, notes } = setUp(async function* () {
      yield { kind: "reasoningDelta", text: thought(10) };
      await held;
      yield { kind: "textDelta", text: "Decided." };
      yield { kind: "done", finishReason: "stop" };
    });
    const taskId = await loop.createTask();
    const turn = loop.start(taskId, "Design a phone stand");

    await until(() => notes().includes("Thinking"));
    expect(loop.snapshot().tasks[0]?.phase).toMatchObject({
      kind: "working",
      note: "Thinking",
    });
    answer();
    await turn;

    expect(loop.snapshot().tasks[0]?.phase.kind).toBe("completed");
  });

  it("is told what the person added meanwhile when it is asked again", async () => {
    let reasoning = false;
    const { loop, requests } = setUp(async function* (request, number) {
      if (number === 1) {
        reasoning = true;
        // Listened to until the person's message is in, then past the limit.
        while (!request.signal?.aborted) {
          const added = loop.snapshot().tasks[0]?.guidance.length ?? 0;
          yield { kind: "reasoningDelta", text: thought(added ? 20 : 0) };
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        return;
      }
      yield { kind: "textDelta", text: "Understood." };
      yield { kind: "done", finishReason: "stop" };
    });
    const taskId = await loop.createTask();
    const turn = loop.start(taskId, "Design a phone stand");

    await until(() => reasoning);
    await loop.send(taskId, "Keep it simple: one flat base.");
    await turn;

    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests[1]?.messages)).toContain(
      "Keep it simple: one flat base.",
    );
  });
});
