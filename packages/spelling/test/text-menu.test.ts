import { describe, expect, it } from "vitest";
import { textMenu, type TextMenuRequest } from "../src/index.js";

const all = { cut: true, copy: true, paste: true, selectAll: true };

const inText = (over: Partial<TextMenuRequest> = {}): TextMenuRequest => ({
  editable: true,
  misspelledWord: "",
  suggestions: [],
  selection: "",
  can: all,
  ...over,
});

const editing = [
  { kind: "edit", action: "cut", label: "Cut", enabled: true },
  { kind: "edit", action: "copy", label: "Copy", enabled: true },
  { kind: "edit", action: "paste", label: "Paste", enabled: true },
  { kind: "separator" },
  { kind: "edit", action: "selectAll", label: "Select all", enabled: true },
];

describe("the right-click menu", () => {
  it("offers corrections first on an underlined word", () => {
    expect(
      textMenu(
        inText({
          misspelledWord: "teh",
          suggestions: ["the", "tech", "ten", "tea", "tee", "Ted"],
        }),
      ),
    ).toEqual([
      { kind: "replace", word: "the", label: "the" },
      { kind: "replace", word: "tech", label: "tech" },
      { kind: "replace", word: "ten", label: "ten" },
      { kind: "replace", word: "tea", label: "tea" },
      { kind: "replace", word: "tee", label: "tee" },
      { kind: "separator" },
      { kind: "learn", word: "teh", label: "Add to dictionary" },
      { kind: "separator" },
      ...editing,
    ]);
  });

  it("says when there are no suggestions", () => {
    expect(textMenu(inText({ misspelledWord: "qwrtzpx" }))).toEqual([
      { kind: "none", label: "No suggestions" },
      { kind: "separator" },
      { kind: "learn", word: "qwrtzpx", label: "Add to dictionary" },
      { kind: "separator" },
      ...editing,
    ]);
  });

  it("offers editing in text, and only what can be done", () => {
    expect(
      textMenu(
        inText({
          can: { cut: false, copy: false, paste: true, selectAll: true },
        }),
      ),
    ).toEqual([
      { kind: "edit", action: "cut", label: "Cut", enabled: false },
      { kind: "edit", action: "copy", label: "Copy", enabled: false },
      { kind: "edit", action: "paste", label: "Paste", enabled: true },
      { kind: "separator" },
      { kind: "edit", action: "selectAll", label: "Select all", enabled: true },
    ]);
  });

  it("offers Copy for a selection outside text, and nothing elsewhere", () => {
    expect(
      textMenu(inText({ editable: false, selection: "Three caveats" })),
    ).toEqual([{ kind: "edit", action: "copy", label: "Copy", enabled: true }]);
    expect(textMenu(inText({ editable: false, selection: "  " }))).toEqual([]);
    expect(textMenu(inText({ editable: false }))).toEqual([]);
  });
});
