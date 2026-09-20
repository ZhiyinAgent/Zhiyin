import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadBuiltInPlugins } from "../src/index.js";

const shipped = fileURLToPath(new URL("../built-in", import.meta.url));

const local = (ids: readonly { id: string }[]) =>
  ids.map((item) => item.id.slice(item.id.indexOf("/") + 1));

describe("the catalog shipped with the application", () => {
  it("offers the four verticals, each with exactly its planned skills, specialists, and connectors", async () => {
    const plugins = await loadBuiltInPlugins(shipped);

    expect(
      plugins.map((plugin) => ({
        name: plugin.manifest.name,
        displayName: plugin.manifest.displayName,
        skills: local(plugin.skills),
        specialists: local(plugin.specialists),
        connectors: [
          ...local(plugin.mcpServers),
          ...plugin.appConnectors.map((item) => `app:${item.connector}`),
        ],
      })),
    ).toEqual([
      {
        name: "engineering",
        displayName: "Full-Stack Software Engineering",
        skills: [
          "backend-api-patterns",
          "database-architecture-and-design",
          "frontend-design-systems",
          "system-architecture",
          "test-driven-development",
        ],
        specialists: [
          "code-reviewer",
          "interactive-debugger",
          "refactoring-architect",
          "qa-e2e-verifier",
        ],
        connectors: ["github", "app:browser", "app:git"],
      },
      {
        name: "publishing",
        displayName: "Technical & Academic Publishing",
        skills: [
          "bibliography-hygiene",
          "diagram-engineering",
          "latex-typst-authoring",
          "whitepaper-structure",
        ],
        specialists: ["peer-review-critic", "citation-auditor"],
        connectors: ["alphaxiv", "app:documents"],
      },
      {
        name: "data-science",
        displayName: "Data Science & Business Intelligence",
        skills: [
          "dashboard-design",
          "exploratory-data-analysis",
          "sql-optimization",
          "statistical-testing",
        ],
        specialists: ["data-cleansing-specialist", "insights-synthesizer"],
        connectors: ["app:python"],
      },
      {
        name: "research",
        displayName: "Deep Research & Synthesis",
        skills: [
          "competitive-analysis",
          "knowledge-graph-mapping",
          "neutrality-review",
          "source-triangulation",
        ],
        specialists: ["fact-checker", "report-synthesizer"],
        connectors: ["tavily"],
      },
    ]);
  });

  it("states what every plugin and connector can use and where its data goes", async () => {
    for (const plugin of await loadBuiltInPlugins(shipped)) {
      expect(plugin.manifest.accessSummary).toBeTruthy();
      expect(plugin.manifest.dataDestination).toBeTruthy();
      expect(plugin.manifest.defaultPrompts.length).toBeGreaterThan(0);
      for (const connector of [...plugin.mcpServers, ...plugin.appConnectors]) {
        expect(connector.access).toBeTruthy();
        expect(connector.dataDestination).toBeTruthy();
      }
    }
  });
});
