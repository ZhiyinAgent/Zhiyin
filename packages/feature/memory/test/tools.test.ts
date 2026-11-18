import { afterEach, describe, expect, it } from "vitest";
import { conversation, folders, memoryIn } from "./fixture.js";

afterEach(() => folders.removeAll());

type Schema = {
  properties: Record<string, { enum?: string[]; description?: string }>;
  required?: string[];
};

describe("the remember tool offers only what the conversation can use", () => {
  it("offers the project's scope in a project, and not the conversation's", async () => {
    const { memory } = await memoryIn();

    const schema = memory.rememberToolFor(true).inputSchema as Schema;

    expect(schema.properties["scope"]!.enum).toEqual(["everything", "project"]);
  });

  it("offers the conversation's scope outside a project, and not a project's", async () => {
    const { memory } = await memoryIn();

    const schema = memory.rememberToolFor(false).inputSchema as Schema;

    expect(schema.properties["scope"]!.enum).toEqual([
      "everything",
      "conversation",
    ]);
  });

  it("requires no field a change or removal by number would not read", async () => {
    const { memory } = await memoryIn();

    for (const inProject of [true, false]) {
      const schema = memory.rememberToolFor(inProject).inputSchema as Schema;
      expect(schema.required ?? []).toEqual([]);
      expect(schema.properties["scope"]!.description).toContain(
        "Not read for a brief",
      );
    }
  });

  it("removes an entry given by its number alone", async () => {
    const { memory } = await memoryIn();
    await memory.remember(
      {
        section: "knowledge",
        scope: "everything",
        title: "Typst over LaTeX",
        summary: "The template needs a grid",
        text: "Chosen on 4 October.",
      },
      conversation(),
    );

    const removed = await memory.remember(
      { number: 1, remove: true },
      conversation(),
    );

    expect(removed).toMatchObject({
      ok: true,
      change: { change: "removed", number: 1 },
    });
  });

  it("says how long a line may be before the first write", async () => {
    const { memory } = await memoryIn();

    expect(memory.rememberToolFor(false).description).toContain(
      "Title and summary together: at most about 230 characters, or 75 in Chinese or Japanese.",
    );
  });

  it("is called remember wherever it is offered", async () => {
    const { memory } = await memoryIn();

    expect([
      memory.rememberToolFor(true).name,
      memory.rememberToolFor(false).name,
    ]).toEqual(["remember", "remember"]);
  });
});
