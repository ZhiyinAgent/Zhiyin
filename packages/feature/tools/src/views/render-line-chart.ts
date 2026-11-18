import {
  chartTextSchemas,
  defineViewTool,
  nameSchema,
  titleSchema,
  type ChartTexts,
} from "./view-tool.js";

type LineChart = ChartTexts & {
  readonly series: readonly {
    readonly name: string;
    readonly points: readonly { readonly x: string; readonly y: number }[];
  }[];
};

export const renderLineChart = defineViewTool<LineChart>(
  {
    name: "render_line_chart",
    description: "Render one or more ordered numeric series as a line chart.",
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
                maxItems: 500,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["x", "y"],
                  properties: {
                    x: {
                      type: "string",
                      description:
                        'Where the point sits along the x axis, as text: a number such as "3.5", an ISO date such as "2024-03-01", or a name such as "Q1". When every x is a number the axis is numeric, when every x is a date it is time, otherwise the names are spaced evenly in order.',
                    },
                    y: { type: "number" },
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
  "Draw a line chart",
  "line-chart",
  (input) => ({
    title: input.title,
    data: { kind: "line-chart", ...input },
  }),
  {
    "series[]": "A line series",
    "series[].points[]": "A line chart's point",
  },
);
