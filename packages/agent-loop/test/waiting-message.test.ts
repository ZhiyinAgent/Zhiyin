/**
 * A message the person adds while a turn works waits for the turn's next
 * step, and the model's reasoning goes on meanwhile. The person can have it
 * sent now, which stops a request that has only reasoned and asks again with
 * the message, or take it back, which returns it to them unread.
 */

import { describe, expect, it } from "vitest";
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
) {
  const requests: ModelRequest[] = [];
  const deps = stubDependencies(() => {});
  const { host } = loopAndHost({
    ...deps,
    revealDelayMs: 0,
    model: {
      ...deps.model,
      send: (request) => {
        requests.push(request);
        return answer(request, requests.length);
      },
    },
  });
  const loop = host.app;
  const conversation = () => loop.snapshot().tasks[0];
  /** The model is reasoning, and the conversation shows it. */
  const reasoning = () =>
    until(
      () => conversation()?.messages.at(-1)?.reasoning?.status === "streaming",
    );
  const add = (taskId: string, text: string) =>
    loop.send(taskId, text, undefined, [], "guidance");
  return { loop, requests, conversation, reasoning, add };
}

const said = (request: ModelRequest | undefined) =>
  JSON.stringify(request?.messages);

describe("a message added while the model reasons", () => {
  it("waits for the next step, and the reasoning is left to go on", async () => {
    let decide!: () => void;
    const decided = new Promise<void>((resolve) => {
      decide = resolve;
    });
    const { loop, requests, conversation, reasoning, add } = setUp(
      async function* (_request, number) {
        if (number === 2) return yield* answers("One flat base it is.");
        yield { kind: "reasoningDelta", text: "Weighing it. " };
        await decided;
        yield {
          kind: "toolCallDelta",
          index: 0,
          callId: "call-1",
          name: "list_directory",
          argumentsDelta: '{"path":"."}',
        };
        yield { kind: "done", finishReason: "tool_calls" };
      },
    );
    const taskId = await loop.createTask();
    const turn = loop.start(taskId, "Design a phone stand");
    await reasoning();

    await add(taskId, "Keep it simple: one flat base.");

    expect(conversation()?.guidance).toMatchObject([
      { text: "Keep it simple: one flat base.", status: "pending" },
    ]);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.signal?.aborted).toBe(false);
    decide();
    await turn;
    expect(said(requests[1])).toContain("Keep it simple: one flat base.");
    expect(conversation()?.guidance).toEqual([]);
  });

  it("is sent now when the person asks: the reasoning is stopped and dropped, and the model is asked again with it", async () => {
    const { loop, requests, conversation, reasoning, add } = setUp(
      (request, number) =>
        number === 1 ? reasonsWithoutEnd(request) : answers("One flat base."),
    );
    const taskId = await loop.createTask();
    const turn = loop.start(taskId, "Design a phone stand", {
      enabled: true,
      effort: "high",
    });
    await reasoning();
    await add(taskId, "Keep it simple: one flat base.");

    expect(await loop.sendNow(taskId)).toBe(true);
    await turn;

    expect(requests).toHaveLength(2);
    expect(requests[0]?.signal?.aborted).toBe(true);
    expect(said(requests[1])).toContain("Keep it simple: one flat base.");
    // Sent as the conversation has it: nothing about reasoning changes.
    expect(requests[1]?.reasoning).toEqual({ enabled: true, effort: "high" });
    expect(notices(requests[1], "answerNow")).toHaveLength(0);
    expect(notices(requests[1], "guidance")).toHaveLength(1);
    expect(conversation()?.phase.kind).toBe("completed");
    // What was reasoned leaves no empty answer between the two messages.
    expect(
      conversation()?.messages.map((message) => [message.role, message.text]),
    ).toEqual([
      ["user", "Design a phone stand"],
      ["user", "Keep it simple: one flat base."],
      ["assistant", "One flat base."],
    ]);
  });

  it("is not sent now when none waits, or once the answer has begun", async () => {
    let finish!: () => void;
    const held = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const { loop, requests, conversation, reasoning, add } = setUp(
      async function* (request, number) {
        if (number === 2) return yield* answers("Noted.");
        yield { kind: "reasoningDelta", text: "Weighing it. " };
        await new Promise((resolve) => setTimeout(resolve, 20));
        yield { kind: "textDelta", text: "A wedge" };
        await held;
        yield { kind: "textDelta", text: ", 60°." };
        yield { kind: "done", finishReason: "stop" };
        void request;
      },
    );
    const taskId = await loop.createTask();
    expect(await loop.sendNow(taskId)).toBe(false);
    const turn = loop.start(taskId, "Design a phone stand");
    await reasoning();
    // Reasoning, and nothing waits to be sent.
    expect(await loop.sendNow(taskId)).toBe(false);

    await until(() => Boolean(conversation()?.messages.at(-1)?.text));
    await add(taskId, "Make it taller.");
    expect(await loop.sendNow(taskId)).toBe(false);
    finish();
    await turn;

    expect(requests[0]?.signal?.aborted).toBe(false);
    // The answer under way was finished, and the message read after it.
    expect(
      conversation()?.messages.map((message) => [message.role, message.text]),
    ).toEqual([
      ["user", "Design a phone stand"],
      ["assistant", "A wedge, 60°."],
      ["user", "Make it taller."],
      ["assistant", "Noted."],
    ]);
  });

  it("is given back unread when the person takes it back", async () => {
    let decide!: () => void;
    const decided = new Promise<void>((resolve) => {
      decide = resolve;
    });
    const { loop, requests, conversation, reasoning, add } = setUp(
      async function* (_request, number) {
        if (number > 1) return yield* answers("Done.");
        yield { kind: "reasoningDelta", text: "Weighing it. " };
        await decided;
        yield* answers("A wedge.");
      },
    );
    const taskId = await loop.createTask();
    const turn = loop.start(taskId, "Design a phone stand");
    await reasoning();
    await add(taskId, "Keep it simple: one flat base.");
    await add(taskId, "And make it red.");
    const [first] = conversation()?.guidance ?? [];

    await loop.takeBack(taskId, first?.id ?? "");

    // Back with the person as a draft; the other still waits.
    expect(conversation()?.guidance).toMatchObject([
      { text: "Keep it simple: one flat base.", status: "draft" },
      { text: "And make it red.", status: "pending" },
    ]);
    await loop.takeBack(taskId, conversation()?.guidance[1]?.id ?? "");
    decide();
    await turn;

    expect(requests).toHaveLength(1);
    expect(said(requests[0])).not.toContain("one flat base");
    expect(
      conversation()?.messages.map((message) => [message.role, message.text]),
    ).toEqual([
      ["user", "Design a phone stand"],
      ["assistant", "A wedge."],
    ]);
  });

  it("stays a message of the conversation when it is taken back after the model was sent it", async () => {
    const { loop, conversation, reasoning, add } = setUp((request, number) =>
      number === 1 ? reasonsWithoutEnd(request) : answers("One flat base."),
    );
    const taskId = await loop.createTask();
    const turn = loop.start(taskId, "Design a phone stand");
    await reasoning();
    await add(taskId, "Keep it simple: one flat base.");
    const id = conversation()?.guidance[0]?.id ?? "";
    await loop.sendNow(taskId);
    await turn;

    await loop.takeBack(taskId, id);

    expect(conversation()?.guidance).toEqual([]);
    expect(conversation()?.messages.map((message) => message.text)).toEqual([
      "Design a phone stand",
      "Keep it simple: one flat base.",
      "One flat base.",
    ]);
  });
});
