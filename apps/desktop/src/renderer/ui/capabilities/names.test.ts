import { describe, expect, it } from "vitest";
import { inWords } from "./names.js";

describe("a name said in words", () => {
  it("reads a skill's file name as a phrase", () => {
    expect(inWords("test-driven-development")).toBe("Test driven development");
  });

  it("reads a tool's function name as a phrase", () => {
    expect(inWords("search_issues")).toBe("Search issues");
  });

  it.each([
    ["latex-typst-authoring", "LaTeX Typst authoring"],
    ["sql-optimization", "SQL optimization"],
    ["backend-api-patterns", "Backend API patterns"],
    ["get_pull_request_from_github", "Get pull request from GitHub"],
  ])("writes %s with the names it contains as they are spelt", (name, said) => {
    expect(inWords(name)).toBe(said);
  });

  it("leaves a name already written in words as it is", () => {
    expect(inWords("Code reviewer")).toBe("Code reviewer");
  });
});
