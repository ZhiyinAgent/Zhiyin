import { describe, expect, it } from "vitest";
import {
  estimatedTokens,
  instructionCut,
  instructionTokens,
} from "../src/index.js";

describe("instructionTokens", () => {
  it("gives each source at least 8,000 tokens, and 5% of a budget larger than 160,000", () => {
    expect(instructionTokens(96_000)).toBe(8_000);
    expect(instructionTokens(160_000)).toBe(8_000);
    expect(instructionTokens(262_000)).toBe(13_100);
    expect(instructionTokens(850_000)).toBe(42_500);
  });
});

describe("instructionCut", () => {
  it("keeps a source that fits whole", () => {
    expect(instructionCut("One.\n\nTwo.", 100)).toEqual({
      text: "One.\n\nTwo.",
      truncated: false,
    });
  });

  it("cuts at the last paragraph break that fits, and says after which line", () => {
    const paragraph = (name: string) =>
      `${name} starts here.\n${"word ".repeat(200).trim()}`;
    const text = [
      paragraph("First"),
      paragraph("Second"),
      paragraph("Third"),
    ].join("\n\n");

    const cut = instructionCut(text, 700);

    expect(cut).toEqual({
      text: `${paragraph("First")}\n\n${paragraph("Second")}`,
      truncated: true,
      lastLine: 5,
    });
    expect(estimatedTokens(cut.text)).toBeLessThanOrEqual(700);
  });

  it("cuts at a line break rather than keep under half of what fits, as for a heading over one long list", () => {
    const list = Array.from(
      { length: 4_000 },
      (_, index) => `- rule ${index + 1}: keep it short`,
    ).join("\n");

    const cut = instructionCut(`# Rules\n\n${list}`, 8_000);

    expect(cut.truncated).toBe(true);
    expect(estimatedTokens(cut.text)).toBeGreaterThan(7_900);
    expect(estimatedTokens(cut.text)).toBeLessThanOrEqual(8_000);
    expect(cut.text).toMatch(/keep it short$/);
  });

  it("finds a paragraph break in a file with Windows line endings", () => {
    const paragraph = (name: string) =>
      `${name} starts here.\r\n${"word ".repeat(200).trim()}`;
    const text = [
      paragraph("First"),
      paragraph("Second"),
      paragraph("Third"),
    ].join("\r\n\r\n");

    expect(instructionCut(text, 700)).toEqual({
      text: `${paragraph("First")}\r\n\r\n${paragraph("Second")}`,
      truncated: true,
      lastLine: 5,
    });
  });

  it("gives Chinese as much room as the same meaning in English", () => {
    // Each character is a word's worth, three bytes: 8,000 of them is 24 KB.
    const chinese = "请用中文回答。".repeat(1_100);

    expect(instructionCut(chinese, 8_000).truncated).toBe(false);
  });

  it("cuts at a line break when no paragraph break fits, and between characters when no line break does", () => {
    const lines = ["一".repeat(40), "二".repeat(40), "三".repeat(40)].join(
      "\n",
    );
    expect(instructionCut(lines, 90)).toEqual({
      text: ["一".repeat(40), "二".repeat(40)].join("\n"),
      truncated: true,
      lastLine: 2,
    });

    const unbroken = "字".repeat(100);
    expect(instructionCut(unbroken, 30)).toEqual({
      text: "字".repeat(30),
      truncated: true,
      lastLine: 1,
    });

    // Four bytes each: nine bytes hold two whole, never half of a third.
    expect(instructionCut("😀".repeat(10), 3).text).toBe("😀😀");
  });
});
