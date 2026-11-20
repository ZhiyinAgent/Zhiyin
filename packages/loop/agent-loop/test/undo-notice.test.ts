import { describe, expect, it } from "vitest";
import { emptyConversationLists, type WorkspaceTask } from "@zhiyin/contract";
import type { ModelRequest } from "@zhiyin/model-client";
import { stubDependencies, loopFrom } from "./support.js";

/** A conversation whose first turn's file changes the person undid. */
function undone(): WorkspaceTask {
  return {
    id: "task-1",
    title: "Notes",
    updatedLabel: "Now",
    titleSource: "generated",
    updatedAt: "2026-10-05T09:00:00.000Z",
    ...emptyConversationLists,
    messages: [
      { id: "u1", role: "user", text: "Rewrite the notes", sequence: 0 },
      { id: "a1", role: "assistant", text: "Rewritten.", sequence: 2 },
    ],
    actions: [
      {
        id: "write-1",
        action: "Write notes",
        target: "notes.md",
        status: "completed",
        changes: [{ path: "notes.md", change: "updated" }],
        sequence: 1,
      },
    ],
    undos: [
      {
        id: "undo-1",
        messageId: "u1",
        actionIds: ["write-1"],
        at: "2026-10-02T09:00:00.000Z",
        files: [
          { path: "notes.md", status: "restored" },
          { path: "new.md", status: "removed" },
          { path: "draft.md", status: "conflict" },
          {
            path: "big.csv",
            status: "unprotected",
            reason: "Too large to keep a copy.",
          },
        ],
      },
    ],
    phase: { kind: "completed", outcome: { title: "Done", summary: "" } },
  };
}

function undoNotices(request: ModelRequest | undefined): string[] {
  return (request?.messages ?? [])
    .map((message) =>
      typeof message.content === "string" ? message.content : "",
    )
    .filter((content) => content.includes('<zhiyin-notice kind="undo">'));
}

describe("a turn whose files the person undid", () => {
  it("is told again when a rewind cut the notice that told it", async () => {
    const requests: ModelRequest[] = [];
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      model: {
        ...deps.model,
        send: async function* (request) {
          requests.push(request);
          yield { kind: "textDelta" as const, text: "Noted." };
          yield { kind: "done" as const };
        },
      },
    });
    const told = undone();
    // Told once, then a rewind cut what the model was sent after the turn.
    loop.restore([
      {
        ...told,
        undos: told.undos.map((undo) => ({ ...undo, told: true as const })),
        modelHistory: [],
      },
    ]);

    await loop.start("task-1", "What is in the notes now?");
    await loop.start("task-1", "And the draft?");

    expect(undoNotices(requests[0])).toHaveLength(1);
    expect(undoNotices(requests[1])).toHaveLength(1);
  });

  it("is told to the model at its next request, file by file, and only once", async () => {
    const requests: ModelRequest[] = [];
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      model: {
        ...deps.model,
        send: async function* (request) {
          requests.push(request);
          yield { kind: "textDelta" as const, text: "Noted." };
          yield { kind: "done" as const };
        },
      },
    });
    loop.restore([undone()]);

    await loop.start("task-1", "What is in the notes now?");
    await loop.start("task-1", "And the draft?");

    const [told] = undoNotices(requests[0]);
    expect(told).toContain("Rewrite the notes");
    expect(told).toMatch(/put back[^]*notes\.md/i);
    expect(told).toMatch(/removed[^]*new\.md/i);
    expect(told).toMatch(/changed since[^]*draft\.md/i);
    expect(told).toMatch(/no copy[^]*big\.csv/i);
    expect(undoNotices(requests[1])).toHaveLength(1);
    expect(loop.snapshot().tasks[0]?.undos?.[0]?.told).toBe(true);
  });
});

describe("a turn whose memory changes the person undid", () => {
  async function toldOf(undo: WorkspaceTask["undos"][number]) {
    const requests: ModelRequest[] = [];
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      model: {
        ...deps.model,
        send: async function* (request) {
          requests.push(request);
          yield { kind: "textDelta" as const, text: "Noted." };
          yield { kind: "done" as const };
        },
      },
    });
    loop.restore([{ ...undone(), undos: [undo] }]);
    await loop.start("task-1", "What do you remember?");
    return undoNotices(requests[0])[0] ?? "";
  }

  it("names each entry taken back and each left kept, and does not say the conversation is unchanged", async () => {
    const told = await toldOf({
      id: "undo-1",
      messageId: "u1",
      actionIds: ["write-1"],
      at: "2026-10-02T09:00:00.000Z",
      files: [{ path: "notes.md", status: "restored" }],
      memory: [
        {
          writeId: "w2",
          number: 6,
          title: "Hotel prices",
          status: "undone",
        },
        {
          writeId: "w1",
          number: 5,
          title: "Lodging apart",
          status: "refused",
          reason:
            "#5 Lodging apart was changed since, so it was left as it is.",
        },
        { writeId: "w0", number: 2, title: "How to work", status: "kept" },
      ],
    });

    expect(told).toMatch(/taken back[^]*#6 Hotel prices/i);
    expect(told).toMatch(/still kept[^]*#5 Lodging apart[^]*#2 How to work/i);
    expect(told).toMatch(/put back[^]*notes\.md/i);
    expect(told).not.toContain("The conversation is unchanged");
  });

  it("tells of memory alone when the person kept the files", async () => {
    const told = await toldOf({
      id: "undo-1",
      messageId: "u1",
      actionIds: [],
      at: "2026-10-02T09:00:00.000Z",
      files: [],
      memory: [
        { writeId: "w2", number: 6, title: "Hotel prices", status: "undone" },
      ],
    });

    expect(told).toContain("what it kept in memory");
    expect(told).not.toContain("file changes");
    expect(told).toMatch(/taken back[^]*#6 Hotel prices/i);
  });
});
