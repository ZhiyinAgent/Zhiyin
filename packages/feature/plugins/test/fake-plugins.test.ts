/**
 * What the packages above the plugin store rely on its fakes to answer, held
 * to the real store: the same expectations run against both (ADR 0002).
 */

import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import {
  AGENT_PLUGINS_SCHEMA,
  ComposedPlugins,
  FilePluginSettings,
  FilePluginStore,
  SHIPPED,
  type PluginPackage,
  type PluginView,
  type Plugins,
} from "../src/index.js";
import { pluginStore, pluginsOffering } from "./fakes.js";

const folders = new TemporaryFolders();
afterEach(() => folders.removeAll());

const writing: PluginPackage = {
  manifest: {
    $schema: AGENT_PLUGINS_SCHEMA,
    name: "writing",
    version: "1.0.0",
    description: "Write and edit documents.",
    author: { name: "Zhiyin" },
    displayName: "Writing",
    category: "Writing",
    defaultPrompts: [],
  },
  skills: [
    {
      id: "writing/plain-words",
      name: "plain-words",
      description: "Use when writing for a person.",
      instructions: "Say it plainly.",
    },
  ],
  specialists: [],
  mcpServers: [],
  appConnectors: [],
  provenance: SHIPPED,
};

/** The plugin as the store shows it: switched on, with its skill switched on. */
const shown: PluginView = {
  manifest: writing.manifest,
  provenance: writing.provenance,
  enabled: true,
  editing: "override",
  skills: writing.skills.map((skill) => ({ ...skill, enabled: true })),
  specialists: [],
  mcpServers: [],
  appConnectors: [],
};

async function realStore(): Promise<Plugins> {
  const data = await folders.make("zhiyin-fake-plugins-");
  return new ComposedPlugins({
    builtIns: async () => [writing],
    store: new FilePluginStore(join(data, "plugins")),
    settings: new FilePluginSettings(data),
  });
}

/** What a test above reads of each plugin: whether it and its skills are on. */
async function switches(plugins: Plugins) {
  return (await plugins.list()).map((view) => ({
    name: view.manifest.name,
    enabled: view.enabled,
    skills: view.skills.map((skill) => [skill.id, skill.enabled]),
  }));
}

const offering: readonly [string, () => Promise<Plugins>][] = [
  ["the real store", realStore],
  ["a store offering one plugin", async () => pluginsOffering([shown])],
  ["a store a test can switch", async () => pluginStore([shown])],
];

describe.each(offering)("%s", (_, make) => {
  it("lists its built-in plugin by name, switched on with its skills", async () => {
    const plugins = await make();

    expect(await plugins.builtInNames()).toEqual(["writing"]);
    expect(await switches(plugins)).toEqual([
      {
        name: "writing",
        enabled: true,
        skills: [["writing/plain-words", true]],
      },
    ]);
    expect(await plugins.damaged()).toEqual([]);
  });
});

const switching: readonly [string, () => Promise<Plugins>][] = [
  ["the real store", realStore],
  ["a store a test can switch", async () => pluginStore([shown])],
];

describe.each(switching)("%s", (_, make) => {
  it("lists a plugin switched off as off", async () => {
    const plugins = await make();

    await plugins.setEnabled("writing", false);

    expect(await switches(plugins)).toMatchObject([
      { name: "writing", enabled: false },
    ]);
  });

  it("lists a skill switched off as off, and its plugin still on", async () => {
    const plugins = await make();

    await plugins.setComponentEnabled("writing/plain-words", false);

    expect(await switches(plugins)).toEqual([
      {
        name: "writing",
        enabled: true,
        skills: [["writing/plain-words", false]],
      },
    ]);
  });
});
