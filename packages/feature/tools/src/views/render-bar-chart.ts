import {
  chartTextSchemas,
  defineViewTool,
  nameSchema,
  titleSchema,
  type ChartTexts,
} from "./view-tool.js";

type BarChart = ChartTexts & {
  readonly categories: readonly {
    readonly label: string;
    readonly value: number;
  }[];
};

export const renderBarChart = defineViewTool<BarChart>(
  {
    name: "render_bar_chart",
    description:
      "Render a bar chart for comparing named categories. Include axis labels and units when they are known.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["title", "categories"],
      properties: {
        title: titleSchema,
        categories: {
          type: "array",
          minItems: 1,
          maxItems: 100,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["label", "value"],
            properties: {
              label: nameSchema,
              value: { type: "number" },
            },
          },
        },
        ...chartTextSchemas,
      },
    },
  },
  "Draw a bar chart",
  "bar-chart",
  (input) => ({
    title: input.title,
    data: { kind: "bar-chart", ...input },
  }),
  { "categories[]": "A bar" },
);
