import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { conversation, folders, memoryIn, typst } from "./fixture.js";

afterEach(() => folders.removeAll());

async function writeId(
  outcome: Awaited<
    ReturnType<Awaited<ReturnType<typeof memoryIn>>["memory"]["remember"]>
  >,
) {
  if (!outcome.ok) throw new Error(outcome.reason);
  return outcome.change.writeId;
}

describe("taking a write back", () => {
  it("removes an entry the write added", async () => {
    const { memory } = await memoryIn();
    const added = await writeId(await memory.remember(typst, conversation()));

    expect(await memory.undo(added)).toEqual({ ok: true });

    expect((await memory.state()).entries).toEqual([]);
  });

  it("puts back what a change replaced", async () => {
    const { memory } = await memoryIn();
    await memory.remember(typst, conversation());
    const changed = await writeId(
      await memory.remember({ number: 1, summary: "Changed" }, conversation()),
    );

    await memory.undo(changed);

    expect((await memory.state()).entries[0]?.summary).toBe(typst.summary);
  });

  it("brings back a removed entry under its number", async () => {
    const { memory } = await memoryIn();
    await memory.remember(typst, conversation());
    const removed = await writeId(
      await memory.remember({ number: 1, remove: true }, conversation()),
    );

    await memory.undo(removed);

    expect((await memory.state()).entries).toMatchObject([
      { number: 1, title: typst.title },
    ]);
  });

  it("leaves an entry the person changed since, and says so", async () => {
    const { memory } = await memoryIn();
    const added = await writeId(await memory.remember(typst, conversation()));
    await memory.edit(1, { summary: "The person's own words" });

    expect(await memory.undo(added)).toEqual({
      ok: false,
      reason: "#1 Typst over LaTeX was changed since, so it was left as it is.",
    });
    expect((await memory.state()).entries[0]?.summary).toBe(
      "The person's own words",
    );
  });

  it("takes back a rule added to How to work, keeping the rules added after it", async () => {
    const { memory } = await memoryIn();
    const said = ["Answer in French. Keep it short."];
    const first = await writeId(
      await memory.remember(
        {
          section: "how",
          scope: "everything",
          rule: "Answer in French.",
          quote: "Answer in French.",
        },
        conversation(said),
      ),
    );
    await memory.remember(
      {
        section: "how",
        scope: "everything",
        rule: "Keep it short.",
        quote: "Keep it short.",
      },
      conversation(said),
    );

    await memory.undo(first);

    expect((await memory.state()).entries[0]?.text).toBe("- Keep it short.");
  });

  it("drops a change still waiting for the person", async () => {
    const { memory } = await memoryIn();
    const waiting = await writeId(
      await memory.remember(
        {
          section: "how",
          scope: "everything",
          rule: "Answer in French.",
          quote: "French",
        },
        conversation(["French"], {
          held: { outside: true, because: "a web page" },
        }),
      ),
    );

    await memory.undo(waiting);

    expect((await memory.state()).waiting).toEqual([]);
  });

  it("knows a write after the app restarts", async () => {
    const { memory, folder } = await memoryIn();
    const added = await writeId(await memory.remember(typst, conversation()));

    const { memory: again } = await memoryIn({ folder });

    expect(await again.undo(added)).toEqual({ ok: true });
    expect((await again.state()).entries).toEqual([]);
  });

  it("leaves an instruction written since a removal, and says so", async () => {
    const { memory } = await memoryIn();
    await memory.add({ scope: "everything", section: "about", text: "- Old." });
    const removed = await memory.remove(1);
    await memory.add({ scope: "everything", section: "about", text: "- New." });

    const undone = await memory.undo(removed.writeId!);

    expect(undone.ok).toBe(false);
    expect((await memory.state()).entries).toMatchObject([
      { section: "about", text: "- New." },
    ]);
  });

  it("brings a removed entry back into the project its own was merged into", async () => {
    const { memory } = await memoryIn();
    const thesis = (await memory.createProject("Thesis")).project!;
    const data = (await memory.createProject("Data")).project!;
    const added = await memory.add({
      scope: data.id,
      section: "knowledge",
      title: "Station 4 gap",
      text: "Lost in August 2025.",
    });
    const removed = await memory.remove(added.number!);
    await memory.mergeProject(data.id, thesis.id);

    expect(await memory.undo(removed.writeId!)).toEqual({ ok: true });

    expect((await memory.state()).entries).toMatchObject([
      { title: "Station 4 gap", scope: thesis.id },
    ]);
  });

  it("brings back no entry whose project is no longer kept, so none spreads to everything", async () => {
    const { memory } = await memoryIn();
    const data = (await memory.createProject("Data")).project!;
    const added = await memory.add({
      scope: data.id,
      section: "knowledge",
      title: "Station 4 gap",
      text: "Lost in August 2025.",
    });
    const removed = await memory.remove(added.number!);
    await memory.deleteProject(data.id);

    expect(await memory.undo(removed.writeId!)).toMatchObject({ ok: false });

    expect((await memory.state()).entries).toEqual([]);
  });

  it("says when there is no such write", async () => {
    const { memory } = await memoryIn();

    expect(await memory.undo("w9")).toEqual({
      ok: false,
      reason: "That change is no longer known.",
    });
  });
});

describe("the person's own changes", () => {
  it("writes an entry the person adds, with no quote needed", async () => {
    const { memory } = await memoryIn();

    const added = await memory.add({
      scope: "everything",
      section: "about",
      text: "- PhD student.",
    });

    expect(added).toEqual({ ok: true, number: 1 });
    expect((await memory.state()).entries).toMatchObject([
      {
        number: 1,
        section: "about",
        title: "About you",
        text: "- PhD student.",
      },
    ]);
  });

  it("refuses a second About you, which is one entry", async () => {
    const { memory } = await memoryIn();
    await memory.add({ scope: "everything", section: "about", text: "x" });

    expect(
      await memory.add({ scope: "everything", section: "about", text: "y" }),
    ).toEqual({ ok: false, reason: "About you is already kept as #1." });
  });

  it("keeps instructions past their limit when the person writes them", async () => {
    const { memory } = await memoryIn();

    const added = await memory.add({
      scope: "everything",
      section: "how",
      text: "a".repeat(5_000 * 3),
    });

    expect(added.ok).toBe(true);
  });

  it("still holds a Knowledge line to the list's limit", async () => {
    const { memory } = await memoryIn();
    await memory.remember(typst, conversation());

    expect(
      await memory.edit(1, { summary: "word ".repeat(60).trim() }),
    ).toMatchObject({
      ok: false,
    });
  });

  it("holds a Knowledge entry's text and a brief to their limits", async () => {
    const { memory } = await memoryIn();
    const thesis = (await memory.createProject("Thesis")).project!;
    await memory.remember(typst, conversation());

    expect(
      await memory.add({
        scope: "everything",
        section: "knowledge",
        title: "Long",
        text: "word ".repeat(2_000),
      }),
    ).toMatchObject({ ok: false });
    expect(await memory.edit(1, { text: "word ".repeat(2_000) })).toMatchObject(
      { ok: false },
    );
    expect(
      await memory.add({
        scope: thesis.id,
        section: "brief",
        summary: "Writing",
        text: "word ".repeat(2_000),
      }),
    ).toMatchObject({ ok: false });
  });

  it("keeps an entry whose removal could not be recorded for Undo", async () => {
    const { memory, folder } = await memoryIn();
    await memory.remember(typst, conversation());
    // A folder stands where the removal's record, the second write, goes.
    await mkdir(join(folder, ".zhiyin", "writes", "w2.json"), {
      recursive: true,
    });

    await expect(memory.remove(1)).rejects.toThrow();

    expect((await memory.state()).entries).toHaveLength(1);
  });

  it("removes an entry, and the removal can be taken back", async () => {
    const { memory } = await memoryIn();
    await memory.remember(typst, conversation());

    const removed = await memory.remove(1);
    expect((await memory.state()).entries).toEqual([]);

    await memory.undo(removed.writeId!);
    expect((await memory.state()).entries).toHaveLength(1);
  });
});
