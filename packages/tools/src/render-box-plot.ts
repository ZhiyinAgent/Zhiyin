import {
  chartLabels,
  defineViewTool,
  finite,
  object,
  requiredText,
} from "./view-tool.js";

export const renderBoxPlot = defineViewTool(
  {
    name: "render_box_plot",
    description: "Render numeric groups as a box-and-whisker plot.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["title", "groups"],
      properties: {
        title: { type: "string" },
        groups: {
          type: "array",
          minItems: 1,
          maxItems: 40,
          items: {
            type: "object",
            required: ["label", "values"],
            properties: {
              label: { type: "string" },
              values: {
                type: "array",
                minItems: 1,
                maxItems: 1000,
                items: { type: "number" },
              },
            },
          },
        },
        yLabel: { type: "string" },
        unit: { type: "string" },
        omitted: { type: "string" },
      },
    },
  },
  "Draw a box plot",
  "box-plot",
  (args) => {
    const item = object(args);
    const title = requiredText(item?.title);
    const labels = item ? chartLabels(item) : "";
    if (!title)
      return "Give the box plot a title no longer than 160 characters.";
    if (typeof labels === "string") return labels;
    if (
      !Array.isArray(item?.groups) ||
      item.groups.length < 1 ||
      item.groups.length > 40
    )
      return "Provide between 1 and 40 box-plot groups.";
    const groups = item.groups.map(object);
    if (
      groups.some(
        (group) =>
          !requiredText(group?.label, 120) ||
          !Array.isArray(group?.values) ||
          group.values.length < 1 ||
          group.values.length > 1000 ||
          !group.values.every(finite),
      )
    )
      return "Every box-plot group needs a label and 1 to 1000 finite numeric observations.";
    return {
      title,
      data: {
        kind: "box-plot",
        title,
        groups,
        ...labels,
        ...(requiredText(item.omitted, 500)
          ? { omitted: requiredText(item.omitted, 500) }
          : {}),
      },
    };
  },
);
