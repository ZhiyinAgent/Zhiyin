import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { conversation, folders, memoryIn, typst } from "./fixture.js";

afterEach(() => folders.removeAll());

/** The kinds of the records kept to undo writes, as they are on disk. */
async function writeRecords(folder: string): Promise<string[]> {
  const where = join(folder, ".zhiyin", "writes");
  const names = await readdir(where).catch(() => [] as string[]);
  const kinds: string[] = [];
  for (const name of names)
    kinds.push(
      (
        JSON.parse(await readFile(join(where, name), "utf8")) as {
          kind: string;
        }
      ).kind,
    );
  return kinds;
}

const waitingRule = {
  section: "how",
  scope: "everything",
  rule: "Answer in French.",
  quote: "French",
} as const;

const afterOutside = conversation(["French"], {
  held: { outside: true, because: "a web page" },
});

describe("whether a write can be taken back, without taking it back", () => {
  it("says a write can be taken back, and leaves it kept", async () => {
    const { memory } = await memoryIn();
    const added = await memory.remember(typst, conversation());
    if (!added.ok) throw new Error(added.reason);

    expect(await memory.undoable(added.change.writeId)).toEqual({ ok: true });

    expect((await memory.state()).entries).toMatchObject([
      { number: 1, title: typst.title },
    ]);
    expect(await memory.undo(added.change.writeId)).toEqual({ ok: true });
  });

  it("says why an entry the person changed since would be left as it is", async () => {
    const { memory } = await memoryIn();
    const added = await memory.remember(typst, conversation());
    if (!added.ok) throw new Error(added.reason);
    await memory.edit(1, { summary: "The person's own words" });

    expect(await memory.undoable(added.change.writeId)).toEqual({
      ok: false,
      reason: "#1 Typst over LaTeX was changed since, so it was left as it is.",
    });
    expect((await memory.state()).entries[0]?.summary).toBe(
      "The person's own words",
    );
  });

  it("says when a write is no longer known", async () => {
    const { memory } = await memoryIn();

    expect(await memory.undoable("w9")).toEqual({
      ok: false,
      reason: "That change is no longer known.",
    });
  });
});

describe("a number taken back, as the conversation that kept it reads it", () => {
  it("says the entry was taken back when the person went back past the turn that kept it", async () => {
    const { memory } = await memoryIn();
    const added = await memory.remember(typst, conversation());
    if (!added.ok) throw new Error(added.reason);

    await memory.undo(added.change.writeId, "going back");
    const read = await memory.recall({ numbers: [1] }, "c1");

    expect(read.answer).toEqual({
      entries: [],
      takenBack: [
        "#1 was taken back when the person went back past the turn that kept it.",
      ],
    });
    expect(read.shown).toMatchObject({ notKept: [], takenBack: [1] });
  });

  it("says the entry was taken back when the person undid the turn that kept it", async () => {
    const { memory } = await memoryIn();
    const added = await memory.remember(typst, conversation());
    if (!added.ok) throw new Error(added.reason);

    await memory.undo(added.change.writeId, "undoing the turn");

    expect((await memory.recall({ numbers: [1] }, "c1")).answer).toEqual({
      entries: [],
      takenBack: [
        "#1 was taken back when the person undid the turn that kept it.",
      ],
    });
  });

  it("knows it after a restart, and keeps no entry's text to know it", async () => {
    const { memory, folder } = await memoryIn();
    const added = await memory.remember(typst, conversation());
    if (!added.ok) throw new Error(added.reason);
    await memory.undo(added.change.writeId, "going back");

    const { memory: again } = await memoryIn({ folder });

    expect(
      (await again.recall({ numbers: [1] }, "c1")).answer["takenBack"],
    ).toHaveLength(1);
    const kept = join(folder, ".zhiyin", "taken-back", "c1.json");
    expect(await readFile(kept, "utf8")).not.toContain(typst.title);
  });

  it("is said only to the conversation that kept it, and forgotten with it", async () => {
    const { memory } = await memoryIn();
    const added = await memory.remember(typst, conversation());
    if (!added.ok) throw new Error(added.reason);
    await memory.undo(added.change.writeId, "going back");

    expect((await memory.recall({ numbers: [1] }, "c2")).answer).toEqual({
      entries: [],
      notKept: [1],
    });
    await memory.conversationDeleted("c1");
    expect((await memory.recall({ numbers: [1] }, "c1")).answer).toEqual({
      entries: [],
      notKept: [1],
    });
  });

  it("is not said for a write the person undid from its card", async () => {
    const { memory } = await memoryIn();
    const added = await memory.remember(typst, conversation());
    if (!added.ok) throw new Error(added.reason);

    await memory.undo(added.change.writeId);

    expect((await memory.recall({ numbers: [1] }, "c1")).answer).toEqual({
      entries: [],
      notKept: [1],
    });
  });
});

describe("a write whose card is gone", () => {
  it("is let go of at once, nothing being left to offer its Undo, and what it wrote stays", async () => {
    const { memory, folder } = await memoryIn();
    const added = await memory.remember(typst, conversation());
    if (!added.ok) throw new Error(added.reason);

    await memory.cardsGone([added.change.writeId]);

    expect(await writeRecords(folder)).toEqual([]);
    expect(await memory.undo(added.change.writeId)).toEqual({
      ok: false,
      reason: "That change is no longer known.",
    });
    expect((await memory.state()).entries).toMatchObject([
      { number: 1, title: typst.title },
    ]);
  });
});

describe("the record that undoes a waiting change", () => {
  it("is let go of once the person keeps the change", async () => {
    const { memory, folder } = await memoryIn();
    await memory.remember(waitingRule, afterOutside);
    const [waiting] = (await memory.state()).waiting;

    expect(await memory.keep(waiting!.id)).toEqual({ ok: true });

    expect(await writeRecords(folder)).toEqual([]);
  });

  it("is let go of once the person discards the change", async () => {
    const { memory, folder } = await memoryIn();
    await memory.remember(waitingRule, afterOutside);
    const [waiting] = (await memory.state()).waiting;

    expect(await memory.discard(waiting!.id)).toEqual({ ok: true });

    expect(await writeRecords(folder)).toEqual([]);
  });

  it("is let go of when memory opens and its change no longer waits", async () => {
    const { memory, folder } = await memoryIn();
    await memory.remember(waitingRule, afterOutside);
    const [waiting] = (await memory.state()).waiting;
    // As a Keep that stopped after the change was let go.
    const { rm } = await import("node:fs/promises");
    await rm(join(folder, ".zhiyin", "waiting", `${waiting!.id}.json`));

    const { memory: reopened } = await memoryIn({ folder });
    await reopened.on();

    expect(await writeRecords(folder)).toEqual([]);
  });

  it("is kept while the change still waits", async () => {
    const { memory, folder } = await memoryIn();
    await memory.remember(waitingRule, afterOutside);

    const { memory: reopened } = await memoryIn({ folder });
    await reopened.on();

    expect(await writeRecords(folder)).toEqual(["waiting"]);
  });
});
