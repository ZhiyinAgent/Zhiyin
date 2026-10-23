import { chmod, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import {
  AGENT_PLUGINS_SCHEMA,
  FilePluginSettings,
  InvalidPluginError,
  SHIPPED,
  validatePluginPackage,
  type PluginPackage,
} from "../src/index.js";

const packageWith = (
  overrides: Partial<PluginPackage> = {},
): PluginPackage => ({
  manifest: {
    $schema: AGENT_PLUGINS_SCHEMA,
    name: "software-engineering",
    version: "1.0.0",
    description: "Build, understand, test, and review software.",
    author: { name: "Zhiyin" },
    displayName: "Software Engineering",
    category: "Development",
    defaultPrompts: [],
  },
  skills: [
    {
      id: "software-engineering/test-first",
      name: "test-first",
      description: "Use when changing behavior.",
      instructions: "Write the failing test first.",
    },
  ],
  specialists: [],
  mcpServers: [],
  appConnectors: [],
  provenance: SHIPPED,
  ...overrides,
});

describe("plugin package validation", () => {
  it("accepts a portable package whose components are namespaced by it", () => {
    expect(() => validatePluginPackage(packageWith())).not.toThrow();
  });

  it("refuses a component that another plugin's namespace would own", () => {
    expect(() =>
      validatePluginPackage(
        packageWith({
          specialists: [
            {
              id: "other-plugin/reviewer",
              name: "Reviewer",
              description: "Reviews.",
              instructions: "Review.",
            },
          ],
        }),
      ),
    ).toThrow(/namespaced by plugin/i);
  });

  it("refuses two components of any kinds that share one id", () => {
    expect(() =>
      validatePluginPackage(
        packageWith({
          specialists: [
            {
              id: "software-engineering/test-first",
              name: "Tester",
              description: "Tests.",
              instructions: "Test.",
            },
          ],
        }),
      ),
    ).toThrow(/registered more than once/i);
  });

  it("refuses a non-portable name and an MCP transport this host cannot run", () => {
    expect(() =>
      validatePluginPackage(
        packageWith({
          manifest: { ...packageWith().manifest, name: "Not portable" },
        }),
      ),
    ).toThrow(InvalidPluginError);
    expect(() =>
      validatePluginPackage(
        packageWith({
          mcpServers: [
            {
              id: "software-engineering/local-tools",
              name: "Local tools",
              description: "Runs local tools.",
              type: "stdio" as "streamable-http",
              url: "file:///tools",
              access: "Runs a local process.",
              dataDestination: "This computer.",
            },
          ],
        }),
      ),
    ).toThrow(/streamable-http/i);
  });

  it("refuses an MCP server reached over plain http, unless it runs on this computer", () => {
    const serving = (url: string) =>
      packageWith({
        mcpServers: [
          {
            id: "software-engineering/search",
            name: "Search",
            description: "Searches the web.",
            type: "streamable-http",
            url,
            access: "Reads public pages.",
            dataDestination: "The search service.",
          },
        ],
      });

    expect(() =>
      validatePluginPackage(serving("http://search.example/mcp")),
    ).toThrow(
      "MCP server “software-engineering/search” must use https unless it runs on this computer.",
    );
    expect(() =>
      validatePluginPackage(serving("http://127.0.0.1:3100/mcp")),
    ).not.toThrow();
  });

  it("lets only a built-in package name an application connector", () => {
    const appConnectors = [
      {
        id: "software-engineering/browser",
        connector: "browser",
        name: "Browser",
        description: "The application's browser.",
        access: "Opens pages in an app-owned window.",
        dataDestination: "The sites it opens.",
      },
    ];

    expect(() =>
      validatePluginPackage(packageWith({ appConnectors })),
    ).not.toThrow();
    expect(() =>
      validatePluginPackage(
        packageWith({
          appConnectors,
          provenance: { source: "personal", sourceId: "local-import" },
        }),
      ),
    ).toThrow(/only built-in plugins/i);
  });
});

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

describe("plugin settings", () => {
  it("refuses to open a damaged settings file instead of treating it as empty", async () => {
    const root = await folders.make("zhiyin-plugin-settings-");
    await writeFile(join(root, "plugin-settings.json"), "{ not json", "utf8");

    await expect(new FilePluginSettings(root).read()).rejects.toMatchObject({
      code: "unavailable",
    });
  });

  it("leaves its settings as they were, and nothing beside them, when a choice cannot be saved", async () => {
    const root = await folders.make("zhiyin-plugin-settings-");
    const settings = new FilePluginSettings(root);
    await settings.setPluginEnabled("research-helper", false);
    const file = join(root, "plugin-settings.json");
    const before = await readFile(file, "utf8");
    // A read-only file can be read but not replaced.
    await chmod(file, 0o444);

    try {
      await expect(
        settings.setPluginEnabled("software-engineering", false),
      ).rejects.toMatchObject({
        code: "unavailable",
        message: "Plugin settings could not be saved.",
      });
    } finally {
      await chmod(file, 0o666);
    }

    expect(await readdir(root)).toEqual(["plugin-settings.json"]);
    expect(await readFile(file, "utf8")).toBe(before);
  });
});
