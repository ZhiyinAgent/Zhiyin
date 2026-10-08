/**
 * Everything that crosses between the core and the renderer, in one place.
 *
 * There is no code generation here and nothing to keep in sync: both sides are
 * TypeScript and import these declarations directly. The contract is the file,
 * not a build step.
 */

export * from "./core-info.js";
export * from "./task.js";
export * from "./artifacts.js";
export * from "./rewind.js";
export * from "./mcp-state.js";
export * from "./browser-state.js";
export * from "./documents.js";
export type * from "./command-jobs.js";
export * from "./plugin-state.js";
export * from "./usage-state.js";
export * from "./workspace-snapshot.js";
export * from "./window-changes.js";
export * from "./tool-invocation.js";
export * from "./core-api.js";
export * from "./views.js";
export * from "./errors.js";
export * from "./tools.js";
export * from "./workspace-context.js";
export * from "./ipc.js";
export { REASONING_EFFORTS } from "./reasoning.js";
export type {
  ConversationSummary,
  HistoryRecovery,
  NewerHistory,
  SavedConversationsOutcome,
} from "./history.js";
export type {
  ModelResponseRecord,
  ModelResponseUsage,
  ModelRetryRecord,
} from "./model-response.js";
export type {
  FittedPicture,
  PictureFitting,
  ProducedImage,
  StoredPicture,
} from "./pictures.js";
export type { ModelHistoryEntry } from "./model-history.js";
export { estimatedTokens, utf8Bytes } from "./token-estimate.js";
export * from "./context-budget.js";
export type * from "./reasoning.js";
export type * from "./messages.js";
export { attachablePictureTypes, picturesPerMessage } from "./messages.js";
export type * from "./models.js";
export type * from "./plan.js";
export type * from "./user-input.js";
export type { TaskInteraction } from "./interaction.js";
export type { TaskOutcome } from "./task-outcome.js";
export type {
  SpecialistDefinition,
  SpecialistHandoff,
  SpecialistRun,
} from "./specialist-run.js";
export * from "./instructions.js";
export type {
  TaskAction,
  ActionApproval,
  ActionRecovery,
  ConversationPermission,
} from "./task-action.js";
export type {
  CommandFileChange,
  CommandFileChanges,
  FileChange,
} from "./file-change.js";
export type { PluginDirectoryEntry } from "./plugin-directory.js";
export * from "./credentials.js";
export * from "./text-diff.js";
export * from "./spelling.js";
