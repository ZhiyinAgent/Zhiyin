/**
 * What a request used is recorded beside the turn, never in its way: a usage
 * history that cannot be written loses that record, not the answer.
 */

import { describe, expect, it } from "vitest";
import type { AppEvent } from "@zhiyin/contract";
import { loopFrom, stubDependencies } from "./support.js";

describe("usage that cannot be saved", () => {
  it("keeps the completed response, and tells the window the history could not be saved", async () => {
    const events: AppEvent[] = [];
    const loop = loopFrom({
      ...stubDependencies(
        (event) => events.push(event),
        [
          { kind: "textDelta", text: "The response is complete." },
          {
            kind: "usage",
            usage: {
              requestId: "usage-failure",
              model: "z-ai/glm-5.3-flash",
              inputTokens: 10,
              outputTokens: 5,
              totalTokens: 15,
            },
          },
          { kind: "done" },
        ],
      ),
      usage: {
        record: async () => {
          throw new Error("disk unavailable");
        },
        state: async () => ({ status: "loading" }),
      },
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Answer the question");

    expect(loop.snapshot().tasks[0]).toMatchObject({
      messages: [
        { role: "user" },
        { role: "assistant", text: "The response is complete." },
      ],
      phase: { kind: "completed" },
    });
    expect(events).toContainEqual({
      kind: "usageChanged",
      data: {
        status: "failed",
        reason: "Usage history could not be saved.",
      },
    });
  });
});
