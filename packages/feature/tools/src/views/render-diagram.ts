import { defineViewTool } from "./view-tool.js";

export const renderDiagram = defineViewTool<{
  readonly title: string;
  readonly source: string;
}>(
  {
    name: "render_diagram",
    description:
      "Render a reviewable Mermaid 11 diagram of any type Mermaid draws, such as a flowchart, sequence, state, class, entity-relationship or Gantt diagram, a mindmap, timeline or pie chart, in the conversation. Use this tool instead of placing Mermaid syntax in prose when the person asked for a diagram.",
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
  ({ title, source }) =>
    source.startsWith("```")
      ? "Provide Mermaid source without Markdown fences."
      : { title, data: source },
);
