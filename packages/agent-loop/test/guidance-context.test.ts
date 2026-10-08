import { describe, expect, it } from "vitest";
import {
  actionContextLines,
  guidanceLimits,
} from "../src/context/guidance-context.js";

function size(lines: readonly string[]): number {
  return lines.join("\n").length;
}

const plan = [
  {
    id: "plan-1",
    title: "Reproduce the reported defect",
  },
  {
    id: "plan-2",
    title: "Apply the smallest fix",
  },
];

describe("actionContextLines", () => {
  it("gives an ordinary action its plan and recent history", () => {
    const lines = actionContextLines({
      userIntent: "The date on the invoice page is a day out. Fix it.",
      action: "Edit a workspace file",
      target: "src/invoice.ts",
      earlierActions: [
        { action: "List a workspace directory", target: "src" },
        {
          action: "Read a workspace file",
          target: "src/invoice.ts",
          description: "Locate where the date is formatted.",
        },
      ],
      plan,
    });

    const text = lines.join("\n");
    expect(text).toContain("The date on the invoice page is a day out.");
    expect(text).toContain("src/invoice.ts");
    expect(text).toContain("Reproduce the reported defect");
    expect(text).toContain("Locate where the date is formatted.");
    expect(size(lines)).toBeLessThanOrEqual(guidanceLimits.total);
  });

  it("passes on what the model says about a command it cannot show", () => {
    const lines = actionContextLines({
      userIntent: "Check whether the tests still pass.",
      action: "Run a command",
      target: "pnpm test -- --run invoice",
      claim: "Runs only the invoice tests to check the date fix.",
      earlierActions: [],
      plan: [],
    });

    const text = lines.join("\n");
    expect(text).toContain("Runs only the invoice tests");
    // Carried as an unverified claim, never as an established fact.
    expect(text).toContain("unverified");
  });

  it("keeps the essentials whatever else has to go", () => {
    const enormous = Array.from({ length: 400 }, (_, index) => ({
      action: `Action number ${index} with a great deal of explanatory padding`,
      target: `some/deeply/nested/path/number/${index}/file.ts`,
      description: "A description long enough to matter. ".repeat(10),
    }));

    const lines = actionContextLines({
      userIntent: "Find where the invoice date is formatted and correct it.",
      action: "Run a command",
      target: "rg --line-number 'formatDate' src",
      claim: "Searches the source for the date formatting helper.",
      earlierActions: enormous,
      plan,
    });

    expect(size(lines)).toBeLessThanOrEqual(guidanceLimits.total);
    const text = lines.join("\n");
    expect(text).toContain("Find where the invoice date is formatted");
    expect(text).toContain("rg --line-number");
    expect(text).toContain("Searches the source for the date formatting");
    // The oldest history is what gets dropped, not the request being named.
    expect(text).not.toContain("Action number 0 ");
  });

  it("never sends more than a handful of earlier actions even when they are short", () => {
    const lines = actionContextLines({
      userIntent: "Tidy the project.",
      action: "Read a workspace file",
      target: "a.ts",
      earlierActions: Array.from({ length: 40 }, (_, index) => ({
        action: "Read",
        target: `f${index}.ts`,
      })),
      plan: [],
    });

    const earlier = lines.find((line) => line.startsWith("Earlier actions:"));
    expect(earlier).toBeDefined();
    expect([...(earlier ?? "").matchAll(/"action"/g)]).toHaveLength(
      guidanceLimits.recentActions,
    );
  });
});
