import { describe, expect, it } from "vitest";
import {
  actionPresentationFrom,
  criterionEvaluationFrom,
  planFrom,
} from "../src/task-guidance.js";

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

  it("uses structured action copy and falls back to a target-specific title", () => {
    expect(
      actionPresentationFrom(
        '{"title":"Read project manifest","description":"Use package metadata to identify the project.","planItemId":"plan-1"}',
        {
          action: "Read a workspace file",
          target: "package.json",
          planItemIds: ["plan-1"],
          userIntent: "What is the current project?",
        },
      ),
    ).toEqual({
      title: "Read project manifest",
      description: "Use package metadata to identify the project.",
      planItemId: "plan-1",
    });

    expect(
      actionPresentationFrom("", {
        action: "Read a workspace file",
        target: "package.json",
        planItemIds: [],
        userIntent: "What is the current project?",
      }),
    ).toEqual({
      title: "Read package.json",
      description: "Inspect package.json for evidence relevant to this task.",
    });
    expect(
      actionPresentationFrom("", {
        action: "List a workspace directory",
        target: "Workspace root",
        planItemIds: [],
        userIntent: "What is the current project?",
      }),
    ).toMatchObject({
      title: "List workspace root",
      description:
        "Review the workspace root before choosing the next relevant file.",
    });
  });

  it("leaves a criterion unresolved when evaluation output is invalid", () => {
    expect(
      criterionEvaluationFrom(
        '{"satisfied":true,"summary":"package.json names Zhiyin."}',
      ),
    ).toEqual({ satisfied: true, summary: "package.json names Zhiyin." });
    expect(criterionEvaluationFrom("invalid")).toBeUndefined();
  });
});
