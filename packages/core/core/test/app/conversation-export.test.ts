/**
 * Exporting is asked of a conversation in the list, which may not have been
 * read from disk yet. The export has to be of the whole record, including
 * what was sent to the model, which the window itself never holds.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { emptyConversationLists, type WorkspaceTask } from "@zhiyin/contract";
import { conversationExport } from "@zhiyin/conversation-export";
import { FileSessions } from "@zhiyin/session";
import { TemporaryFolders } from "@zhiyin/test-support";
import { loopFrom, stubDependencies, storedIn } from "./support.js";

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

/** The files of a .zip, by name, read from its central directory. */
function unzipped(archive: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  const end = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let at = archive.readUInt32LE(end + 16);
  for (let index = 0; index < archive.readUInt16LE(end + 10); index++) {
    const size = archive.readUInt32LE(at + 20);
    const nameLength = archive.readUInt16LE(at + 28);
    const local = archive.readUInt32LE(at + 42);
    const name = archive.toString("utf8", at + 46, at + 46 + nameLength);
    const start = local + 30 + archive.readUInt16LE(local + 26);
    files.set(name, inflateRawSync(archive.subarray(start, start + size)));
    at += 46 + nameLength;
  }
  return files;
}

async function temporaryRoot(): Promise<string> {
  return folders.make("zhiyin-export-core-");
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
      ...storedIn(new FileSessions(root)),
      conversationExport: conversationExport(() => ({
        appVersion: "test",
        exportedAt: new Date("2026-10-05T12:00:00.000Z"),
      })),
      revealDelayMs: 0,
    });
    await app.initialize();
    const destination = join(root, "out.zip");

    const result = await app.exportConversation(
      "listed",
      "trajectory",
      async () => destination,
    );

    expect(result).toEqual({ status: "saved", destination });
    const trajectory = unzipped(await readFile(destination)).get(
      "trajectory.json",
    );
    const exported = JSON.parse(String(trajectory)) as {
      steps: { source: string; message: string }[];
      extra: { zhiyin: { conversation: { title: string } } };
    };
    expect(exported.extra.zhiyin.conversation.title).toBe("Only in the list");
    expect(exported.steps).toMatchObject([
      { source: "user", message: "Hello" },
    ]);
  });

  it("says so when the conversation cannot be found", async () => {
    const root = await temporaryRoot();
    const app = loopFrom({
      ...stubDependencies(() => {}),
      ...storedIn(new FileSessions(root)),
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
