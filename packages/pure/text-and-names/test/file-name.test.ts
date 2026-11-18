import { describe, expect, it } from "vitest";
import { fileNameFor } from "../src/index.js";

describe("the file name a title is saved under", () => {
  it("keeps the title's letters and digits in lower case, joined by hyphens", () => {
    expect(fileNameFor("Quarterly Report: Q3/2026", "view", "svg")).toBe(
      "quarterly-report-q3-2026.svg",
    );
  });

  it("keeps letters of any script", () => {
    expect(fileNameFor("销售 数据 · 2026", "conversation", "html")).toBe(
      "销售-数据-2026.html",
    );
  });

  it("is cut between characters at 80, without a hyphen at the end", () => {
    const name = fileNameFor(`${"字".repeat(79)} more`, "view", "svg");

    expect(name).toBe(`${"字".repeat(79)}.svg`);
  });

  it("falls back to its own name when the title keeps nothing", () => {
    expect(fileNameFor("  ***  ", "view", "svg")).toBe("view.svg");
    expect(fileNameFor("", "conversation", "zip")).toBe("conversation.zip");
  });
});
