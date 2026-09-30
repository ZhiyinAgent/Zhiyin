import { describe, expect, it } from "vitest";
import type { WorkspaceTask } from "@zhiyin/contract";
import { ConversationRewind } from "../src/index.js";

function task(): WorkspaceTask {
  return {
    id: "task-1",
    title: "A conversation",
    updatedLabel: "Now",
    messages: [
      { id: "u1", role: "user", text: "First", sequence: 0 },
      { id: "a1", role: "assistant", text: "First answer", sequence: 1 },
      { id: "u2", role: "user", text: "Second", sequence: 4 },
      { id: "a2", role: "assistant", text: "Second answer", sequence: 6 },
    ],
    actions: [
      {
        id: "action-1",
        action: "Read",
        target: "notes.md",
        status: "completed",
        sequence: 2,
      },
      {
        id: "action-2",
        action: "Write",
        target: "answer.md",
        status: "completed",
        sequence: 5,
      },
    ],
    views: [
      {
        id: "view-1",
        callId: "call-1",
        title: "Earlier view",
        kind: "diagram",
        source: "flowchart LR\nA-->B",
        sequence: 3,
      },
    ],
    artifacts: [
      {
        path: "answer.md",
        name: "answer.md",
        change: "created",
        bytes: 6,
        updatedAt: "2026-09-07T10:00:00.000Z",
      },
    ],
    plan: [
      {
        id: "plan-1",
        title: "Later plan",
        status: "done",
      },
    ],
    compaction: {
      revision: 1,
      throughMessageId: "u2",
      summary: "Includes the second request.",
      retainedActionIds: ["action-1", "action-2"],
      createdAt: "2026-09-07T10:00:00.000Z",
    },
    phase: { kind: "completed", outcome: { title: "Done", summary: "Done" } },
  };
}

describe("ConversationRewind", () => {
  it("returns the selected user message to a draft and removes later context", () => {
    const rewind = new ConversationRewind(() => "rewind-1");
    const planned = rewind.plan(task(), "u2");

    expect(planned).toMatchObject({
      ok: true,
      preview: {
        id: "rewind-1",
        taskId: "task-1",
        messageId: "u2",
        draft: "Second",
        discardedActions: [{ id: "action-2" }],
      },
    });
    if (!planned.ok) throw new Error(planned.reason);
    expect(planned.task.messages.map((message) => message.id)).toEqual([
      "u1",
      "a1",
    ]);
    expect(planned.task.actions?.map((action) => action.id)).toEqual([
      "action-1",
    ]);
    expect(planned.task.views?.map((view) => view.id)).toEqual(["view-1"]);
    expect(planned.task.plan).toEqual([]);
    expect(planned.task.artifacts).toEqual([]);
    expect(planned.task.compaction).toBeUndefined();
    expect(planned.task.phase).toEqual({ kind: "draft" });
  });

  it("keeps what the model was sent before the selected message, and nothing after", () => {
    const rewind = new ConversationRewind(() => "rewind-1");
    const sent: NonNullable<WorkspaceTask["modelHistory"]> = [
      { id: "h1", kind: "message", messageId: "u1" },
      { id: "h2", kind: "calls", text: "", calls: [] },
      { id: "h3", kind: "result", callId: "c1", name: "read", content: "r" },
      { id: "h4", kind: "message", messageId: "a1" },
      { id: "h5", kind: "message", messageId: "u2" },
      { id: "h6", kind: "notice", content: "n" },
      { id: "h7", kind: "message", messageId: "a2" },
    ];

    const planned = rewind.plan({ ...task(), modelHistory: sent }, "u2");

    if (!planned.ok) throw new Error(planned.reason);
    expect(planned.task.modelHistory?.map((entry) => entry.id)).toEqual([
      "h1",
      "h2",
      "h3",
      "h4",
    ]);
  });

  it("keeps only the attempts to condense made before the selected message", () => {
    const rewind = new ConversationRewind(() => "rewind-1");
    const attempt = (id: string, sequence: number) =>
      ({
        id,
        sequence,
        createdAt: "2026-09-25T10:00:00.000Z",
        targetTokens: 13_600,
        tokensBefore: 14_200,
        outcome: "failed",
        reason: "unusable",
      }) as const;

    const planned = rewind.plan(
      {
        ...task(),
        condensings: [attempt("before", 3), attempt("after", 7)],
      },
      "u2",
    );

    if (!planned.ok) throw new Error(planned.reason);
    expect(planned.task.condensings?.map((record) => record.id)).toEqual([
      "before",
    ]);
  });

  it("refuses assistant messages and generated structured answers", () => {
    const rewind = new ConversationRewind(() => "rewind-1");
    const source = task();
    const structured: WorkspaceTask = {
      ...source,
      messages: [
        ...source.messages,
        {
          id: "structured-answer",
          role: "user",
          text: "Structured user response",
          interactionId: "interaction-1",
          sequence: 7,
        },
      ],
    };

    expect(rewind.plan(structured, "a1")).toEqual({
      ok: false,
      reason: "Only a message you wrote can be rewound.",
    });
    expect(rewind.plan(structured, "structured-answer")).toEqual({
      ok: false,
      reason: "Only an ordinary message can be edited and rewound.",
    });
  });

  it("refuses a stale plan when the conversation changed", () => {
    const rewind = new ConversationRewind(() => "rewind-1");
    const original = task();
    const planned = rewind.plan(original, "u2");
    if (!planned.ok) throw new Error(planned.reason);

    expect(
      rewind.apply(
        {
          ...original,
          messages: [
            ...original.messages,
            {
              id: "late",
              role: "assistant",
              text: "Late result",
              sequence: 8,
            },
          ],
        },
        planned,
      ),
    ).toEqual({
      ok: false,
      reason:
        "The conversation changed while the rewind was being reviewed. Review it again.",
    });
  });

  it("applies the reviewed revision once when the source is unchanged", () => {
    const rewind = new ConversationRewind(() => "rewind-1");
    const original = task();
    const planned = rewind.plan(original, "u2");
    if (!planned.ok) throw new Error(planned.reason);

    const applied = rewind.apply(original, planned);
    expect(
      applied.ok && applied.task.messages.map((message) => message.id),
    ).toEqual(["u1", "a1"]);
  });
});
