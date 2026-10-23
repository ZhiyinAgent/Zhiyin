import { describe, expect, it } from "vitest";
import {
  emptyConversationLists,
  estimatedTokens,
  type WorkspaceTask,
} from "@zhiyin/contract";
import type { ModelRequest } from "@zhiyin/model-client";
import { loopFrom, stubDependencies } from "./support.js";

/** A 32k model, chosen after the conversation grew on a larger one. */
const window32k = {
  model: "small-32k",
  contextWindow: 32_000,
  maximumOutputTokens: 4_000,
};

/** Six parts of about 7k tokens each: past the whole window together. */
const pastTheWindow: WorkspaceTask["messages"] = Array.from(
  { length: 6 },
  (_, index) => ({
    id: `m${index + 1}`,
    role: index % 2 ? ("assistant" as const) : ("user" as const),
    text: `PART-${index + 1} ${"filler text ".repeat(1_750)}`,
    sequence: index,
  }),
);

function asksToCondense(request: ModelRequest): boolean {
  const last = request.messages.at(-1)?.content;
  return typeof last === "string" && last.includes('kind="condense"');
}

/** Every part a request carries, word for word or through an earlier summary. */
const partsIn = (request: ModelRequest) => [
  ...new Set(JSON.stringify(request.messages).match(/PART-\d/g) ?? []),
];

describe("a conversation already past its model's window", () => {
  it("is condensed in two chunks, with no request past the window and no message dropped", async () => {
    const requests: ModelRequest[] = [];
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      modelWindow: window32k,
      model: {
        ...deps.model,
        send: async function* (request: ModelRequest) {
          requests.push(request);
          // A summariser that keeps everything it was shown, as the prompt asks.
          const text = asksToCondense(request)
            ? JSON.stringify({
                summary: `Covered ${partsIn(request).sort().join(" ")}.`,
              })
            : "Carried on.";
          yield { kind: "textDelta" as const, text };
          yield { kind: "done" as const };
        },
      },
    });
    loop.restore([
      {
        id: "task-1",
        title: "Long work",
        titleSource: "manual",
        updatedLabel: "Earlier",
        updatedAt: "2026-10-05T09:00:00.000Z",
        ...emptyConversationLists,
        messages: pastTheWindow,
        actions: [],
        phase: { kind: "interrupted" },
      },
    ]);

    await loop.start("task-1", "Continue");

    const condensing = requests.filter(asksToCondense);
    expect(condensing).toHaveLength(2);
    for (const request of requests)
      expect(
        estimatedTokens(JSON.stringify(request.messages)) +
          estimatedTokens(JSON.stringify(request.tools ?? [])),
      ).toBeLessThanOrEqual(32_000 - 4_000);
    // The second chunk reads the first one's summary, not its messages; the
    // person's words are carried beside it, the model's are not.
    expect(JSON.stringify(condensing[1]?.messages)).not.toContain(
      "PART-2 filler",
    );
    const reply = requests.at(-1);
    expect(reply && asksToCondense(reply)).toBe(false);
    expect(reply && partsIn(reply).sort()).toEqual(
      pastTheWindow.map((_, index) => `PART-${index + 1}`),
    );
    expect(loop.snapshot().tasks[0]?.condensings).toEqual([
      expect.objectContaining({ outcome: "condensed", messages: 6 }),
    ]);
  });
});
