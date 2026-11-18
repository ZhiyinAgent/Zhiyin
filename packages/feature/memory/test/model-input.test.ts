import { afterEach, describe, expect, it } from "vitest";
import { conversation, folders, memoryIn, typst } from "./fixture.js";

afterEach(() => folders.removeAll());

/** What models were seen to send in a field: nothing, the wrong type, blanks. */
const oddValues = [undefined, null, 3, true, "", "  ", [], ["x"], { a: 1 }];
const rememberFields = [
  "section",
  "scope",
  "number",
  "title",
  "summary",
  "text",
  "rule",
  "quote",
  "replaces",
  "remove",
  "mergedInto",
];
const said = ["Use Typst, not LaTeX."];
const howRule = {
  section: "how",
  scope: "everything",
  rule: "Use Typst.",
  quote: "Use Typst, not LaTeX.",
};
/** One call of each kind, each field of which is then made odd in turn. */
const calls = [
  {
    section: "knowledge",
    scope: "everything",
    title: "T",
    summary: "S",
    text: "X",
  },
  howRule,
  { ...howRule, section: "about", rule: "Likes Typst." },
  { section: "brief", scope: "conversation", summary: "S", text: "X" },
  { number: 1, section: "knowledge", text: "Changed." },
  { number: 1, remove: true, mergedInto: 2 },
  { ...howRule, number: 2, rule: "Use Typst always.", replaces: "Use Typst." },
];

describe("whatever a model sends", () => {
  it("answers remember with a write or a refusal, never a failure of its own", async () => {
    // Each in a memory of its own, as a write one makes changes what the
    // next finds.
    const inputs = calls.flatMap((call) =>
      rememberFields.flatMap((field) =>
        oddValues.map((value) => ({ ...call, [field]: value })),
      ),
    );
    const failures = (
      await Promise.all(
        inputs.map(async (input) => {
          const { memory } = await memoryIn();
          await memory.remember(typst, conversation(said));
          await memory.remember(howRule, conversation(said));
          return memory.remember(input, conversation(said)).then(
            () => [],
            (error: Error) => [`${JSON.stringify(input)}: ${error.message}`],
          );
        }),
      )
    ).flat();

    expect(failures).toEqual([]);
    // 693 memories of their own, each written three times: 6 s alone, and 39 s
    // once with the whole suite running beside it (2026-11-04), past the 30 s
    // limit meant to catch a hang.
  }, 120_000);

  it("answers recall with what it found or why it read nothing, never a failure of its own", async () => {
    const failures: string[] = [];
    const { memory } = await memoryIn();
    await memory.remember(typst, conversation(said));
    for (const field of ["numbers", "searches"])
      for (const value of oddValues)
        for (const given of [value, [value], [value, "typst"]]) {
          const input = { [field]: given };
          await memory
            .recall(input)
            .catch((error: Error) =>
              failures.push(`${JSON.stringify(input)}: ${error.message}`),
            );
        }

    expect(failures).toEqual([]);
  });
});
