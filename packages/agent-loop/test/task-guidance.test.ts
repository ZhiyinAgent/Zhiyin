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

  it("labels an action from what the code knows, specific to its target", () => {
    expect(factsLabel("Read a workspace file", "package.json")).toEqual({
      title: "Read package.json",
      description: "Inspect package.json for evidence relevant to this task.",
    });
    expect(factsLabel("List a workspace directory", "Workspace root")).toEqual({
      title: "List workspace root",
      description:
        "Review the workspace root before choosing the next relevant file.",
    });
  });
});
