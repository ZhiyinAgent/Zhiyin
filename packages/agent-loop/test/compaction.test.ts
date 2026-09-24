import { describe, expect, it } from "vitest";
import type { WorkspaceTask } from "@zhiyin/contract";
import type { ModelRequest } from "@zhiyin/model-client";
import { stubDependencies, until, loopFrom } from "./support.js";

function settledTask(overrides: Partial<WorkspaceTask> = {}): WorkspaceTask {
  return {
    id: "task-1",
    title: "Release discussion",
    titleSource: "generated",
    updatedLabel: "Earlier",
    messages: [],
    actions: [],
    phase: {
      kind: "completed",
      outcome: { title: "Response complete", summary: "Done." },
    },
    ...overrides,
  };
}

/** Both auxiliary seams behind one stand-in, answering with the plan. */
function guidanceFor(responses: { plan?: string }, requests: ModelRequest[]) {
  const model = {
    send: async function* (request: ModelRequest) {
      requests.push(request);
      if (responses.plan)
        yield { kind: "textDelta" as const, text: responses.plan };
      yield { kind: "done" as const };
    },
  };
  return { guidanceModel: model, judgementModel: model };
}

/**
 * A 13,600-token Medium budget, with room past it for the request that asks
 * for the summary.
 */
const smallWindow = {
  model: "small",
  contextWindow: 16_000,
  maximumOutputTokens: 100,
};

/** About 13k tokens of earlier conversation: past that budget with the rest. */
const pastItsBudget: WorkspaceTask["messages"] = [
  {
    id: "m1",
    role: "user",
    text: "OLDER MATERIAL ".repeat(2_600),
    sequence: 0,
  },
  { id: "m2", role: "assistant", text: "Earlier answer", sequence: 1 },
];

function asksToCondense(request: ModelRequest): boolean {
  const last = request.messages.at(-1)?.content;
  return typeof last === "string" && last.includes('kind="condense"');
}

/**
 * The conversation's own model: `summary` answers a request to condense, and
 * anything else is answered with `reply`.
 */
function condensing(
  summary: () => string | Promise<string>,
  requests: ModelRequest[],
  reply?: string,
) {
  return {
    ...stubDependencies(() => {}).model,
    send: async function* (request: ModelRequest) {
      requests.push(request);
      if (asksToCondense(request))
        yield { kind: "textDelta" as const, text: await summary() };
      else if (reply) yield { kind: "textDelta" as const, text: reply };
      yield { kind: "done" as const };
    },
  };
}

describe("conversation context", () => {
  it("uses an LLM title based on the first message", async () => {
    const guidanceRequests: ModelRequest[] = [];
    const deps = stubDependencies(() => {}, [
      { kind: "textDelta", text: "Here is the review." },
      { kind: "done" },
    ]);
    const loop = loopFrom({
      ...deps,
      ...guidanceFor(
        {
          plan: JSON.stringify({
            conversationTitle: "Review launch readiness",
            items: [],
          }),
        },
        guidanceRequests,
      ),
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Can you review whether the launch is ready?");

    expect(loop.snapshot().tasks[0]).toMatchObject({
      title: "Review launch readiness",
      titleSource: "generated",
    });
    expect(guidanceRequests[0]?.messages.at(-1)?.content).toContain(
      "Can you review whether the launch is ready?",
    );
  });

  it("keeps a useful fallback when the first generated title is unusable", async () => {
    const deps = stubDependencies(() => {}, [{ kind: "done" }]);
    const loop = loopFrom({
      ...deps,
      ...guidanceFor(
        {
          plan: JSON.stringify({
            conversationTitle: "x".repeat(73),
            items: [],
          }),
        },
        [],
      ),
    });
    const taskId = await loop.createTask();

    await loop.start(
      taskId,
      "Review the launch readiness material before tomorrow's meeting",
    );

    expect(loop.snapshot().tasks[0]).toMatchObject({
      title: "Review the launch readiness material be…",
      titleSource: "generated",
    });
  });

  it("never replaces a manually entered title", async () => {
    const guidanceRequests: ModelRequest[] = [];
    const deps = stubDependencies(() => {}, [{ kind: "done" }]);
    const loop = loopFrom({
      ...deps,
      ...guidanceFor(
        {
          plan: JSON.stringify({
            conversationTitle: "Generated title",
            items: [],
          }),
        },
        guidanceRequests,
      ),
    });
    const taskId = await loop.createTask();
    await loop.renameTask(taskId, "My launch notes");

    await loop.start(taskId, "Review the launch");

    expect(loop.snapshot().tasks[0]).toMatchObject({
      title: "My launch notes",
      titleSource: "manual",
    });
    expect(guidanceRequests[0]?.messages.at(-1)?.content).not.toContain(
      "conversationTitle",
    );
  });

  it("resumes from a durable summary without removing the human transcript", async () => {
    const previous = settledTask({
      title: "Investigate latency",
      messages: [
        { id: "m1", role: "user", text: "OLD-CONTEXT", sequence: 0 },
        { id: "m2", role: "assistant", text: "Older answer", sequence: 1 },
        { id: "m3", role: "user", text: "Recent question", sequence: 2 },
        { id: "m4", role: "assistant", text: "Recent answer", sequence: 3 },
      ],
      compaction: {
        revision: 2,
        throughMessageId: "m2",
        summary: "Earlier work isolated the latency to startup.",
        retainedActionIds: [],
        createdAt: "2026-09-02T18:00:00.000Z",
      },
    });
    const requests: ModelRequest[] = [];
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      model: {
        ...deps.model,
        send: async function* (request) {
          requests.push(request);
          yield { kind: "done" };
        },
      },
    });
    loop.restore([previous]);

    await loop.start(previous.id, "Continue the investigation");

    const sent = JSON.stringify(requests[0]?.messages);
    expect(sent).toContain("Earlier work isolated the latency to startup.");
    expect(sent).not.toContain("OLD-CONTEXT");
    expect(sent).toContain("Recent question");
    expect(loop.snapshot().tasks[0]?.messages[0]?.text).toBe("OLD-CONTEXT");
  });

  it("increments an existing compaction and regenerates its automatic title", async () => {
    const previous = settledTask({
      title: "Earlier generated title",
      messages: [
        { id: "m1", role: "user", text: "First question", sequence: 0 },
        { id: "m2", role: "assistant", text: "First answer", sequence: 1 },
        {
          id: "m3",
          role: "user",
          text: "SECOND-WAVE ".repeat(2_900),
          sequence: 2,
        },
        {
          id: "m4",
          role: "assistant",
          text: "Detailed second answer ".repeat(200),
          sequence: 3,
        },
      ],
      compaction: {
        revision: 1,
        throughMessageId: "m2",
        summary: "The first exchange established the original question.",
        retainedActionIds: [],
        createdAt: "2026-09-02T18:00:00.000Z",
      },
    });
    const requests: ModelRequest[] = [];
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      modelWindow: smallWindow,
      model: condensing(
        () =>
          JSON.stringify({
            title: "Continue second-stage analysis",
            summary:
              "The original question led to a detailed second-stage analysis.",
          }),
        requests,
      ),
      ...guidanceFor({ plan: JSON.stringify({ items: [] }) }, []),
    });
    loop.restore([previous]);

    await loop.start(previous.id, "Continue once more");

    expect(loop.snapshot().tasks[0]).toMatchObject({
      title: "Continue second-stage analysis",
      compaction: {
        revision: 2,
        summary:
          "The original question led to a detailed second-stage analysis.",
      },
    });
    expect(JSON.stringify(requests.find(asksToCondense)?.messages)).toContain(
      "The first exchange established the original question.",
    );
  });

  it("condenses a manually named conversation without asking for a new title", async () => {
    const previous = settledTask({
      title: "My permanent title",
      titleSource: "manual",
      messages: pastItsBudget,
    });
    const requests: ModelRequest[] = [];
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      modelWindow: smallWindow,
      model: condensing(
        () =>
          JSON.stringify({
            title: "Do not use this",
            summary: "The earlier material was discussed.",
          }),
        requests,
      ),
    });
    loop.restore([previous]);

    await loop.start(previous.id, "Continue");

    expect(loop.snapshot().tasks[0]).toMatchObject({
      title: "My permanent title",
      titleSource: "manual",
      compaction: { revision: 1 },
    });
    expect(
      requests.find(asksToCondense)?.messages.at(-1)?.content,
    ).not.toContain('"title"');
  });

  it("keeps a manual rename that arrives while the condensing naming it is still running", async () => {
    let compactionStarted = false;
    let releaseCompaction!: () => void;
    const compactionWaiting = new Promise<void>((resolve) => {
      releaseCompaction = resolve;
    });
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      modelWindow: smallWindow,
      model: condensing(async () => {
        compactionStarted = true;
        await compactionWaiting;
        return JSON.stringify({
          title: "Late generated title",
          summary: "The earlier material was discussed.",
        });
      }, []),
    });
    loop.restore([settledTask({ messages: pastItsBudget })]);

    const running = loop.start("task-1", "Continue");
    await until(() => compactionStarted);
    await loop.renameTask("task-1", "Chosen while compacting");
    releaseCompaction();
    await running;

    expect(loop.snapshot().tasks[0]).toMatchObject({
      title: "Chosen while compacting",
      titleSource: "manual",
      compaction: { revision: 1 },
    });
  });

  it("cancels condensing with its owning turn and publishes no late checkpoint", async () => {
    let compactionStarted = false;
    const requests: ModelRequest[] = [];
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      modelWindow: smallWindow,
      model: {
        ...deps.model,
        send: async function* (request: ModelRequest) {
          requests.push(request);
          if (asksToCondense(request)) {
            compactionStarted = true;
            await new Promise<void>((resolve) =>
              request.signal?.addEventListener("abort", () => resolve(), {
                once: true,
              }),
            );
          }
          yield { kind: "done" as const };
        },
      },
    });
    loop.restore([settledTask({ messages: pastItsBudget })]);

    const running = loop.start("task-1", "Continue");
    await until(() => compactionStarted);
    await loop.cancel("task-1");
    await running;

    expect(loop.snapshot().tasks[0]?.compaction).toBeUndefined();
    expect(loop.snapshot().tasks[0]?.phase).toEqual({ kind: "interrupted" });
    expect(requests.filter((request) => !asksToCondense(request))).toEqual([]);
  });

  it("keeps full context when an attempted condensing is unusable", async () => {
    const requests: ModelRequest[] = [];
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      modelWindow: smallWindow,
      model: condensing(() => "not json", requests),
    });
    loop.restore([settledTask({ messages: pastItsBudget })]);

    await loop.start("task-1", "Continue");

    expect(loop.snapshot().tasks[0]?.compaction).toBeUndefined();
    expect(requests.some(asksToCondense)).toBe(true);
    expect(
      JSON.stringify(
        requests.find((request) => !asksToCondense(request))?.messages,
      ),
    ).toContain("OLDER MATERIAL");
  });
});

describe("the size a picture counts for", () => {
  it("does not condense a conversation because it carries a large picture", async () => {
    const sent: ModelRequest[] = [];
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      acceptsImages: true,
      // A 54,400-token budget: far below the picture's encoded size, far
      // above the text's and the few thousand tokens a provider bills for it.
      modelWindow: {
        model: "small",
        contextWindow: 64_000,
        maximumOutputTokens: 1_000,
      },
      model: condensing(
        () => JSON.stringify({ summary: "Condensed." }),
        sent,
        "Seen.",
      ),
      sessions: {
        ...deps.sessions,
        // About a megabyte encoded; a provider bills a few thousand tokens.
        readPicture: async () => ({
          status: "ready" as const,
          mediaType: "image/png",
          data: "A".repeat(1_000_000),
        }),
      },
    });
    loop.restore([
      settledTask({
        messages: [
          { id: "m1", role: "user", text: "Look at the page", sequence: 0 },
          {
            id: "m2",
            role: "assistant",
            text: "It shows the release checklist. ".repeat(100),
            sequence: 1,
          },
        ],
        modelHistory: [
          { id: "h1", kind: "message", messageId: "m1" },
          {
            id: "h2",
            kind: "pictures",
            text: "The picture:",
            pictures: [{ mediaType: "image/png", source: "picture-1" }],
          },
          { id: "h3", kind: "message", messageId: "m2" },
        ],
      }),
    ]);

    await loop.start("task-1", "What did it show?");

    expect(JSON.stringify(sent)).toContain("A".repeat(1_000));
    expect(sent.some(asksToCondense)).toBe(false);
    expect(loop.snapshot().tasks[0]?.compaction).toBeUndefined();
  });
});
