import { describe, expect, it } from "vitest";
import { emptyConversationLists, type SpecialistRun } from "@zhiyin/contract";
import type { WorkspaceTask } from "./conversationState.js";
import { answeredMessage, timelineTask } from "./turns.js";

const action = (id: string, sequence: number, specialistRunId?: string) => ({
  id,
  sequence,
  action: "Read a file",
  target: `${id}.md`,
  status: "completed" as const,
  ...(specialistRunId ? { specialistRunId } : {}),
});

const run = (
  id: string,
  status: SpecialistRun["status"],
  startedAt: string,
  actionIds: string[] = [],
): SpecialistRun => ({
  id,
  specialist: {
    id: `${id}-specialist`,
    name: id === "r1" ? "Researcher" : "Reviewer",
    description: "",
    instructions: "",
    provenance: { source: "plugin", pluginId: "p" },
  },
  task: "Look into it.",
  depth: 1,
  status,
  startedAt,
  sequence: 1,
  actionIds,
});

function task(fields: Partial<WorkspaceTask>): WorkspaceTask {
  return {
    id: "t",
    title: "Notes",
    updatedAt: "2026-10-05T09:00:00.000Z",
    updatedLabel: "Now",
    ...emptyConversationLists,
    messages: [],
    phase: { kind: "completed", outcome: { title: "Done", summary: "" } },
    ...fields,
  };
}

describe("what a conversation waits on", () => {
  it("is the specialists a finished turn left running, with every call of theirs, since the first began", () => {
    const shown = timelineTask(
      task({
        specialistRuns: [
          run("r1", "running", "2026-10-05T09:02:00.000Z", ["a1"]),
          run("r2", "running", "2026-10-05T09:01:00.000Z"),
          run("r3", "completed", "2026-10-05T09:00:00.000Z", ["a3"]),
        ],
        actions: [
          action("a1", 2, "r1"),
          action("a2", 3, "r2"),
          action("a3", 4),
        ],
      }),
    );

    expect(shown.waitingOn).toEqual({
      names: ["Researcher", "Reviewer"],
      calls: 2,
      since: "2026-10-05T09:01:00.000Z",
    });
  });

  it("is nothing while the turn itself works", () => {
    const shown = timelineTask(
      task({
        phase: { kind: "working", steps: [] },
        specialistRuns: [run("r1", "running", "2026-10-05T09:02:00.000Z")],
      }),
    );

    expect(shown.waitingOn).toBeUndefined();
  });

  it("draws a specialist's actions under its run, not again in the main history", () => {
    const shown = timelineTask(
      task({
        specialistRuns: [
          run("r1", "completed", "2026-10-05T09:02:00.000Z", ["a1"]),
        ],
        actions: [action("a1", 2), action("a2", 3, "r9"), action("a3", 4)],
      }),
    );

    expect(shown.actions.map((item) => item.id)).toEqual(["a3"]);
  });
});

describe("a turn", () => {
  const conversation = task({
    messages: [
      { sequence: 0, id: "m1", role: "user", text: "Read the notes." },
      { sequence: 3, id: "q", role: "user", text: "Yes", interactionId: "i1" },
      { sequence: 5, id: "m2", role: "user", text: "Now the plan." },
      { sequence: 6, id: "answer", role: "assistant", text: "Done." },
    ],
    actions: [action("a1", 1), action("a2", 4), action("a3", 7)],
  });

  it("answered the person's last message that is not an answer to a question", () => {
    expect(answeredMessage(conversation)?.id).toBe("m2");
  });
});
