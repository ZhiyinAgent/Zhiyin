import {
  chartLabels,
  defineViewTool,
  finite,
  object,
  requiredText,
} from "./view-tool.js";

export const renderHistogram = defineViewTool(
  {
    name: "render_histogram",
    description:
      "Render the distribution of numeric observations as a histogram.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["title", "values"],
      properties: {
        title: { type: "string", minLength: 1, maxLength: 160 },
        values: {
          type: "array",
          minItems: 1,
          maxItems: 2000,
          items: { type: "number" },
        },
        bins: { type: "integer", minimum: 1, maximum: 50 },
        xLabel: { type: "string" },
        yLabel: { type: "string" },
        unit: { type: "string" },
        omitted: { type: "string" },
      },
    },
  },
  "Draw a histogram",
  "histogram",
  (args) => {
    const item = object(args);
    const title = requiredText(item?.title);
    const labels = item ? chartLabels(item) : "";
    if (!title)
      return "Give the histogram a title no longer than 160 characters.";
    if (typeof labels === "string") return labels;
    if (
      !Array.isArray(item?.values) ||
      item.values.length < 1 ||
      item.values.length > 2000 ||
      !item.values.every(finite)
    )
      return "Provide between 1 and 2000 finite numeric observations.";
    if (
      item.bins !== undefined &&
      (!Number.isInteger(item.bins) ||
        (item.bins as number) < 1 ||
        (item.bins as number) > 50)
    )
      return "Choose between 1 and 50 histogram bins.";
    return {
      title,
      data: {
        kind: "histogram",
        title,
        values: item.values,
        ...(item.bins ? { bins: item.bins } : {}),
        ...labels,
        ...(requiredText(item.omitted, 500)
          ? { omitted: requiredText(item.omitted, 500) }
          : {}),
      },
    };
  },
);
