/** What a turn does with reasoning as it arrives, and when it stops. */

import { describe, expect, it } from "vitest";
import type { AppEvent } from "@zhiyin/contract";
import type { ModelRequest } from "@zhiyin/model-client";
import { stubDependencies, until, loopFrom } from "./support.js";

describe("reasoning in a conversation", () => {
  /**
   * A model can be asked for reasoning and return none that is readable — the
   * trace withheld, encrypted, or summarised away, with only the answer
   * arriving. Nothing is attached to the message then, so the conversation has
   * no empty trace to draw and no affordance standing over nothing.
   */
  it("attaches no reasoning when none of it was readable", async () => {
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      model: {
        ...deps.model,
        send: async function* () {
          yield { kind: "textDelta", text: "Here is the answer." };
          yield { kind: "done" };
        },
      },
    });
    const id = await loop.createTask();
    await loop.start(id, "Ask something");

    const message = loop.snapshot().tasks[0]?.messages.at(-1);
    expect(message).toMatchObject({ text: "Here is the answer." });
    expect(message?.reasoning).toBeUndefined();
  });

  it("retains reasoning across a failed request without presenting it as an answer", async () => {
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      model: {
        ...deps.model,
        send: async function* () {
          yield { kind: "reasoningDelta", text: "Checking sources." };
          throw new Error("disconnected");
        },
      },
    });
    const id = await loop.createTask();
    await loop.start(id, "Research");
    expect(loop.snapshot().tasks[0]?.phase.kind).toBe("failed");
    expect(loop.snapshot().tasks[0]?.messages.at(-1)).toMatchObject({
      text: "",
      reasoning: { text: "Checking sources.", status: "interrupted" },
    });
  });
  it("shows reasoning before an answer and retains it separately from future model context", async () => {
    const seen: AppEvent[] = [];
    const requests: ModelRequest[] = [];
    const deps = stubDependencies((event) => seen.push(event));
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const loop = loopFrom({
      ...deps,
      // About what is shown while the round runs, not how far behind it: shown
      // as it arrives (ADR 0011).
      revealDelayMs: 0,
      model: {
        ...deps.model,
        send: async function* (request) {
          requests.push(request);
          yield { kind: "reasoningDelta", text: "Compare the sources." };
          await pending;
          yield { kind: "textDelta", text: "The answer." };
          yield { kind: "done", finishReason: "stop" };
        },
      },
    });
    const id = await loop.createTask();
    const work = loop.start(id, "Research this", {
      enabled: true,
      effort: "high",
    });
    await until(() =>
      seen.some(
        (event) =>
          event.kind === "taskChanged" &&
          event.data.messages.some(
            (message) => message.reasoning?.text === "Compare the sources.",
          ),
      ),
    );
    expect(loop.snapshot().tasks[0]?.messages.at(-1)).toMatchObject({
      text: "",
      reasoning: { text: "Compare the sources.", status: "streaming" },
    });
    release();
    await work;
    expect(loop.snapshot().tasks[0]?.messages.at(-1)).toMatchObject({
      text: "The answer.",
      reasoning: { text: "Compare the sources.", status: "complete" },
    });
    await loop.start(id, "Continue");
    expect(
      requests.every(
        (request) =>
          request.reasoning?.enabled && request.reasoning.effort === "high",
      ),
    ).toBe(true);
    expect(JSON.stringify(requests[1]?.messages)).not.toContain(
      "Compare the sources.",
    );
    expect(loop.snapshot().tasks[0]?.reasoning).toEqual({
      enabled: true,
      effort: "high",
    });
  });

  it("keeps partial reasoning when stopped and rejects later reasoning", async () => {
    const deps = stubDependencies(() => {});
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const loop = loopFrom({
      ...deps,
      // About reasoning that was shown before the stop; shown as it arrives
      // (ADR 0011), since text still held back at a stop is not kept.
      revealDelayMs: 0,
      model: {
        ...deps.model,
        send: async function* () {
          yield { kind: "reasoningDelta", text: "Partial thought." };
          await pending;
          yield { kind: "reasoningDelta", text: "Late thought." };
          yield { kind: "done" };
        },
      },
    });
    const id = await loop.createTask();
    const work = loop.start(id, "Think");
    await until(() =>
      Boolean(loop.snapshot().tasks[0]?.messages.at(-1)?.reasoning),
    );
    await loop.cancel(id);
    release();
    await work;
    expect(loop.snapshot().tasks[0]?.phase.kind).toBe("interrupted");
    expect(loop.snapshot().tasks[0]?.messages.at(-1)?.reasoning).toMatchObject({
      text: "Partial thought.",
      status: "interrupted",
    });
  });
});
