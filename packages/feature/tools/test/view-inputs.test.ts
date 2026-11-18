import { describe, expect, it } from "vitest";
import { WorkspaceTools } from "../src/index.js";

const tools = () => new WorkspaceTools(undefined, { shell: undefined });

/**
 * Each view tool with a call it accepts, then the same call with one input it
 * cannot draw, at the place it is given, and the refusal's words.
 */
const unknown: readonly [string, Record<string, unknown>, string][] = [
  [
    "render_bar_chart",
    {
      title: "Revenue",
      categories: [{ label: "Jan", value: 12, color: "red" }],
    },
    "A bar has label and value only, so “color” cannot be drawn. Leave it out, or draw the chart another way.",
  ],
  [
    "render_bar_chart",
    {
      title: "Revenue",
      categories: [{ label: "Jan", value: 12 }],
      stacked: true,
    },
    "A bar chart has title, categories, xLabel, yLabel, unit, omitted and save_to only, so “stacked” cannot be drawn. Leave it out, or draw the chart another way.",
  ],
  [
    "render_line_chart",
    {
      title: "Revenue",
      series: [
        { name: "Actual", points: [{ x: "Jan", y: 12 }] },
        { name: "Target", points: [{ x: "Jan", y: 10 }], dashed: true },
      ],
    },
    "A line series has name and points only, so “dashed” cannot be drawn. Leave it out, or draw the chart another way.",
  ],
  [
    "render_line_chart",
    {
      title: "Revenue",
      series: [{ name: "Actual", points: [{ x: "Jan", y: 12, note: "a" }] }],
    },
    "A line chart's point has x and y only, so “note” cannot be drawn. Leave it out, or draw the chart another way.",
  ],
  [
    "render_scatter_plot",
    {
      title: "Quality",
      series: [{ name: "Trials", points: [{ x: 1, y: 2, size: 4 }] }],
    },
    "A scatter plot's point has x, y and label only, so “size” cannot be drawn. Leave it out, or draw the chart another way.",
  ],
  [
    "render_box_plot",
    {
      title: "Latency",
      groups: [{ label: "A", values: [1, 2], outliers: [9] }],
    },
    "A box-plot group has label and values only, so “outliers” cannot be drawn. Leave it out, or draw the chart another way.",
  ],
  [
    "render_histogram",
    { title: "Latency", values: [1, 2], density: true, cumulative: true },
    "A histogram has title, values, bins, xLabel, yLabel, unit, omitted and save_to only, so “density” and “cumulative” cannot be drawn. Leave them out, or draw the chart another way.",
  ],
  [
    "render_diagram",
    { title: "Flow", source: "flowchart LR\nA --> B", theme: "dark" },
    "A diagram has title, source and save_to only, so “theme” cannot be drawn. Leave it out, or draw the chart another way.",
  ],
];

describe("what a view tool cannot draw", () => {
  it.each(unknown)(
    "%s refuses an input it cannot draw, naming it and what it can",
    async (name, args, reason) => {
      await expect(tools().inspect(name, args)).resolves.toMatchObject({
        ok: false,
        correctable: true,
        reason,
      });
    },
  );

  it("advertises that every item of a chart takes only the fields it draws", () => {
    type Schema = {
      type?: string;
      additionalProperties?: boolean;
      properties?: Record<string, Schema>;
      items?: Schema;
    };
    const objects = (schema: Schema, path: string): [string, Schema][] => [
      ...(schema.type === "object" ? [[path, schema] as [string, Schema]] : []),
      ...Object.entries(schema.properties ?? {}).flatMap(([key, inner]) =>
        objects(inner, `${path}.${key}`),
      ),
      ...(schema.items ? objects(schema.items, `${path}[]`) : []),
    ];
    const open = tools()
      .list()
      .filter((tool) => tool.name.startsWith("render_"))
      .flatMap((tool) => objects(tool.inputSchema as Schema, tool.name))
      .filter(([, schema]) => schema.additionalProperties !== false)
      .map(([path]) => path);

    expect(open).toEqual([]);
  });
});
