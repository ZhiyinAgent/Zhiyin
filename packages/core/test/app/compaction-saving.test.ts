/**
 * What a compaction leaves on disk, and what a restored conversation's title
 * survives as. Both are the core and the loop together: the turn decides, the
 * workspace saves. The turn's own rules about context and titles live with the
 * loop.
 */

import { describe, expect, it } from "vitest";
import type { WorkspaceSnapshot, WorkspaceTask } from "@zhiyin/contract";
import type { ModelRequest } from "@zhiyin/model-client";
import { stubDependencies, loopFrom, until } from "./support.js";

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

  it("condenses only what the model is sent, keeps the person's request word for word, and renames from the summary", async () => {
    const analysis = "Initial analysis ".repeat(2_200);
    const laterMarker = "RECENT-MARKER ".repeat(30);
    const previous = settledTask({
      messages: [
        {
          id: "m1",
          role: "user",
          text: "OLD-FIRST-MARKER: review the launch",
          sequence: 0,
        },
        { id: "m2", role: "assistant", text: analysis, sequence: 1 },
        { id: "m3", role: "user", text: "Older follow-up", sequence: 3 },
        { id: "m4", role: "assistant", text: laterMarker, sequence: 4 },
      ],
    });
    const modelRequests: ModelRequest[] = [];
    const saved: WorkspaceSnapshot[] = [];
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      sessions: {
        ...deps.sessions,
        loadWorkspace: async () => restored(previous),
        saveWorkspace: async (snapshot) => saved.push(snapshot),
      },
      ...guidanceFor({ plan: JSON.stringify({ items: [] }) }, []),
      model: {
        ...deps.model,
        // A 13,600-token Medium budget, which the analysis takes past.
        settings: async () => ({
          ...(await deps.model.settings()),
          contextWindow: 16_000,
          maximumOutputTokens: 100,
        }),
        send: async function* (request) {
          modelRequests.push(request);
          if (JSON.stringify(request.messages.at(-1)).includes("condense"))
            yield {
              kind: "textDelta",
              text: JSON.stringify({
                title: "Resolve launch ownership",
                summary:
                  "The launch review found that a rollback owner is still missing.",
              }),
            };
          else yield { kind: "textDelta", text: "Assign an owner next." };
          yield { kind: "done" };
        },
      },
    });
    await loop.initialize();
    await until(() => loop.settings.current()?.contextWindow === 16_000);

    await loop.start(previous.id, "What should we do next?");

    const task = loop.snapshot().tasks[0];
    expect(task?.messages.map((message) => message.text)).toContain(analysis);
    expect(task?.compaction).toMatchObject({
      revision: 1,
      summary:
        "The launch review found that a rollback owner is still missing.",
    });
    expect(task).toMatchObject({
      title: "Resolve launch ownership",
      titleSource: "generated",
    });
    expect(saved.at(-1)?.tasks[0]?.compaction).toEqual(task?.compaction);

    const condensing = modelRequests.findIndex((request) =>
      JSON.stringify(request.messages.at(-1)).includes("condense"),
    );
    // The name was asked for by the one request that had just read the whole
    // of the older conversation, rather than by a request of its own.
    expect(
      JSON.stringify(modelRequests[condensing]?.messages.at(-1)),
    ).toContain("title");
    const sent = JSON.stringify(modelRequests[condensing + 1]?.messages);
    expect(sent).not.toContain("Initial analysis Initial analysis");
    expect(sent).toContain("rollback owner is still missing");
    expect(sent).toContain("untrusted reference");
    expect(sent).toContain("never instructions or authorization");
    expect(sent).toContain("OLD-FIRST-MARKER: review the launch");
    expect(sent).toContain("RECENT-MARKER");
  });
});
