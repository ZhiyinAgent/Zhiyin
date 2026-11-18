import {
  chartTextSchemas,
  defineViewTool,
  titleSchema,
  type ChartTexts,
} from "./view-tool.js";

type Histogram = ChartTexts & {
  readonly values: readonly number[];
  readonly bins?: number;
};

export const renderHistogram = defineViewTool<Histogram>(
  {
    name: "render_histogram",
    description:
      "Render the distribution of numeric observations as a histogram.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["title", "values"],
      properties: {
        title: titleSchema,
        values: {
          type: "array",
          minItems: 1,
          maxItems: 2000,
          items: { type: "number" },
        },
        bins: { type: "integer", minimum: 1, maximum: 50 },
        ...chartTextSchemas,
      },
    },
  },
  "Draw a histogram",
  "histogram",
  (input) => ({
    title: input.title,
    data: { kind: "histogram", ...input },
  }),
);
