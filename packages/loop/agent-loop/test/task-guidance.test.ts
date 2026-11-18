import { describe, expect, it } from "vitest";
import { actionLabelFrom, factsLabel } from "../src/context/task-guidance.js";

describe("task guidance", () => {
  it("reads the labelling answer, and nothing from one without both parts", () => {
    expect(
      actionLabelFrom(
        '{"title":"Read project manifest","description":"Use package metadata to identify the project."}',
      ),
    ).toEqual({
      title: "Read project manifest",
      description: "Use package metadata to identify the project.",
    });
    expect(actionLabelFrom("")).toBeUndefined();
    expect(actionLabelFrom('{"title":"Read it"}')).toBeUndefined();
  });

  it("names a workspace read or listing by its target, and adds no sentence of its own", () => {
    expect(factsLabel("Read a workspace file", "package.json")).toEqual({
      title: "Read package.json",
      description: "",
    });
    expect(factsLabel("List a workspace directory", "Workspace root")).toEqual({
      title: "List the workspace root",
      description: "",
    });
    expect(factsLabel("List a workspace directory", "src/Models")).toEqual({
      title: "List src/Models",
      description: "",
    });
  });

  it("keeps the title of any other action as its tool wrote it", () => {
    expect(
      factsLabel(
        "Move src/reader/profile.ts to the Recycle Bin",
        "src/reader/profile.ts",
      ).title,
    ).toBe("Move src/reader/profile.ts to the Recycle Bin");
    expect(
      factsLabel("Read a document outside the workspace", "C:/notes.pdf").title,
    ).toBe("Read a document outside the workspace");
  });
});
