/**
 * The plugin store's fakes, for the tests of the packages above it
 * (ADR 0002). They hold what a test gives them in memory and reach nothing.
 */

import type { PluginView, Plugins } from "../src/index.js";

/** A plugin store that offers exactly these plugins and refuses every change. */
export function pluginsOffering(views: readonly PluginView[]): Plugins {
  const refuse = async (): Promise<never> => {
    throw new Error("This store changes no plugin.");
  };
  return {
    list: async () => views,
    damaged: async () => [],
    builtInNames: async () => views.map((view) => view.manifest.name),
    setEnabled: refuse,
    setComponentEnabled: refuse,
    overrideComponent: refuse,
    resetComponent: refuse,
    install: refuse,
    update: refuse,
    rollback: refuse,
    remove: refuse,
    create: refuse,
    saveContents: refuse,
  };
}

/**
 * A plugin store a test can watch: switching a plugin or one of its skills on
 * or off takes effect, and a test can make a switch fail the way a disk does.
 * Every other change is refused.
 */
export function pluginStore(
  initial: readonly PluginView[],
  options: {
    readonly failSwitch?: (name: string) => boolean;
  } = {},
): Plugins & { readonly enabledPlugins: () => readonly string[] } {
  let views = [...initial];
  const refuse = async (): Promise<never> => {
    throw new Error("This store changes no plugin content.");
  };
  return {
    enabledPlugins: () =>
      views
        .filter((view) => view.enabled)
        .map((view) => view.manifest.name)
        .sort(),
    list: async () => views,
    damaged: async () => [],
    builtInNames: async () => views.map((view) => view.manifest.name),
    setEnabled: async (name, enabled) => {
      if (options.failSwitch?.(name))
        throw new Error(`${name} could not be saved.`);
      views = views.map((view) =>
        view.manifest.name === name ? { ...view, enabled } : view,
      );
    },
    setComponentEnabled: async (id, enabled) => {
      views = views.map((view) => ({
        ...view,
        skills: view.skills.map((skill) =>
          skill.id === id ? { ...skill, enabled } : skill,
        ),
      }));
    },
    overrideComponent: refuse,
    resetComponent: refuse,
    install: refuse,
    update: refuse,
    rollback: refuse,
    remove: refuse,
    create: refuse,
    saveContents: refuse,
  };
}
