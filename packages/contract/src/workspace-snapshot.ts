import type { BrowserPanelState } from "./browser-state.js";
import type { ContextBudgetChoice } from "./context-budget.js";
import type { ConversationSummary, HistoryRecovery } from "./history.js";
import type { FolderInstructionsChoice } from "./instructions.js";
import type { McpServerState } from "./mcp-state.js";
import type { PluginState } from "./plugin-state.js";
import type { WorkspaceTask } from "./task.js";
import type { UsageState } from "./usage-state.js";

export type WorkspaceSnapshot = {
  readonly historyRecovery?: HistoryRecovery;
  /** The budget a conversation without its own choice is kept under. */
  readonly contextBudget?: ContextBudgetChoice;
  /** What the person asks of every conversation, set in Settings. ADR 0054. */
  readonly personalInstructions?: string;
  /** Whether to use each folder's AGENTS.md, by the content they saw. */
  readonly folderInstructionChoices?: readonly FolderInstructionsChoice[];
  readonly preferences?: {
    readonly onboarded: boolean;
    readonly interests: readonly string[];
    /**
     * False while the capabilities these interests imply are not all in place
     * yet. The choice is recorded before it is applied, so an application that
     * stops halfway is finished on the next launch rather than leaving
     * capabilities nobody asked for. Absent means applied.
     */
    readonly capabilitiesApplied?: boolean;
  };
  readonly workspace?: { readonly path: string; readonly name: string };
  /**
   * Folders worked in before, most recent first and one entry per folder, so
   * returning to a folder is a choice rather than a file dialog. Bounded, and
   * optional so a workspace saved before it existed still loads.
   */
  readonly recentWorkspaces?: readonly {
    readonly path: string;
    readonly name: string;
  }[];
  readonly issues?: readonly WorkspaceIssue[];
  readonly runtime: {
    readonly tasks: "available" | "unavailable";
    readonly capabilities: "available" | "unavailable";
  };
  /**
   * The conversations that have been opened. A conversation is read from disk
   * when it is first opened, not at launch, so this is usually fewer than the
   * list shows.
   */
  readonly tasks: readonly WorkspaceTask[];
  /**
   * Every conversation, in the list's order, as the list shows it. Absent
   * means every conversation is open, and the list is `tasks`.
   */
  readonly conversations?: readonly ConversationSummary[];
  readonly selectedTaskId: string | null;
  readonly plugins: readonly PluginState[];
  readonly mcpServers: readonly McpServerState[];
  /** Browser owned by selectedTaskId; closed when no conversation is selected. */
  readonly browser?: BrowserPanelState;
  readonly usage: UsageState;
};

/**
 * Something the core reports as wrong. The message is one plain statement;
 * a location and the conversation it concerns travel apart from it, so the
 * window can set a path aside and offer what can be done about it.
 */
export type WorkspaceIssue = {
  readonly message: string;
  /** Where a copy of damaged data was kept. */
  readonly keptAt?: string;
  /** The conversation it concerns, which the person may delete from here. */
  readonly conversationId?: string;
};
