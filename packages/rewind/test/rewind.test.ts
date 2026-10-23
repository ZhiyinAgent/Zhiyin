import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  emptyConversationLists,
  type RewindCommitResult,
  type WorkspaceTask,
} from "@zhiyin/contract";
import {
  ConversationRewind,
  type RewindPlanner,
} from "@zhiyin/conversation-rewind";
import {
  FileRecovery,
  type Recovery,
  type RecoveryReview,
} from "@zhiyin/recovery";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import {
  ComposedRewind,
  FileRewindJournal,
  type RewindHost,
  type RewindJournal,
} from "../src/index.js";

const folders = new TemporaryFolders();

/** The journal's writer, which the composition root hands it. */
const replace = (path: string, text: string) => writeFile(path, text, "utf8");

afterEach(() => folders.removeAll());

const conversation = (id: string, folder?: string): WorkspaceTask => ({
  ...emptyConversationLists,
  id,
  title: "A conversation",
  titleSource: "manual",
  updatedAt: "2026-10-09T12:00:00.000Z",
  updatedLabel: "Now",
  messages: [{ id: "u1", role: "user", text: "Hello", sequence: 0 }],
  phase: { kind: "completed", outcome: { title: "Done", summary: "" } },
  ...(folder ? { workspace: { path: folder, name: "work" } } : {}),
});

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
  const recovery = {
    prepare: async (actionId, _root, changes) => ({
      actionId,
      files: changes.map((change) => ({
        path: change.path,
        status: "protected" as const,
      })),
    }),
    validate: async () => ({ ok: true }),
    commit: async (actionId) => void asked.push(["commit", actionId]),
    keepCommandChanges: async (actionId, root, changes) =>
      void asked.push(["keepCommandChanges", actionId, root, changes]),
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
    cleanup: async () => {},
    forgetConversation: async () => {},
    ...overrides,
  } as Recovery;
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

describe("a conversation whose folder is gone", () => {
  it("can still be rewound keeping files, and says plainly that its files cannot be put back", async () => {
    const storage = await folders.make("zhiyin-rewind-store-");
    const gone = join(storage, "moved-away");
    const task: WorkspaceTask = {
      ...conversation("c1", gone),
      messages: [
        { id: "u1", role: "user", text: "Write the notes", sequence: 0 },
        { id: "a1", role: "assistant", text: "Written.", sequence: 2 },
      ],
      actions: [
        {
          id: "write-1",
          action: "Write notes",
          target: "notes.md",
          status: "completed",
          startedAt: "2026-10-09T12:00:00.000Z",
          sequence: 1,
          changes: [{ path: "notes.md", change: "updated" }],
        },
      ],
    };
    const rewind = new ComposedRewind({
      conversation: new ConversationRewind(() => "rewind-1"),
      recovery: new FileRecovery(storage),
    });
    const { host, saved } = hostFor(task);

    expect(await rewind.previewUndo("c1", "u1", host)).toEqual({
      ok: false,
      reason: `This conversation's folder, ${gone}, could not be opened, so its files cannot be put back.`,
    });
    const previewed = await rewind.preview("c1", "u1", host);
    expect(previewed).toMatchObject({
      ok: true,
      preview: {
        files: [
          {
            path: "notes.md",
            status: "unprotected",
            reason: "The conversation's folder could not be opened.",
          },
        ],
      },
    });
    if (!previewed.ok) throw new Error(previewed.reason);
    expect(
      await rewind.commit("c1", previewed.preview.id, "keep", host),
    ).toMatchObject({ ok: true });
    expect(saved).toHaveLength(1);
  });
});

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
    const directory = await folders.make("zhiyin-rewind-journal-");
    const journal = new FileRewindJournal(directory, replace);
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
      journal: new FileRewindJournal(directory, replace),
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
    const directory = await folders.make("zhiyin-rewind-journal-");
    const stored = new FileRewindJournal(directory, replace);
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

  it("clears a journal left behind after saving, when saving records the time as the app does", async () => {
    const directory = await folders.make("zhiyin-rewind-journal-");
    const stored = new FileRewindJournal(directory, replace);
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
    let clock = 0;
    const host: RewindHost = {
      task: () => current,
      save: async (task) => {
        clock += 1;
        current = {
          ...task,
          updatedAt: `2026-10-15T10:00:0${clock}.000Z`,
          updatedLabel: "Now",
        };
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
    expect(resumed.restoring("conversation-1")).toBe(false);
  });

  it("finishes every other conversation's rewind after restart when one cannot be finished", async () => {
    const stuck = conversation("conversation-1", "C:/work");
    const other = conversation("conversation-2", "C:/work");
    const rewound = { ...other, messages: [] };
    const review = {
      id: "review",
      workspaceRoot: "C:/work",
      files: [],
      targets: [],
    } as RecoveryReview;
    const completed: string[] = [];
    const journal: RewindJournal = {
      pending: async () => [
        {
          version: 1,
          id: "rewind-1",
          conversationId: stuck.id,
          // Saved from a conversation that has changed since.
          source: JSON.stringify({ ...stuck, title: "Before" }),
          task: { ...stuck, messages: [] },
          review,
        },
        {
          version: 1,
          id: "rewind-2",
          conversationId: other.id,
          source: JSON.stringify(other),
          task: rewound,
          review,
        },
      ],
      begin: async () => {},
      filesRestored: async () => {},
      complete: async (id) => void completed.push(id),
    };
    const saved: WorkspaceTask[] = [];
    const rewind = new ComposedRewind({
      conversation: planner(),
      recovery: recoveryRecording().recovery,
      journal,
    });

    await expect(
      rewind.resume({
        task: (id) => (id === stuck.id ? stuck : other),
        save: async (task) => void saved.push(task),
      }),
    ).rejects.toThrow("no longer matches");

    expect(saved).toEqual([rewound]);
    expect(completed).toEqual(["rewind-2"]);
    // The one left unfinished is held, so it cannot be used half rewound.
    expect(rewind.restoring(stuck.id)).toBe(true);
    expect(rewind.restoring(other.id)).toBe(false);
  });

  it("lets go of an unfinished rewind when its conversation is deleted, so the next start does not report it again", async () => {
    const directory = await folders.make("zhiyin-rewind-deleted-");
    const stuck = conversation("conversation-1", "C:/work");
    await new FileRewindJournal(directory, replace).begin({
      version: 1,
      id: "rewind-1",
      conversationId: stuck.id,
      // Saved from a conversation that has changed since.
      source: JSON.stringify({ ...stuck, title: "Before" }),
      task: { ...stuck, messages: [] },
      review: {
        id: "review",
        workspaceRoot: "C:/work",
        files: [],
        targets: [],
      } as RecoveryReview,
    });
    const host = {
      task: () => stuck,
      save: async () => {},
    };
    const rewind = new ComposedRewind({
      conversation: planner(),
      recovery: recoveryRecording().recovery,
      journal: new FileRewindJournal(directory, replace),
    });
    await expect(rewind.resume(host)).rejects.toThrow("no longer matches");

    await rewind.forgetConversation(stuck.id);

    expect(rewind.restoring(stuck.id)).toBe(false);
    const next = new ComposedRewind({
      conversation: planner(),
      recovery: recoveryRecording().recovery,
      journal: new FileRewindJournal(directory, replace),
    });
    await expect(next.resume(host)).resolves.toBeUndefined();
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

  it("lets a rewind whose file results could not be written down be tried again, or finish when a turn starts, without putting the files back twice", async () => {
    for (const retry of ["same rewind", "new turn"] as const) {
      const directory = await folders.make("zhiyin-rewind-journal-");
      const stored = new FileRewindJournal(directory, replace);
      let diskFull = true;
      const journal: RewindJournal = {
        pending: () => stored.pending(),
        begin: (operation) => stored.begin(operation),
        filesRestored: async (id, result) => {
          if (diskFull) throw new Error("The disk is full.");
          await stored.filesRestored(id, result);
        },
        complete: (id) => stored.complete(id),
      };
      const { recovery, asked } = recoveryRecording();
      const rewind = new ComposedRewind({
        conversation: planner(),
        recovery,
        journal,
      });
      let current = conversation("conversation-1", "C:/work");
      const host: RewindHost = {
        task: () => current,
        save: async (task) => {
          current = task;
        },
      };

      await rewind.preview("conversation-1", "u1", host);
      await expect(
        rewind.commit("conversation-1", "rewind-1", "restore", host),
      ).rejects.toThrow("The disk is full.");
      diskFull = false;

      if (retry === "same rewind")
        expect(
          await rewind.commit("conversation-1", "rewind-1", "restore", host),
        ).toEqual({
          ok: true,
          result: { files: [{ path: "notes.md", status: "restored" }] },
        });
      else await rewind.settle("conversation-1", host);
      expect(asked.filter(([what]) => what === "restore")).toHaveLength(1);
      expect(current.messages).toEqual([]);
      await expect(stored.pending()).resolves.toEqual([]);
      expect(rewind.restoring("conversation-1")).toBe(false);
    }
  });
});

describe("backing up a file change", () => {
  const changes = [
    { path: "notes.md", kind: "update" },
  ] as unknown as Parameters<ComposedRewind["backUp"]>[2];

  it("records what a command created in the conversation's folder, and nothing without one", async () => {
    const { recovery, asked } = recoveryRecording();
    const rewind = new ComposedRewind({ conversation: planner(), recovery });

    await rewind.keepCommandChanges(
      "action-1",
      "C:/work",
      [{ path: "card.pdf", change: "created" as const }],
      "conversation-1",
    );
    await rewind.keepCommandChanges(
      "action-2",
      undefined,
      [{ path: "card.pdf", change: "created" as const }],
      "conversation-1",
    );
    await rewind.keepCommandChanges(
      "action-3",
      "C:/work",
      [],
      "conversation-1",
    );
    expect(asked).toEqual([
      [
        "keepCommandChanges",
        "action-1",
        "C:/work",
        [{ path: "card.pdf", change: "created" as const }],
      ],
    ]);
  });

  it("lets a command's action finish when its created files cannot be recorded", async () => {
    const { recovery } = recoveryRecording({
      keepCommandChanges: async () => {
        throw new Error("No space.");
      },
    });
    const rewind = new ComposedRewind({ conversation: planner(), recovery });

    await expect(
      rewind.keepCommandChanges(
        "action-1",
        "C:/work",
        [{ path: "card.pdf", change: "created" as const }],
        "conversation-1",
      ),
    ).resolves.toBeUndefined();
  });

  it("keeps a copy of what the change would overwrite in the workspace", async () => {
    const { recovery } = recoveryRecording();
    const rewind = new ComposedRewind({ conversation: planner(), recovery });

    expect(
      await rewind.backUp("action-1", "C:/work", changes, "conversation-1"),
    ).toEqual({
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

    expect(
      await rewind.backUp("action-1", undefined, changes, "conversation-1"),
    ).toEqual({
      actionId: "action-1",
      files: [
        {
          path: "notes.md",
          status: "unprotected",
          reason: "No workspace was available for recovery.",
        },
      ],
    });
    expect(
      await rewind.backUp("action-2", "C:/work", changes, "conversation-1"),
    ).toEqual({
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
