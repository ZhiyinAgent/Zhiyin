import type { BrowserPanelState } from "./browser-state.js";
import type { PartsPanelState } from "./parts-state.js";
import type { ScenePanelState } from "./scene-state.js";

/** Light, dark, or whichever Windows is set to. */
export type Appearance = "system" | "light" | "dark";
import type { ContextBudgetChoice } from "./context-budget.js";
import type {
  DocumentPanelState,
  ThreeDContent,
  WorkspaceView,
} from "./documents.js";
import type {
  ConversationSummary,
  HistoryRecovery,
  NewerHistory,
} from "./history.js";
import type { FolderInstructionsChoice } from "./instructions.js";
import type { McpServerState } from "./mcp-state.js";
import type { PluginState } from "./plugin-state.js";
import type { SpellingChoice, SpellingState } from "./spelling.js";
import type { WorkspaceTask } from "./task.js";
import type { UsageState } from "./usage-state.js";
import type { WorkPauses } from "./work-pauses.js";
import type { ReviewerModelChoice } from "./reviewer-model.js";
import type { LookChoice } from "./looks.js";

/**
 * The choices a person makes for every conversation, saved with the history
 * and restored at start. Each is absent until the person changes it, and its
 * default applies. Every one is named in `personalSettingNames`, and the
 * saved history gives each its check.
 */
export type PersonalSettings = {
  /** The budget a conversation without its own choice is kept under. */
  readonly contextBudget?: ContextBudgetChoice;
  /** Set when the person turned notifications outside the window off. */
  readonly notifications?: "off";
  /** Set when the person turned off reviewing studio work before a turn ends. */
  readonly studioReviews?: "off";
  /** Set when the person chose a model other than the conversation's to review studio work on. */
  readonly reviewerModel?: ReviewerModelChoice;
  /** Set once the person changed when long tasks stop to ask; absent, the defaults apply. */
  readonly workPauses?: WorkPauses;
  /** Set when the person chose light or dark; absent, Windows decides. */
  readonly appearance?: Exclude<Appearance, "system">;
  /** Set when the person chose a look or a strength; absent, `defaultLook`. */
  readonly look?: LookChoice;
  /** Set once the person changed spelling; absent, the defaults apply. */
  readonly spellingChoice?: SpellingChoice;
  /** Whether to use each folder's AGENTS.md, by the content they saw. */
  readonly folderInstructionChoices?: readonly FolderInstructionsChoice[];
  /** Onboarding's answers; absent until onboarding is done. */
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
};

/** Every personal setting by name, so a list of them cannot leave one out. */
export const personalSettingNames: {
  readonly [Name in keyof PersonalSettings]-?: Name;
} = {
  contextBudget: "contextBudget",
  notifications: "notifications",
  studioReviews: "studioReviews",
  reviewerModel: "reviewerModel",
  workPauses: "workPauses",
  appearance: "appearance",
  look: "look",
  spellingChoice: "spellingChoice",
  folderInstructionChoices: "folderInstructionChoices",
  preferences: "preferences",
};

export type WorkspaceSnapshot = PersonalSettings & {
  readonly historyRecovery?: HistoryRecovery;
  readonly newerHistory?: NewerHistory;
  /**
   * Conversations whose earlier part is being summarised now, with when each
   * summary began (ISO timestamp); never saved.
   */
  readonly compacting?: readonly {
    readonly taskId: string;
    readonly since: string;
  }[];
  /** Spelling as it is now; never saved. */
  readonly spelling?: SpellingState;
  readonly workspace?: { readonly path: string; readonly name: string };
  /**
   * Folders named at launch, at this launch or an earlier one, that the person
   * has not chosen since, most recent first and bounded. None is saved as the
   * folder shown or offered among the recent ones. Saved with the history;
   * the window has no use for it.
   */
  readonly launchFolders?: readonly string[];
  /**
   * Folders worked in before, most recent first and one entry per folder, so
   * returning to a folder is a choice rather than a file dialog. Bounded.
   */
  readonly recentWorkspaces: readonly {
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
  /** 3D scene owned by selectedTaskId; closed when no conversation is selected. */
  readonly scene?: ScenePanelState;
  /** The parts selectedTaskId built last, when it built any. */
  readonly parts?: PartsPanelState;
  /** Document owned by selectedTaskId; closed when no conversation is selected. */
  readonly document?: DocumentPanelState;
  /** What the space beside selectedTaskId shows. */
  readonly workspaceView?: WorkspaceView;
  /** What its 3D view shows, when it has something in 3D. */
  readonly threeD?: ThreeDContent;
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
  /**
   * The conversation it concerns. It is shown only while that conversation is
   * the selected one, in its place, so reports about several never pile up.
   */
  readonly conversationId?: string;
  /** The conversation cannot be opened, so the person may delete it from here. */
  readonly canDelete?: true;
  /** The conversation waits for an update, which the person may start from here. */
  readonly canUpdate?: true;
};
