import { describe, expect, it } from "vitest";
import { counted, listed } from "./phrases.js";

describe("a count in a sentence", () => {
  it("names one thing in the singular and any other number in the plural", () => {
    expect(counted(1, "file")).toBe("1 file");
    expect(counted(0, "file")).toBe("0 files");
    expect(counted(3, "entry", "entries")).toBe("3 entries");
  });

  it("writes a large count with its thousands apart", () => {
    expect(counted(1_200, "request")).toBe("1,200 requests");
  });
});

describe("a list in a sentence", () => {
  it("joins its last item with and, without a comma before it", () => {
    expect(listed([])).toBe("");
    expect(listed(["Engineering"])).toBe("Engineering");
    expect(listed(["Low", "Medium"])).toBe("Low and Medium");
    expect(listed(["2", "5", "9"])).toBe("2, 5 and 9");
  });

  it("joins with or when the items are alternatives", () => {
    expect(listed(["Ink", "Dots"], "or")).toBe("Ink or Dots");
    expect(listed(["DeepSeek", "Novita", "Together"], "or")).toBe(
      "DeepSeek, Novita or Together",
    );
  });
});
