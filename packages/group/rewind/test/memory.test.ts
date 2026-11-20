import { writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
  emptyConversationLists,
  type RewindMemoryEffect,
  type RewindMemoryOutcome,
  type TaskAction,
  type WorkspaceTask,
} from "@zhiyin/contract";
import { ConversationRewind } from "@zhiyin/rewind-planner";
import type { Recovery, RecoveryReview } from "@zhiyin/recovery";
import { TemporaryFolders } from "@zhiyin/test-support";
import {
  ComposedRewind,
  FileRewindJournal,
  type PendingRewind,
  type RewindHost,
  type RewindJournal,
  type RewindMemoryHost,
} from "../src/index.js";

const folders = new TemporaryFolders();
afterEach(() => folders.removeAll());

const replace = (path: string, text: string) => writeFile(path, text, "utf8");

function kept(
  id: string,
  sequence: number,
  writeId: string,
  title: string,
  state?: "kept",
): TaskAction {
  return {
    id,
    action: "Keep in memory",
    target: title,
    status: "completed",
    sequence,
    memory: {
      writeId,
      title,
      change: "added",
      scope: "everything",
      scopeName: "Everything",
      section: "knowledge",
      ...(state ? { state } : {}),
    },
  };
}

/**
 * One turn that wrote a file and kept two Knowledge entries, and a How to
 * work rule the person already kept, then a later turn.
 */
function conversation(): WorkspaceTask {
  return {
    ...emptyConversationLists,
    id: "c1",
    title: "Bordeaux trip",
    titleSource: "manual",
    updatedAt: "2026-11-19T12:00:00.000Z",
    updatedLabel: "Now",
    workspace: { path: "C:/trip", name: "trip" },
    messages: [
      { id: "u1", role: "user", text: "Plan the trip", sequence: 0 },
      { id: "a1", role: "assistant", text: "Planned.", sequence: 5 },
      { id: "u2", role: "user", text: "Thanks", sequence: 6 },
    ],
    actions: [
      {
        id: "write-1",
        action: "Write plan",
        target: "plan.md",
        status: "completed",
        changes: [{ path: "plan.md", change: "created" }],
        sequence: 1,
      },
      kept("keep-1", 2, "w1", "Lodging apart"),
      kept("keep-2", 3, "w2", "Hotel prices"),
      kept("keep-3", 4, "w3", "How to work", "kept"),
    ],
    phase: { kind: "completed", outcome: { title: "Done", summary: "" } },
  };
}

/** What memory says of each write the turns kept, newest first. */
const reviewed: readonly RewindMemoryEffect[] = [
  { writeId: "w3", title: "How to work", status: "decided" },
  {
    writeId: "w2",
    title: "Hotel prices",
    status: "changed",
    reason: "#6 Hotel prices was changed since, so it was left as it is.",
  },
  { writeId: "w1", number: 5, title: "Lodging apart", status: "undoable" },
];

/** Memory as the core reaches it, writing down every take-back asked of it. */
function memoryRecording(options: { stopped?: boolean } = {}) {
  const asked: unknown[][] = [];
  const memory: RewindMemoryHost = {
    effects: async (actions) => {
      asked.push(["effects", actions.map((action) => action.id)]);
      return reviewed;
    },
    takeBack: async (effects, choice, cardsStay) => {
      asked.push(["takeBack", choice, cardsStay]);
      if (options.stopped) throw new Error("Zhiyin closed.");
      return effects.map((effect): RewindMemoryOutcome => ({
        writeId: effect.writeId,
        title: effect.title,
        ...(choice === "keep" || effect.status === "decided"
          ? { status: "kept" }
          : effect.status === "changed"
            ? { status: "refused", reason: effect.reason! }
            : { status: "undone" }),
      }));
    },
  };
  return { asked, memory };
}

/** File recovery that puts plan.md back, writing down each restore. */
function recoveryRecording() {
  const restores: string[] = [];
  const recovery = {
    review: async (id: string, workspaceRoot: string) =>
      ({
        id,
        workspaceRoot,
        files: [{ path: "plan.md", action: "remove", status: "recoverable" }],
        targets: [],
      }) as RecoveryReview,
    restore: async (review: RecoveryReview) => {
      restores.push(review.id);
      return { files: [{ path: "plan.md", status: "removed" as const }] };
    },
    forgetConversation: async () => {},
  } as unknown as Recovery;
  return { recovery, restores };
}

function hostFor(
  task: WorkspaceTask,
  memory: RewindMemoryHost,
  save?: (task: WorkspaceTask) => Promise<void>,
) {
  let current = task;
  const saved: WorkspaceTask[] = [];
  const host: RewindHost = {
    task: () => current,
    save:
      save ??
      (async (next) => {
        saved.push(next);
        current = next;
      }),
    memory,
  };
  return { host, saved, current: () => current };
}

function rewindWith(recovery: Recovery, journal?: RewindJournal) {
  let number = 0;
  return new ComposedRewind({
    conversation: new ConversationRewind(() => `op-${++number}`),
    recovery,
    ...(journal ? { journal } : {}),
    now: () => new Date("2026-11-20T09:00:00.000Z"),
  });
}

describe("going back past turns that kept something in memory", () => {
  it("reviews what each of their writes would become, newest first", async () => {
    const { memory, asked } = memoryRecording();
    const rewind = rewindWith(recoveryRecording().recovery);
    const { host } = hostFor(conversation(), memory);

    const previewed = await rewind.preview("c1", "u1", host);

    expect(previewed).toMatchObject({
      ok: true,
      preview: { memory: reviewed },
    });
    expect(asked).toEqual([
      ["effects", ["write-1", "keep-1", "keep-2", "keep-3"]],
    ]);
  });

  it("takes back the writes before the conversation is saved, written down in the journal, and says what became of each", async () => {
    const order: string[] = [];
    const entries: PendingRewind[] = [];
    const journal: RewindJournal = {
      pending: async () => entries,
      begin: async (entry) => {
        order.push("intent");
        entries.push(entry);
      },
      filesRestored: async (_id, result) =>
        void order.push(result.memory ? "memory-recorded" : "files-recorded"),
      complete: async () => void order.push("complete"),
    };
    const { memory } = memoryRecording();
    const recording: RewindMemoryHost = {
      effects: memory.effects,
      takeBack: async (...args) => {
        order.push("memory");
        return memory.takeBack(...args);
      },
    };
    const { recovery } = recoveryRecording();
    const rewind = rewindWith(recovery, journal);
    const { host } = hostFor(conversation(), recording, async () => {
      order.push("conversation");
    });
    const previewed = await rewind.preview("c1", "u1", host);
    if (!previewed.ok) throw new Error(previewed.reason);

    const committed = await rewind.commit(
      "c1",
      previewed.preview.id,
      "restore",
      host,
      "undo",
    );

    expect(order).toEqual([
      "intent",
      "files-recorded",
      "memory",
      "memory-recorded",
      "conversation",
      "complete",
    ]);
    expect(entries[0]?.memory).toEqual({ effects: reviewed, choice: "undo" });
    expect(committed).toEqual({
      ok: true,
      result: {
        files: [{ path: "plan.md", status: "removed" }],
        memory: [
          { writeId: "w3", title: "How to work", status: "kept" },
          {
            writeId: "w2",
            title: "Hotel prices",
            status: "refused",
            reason:
              "#6 Hotel prices was changed since, so it was left as it is.",
          },
          { writeId: "w1", title: "Lodging apart", status: "undone" },
        ],
      },
    });
  });

  it("leaves memory as it is when the person keeps it, saying the conversation no longer shows the writes", async () => {
    const { memory, asked } = memoryRecording();
    const { recovery, restores } = recoveryRecording();
    const rewind = rewindWith(recovery);
    const { host } = hostFor(conversation(), memory);
    const previewed = await rewind.preview("c1", "u1", host);
    if (!previewed.ok) throw new Error(previewed.reason);

    const committed = await rewind.commit(
      "c1",
      previewed.preview.id,
      "restore",
      host,
      "keep",
    );

    expect(asked.at(-1)).toEqual(["takeBack", "keep", false]);
    expect(restores).toHaveLength(1);
    expect(committed).toMatchObject({
      ok: true,
      result: {
        memory: [
          { writeId: "w3", status: "kept" },
          { writeId: "w2", status: "kept" },
          { writeId: "w1", status: "kept" },
        ],
      },
    });
  });

  it("takes memory back keeping every file, putting no file back", async () => {
    const { memory, asked } = memoryRecording();
    const { recovery, restores } = recoveryRecording();
    const rewind = rewindWith(recovery);
    const { host, saved } = hostFor(conversation(), memory);
    const previewed = await rewind.preview("c1", "u1", host);
    if (!previewed.ok) throw new Error(previewed.reason);

    const committed = await rewind.commit(
      "c1",
      previewed.preview.id,
      "keep",
      host,
      "undo",
    );

    expect(restores).toEqual([]);
    expect(asked.at(-1)).toEqual(["takeBack", "undo", false]);
    expect(committed).toMatchObject({
      ok: true,
      result: { files: [], memory: [{}, {}, { status: "undone" }] },
    });
    expect(saved).toHaveLength(1);
    expect(saved[0]?.messages).toEqual([]);
  });

  it("takes memory back after a restart when Zhiyin stopped before it could, and the conversation is rewound as reviewed", async () => {
    const directory = await folders.make("zhiyin-rewind-memory-");
    const stopping = memoryRecording({ stopped: true });
    const { recovery } = recoveryRecording();
    const first = rewindWith(
      recovery,
      new FileRewindJournal(directory, replace),
    );
    const before = hostFor(conversation(), stopping.memory);
    const previewed = await first.preview("c1", "u1", before.host);
    if (!previewed.ok) throw new Error(previewed.reason);
    await expect(
      first.commit("c1", previewed.preview.id, "keep", before.host, "undo"),
    ).rejects.toThrow("Zhiyin closed.");
    expect(before.saved).toEqual([]);

    const again = memoryRecording();
    const restarted = rewindWith(
      recovery,
      new FileRewindJournal(directory, replace),
    );
    const after = hostFor(before.current(), again.memory);
    await restarted.resume(after.host);

    expect(again.asked).toEqual([["takeBack", "undo", false]]);
    expect(after.saved).toHaveLength(1);
    expect(after.saved[0]?.messages).toEqual([]);
    await expect(
      new FileRewindJournal(directory, replace).pending(),
    ).resolves.toEqual([]);
  });

  it("does not take memory back a second time after a restart that finds it done but the conversation unsaved", async () => {
    const directory = await folders.make("zhiyin-rewind-memory-");
    const { memory, asked } = memoryRecording();
    const { recovery } = recoveryRecording();
    const first = rewindWith(
      recovery,
      new FileRewindJournal(directory, replace),
    );
    const before = hostFor(conversation(), memory, async () => {
      throw new Error("Zhiyin closed before the conversation was saved.");
    });
    const previewed = await first.preview("c1", "u1", before.host);
    if (!previewed.ok) throw new Error(previewed.reason);
    await expect(
      first.commit("c1", previewed.preview.id, "keep", before.host, "undo"),
    ).rejects.toThrow("closed before");

    const restarted = rewindWith(
      recovery,
      new FileRewindJournal(directory, replace),
    );
    const after = hostFor(before.current(), memory);
    await restarted.resume(after.host);

    expect(asked.filter(([what]) => what === "takeBack")).toHaveLength(1);
    expect(after.saved).toHaveLength(1);
  });
});

describe("undoing a turn that kept something in memory", () => {
  it("reviews the turn's own writes beside its files", async () => {
    const { memory, asked } = memoryRecording();
    const rewind = rewindWith(recoveryRecording().recovery);
    const { host } = hostFor(conversation(), memory);

    const previewed = await rewind.previewUndo("c1", "u1", host);

    expect(previewed).toMatchObject({
      ok: true,
      preview: {
        files: [{ path: "plan.md" }],
        memory: reviewed,
      },
    });
    expect(asked).toEqual([
      ["effects", ["write-1", "keep-1", "keep-2", "keep-3"]],
    ]);
  });

  it("takes back what memory can, marks those cards undone, and records each outcome with the undo", async () => {
    const { memory, asked } = memoryRecording();
    const rewind = rewindWith(recoveryRecording().recovery);
    const { host, saved } = hostFor(conversation(), memory);
    await rewind.previewUndo("c1", "u1", host);

    const undone = await rewind.commitUndo("c1", "op-1", host);

    expect(asked.at(-1)).toEqual(["takeBack", "undo", true]);
    expect(undone).toMatchObject({
      ok: true,
      result: { memory: [{ status: "kept" }, { status: "refused" }, {}] },
    });
    expect(saved[0]?.undos[0]).toMatchObject({
      actionIds: ["write-1"],
      files: [{ path: "plan.md", status: "removed" }],
      memory: [
        { writeId: "w3", status: "kept" },
        { writeId: "w2", status: "refused" },
        { writeId: "w1", status: "undone" },
      ],
    });
    expect(
      saved[0]?.actions.flatMap((action) =>
        action.memory ? [[action.memory.writeId, action.memory.state]] : [],
      ),
    ).toEqual([
      ["w1", "undone"],
      ["w2", undefined],
      ["w3", "kept"],
    ]);
  });

  it("undoes only memory when the person keeps the files, leaving the files to undo later", async () => {
    const { memory } = memoryRecording();
    const { recovery, restores } = recoveryRecording();
    const rewind = rewindWith(recovery);
    const { host, saved } = hostFor(conversation(), memory);
    await rewind.previewUndo("c1", "u1", host);

    await rewind.commitUndo("c1", "op-1", host, {
      files: "keep",
      memory: "undo",
    });

    expect(restores).toEqual([]);
    expect(saved[0]?.undos[0]).toMatchObject({ actionIds: [], files: [] });
    expect(saved[0]?.undos[0]?.memory).toHaveLength(3);
    expect(await rewind.previewUndo("c1", "u1", host)).toMatchObject({
      ok: true,
      preview: { files: [{ path: "plan.md" }] },
    });
  });

  it("refuses an undo of neither files nor memory", async () => {
    const { memory } = memoryRecording();
    const { recovery, restores } = recoveryRecording();
    const rewind = rewindWith(recovery);
    const { host, saved } = hostFor(conversation(), memory);
    await rewind.previewUndo("c1", "u1", host);

    expect(
      await rewind.commitUndo("c1", "op-1", host, {
        files: "keep",
        memory: "keep",
      }),
    ).toEqual({
      ok: false,
      reason: "Choose the file changes or the memory changes to undo.",
    });
    expect(restores).toEqual([]);
    expect(saved).toEqual([]);
  });

  it("finishes after a restart with each memory outcome recorded, as an undo finished at once is", async () => {
    const directory = await folders.make("zhiyin-undo-memory-");
    const { memory, asked } = memoryRecording();
    const { recovery } = recoveryRecording();
    const atOnce = rewindWith(recovery);
    const finished = hostFor(conversation(), memory);
    await atOnce.previewUndo("c1", "u1", finished.host);
    await atOnce.commitUndo("c1", "op-1", finished.host);

    const first = rewindWith(
      recovery,
      new FileRewindJournal(directory, replace),
    );
    const before = hostFor(conversation(), memory, async () => {
      throw new Error("Zhiyin closed before the conversation was saved.");
    });
    await first.previewUndo("c1", "u1", before.host);
    await expect(first.commitUndo("c1", "op-1", before.host)).rejects.toThrow(
      "closed before",
    );
    const restarted = rewindWith(
      recovery,
      new FileRewindJournal(directory, replace),
    );
    const after = hostFor(before.current(), memory);
    await restarted.resume(after.host);

    expect(after.saved[0]?.undos).toEqual(finished.saved[0]?.undos);
    expect(after.saved[0]?.actions).toEqual(finished.saved[0]?.actions);
    expect(asked.filter(([what]) => what === "takeBack")).toHaveLength(2);
  });
});
