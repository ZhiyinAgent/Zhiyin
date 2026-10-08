import { describe, expect, it } from "vitest";
import {
  emptyConversationLists,
  type FileChange,
  type TaskAction,
  type WorkspaceTask,
} from "@zhiyin/contract";
import { ConversationRewind } from "../src/index.js";

const written: FileChange = {
  path: "notes.md",
  change: "updated",
  before: "old",
  after: "new",
};

function action(
  id: string,
  sequence: number,
  overrides: Partial<TaskAction> = {},
): TaskAction {
  return {
    id,
    action: "Write notes",
    target: "notes.md",
    status: "completed",
    changes: [written],
    sequence,
    ...overrides,
  };
}

/** An action that only read, and so changed nothing. */
function read(id: string, sequence: number): TaskAction {
  return {
    id,
    action: "Read notes",
    target: "notes.md",
    status: "completed",
    readOnly: true,
    sequence,
  };
}

/** Two turns, each of which wrote a file. */
function task(): WorkspaceTask {
  return {
    id: "task-1",
    title: "Notes",
    titleSource: "generated",
    updatedAt: "2026-09-07T10:00:00.000Z",
    updatedLabel: "Now",
    ...emptyConversationLists,
    messages: [
      { id: "u1", role: "user", text: "Write the notes", sequence: 0 },
      { id: "a1", role: "assistant", text: "Written.", sequence: 3 },
      { id: "u2", role: "user", text: "Now the summary", sequence: 4 },
      { id: "a2", role: "assistant", text: "Done.", sequence: 6 },
    ],
    actions: [
      action("write-1", 1),
      read("read-1", 2),
      action("write-2", 5, {
        target: "summary.md",
        changes: [{ ...written, path: "summary.md", change: "created" }],
      }),
    ],
    phase: { kind: "completed", outcome: { title: "Done", summary: "" } },
  };
}

describe("undoing a turn's file changes", () => {
  it("takes the files of that turn only, and keeps the whole conversation", () => {
    const rewind = new ConversationRewind(() => "undo-1");

    const planned = rewind.planUndo(task(), "u1");

    if (!planned.ok) throw new Error(planned.reason);
    expect(planned.actions.map((item) => item.id)).toEqual(["write-1"]);
    const applied = rewind.applyUndo(
      task(),
      planned,
      [{ path: "notes.md", status: "restored" }],
      "2026-10-02T09:00:00.000Z",
    );
    if (!applied.ok) throw new Error(applied.reason);
    expect(applied.task.messages).toEqual(task().messages);
    expect(applied.task.actions).toEqual(task().actions);
    expect(applied.task.undos).toEqual([
      {
        id: "undo-1",
        messageId: "u1",
        actionIds: ["write-1"],
        at: "2026-10-02T09:00:00.000Z",
        files: [{ path: "notes.md", status: "restored" }],
      },
    ]);
  });

  it("counts an answer to a question as part of the turn it was asked in", () => {
    const rewind = new ConversationRewind(() => "undo-1");
    const asked: WorkspaceTask = {
      ...task(),
      messages: [
        ...task().messages.slice(0, 1),
        {
          id: "answer",
          role: "user",
          text: "Blue",
          interactionId: "question-1",
          sequence: 1.5,
        },
        ...task().messages.slice(1),
      ],
      actions: [...task().actions!, action("write-after-answer", 2.5)],
    };

    const planned = rewind.planUndo(asked, "u1");

    if (!planned.ok) throw new Error(planned.reason);
    expect(planned.actions.map((item) => item.id)).toEqual([
      "write-1",
      "write-after-answer",
    ]);
  });

  it("leaves out a change that never ran", () => {
    const rewind = new ConversationRewind(() => "undo-1");
    const refused: WorkspaceTask = {
      ...task(),
      actions: [
        ...task().actions!,
        action("denied", 2.1, { status: "denied" }),
        action("blocked", 2.2, { status: "blocked" }),
      ],
    };

    const planned = rewind.planUndo(refused, "u1");

    if (!planned.ok) throw new Error(planned.reason);
    expect(planned.actions.map((item) => item.id)).toEqual(["write-1"]);
  });

  it("refuses a turn that changed no files, and one already undone", () => {
    const rewind = new ConversationRewind(() => "undo-1");
    const readOnly: WorkspaceTask = {
      ...task(),
      actions: [read("read", 1)],
    };
    expect(rewind.planUndo(readOnly, "u1")).toMatchObject({ ok: false });

    const planned = rewind.planUndo(task(), "u1");
    if (!planned.ok) throw new Error(planned.reason);
    const applied = rewind.applyUndo(task(), planned, [], "2026-10-02T09:00Z");
    if (!applied.ok) throw new Error(applied.reason);

    expect(rewind.planUndo(applied.task, "u1")).toMatchObject({ ok: false });
    expect(rewind.planUndo(applied.task, "u2")).toMatchObject({ ok: true });
  });

  it("refuses a plan once the conversation has changed", () => {
    const rewind = new ConversationRewind(() => "undo-1");
    const planned = rewind.planUndo(task(), "u1");
    if (!planned.ok) throw new Error(planned.reason);

    const changed = { ...task(), title: "Renamed" };

    expect(
      rewind.applyUndo(changed, planned, [], "2026-10-02T09:00Z"),
    ).toMatchObject({ ok: false });
  });
});
