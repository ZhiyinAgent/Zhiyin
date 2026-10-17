import { afterEach, describe, expect, it } from "vitest";
import {
  emptyConversationLists,
  type TaskAction,
  type WorkspaceTask,
} from "@zhiyin/contract";
import type { RewindPlanner, UndoPlan } from "@zhiyin/conversation-rewind";
import type { Recovery, RecoveryReview } from "@zhiyin/recovery";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import {
  ComposedRewind,
  FileRewindJournal,
  type RewindHost,
} from "../src/index.js";

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

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
    ...emptyConversationLists,
    id: "conversation-1",
    title: "Notes",
    titleSource: "manual",
    updatedAt: "2026-10-09T12:00:00.000Z",
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

  it("finishes an undo cut short by a restart as it would have finished at once, offering again a file that did not go back", async () => {
    const held = [
      {
        path: "notes.md",
        status: "conflict" as const,
        reason: "Another program has it open.",
      },
    ];
    const now = () => new Date("2026-10-16T09:00:00.000Z");
    const atOnce = new ComposedRewind({
      conversation: planner(),
      recovery: recoveryRecording(held).recovery,
      now,
    });
    const finished = hostFor(conversation("C:/work"));
    await atOnce.previewUndo("conversation-1", "u1", finished.host);
    await atOnce.commitUndo("conversation-1", "undo-1", finished.host);

    const directory = await folders.make("zhiyin-undo-journal-");
    let current = conversation("C:/work");
    const closing: RewindHost = {
      task: () => current,
      save: async () => {
        throw new Error("Zhiyin closed before the conversation was saved.");
      },
    };
    const first = new ComposedRewind({
      conversation: planner(),
      recovery: recoveryRecording(held).recovery,
      journal: new FileRewindJournal(directory),
      now,
    });
    await first.previewUndo("conversation-1", "u1", closing);
    await expect(
      first.commitUndo("conversation-1", "undo-1", closing),
    ).rejects.toThrow("closed before");
    const restarted = new ComposedRewind({
      conversation: planner(),
      recovery: recoveryRecording(held).recovery,
      journal: new FileRewindJournal(directory),
      now,
    });
    await restarted.resume({
      task: () => current,
      save: async (task) => {
        current = task;
      },
    });

    expect(current.undos).toEqual(finished.saved.at(-1)?.undos);
    expect(current.undos[0]?.actionIds).toEqual([]);
    expect(restarted.restoring("conversation-1")).toBe(false);
  });

  it("clears an undo a restart finds already saved, a file that did not go back included", async () => {
    const directory = await folders.make("zhiyin-undo-journal-");
    const stored = new FileRewindJournal(directory);
    let closing = true;
    const journal = {
      pending: () => stored.pending(),
      begin: (operation: Parameters<FileRewindJournal["begin"]>[0]) =>
        stored.begin(operation),
      filesRestored: (
        id: string,
        result: Parameters<FileRewindJournal["filesRestored"]>[1],
      ) => stored.filesRestored(id, result),
      complete: async (id: string) => {
        if (closing) throw new Error("Zhiyin closed after saving.");
        await stored.complete(id);
      },
    };
    const held = [
      {
        path: "notes.md",
        status: "conflict" as const,
        reason: "Another program has it open.",
      },
    ];
    const { host, saved } = hostFor(conversation("C:/work"));
    const first = new ComposedRewind({
      conversation: planner(),
      recovery: recoveryRecording(held).recovery,
      journal,
    });
    await first.previewUndo("conversation-1", "u1", host);
    await expect(
      first.commitUndo("conversation-1", "undo-1", host),
    ).rejects.toThrow("closed after saving");

    closing = false;
    const restarted = new ComposedRewind({
      conversation: planner(),
      recovery: recoveryRecording(held).recovery,
      journal,
    });
    await restarted.resume(host);

    await expect(stored.pending()).resolves.toEqual([]);
    expect(restarted.restoring("conversation-1")).toBe(false);
    expect(saved).toHaveLength(1);
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
