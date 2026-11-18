import { afterEach, describe, expect, it } from "vitest";
import { closeEntriesCheck } from "../src/index.js";
import { conversation, folders, memoryIn } from "./fixture.js";

afterEach(() => folders.removeAll());

const kept = [
  {
    title: "Prof. Martin",
    summary:
      "Supervisor; reviews a chapter in about two weeks, comments in the PDF",
    text: "Thesis supervisor. Prefers comments in the PDF, not in the text. Reviews a chapter in about two weeks.",
  },
  {
    title: "Deploying a Tessera release",
    summary: "Staging first, promote the same image, Tuesday to Thursday",
    text: "Deploy to staging, run the smoke tests, then promote the same image to production. Releases go out Tuesday to Thursday, never on Friday.",
  },
  {
    title: "August 2025 gap at station 4",
    summary: "Eleven days lost; filled from the Lyon-Bron series",
    text: "Station 4 recorded nothing from 9 to 19 August 2025: a flat battery. Filled from the Météo-France Lyon-Bron series, and marked as filled in every figure that uses it.",
  },
  {
    title: "仓库表格导入",
    summary: "里昂和格勒诺布尔已映射，马赛表格有合并单元格",
    text: "三个仓库的电子表格导入 Tessera：里昂和格勒诺布尔的列映射已确定。马赛的表格有合并单元格，需要先清理。",
  },
  {
    title: "Zotero library",
    summary: "Where references are kept and how they reach a document",
    text: "References live in the Zotero group Thèse. Better BibTeX keeps refs.bib up to date.",
  },
];

async function withKept() {
  const setUp = await memoryIn();
  for (const entry of kept)
    await setUp.memory.remember(
      { section: "knowledge", scope: "everything", ...entry },
      conversation(),
    );
  return setUp;
}

async function closeTo(entry: {
  title: string;
  summary: string;
  text: string;
}) {
  const { memory } = await withKept();
  const added = await memory.remember(
    { section: "knowledge", scope: "everything", ...entry },
    conversation(),
  );
  if (!added.ok) throw new Error(added.reason);
  return (await memory.similarTo(added.change.number!)).map(
    (line) => line.number,
  );
}

describe("entries close to a new one", () => {
  it("finds an entry written again in other words", async () => {
    expect(
      await closeTo({
        title: "Missing data, station 4",
        summary: "9 to 19 August 2025, battery failure",
        text: "Station 4 has no data for 9-19 August 2025 because the battery died. Gap filled with Lyon-Bron (Météo-France).",
      }),
    ).toEqual([3]);
  });

  it("finds one in Chinese, read in pairs of characters", async () => {
    expect(
      await closeTo({
        title: "马赛表格清理",
        summary: "马赛仓库表格的合并单元格需要清理后再导入",
        text: "导入 Tessera 前，马赛仓库的电子表格需要拆分合并单元格。里昂和格勒诺布尔已完成映射。",
      }),
    ).toEqual([4]);
  });

  it("names none for an entry on another subject", async () => {
    expect(
      await closeTo({
        title: "Club newsletter schedule",
        summary: "Out on the first Sunday of each month",
        text: "The running club newsletter goes out on the first Sunday of each month.",
      }),
    ).toEqual([]);
  });

  it("names at most three", async () => {
    const { memory } = await memoryIn();
    for (let index = 0; index < 5; index += 1)
      await memory.remember(
        {
          section: "knowledge",
          scope: "everything",
          title: `Station 4 gap, note ${index}`,
          summary: "August 2025 battery failure at station 4",
          text: "Station 4 lost August 2025 data.",
        },
        conversation(),
      );

    expect(await memory.similarTo(5)).toHaveLength(3);
  });

  it("compares with the project's entries and the person's, not another project's", async () => {
    const { memory } = await memoryIn();
    const thesis = (await memory.createProject("Thesis")).project!.id;
    const app = (await memory.createProject("App")).project!.id;
    const gap = {
      section: "knowledge",
      title: "Station 4 gap",
      summary: "August 2025 battery failure at station 4",
      text: "Station 4 lost August 2025 data.",
    };
    await memory.remember(
      { ...gap, scope: "project" },
      conversation([], { project: app }),
    );
    await memory.remember({ ...gap, scope: "everything" }, conversation());
    await memory.remember(
      { ...gap, scope: "project" },
      conversation([], { project: thesis }),
    );

    expect((await memory.similarTo(3)).map((line) => line.number)).toEqual([2]);
  });
});

describe("the check after remember", () => {
  it("tells the model which kept entries are close to the one it wrote", async () => {
    const { memory } = await withKept();
    const check = closeEntriesCheck(memory);
    const input = {
      section: "knowledge",
      scope: "everything",
      title: "Missing data, station 4",
      summary: "9 to 19 August 2025, battery failure",
      text: "Station 4 has no data for 9-19 August 2025 because the battery died. Gap filled with Lyon-Bron (Météo-France).",
    };
    const added = await memory.remember(input, conversation());
    if (!added.ok) throw new Error(added.reason);

    expect(check.tool).toBe("remember");
    expect(await check.run({ input, answer: added.answer })).toEqual({
      close: [
        {
          number: 3,
          title: "August 2025 gap at station 4",
          summary: "Eleven days lost; filled from the Lyon-Bron series",
        },
      ],
      closeNote:
        "These kept entries are close to the one just written. If one says the same, keep one: change it to hold both, and remove the other.",
    });
  });

  it("adds nothing after an entry on another subject, or a write that keeps no entry", async () => {
    const { memory } = await withKept();
    const check = closeEntriesCheck(memory);
    const input = {
      section: "knowledge",
      scope: "everything",
      title: "Printer on the third floor",
      summary: "Needs the blue driver",
      text: "The third-floor printer only prints with the blue driver installed.",
    };
    const added = await memory.remember(input, conversation());
    if (!added.ok) throw new Error(added.reason);

    expect(await check.run({ input, answer: added.answer })).toBeUndefined();
    expect(
      await check.run({ input: {}, answer: { kept: "waiting" } }),
    ).toBeUndefined();
  });
});
