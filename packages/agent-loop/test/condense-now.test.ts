import { describe, expect, it } from "vitest";
import { emptyConversationLists, type WorkspaceTask } from "@zhiyin/contract";
import type { ModelRequest } from "@zhiyin/model-client";
import { loopAndHost, loopFrom, stubDependencies, until } from "./support.js";

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
    updatedAt: "2026-10-05T09:00:00.000Z",
    ...emptyConversationLists,
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
  clock?: { readonly now: Date; readonly timeZone: string },
  window: typeof smallWindow = smallWindow,
) {
  const deps = stubDependencies(() => {});
  return loopFrom({
    ...deps,
    ...(clock ? { now: () => clock.now, timeZone: clock.timeZone } : {}),
    modelWindow: window,
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
  it("carries over the start and end of a latest request in Chinese past a tenth of the budget, measured in estimated tokens", async () => {
    const requests: ModelRequest[] = [];
    const loop = model(requests);
    const long = `开头${"中".repeat(3_000)}结尾`;
    loop.restore([
      {
        ...settledTask(),
        messages: withinItsBudget.map((message) =>
          message.id === "m1" ? { ...message, text: long } : message,
        ),
      },
    ]);

    await loop.condenseNow("task-1");

    const carried = loop.snapshot().tasks[0]?.compaction?.carried ?? "";
    expect(carried).toContain(
      "The person's latest request, its start and its end:",
    );
    expect(carried).toContain("开头");
    expect(carried).toContain("结尾");
    // A tenth of the 13,600-token budget, each character about a token.
    const kept = [...carried].filter((character) => character === "中").length;
    expect(kept).toBeGreaterThan(1_300);
    expect(kept).toBeLessThanOrEqual(1_360);
  });

  it("asks for a summary a tenth of a small budget long, where the reply could hold more", async () => {
    const requests: ModelRequest[] = [];
    // A 14,400-token Low budget, with room for a 16,000-token reply.
    const loop = model(requests, {}, undefined, {
      model: "roomy",
      contextWindow: 32_000,
      maximumOutputTokens: 32_000,
    });
    loop.restore([settledTask()]);

    await loop.condenseNow("task-1");

    expect(requests.filter(asksToCondense)).toHaveLength(1);
    expect(requests[0]?.messages.at(-1)?.content).toContain(
      "about 1,440 tokens",
    );
  });

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

  it("asks a large window's summary for at most half its reply, leaving room for reasoning and its wrapper", async () => {
    const requests: ModelRequest[] = [];
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      // A 170,000-token budget, whose tenth is past the 16,000-token reply a
      // condensing has.
      modelWindow: {
        model: "large",
        contextWindow: 200_000,
        maximumOutputTokens: 64_000,
      },
      model: {
        ...deps.model,
        send: async function* (request: ModelRequest) {
          requests.push(request);
          yield {
            kind: "textDelta" as const,
            text: JSON.stringify({ summary: "The older material was read." }),
          };
          yield { kind: "done" as const };
        },
      },
    });
    const task = settledTask();
    // Older rounds past the share of the budget kept as it is.
    loop.restore([
      {
        ...task,
        messages: task.messages.map((message) =>
          message.id === "m2"
            ? { ...message, text: "OLDER MATERIAL ".repeat(12_000) }
            : message,
        ),
      },
    ]);

    await loop.condenseNow("task-1");

    const request = requests.find(asksToCondense);
    const ask = String(request?.messages.at(-1)?.content);
    const asked = Number(
      /Keep it under about ([\d,]+) tokens\./
        .exec(ask)?.[1]
        ?.replaceAll(",", ""),
    );
    expect(request?.maximumOutputTokens).toBe(16_000);
    expect(asked).toBe(8_000);
  });

  it("tells the model condensing today's date where the person is, not in UTC", async () => {
    const requests: ModelRequest[] = [];
    // 04:00 on Sunday 18 October in Beijing, still the 17th in UTC and Europe.
    const loop = model(
      requests,
      {},
      { now: new Date("2026-10-17T20:00:00.000Z"), timeZone: "Asia/Shanghai" },
    );
    loop.restore([settledTask()]);

    await loop.condenseNow("task-1");

    expect(requests[0]?.messages[0]?.content).toContain(
      "Today is Sunday, 18 October 2026.",
    );
  });

  it("describes the conversation's own folder to the condensing, as to its turns", async () => {
    const requests: ModelRequest[] = [];
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      modelWindow: smallWindow,
      workspace: {
        ...deps.workspace,
        describeWorkspace: async (conversationId) => ({
          rootName: conversationId === "task-1" ? "Reports" : "Elsewhere",
          entries: [],
          truncated: false,
        }),
      },
      model: {
        ...deps.model,
        send: async function* (request: ModelRequest) {
          requests.push(request);
          yield {
            kind: "textDelta" as const,
            text: JSON.stringify({ summary: "The older material was read." }),
          };
          yield { kind: "done" as const };
        },
      },
    });
    loop.restore([settledTask()]);

    await loop.condenseNow("task-1");

    expect(requests[0]?.messages[0]?.content).toContain(
      "Current workspace: Reports",
    );
  });

  it("wakes the conversation for a job that ended while it condensed", async () => {
    const requests: ModelRequest[] = [];
    const { held, release } = released();
    const loop = model(requests, { condensing: held });
    loop.restore([settledTask()]);

    const condensing = loop.condenseNow("task-1");
    await until(() => requests.length === 1);
    loop.commandEnded("task-1", "Job J1 (npm run build) finished.", true);
    release();
    await condensing;
    await until(() => requests.length === 2);

    expect(asksToCondense(requests[1] as ModelRequest)).toBe(false);
    expect(JSON.stringify(requests[1]?.messages)).toContain(
      "Job J1 (npm run build) finished.",
    );
  });

  it("wakes the conversation for a job that ended while it condensed, though the condensing failed", async () => {
    const requests: ModelRequest[] = [];
    const deps = stubDependencies(() => {});
    const { host } = loopAndHost({
      ...deps,
      model: {
        ...deps.model,
        send: async function* (request: ModelRequest) {
          requests.push(request);
          yield { kind: "textDelta" as const, text: "Carried on." };
          yield { kind: "done" as const };
        },
      },
    });
    const { held, release } = released();
    let entered = 0;
    // The condensing cannot enter the folder; the turn woken after it can.
    host.enterFolderOf = async () => {
      entered += 1;
      if (entered === 1) {
        await held;
        throw new Error("The folder could not be entered.");
      }
    };
    host.app.restore([settledTask()]);

    const condensing = host.app.condenseNow("task-1");
    await until(() => entered === 1);
    host.app.commandEnded("task-1", "Job J1 (npm run build) finished.", true);
    release();
    await expect(condensing).rejects.toThrow();
    await until(() => requests.length === 1);

    expect(asksToCondense(requests[0] as ModelRequest)).toBe(false);
    expect(JSON.stringify(requests[0]?.messages)).toContain(
      "Job J1 (npm run build) finished.",
    );
  });

  it("condenses from the answer that followed a restart, and nothing of the attempt it replaced", async () => {
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      modelWindow: smallWindow,
      model: {
        ...deps.model,
        send: async function* () {
          yield {
            kind: "textDelta" as const,
            text: '{"summary":"The older mat',
          };
          // The connection dropped mid-answer: what came before is void.
          yield {
            kind: "restarting" as const,
            restart: 1,
            maximumRestarts: 2,
            delayMs: 0,
            reason: "networkFailure" as const,
            message: "The connection dropped.",
          };
          yield {
            kind: "textDelta" as const,
            text: JSON.stringify({ summary: "The older material was read." }),
          };
          yield { kind: "done" as const };
        },
      },
    });
    loop.restore([settledTask()]);

    await loop.condenseNow("task-1");

    expect(loop.snapshot().tasks[0]?.condensings).toEqual([
      expect.objectContaining({
        outcome: "condensed",
        summary: "The older material was read.",
      }),
    ]);
  });

  it("says once in the conversation when there is nothing old enough, however often it is asked", async () => {
    const requests: ModelRequest[] = [];
    const loop = model(requests);
    loop.restore([{ ...settledTask(), messages: withinItsBudget.slice(2) }]);

    await loop.condenseNow("task-1");
    await loop.condenseNow("task-1");
    await loop.condenseNow("task-1");

    expect(requests).toHaveLength(0);
    expect(loop.snapshot().tasks[0]?.condensings).toEqual([
      expect.objectContaining({
        outcome: "failed",
        reason: "nothing-to-condense",
      }),
    ]);
  });

  it("asked again while it compacts, waits for that one instead of queueing another for the next message", async () => {
    const requests: ModelRequest[] = [];
    const condensing = released();
    const loop = model(requests, { condensing: condensing.held });
    loop.restore([settledTask()]);

    const first = loop.condenseNow("task-1");
    await until(() => requests.length === 1);
    const second = loop.condenseNow("task-1");
    condensing.release();
    await Promise.all([first, second]);
    await loop.start("task-1", "Continue");

    expect(requests.map(asksToCondense)).toEqual([true, false]);
    expect(loop.snapshot().tasks[0]?.condensings).toHaveLength(1);
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

  it("says the conversation is compacting while it condenses, and no longer once done", async () => {
    const requests: ModelRequest[] = [];
    const condensing = released();
    const loop = model(requests, { condensing: condensing.held });
    loop.restore([settledTask()]);

    const condensed = loop.condenseNow("task-1");
    await until(() => requests.length === 1);
    expect(loop.snapshot().compacting).toEqual([
      { taskId: "task-1", since: expect.any(String) },
    ]);
    condensing.release();
    await condensed;

    expect(loop.snapshot().compacting).toBeUndefined();
  });

  it("is no longer compacting when the request to condense fails", async () => {
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      modelWindow: smallWindow,
      model: {
        ...deps.model,
        // eslint-disable-next-line require-yield
        send: async function* () {
          throw new Error("The provider is overloaded.");
        },
      },
    });
    loop.restore([settledTask()]);

    await loop.condenseNow("task-1").catch(() => undefined);

    expect(loop.snapshot().compacting).toBeUndefined();
  });

  it("places what it condensed where it began: after everything already said, and before a message sent while it ran", async () => {
    const requests: ModelRequest[] = [];
    const condensing = released();
    const loop = model(requests, { condensing: condensing.held });
    loop.restore([settledTask()]);

    const condensed = loop.condenseNow("task-1");
    await until(() => requests.length === 1);
    const sent = loop.start("task-1", "Remember everything?");
    condensing.release();
    await Promise.all([condensed, sent]);

    const task = loop.snapshot().tasks[0]!;
    // Through m2; m3 and m4 are kept word for word, and still come before it.
    const [card] = task.condensings;
    expect(card).toMatchObject({
      outcome: "condensed",
      throughMessageId: "m2",
    });
    const place = (text: string) =>
      task.messages.find((message) => message.text === text)?.sequence;
    expect(place("Next answer")).toBeLessThan(card!.sequence);
    expect(place("Remember everything?")).toBeGreaterThanOrEqual(
      card!.sequence,
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
