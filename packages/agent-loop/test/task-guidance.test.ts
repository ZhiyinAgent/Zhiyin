import { describe, expect, it } from "vitest";
import { actionLabelFrom, factsLabel, planFrom } from "../src/task-guidance.js";

describe("task guidance", () => {
  it("accepts a small ordered plan with observable criteria", () => {
    expect(
      planFrom(
        '{"items":[{"title":"Identify the project","criterion":"The answer names the project from workspace evidence."}]}',
      ),
    ).toEqual([
      {
        id: "plan-1",
        title: "Identify the project",
        criterion: "The answer names the project from workspace evidence.",
        status: "active",
      },
    ]);
  });

  it("rejects malformed or inflated plans instead of displaying invented work", () => {
    expect(planFrom("not json")).toBeUndefined();
    expect(
      planFrom(
        JSON.stringify({
          items: Array.from({ length: 5 }, (_, index) => ({
            title: `Step ${index}`,
            criterion: `Criterion ${index}`,
          })),
        }),
      ),
    ).toBeUndefined();
  });

  it("reads the labelling answer, and nothing from one without both parts", () => {
    expect(
      actionLabelFrom(
        '{"title":"Read project manifest","description":"Use package metadata to identify the project.","planItemId":"plan-1"}',
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
