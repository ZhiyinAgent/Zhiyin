import { afterEach, describe, expect, it } from "vitest";
import { conversation, folders, memoryIn } from "./fixture.js";

afterEach(() => folders.removeAll());

const entries = [
  {
    title: "University template rules",
    summary: "Margins, fonts and title page the graduate school requires",
    text: "Margins 2.5 cm. Body in Libertinus Serif, 11 pt.",
  },
  {
    title: "Typst over LaTeX",
    summary: "The university template needs a grid the LaTeX class breaks",
    text: "The title page (#1) needs a grid. References come from Zotero (#3).",
  },
  {
    title: "Zotero library",
    summary: "Where references are kept and how they reach a document",
    text: "References live in the Zotero group “Thèse”.",
  },
  {
    title: "Météo-France open data",
    summary: "Where hourly station series are, and their licence",
    text: "Hourly series are on meteo.data.gouv.fr.",
  },
];

async function kept() {
  const setUp = await memoryIn();
  for (const entry of entries) {
    setUp.clock.later();
    await setUp.memory.remember(
      { section: "knowledge", scope: "everything", ...entry },
      conversation(),
    );
  }
  setUp.clock.later();
  return setUp;
}

describe("reading memory", () => {
  it("reads an entry by its number, with the entries it links to and those linking to it", async () => {
    const { memory } = await kept();

    const read = await memory.recall({ numbers: [1] });

    expect(read.answer).toEqual({
      entries: [
        {
          number: 1,
          title: "University template rules",
          summary: "Margins, fonts and title page the graduate school requires",
          scope: "everything",
          section: "knowledge",
          written: "2026-10-31",
          text: "Margins 2.5 cm. Body in Libertinus Serif, 11 pt.",
          linksTo: [],
          linkedFrom: [{ number: 2, title: "Typst over LaTeX" }],
        },
      ],
    });
  });

  it("reads several numbers at once, and says which are not kept", async () => {
    const { memory } = await kept();

    const read = await memory.recall({ numbers: [2, 9] });

    expect(read.answer).toMatchObject({
      entries: [
        {
          number: 2,
          linksTo: [
            { number: 1, title: "University template rules" },
            { number: 3, title: "Zotero library" },
          ],
        },
      ],
      notKept: [9],
    });
  });

  it("finds entries by words, whatever their case or accents, the closest first", async () => {
    const { memory } = await kept();

    const read = await memory.recall({ searches: ["meteo france stations"] });

    expect(read.answer).toMatchObject({
      entries: [{ number: 4, title: "Météo-France open data" }],
    });
  });

  it("gives the five closest whole and names the rest by their lines, under the search that found them", async () => {
    const { memory } = await memoryIn();
    for (let index = 1; index <= 8; index += 1)
      await memory.remember(
        {
          section: "knowledge",
          scope: "everything",
          title: `Bakery note ${index}`,
          summary: `Bakery opening hours, case ${index}`,
          text: `Bakery detail ${index}.`,
        },
        conversation(),
      );

    const read = await memory.recall({ searches: ["bakery"] });

    const answer = read.answer as {
      entries: { number: number }[];
      alsoFound: Record<string, string[]>;
    };
    expect(answer.entries).toHaveLength(5);
    expect(Object.keys(answer.alsoFound)).toEqual(["bakery"]);
    expect(answer.alsoFound["bakery"]).toHaveLength(3);
    expect(
      [
        ...answer.entries.map((entry) => entry.number),
        ...answer.alsoFound["bakery"]!.map((line) =>
          Number(/^#(\d+)/.exec(line)![1]),
        ),
      ].sort((one, other) => one - other),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("answers several searches in one call", async () => {
    const { memory } = await kept();

    const read = await memory.recall({
      searches: ["meteo france stations", "zotero group"],
    });

    expect(
      (read.answer as { entries: { number: number }[] }).entries
        .map((entry) => entry.number)
        .sort(),
    ).toEqual(expect.arrayContaining([3, 4]));
  });

  it("gives an entry two searches found once", async () => {
    const { memory } = await kept();

    const read = await memory.recall({
      searches: ["meteo france", "station series licence"],
    });

    const numbers = (
      read.answer as { entries: { number: number }[] }
    ).entries.map((entry) => entry.number);
    expect(numbers.filter((number) => number === 4)).toHaveLength(1);
  });

  it("reads numbers and searches in the same call", async () => {
    const { memory } = await kept();

    const read = await memory.recall({
      numbers: [1],
      searches: ["meteo france stations"],
    });

    expect(
      (read.answer as { entries: { number: number }[] }).entries.map(
        (entry) => entry.number,
      ),
    ).toEqual(expect.arrayContaining([1, 4]));
  });

  it("refuses more than five searches in one call", async () => {
    const { memory } = await kept();

    const read = await memory.recall({
      searches: ["a", "b", "c", "d", "e", "f"],
    });

    expect(read.answer).toEqual({
      error: "Give at most five searches in one call.",
    });
  });

  it("says plainly when nothing matches", async () => {
    const { memory } = await kept();

    const read = await memory.recall({ searches: ["kitchen quotes"] });

    expect(read.answer).toEqual({
      entries: [],
      found: "Nothing kept matches “kitchen quotes”.",
    });
  });

  it("counts a read as a use, so the entry stays in the lists sent", async () => {
    const { memory } = await kept();

    await memory.recall({ numbers: [1] });

    expect(
      (await memory.state()).entries.find((entry) => entry.number === 1)?.used,
    ).toBe("2026-10-31T09:05:00.000Z");
  });

  it("hands over what the entries read held", async () => {
    const { memory } = await memoryIn();
    await memory.remember(
      { section: "knowledge", scope: "everything", ...entries[0]! },
      conversation([], { held: { outside: true } }),
    );

    const read = await memory.recall({ numbers: [1] });

    expect(read.held).toEqual({ outside: true });
  });

  it("reads every project's entries, so another project's brief can be read", async () => {
    const { memory } = await memoryIn();
    const kitchen = (await memory.createProject("Kitchen")).project!.id;
    await memory.remember(
      { section: "brief", summary: "Three quotes in", text: "Goal: March." },
      conversation([], { project: kitchen }),
    );

    const read = await memory.recall({ numbers: [1] });

    expect(read.answer).toMatchObject({
      entries: [{ number: 1, section: "brief", scope: "Kitchen" }],
    });
  });

  it("asks for numbers or searches when given neither", async () => {
    const { memory } = await kept();

    expect((await memory.recall({})).answer).toEqual({
      error:
        "Give the numbers of the entries to read, or searches to find them by.",
    });
  });
});
