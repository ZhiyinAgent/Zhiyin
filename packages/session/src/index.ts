/**
 * Persists conversations so they can be resumed, and tracks each turn's file
 * changes so they can be undone.
 *
 * Boundaries and invariants: docs/architecture/features/session/README.md
 */

export * from "./session.js";

export {
  defaultKeptLimits,
  type FileRead,
  type KeptItem,
  type KeptKind,
  type KeptLimits,
  type KeptSource,
  type LocatedItem,
} from "./kept-items.js";

export { SessionStoreError } from "./errors.js";
export type { OpenedConversation, SavedIndex } from "./history-store.js";
export { historyFiles, type HistoryFiles } from "./history-log.js";
