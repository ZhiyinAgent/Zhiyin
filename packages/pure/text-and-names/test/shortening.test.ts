import { utf8Bytes } from "@zhiyin/context-budget";
import { describe, expect, it } from "vitest";
import { shortened, startAndEnd } from "../src/index.js";

describe("a text cut to its start", () => {
  it("keeps a text that fits as it is", () => {
    expect(shortened("short", 5)).toBe("short");
  });

  it("cuts a longer one to its first characters and marks the cut", () => {
    expect(shortened("a longer sentence", 8)).toBe("a longer…");
  });
});

describe("a text cut to its start and its end", () => {
  it("keeps as much of each end as fits, with the words between in the middle's place", () => {
    expect(startAndEnd("abcdefghij", 3, " … ")).toBe("abc … hij");
  });

  it("counts each end in UTF-8 and never cuts inside a character", () => {
    const text = `${"中".repeat(10)}${"文".repeat(10)}`;

    const cut = startAndEnd(text, 7, "|");

    // Seven bytes hold two whole characters of three bytes, not a third.
    expect(cut).toBe("中中|文文");
  });

  it("keeps a character outside the basic plane whole at either end", () => {
    const cut = startAndEnd("😀😀😀middle😀😀😀", 9, "|");

    expect(cut).toBe("😀😀|😀😀");
    expect(utf8Bytes(cut.split("|")[0]!)).toBe(8);
  });

  it("gives a text whose two ends would meet as it is, with nothing repeated", () => {
    expect(startAndEnd("abcdef", 4, " … ")).toBe("abcdef");
    expect(startAndEnd("abcdef", 3, " … ")).toBe("abcdef");
    expect(startAndEnd("", 3, " … ")).toBe("");
  });

  it("keeps nothing of either end when no byte is allowed", () => {
    expect(startAndEnd("abcdef", 0, "…")).toBe("…");
    expect(startAndEnd("abcdef", -4, "…")).toBe("…");
  });
});
