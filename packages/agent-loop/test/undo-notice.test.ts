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
