import { describe, expect, it, vi } from "vitest";
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

/**
 * Both auxiliary seams behind one stand-in. The conversation's name arrives in
 * the compaction answer rather than a request of its own, so `title` is folded
 * into the compaction response here the way the tool schema asks for it.
 */
function guidanceFor(
  responses: {
    plan?: string;
    compaction?: string;
    title?: string;
  },
  requests: ModelRequest[],
) {
  const compactionAnswer = (): string | undefined => {
    if (!responses.compaction) return undefined;
    if (!responses.title) return responses.compaction;
    try {
      return JSON.stringify({
        ...(JSON.parse(responses.compaction) as Record<string, unknown>),
        title: (JSON.parse(responses.title) as { title?: string }).title,
      });
    } catch {
      return responses.compaction;
    }
  };
  const model = {
    send: async function* (request: ModelRequest) {
      requests.push(request);
      const prompt = request.messages.at(-1)?.content ?? "";
      const response = prompt.includes("Compact the older conversation")
        ? compactionAnswer()
        : responses.plan;
      if (response) yield { kind: "textDelta" as const, text: response };
      yield { kind: "done" as const };
    },
  };
  return { guidanceModel: model, judgementModel: model };
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
          text: "SECOND-WAVE ".repeat(320),
          sequence: 2,
        },
        {
          id: "m4",
          role: "assistant",
          text: "Detailed second answer ".repeat(180),
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
    const guidanceRequests: ModelRequest[] = [];
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      contextBudget: {
        compactAboveEstimatedTokens: 4_000,
        retainRecentEstimatedTokens: 1_000,
      },
      ...guidanceFor(
        {
          plan: JSON.stringify({ items: [] }),
          compaction: JSON.stringify({
            summary:
              "The original question led to a detailed second-stage analysis.",
            retainedActionIds: [],
          }),
          title: JSON.stringify({ title: "Continue second-stage analysis" }),
        },
        guidanceRequests,
      ),
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
    const compactionPrompt = guidanceRequests.find((request) =>
      request.messages
        .at(-1)
        ?.content.includes("Compact the older conversation"),
    );
    expect(compactionPrompt?.messages.at(-1)?.content).toContain(
      "The first exchange established the original question.",
    );
  });

  it("compacts a manually named conversation without requesting a new title", async () => {
    const previous = settledTask({
      title: "My permanent title",
      titleSource: "manual",
      messages: [
        {
          id: "m1",
          role: "user",
          text: "OLDER MATERIAL ".repeat(320),
          sequence: 0,
        },
        { id: "m2", role: "assistant", text: "Earlier answer", sequence: 1 },
      ],
    });
    const guidanceRequests: ModelRequest[] = [];
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      contextBudget: {
        compactAboveEstimatedTokens: 4_000,
        retainRecentEstimatedTokens: 1_000,
      },
      ...guidanceFor(
        {
          plan: JSON.stringify({ items: [] }),
          compaction: JSON.stringify({
            summary: "The earlier material was discussed.",
            retainedActionIds: [],
          }),
          title: JSON.stringify({ title: "Do not use this" }),
        },
        guidanceRequests,
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
      guidanceRequests.some((request) =>
        request.messages
          .at(-1)
          ?.content.includes(
            "Name this conversation from its compacted summary",
          ),
      ),
    ).toBe(false);
  });

  it("keeps a manual rename that arrives while the compaction naming it is still running", async () => {
    const previous = settledTask({
      messages: [
        {
          id: "m1",
          role: "user",
          text: "OLDER MATERIAL ".repeat(320),
          sequence: 0,
        },
        { id: "m2", role: "assistant", text: "Earlier answer", sequence: 1 },
      ],
    });
    let compactionStarted = false;
    let releaseCompaction!: () => void;
    const compactionWaiting = new Promise<void>((resolve) => {
      releaseCompaction = resolve;
    });
    const deps = stubDependencies(() => {});
    const auxiliary = {
      send: async function* (request: ModelRequest) {
        const prompt = request.messages.at(-1)?.content ?? "";
        if (prompt.includes("Compact the older conversation")) {
          compactionStarted = true;
          await compactionWaiting;
          yield {
            kind: "textDelta" as const,
            text: JSON.stringify({
              title: "Late generated title",
              summary: "The earlier material was discussed.",
              retainedActionIds: [],
            }),
          };
        }
        yield { kind: "done" as const };
      },
    };
    const loop = loopFrom({
      ...deps,
      contextBudget: {
        compactAboveEstimatedTokens: 4_000,
        retainRecentEstimatedTokens: 1_000,
      },
      guidanceModel: auxiliary,
      judgementModel: auxiliary,
    });
    loop.restore([previous]);

    const running = loop.start(previous.id, "Continue");
    await until(() => compactionStarted);
    await loop.renameTask(previous.id, "Chosen while compacting");
    releaseCompaction();
    await running;

    expect(loop.snapshot().tasks[0]).toMatchObject({
      title: "Chosen while compacting",
      titleSource: "manual",
      compaction: { revision: 1 },
    });
  });

  it("cancels compaction with its owning turn and publishes no late checkpoint", async () => {
    const previous = settledTask({
      messages: [
        {
          id: "m1",
          role: "user",
          text: "OLDER MATERIAL ".repeat(320),
          sequence: 0,
        },
        { id: "m2", role: "assistant", text: "Earlier answer", sequence: 1 },
      ],
    });
    let compactionStarted = false;
    const model = vi.fn(stubDependencies(() => {}).model.send);
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      contextBudget: {
        compactAboveEstimatedTokens: 4_000,
        retainRecentEstimatedTokens: 1_000,
      },
      judgementModel: {
        send: async function* (request) {
          const prompt = request.messages.at(-1)?.content ?? "";
          if (prompt.includes("Compact the older conversation")) {
            compactionStarted = true;
            await new Promise<void>((resolve) =>
              request.signal?.addEventListener("abort", () => resolve(), {
                once: true,
              }),
            );
          }
          yield { kind: "done" };
        },
      },
      model: { ...deps.model, send: model },
    });
    loop.restore([previous]);

    const running = loop.start(previous.id, "Continue");
    await until(() => compactionStarted);
    await loop.cancel(previous.id);
    await running;

    expect(loop.snapshot().tasks[0]?.compaction).toBeUndefined();
    expect(loop.snapshot().tasks[0]?.phase).toEqual({ kind: "interrupted" });
    expect(model).not.toHaveBeenCalled();
  });

  it("keeps full context when an attempted compaction is unusable", async () => {
    const oldMarker = "KEEP-THIS-CONTEXT ".repeat(300);
    const previous = settledTask({
      messages: [
        { id: "m1", role: "user", text: oldMarker, sequence: 0 },
        { id: "m2", role: "assistant", text: "Earlier answer", sequence: 1 },
      ],
    });
    const requests: ModelRequest[] = [];
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      contextBudget: {
        compactAboveEstimatedTokens: 4_000,
        retainRecentEstimatedTokens: 1_000,
      },
      ...guidanceFor(
        { plan: JSON.stringify({ items: [] }), compaction: "not json" },
        [],
      ),
      model: {
        ...deps.model,
        send: async function* (request) {
          requests.push(request);
          yield { kind: "done" };
        },
      },
    });
    loop.restore([previous]);

    await loop.start(previous.id, "Continue");

    expect(loop.snapshot().tasks[0]?.compaction).toBeUndefined();
    expect(JSON.stringify(requests[0]?.messages)).toContain(
      "KEEP-THIS-CONTEXT",
    );
  });
});
