import {
  chartTextSchemas,
  defineViewTool,
  nameSchema,
  titleSchema,
  type ChartTexts,
} from "./view-tool.js";

type ScatterPlot = ChartTexts & {
  readonly series: readonly {
    readonly name: string;
    readonly points: readonly {
      readonly x: number;
      readonly y: number;
      readonly label?: string;
    }[];
  }[];
};

export const renderScatterPlot = defineViewTool<ScatterPlot>(
  {
    name: "render_scatter_plot",
    description: "Render numeric x/y observations as a scatter plot.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["title", "series"],
      properties: {
        title: titleSchema,
        series: {
          type: "array",
          minItems: 1,
          maxItems: 8,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["name", "points"],
            properties: {
              name: nameSchema,
              points: {
                type: "array",
                minItems: 1,
                maxItems: 1000,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["x", "y"],
                  properties: {
                    x: { type: "number" },
                    y: { type: "number" },
                    label: nameSchema,
                  },
                },
              },
            },
          },
        },
        ...chartTextSchemas,
      },
    },
  },
  "Draw a scatter plot",
  "scatter-plot",
  (input) => ({
    title: input.title,
    data: { kind: "scatter-plot", ...input },
  }),
  {
    "series[]": "A scatter series",
    "series[].points[]": "A scatter plot's point",
  },
);
