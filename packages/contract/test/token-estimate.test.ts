import { describe, expect, it } from "vitest";
import { estimatedTokens, utf8Bytes } from "../src/index.js";

describe("a text's size", () => {
  it("is counted in UTF-8 bytes whatever its script, as an encoder would", () => {
    for (const text of ["plain", "中文文本", "é", "🙂 ok", "\ud800 lone", ""])
      expect(utf8Bytes(text)).toBe(Buffer.byteLength(text, "utf8"));
  });

  it("is estimated in tokens as a third of its bytes, rounded up", () => {
    expect(estimatedTokens("中文")).toBe(2);
    expect(estimatedTokens("abcd")).toBe(2);
    expect(estimatedTokens("")).toBe(0);
  });
});
