import { afterEach, describe, expect, it, vi } from "vitest";
import { validateView } from "./viewValidation.js";

const drawing = vi.hoisted(() => ({
  svg: undefined as Promise<string> | undefined,
}));

vi.mock("./mermaidRuntime.js", async (original) => {
  const actual = await original<typeof import("./mermaidRuntime.js")>();
  return {
    ...actual,
    validateMermaid: async () => "flowchart-v2",
    renderMermaid: () =>
      drawing.svg ??
      Promise.resolve(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 420"><text>A</text></svg>',
      ),
  };
});

afterEach(() => {
  drawing.svg = undefined;
  vi.useRealTimers();
});

async function factsOf(data: Record<string, unknown>): Promise<string[]> {
  const outcome = await validateView({
    id: "check-1",
    kind: data["kind"] as "bar-chart",
    source: JSON.stringify(data),
  });
  if (!outcome.ok) throw new Error(outcome.reason);
  return [...(outcome.drawn?.facts ?? [])];
}

describe("a drawing wanted as a file", () => {
  const chart = {
    kind: "bar-chart",
    title: "Revenue",
    categories: [{ label: "Jan", value: 12 }],
  };

  it("comes back as the standalone SVG the person's Save writes, only when asked for", async () => {
    const wanted = await validateView({
      id: "file-1",
      kind: "bar-chart",
      source: JSON.stringify(chart),
      file: true,
    });
    const plain = await validateView({
      id: "file-2",
      kind: "bar-chart",
      source: JSON.stringify(chart),
    });

    if (!wanted.ok || !plain.ok) throw new Error("Refused.");
    expect(wanted.drawn?.svg).toMatch(/^<svg[\s>]/);
    expect(wanted.drawn?.svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(wanted.drawn?.svg).toContain("Jan");
    expect(plain.drawn).not.toHaveProperty("svg");
  });
});

describe("what the check says was drawn", () => {
  it("names each bar whose name is cut short, beside its full name", async () => {
    const facts = await factsOf({
      kind: "bar-chart",
      title: "Spend",
      categories: Array.from({ length: 6 }, (_, index) => ({
        label:
          index < 2
            ? `International Business Machines Corporation division ${index}`
            : `B${index}`,
        value: index,
      })),
    });

    expect(facts[0]).toBe("Drawn 720 × 360 px.");
    expect(facts[1]).toBe(
      "6 bars, each starting at zero; the value axis spans 0 to 5.",
    );
    expect(facts[2]).toMatch(
      /^2 of 6 bar names are cut short to fit under their bars: “[^”]*…” for “International Business Machines Corporation division 0”, “[^”]*…” for “International Business Machines Corporation division 1”\. The full names are in each bar's tooltip and the Data tab\.$/,
    );
  });

  it("says no bar name was cut when all fit", async () => {
    const facts = await factsOf({
      kind: "bar-chart",
      title: "Spend",
      categories: [
        { label: "North", value: 3 },
        { label: "South", value: -2 },
      ],
    });

    expect(facts).toEqual([
      "Drawn 720 × 360 px.",
      "2 bars, each starting at zero; the value axis spans -2 to 3.",
    ]);
  });

  it("does not call a bar name cut short when the name itself ends in an ellipsis", async () => {
    const facts = await factsOf({
      kind: "bar-chart",
      title: "Replies",
      categories: [
        { label: "Wait…", value: 3 },
        { label: "Go", value: 2 },
      ],
    });

    expect(facts).toEqual([
      "Drawn 720 × 360 px.",
      "2 bars, each starting at zero; the value axis spans 0 to 3.",
    ]);
  });

  it("pairs each cut name with its own bar when a bar has no name", async () => {
    const facts = await factsOf({
      kind: "bar-chart",
      title: "Spend",
      categories: [
        { label: "", value: 1 },
        {
          label: "International Business Machines Corporation division 0",
          value: 2,
        },
        ...Array.from({ length: 4 }, (_, index) => ({
          label: `B${index}`,
          value: index,
        })),
      ],
    });

    expect(facts[2]).toMatch(
      /^1 of 6 bar names is cut short to fit under their bars: “[^”]*…” for “International Business Machines Corporation division 0”\./,
    );
  });

  it("states the scatter plot's x axis as drawn, widened when every x is the same", async () => {
    const facts = await factsOf({
      kind: "scatter-plot",
      title: "Fit",
      series: [
        {
          name: "Runs",
          points: [
            { x: 5, y: 1 },
            { x: 5, y: 3 },
          ],
        },
      ],
    });

    expect(facts[1]).toBe(
      "2 points; the x axis spans 4.5 to 5.5, the y axis 0.9 to 3.1.",
    );
  });

  it("names the time axis's ends with the values drawn there when two x values are the same moment", async () => {
    const facts = await factsOf({
      kind: "line-chart",
      title: "Sales",
      series: [
        {
          name: "Actual",
          points: [
            { x: "2024-01-01", y: 1 },
            { x: "2024-03-01T00:00Z", y: 2 },
            { x: "2024-03-01", y: 3 },
          ],
        },
      ],
    });

    expect(facts[1]).toBe(
      "The x axis is time, from 2024-01-01 to 2024-03-01T00:00Z.",
    );
  });

  it("says a line chart's x axis became categories because of one value that is not a date", async () => {
    const facts = await factsOf({
      kind: "line-chart",
      title: "Sales",
      series: [
        {
          name: "Actual",
          points: [
            { x: "2024-01-01", y: 10 },
            { x: "2024-02-01", y: 12 },
            { x: "Q3", y: 15 },
          ],
        },
      ],
    });

    expect(facts.slice(1)).toEqual([
      "The x axis has 3 categories, evenly spaced, in this order: 2024-01-01, 2024-02-01, Q3. It is not time, because “Q3” is not an ISO date.",
      "The y axis spans 9.75 to 15.25.",
    ]);
  });

  it("reads a line chart's x values written as numbers as a numeric axis, and names the one that is not", async () => {
    const chart = (xs: string[]) =>
      factsOf({
        kind: "line-chart",
        title: "Load",
        series: [{ name: "Load", points: xs.map((x, y) => ({ x, y })) }],
      });

    expect((await chart(["0.5", "2", "3.5"]))[1]).toBe(
      "The x axis is numeric, from 0.5 to 3.5.",
    );
    expect((await chart(["1", "2", "n/a"]))[1]).toBe(
      "The x axis has 3 categories, evenly spaced, in this order: 1, 2, n/a. It is not numeric, because “n/a” is not a number.",
    );
  });

  it("says a line chart's x axis is time when every x is a date", async () => {
    const facts = await factsOf({
      kind: "line-chart",
      title: "Sales",
      series: [
        {
          name: "Actual",
          points: [
            { x: "2024-03-01", y: 1 },
            { x: "2024-01-01", y: 2 },
          ],
        },
      ],
    });

    expect(facts[1]).toBe("The x axis is time, from 2024-01-01 to 2024-03-01.");
  });

  it("says how many bins a histogram was given and why, and what each holds", async () => {
    const facts = await factsOf({
      kind: "histogram",
      title: "Latency",
      values: [1, 2, 2, 3, 3, 3, 4, 4, 5],
    });

    expect(facts[1]).toBe(
      "3 bins, the fewer of 20 and the square root of the 9 values, since none was given, each 1.33 wide, from 1 to 5. Counts: 3, 3, 3.",
    );
  });

  it("states the box plot's whiskers by Tukey's rule, each group's five numbers and its outliers", async () => {
    const facts = await factsOf({
      kind: "box-plot",
      title: "Latency",
      groups: [
        { label: "API", values: [1, 2, 3, 4, 100] },
        { label: "Web", values: [1, 2, 3] },
      ],
    });

    expect(facts.slice(1)).toEqual([
      "The box spans the first to the third quartile, with the median marked; each whisker reaches the furthest value within 1.5 times the box's height of it (Tukey's rule), and values beyond are drawn as dots.",
      "API: lower whisker 1, first quartile 2, median 3, third quartile 4, upper whisker 4; 1 outlier: 100.",
      "Web: lower whisker 1, first quartile 1.5, median 2, third quartile 2.5, upper whisker 3; no outliers.",
    ]);
  });

  it("names a box plot group's first ten outliers and counts the rest", async () => {
    const far = Array.from({ length: 12 }, (_, at) => 100 + at);
    const facts = await factsOf({
      kind: "box-plot",
      title: "Latency",
      groups: [{ label: "API", values: [...Array(40).fill(2), ...far] }],
    });

    expect(facts[2]).toMatch(
      /; 12 outliers: 100, 101, 102, 103, 104, 105, 106, 107, 108, 109 and 2 more\.$/,
    );
  });

  it("states the box plot's whiskers as each group's minimum and maximum when asked for its range", async () => {
    const facts = await factsOf({
      kind: "box-plot",
      title: "Latency",
      whiskers: "range",
      groups: [{ label: "API", values: [1, 2, 3, 4, 100] }],
    });

    expect(facts.slice(1)).toEqual([
      "The box spans the first to the third quartile, with the median marked; the whiskers span each group's minimum and maximum, and outliers are not marked.",
      "API: minimum 1, first quartile 2, median 3, third quartile 4, maximum 100.",
    ]);
  });

  it("says no box plot names overlap when a wide name has room beside a short one", async () => {
    const facts = await factsOf({
      kind: "box-plot",
      title: "Latency",
      groups: [
        { label: "A", values: [1, 2, 3] },
        // About 330 px wide, in a share of 312 px, beside a name 9 px wide.
        { label: "x".repeat(48), values: [1, 2, 3] },
      ],
    });

    expect(facts.some((fact) => /overlap/.test(fact))).toBe(false);
  });

  it("names each pair of neighbouring box plot names that overlap", async () => {
    // Six groups share 624 px, 104 px each; twenty letters are 136 px wide.
    const wide = (letter: string) => letter.repeat(20);
    const facts = await factsOf({
      kind: "box-plot",
      title: "Latency",
      groups: [wide("a"), wide("b"), "C", "D", wide("e"), "F"].map((label) => ({
        label,
        values: [1, 2, 3],
      })),
    });

    expect(facts.at(-1)).toBe(
      `1 pair of neighbouring group names overlaps: “${wide("a")}” and “${wide("b")}”.`,
    );
  });

  it("counts every overlapping pair of box plot names", async () => {
    const wide = (letter: string) => letter.repeat(20);
    const facts = await factsOf({
      kind: "box-plot",
      title: "Latency",
      groups: [wide("a"), wide("b"), wide("c"), "D", "E", "F"].map((label) => ({
        label,
        values: [1, 2, 3],
      })),
    });

    expect(facts.at(-1)).toBe(
      `2 pairs of neighbouring group names overlap: “${wide("a")}” and “${wide("b")}”, “${wide("b")}” and “${wide("c")}”.`,
    );
  });

  it("says which kind of diagram Mermaid drew, and its size", async () => {
    const outcome = await validateView({
      id: "check-2",
      kind: "diagram",
      source: "flowchart LR\nA --> B",
    });

    expect(outcome).toEqual({
      ok: true,
      drawn: {
        facts: [
          "Mermaid drew it as a “flowchart-v2” diagram.",
          "Drawn 640 × 420 px.",
        ],
      },
    });
  });

  it("accepts a view whose drawing takes too long, without saying what was drawn", async () => {
    vi.useFakeTimers();
    drawing.svg = new Promise<string>(() => {});

    const checked = validateView({
      id: "check-3",
      kind: "diagram",
      source: "flowchart LR\nA --> B",
    });
    await vi.advanceTimersByTimeAsync(4_000);

    await expect(checked).resolves.toEqual({ ok: true });
  });
});
