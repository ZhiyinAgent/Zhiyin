import { describe, expect, it } from "vitest";
import {
  removed,
  scalarsIn,
  stepsOf,
  unreachable,
  valueAt,
  withValueAt,
} from "../src/tools/input-paths.js";

/**
 * A repair names the inputs it changes by where they sit in the call, as the
 * schema check writes them, and only the value there is put back.
 */
const call = {
  edits: [
    {
      path: "a.md",
      replacements: [
        { find: "one", replace: "ONE" },
        { find: "two", replace: "TWO" },
      ],
    },
  ],
};

describe("an input named by where it sits", () => {
  it("is read as the schema check writes it", () => {
    expect(stepsOf("edits[0].replacements[1].find")).toEqual([
      "edits",
      0,
      "replacements",
      1,
      "find",
    ]);
    expect(stepsOf("path")).toEqual(["path"]);
    expect(stepsOf("")).toBeUndefined();
    expect(stepsOf("[0]")).toBeUndefined();
    expect(stepsOf("edits[x]")).toBeUndefined();
  });

  it("gives the value there, or says it cannot be reached", () => {
    expect(valueAt(call, "edits[0].replacements[1].find")).toBe("two");
    expect(valueAt(call, "edits[0].replacements[2].find")).toBe(unreachable);
    expect(valueAt(call, "edits.path")).toBe(unreachable);
  });

  it("changes only the value there", () => {
    expect(withValueAt(call, "edits[0].replacements[1].find", "three")).toEqual(
      {
        edits: [
          {
            path: "a.md",
            replacements: [
              { find: "one", replace: "ONE" },
              { find: "three", replace: "TWO" },
            ],
          },
        ],
      },
    );
    // The call itself is left as it was.
    expect(call.edits[0]?.replacements[1]?.find).toBe("two");
  });

  it("adds an input to an object that is there, and takes one out", () => {
    expect(withValueAt({ to: "a" }, "subject", "Hi")).toEqual({
      to: "a",
      subject: "Hi",
    });
    expect(withValueAt({ to: "a", text: "Hi" }, "text", removed)).toEqual({
      to: "a",
    });
  });

  it("never adds or takes out an item of a list, nor puts a value where no parent holds it", () => {
    expect(withValueAt(call, "edits[1].path", "b.md")).toBe(unreachable);
    expect(withValueAt(call, "edits[1]", {})).toBe(unreachable);
    expect(withValueAt(call, "edits[0]", removed)).toBe(unreachable);
    expect(withValueAt({}, "options.depth", 2)).toBe(unreachable);
  });

  it("lists every value a call holds, its keys left out", () => {
    expect(scalarsIn({ a: "x", b: [1, true, null, { c: "y" }] })).toEqual([
      "x",
      1,
      true,
      "y",
    ]);
  });
});
