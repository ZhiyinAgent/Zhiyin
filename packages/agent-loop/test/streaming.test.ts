import { describe, expect, it } from "vitest";
import type { AppEvent } from "@zhiyin/contract";
import { stubDependencies, loopFrom } from "./support.js";

const words = Array.from({ length: 400 }, (_, index) => `word${index} `);

function loopEmitting(seen: AppEvent[]) {
  const deps = stubDependencies((event: AppEvent) => seen.push(event));
  return loopFrom({
    ...deps,
    model: {
      ...deps.model,
      send: async function* () {
        for (const text of words) yield { kind: "textDelta" as const, text };
        yield { kind: "done" as const };
      },
    },
  });
}

/**
 * Streaming announcements are coalesced, because each one carries the whole
 * task and the task grows with the conversation while a token does not. What
 * must survive that is the text itself and the fact that it appeared while the
 * turn was still running.
 */
describe("streamed text", () => {
  it("delivers every token, and shows progress before the turn ends", async () => {
    const seen: AppEvent[] = [];
    const loop = loopEmitting(seen);
    const taskId = await loop.createTask();

    await loop.start(taskId, "Say a lot");

    const message = loop
      .snapshot()
      .tasks[0]?.messages.findLast((entry) => entry.role === "assistant");
    expect(message?.text).toBe(words.join(""));

    const partial = seen.filter(
      (event) =>
        event.kind === "taskChanged" &&
        event.data.phase.kind === "working" &&
        (event.data.messages.at(-1)?.text.length ?? 0) > 0,
    );
    expect(partial.length).toBeGreaterThan(0);
    // Coalesced, not one announcement per token.
    expect(partial.length).toBeLessThan(words.length);
  });
});
