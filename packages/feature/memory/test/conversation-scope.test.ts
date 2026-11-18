import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { conversation, folders, memoryIn, typst } from "./fixture.js";

afterEach(() => folders.removeAll());

/** A conversation in no project, by its id. */
const trip = (more = {}) =>
  conversation([], {
    conversation: { id: "c7", title: "Shanghai trip for Lin" },
    ...more,
  });

const flights = {
  section: "knowledge",
  scope: "conversation",
  title: "Flights booked",
  summary: "Land Pudong Fri 27 Nov morning, home Mon 30 Nov night",
  text: "Both on EU passports, so no visa for 30 days.",
} as const;

const tripBrief = {
  section: "brief",
  scope: "conversation",
  summary: "Three days in Shanghai for Lin's 30th, PDF made",
  text: "Goal: a three-day plan and a card to send her. Open: book the dinner.",
} as const;

describe("a conversation outside any project keeps memory of its own", () => {
  it("keeps a Knowledge entry for the conversation alone", async () => {
    const { memory } = await memoryIn();

    const kept = await memory.remember(flights, trip());

    expect(kept).toMatchObject({
      ok: true,
      answer: { kept: "added", number: 1, scope: "this conversation" },
      change: { change: "added", section: "knowledge" },
    });
    expect((await memory.state()).entries).toMatchObject([
      { number: 1, scope: "conversation:c7", title: "Flights booked" },
    ]);
  });

  it("keeps a brief of where the conversation's work stands", async () => {
    const { memory } = await memoryIn();

    const kept = await memory.remember(tripBrief, trip());

    expect(kept).toMatchObject({
      ok: true,
      change: { change: "added", section: "brief", title: "Brief" },
    });
    expect((await memory.state()).entries).toMatchObject([
      {
        scope: "conversation:c7",
        section: "brief",
        summary: "Three days in Shanghai for Lin's 30th, PDF made",
      },
    ]);
  });

  it("keeps its files in a folder of the conversation's own", async () => {
    const { memory, folder } = await memoryIn();

    await memory.remember(flights, trip());
    await memory.remember(tripBrief, trip());

    expect(existsSync(join(folder, "conversations", "c7", "brief.md"))).toBe(
      true,
    );
    expect(
      existsSync(
        join(folder, "conversations", "c7", "knowledge", "1 flights-booked.md"),
      ),
    ).toBe(true);
  });

  it("lets only the conversation that kept an entry change it", async () => {
    const { memory } = await memoryIn();
    await memory.remember(flights, trip());

    const other = await memory.remember(
      { number: 1, text: "Changed." },
      conversation([], { conversation: { id: "c9", title: "Tax return" } }),
    );

    expect(other).toEqual({
      ok: false,
      reason:
        "#1 is kept for the conversation “Shanghai trip for Lin”, so it is changed only from that conversation.",
    });
  });

  it("is read by recall from any conversation", async () => {
    const { memory } = await memoryIn();
    await memory.remember(flights, trip());

    const read = await memory.recall({ numbers: [1] });

    expect(read.answer).toMatchObject({
      entries: [
        {
          number: 1,
          title: "Flights booked",
          scope: "the conversation “Shanghai trip for Lin”",
        },
      ],
    });
  });

  it("refuses the conversation's scope in a project, naming the project's", async () => {
    const { memory } = await memoryIn();
    const project = (await memory.createProject("Thesis")).project!.id;

    expect(await memory.remember(flights, trip({ project }))).toEqual({
      ok: false,
      reason:
        'This conversation is in the project Thesis: keep this work\'s memory with scope "project".',
    });
  });

  it("refuses the project's scope outside a project, naming the conversation's", async () => {
    const { memory } = await memoryIn();

    expect(
      await memory.remember({ ...typst, scope: "project" }, trip()),
    ).toEqual({
      ok: false,
      reason:
        'This conversation is in no project: keep this work\'s memory with scope "conversation", or with "everything" when it holds for anything the person does.',
    });
  });

  it("names the scope on the conversation's card as this conversation", async () => {
    const { memory } = await memoryIn();

    const kept = await memory.remember(flights, trip());

    expect(kept.ok && kept.change.scopeName).toBe("This conversation");
  });

  it("lets the person write its brief and knowledge, never an instruction for it alone", async () => {
    const { memory } = await memoryIn();

    expect(
      await memory.add({
        scope: "conversation:c7",
        section: "brief",
        summary: "Planning the trip",
        text: "Goal: three days.",
      }),
    ).toMatchObject({ ok: true });
    expect(
      await memory.add({
        scope: "conversation:c7",
        section: "knowledge",
        title: "Hotel",
        summary: "The Puli, two nights",
        text: "Booked.",
      }),
    ).toMatchObject({ ok: true });
    expect(
      await memory.add({
        scope: "conversation:c7",
        section: "how",
        text: "Answer in French.",
      }),
    ).toEqual({
      ok: false,
      reason: "How to work is kept for everything or a project.",
    });
  });

  it("lets the person move its entry to everything, never into another conversation", async () => {
    const { memory } = await memoryIn();
    await memory.remember(flights, trip());

    expect(await memory.move(1, "conversation:c9")).toEqual({
      ok: false,
      reason: "An entry is kept for a conversation only by that conversation.",
    });
    expect(await memory.move(1, "everything")).toEqual({ ok: true });
    expect((await memory.state()).entries).toMatchObject([
      { number: 1, scope: "everything" },
    ]);
  });

  it("takes back what it kept for itself on Undo", async () => {
    const { memory } = await memoryIn();
    const kept = await memory.remember(flights, trip());
    if (!kept.ok) throw new Error(kept.reason);

    expect(await memory.undo(kept.change.writeId)).toEqual({ ok: true });

    expect((await memory.state()).entries).toEqual([]);
  });
});

describe("what a conversation outside any project is sent", () => {
  it("sends its brief and its Knowledge before the person's", async () => {
    const { memory } = await memoryIn();
    await memory.remember(typst, trip());
    await memory.remember(flights, trip());
    await memory.remember(tripBrief, trip());

    const { known } = await memory.startOf(undefined, "c7");

    expect(known).toBe(
      [
        "Brief of this conversation (#3):",
        "Goal: a three-day plan and a card to send her. Open: book the dinner.",
        "",
        "Knowledge for this conversation:",
        "#2 Flights booked: Land Pudong Fri 27 Nov morning, home Mon 30 Nov night",
        "",
        "Knowledge for everything the person does:",
        "#1 Typst over LaTeX: The university template needs a grid the LaTeX class breaks",
      ].join("\n"),
    );
  });

  it("sends nothing of another conversation's own memory", async () => {
    const { memory } = await memoryIn();
    await memory.remember(flights, trip());

    const { known } = await memory.startOf(undefined, "c9");

    expect(known).toBe("");
  });

  it("lets the person's list fill what the conversation's leaves, up to a hundred lines", async () => {
    const { memory, clock } = await memoryIn();
    for (let index = 1; index <= 110; index += 1) {
      clock.later();
      await memory.remember(
        { ...typst, title: `Entry ${index}`, summary: `Line ${index}` },
        trip(),
      );
    }
    for (let index = 1; index <= 30; index += 1)
      await memory.remember(
        { ...flights, title: `Trip ${index}`, summary: `Fact ${index}` },
        trip(),
      );

    const { known } = await memory.startOf(undefined, "c7");

    const lines = known.split("\n").filter((line) => /^#\d+ /.test(line));
    expect(lines.filter((line) => line.includes(" Trip "))).toHaveLength(30);
    expect(lines.filter((line) => line.includes(" Entry "))).toHaveLength(70);
    expect(known).toContain("40 more are kept; recall finds them by words.");
  });
});

describe("a conversation that joins a project takes its memory along", () => {
  it("moves its entries into the project, keeping their numbers", async () => {
    const { memory } = await memoryIn();
    await memory.remember(flights, trip());
    const project = (await memory.createProject("Lin's 30th")).project!.id;

    await memory.startOf(project, "c7");

    expect((await memory.state()).entries).toMatchObject([
      { number: 1, scope: project, title: "Flights booked" },
    ]);
  });

  it("makes its brief the project's when the project has none", async () => {
    const { memory } = await memoryIn();
    await memory.remember(tripBrief, trip());
    const project = (await memory.createProject("Lin's 30th")).project!.id;

    const { known } = await memory.startOf(project, "c7");

    expect(known).toContain(
      "Brief of Lin's 30th, the project this conversation is in (#1):",
    );
  });

  it("keeps its brief as a Knowledge entry when the project has one", async () => {
    const { memory } = await memoryIn();
    const project = (await memory.createProject("Lin's 30th")).project!.id;
    await memory.remember(
      { section: "brief", summary: "Planning", text: "Goal: the trip." },
      conversation([], { project }),
    );
    await memory.remember(tripBrief, trip());

    await memory.startOf(project, "c7");

    expect(
      (await memory.state()).entries.map(
        ({ number, scope, section, title }) => ({
          number,
          scope,
          section,
          title,
        }),
      ),
    ).toEqual([
      { number: 1, scope: project, section: "brief", title: "Brief" },
      {
        number: 2,
        scope: project,
        section: "knowledge",
        title: "Where “Shanghai trip for Lin” stood",
      },
    ]);
  });
});

describe("deleting a conversation", () => {
  it("forgets its own memory, keeping the person's entries it wrote unless asked", async () => {
    const { memory } = await memoryIn();
    await memory.remember(typst, trip());
    await memory.remember(flights, trip());
    await memory.remember(tripBrief, trip());

    await memory.forgetConversation("c7", { own: true, general: false });

    expect((await memory.state()).entries.map((entry) => entry.title)).toEqual([
      "Typst over LaTeX",
    ]);
  });

  it("forgets the person's entries it wrote too when asked", async () => {
    const { memory } = await memoryIn();
    await memory.remember(typst, trip());
    await memory.remember(flights, trip());

    await memory.forgetConversation("c7", { own: true, general: true });

    expect((await memory.state()).entries).toEqual([]);
  });

  it("keeps its own memory when the person keeps it", async () => {
    const { memory } = await memoryIn();
    await memory.remember(typst, trip());
    await memory.remember(flights, trip());

    await memory.forgetConversation("c7", { own: false, general: true });

    expect((await memory.state()).entries.map((entry) => entry.title)).toEqual([
      "Flights booked",
    ]);
  });
});
