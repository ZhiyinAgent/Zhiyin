import { describe, expect, it } from "vitest";
import { defaultLook, lookIds } from "@zhiyin/contract";
import { isLookChoice } from "../src/index.js";

describe("the looks a person can choose", () => {
  it("lists Neutral, Ink and Dots, and a new profile starts in Ink at the default strength", () => {
    expect(lookIds).toEqual(["neutral", "ink", "dots"]);
    expect(defaultLook).toEqual({ look: "ink", strength: "default" });
  });

  it("takes every listed look at every strength", () => {
    for (const look of lookIds)
      for (const strength of ["subtle", "default", "vivid"])
        expect(isLookChoice({ look, strength })).toBe(true);
  });

  it("refuses a look that is not on the list, or a strength there is not", () => {
    expect(isLookChoice({ look: "sepia", strength: "default" })).toBe(false);
    expect(isLookChoice({ look: "ink", strength: "loud" })).toBe(false);
    expect(isLookChoice({ look: "ink" })).toBe(false);
    expect(isLookChoice({ strength: "default" })).toBe(false);
  });

  it("refuses anything carrying more than a look and a strength", () => {
    expect(isLookChoice({ look: "ink", strength: "default", opacity: 1 })).toBe(
      false,
    );
    expect(isLookChoice(["ink", "default"])).toBe(false);
    expect(isLookChoice("ink")).toBe(false);
    expect(isLookChoice(null)).toBe(false);
  });
});
