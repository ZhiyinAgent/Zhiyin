import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import { loadPluginDirectory, writePluginDirectory } from "../src/index.js";

async function temporaryRoot(): Promise<string> {
  return folders.make("zhiyin-plugin-writer-");
}

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

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

  it("refuses two components under one name, writing nothing", async () => {
    const root = await temporaryRoot();
    const skill = {
      id: "fetch-forecast",
      description: "Look up a forecast.",
      instructions: "Call the forecast tool.",
    };

    await expect(
      writePluginDirectory(root, {
        name: "weather-pro",
        displayName: "Weather Pro",
        version: "0.0.2",
        description: "Weather tools.",
        skills: [skill, { ...skill, instructions: "New." }],
        specialists: [],
        mcpServers: [],
      }),
    ).rejects.toThrow("“fetch-forecast” is registered more than once");
    await expect(stat(join(root, "skills"))).rejects.toThrow();

    await expect(
      writePluginDirectory(root, {
        name: "weather-pro",
        displayName: "Weather Pro",
        version: "0.0.2",
        description: "Weather tools.",
        skills: [],
        specialists: [],
        mcpServers: [
          {
            id: "weather",
            name: "A",
            description: "A",
            url: "https://a.example/mcp",
          },
          {
            id: "weather",
            name: "B",
            description: "B",
            url: "https://b.example/mcp",
          },
        ],
      }),
    ).rejects.toThrow("“weather” is registered more than once");
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
          access: "read",
          tools: ["read_file"],
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
        access: "read",
        tools: ["read_file"],
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

  it("keeps a skill's name as the person wrote it, in any script, beside its portable one", async () => {
    const root = await temporaryRoot();

    await writePluginDirectory(root, {
      name: "reports",
      displayName: "报告",
      version: "0.0.1",
      description: "Reports.",
      skills: [
        {
          id: "skill-1x2y3z",
          name: "季度报告: 汇总 #1",
          description: "Summarise a quarter.",
          instructions: "Read the figures.",
        },
        {
          id: "plain-skill",
          description: "A skill named in its portable name.",
          instructions: "Do it.",
        },
      ],
      specialists: [],
      mcpServers: [],
    });

    const plugin = await loadPluginDirectory(root, provenance);
    expect(plugin.skills).toEqual([
      {
        id: "reports/plain-skill",
        name: "plain-skill",
        description: "A skill named in its portable name.",
        instructions: "Do it.",
      },
      {
        id: "reports/skill-1x2y3z",
        name: "季度报告: 汇总 #1",
        description: "Summarise a quarter.",
        instructions: "Read the figures.",
      },
    ]);
    // The package format's own name is the portable one.
    const written = await readFile(
      join(root, "skills", "skill-1x2y3z", "SKILL.md"),
      "utf8",
    );
    expect(written).toMatch(/^name: skill-1x2y3z$/m);
  });

  it("reads back a skill's description as written, whatever quotes, backslashes or colons it holds", async () => {
    const root = await temporaryRoot();
    const descriptions = [
      '"C:\\\\path"',
      "'it''s'",
      "Use when: a path like C:\\temp\\ is named # here",
      '"quoted" at the start',
    ];

    await writePluginDirectory(root, {
      name: "paths",
      displayName: "Paths",
      version: "0.0.1",
      description: "Paths.",
      skills: descriptions.map((description, index) => ({
        id: `skill-${index}`,
        description,
        instructions: "Do it.",
      })),
      specialists: [],
      mcpServers: [],
    });

    const plugin = await loadPluginDirectory(root, provenance);
    expect(plugin.skills.map((skill) => skill.description)).toEqual(
      descriptions,
    );
  });

  it("reads a skill whose frontmatter has a metadata map, keeping its description whole", async () => {
    const root = await temporaryRoot();
    await writePluginDirectory(root, {
      name: "reports",
      displayName: "Reports",
      version: "0.0.1",
      description: "Reports.",
      skills: [],
      specialists: [],
      mcpServers: [],
    });
    await mkdir(join(root, "skills", "summary"), { recursive: true });
    await writeFile(
      join(root, "skills", "summary", "SKILL.md"),
      [
        "---",
        "name: summary",
        "description: 'Summarise a report''s figures.'",
        "metadata:",
        "  author: someone",
        '  display-name: "Quarterly \\"summary\\""',
        "license: MIT",
        "---",
        "Read it.",
      ].join("\n"),
      "utf8",
    );

    const plugin = await loadPluginDirectory(root, provenance);
    expect(plugin.skills).toEqual([
      {
        id: "reports/summary",
        name: 'Quarterly "summary"',
        description: "Summarise a report's figures.",
        instructions: "Read it.",
      },
    ]);
  });

  it("refuses a skill whose name is not portable, writing nothing outside its folder", async () => {
    const parent = await temporaryRoot();
    const root = join(parent, "plugin");

    await expect(
      writePluginDirectory(root, {
        name: "my-plugin",
        displayName: "My Plugin",
        version: "0.0.1",
        description: "A plugin I made.",
        skills: [
          {
            id: "..\\..\\escaped",
            description: "Not a skill.",
            instructions: "Nothing.",
          },
        ],
        specialists: [],
        mcpServers: [],
      }),
    ).rejects.toThrow("must use a portable name");
    await expect(stat(join(parent, "escaped"))).rejects.toThrow();
  });
});
