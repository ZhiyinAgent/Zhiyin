import { describe, expect, it } from "vitest";
import { estimatedTokens, utf8Bytes } from "../src/index.js";

describe("a text's size", () => {
  it("is counted in UTF-8 bytes whatever its script, as an encoder would", () => {
    // A lone surrogate is written as the replacement character, three bytes.
    for (const [text, bytes] of [
      ["plain", 5],
      ["中文文本", 12],
      ["é", 2],
      ["🙂 ok", 7],
      ["\ud800 lone", 8],
      ["", 0],
    ] as const)
      expect(utf8Bytes(text)).toBe(bytes);
  });

  it("is estimated in tokens as a third of its bytes, rounded up", () => {
    expect(estimatedTokens("中文")).toBe(2);
    expect(estimatedTokens("abcd")).toBe(2);
    expect(estimatedTokens("")).toBe(0);
  });
});
