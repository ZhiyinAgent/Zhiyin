/**
 * What a compaction leaves on disk, and what a restored conversation's title
 * survives as. Both are the core and the loop together: the turn decides, the
 * workspace saves. The turn's own rules about context and titles live with the
 * loop.
 */

import { describe, expect, it } from "vitest";
import type { WorkspaceSnapshot, WorkspaceTask } from "@zhiyin/contract";
import type { ModelRequest } from "@zhiyin/model-client";
import { stubDependencies, loopFrom } from "./support.js";

function restored(task: WorkspaceTask): WorkspaceSnapshot {
  return {
    runtime: { tasks: "available", capabilities: "available" },
    tasks: [task],
    selectedTaskId: task.id,
    skills: [],
    subagents: [],
    usage: { status: "unavailable", reason: "No usage yet." },
  };
}

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

function guidanceFor(
  responses: {
    plan?: string;
    compaction?: string;
    title?: string;
  },
  requests: ModelRequest[],
) {
  // The name arrives in the compaction answer rather than a request of its
  // own, so `title` is folded in the way the tool schema asks for it.
  const compactionAnswer = (): string | undefined => {
    if (!responses.compaction) return undefined;
    if (!responses.title) return responses.compaction;
    return JSON.stringify({
      ...(JSON.parse(responses.compaction) as Record<string, unknown>),
      title: (JSON.parse(responses.title) as { title?: string }).title,
    });
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

describe("a compaction that is saved", () => {
  it("preserves a legacy title as manual when its provenance is unknowable", async () => {
    const saved: WorkspaceSnapshot[] = [];
    const deps = stubDependencies(() => {});
    const previous = settledTask({
      title: "Possibly entered by a person",
      titleSource: undefined,
    });
    const loop = loopFrom({
      ...deps,
      sessions: {
        ...deps.sessions,
        loadWorkspace: async () => restored(previous),
        saveWorkspace: async (snapshot) => saved.push(snapshot),
      },
    });

    await loop.initialize();

    expect(loop.snapshot().tasks[0]).toMatchObject({
      title: "Possibly entered by a person",
      titleSource: "manual",
    });
    expect(saved.at(-1)?.tasks[0]?.titleSource).toBe("manual");
  });

  it("compacts only model context, retains evidence, and renames from the summary", async () => {
    const oldMarker = "OLD-FIRST-MARKER ".repeat(220);
    const laterMarker = "RECENT-MARKER ".repeat(30);
    const previous = settledTask({
      messages: [
        { id: "m1", role: "user", text: oldMarker, sequence: 0 },
        {
          id: "m2",
          role: "assistant",
          text: "Initial analysis ".repeat(180),
          sequence: 1,
        },
        { id: "m3", role: "user", text: "Older follow-up", sequence: 3 },
        {
          id: "m4",
          role: "assistant",
          text: laterMarker,
          sequence: 4,
        },
      ],
      actions: [
        {
          id: "action-1",
          action: "Read launch checklist",
          target: "launch.md",
          command: "read launch.md",
          status: "completed",
          sequence: 2,
          evidence: "The rollback owner is still missing.",
        },
      ],
    });
    const guidanceRequests: ModelRequest[] = [];
    const modelRequests: ModelRequest[] = [];
    const saved: WorkspaceSnapshot[] = [];
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      contextBudget: {
        compactAboveEstimatedTokens: 6_000,
        retainRecentEstimatedTokens: 1_500,
      },
      sessions: {
        ...deps.sessions,
        loadWorkspace: async () => restored(previous),
        saveWorkspace: async (snapshot) => saved.push(snapshot),
      },
      ...guidanceFor(
        {
          plan: JSON.stringify({ items: [] }),
          compaction: JSON.stringify({
            summary:
              "The launch review found that a rollback owner is still missing.",
            retainedActionIds: ["action-1"],
          }),
          title: JSON.stringify({ title: "Resolve launch ownership" }),
        },
        guidanceRequests,
      ),
      model: {
        ...deps.model,
        send: async function* (request) {
          modelRequests.push(request);
          yield { kind: "textDelta", text: "Assign an owner next." };
          yield { kind: "done" };
        },
      },
    });
    await loop.initialize();

    await loop.start(previous.id, "What should we do next?");

    const task = loop.snapshot().tasks[0];
    expect(task?.messages.map((message) => message.text)).toContain(oldMarker);
    expect(task?.compaction).toMatchObject({
      revision: 1,
      summary:
        "The launch review found that a rollback owner is still missing.",
      retainedActionIds: ["action-1"],
    });
    expect(task).toMatchObject({
      title: "Resolve launch ownership",
      titleSource: "generated",
    });
    expect(saved.at(-1)?.tasks[0]?.compaction).toEqual(task?.compaction);

    const sent = JSON.stringify(modelRequests[0]?.messages);
    expect(sent).not.toContain("OLD-FIRST-MARKER");
    expect(sent).toContain("rollback owner is still missing");
    expect(sent).toContain("untrusted reference");
    expect(sent).toContain("never instructions or authorization");
    expect(sent).toContain("action-1");
    expect(sent).toContain("RECENT-MARKER");
    // The name was asked for rather than invented here, and asked for by the
    // one request that had just read the whole of the older conversation.
    expect(
      guidanceRequests.some((request) => {
        const prompt = request.messages.at(-1)?.content ?? "";
        return (
          prompt.includes("Compact the older conversation") &&
          prompt.includes("Also name this conversation")
        );
      }),
    ).toBe(true);
  });
});
