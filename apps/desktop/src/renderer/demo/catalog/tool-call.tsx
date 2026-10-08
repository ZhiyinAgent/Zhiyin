import { JsonBlock, ToolCallView } from "../../ui/actions/index.js";
import type { ComponentCatalogEntry } from "./entry.js";

export const toolCallEntries: ComponentCatalogEntry[] = [
  {
    id: "tool-call",
    title: "What was called, and with what",
    description:
      "The shared rendering for any tool that does not draw its own effects: one row per input, and the answer below. JSON is indented and coloured by shape, a payload that arrived escaped inside a field is decoded, and a long value is cut from the middle with the amount stated.",
    render: () => (
      <div className="lab-stack">
        <ToolCallView
          invocation={{
            name: "tavily_search",
            via: "https://mcp.tavily.com/mcp/",
            arguments: [
              { name: "max_results", value: "8" },
              {
                name: "query",
                value: "ZEvent 2026 montant récolté associations",
              },
              { name: "search_depth", value: "advanced" },
            ],
          }}
        />
        <ToolCallView
          invocation={{
            name: "render_bar_chart",
            arguments: [
              { name: "title", value: "Récoltes par édition" },
              {
                name: "series",
                value: `[
  {
    "label": "2024",
    "value": 10182154,
    "highlight": false
  },
  {
    "label": "2026",
    "value": 32891874,
    "highlight": true
  }
]`,
              },
            ],
          }}
        />
        <ToolCallView
          invocation={{
            name: "write_file",
            arguments: [
              { name: "path", value: "notes/summary.md" },
              {
                name: "text",
                value: `# ZEvent 2026

L’édition 2026 a récolté 32 891 874 euros au profit de 22 associations.

## Bilan

Le total dépasse celui de 2025.`,
                omitted: 12480,
              },
            ],
          }}
        />
        <ToolCallView
          invocation={{ name: "browser_snapshot", arguments: [] }}
        />
        <JsonBlock
          text={JSON.stringify({
            ok: true,
            value: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    query: "most popular movies in theaters",
                    answer: null,
                    results: [
                      {
                        url: "https://example.com/weekend",
                        title: "Weekend Box Office",
                        score: 0.94,
                      },
                    ],
                  }),
                },
              ],
            },
          })}
        />
      </div>
    ),
  },
];
