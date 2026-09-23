/**
 * How the history sits on disk: a folder per conversation holding a small
 * summary and the conversation itself, and the settings beside them. The list
 * of conversations is not stored anywhere; it is the folders, read through
 * their summaries and ordered by when each conversation last changed.
 */

import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileSessions } from "../src/index.js";
import {
  conversationFolder,
  historyFolder,
  plantHistory,
} from "./planted-history.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "zhiyin-history-layout-"));
  roots.push(root);
  return root;
}

function task(id: string, updatedAt: string) {
  return {
    id,
    title: `Conversation ${id}`,
    titleSource: "manual",
    updatedAt,
    updatedLabel: "Earlier",
    messages: [{ id: `${id}-m1`, role: "user", text: "Hello", sequence: 0 }],
    actions: [],
    phase: { kind: "completed", outcome: { title: "Done", summary: "Done." } },
  };
}

const history = {
  preferences: { onboarded: true, interests: ["writing"] },
  selectedTaskId: "b",
  tasks: [
    task("a", "2026-09-20T10:00:00.000Z"),
    task("b", "2026-09-22T10:00:00.000Z"),
    task("c", "2026-09-21T10:00:00.000Z"),
  ],
};

async function listed(root: string) {
  return (await new FileSessions(root).loadIndex())?.conversations.map(
    (item) => [item.id, item.title],
  );
}

describe("the history on disk", () => {
  it("keeps each conversation in its own folder, as a summary and the conversation, with the settings beside them", async () => {
    const root = await temporaryRoot();
    await plantHistory(root, history);

    expect((await readdir(historyFolder(root))).sort()).toEqual([
      "conversations",
      "settings.json",
    ]);
    expect((await readdir(conversationFolder(root, "a"))).sort()).toEqual([
      "conversation.jsonl",
      "meta.json",
    ]);
    expect(
      JSON.parse(
        await readFile(
          join(conversationFolder(root, "a"), "meta.json"),
          "utf8",
        ),
      ),
    ).toMatchObject({
      id: "a",
      title: "Conversation a",
      updatedAt: "2026-09-20T10:00:00.000Z",
    });
    const settings = JSON.parse(
      await readFile(join(historyFolder(root), "settings.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(settings).toMatchObject({
      preferences: history.preferences,
      selectedTaskId: "b",
    });
    expect(JSON.stringify(settings)).not.toContain("Conversation");
  });

  it("lists conversations by when each last changed, newest first", async () => {
    const root = await temporaryRoot();
    await plantHistory(root, history);

    expect((await listed(root))?.map(([id]) => id)).toEqual(["b", "c", "a"]);
  });

  it("lists a conversation whose summary is missing or broken from the conversation itself", async () => {
    const root = await temporaryRoot();
    await plantHistory(root, history);
    await rm(join(conversationFolder(root, "a"), "meta.json"));
    await writeFile(
      join(conversationFolder(root, "c"), "meta.json"),
      '{"id":"c","ti',
      "utf8",
    );

    expect(await listed(root)).toEqual([
      ["b", "Conversation b"],
      ["c", "Conversation c"],
      ["a", "Conversation a"],
    ]);
  });

  it("lists a conversation whose summary is older than the conversation as the conversation is now", async () => {
    const root = await temporaryRoot();
    await plantHistory(root, history);
    const meta = join(conversationFolder(root, "a"), "meta.json");
    const before = await readFile(meta, "utf8");
    const sessions = new FileSessions(root);
    await sessions.loadIndex();
    await sessions.saveWorkspace({
      ...history,
      tasks: [
        {
          ...history.tasks[0]!,
          title: "Renamed",
          updatedAt: "2026-09-23T10:00:00.000Z",
        },
        ...history.tasks.slice(1),
      ],
    } as never);
    await sessions.release();
    // As if the app closed after saving the conversation and before its summary.
    await writeFile(meta, before, "utf8");

    expect(await listed(root)).toEqual([
      ["a", "Renamed"],
      ["b", "Conversation b"],
      ["c", "Conversation c"],
    ]);
  });

  it("sets aside a conversation whose summary and file are both damaged, and says where it was kept", async () => {
    const root = await temporaryRoot();
    await plantHistory(root, history);
    const folder = conversationFolder(root, "c");
    await writeFile(join(folder, "meta.json"), "not json", "utf8");
    await writeFile(join(folder, "conversation.jsonl"), "not json", "utf8");

    const index = await new FileSessions(root).loadIndex();

    expect(index?.conversations.map((item) => item.id)).toEqual(["b", "a"]);
    expect(index?.setAside?.count).toBe(1);
    const kept = index!.setAside!.keptAt;
    expect(
      await readFile(join(kept, "c-c", "conversation.jsonl"), "utf8"),
    ).toBe("not json");
    await expect(readdir(folder)).rejects.toMatchObject({ code: "ENOENT" });
    // Said once: the next launch finds nothing left to set aside.
    expect(
      (await new FileSessions(root).loadIndex())?.setAside,
    ).toBeUndefined();
  });

  it("removes a conversation's folder once it is no longer listed", async () => {
    const root = await temporaryRoot();
    await plantHistory(root, history);
    const sessions = new FileSessions(root);
    await sessions.loadIndex();

    await sessions.saveWorkspace({
      ...history,
      tasks: history.tasks.filter((item) => item.id !== "c"),
    } as never);

    expect(
      (await readdir(join(historyFolder(root), "conversations"))).sort(),
    ).toEqual(["c-a", "c-b"]);
  });

  it("keeps the conversations when the settings were never written", async () => {
    const root = await temporaryRoot();
    await plantHistory(root, history);
    await rm(join(historyFolder(root), "settings.json"));

    const index = await new FileSessions(root).loadIndex();

    expect(index?.conversations.map((item) => item.id)).toEqual([
      "b",
      "c",
      "a",
    ]);
    expect(index?.selectedTaskId).toBeNull();
  });
});
