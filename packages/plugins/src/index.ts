/**
 * Installable capability packages: their identity, their declared skills,
 * specialists and connectors, and the state a person keeps beside them.
 *
 * Boundaries and invariants: docs/architecture/features/plugins/README.md
 */

export * from "./plugins.js";

export { PluginStoreError } from "./errors.js";
export {
  loadBuiltInPlugins,
  loadPluginDirectory,
  MCP_PLUGINS_SCHEMA,
} from "./package-loader.js";
export { FilePluginStore, type InstalledPlugin } from "./store.js";
export { FilePluginSettings } from "./settings.js";
export { ComposedPlugins, slugifyPluginName } from "./composed.js";
export {
  type AuthoredPluginDraft,
  writePluginDirectory,
} from "./package-writer.js";
export type {
  AuthoredMcpServerDraft,
  AuthoredPluginContents,
  AuthoredSkillDraft,
  AuthoredSpecialistDraft,
} from "@zhiyin/contract";
