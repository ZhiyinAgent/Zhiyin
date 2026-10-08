import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("plugin settings", () => {
  it("refuses to open a damaged settings file instead of treating it as empty", async () => {
    const root = await mkdtemp(join(tmpdir(), "zhiyin-plugin-settings-"));
    roots.push(root);
    await writeFile(join(root, "plugin-settings.json"), "{ not json", "utf8");

    await expect(new FilePluginSettings(root).read()).rejects.toMatchObject({
      code: "unavailable",
    });
  });
});
