/** What the window is told about the saved history before opening any of it. */

import type { WorkspaceTask } from "./index.js";

/** What the conversation list shows about a conversation, without opening it. */
export type ConversationSummary = Pick<
  WorkspaceTask,
  "id" | "title" | "titleSource" | "updatedAt" | "updatedLabel"
>;

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
