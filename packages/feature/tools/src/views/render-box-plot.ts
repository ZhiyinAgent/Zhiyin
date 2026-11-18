import {
  chartTextSchemas,
  defineViewTool,
  nameSchema,
  titleSchema,
  type ChartTexts,
} from "./view-tool.js";

type BoxPlot = ChartTexts & {
  readonly groups: readonly {
    readonly label: string;
    readonly values: readonly number[];
  }[];
  readonly whiskers?: "tukey" | "range";
};

export const renderBoxPlot = defineViewTool<BoxPlot>(
  {
    name: "render_box_plot",
    description:
      "Render numeric groups as a box-and-whisker plot. The box spans the first to the third quartile with the median marked. By default each whisker reaches the furthest value within 1.5 times the box's height of it (Tukey's rule) and values beyond are drawn as dots; whiskers range spans each group's minimum and maximum instead.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["title", "groups"],
      properties: {
        title: titleSchema,
        groups: {
          type: "array",
          minItems: 1,
          maxItems: 40,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["label", "values"],
            properties: {
              label: nameSchema,
              values: {
                type: "array",
                minItems: 1,
                maxItems: 1000,
                items: { type: "number" },
              },
            },
          },
        },
        whiskers: {
          type: "string",
          enum: ["tukey", "range"],
          description:
            "tukey (default): whiskers to the furthest value within 1.5 times the box's height, outliers as dots; range: whiskers to each group's minimum and maximum.",
        },
        ...chartTextSchemas,
      },
    },
  },
  "Draw a box plot",
  "box-plot",
  (input) => ({
    title: input.title,
    data: { kind: "box-plot", ...input, whiskers: input.whiskers ?? "tukey" },
  }),
  { "groups[]": "A box-plot group" },
);
