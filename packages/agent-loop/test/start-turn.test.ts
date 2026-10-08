import { describe, expect, it } from "vitest";
import { emptyConversationLists, type WorkspaceTask } from "@zhiyin/contract";
import { beginUserTurn } from "../src/turn/start-turn.js";

const task = (overrides: Partial<WorkspaceTask> = {}): WorkspaceTask => ({
  id: "task-1",
  title: "New task",
  titleSource: "generated",
  updatedLabel: "Earlier",
  updatedAt: "2026-10-05T09:00:00.000Z",
  ...emptyConversationLists,
  messages: [],
  plan: [],
  phase: { kind: "draft" },
  ...overrides,
});

describe("beginUserTurn", () => {
  it("constructs the first message and generated fallback title", () => {
    const started = beginUserTurn(task(), "Write a release note", {
      messageId: "message-1",
      sequence: 0,
    });

    expect(started.shouldGenerateInitialTitle).toBe(true);
    expect(started.task).toMatchObject({
      title: "Write a release note",
      titleSource: "generated",
      updatedLabel: "Now",
      updatedAt: "2026-10-05T09:00:00.000Z",
      ...emptyConversationLists,
      messages: [
        {
          id: "message-1",
          role: "user",
          text: "Write a release note",
          sequence: 0,
        },
      ],
      plan: [],
      phase: { kind: "working", steps: [] },
    });
  });

  it("preserves a manual title while resetting the plan and phase", () => {
    const started = beginUserTurn(
      task({
        title: "Release preparation",
        titleSource: "manual",
        messages: [
          { id: "message-0", role: "user", text: "Earlier", sequence: 4 },
        ],
        plan: [
          {
            id: "plan-1",
            title: "Old plan",
            status: "done",
          },
        ],
        phase: {
          kind: "completed",
          outcome: { title: "Done", summary: "Earlier work finished." },
        },
      }),
      "Continue with the announcement",
      {
        messageId: "message-2",
        sequence: 7,
        reasoning: { enabled: true, effort: "high" },
      },
    );

    expect(started.shouldGenerateInitialTitle).toBe(false);
    expect(started.task).toMatchObject({
      title: "Release preparation",
      titleSource: "manual",
      reasoning: { enabled: true, effort: "high" },
      messages: [
        { id: "message-0", sequence: 4 },
        { id: "message-2", sequence: 7 },
      ],
      plan: [],
      phase: { kind: "working", steps: [] },
    });
  });
});
