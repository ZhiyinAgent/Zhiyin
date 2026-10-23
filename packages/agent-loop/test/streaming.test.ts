import { describe, expect, it } from "vitest";
import type { AppEvent } from "@zhiyin/contract";
import { stubDependencies, loopFrom } from "./support.js";

const words = Array.from({ length: 400 }, (_, index) => `word${index} `);

/** Tokens arrive in bursts of fifty, a little apart, as a provider sends them. */
function loopEmitting(seen: AppEvent[]) {
  const deps = stubDependencies((event: AppEvent) => seen.push(event));
  return loopFrom({
    ...deps,
    // Shown as it arrives, so what the window is told is the stream itself.
    revealDelayMs: 0,
    model: {
      ...deps.model,
      send: async function* () {
        for (const [index, text] of words.entries()) {
          yield { kind: "textDelta" as const, text };
          if ((index + 1) % 50 === 0)
            await new Promise((resolve) => setTimeout(resolve, 60));
        }
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

    const whole = words.join("");
    const partial = seen.flatMap((event) => {
      if (event.kind !== "taskChanged" || event.data.phase.kind !== "working")
        return [];
      const last = event.data.messages.at(-1);
      return last?.role === "assistant" &&
        last.text.length > 0 &&
        last.text.length < whole.length
        ? [last.text]
        : [];
    });
    // Shown while it is still being written, growing, more than once.
    expect(new Set(partial).size).toBeGreaterThanOrEqual(2);
    // Coalesced: far fewer announcements than tokens.
    expect(partial.length).toBeLessThan(words.length / 4);
  });
});
