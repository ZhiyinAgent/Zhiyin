import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { conversation, folders, memoryIn, typst } from "./fixture.js";

afterEach(() => folders.removeAll());

const day = 24 * 60;

/** Every file's text under a folder, as one string. */
async function everythingUnder(folder: string): Promise<string> {
  const texts: string[] = [];
  for (const entry of await readdir(folder, {
    recursive: true,
    withFileTypes: true,
  }))
    if (entry.isFile())
      texts.push(await readFile(join(entry.parentPath, entry.name), "utf8"));
  return texts.join("\n");
}

describe("letting go of what undoes a write", () => {
  it("lets the person undo their own removal for seven days", async () => {
    const { memory, clock } = await memoryIn();
    await memory.add(typst);
    const removed = await memory.remove(1);
    if (!removed.writeId) throw new Error("No write to undo.");

    clock.later(7 * day - 1);

    expect(await memory.undo(removed.writeId)).toEqual({ ok: true });
    expect((await memory.state()).entries).toMatchObject([
      { number: 1, title: typst.title },
    ]);
  });

  it("lets go of the person's own removal after seven days, leaving its text nowhere under the memory folder", async () => {
    const { memory, clock, folder } = await memoryIn();
    await memory.add(typst);
    const removed = await memory.remove(1);
    if (!removed.writeId) throw new Error("No write to undo.");

    clock.later(7 * day + 1);
    await memory.state();

    expect(await everythingUnder(folder)).not.toContain(typst.text);
    expect(await memory.undo(removed.writeId)).toEqual({
      ok: false,
      reason: "That change is no longer known.",
    });
  });

  it("lets go of an old removal of the person's when memory is next opened", async () => {
    const { memory, clock, folder } = await memoryIn();
    await memory.add(typst);
    await memory.remove(1);
    clock.later(8 * day);

    const reopened = await memoryIn({ folder });
    reopened.clock.later(8 * day);
    await reopened.memory.on();

    expect(await everythingUnder(folder)).not.toContain(typst.text);
  });

  it("keeps the Undo of a conversation's write as long as the conversation is kept", async () => {
    const { memory, clock } = await memoryIn();
    const added = await memory.remember(typst, conversation());
    if (!added.ok) throw new Error(added.reason);

    clock.later(30 * day);
    await memory.state();

    expect(await memory.undo(added.change.writeId)).toEqual({ ok: true });
  });

  it("lets go of what undoes a conversation's writes once the conversation is deleted, keeping what it wrote", async () => {
    const { memory } = await memoryIn();
    const added = await memory.remember(typst, conversation());
    if (!added.ok) throw new Error(added.reason);

    await memory.conversationDeleted("c1");

    expect(await memory.undo(added.change.writeId)).toEqual({
      ok: false,
      reason: "That change is no longer known.",
    });
    expect((await memory.state()).entries).toMatchObject([
      { number: 1, title: typst.title },
    ]);
  });

  it("forgets what a deleted conversation kept, leaving its text nowhere under the memory folder", async () => {
    const { memory, folder } = await memoryIn();
    await memory.remember(typst, conversation());
    await memory.remember(
      { ...typst, title: "Another conversation's entry", text: "Kept apart." },
      conversation([], {
        conversation: { id: "c2", title: "Another conversation" },
      }),
    );
    await memory.conversationDeleted("c1");

    expect(
      await memory.forgetConversation("c1", { own: true, general: true }),
    ).toEqual({ ok: true });

    expect((await memory.state()).entries).toMatchObject([
      { title: "Another conversation's entry" },
    ]);
    expect(await everythingUnder(folder)).not.toContain(typst.text);
  });
});
