import {
  chartLabels,
  defineViewTool,
  finite,
  object,
  requiredText,
} from "./view-tool.js";

export const renderLineChart = defineViewTool(
  {
    name: "render_line_chart",
    description: "Render one or more ordered numeric series as a line chart.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["title", "series"],
      properties: {
        title: { type: "string" },
        series: {
          type: "array",
          minItems: 1,
          maxItems: 8,
          items: {
            type: "object",
            required: ["name", "points"],
            properties: {
              name: { type: "string" },
              points: {
                type: "array",
                minItems: 1,
                maxItems: 500,
                items: {
                  type: "object",
                  required: ["x", "y"],
                  properties: {
                    x: { anyOf: [{ type: "string" }, { type: "number" }] },
                    y: { type: "number" },
                  },
                },
              },
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
  "Draw a line chart",
  "line-chart",
  (args) => {
    const item = object(args);
    const title = requiredText(item?.title);
    const labels = item ? chartLabels(item) : "";
    if (!title)
      return "Give the line chart a title no longer than 160 characters.";
    if (typeof labels === "string") return labels;
    if (
      !Array.isArray(item?.series) ||
      item.series.length < 1 ||
      item.series.length > 8
    )
      return "Provide between 1 and 8 line series.";
    const series = item.series.map(object);
    if (
      series.some(
        (set) =>
          !requiredText(set?.name, 120) ||
          !Array.isArray(set?.points) ||
          set.points.length < 1 ||
          set.points.length > 500 ||
          set.points.some((point) => {
            const p = object(point);
            return !(typeof p?.x === "string" || finite(p?.x)) || !finite(p?.y);
          }),
      )
    )
      return "Every line needs a name and 1 to 500 ordered points with an x label and finite y value.";
    return {
      title,
      data: {
        kind: "line-chart",
        title,
        series,
        ...labels,
        ...(requiredText(item.omitted, 500)
          ? { omitted: requiredText(item.omitted, 500) }
          : {}),
      },
    };
  },
);
