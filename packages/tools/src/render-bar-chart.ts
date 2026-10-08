import {
  chartLabels,
  defineViewTool,
  finite,
  object,
  requiredText,
} from "./view-tool.js";

export const renderBarChart = defineViewTool(
  {
    name: "render_bar_chart",
    description:
      "Render a bar chart for comparing named categories. Include axis labels and units when they are known.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["title", "categories"],
      properties: {
        title: { type: "string", minLength: 1, maxLength: 160 },
        categories: {
          type: "array",
          minItems: 1,
          maxItems: 100,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["label", "value"],
            properties: {
              label: { type: "string" },
              value: { type: "number" },
            },
          },
        },
        xLabel: { type: "string" },
        yLabel: { type: "string" },
        unit: { type: "string" },
        omitted: { type: "string" },
      },
    },
  },
  "Draw a bar chart",
  "bar-chart",
  (args) => {
    const item = object(args);
    const title = requiredText(item?.title);
    const labels = item ? chartLabels(item) : "";
    if (!title)
      return "Give the bar chart a title no longer than 160 characters.";
    if (typeof labels === "string") return labels;
    if (
      !Array.isArray(item?.categories) ||
      item.categories.length < 1 ||
      item.categories.length > 100
    )
      return "Provide between 1 and 100 bar categories.";
    const categories = item.categories.map(object);
    if (
      categories.some(
        (row) => !requiredText(row?.label, 120) || !finite(row?.value),
      )
    )
      return "Every bar needs a label and a finite numeric value.";
    return {
      title,
      data: {
        kind: "bar-chart",
        title,
        categories: categories.map((row) => ({
          label: requiredText(row?.label, 120),
          value: row?.value,
        })),
        ...labels,
        ...(requiredText(item.omitted, 500)
          ? { omitted: requiredText(item.omitted, 500) }
          : {}),
      },
    };
  },
);
