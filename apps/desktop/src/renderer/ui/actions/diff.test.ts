import { describe, expect, it } from "vitest";
import { diffLines, type DiffSection } from "./diff.js";

function shown(sections: readonly DiffSection[]): string[] {
  return sections.flatMap((section) =>
    section.kind === "skipped"
      ? [`… ${section.count} unchanged`]
      : section.lines.map(
          (line) =>
            `${line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " "}${line.text}`,
        ),
  );
}

describe("diffLines", () => {
  it("names the lines that arrive and the lines that go away", () => {
    const result = diffLines(
      "one\ntwo\nthree\n",
      "one\ntwo point five\nthree\n",
    );

    expect(result).toMatchObject({ added: 1, removed: 1 });
    expect(shown(result.sections)).toEqual([
      " one",
      "-two",
      "+two point five",
      " three",
    ]);
  });

  it("reports a new file as entirely added", () => {
    const result = diffLines("", "hello\nworld\n");

    expect(result).toMatchObject({ added: 2, removed: 0 });
  });

  /**
   * A one-line change in a long file is not reviewable as a long list. What is
   * left out is counted rather than silently dropped, so the reader can tell
   * the difference between "nothing else changed" and "nothing else is shown".
   */
  it("collapses long unchanged runs and says how much it left out", () => {
    const before = Array.from({ length: 40 }, (_, index) => `line ${index}`);
    const after = [...before];
    after[20] = "line twenty, revised";

    const result = diffLines(before.join("\n"), after.join("\n"));

    expect(result).toMatchObject({ added: 1, removed: 1 });
    const lines = shown(result.sections);
    expect(lines).toContain("-line 20");
    expect(lines).toContain("+line twenty, revised");
    expect(lines.filter((line) => line.startsWith("… "))).toHaveLength(2);
    expect(lines).toContain("… 17 unchanged");
    expect(lines).toContain("… 16 unchanged");
  });

  it("treats a file with no changes as having none", () => {
    const result = diffLines("same\ntext\n", "same\ntext\n");

    expect(result).toMatchObject({ added: 0, removed: 0 });
    expect(result.sections).toEqual([{ kind: "skipped", count: 2 }]);
  });

  /**
   * A trailing newline ends the last line rather than starting an empty one.
   * Without this, adding a final newline reads as adding a line of nothing.
   */
  it("does not invent a line from a trailing newline", () => {
    expect(diffLines("a\n", "a")).toMatchObject({ added: 0, removed: 0 });
  });

  it("still answers for a file too large to compare line by line", () => {
    const before = Array.from({ length: 3000 }, (_, i) => `a ${i}`).join("\n");
    const after = Array.from({ length: 3000 }, (_, i) => `b ${i}`).join("\n");

    const result = diffLines(before, after);

    expect(result).toMatchObject({ added: 3000, removed: 3000 });
  });
});
