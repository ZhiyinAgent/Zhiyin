import { describe, expect, it } from "vitest";
import { callRows, writtenWords } from "../src/call-rows.js";
import type { DrawingSpec } from "../src/drawing-request.js";

describe("the words a CAD call is shown in", () => {
  it("says what a motion file is for without naming a tool", () => {
    expect(
      writtenWords({
        kind: "motion",
        relative: "gear.motion.json",
        parts: ["Gear"],
      } as Parameters<typeof writtenWords>[0]),
    ).toBe(
      "Where Gear is at each position, for animating it in the 3D studio.",
    );
  });

  it("leaves out what a view did not give, rather than writing undefined", () => {
    const rows = callRows({
      code: "",
      arguments: [],
      drawing: {
        views: [
          { section: "A-A", through: [0, 0, 0] },
          { detail: "B", at: [1, 2, 0] },
        ],
      } as unknown as DrawingSpec,
    });
    const views = rows.find((row) => row.name === "Views")?.value ?? "";

    expect(views).not.toContain("undefined");
    expect(views).toContain("section A-A through");
    expect(views).toContain("detail B at");
  });
});
