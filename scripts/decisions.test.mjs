import { describe, expect, it } from "vitest";
import { checkDecisions, readDecisions } from "./decisions.mjs";

/** A record that follows every rule, for the must-fail cases to break one at a time. */
function record(file, text) {
  const number = file.slice(0, 4);
  return {
    file,
    text: text ?? `# ${number}. A decision\n\nStatus: accepted\n\n## Context\n`,
  };
}

describe("decision records", () => {
  it("each have their own number, a heading that matches it, and a status line", async () => {
    expect(checkDecisions(await readDecisions())).toEqual([]);
  });

  it("accepts records that follow every rule", () => {
    expect(
      checkDecisions([
        record("0001-first.md"),
        record("0002-second.md"),
        record(
          "0003-third.md",
          "# 0003. Third\n\nStatus: superseded by 0004\n",
        ),
      ]),
    ).toEqual([]);
  });

  it("refuses two records with one number", () => {
    expect(
      checkDecisions([record("0032-one.md"), record("0032-other.md")]),
    ).toEqual([
      "0032 is the number of more than one record: 0032-one.md, 0032-other.md.",
    ]);
  });

  it("refuses a file not named by a four-digit number and a slug", () => {
    expect(checkDecisions([record("32-short.md")])).toEqual([
      "32-short.md is not named NNNN-slug.md.",
    ]);
  });

  it("refuses a heading whose number is not the file's", () => {
    expect(
      checkDecisions([
        record("0007-wrong.md", "# 0008. Wrong\n\nStatus: accepted\n"),
      ]),
    ).toEqual(['0007-wrong.md must open with "# 0007. " and its title.']);
  });

  it("refuses a record whose status is missing or written another way", () => {
    expect(
      checkDecisions([
        record("0006-bold.md", "# 0006. Bold\n\n**Status:** accepted\n"),
        record("0009-none.md", "# 0009. None\n\n## Context\n"),
      ]),
    ).toEqual([
      '0006-bold.md must state "Status: " on the first line after its heading.',
      '0009-none.md must state "Status: " on the first line after its heading.',
    ]);
  });
});
