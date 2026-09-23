/**
 * What happens to a history that will not open.
 *
 * The rule is that nothing is destroyed and nothing is decided for the person.
 * The damaged bytes are kept before anything else happens, and what can be read
 * is reported so a choice can be made about it — rather than the app either
 * silently starting empty or refusing to start until a file the person has
 * never heard of is repaired by hand.
 *
 * Each conversation is its own file, so damage is either one conversation,
 * which fails alone, or the list of conversations, which is what asks the
 * person to choose.
 */

import { appendFile, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkspaceSnapshot } from "@zhiyin/contract";
import { FileSessions } from "../src/index.js";
import {
  conversationFolder,
  damage,
  indexFolder,
  plantHistory,
  plantUnreadableHistory,
} from "./planted-history.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), "zhiyin-damaged-"));
  roots.push(root);
  return root;
}

function task(id: string) {
  return {
    id,
    title: `Conversation ${id}`,
    titleSource: "generated",
    updatedAt: "2026-09-08T09:00:00.000Z",
    updatedLabel: "Tuesday",
    messages: [
      { id: `${id}-m1`, role: "user", text: "A question", sequence: 0 },
    ],
    actions: [],
    phase: { kind: "completed", outcome: { title: "Done", summary: "Done." } },
  };
}

const base = {
  runtime: { tasks: "available", capabilities: "available" },
  selectedTaskId: "keep-1",
  tasks: [task("keep-1"), task("keep-2")],
  mcpServers: [],
  usage: { status: "unavailable", reason: "None." },
};

/** One conversation the reader will refuse, among conversations that are fine. */
const oneBadTask = {
  ...base,
  tasks: [
    task("keep-1"),
    { ...task("broken"), phase: { kind: "invented" } },
    task("keep-2"),
  ],
};

/** A history whose list is damaged, holding one damaged conversation too. */
async function write(root: string, value: unknown) {
  await plantHistory(root, value);
  await damage(indexFolder(root));
}

async function onlyLog(folder: string): Promise<string> {
  const [name] = await readdir(folder);
  return readFile(join(folder, name!), "utf8");
}

describe("FileSessions damaged history", () => {
  it("reports how much of a damaged history can still be read", async () => {
    const root = await temporaryRoot();
    await write(root, oneBadTask);

    await expect(new FileSessions(root).inspectDamage()).resolves.toMatchObject(
      { kind: "partial", readable: 2, damaged: 1 },
    );
  });

  it("says when nothing can be read rather than guessing", async () => {
    const root = await temporaryRoot();
    await plantUnreadableHistory(root);

    await expect(new FileSessions(root).inspectDamage()).resolves.toMatchObject(
      { kind: "unreadable" },
    );
  });

  it("keeps the damaged bytes before anything is decided about them", async () => {
    const root = await temporaryRoot();
    await write(root, oneBadTask);
    const original = await onlyLog(indexFolder(root));
    const broken = await onlyLog(conversationFolder(root, "broken"));

    const kept = await new FileSessions(root).preserveDamaged();

    expect(await onlyLog(join(kept, "index"))).toBe(original);
    expect(await onlyLog(join(kept, "conversations", "c-broken"))).toBe(broken);
    // And what it was taken from is still there, untouched.
    expect(await onlyLog(indexFolder(root))).toBe(original);
  });

  it("keeps each damaged copy rather than overwriting the last one", async () => {
    const root = await temporaryRoot();
    await write(root, oneBadTask);
    const sessions = new FileSessions(root, {
      now: () => new Date("2026-09-10T08:00:00.000Z"),
    });
    const later = new FileSessions(root, {
      now: () => new Date("2026-09-10T09:30:00.000Z"),
    });

    await sessions.preserveDamaged();
    await later.preserveDamaged();

    const kept = (await readdir(join(root, "damaged-history"))).sort();
    expect(kept).toHaveLength(2);
  });

  it("recovers the conversations that could be read and leaves out the one that could not", async () => {
    const root = await temporaryRoot();
    await write(root, oneBadTask);
    const sessions = new FileSessions(root);

    const recovered = await sessions.recoverReadable();

    expect(recovered).toMatchObject({ recovered: 2, discarded: 1 });
    const restored = (await sessions.loadWorkspace()) as WorkspaceSnapshot;
    expect(restored.tasks.map((item) => item.id)).toEqual(["keep-1", "keep-2"]);
  });

  it("keeps the damaged file when it recovers what it can", async () => {
    const root = await temporaryRoot();
    await write(root, oneBadTask);
    const original = await onlyLog(indexFolder(root));

    await new FileSessions(root).recoverReadable();

    const kept = await readdir(join(root, "damaged-history"));
    expect(kept).toHaveLength(1);
    expect(
      await onlyLog(join(root, "damaged-history", kept[0]!, "index")),
    ).toBe(original);
  });

  it("keeps each setting that survived, whatever else in the list was damaged", async () => {
    const root = await temporaryRoot();
    const preferences = { onboarded: true, interests: ["writing"] };
    await plantHistory(root, {
      ...base,
      preferences,
      // A conversation whose entry in the list is not one: the list is damaged.
      tasks: [...base.tasks, { id: "untitled", phase: { kind: "invented" } }],
    });

    await new FileSessions(root).recoverReadable();

    expect((await new FileSessions(root).loadIndex())?.preferences).toEqual(
      preferences,
    );
  });

  it("chooses a selected conversation that survived the recovery", async () => {
    const root = await temporaryRoot();
    await write(root, {
      ...oneBadTask,
      selectedTaskId: "broken",
    });

    await new FileSessions(root).recoverReadable();

    const restored = (await new FileSessions(root).loadWorkspace())!;
    expect(restored.tasks.map((item) => item.id)).toContain(
      restored.selectedTaskId,
    );
  });

  it("refuses to recover a file that holds nothing readable, rather than starting empty behind the person's back", async () => {
    const root = await temporaryRoot();
    await plantUnreadableHistory(root);

    await expect(
      new FileSessions(root).recoverReadable(),
    ).rejects.toMatchObject({ code: "corrupted" });
    // The damaged file is still there to be preserved or discarded by choice.
    expect(await onlyLog(indexFolder(root))).toBe("not json");
  });

  it("refuses to save over a history that will not open", async () => {
    const root = await temporaryRoot();
    await write(root, base);
    const damaged = await onlyLog(indexFolder(root));

    await expect(
      new FileSessions(root).saveWorkspace(base as never),
    ).rejects.toMatchObject({ code: "corrupted" });
    expect(await onlyLog(indexFolder(root))).toBe(damaged);
  });
});

describe("one damaged conversation", () => {
  it("fails alone: the list opens, and so does every other conversation", async () => {
    const root = await temporaryRoot();
    await plantHistory(root, oneBadTask);
    const sessions = new FileSessions(root);

    const index = await sessions.loadIndex();

    expect(index?.conversations.map((item) => item.id)).toEqual([
      "keep-1",
      "broken",
      "keep-2",
    ]);
    await expect(sessions.openConversation("broken")).rejects.toMatchObject({
      code: "corrupted",
    });
    await expect(sessions.openConversation("keep-2")).resolves.toMatchObject({
      task: { id: "keep-2" },
      lost: false,
    });
  });

  it("opens without the save a crash cut off, and says one was lost", async () => {
    const root = await temporaryRoot();
    await plantHistory(root, base);
    const folder = conversationFolder(root, "keep-1");
    const [name] = await readdir(folder);
    await appendFile(
      join(folder, name!),
      '{"changes":[{"p":["title"],',
      "utf8",
    );

    await expect(
      new FileSessions(root).openConversation("keep-1"),
    ).resolves.toMatchObject({
      task: { title: "Conversation keep-1" },
      lost: true,
    });
  });

  it("reports conversations with no list as damage, not as an empty history", async () => {
    const root = await temporaryRoot();
    await plantHistory(root, base);
    await rm(indexFolder(root), { recursive: true });

    await expect(new FileSessions(root).loadIndex()).rejects.toMatchObject({
      code: "corrupted",
    });
    await expect(new FileSessions(root).inspectDamage()).resolves.toMatchObject(
      { kind: "partial", readable: 2, damaged: 0 },
    );
  });
});
