import { defineViewTool, object, requiredText } from "./view-tool.js";

export const renderDiagram = defineViewTool(
  {
    name: "render_diagram",
    description:
      "Render a reviewable Mermaid flowchart, sequence diagram, state diagram, class diagram, or mindmap in the conversation. Use this tool instead of placing Mermaid syntax in prose when the person asked for a diagram.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["title", "source"],
      properties: {
        title: { type: "string", minLength: 1, maxLength: 160 },
        source: {
          type: "string",
          minLength: 1,
          maxLength: 50000,
          description: "Mermaid source. Do not include Markdown fences.",
        },
      },
    },
  },
  "Draw a diagram",
  "diagram",
  (args) => {
    const item = object(args);
    const title = requiredText(item?.title);
    const source = requiredText(item?.source, 50_000);
    if (!title)
      return "Give the diagram a title no longer than 160 characters.";
    if (!source) return "Provide Mermaid source without Markdown fences.";
    if (/^\s*```/.test(source))
      return "Provide Mermaid source without Markdown fences.";
    return { title, data: source };
  },
);
