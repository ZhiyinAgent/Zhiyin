import { describe, expect, it } from "vitest";
import type { TaskAction, WorkspaceTask } from "@zhiyin/contract";
import type { RewindPlanner, UndoPlan } from "@zhiyin/conversation-rewind";
import type { Recovery, RecoveryReview } from "@zhiyin/recovery";
import { ComposedRewind, type RewindHost } from "../src/index.js";

const written: TaskAction = {
  id: "write-1",
  action: "Write notes",
  target: "notes.md",
  status: "completed",
  changes: [{ path: "notes.md", change: "updated", before: "a", after: "b" }],
  sequence: 1,
};

function conversation(folder?: string): WorkspaceTask {
  return {
    id: "conversation-1",
    title: "Notes",
    updatedLabel: "Now",
    messages: [
      { id: "u1", role: "user", text: "Write the notes", sequence: 0 },
      { id: "a1", role: "assistant", text: "Written.", sequence: 2 },
    ],
    actions: [written],
    phase: { kind: "completed", outcome: { title: "Done", summary: "" } },
    ...(folder ? { workspace: { path: folder, name: "work" } } : {}),
  };
}

/**
 * A planner that takes every change in the conversation as the turn's, and
 * records an undo as the real one does: on the conversation, and nothing else.
 */
function planner(): RewindPlanner {
  let number = 0;
  return {
    plan: () => ({ ok: false, reason: "Not used here." }),
    apply: () => ({ ok: false, reason: "Not used here." }),
    planUndo: (task, messageId): UndoPlan => ({
      ok: true,
      id: `undo-${++number}`,
      taskId: task.id,
      messageId,
      actions: task.actions ?? [],
      source: JSON.stringify(task),
    }),
    applyUndo: (task, plan, files, at) =>
      JSON.stringify(task) === plan.source
        ? {
            ok: true,
            task: {
              ...task,
              undos: [
                {
                  id: plan.id,
                  messageId: plan.messageId,
                  actionIds: plan.actions.map((action) => action.id),
                  at,
                  files,
                },
              ],
            },
          }
        : { ok: false, reason: "The conversation changed." },
  };
}

/** File recovery that writes down what it was asked, in order. */
function recoveryRecording(
  restored: Awaited<ReturnType<Recovery["restore"]>>["files"] = [
    { path: "notes.md", status: "restored" },
  ],
) {
  const asked: unknown[][] = [];
  const recovery = {
    review: async (
      id: string,
      root: string,
      actions: readonly TaskAction[],
    ) => {
      asked.push(["review", id, root, actions.map((action) => action.id)]);
      return {
        id,
        workspaceRoot: root,
        files: [{ path: "notes.md", action: "restore", status: "recoverable" }],
        targets: [],
      } as RecoveryReview;
    },
    restore: async (review: RecoveryReview) => {
      asked.push(["restore", review.id]);
      return { files: restored };
    },
  } as unknown as Recovery;
  return { asked, recovery };
}

function hostFor(task: WorkspaceTask) {
  const saved: WorkspaceTask[] = [];
  let current = task;
  const host: RewindHost = {
    task: () => current,
    save: async (next) => {
      saved.push(next);
      current = next;
    },
  };
  return { host, saved };
}

describe("undoing a turn's file changes", () => {
  it("reviews the turn's files in the conversation's own folder", async () => {
    const { recovery, asked } = recoveryRecording();
    const rewind = new ComposedRewind({ conversation: planner(), recovery });
    const { host } = hostFor(conversation("C:/work"));

    const previewed = await rewind.previewUndo("conversation-1", "u1", host);

    expect(previewed).toEqual({
      ok: true,
      preview: {
        id: "undo-1",
        taskId: "conversation-1",
        messageId: "u1",
        files: [{ path: "notes.md", action: "restore", status: "recoverable" }],
      },
    });
    expect(asked).toEqual([["review", "undo-1", "C:/work", ["write-1"]]]);
  });

  it("refuses a conversation with no folder, having no files to put back", async () => {
    const { recovery, asked } = recoveryRecording();
    const rewind = new ComposedRewind({ conversation: planner(), recovery });
    const { host } = hostFor(conversation());

    const previewed = await rewind.previewUndo("conversation-1", "u1", host);

    expect(previewed).toMatchObject({ ok: false });
    expect(asked).toEqual([]);
  });

  it("puts the files back and records the undo, keeping every message and action", async () => {
    const { recovery } = recoveryRecording([
      { path: "notes.md", status: "restored" },
      { path: "draft.md", status: "conflict" },
    ]);
    const rewind = new ComposedRewind({
      conversation: planner(),
      recovery,
      now: () => new Date("2026-10-02T09:00:00.000Z"),
    });
    const { host, saved } = hostFor(conversation("C:/work"));

    await rewind.previewUndo("conversation-1", "u1", host);
    const undone = await rewind.commitUndo("conversation-1", "undo-1", host);

    expect(undone).toEqual({
      ok: true,
      result: {
        files: [
          { path: "notes.md", status: "restored" },
          { path: "draft.md", status: "conflict" },
        ],
      },
    });
    expect(saved).toHaveLength(1);
    expect(saved[0]!.messages).toEqual(conversation().messages);
    expect(saved[0]!.actions).toEqual([written]);
    expect(saved[0]!.undos).toEqual([
      {
        id: "undo-1",
        messageId: "u1",
        actionIds: ["write-1"],
        at: "2026-10-02T09:00:00.000Z",
        files: [
          { path: "notes.md", status: "restored" },
          { path: "draft.md", status: "conflict" },
        ],
      },
    ]);
  });

  it("records durable intent before putting files back", async () => {
    const order: string[] = [];
    const recovery = {
      review: async (id: string, root: string) =>
        ({ id, workspaceRoot: root, files: [], targets: [] }) as RecoveryReview,
      restore: async () => {
        order.push("files");
        return { files: [] };
      },
    } as unknown as Recovery;
    const rewind = new ComposedRewind({
      conversation: planner(),
      recovery,
      journal: {
        pending: async () => [],
        begin: async () => void order.push("intent"),
        filesRestored: async () => void order.push("files-recorded"),
        complete: async () => void order.push("complete"),
      },
    });
    const task = conversation("C:/work");
    const host: RewindHost = {
      task: () => task,
      save: async () => void order.push("conversation"),
    };

    await rewind.previewUndo("conversation-1", "u1", host);
    await rewind.commitUndo("conversation-1", "undo-1", host);

    expect(order).toEqual([
      "intent",
      "files",
      "files-recorded",
      "conversation",
      "complete",
    ]);
  });

  it("refuses an undo it did not review, and one reviewed before the conversation changed", async () => {
    const { recovery, asked } = recoveryRecording();
    const rewind = new ComposedRewind({ conversation: planner(), recovery });
    const { host } = hostFor(conversation("C:/work"));

    expect(
      await rewind.commitUndo("conversation-1", "undo-9", host),
    ).toMatchObject({ ok: false });

    await rewind.previewUndo("conversation-1", "u1", host);
    await host.save({ ...conversation("C:/work"), title: "Renamed" });

    expect(
      await rewind.commitUndo("conversation-1", "undo-1", host),
    ).toMatchObject({ ok: false });
    expect(asked.filter(([what]) => what === "restore")).toEqual([]);
  });
});

describe("showing what a turn changed in a file", () => {
  it("gives the file as it was before the turn and as the turn left it, from the conversation's own folder", async () => {
    const asked: unknown[] = [];
    const recovery = {
      versions: async (
        root: string,
        actions: readonly TaskAction[],
        path: string,
      ) => {
        asked.push([root, actions.map((action) => action.id), path]);
        return {
          ok: true,
          before: new Uint8Array([1]),
          after: new Uint8Array([2]),
        };
      },
    } as unknown as Recovery;
    const rewind = new ComposedRewind({ conversation: planner(), recovery });
    const { host } = hostFor(conversation("C:/work"));

    expect(
      await rewind.versions("conversation-1", "u1", "notes.md", host),
    ).toEqual({
      ok: true,
      before: new Uint8Array([1]),
      after: new Uint8Array([2]),
    });
    expect(asked).toEqual([["C:/work", ["write-1"], "notes.md"]]);
  });

  it("refuses a conversation with no folder", async () => {
    const rewind = new ComposedRewind({
      conversation: planner(),
      recovery: {} as Recovery,
    });
    const { host } = hostFor(conversation());

    expect(
      await rewind.versions("conversation-1", "u1", "notes.md", host),
    ).toMatchObject({ ok: false });
  });
});
