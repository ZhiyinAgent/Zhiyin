import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadPluginDirectory, writePluginDirectory } from "../src/index.js";

const roots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "zhiyin-plugin-writer-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

const provenance = { source: "personal", sourceId: "authored" } as const;

describe("writePluginDirectory", () => {
  it("writes a directory the portable loader accepts back, empty of components", async () => {
    const root = await temporaryRoot();

    await writePluginDirectory(root, {
      name: "my-plugin",
      displayName: "My Plugin",
      version: "0.0.1",
      description: "A plugin I made.",
      skills: [],
      specialists: [],
      mcpServers: [],
    });

    const plugin = await loadPluginDirectory(root, provenance);
    expect(plugin).toMatchObject({
      manifest: {
        name: "my-plugin",
        version: "0.0.1",
        description: "A plugin I made.",
        displayName: "My Plugin",
      },
      skills: [],
      specialists: [],
      mcpServers: [],
    });
  });

  it("round-trips a skill, a specialist, and an MCP server", async () => {
    const root = await temporaryRoot();

    await writePluginDirectory(root, {
      name: "weather-pro",
      displayName: "Weather Pro",
      version: "0.0.2",
      description: "Weather tools.",
      skills: [
        {
          id: "fetch-forecast",
          description: "Look up a forecast for a place.",
          instructions:
            "Ask for a location, then call the forecast tool.\n\nReport highs and lows.",
        },
      ],
      specialists: [
        {
          id: "route-planner",
          name: "Route planner",
          description: "Plans routes around weather.",
          instructions: "Avoid storms. Prefer scenic routes when clear.",
        },
      ],
      mcpServers: [
        {
          id: "weather-api",
          name: "Weather API",
          description: "Live weather data.",
          url: "https://example.com/mcp",
          access: "Reads public weather data.",
          dataDestination: "example.com",
        },
      ],
    });

    const plugin = await loadPluginDirectory(root, provenance);

    expect(plugin.skills).toMatchObject([
      {
        id: "weather-pro/fetch-forecast",
        name: "fetch-forecast",
        description: "Look up a forecast for a place.",
        instructions:
          "Ask for a location, then call the forecast tool.\n\nReport highs and lows.",
      },
    ]);
    expect(plugin.specialists).toMatchObject([
      {
        id: "weather-pro/route-planner",
        name: "Route planner",
        description: "Plans routes around weather.",
        instructions: "Avoid storms. Prefer scenic routes when clear.",
      },
    ]);
    expect(plugin.mcpServers).toMatchObject([
      {
        id: "weather-pro/weather-api",
        name: "Weather API",
        description: "Live weather data.",
        url: "https://example.com/mcp",
        access: "Reads public weather data.",
        dataDestination: "example.com",
      },
    ]);
  });
});
