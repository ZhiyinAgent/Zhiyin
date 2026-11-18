import { afterEach, describe, expect, it } from "vitest";
import { conversation, folders, memoryIn } from "./fixture.js";

afterEach(() => folders.removeAll());

const said = ["Answer me in French, and keep it short."];

async function knowledge(
  memory: Awaited<ReturnType<typeof memoryIn>>["memory"],
  count: number,
  scope: "everything" | "project",
  project?: string,
) {
  for (let index = 1; index <= count; index += 1)
    await memory.remember(
      {
        section: "knowledge",
        scope,
        title: `${scope === "project" ? "Thesis" : "General"} ${index}`,
        summary: `Line ${index}`,
        text: "x",
      },
      conversation([], { project }),
    );
}

describe("what a conversation is sent at its start", () => {
  it("sends nothing when nothing is kept", async () => {
    const { memory } = await memoryIn();

    expect(await memory.startOf(undefined)).toEqual({
      instructions: {},
      known: "",
      held: {},
    });
  });

  it("sends About you and How to work as instructions", async () => {
    const { memory } = await memoryIn();
    await memory.add({
      scope: "everything",
      section: "about",
      text: "- PhD student in urban climatology.",
    });
    await memory.remember(
      {
        section: "how",
        scope: "everything",
        rule: "Answer in French.",
        quote: "Answer me in French",
      },
      conversation(said),
    );

    const start = await memory.startOf(undefined);

    expect(start.instructions).toEqual({
      about: {
        text: "- PhD student in urban climatology.",
        truncated: false,
        bytes: 35,
      },
      how: { text: "- Answer in French.", truncated: false, bytes: 19 },
    });
  });

  it("adds the project's How to work and sends its brief as data", async () => {
    const { memory } = await memoryIn();
    const thesis = (await memory.createProject("Thesis")).project!.id;
    const inThesis = conversation(said, { project: thesis });
    await memory.remember(
      {
        section: "how",
        scope: "project",
        rule: "Cite in APA.",
        quote: "keep it short",
      },
      inThesis,
    );
    await memory.remember(
      {
        section: "brief",
        summary: "Chapter 3 with Prof. Martin",
        text: "Goal: defend in June 2027.",
      },
      inThesis,
    );

    const start = await memory.startOf(thesis);

    expect(start.instructions.projectHow?.text).toBe("- Cite in APA.");
    expect(start.known).toBe(
      [
        "Brief of Thesis, the project this conversation is in (#2):",
        "Goal: defend in June 2027.",
        "",
        "Projects:",
        "#2 Thesis: Chapter 3 with Prof. Martin",
      ].join("\n"),
    );
  });

  it("lists the person's Knowledge, most recently used first, by number, title and summary", async () => {
    const { memory, clock } = await memoryIn();
    await knowledge(memory, 3, "everything");
    clock.later();
    await memory.recall({ numbers: [1] });

    expect((await memory.startOf(undefined)).known).toBe(
      [
        "Knowledge for everything the person does:",
        "#1 General 1: Line 1",
        "#3 General 3: Line 3",
        "#2 General 2: Line 2",
      ].join("\n"),
    );
  });

  it("outside a project, lists a hundred of the person's entries and says how many more recall finds", async () => {
    const { memory } = await memoryIn();
    await knowledge(memory, 103, "everything");

    const known = (await memory.startOf(undefined)).known.split("\n");

    expect(known.filter((line) => line.startsWith("#"))).toHaveLength(100);
    expect(known.at(-1)).toBe("3 more are kept; recall finds them by words.");
  });

  it("in a project, lists sixty of its entries and forty of the person's, each list on its own", async () => {
    const { memory } = await memoryIn();
    const thesis = (await memory.createProject("Thesis")).project!.id;
    await knowledge(memory, 45, "everything");
    await knowledge(memory, 70, "project", thesis);

    const known = (await memory.startOf(thesis)).known;
    const [project, general] = known.split(
      "Knowledge for everything the person does:",
    );

    expect(project!.match(/^#\d+ Thesis/gm)).toHaveLength(60);
    expect(project).toContain("10 more are kept; recall finds them by words.");
    expect(general!.match(/^#\d+ General/gm)).toHaveLength(40);
    expect(general).toContain("5 more are kept; recall finds them by words.");
  });

  it("lists the projects most recently worked in first, and leaves out archived ones", async () => {
    const { memory, clock } = await memoryIn();
    const names = ["Thesis", "Kitchen", "Newsletter"];
    const ids: string[] = [];
    for (const name of names) {
      const id = (await memory.createProject(name)).project!.id;
      ids.push(id);
      clock.later();
      await memory.remember(
        { section: "brief", summary: `${name} line`, text: "x" },
        conversation([], { project: id }),
      );
    }
    await memory.archiveProject(ids[1]!, true);
    clock.later();
    await memory.startOf(ids[0]);

    const known = (await memory.startOf(undefined)).known;

    expect(known).toBe(
      [
        "Projects:",
        "#1 Thesis: Thesis line",
        "#3 Newsletter: Newsletter line",
      ].join("\n"),
    );
  });

  it("names a project with no brief yet", async () => {
    const { memory } = await memoryIn();
    await memory.createProject("Newsletter");

    expect((await memory.startOf(undefined)).known).toBe(
      ["Projects:", "Newsletter: no brief yet"].join("\n"),
    );
  });

  it("sends instructions past their limit cut where a paragraph ends", async () => {
    const { memory } = await memoryIn();
    const long = `- First rule.\n\n${"- Another rule that goes on.\n".repeat(600)}`;
    await memory.add({ scope: "everything", section: "how", text: long });

    const how = (await memory.startOf(undefined)).instructions.how!;

    expect(how.truncated).toBe(true);
    expect(how.text.length).toBeLessThan(long.length);
    expect(long.startsWith(how.text)).toBe(true);
  });

  it("hands over what the instructions and brief sent held", async () => {
    const { memory } = await memoryIn();
    const thesis = (await memory.createProject("Thesis")).project!.id;
    await memory.remember(
      { section: "brief", summary: "x", text: "y" },
      conversation([], { project: thesis, held: { private: true } }),
    );

    expect((await memory.startOf(thesis)).held).toEqual({ private: true });
  });

  it("sends nothing while memory is off", async () => {
    const { memory } = await memoryIn();
    await knowledge(memory, 2, "everything");

    await memory.switch(false);

    expect(await memory.startOf(undefined)).toEqual({
      instructions: {},
      known: "",
      held: {},
    });
    expect(await memory.on()).toBe(false);
  });
});
