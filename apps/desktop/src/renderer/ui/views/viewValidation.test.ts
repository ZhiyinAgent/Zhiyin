import { describe, expect, it, vi } from "vitest";
import { validateView } from "./viewValidation.js";

vi.mock("./mermaidRuntime.js", () => ({
  validateMermaid: async (source: string) => {
    if (source.includes("???")) throw new Error("Parse error");
  },
}));

describe("validateView", () => {
  it("reports the drawing library complaint for an invalid diagram", async () => {
    await expect(
      validateView({ id: "1", kind: "diagram", source: "flowchart ???" }),
    ).resolves.toEqual({ ok: false, reason: "Parse error" });
  });

  it("rejects malformed persisted chart source", async () => {
    await expect(
      validateView({ id: "2", kind: "bar-chart", source: "{" }),
    ).resolves.toEqual({
      ok: false,
      reason: "The chart data could not be read.",
    });
  });

  /**
   * The reason goes back to the model, which repairs the chart from it, and is
   * what a person reads on a chart that was stored and then could not be
   * drawn. "Invalid" gives neither of them anything to act on.
   */
  it.each([
    [
      { kind: "histogram", title: "Empty", values: [] },
      "There is no data to chart.",
    ],
    [
      {
        kind: "line-chart",
        title: "Lines",
        series: Array.from({ length: 9 }, (_, index) => ({
          name: `S${index}`,
          points: [{ x: 1, y: index }],
        })),
      },
      "This chart has too many lines to draw (9 of 8 allowed).",
    ],
    [
      {
        kind: "bar-chart",
        title: "Bars",
        categories: [{ label: "A", value: "many" }],
      },
      "Each bar needs a label and a number.",
    ],
    [
      { kind: "histogram", title: "Bins", values: [1, 2], bins: 80 },
      "The number of bins must be a whole number from 1 to 50.",
    ],
    [
      {
        kind: "box-plot",
        title: "Boxes",
        groups: [{ label: "North", values: [] }],
      },
      'The group "North" has no values.',
    ],
  ])("says exactly what is wrong with a chart", async (data, reason) => {
    await expect(
      validateView({
        id: "3",
        kind: data.kind as "bar-chart",
        source: JSON.stringify(data),
      }),
    ).resolves.toEqual({ ok: false, reason });
  });
});
