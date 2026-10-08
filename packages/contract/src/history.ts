/** What the window is told about the saved history before opening any of it. */

import type { WorkspaceTask } from "./index.js";

/** What the conversation list shows about a conversation, without opening it. */
export type ConversationSummary = Pick<
  WorkspaceTask,
  "id" | "title" | "titleSource" | "updatedAt" | "updatedLabel"
> & {
  /**
   * Saved by an earlier version in a format this one does not open. It stays
   * as it is, and does not open, until the person updates it.
   */
  readonly needsUpdate?: { readonly writtenBy: string };
};

/**
 * Present only while the list of saved conversations could not be opened.
 * What was damaged has already been kept aside; nothing is written over it
 * until a choice is made.
 */
export type HistoryRecovery = {
  /** Conversations that could still be read on their own. */
  readonly readable: number;
  /** Conversations that could not, and would be left behind by a recovery. */
  readonly damaged: number;
  /** Where the damaged history was kept, so it can be found and handed on. */
  readonly keptAt: string;
};

/**
 * Present while the history was saved by a newer version of Zhiyin. Nothing in
 * it is opened, written or offered for a fresh start. ADR 0022.
 */
export type NewerHistory = {
  /** The version that saved it. */
  readonly writtenBy: string;
};

/** What became of the conversations that were waiting for an update. */
export type SavedConversationsOutcome = {
  /** Updated, or moved to the Recycle Bin. */
  readonly done: number;
  /** Left exactly as they were, still waiting. */
  readonly failed: number;
};
