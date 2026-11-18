import { describe, expect, it } from "vitest";
import { instructionTokens } from "../src/index.js";

describe("instructionTokens", () => {
  it("gives each source at least 8,000 tokens, and 5% of a budget larger than 160,000", () => {
    expect(instructionTokens(96_000)).toBe(8_000);
    expect(instructionTokens(160_000)).toBe(8_000);
    expect(instructionTokens(262_000)).toBe(13_100);
    expect(instructionTokens(850_000)).toBe(42_500);
  });
});
