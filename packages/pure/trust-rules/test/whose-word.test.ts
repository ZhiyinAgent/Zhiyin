import { describe, expect, it } from "vitest";
import { whoseWord } from "../src/index.js";

describe("whose word a call's declaration is", () => {
  it("is Zhiyin's for a built-in tool, whatever else it says", () => {
    expect(whoseWord("built-in", {})).toBe("zhiyin");
  });

  it("is a read of what it holds for a skill or a plugin, even one claiming to be built in", () => {
    expect(whoseWord("skill", { builtInConnection: true })).toBe("reads");
    expect(whoseWord("plugin", { effectsDeclaredByZhiyin: true })).toBe(
      "reads",
    );
  });

  it("is Zhiyin's for a connection Zhiyin ships", () => {
    expect(whoseWord("mcp", { builtInConnection: true })).toBe("zhiyin");
  });

  it("covers only the effects of a connection whose effects a built-in plugin declares", () => {
    expect(whoseWord("mcp", { effectsDeclaredByZhiyin: true })).toBe("effects");
  });

  it("is nothing for any other connection", () => {
    expect(whoseWord("mcp", {})).toBe("nothing");
  });
});
