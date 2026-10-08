import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RewindCommitResult, WorkspaceTask } from "@zhiyin/contract";
import type { RewindPlanner } from "@zhiyin/conversation-rewind";
import type { Recovery, RecoveryReview } from "@zhiyin/recovery";
import {
  ComposedRewind,
  FileRewindJournal,
  type RewindHost,
  type RewindJournal,
} from "../src/index.js";

const conversation = (id: string, folder?: string): WorkspaceTask =>
  ({
    id,
    title: "A conversation",
    updatedLabel: "Now",
    messages: [{ id: "u1", role: "user", text: "Hello", sequence: 0 }],
    phase: { kind: "completed", outcome: { title: "Done", summary: "" } },
    ...(folder ? { workspace: { path: folder, name: "work" } } : {}),
  }) as WorkspaceTask;

/** A planner that always agrees, unless a test says otherwise. */
function planner(overrides: Partial<RewindPlanner> = {}): RewindPlanner {
  let number = 0;
  return {
    plan: (task, messageId) => ({
      ok: true,
      preview: {
        id: `rewind-${++number}`,
        taskId: task.id,
        messageId,
        draft: "Hello",
        discardedMessages: 1,
        laterUserMessages: 0,
        discardedActions: [],
        files: [],
      },
      task,
      source: JSON.stringify(task),
    }),
    apply: (task) => ({ ok: true, task: { ...task, messages: [] } }),
    planUndo: () => ({ ok: false, reason: "Not used here." }),
    applyUndo: () => ({ ok: false, reason: "Not used here." }),
    ...overrides,
  };
}

/** File recovery that writes down what was asked of it. */
function recoveryRecording(overrides: Partial<Recovery> = {}) {
  const asked: unknown[][] = [];
  const recovery: Recovery = {
    prepare: async (actionId, _root, changes) => ({
      actionId,
      files: changes.map((change) => ({
        path: change.path,
        status: "protected" as const,
      })),
    }),
    validate: async () => ({ ok: true }),
    commit: async (actionId) => void asked.push(["commit", actionId]),
    discard: async (actionId) => void asked.push(["discard", actionId]),
    review: async (id, workspaceRoot) => {
      asked.push(["review", id, workspaceRoot]);
      return {
        id,
        workspaceRoot,
        files: [{ path: "notes.md", action: "restore", status: "recoverable" }],
        targets: [],
      } as RecoveryReview;
    },
    restore: async (review) => {
      asked.push(["restore", review.id]);
      return { files: [{ path: "notes.md", status: "restored" }] };
    },
    storage: async () => ({
      usedBytes: 0,
      retainedFiles: 0,
      excludedFiles: 0,
      limits: {
        totalBytes: 256 * 1024 * 1024,
        fileBytes: 10 * 1024 * 1024,
        versionsPerPath: 10,
        maximumAgeDays: 30,
      },
    }),
    clear: async () => {},
    cleanup: async () => {},
    ...overrides,
  };
  return { asked, recovery };
}

function hostFor(task: WorkspaceTask) {
  const saved: WorkspaceTask[] = [];
  const host: RewindHost = {
    task: () => task,
    save: async (next) => void saved.push(next),
  };
  return { host, saved };
}

describe("reviewing a rewind", () => {
  it("shows the files a rewind would put back, reviewed in the conversation's own folder", async () => {
    const { recovery, asked } = recoveryRecording();
    const rewind = new ComposedRewind({ conversation: planner(), recovery });
    const { host } = hostFor(conversation("conversation-1", "C:/work"));

    const previewed = await rewind.preview("conversation-1", "u1", host);

    expect(previewed).toMatchObject({
      ok: true,
      preview: { id: "rewind-1", files: [{ path: "notes.md" }] },
    });
    expect(asked).toEqual([["review", "rewind-1", "C:/work"]]);
  });

  it("shows no files for a conversation that has no folder", async () => {
    const { recovery, asked } = recoveryRecording();
    const rewind = new ComposedRewind({ conversation: planner(), recovery });
    const { host } = hostFor(conversation("conversation-1"));

    const previewed = await rewind.preview("conversation-1", "u1", host);

    expect(previewed).toMatchObject({ ok: true, preview: { files: [] } });
    expect(asked).toEqual([]);
  });

  it("passes on the planner's refusal", async () => {
    const { recovery } = recoveryRecording();
    const rewind = new ComposedRewind({
      conversation: planner({
        plan: () => ({ ok: false, reason: "Choose one of your own messages." }),
      }),
      recovery,
    });
    const { host } = hostFor(conversation("conversation-1"));

    expect(await rewind.preview("conversation-1", "a1", host)).toEqual({
      ok: false,
      reason: "Choose one of your own messages.",
    });
  });
});

describe("applying a rewind", () => {
  it("records durable intent before restoring files", async () => {
    const order: string[] = [];
    const journal: RewindJournal = {
      pending: async () => [],
      begin: async () => void order.push("intent"),
      filesRestored: async () => void order.push("files-recorded"),
      complete: async () => void order.push("complete"),
    };
    const { recovery } = recoveryRecording({
      restore: async () => {
        order.push("files");
        return { files: [] };
      },
    });
    const rewind = new ComposedRewind({
      conversation: planner(),
      recovery,
      journal,
    });
    const task = conversation("conversation-1", "C:/work");
    const host: RewindHost = {
      task: () => task,
      save: async () => void order.push("conversation"),
    };

    await rewind.preview("conversation-1", "u1", host);
    await rewind.commit("conversation-1", "rewind-1", "restore", host);

    expect(order).toEqual([
      "intent",
      "files",
      "files-recorded",
      "conversation",
      "complete",
    ]);
  });

  it("finishes a rewind after restart when files were restored but history was not saved", async () => {
    const directory = await mkdtemp(join(tmpdir(), "zhiyin-rewind-journal-"));
    const journal = new FileRewindJournal(directory);
    let restores = 0;
    const { recovery } = recoveryRecording({
      restore: async () => {
        restores += 1;
        return { files: [{ path: "notes.md", status: "restored" }] };
      },
    });
    const source = conversation("conversation-1", "C:/work");
    let current = source;
    const failingHost: RewindHost = {
      task: () => current,
      save: async () => {
        throw new Error("process stopped before save");
      },
    };
    const first = new ComposedRewind({
      conversation: planner(),
      recovery,
      journal,
    });
    await first.preview("conversation-1", "u1", failingHost);
    await expect(
      first.commit("conversation-1", "rewind-1", "restore", failingHost),
    ).rejects.toThrow("process stopped before save");

    const resumed = new ComposedRewind({
      conversation: planner(),
      recovery,
      journal: new FileRewindJournal(directory),
    });
    await resumed.resume({
      task: () => current,
      save: async (task) => {
        current = task;
      },
    });

    expect(restores).toBe(1);
    expect(current.messages).toEqual([]);
    await expect(journal.pending()).resolves.toEqual([]);
  });

  it("clears a journal left behind after conversation persistence", async () => {
    const directory = await mkdtemp(join(tmpdir(), "zhiyin-rewind-journal-"));
    const stored = new FileRewindJournal(directory);
    let refuseComplete = true;
    const journal: RewindJournal = {
      pending: () => stored.pending(),
      begin: (operation) => stored.begin(operation),
      filesRestored: (id, result) => stored.filesRestored(id, result),
      complete: async (id) => {
        if (refuseComplete) throw new Error("process stopped after save");
        await stored.complete(id);
      },
    };
    const { recovery } = recoveryRecording();
    let current = conversation("conversation-1", "C:/work");
    const host: RewindHost = {
      task: () => current,
      save: async (task) => {
        current = task;
      },
    };
    const first = new ComposedRewind({
      conversation: planner(),
      recovery,
      journal,
    });
    await first.preview("conversation-1", "u1", host);
    await expect(
      first.commit("conversation-1", "rewind-1", "restore", host),
    ).rejects.toThrow("process stopped after save");

    refuseComplete = false;
    const resumed = new ComposedRewind({
      conversation: planner(),
      recovery,
      journal,
    });
    await resumed.resume(host);

    await expect(stored.pending()).resolves.toEqual([]);
  });

  it("restores files only when asked to, and saves the rewound conversation", async () => {
    const { recovery, asked } = recoveryRecording();
    const rewind = new ComposedRewind({ conversation: planner(), recovery });
    const { host, saved } = hostFor(conversation("conversation-1", "C:/work"));

    await rewind.preview("conversation-1", "u1", host);
    const kept = await rewind.commit(
      "conversation-1",
      "rewind-1",
      "keep",
      host,
    );
    await rewind.preview("conversation-1", "u1", host);
    const restored = await rewind.commit(
      "conversation-1",
      "rewind-2",
      "restore",
      host,
    );

    expect(kept).toEqual({ ok: true, result: { files: [] } });
    expect(restored).toEqual({
      ok: true,
      result: { files: [{ path: "notes.md", status: "restored" }] },
    });
    expect(asked.filter(([what]) => what === "restore")).toEqual([
      ["restore", "rewind-2"],
    ]);
    expect(saved.map((task) => task.messages)).toEqual([[], []]);
  });

  it("applies only the latest review of a conversation", async () => {
    const { recovery } = recoveryRecording();
    const rewind = new ComposedRewind({ conversation: planner(), recovery });
    const { host } = hostFor(conversation("conversation-1"));

    await rewind.preview("conversation-1", "u1", host);
    await rewind.preview("conversation-1", "u1", host);

    expect(
      await rewind.commit("conversation-1", "rewind-1", "keep", host),
    ).toEqual({
      ok: false,
      reason: "That rewind is no longer active. Review the message again.",
    });
  });

  it("refuses a rewind reviewed for a different conversation", async () => {
    const { recovery } = recoveryRecording();
    const rewind = new ComposedRewind({ conversation: planner(), recovery });

    await rewind.preview(
      "conversation-1",
      "u1",
      hostFor(conversation("conversation-1")).host,
    );

    expect(
      await rewind.commit(
        "conversation-2",
        "rewind-1",
        "keep",
        hostFor(conversation("conversation-2")).host,
      ),
    ).toEqual({
      ok: false,
      reason: "That rewind is no longer active. Review the message again.",
    });
  });

  it("forgets a rewind the planner refuses to apply", async () => {
    const { recovery } = recoveryRecording();
    let refuse = true;
    const rewind = new ComposedRewind({
      conversation: planner({
        apply: (task) =>
          refuse
            ? { ok: false, reason: "The conversation changed." }
            : { ok: true, task },
      }),
      recovery,
    });
    const { host } = hostFor(conversation("conversation-1"));

    await rewind.preview("conversation-1", "u1", host);
    const first = await rewind.commit(
      "conversation-1",
      "rewind-1",
      "keep",
      host,
    );
    refuse = false;
    const again = await rewind.commit(
      "conversation-1",
      "rewind-1",
      "keep",
      host,
    );

    expect(first).toEqual({ ok: false, reason: "The conversation changed." });
    expect(again).toEqual({
      ok: false,
      reason: "That rewind is no longer active. Review the message again.",
    });
  });

  it("refuses another rewind of the conversation while its files are being put back", async () => {
    let finishRestoring: (result: RewindCommitResult) => void = () => {};
    const { recovery } = recoveryRecording({
      restore: () =>
        new Promise((resolve) => {
          finishRestoring = resolve;
        }),
    });
    const rewind = new ComposedRewind({ conversation: planner(), recovery });
    const { host } = hostFor(conversation("conversation-1", "C:/work"));

    await rewind.preview("conversation-1", "u1", host);
    const committing = rewind.commit(
      "conversation-1",
      "rewind-1",
      "restore",
      host,
    );
    await Promise.resolve();

    expect(rewind.restoring("conversation-1")).toBe(true);
    expect(rewind.restoring("conversation-2")).toBe(false);
    expect(
      await rewind.commit("conversation-1", "rewind-1", "restore", host),
    ).toEqual({ ok: false, reason: "That rewind is already being applied." });
    expect(await rewind.preview("conversation-1", "u1", host)).toEqual({
      ok: false,
      reason: "Wait for file recovery to finish before starting another turn.",
    });

    finishRestoring({ files: [] });
    await committing;
    expect(rewind.restoring("conversation-1")).toBe(false);
  });

  it("keeps the review when saving fails, so the rewind can be tried again", async () => {
    const { recovery } = recoveryRecording();
    const rewind = new ComposedRewind({ conversation: planner(), recovery });
    const task = conversation("conversation-1");
    let failSave = true;
    const host: RewindHost = {
      task: () => task,
      save: async () => {
        if (failSave) throw new Error("The disk is full.");
      },
    };

    await rewind.preview("conversation-1", "u1", host);
    await expect(
      rewind.commit("conversation-1", "rewind-1", "keep", host),
    ).rejects.toThrow("The disk is full.");
    failSave = false;

    expect(rewind.restoring("conversation-1")).toBe(false);
    expect(
      await rewind.commit("conversation-1", "rewind-1", "keep", host),
    ).toEqual({ ok: true, result: { files: [] } });
  });
});

describe("backing up a file change", () => {
  const changes = [
    { path: "notes.md", kind: "update" },
  ] as unknown as Parameters<ComposedRewind["backUp"]>[2];

  it("keeps a copy of what the change would overwrite in the workspace", async () => {
    const { recovery } = recoveryRecording();
    const rewind = new ComposedRewind({ conversation: planner(), recovery });

    expect(await rewind.backUp("action-1", "C:/work", changes)).toEqual({
      actionId: "action-1",
      files: [{ path: "notes.md", status: "protected" }],
    });
  });

  it("says a change is unprotected when there is no folder or nowhere to keep a copy", async () => {
    const { recovery } = recoveryRecording({
      prepare: async () => {
        throw new Error("No space.");
      },
    });
    const rewind = new ComposedRewind({ conversation: planner(), recovery });

    expect(await rewind.backUp("action-1", undefined, changes)).toEqual({
      actionId: "action-1",
      files: [
        {
          path: "notes.md",
          status: "unprotected",
          reason: "No workspace was available for recovery.",
        },
      ],
    });
    expect(await rewind.backUp("action-2", "C:/work", changes)).toEqual({
      actionId: "action-2",
      files: [
        {
          path: "notes.md",
          status: "unprotected",
          reason: "Recovery storage was unavailable before this action.",
        },
      ],
    });
  });
});
