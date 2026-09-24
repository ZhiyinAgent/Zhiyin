/**
 * A long paste, from the window's side: kept before its message is sent, opened
 * in the person's own editor before and after, and never opened by a name the
 * store did not give it.
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CHANNEL, type PasteOutcome } from "@zhiyin/contract";
import { FileSessions } from "@zhiyin/session";
import { Core } from "../../src/index.js";
import { loopFrom, stubDependencies } from "./support.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function coreKeepingPastes() {
  const root = await mkdtemp(join(tmpdir(), "zhiyin-pastes-"));
  roots.push(root);
  const store = new FileSessions(root);
  const dependencies = stubDependencies(() => {});
  const opened: string[] = [];
  const workspace = loopFrom({
    ...dependencies,
    sessions: {
      ...dependencies.sessions,
      keep: (kind, conversationId, source) =>
        store.keep(kind, conversationId, source),
      locate: (kind, conversationId, id) =>
        store.locate(kind, conversationId, id),
      claimDrafts: (conversationId, ids) =>
        store.claimDrafts(conversationId, ids),
    },
  });
  const core = new Core({
    workspace,
    ownership: { claim: async () => {}, release: async () => {} },
    viewChecks: { answer: () => {}, abandon: () => {} },
    chooseFolder: async () => undefined,
    chooseSaveLocation: async () => undefined,
    openExternal: async () => {},
    openPath: async (path) => void opened.push(path),
    version: "1.0.0",
  });
  return { core, workspace, opened };
}

describe("a long paste", () => {
  it("is kept as it is pasted, and opens in the person's editor before and after it is sent", async () => {
    const { core, workspace, opened } = await coreKeepingPastes();
    const text = "first line\nsecond line\n".repeat(1_000);

    const kept = (await core.receive(CHANNEL.keepPaste, [
      text,
    ])) as PasteOutcome;
    if (kept.status !== "kept") throw new Error(kept.reason);
    expect(kept.attachment).toMatchObject({
      kind: "pastedText",
      bytes: Buffer.byteLength(text),
      lines: 2_000,
    });
    await core.receive(CHANNEL.openAttachment, [null, kept.attachment.id]);
    expect(await readFile(opened[0] ?? "", "utf8")).toBe(text);

    const taskId = await workspace.createTask();
    await core.receive(CHANNEL.sendMessage, [
      taskId,
      "",
      undefined,
      [kept.attachment.id],
    ]);
    await core.receive(CHANNEL.openAttachment, [taskId, kept.attachment.id]);

    expect(await readFile(opened[1] ?? "", "utf8")).toBe(text);
    expect(workspace.snapshot().tasks[0]?.messages[0]?.attachments).toEqual([
      kept.attachment,
    ]);
  });

  it("opens nothing it did not keep", async () => {
    const { core, opened } = await coreKeepingPastes();

    for (const id of ["pasted-never.txt", "..", "notes.exe"])
      await expect(
        core.receive(CHANNEL.openAttachment, [null, id]),
      ).rejects.toThrow("This pasted text is no longer available.");

    expect(opened).toEqual([]);
  });
});
