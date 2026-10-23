/**
 * Saves conversations and the workspace, so they can be resumed after a
 * restart.
 */

export * from "./session.js";

export {
  defaultKeptLimits,
  type KeptItem,
  type KeptKind,
  type KeptLimits,
  type KeptSource,
  type LocatedItem,
} from "./kept-items.js";

export { SessionStoreError } from "./errors.js";
export type {
  OpenedConversation,
  RecycleBin,
  RecycleResult,
  SavedIndex,
  UpdateResult,
} from "./history-store.js";
export type { Formats, Migration } from "./formats.js";
export { historyFiles, type HistoryFiles } from "./history-log.js";
