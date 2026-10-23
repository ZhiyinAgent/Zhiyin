import { describe, expect, it } from "vitest";
import {
  decodeText,
  encodeText,
  findText,
  replaceLines,
} from "../src/text-match.js";

describe("decodeText", () => {
  it("separates Windows line endings and a byte-order mark from the content", () => {
    const decoded = decodeText("﻿Owner: Dana\r\nStatus: draft\r\n");

    expect(decoded.text).toBe("Owner: Dana\nStatus: draft\n");
    expect(decoded.ending).toBe("\r\n");
    expect(decoded.byteOrderMark).toBe(true);
    expect(decoded.mixedEndings).toBe(false);
  });

  it("restores the file's own conventions after an edit", () => {
    const decoded = decodeText("﻿Owner: Dana\r\n");

    expect(encodeText(decoded, "Owner: Rowan\n")).toBe("﻿Owner: Rowan\r\n");
  });

  it("settles a file with mixed endings on the one it uses most", () => {
    const decoded = decodeText("a\r\nb\r\nc\n");

    expect(decoded.ending).toBe("\r\n");
    expect(decoded.mixedEndings).toBe(true);
    expect(decoded.text).toBe("a\nb\nc\n");
  });
});

describe("findText", () => {
  it("finds text a model wrote with Unix endings inside a Windows file", () => {
    const file = decodeText("const a = 1;\r\nconst b = 2;\r\n");

    expect(findText(file.text, "const a = 1;\nconst b = 2;")).toEqual({
      kind: "exact",
      offsets: [0],
    });
  });

  it("finds a block the file indents differently from the proposal", () => {
    const file = "function run() {\n    const a = 1;\n    return a;\n}\n";

    expect(findText(file, "const a = 1;\nreturn a;")).toEqual({
      kind: "flexible",
      lines: [1],
      lineCount: 2,
    });
  });

  it("ignores trailing whitespace on either side", () => {
    // Trailing whitespace in the file is already covered by exact matching,
    // because the proposed text is still a substring of it.
    expect(
      findText("Owner: Dana   \nStatus: draft\n", "Owner: Dana"),
    ).toMatchObject({ kind: "exact" });

    // Trailing whitespace in the proposal is not, and only the flexible pass
    // can land it.
    expect(findText("Owner: Dana\nStatus: draft\n", "Owner: Dana   ")).toEqual({
      kind: "flexible",
      lines: [0],
      lineCount: 1,
    });
  });

  it("prefers an exact match and never reinterprets one", () => {
    expect(findText("  keep me\nkeep me\n", "keep me")).toMatchObject({
      kind: "exact",
    });
  });

  it("reports every occurrence so the caller can refuse an ambiguous edit", () => {
    expect(findText("Dana and Dana", "Dana")).toEqual({
      kind: "exact",
      offsets: [0, 9],
    });

    // Two blocks differing only in how far they are indented are two
    // occurrences, not one; the caller has to refuse rather than choose.
    expect(findText("  run();\n\n\trun();\n", "run();  ")).toMatchObject({
      kind: "flexible",
      lines: [0, 2],
    });
  });

  it("will not match text whose words differ, however close", () => {
    expect(findText("const a = 1;\nconst b = 2;\n", "const a = 9;").kind).toBe(
      "none",
    );
  });

  it("points at the closest region without quoting the file back", () => {
    const file = ["alpha", "beta", "gamma", "delta"].join("\n");

    const result = findText(file, "beta\nGAMMA\ndelta");

    expect(result).toEqual({
      kind: "none",
      nearest: { line: 2, score: 2 / 3 },
    });
    expect(JSON.stringify(result)).not.toContain("beta");
  });

  it("refuses to search a pattern larger than it will scan line by line", () => {
    const pattern = Array.from({ length: 501 }, (_, index) => `line ${index}`);

    expect(findText("nothing like it", pattern.join("\n"))).toMatchObject({
      kind: "unsearchable",
    });
  });
});

describe("replaceLines", () => {
  it("gives the replacement the indentation the file already uses there", () => {
    const file = "function run() {\n    const a = 1;\n    return a;\n}\n";

    expect(replaceLines(file, 1, 2, "const a = 2;\nreturn a * 2;")).toBe(
      "function run() {\n    const a = 2;\n    return a * 2;\n}\n",
    );
  });

  it("leaves blank lines in a replacement unindented", () => {
    expect(replaceLines("  first\n  second\n", 0, 2, "first\n\nsecond")).toBe(
      "  first\n\n  second\n",
    );
  });
});
