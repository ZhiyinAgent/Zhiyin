import {
  chartLabels,
  defineViewTool,
  finite,
  object,
  requiredText,
} from "./view-tool.js";

export const renderScatterPlot = defineViewTool(
  {
    name: "render_scatter_plot",
    description: "Render numeric x/y observations as a scatter plot.",
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
                maxItems: 1000,
                items: {
                  type: "object",
                  required: ["x", "y"],
                  properties: {
                    x: { type: "number" },
                    y: { type: "number" },
                    label: { type: "string" },
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
  "Draw a scatter plot",
  "scatter-plot",
  (args) => {
    const item = object(args);
    const title = requiredText(item?.title);
    const labels = item ? chartLabels(item) : "";
    if (!title)
      return "Give the scatter plot a title no longer than 160 characters.";
    if (typeof labels === "string") return labels;
    if (
      !Array.isArray(item?.series) ||
      item.series.length < 1 ||
      item.series.length > 8
    )
      return "Provide between 1 and 8 scatter series.";
    const series = item.series.map(object);
    if (
      series.some(
        (set) =>
          !requiredText(set?.name, 120) ||
          !Array.isArray(set?.points) ||
          set.points.length < 1 ||
          set.points.length > 1000 ||
          set.points.some((point) => {
            const p = object(point);
            return (
              !finite(p?.x) ||
              !finite(p?.y) ||
              (p?.label !== undefined && !requiredText(p.label, 120))
            );
          }),
      )
    )
      return "Every scatter series needs a name and 1 to 1000 finite x/y points.";
    return {
      title,
      data: {
        kind: "scatter-plot",
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
