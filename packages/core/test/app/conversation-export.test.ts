/**
 * Exporting is asked of a conversation in the list, which may not have been
 * read from disk yet. The export has to be of the whole record, including
 * what was sent to the model, which the window itself never holds.
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { emptyConversationLists, type WorkspaceTask } from "@zhiyin/contract";
import { conversationExport } from "@zhiyin/conversation-export";
import { FileSessions } from "@zhiyin/session";
import { loopFrom, stubDependencies } from "./support.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "zhiyin-export-core-"));
  roots.push(root);
  return root;
}

function conversation(id: string, title: string): WorkspaceTask {
  return {
    ...emptyConversationLists,
    id,
    title,
    titleSource: "manual",
    updatedAt: "2026-09-01T10:00:00.000Z",
    updatedLabel: "Earlier",
    messages: [{ id: `${id}-m`, role: "user", text: "Hello", sequence: 0 }],
    modelHistory: [{ id: `${id}-h`, kind: "message", messageId: `${id}-m` }],
    phase: { kind: "completed", outcome: { title: "Done", summary: "Done." } },
  };
}

describe("exporting a conversation", () => {
  it("exports one that was never opened, with what was sent to the model", async () => {
    const root = await temporaryRoot();
    await new FileSessions(root).saveWorkspace({
      tasks: [
        conversation("shown", "Shown at launch"),
        conversation("listed", "Only in the list"),
      ],
      selectedTaskId: "shown",
      recentWorkspaces: [],
    });
    const app = loopFrom({
      ...stubDependencies(() => {}),
      sessions: new FileSessions(root),
      conversationExport: conversationExport(() => ({
        appVersion: "test",
        exportedAt: new Date("2026-10-05T12:00:00.000Z"),
      })),
      revealDelayMs: 0,
    });
    await app.initialize();
    const destination = join(root, "out.json");

    const result = await app.exportConversation(
      "listed",
      "json",
      async () => destination,
    );

    expect(result).toEqual({ status: "saved", destination });
    const exported = JSON.parse(await readFile(destination, "utf8")) as {
      conversation: WorkspaceTask;
    };
    expect(exported.conversation.title).toBe("Only in the list");
    expect(exported.conversation.modelHistory).toEqual([
      { id: "listed-h", kind: "message", messageId: "listed-m" },
    ]);
  });

  it("says so when the conversation cannot be found", async () => {
    const root = await temporaryRoot();
    const app = loopFrom({
      ...stubDependencies(() => {}),
      sessions: new FileSessions(root),
      revealDelayMs: 0,
    });
    await app.initialize();

    expect(
      await app.exportConversation("missing", "html", async () => "unused"),
    ).toEqual({
      status: "failed",
      reason: "This conversation could not be opened, so it was not exported.",
    });
  });
});
