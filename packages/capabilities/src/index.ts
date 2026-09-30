/**
 * Everything the model can call, and everything a person has set up for it to
 * call — workspace tools, plugin skills and specialists, and connections —
 * presented as one.
 *
 * This package holds the joining and nothing else: which source answers for a
 * tool name, which plugin a conversation may use, and which member a change
 * belongs to. Each member keeps its own storage, validation and execution. A
 * group owns no I/O of its own (ADR 0034).
 *
 * Boundaries and invariants: docs/architecture/features/capabilities/README.md
 */

export * from "./capabilities.js";

export type { ToolOwner } from "@zhiyin/contract";
export {
  pluginContentsDetails,
  type PluginContents,
  type PluginContentItem,
} from "./plugin-directory.js";
