import { describe, expect, it } from "vitest";
import type { WorkspaceTask } from "@zhiyin/contract";
import type { ModelRequest } from "@zhiyin/model-client";
import { loopFrom, stubDependencies, until } from "./support.js";

/** A 13,600-token Medium budget. */
const smallWindow = {
  model: "small",
  contextWindow: 16_000,
  maximumOutputTokens: 100,
};

/** Well within that budget, with older rounds to condense. */
const withinItsBudget: WorkspaceTask["messages"] = [
  { id: "m1", role: "user", text: "Read the older material", sequence: 0 },
  {
    id: "m2",
    role: "assistant",
    text: "OLDER MATERIAL ".repeat(800),
    sequence: 1,
  },
  { id: "m3", role: "user", text: "Next step", sequence: 2 },
  { id: "m4", role: "assistant", text: "Next answer", sequence: 3 },
];

function settledTask(): WorkspaceTask {
  return {
    id: "task-1",
    title: "Release discussion",
    titleSource: "manual",
    updatedLabel: "Earlier",
    messages: withinItsBudget,
    actions: [],
    phase: {
      kind: "completed",
      outcome: { title: "Response complete", summary: "Done." },
    },
  };
}

function asksToCondense(request: ModelRequest): boolean {
  const last = request.messages.at(-1)?.content;
  return typeof last === "string" && last.includes('kind="condense"');
}

/** The conversation's own model; `hold` keeps a request open until released. */
function model(
  requests: ModelRequest[],
  hold: { condensing?: Promise<void>; reply?: Promise<void> } = {},
) {
  const deps = stubDependencies(() => {});
  return loopFrom({
    ...deps,
    modelWindow: smallWindow,
    model: {
      ...deps.model,
      send: async function* (request: ModelRequest) {
        requests.push(request);
        if (asksToCondense(request)) {
          await hold.condensing;
          yield {
            kind: "textDelta" as const,
            text: JSON.stringify({ summary: "The older material was read." }),
          };
        } else {
          await hold.reply;
          yield { kind: "textDelta" as const, text: "Carried on." };
        }
        yield { kind: "done" as const };
      },
    },
  });
}

function released() {
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  return { held, release };
}

describe("condensing on request", () => {
  it("condenses at once while nothing runs, though the conversation is within its budget", async () => {
    const requests: ModelRequest[] = [];
    const loop = model(requests);
    loop.restore([settledTask()]);

    await loop.condenseNow("task-1");

    const task = loop.snapshot().tasks[0];
    expect(requests).toHaveLength(1);
    expect(requests.every(asksToCondense)).toBe(true);
    expect(task?.condensings).toEqual([
      expect.objectContaining({ outcome: "condensed", throughMessageId: "m2" }),
    ]);
    expect(task?.compaction?.throughMessageId).toBe("m2");
    expect(task?.phase.kind).toBe("completed");
  });

  it("says so when there is nothing old enough to condense", async () => {
    const requests: ModelRequest[] = [];
    const loop = model(requests);
    loop.restore([{ ...settledTask(), messages: withinItsBudget.slice(2) }]);

    await loop.condenseNow("task-1");

    expect(requests).toHaveLength(0);
    expect(loop.snapshot().tasks[0]?.condensings).toEqual([
      expect.objectContaining({
        outcome: "failed",
        reason: "nothing-to-condense",
      }),
    ]);
  });

  it("asked while a turn runs, condenses before the next request to the model", async () => {
    const requests: ModelRequest[] = [];
    const reply = released();
    const loop = model(requests, { reply: reply.held });
    loop.restore([settledTask()]);

    const running = loop.start("task-1", "Continue");
    await until(() => requests.length === 1);
    await loop.condenseNow("task-1");
    expect(requests).toHaveLength(1);
    reply.release();
    await running;
    await loop.start("task-1", "And now");

    expect(requests.map(asksToCondense)).toEqual([false, true, false]);
    expect(JSON.stringify(requests[2]?.messages)).not.toContain(
      "OLDER MATERIAL",
    );
  });

  it("holds a message sent while it condenses, then sends it on the condensed conversation", async () => {
    const requests: ModelRequest[] = [];
    const condensing = released();
    const loop = model(requests, { condensing: condensing.held });
    loop.restore([settledTask()]);

    const condensed = loop.condenseNow("task-1");
    await until(() => requests.length === 1);
    const sent = loop.start("task-1", "Continue");
    condensing.release();
    await Promise.all([condensed, sent]);

    expect(requests.map(asksToCondense)).toEqual([true, false]);
    const asked = JSON.stringify(requests[1]?.messages);
    expect(asked).toContain("The older material was read.");
    expect(asked).not.toContain("OLDER MATERIAL");
    expect(asked).toContain("Continue");
  });
});

describe("the person's instructions", () => {
  it("are quoted word for word in the summary of each condensing, the second carrying forward the first", async () => {
    const heading = "## Your instructions and constraints, quoted exactly";
    const instruction = "Never touch the changelog.";
    const requests: ModelRequest[] = [];
    const summaries: string[] = [];
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      modelWindow: smallWindow,
      model: {
        ...deps.model,
        send: async function* (request: ModelRequest) {
          requests.push(request);
          if (!asksToCondense(request)) {
            yield {
              kind: "textDelta" as const,
              text: "LONG ANSWER ".repeat(800),
            };
            yield { kind: "done" as const };
            return;
          }
          // A summariser that follows the prompt: the person's instructions it
          // is shown, and every quote an earlier summary kept.
          const quotes = new Set<string>();
          for (const message of request.messages.slice(0, -1)) {
            if (message.role !== "user" || typeof message.content !== "string")
              continue;
            if (message.content.startsWith("<zhiyin-notice"))
              for (const line of message.content.split("\n"))
                if (line.startsWith("> ")) quotes.add(line.slice(2));
            if (message.content.startsWith("Never"))
              quotes.add(message.content);
          }
          const summary = [
            "## Goal",
            "",
            "Ship the release.",
            "",
            heading,
            "",
            ...[...quotes].map((quote) => `> ${quote}`),
          ].join("\n");
          summaries.push(summary);
          yield {
            kind: "textDelta" as const,
            text: JSON.stringify({ summary }),
          };
          yield { kind: "done" as const };
        },
      },
    });
    loop.restore([
      {
        ...settledTask(),
        messages: [
          { id: "m1", role: "user", text: instruction, sequence: 0 },
          ...withinItsBudget.slice(1),
        ],
      },
    ]);

    await loop.condenseNow("task-1");
    await loop.start("task-1", "Keep going");
    await loop.condenseNow("task-1");

    expect(summaries).toHaveLength(2);
    for (const summary of summaries)
      expect(summary.split(heading)[1]).toContain(`> ${instruction}`);
    const second = requests.filter(asksToCondense)[1];
    expect(JSON.stringify(second?.messages.slice(0, -1))).not.toContain(
      `"content":"${instruction}"`,
    );
    expect(JSON.stringify(second?.messages.at(-1))).toContain(
      "Carry forward unchanged every quote an earlier summary kept",
    );
  });
});
