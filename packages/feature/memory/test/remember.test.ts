import { afterEach, describe, expect, it } from "vitest";
import { conversation, folders, memoryIn, typst } from "./fixture.js";

afterEach(() => folders.removeAll());

function refusal(outcome: { ok: boolean; reason?: string }): string {
  if (outcome.ok) throw new Error("The write was kept.");
  return outcome.reason!;
}

describe("keeping knowledge", () => {
  it("answers a new entry with its number, title, summary and where it was kept", async () => {
    const { memory } = await memoryIn();

    const kept = await memory.remember(typst, conversation());

    expect(kept).toMatchObject({
      ok: true,
      answer: {
        kept: "added",
        number: 1,
        title: "Typst over LaTeX",
        summary: "The university template needs a grid the LaTeX class breaks",
        scope: "everything",
        section: "knowledge",
      },
      change: {
        number: 1,
        title: "Typst over LaTeX",
        change: "added",
        scope: "everything",
        section: "knowledge",
      },
    });
  });

  it("names the entries a new one links to, so the model can follow them", async () => {
    const { memory } = await memoryIn();
    await memory.remember(
      {
        ...typst,
        title: "University template rules",
        summary: "Margins and fonts",
      },
      conversation(),
    );

    const kept = await memory.remember(
      { ...typst, text: "The title page (#1) needs a grid." },
      conversation(),
    );

    expect(kept.ok && kept.answer["links"]).toEqual([
      { number: 1, title: "University template rules" },
    ]);
  });

  it("changes an entry by its number, which stays", async () => {
    const { memory, clock } = await memoryIn();
    await memory.remember(typst, conversation());
    clock.later();

    const changed = await memory.remember(
      {
        number: 1,
        summary: "The graduate school's grid breaks the LaTeX class",
      },
      conversation(),
    );

    expect(changed).toMatchObject({
      ok: true,
      answer: { kept: "changed", number: 1 },
      change: { change: "changed", number: 1 },
    });
    expect((await memory.state()).entries).toMatchObject([
      {
        number: 1,
        title: "Typst over LaTeX",
        summary: "The graduate school's grid breaks the LaTeX class",
        written: "2026-10-31T09:01:00.000Z",
      },
    ]);
  });

  it("keeps what a change leaves empty, as models send a field they leave out", async () => {
    const { memory } = await memoryIn();
    await memory.remember(typst, conversation());

    await memory.remember(
      { number: 1, title: "", summary: " ", text: "Chosen on 4 October." },
      conversation(),
    );

    expect((await memory.state()).entries).toMatchObject([
      {
        title: "Typst over LaTeX",
        summary: "The university template needs a grid the LaTeX class breaks",
        text: "Chosen on 4 October.",
      },
    ]);
  });

  it("keeps a brief's line when its rewrite leaves it empty", async () => {
    const { memory } = await memoryIn();
    const project = (await memory.createProject("Thesis")).project!.id;
    const inThesis = conversation([], { project });
    await memory.remember(
      { section: "brief", summary: "Chapter 2 drafted", text: "Goal: June." },
      inThesis,
    );

    await memory.remember(
      { section: "brief", summary: "", text: "Goal: defend in June 2027." },
      inThesis,
    );

    expect(
      (await memory.state()).entries.find((entry) => entry.section === "brief"),
    ).toMatchObject({
      summary: "Chapter 2 drafted",
      text: "Goal: defend in June 2027.",
    });
  });

  it("removes an entry folded into another, and says which", async () => {
    const { memory } = await memoryIn();
    await memory.remember(typst, conversation());
    await memory.remember({ ...typst, title: "Typst chosen" }, conversation());

    const removed = await memory.remember(
      { number: 2, remove: true, mergedInto: 1 },
      conversation(),
    );

    expect(removed).toMatchObject({
      ok: true,
      change: { change: "removed", number: 2, mergedInto: 1 },
    });
    expect((await memory.state()).entries.map((entry) => entry.number)).toEqual(
      [1],
    );
  });

  it("refuses a number nothing is kept under", async () => {
    const { memory } = await memoryIn();

    expect(
      refusal(await memory.remember({ number: 9, text: "x" }, conversation())),
    ).toBe("Nothing is kept as #9. To keep something new, leave out number.");
  });

  it("refuses a new entry without a title, a summary or a text", async () => {
    const { memory } = await memoryIn();

    expect(
      refusal(
        await memory.remember(
          { section: "knowledge", scope: "everything", title: "Zotero" },
          conversation(),
        ),
      ),
    ).toBe("A new Knowledge entry needs a title, a summary and a text.");
  });

  it("refuses a title and summary too long for the list the model is sent", async () => {
    const { memory } = await memoryIn();

    const reason = refusal(
      await memory.remember(
        { ...typst, summary: "word ".repeat(60).trim() },
        conversation(),
      ),
    );

    expect(reason).toMatch(
      /^The title and summary take about \d+ tokens in the list; the most is 80\. Shorten them\.$/,
    );
  });

  it("refuses a title or summary of more than one line", async () => {
    const { memory } = await memoryIn();

    expect(
      refusal(
        await memory.remember(
          { ...typst, summary: "one\ntwo" },
          conversation(),
        ),
      ),
    ).toBe("A title and a summary are one line each.");
  });

  it("refuses a text over its limit", async () => {
    const { memory } = await memoryIn();

    const reason = refusal(
      await memory.remember(
        { ...typst, text: "a".repeat(1_500 * 3 + 3) },
        conversation(),
      ),
    );

    expect(reason).toBe(
      "The text takes about 1,501 tokens; an entry holds at most 1,500. Keep what will matter later, or split it into entries that link to each other.",
    );
  });

  it("refuses a new entry in a full scope, naming the entries used least", async () => {
    const { memory, clock } = await memoryIn();
    for (let index = 1; index <= 200; index += 1) {
      clock.later();
      await memory.remember(
        { ...typst, title: `Entry ${index}`, summary: `Line ${index}` },
        conversation(),
      );
    }

    const reason = refusal(
      await memory.remember({ ...typst, title: "One more" }, conversation()),
    );

    expect(reason).toBe(
      [
        "Everything you do already holds 200 Knowledge entries, the most it can. Fold this into an entry that covers its subject, or remove one that no longer matters. Used least recently:",
        "#1 Entry 1: Line 1",
        "#2 Entry 2: Line 2",
        "#3 Entry 3: Line 3",
        "#4 Entry 4: Line 4",
        "#5 Entry 5: Line 5",
      ].join("\n"),
    );
  });

  it("refuses the project's scope outside a project", async () => {
    const { memory } = await memoryIn();

    expect(
      refusal(
        await memory.remember({ ...typst, scope: "project" }, conversation()),
      ),
    ).toBe(
      'This conversation is in no project: keep this work\'s memory with scope "conversation", or with "everything" when it holds for anything the person does.',
    );
  });

  it("removes credentials before an entry is kept", async () => {
    const { memory } = await memoryIn();

    await memory.remember(
      {
        ...typst,
        text: "The staging key is sk-proj-abcdefghijklmnopqrstuvwxyz0123456789ABCD.",
      },
      conversation(),
    );

    expect((await memory.state()).entries[0]?.text).toBe(
      "The staging key is [credential omitted].",
    );
  });

  it("records that it was written while outside content or something private was held", async () => {
    const { memory } = await memoryIn();

    await memory.remember(
      typst,
      conversation([], { held: { outside: true, private: true } }),
    );

    expect((await memory.state()).entries[0]?.held).toEqual({
      outside: true,
      private: true,
    });
  });

  it("keeps the labels an entry had when another conversation changes it", async () => {
    const { memory } = await memoryIn();
    await memory.remember(typst, conversation([], { held: { outside: true } }));

    await memory.remember(
      { number: 1, summary: "Chosen for the grid" },
      conversation([], { held: { private: true } }),
    );

    expect((await memory.state()).entries[0]?.held).toEqual({
      outside: true,
      private: true,
    });
  });

  it("refuses input that is not an object of the tool's fields", async () => {
    const { memory } = await memoryIn();

    expect(refusal(await memory.remember("keep this", conversation()))).toBe(
      "remember takes an object of its fields.",
    );
  });
});

describe("keeping a project's brief", () => {
  it("rewrites the brief whole, with the project's line as its summary", async () => {
    const { memory } = await memoryIn();
    const project = (await memory.createProject("Thesis")).project!.id;
    const inThesis = conversation([], { project });
    await memory.remember(
      { section: "brief", summary: "Chapter 2 drafted", text: "Goal: June." },
      inThesis,
    );

    const changed = await memory.remember(
      {
        section: "brief",
        summary: "Chapter 3 with Prof. Martin",
        text: "Goal: defend in June 2027.",
      },
      inThesis,
    );

    expect(changed).toMatchObject({
      ok: true,
      change: { change: "changed", section: "brief", title: "Brief" },
    });
    expect(
      (await memory.state()).entries.filter(
        (entry) => entry.section === "brief",
      ),
    ).toMatchObject([
      {
        scope: project,
        title: "Brief",
        summary: "Chapter 3 with Prof. Martin",
        text: "Goal: defend in June 2027.",
      },
    ]);
  });

  it("refuses a brief whose line is too long for the Projects list", async () => {
    const { memory } = await memoryIn();
    const project = (await memory.createProject("Thesis")).project!.id;

    const reason = refusal(
      await memory.remember(
        { section: "brief", summary: "word ".repeat(30).trim(), text: "y" },
        conversation([], { project }),
      ),
    );

    expect(reason).toMatch(
      /^The project's name and summary take about \d+ tokens in the Projects list; the most is 30\. Shorten the summary\.$/,
    );
  });
});
