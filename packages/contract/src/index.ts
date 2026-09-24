/**
 * Everything that crosses between the core and the renderer, in one place.
 *
 * There is no code generation here and nothing to keep in sync: both sides are
 * TypeScript and import these declarations directly. The contract is the file,
 * not a build step.
 */

/** Identifies the running core. Answers "what am I actually talking to". */
export interface CoreInfo {
  readonly version: string;
}

/**
 * Everything the core can tell the renderer.
 *
 * One stream, not per-feature events: the audit trail and the live UI are
 * rendered from the same sequence, so there is no way for the app to do
 * something user-visible that the trail omits.
 */
export type WorkStep = {
  readonly id: string;
  readonly label: string;
  readonly detail?: string;
  readonly status: "complete" | "active" | "queued" | "failed";
};

export { REASONING_EFFORTS } from "./reasoning.js";
import type { ConversationSummary, HistoryRecovery } from "./history.js";
export type { ConversationSummary, HistoryRecovery } from "./history.js";
export type {
  ModelResponseRecord,
  ModelRetryRecord,
} from "./model-response.js";
import type { ModelResponseRecord } from "./model-response.js";
export type {
  FittedPicture,
  PictureFitting,
  ProducedImage,
  StoredPicture,
} from "./pictures.js";
import type { ProducedImage, StoredPicture } from "./pictures.js";
export type { ModelHistoryEntry } from "./model-history.js";
import type { ModelHistoryEntry } from "./model-history.js";
export { estimatedTokens, utf8Bytes } from "./token-estimate.js";
export * from "./context-budget.js";
export type * from "./reasoning.js";
export type * from "./messages.js";
export type * from "./models.js";
import type {
  ApiKeySaveOutcome,
  ModelCatalog,
  ModelProviderList,
  ProviderSettings,
} from "./models.js";
import type { ContextBudgetChoice, TaskContext } from "./context-budget.js";
import type { ReasoningSelection } from "./reasoning.js";
import type { PasteOutcome, TaskMessage } from "./messages.js";

export type TaskAction = {
  readonly id: string;
  readonly action: string;
  readonly description?: string;
  readonly target: string;
  readonly command?: string;
  readonly toolName?: string;
  readonly evidence?: string;
  readonly policy?: string;
  /**
   * The change this action proposed, kept after it ran. Reviewing a change
   * before approving it and checking afterwards what was actually done are the
   * same question asked twice, and the second one is the harder to answer from
   * a summary.
   */
  readonly changes?: readonly FileChange[];
  /** What it answered, in shapes an interface can draw. */
  readonly details?: readonly ActionDetail[];
  /**
   * What the action would do, as the feature that owns it put it, and what
   * Zhiyin said it was for. Both were shown when permission was asked; kept so
   * that going back to the action later shows what was agreed to rather than a
   * bare record of it having happened. `claim` is model-written and unverified
   * wherever it appears, and is carried apart from everything established so
   * that stays true here too.
   */
  readonly detail?: string;
  readonly claim?: string;
  /** What was called and with what. Absent on records saved before it existed. */
  readonly invocation?: ToolInvocation;
  /** Optional so task history saved before ordered timeline entries can load. */
  readonly sequence?: number;
  readonly status:
    | "running"
    | "completed"
    /**
     * The action ran to completion and reported back, but did not establish
     * success — a command that exited non-zero, for instance. Distinct from
     * `failed`, which means the action could not be carried out at all.
     * Shown as neither a success nor a failure, because it is neither.
     */
    | "reported"
    | "failed"
    | "denied"
    | "blocked"
    | "cancelled";
  readonly reason?: string;
};

export type TaskPlanItem = {
  readonly id: string;
  readonly title: string;
  readonly criterion: string;
  readonly status:
    "pending" | "active" | "checking" | "verified" | "needs-attention";
  readonly verification?: string;
};

/**
 * Exactly what one file would look like before and after an action, as the
 * implementation that would carry it out reports it.
 *
 * Shown instead of the call's arguments, because a person cannot review a
 * change by reading `write_file({"path":...,"text":"..."})`. What they
 * need is the difference, and only the tool knows both sides of it: the
 * proposed text comes from the model, the existing text from the disk.
 *
 * Bounded on purpose. A change too large to show says so rather than arriving
 * as megabytes of text nobody will read; `omitted` names why, and its presence
 * means the approval is being given without a full picture.
 */
export type FileChange = {
  readonly path: string;
  readonly change: "created" | "updated";
  /** Absent when the file does not exist yet. */
  readonly before?: string;
  /** Absent when the change is too large to carry. */
  readonly after?: string;
  /** Why the contents are not here, when they are not. */
  readonly omitted?: string;
};

export type ApprovalRequest = {
  readonly id: string;
  readonly action: string;
  readonly target: string;
  readonly reason: string;
  readonly command: string;
  readonly effect?: string;
  /** What the action will change, in the words of the feature that owns it. */
  readonly detail?: string;
  /**
   * What Zhiyin says the action is for. Model-written and unverified, so it is
   * carried separately from `detail` and must be shown as a claim.
   */
  readonly claim?: string;
  /** What is being called and with what, laid out rather than rendered. */
  readonly invocation?: ToolInvocation;
  readonly destination?: string;
  /**
   * The exact before and after of every file this action would change, when
   * the implementation can name them. Reviewed in place of the call.
   */
  readonly changes?: readonly FileChange[];
  readonly recovery?: {
    readonly files: readonly {
      readonly path: string;
      readonly status: "protected" | "unprotected";
      readonly reason?: string;
    }[];
  };
};

export type ClarificationOption = {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
};

export type ClarificationQuestion = {
  readonly id: string;
  readonly prompt: string;
  readonly options?: readonly ClarificationOption[];
  readonly allowText?: boolean;
};

export type QuizAnswer = { readonly id: string; readonly label: string };

export type QuizQuestion = {
  readonly id: string;
  readonly prompt: string;
  readonly answers: readonly QuizAnswer[];
  readonly selection: "single" | "multiple";
  readonly correctAnswerIds: readonly string[];
  readonly explanation: string;
};

export type UserInputRequest =
  | {
      readonly kind: "clarification";
      readonly title: string;
      readonly questions: readonly ClarificationQuestion[];
    }
  | {
      readonly kind: "quiz";
      readonly title: string;
      readonly questions: readonly QuizQuestion[];
    };

export type WorkBudgetRequest = {
  readonly kind: "workBudget";
  readonly title: string;
  readonly completedRounds: number;
};

export type PendingUserInputRequest = (UserInputRequest | WorkBudgetRequest) & {
  readonly id: string;
};

export type UserInputAnswer = {
  readonly questionId: string;
  readonly answerIds?: readonly string[];
  readonly text?: string;
};

export type UserInputResponse = {
  readonly answers: readonly UserInputAnswer[];
};

export type TaskInteraction = {
  readonly id: string;
  readonly callId: string;
  readonly request: UserInputRequest;
  readonly response: UserInputResponse;
  readonly sequence?: number;
};

/**
 * A file this task produced, as the person reviewing the work sees it.
 *
 * Identified by its workspace-relative path: within one task there is one
 * record per file, so writing the same file twice updates that record instead
 * of accumulating near-duplicates. `change` says what the task did the first
 * time it touched the file — created something new, or altered something that
 * was already there — which is the distinction a reviewer cares about long
 * after the action itself has scrolled away.
 */
export type TaskArtifact = {
  readonly path: string;
  readonly name: string;
  readonly change: "created" | "updated";
  readonly bytes: number;
  /** ISO timestamp of the last action that wrote it. */
  readonly updatedAt: string;
};

/** Addressed by path: the caller already holds the record it asked about. */
export type ArtifactPreview =
  | {
      readonly status: "ready";
      readonly path: string;
      readonly text: string;
      readonly truncated: boolean;
    }
  | {
      readonly status: "missing";
      readonly path: string;
      readonly reason: string;
    }
  | {
      readonly status: "unreadable";
      readonly path: string;
      readonly reason: string;
    };

export type ArtifactExport =
  | { readonly status: "saved"; readonly destination: string }
  | { readonly status: "cancelled" }
  | { readonly status: "failed"; readonly reason: string };

/** The outcome of asking for a local plugin package directory and applying it. */
export type PluginSourceOutcome =
  | { readonly status: "applied" }
  | { readonly status: "cancelled" }
  | { readonly status: "failed"; readonly reason: string };

export type TaskOutcome = {
  readonly title: string;
  readonly summary: string;
  readonly file?: string;
};

export type RewindPreview = {
  readonly id: string;
  readonly taskId: string;
  readonly messageId: string;
  readonly draft: string;
  readonly discardedMessages: number;
  readonly discardedActions: readonly TaskAction[];
  readonly files: readonly RewindFileEffect[];
};

export type RewindFileEffect = {
  readonly path: string;
  readonly action: "restore" | "remove" | "unknown";
  readonly status: "recoverable" | "conflict" | "unprotected";
  readonly reason?: string;
};

export type RewindCommitResult = {
  readonly files: readonly {
    readonly path: string;
    readonly status: "restored" | "removed" | "conflict" | "unprotected";
    readonly reason?: string;
  }[];
};

export type TaskPhase =
  | { readonly kind: "draft" }
  | { readonly kind: "loading" }
  | {
      readonly kind: "working";
      readonly steps: readonly WorkStep[];
      readonly note?: string;
    }
  | {
      readonly kind: "approval";
      readonly steps: readonly WorkStep[];
      readonly prompt: ApprovalRequest;
    }
  | {
      readonly kind: "input";
      readonly steps: readonly WorkStep[];
      readonly prompt: PendingUserInputRequest;
    }
  | {
      readonly kind: "browser";
      readonly steps: readonly WorkStep[];
      readonly note?: string;
    }
  | {
      readonly kind: "completed";
      readonly outcome: TaskOutcome;
      /**
       * Specialist runs still going in the background when this turn ended.
       * Absent or empty once nothing is left outstanding. Ids into
       * `WorkspaceTask.specialistRuns`; a person can still act on this
       * conversation while these finish.
       */
      readonly backgroundSpecialistIds?: readonly string[];
    }
  | { readonly kind: "failed"; readonly reason: string }
  | { readonly kind: "interrupted"; readonly reason?: string };

export type SessionContext =
  | {
      readonly kind: "workspace";
      readonly project: string;
      readonly files: readonly {
        readonly name: string;
        readonly meta: string;
      }[];
      readonly changes: string;
    }
  | {
      readonly kind: "browser";
      readonly title: string;
      readonly url: string;
    };

export type WorkspaceTask = TaskContext & {
  readonly reasoning?: ReasoningSelection;
  readonly id: string;
  readonly title: string;
  /** Missing only in history written before automatic-title provenance existed. */
  readonly titleSource?: "generated" | "manual";
  /** ISO timestamp. Optional so task history saved before timestamps can load. */
  readonly updatedAt?: string;
  readonly updatedLabel: string;
  readonly messages: readonly TaskMessage[];
  /** Optional so history written before per-request diagnostics can load. */
  readonly modelResponses?: readonly ModelResponseRecord[];
  /**
   * What the model has been sent of this conversation, in order and as sent.
   * Absent in history written before it was kept; never sent to the window.
   */
  readonly modelHistory?: readonly ModelHistoryEntry[];
  /**
   * The folder this conversation was last worked in. A conversation is about
   * the files it is about, so returning to it returns to them; a turn runs in
   * this folder whatever the window last displayed. Optional so a task saved
   * before folders were recorded, and one that has never run, both load.
   */
  readonly workspace?: { readonly path: string; readonly name: string };
  /** Optional only so task history saved before action records existed can load. */
  readonly actions?: readonly TaskAction[];
  /** Optional so task history saved before explicit task plans existed can load. */
  readonly plan?: readonly TaskPlanItem[];
  /** Optional so task history saved before produced files were recorded can load. */
  readonly artifacts?: readonly TaskArtifact[];
  /** Optional so task history saved before specialist execution can load. */
  readonly specialistRuns?: readonly SpecialistRun[];
  /** Optional so task history saved before rendered tool results existed can load. */
  readonly views?: readonly TaskView[];
  /** Optional so task history saved before structured user input existed can load. */
  readonly interactions?: readonly TaskInteraction[];
  readonly phase: TaskPhase;
  readonly context?: SessionContext;
  /**
   * Plugin ids activated in this conversation, adding their skills,
   * specialists, and connectors to context from that point on. Optional so
   * task history saved before plugin activation existed can load, and absent
   * entirely means nothing beyond the workspace tools is active yet.
   */
  readonly activatedPlugins?: readonly string[];
};

export type McpServerDefinition = {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly enabled: boolean;
  /** Tool names withheld from routing even though the server still advertises them. */
  readonly disabledTools?: readonly string[];
};

/**
 * Whether an access token for this server is held in secure storage. The token
 * itself never appears here, in a definition, or in any renderer snapshot.
 */
export type McpCredentialState =
  | { readonly status: "saved" }
  | { readonly status: "none" }
  | { readonly status: "unavailable"; readonly reason: string };

export type McpToolSummary = {
  readonly name: string;
  readonly description?: string;
  readonly enabled: boolean;
};

/** The outcome of a dry-run connection attempt, made without saving anything. */
export type McpConnectionTestOutcome =
  | { readonly ok: true; readonly tools: readonly McpToolSummary[] }
  | { readonly ok: false; readonly reason: string };

export type McpServerState = McpServerDefinition & {
  readonly status: "connected" | "disconnected" | "failed" | "unauthorized";
  readonly toolCount: number;
  /** Absent only on a workspace snapshot saved before tool summaries existed. */
  readonly tools?: readonly McpToolSummary[];
  readonly reason?: string;
  readonly credential: McpCredentialState;
  /**
   * Ships inside Zhiyin rather than being configured: no endpoint to change,
   * nothing to remove, and no account to sign in to.
   */
  readonly builtIn?: boolean;
};

/** A picture of the page the agent is working on, as the browser sent it. */
export type BrowserFrameState = {
  readonly data: string;
  readonly width: number;
  readonly height: number;
};

export type BrowserPanelState = {
  readonly status: "closed" | "opening" | "open" | "failed";
  readonly url: string;
  readonly title: string;
  readonly loading: boolean;
  /** Why it is not usable, written to be read by a person. */
  readonly reason?: string;
  readonly frame?: BrowserFrameState;
};

export type ConversationBrowserState = {
  readonly taskId: string;
  readonly browser: BrowserPanelState;
};

/**
 * What a person can ask the browser to do from the panel. One shape rather
 * than ten commands, so the boundary has one thing to check.
 */
export type BrowserIntent =
  | { readonly kind: "open"; readonly url?: string }
  | { readonly kind: "close" }
  | { readonly kind: "navigate"; readonly url: string }
  | { readonly kind: "back" }
  | { readonly kind: "forward" }
  | { readonly kind: "reload" }
  | { readonly kind: "click"; readonly x: number; readonly y: number }
  | { readonly kind: "type"; readonly text: string }
  | { readonly kind: "key"; readonly key: string }
  | {
      readonly kind: "scroll";
      readonly x: number;
      readonly y: number;
      readonly deltaY: number;
    };

/** An executable specialist definition with the plugin that supplied it. */
export type SpecialistDefinition = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
  readonly provenance: { readonly source: "plugin"; readonly pluginId: string };
};

export type SpecialistHandoff = {
  readonly summary: string;
  readonly findings: readonly string[];
  readonly recommendations: readonly string[];
  readonly limitations: readonly string[];
};

/** One durable child run attached to the task that owns its authority. */
export type SpecialistRun = {
  readonly id: string;
  readonly parentRunId?: string;
  readonly specialist: SpecialistDefinition;
  readonly task: string;
  readonly depth: number;
  readonly status: "running" | "completed" | "failed" | "interrupted";
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly actionIds: readonly string[];
  readonly handoff?: SpecialistHandoff;
  readonly reason?: string;
};

export type PluginComponentStatus =
  "ready" | "off" | "setup-required" | "failed" | "unavailable";

/**
 * How a person changes a component's content: in place (a plugin made in the
 * app), as an edit layered over shipped or imported content, or not at all
 * (a connector's endpoint belongs to its package).
 */
export type ComponentEditing = "authored" | "override" | "none";

/** One program a connector needs, as a person is told about it. */
export type ToolchainDownload = {
  readonly name: string;
  readonly version: string;
  readonly bytes: number;
  readonly source: string;
};

/** The external programs an application connector needs, installed on request. */
export type ToolchainState =
  | { readonly status: "ready" }
  | {
      readonly status: "missing";
      /** Everything installing downloads, stated before a person agrees. */
      readonly downloads: readonly ToolchainDownload[];
    }
  | { readonly status: "installing" }
  | { readonly status: "failed"; readonly reason: string };

export type PluginComponentState = {
  /** `<plugin>/<component>`. */
  readonly id: string;
  readonly kind: "skill" | "specialist" | "connection";
  readonly name: string;
  readonly description: string;
  /** The component's own switch, kept while its plugin is off. */
  readonly enabled: boolean;
  readonly status: PluginComponentStatus;
  readonly editing: ComponentEditing;
  /** A person's edit is in effect. */
  readonly overridden?: boolean;
  /** The package now ships different content than the edit replaced. */
  readonly shippedChanged?: boolean;
  /** Provided by the application rather than a remote server. */
  readonly appConnector?: boolean;
  readonly toolchain?: ToolchainState;
  readonly detail?: string;
  readonly access?: string;
  readonly dataDestination?: string;
};

/** A skill's or specialist's full content, for reading or editing it. */
export type ComponentContent = {
  readonly id: string;
  readonly kind: "skill" | "specialist";
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
  readonly editing: "authored" | "override";
  /** Present while an edit is in effect: what the package ships. */
  readonly shipped?: {
    readonly name: string;
    readonly description: string;
    readonly instructions: string;
  };
  readonly shippedChanged?: boolean;
};

/** A person's replacement content. A skill's name is its id and is not edited. */
export type ComponentContentDraft = {
  readonly name?: string;
  readonly description: string;
  readonly instructions: string;
};

/** One installed package as a person sees it, joined to live runtime state. */
export type PluginState = {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly category: string;
  readonly publisher: string;
  readonly source: "built-in" | "personal" | "project" | "marketplace";
  /** Package activation; component preferences remain stored while this is off. */
  readonly enabled: boolean;
  /**
   * `authored` for a plugin made in the app, which is edited and removed as a
   * whole; `override` for a shipped or imported one, whose components take
   * edits layered over their content.
   */
  readonly editing: "authored" | "override";
  /** Whether an update replaced a version this package can still restore. */
  readonly rollbackAvailable: boolean;
  readonly status: "ready" | "partial" | "off" | "failed";
  readonly defaultPrompts: readonly string[];
  readonly accessSummary?: string;
  readonly dataDestination?: string;
  readonly components: readonly PluginComponentState[];
};

/**
 * A skill's SKILL.md has no field for a display name distinct from its
 * portable slug — `id` doubles as both.
 */
export type AuthoredSkillDraft = {
  readonly id: string;
  readonly description: string;
  readonly instructions: string;
};

export type AuthoredSpecialistDraft = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
};

export type AuthoredMcpServerDraft = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly url: string;
  readonly access?: string;
  readonly dataDestination?: string;
};

/** A plugin's editable content, round-tripped whole on every save. */
export type AuthoredPluginContents = {
  readonly displayName: string;
  readonly description: string;
  readonly skills: readonly AuthoredSkillDraft[];
  readonly specialists: readonly AuthoredSpecialistDraft[];
  readonly mcpServers: readonly AuthoredMcpServerDraft[];
};

export type UsageRange = {
  readonly days: 7 | 30;
  readonly requests: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
  readonly pricedRequests: number;
  readonly activity: readonly {
    readonly date: string;
    readonly requests: number;
    readonly costUsd: number;
  }[];
  readonly models: readonly {
    readonly model: string;
    readonly requests: number;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly costUsd: number;
  }[];
};

export type UsageState =
  | { readonly status: "loading" }
  | { readonly status: "unavailable"; readonly reason: string }
  | {
      readonly status: "ready";
      readonly costSource: "provider-reported";
      readonly ranges: {
        readonly "7": UsageRange;
        readonly "30": UsageRange;
      };
    };

export type EvidenceState = {
  readonly corrections: {
    readonly retainedEntries: number;
    readonly shownEntries: number;
    readonly maximumEntries: number;
    readonly entries: readonly {
      readonly at: string;
      readonly taskId: string;
      readonly taskTitle?: string;
      readonly toolName: string;
      readonly kind: "quiet-retry" | "repair-applied" | "repair-rejected";
      readonly reason: string;
      readonly cause?: string;
      readonly before?: string;
      readonly after?: string;
    }[];
  };
  readonly recovery: {
    readonly usedBytes: number;
    readonly retainedFiles: number;
    readonly excludedFiles: number;
    readonly limits: {
      readonly totalBytes: number;
      readonly fileBytes: number;
      readonly versionsPerPath: number;
      readonly maximumAgeDays: number;
    };
  };
  readonly policy: {
    readonly correctionRedaction: string;
    readonly taskDeletion: string;
    readonly privateStorage: string;
  };
};

export type WorkspaceSnapshot = {
  readonly historyRecovery?: HistoryRecovery;
  /** The budget a conversation without its own choice is kept under. */
  readonly contextBudget?: ContextBudgetChoice;
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
  readonly issues?: readonly string[];
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

export type ProviderUsage = {
  readonly requestId: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly costUsd?: number;
  /** Of the input, what the provider read from and wrote to its cache. */
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
  readonly recordedAt: string;
};

/**
 * A workspace file an action created or replaced. A tool declares what it
 * changed; nothing downstream has to guess from a tool's name or its result
 * shape which actions produce files.
 */
export type ProducedFile = {
  /** Workspace-relative, forward-slashed. */
  readonly path: string;
  readonly change: "created" | "updated";
  readonly bytes: number;
};

/**
 * How a tool reports what it did, in shapes an interface can draw.
 *
 * A tool knows what its own result means; nothing else does. Left to infer,
 * the interface would have to switch on tool names — which is the same mistake
 * as trusting a name for authority (ADR 0018), one layer up: a remote tool
 * calling itself `search_files` would inherit the drawing as well as the
 * trust. So the tool says which of a few plain shapes its answer takes, and
 * the interface knows only the shapes.
 *
 * Deliberately few. This is a vocabulary for showing an answer to a person,
 * not a layout language, and a tool that needs something outside it should
 * say nothing rather than force a shape — an unadorned result is honest, a
 * wrong one is not.
 */
/**
 * A tool call as a person should read it: what was called, and with what.
 *
 * Carried as structure rather than as a rendered string, because the interface
 * has to lay the arguments out and a rendered call can only be taken apart
 * again by guessing — the first value containing a bracket or a quote defeats
 * any parser written against it.
 */
export type ToolInvocation = {
  /** The tool as the person should see it, without routing prefixes. */
  readonly name: string;
  /** Where the call goes, when that is not this machine. */
  readonly via?: string;
  readonly arguments: readonly ToolArgument[];
};

export type ToolArgument = {
  readonly name: string;
  /**
   * What this input is for, taken from the schema the tool declares.
   *
   * Written by whoever runs the tool, not by this app, and therefore a claim
   * rather than anything established here - a server is free to describe
   * `delete_everything` as listing files. Shown as the server's words, in the
   * same way `claim` is shown as the model's.
   */
  readonly described?: string;
  /** The value as JSON text. Formatted and coloured where it is drawn. */
  readonly value: string;
  /**
   * Characters removed from the middle of `value`, when it was too long to
   * carry whole. Both ends are kept: the start says what a value is, and the
   * end says where it stops.
   */
  readonly omitted?: number;
};

export type ActionDetail =
  /** A run of text: a file's contents, a command's output. */
  | {
      readonly kind: "text";
      readonly label: string;
      readonly text: string;
      readonly truncated?: boolean;
    }
  /** Short named values: an exit code, a count, a size. */
  | {
      readonly kind: "facts";
      readonly items: readonly {
        readonly label: string;
        readonly value: string;
      }[];
    }
  /** Where something was found. */
  | {
      readonly kind: "matches";
      readonly items: readonly {
        readonly path: string;
        readonly line: number;
        readonly text: string;
      }[];
      readonly truncated?: boolean;
      /** What the answer does not cover, when it does not cover everything. */
      readonly note?: string;
    }
  /** Names, as a list: the entries of a folder. */
  | {
      readonly kind: "list";
      readonly label: string;
      readonly items: readonly string[];
      readonly truncated?: boolean;
    }
  /**
   * A picture the action produced, shown as itself.
   *
   * The picture is named, not carried: a conversation's saved state is
   * rewritten whenever anything in it changes, and a megabyte of encoded
   * image inside that file would be rewritten with it. `source` names a
   * picture the application stored, read back on demand.
   */
  | {
      readonly kind: "image";
      readonly label: string;
      readonly mediaType: string;
      /** Opaque id of a stored picture, never a path. */
      readonly source: string;
      /** What the picture is of, for anyone not looking at it. */
      readonly alt: string;
    };

export type ToolInvocationResult =
  | {
      readonly ok: true;
      readonly value: unknown;
      readonly produced?: readonly ProducedFile[];
      readonly view?: ProducedView;
      /**
       * Pictures this action produced. Only a model that accepts images is
       * ever sent them; for any other, an action that can only answer in
       * pictures is not offered in the first place.
       */
      readonly images?: readonly ProducedImage[];
      /**
       * The answer as the tool would have a person read it. Absent when the
       * tool has nothing better to offer than what it returned to the model.
       */
      readonly details?: readonly ActionDetail[];
    }
  | {
      readonly ok: false;
      readonly reason: string;
      /**
       * What was observed even though the action failed — the output of a
       * command that exited non-zero, for instance. A failure is still a
       * failure; this is so reporting it honestly does not mean throwing away
       * the evidence of what happened.
       */
      readonly value?: unknown;
      /**
       * True when the action itself ran to completion and `reason` describes
       * what it reported, rather than something that stopped it from running.
       * A command that exits non-zero has reported; one that could not be
       * started, was stopped, or timed out has not.
       *
       *
       * The model is told the same thing either way — this is not success. The
       * distinction exists so a person is not shown a failure marker for an
       * action that did exactly what it was asked to do and came back with an
       * answer they can act on.
       */
      readonly reported?: boolean;
      /** What it did report, when it reported something worth reading. */
      readonly details?: readonly ActionDetail[];
    };

export type ToolCallInspection =
  | {
      readonly ok: true;
      readonly action: string;
      readonly target: string;
      readonly command: string;
      readonly invocation?: ToolInvocation;
      /**
       * Exact interface copy supplied by an implementation the app owns.
       * Remote tools cannot provide this; their purpose remains model-written
       * and attributed as such.
       */
      readonly presentation?: Readonly<{ title: string; description: string }>;
      /**
       * One plain sentence naming the consequence the action string alone does
       * not carry — that a file is replaced rather than created, or how many
       * files an edit touches. Shown with the permission request.
       */
      readonly detail?: string;
      /**
       * An explanation supplied by the model, never verified. Kept apart from
       * `detail` so an unverified claim can never be shown as an established
       * consequence.
       */
      readonly claim?: string;
      readonly identity?: string;
      readonly destination?: string;
      /**
       * What the action does to durable state, declared by the implementation
       * that will carry it out. Absent means no claim was made, and no claim
       * is read as a change: a tool that does not say it only reads does not
       * get treated as though it had.
       */
      readonly access?: "read" | "change";
      /**
       * Whether the action stays inside the selected workspace, computed by
       * the implementation that enforces the containment. Nothing downstream
       * may re-derive this from `target` — a second containment predicate is a
       * second boundary to keep in sync with the one that actually holds.
       */
      readonly scope?: "workspace" | "outside";
      /**
       * What every file this action would change looks like before and after.
       * Only a tool that knows its effects exactly can offer this; a shell
       * command cannot, and says nothing here rather than guessing.
       */
      readonly changes?: readonly FileChange[];
      /** Only built-in inert display tools may opt out of permission. */
      readonly requiresApproval?: false;
      /** Source to check in the renderer before this tool is allowed to run. */
      readonly view?: ProducedView;
      /** A bounded built-in question set that waits for a person's answer. */
      readonly input?: UserInputRequest;
    }
  | {
      readonly ok: false;
      readonly reason: string;
      /**
       * True when the model can fix this itself by proposing a better call —
       * a pattern that did not match, an ambiguous request, a path that does
       * not exist. A caller may retry such a failure quietly instead of
       * spending a person's attention on it. Never set for a refusal that a
       * person should see, such as an attempt to leave the workspace.
       */
      readonly correctable?: boolean;
      /**
       * Argument field names whose values any attempted repair must carry
       * through unchanged, matched wherever they appear in the arguments.
       *
       * A repair is allowed to fix how an action is *aimed* — which file, which
       * occurrence, how the text to find is written. It is never allowed to
       * change what the action would *write*, because that is the part nobody
       * else proposed. The tool names those fields because only the tool knows
       * which of its arguments carry content.
       */
      readonly preserveOnRepair?: readonly string[];
    };

/** A page of the app. */
export type AppSurface =
  "thread" | "library" | "usage" | "evidence" | "settings";

export type AppEvent =
  | { readonly kind: "coreReady"; readonly data: CoreInfo }
  | { readonly kind: "workspaceSnapshot"; readonly data: WorkspaceSnapshot }
  | { readonly kind: "taskChanged"; readonly data: WorkspaceTask }
  | {
      readonly kind: "taskRemoved";
      readonly data: {
        readonly taskId: string;
        readonly selectedTaskId: string | null;
      };
    }
  | {
      readonly kind: "taskSelectionChanged";
      readonly data: { readonly taskId: string | null };
    }
  | {
      readonly kind: "mcpServersChanged";
      readonly data: readonly McpServerState[];
    }
  | {
      readonly kind: "pluginsChanged";
      readonly data: readonly PluginState[];
    }
  | {
      readonly kind: "browserChanged";
      readonly data: ConversationBrowserState;
    }
  | { readonly kind: "usageRecorded"; readonly data: ProviderUsage }
  | { readonly kind: "usageChanged"; readonly data: UsageState }
  | {
      readonly kind: "providerSettingsChanged";
      readonly data: ProviderSettings;
    }
  | {
      readonly kind: "toolActivity";
      readonly data: {
        readonly taskId: string;
        readonly callId: string;
        readonly toolName: string;
        readonly status:
          "approved" | "denied" | "completed" | "reported" | "failed";
        readonly result?: ToolInvocationResult;
      };
    };

/**
 * The whole surface the renderer is given. The preload bridge exposes exactly
 * this and nothing else — no Node, no Electron, no filesystem.
 */
export interface CoreApi {
  configureProfile?(interests: readonly string[]): Promise<void>;
  /**
   * Answers the damaged-history question. `recover` keeps the conversations
   * that could be read; `startFresh` begins again, with the damaged file still
   * kept aside.
   */
  recoverHistory?(choice: "recover" | "startFresh"): Promise<void>;
  chooseWorkspace?(): Promise<void>;
  /**
   * Return to a folder already worked in. The path must come from
   * `recentWorkspaces`; anything else is rejected by the core, so the
   * renderer can never name a folder a person did not once choose in a dialog.
   */
  useRecentWorkspace?(path: string): Promise<void>;
  /**
   * The renderer announcing it has mounted and is listening. A handshake rather
   * than the core emitting at startup, which would race the window attaching
   * its listener.
   */
  frontendReady(): Promise<void>;

  /** Reads private local correction and recovery retention information. */
  readEvidence(): Promise<EvidenceState>;

  /** Deletes one class of retained private evidence. */
  clearEvidence(kind: "corrections" | "recovery"): Promise<EvidenceState>;

  /** Create and select an empty task. The returned id is core-owned. */
  createTask(): Promise<string>;

  /** Select a task that already exists in the authoritative snapshot. */
  selectTask(taskId: string): Promise<void>;

  /**
   * Open no conversation at all — the empty page a new one is started from.
   *
   * The core has to be told. Every snapshot it sends carries which
   * conversation is open, so a window showing a blank page while the core
   * still believes the last one is open is thrown back into it by the next
   * snapshot that arrives for any other reason. Optional so a renderer built
   * against an older core keeps working.
   */
  selectNothing?(): Promise<void>;

  renameTask(taskId: string, title: string): Promise<void>;

  deleteTask(taskId: string): Promise<void>;

  /**
   * Start a model turn for a task. Streaming progress arrives as events.
   * `attachments` names pastes `keepPaste` kept; a message may be only those.
   */
  sendMessage(
    taskId: string,
    message: string,
    reasoning?: ReasoningSelection,
    attachments?: readonly string[],
  ): Promise<void>;

  /** Keeps a long paste as a draft attachment, so the composer never holds it. */
  keepPaste(text: string): Promise<PasteOutcome>;

  /** How full a conversation may grow before it is condensed. */
  setContextBudget(taskId: string, budget: ContextBudgetChoice): Promise<void>;

  /** The budget every conversation without its own choice follows. */
  setDefaultContextBudget(budget: ContextBudgetChoice): Promise<void>;

  /** Condenses now, or before the running turn's next request. */
  condenseNow(taskId: string): Promise<void>;

  /** Opens a pasted text in the person's own editor; `taskId` null for a draft. */
  openAttachment(taskId: string | null, id: string): Promise<void>;

  /** Review the exact conversation revision before discarding anything. */
  previewRewind(taskId: string, messageId: string): Promise<RewindPreview>;

  /** Apply only the still-current rewind previously returned by previewRewind. */
  commitRewind(
    taskId: string,
    rewindId: string,
    files: "keep" | "restore",
  ): Promise<RewindCommitResult>;

  /** Stop the active turn for a task and all work it owns. */
  interruptTask(taskId: string): Promise<void>;

  /** Resolve the exact permission request currently blocking a task. */
  resolveApproval(
    taskId: string,
    requestId: string,
    decision: "allow" | "deny",
  ): Promise<void>;

  /** Resolve the exact structured question request currently blocking a task. */
  resolveUserInput(
    taskId: string,
    requestId: string,
    response: UserInputResponse,
  ): Promise<void>;

  setPluginEnabled(id: string, enabled: boolean): Promise<void>;

  /** Turns one skill, specialist, or connector on or off, by its full id. */
  setComponentEnabled(id: string, enabled: boolean): Promise<void>;

  /** A skill's or specialist's full content, or nothing for an unknown id. */
  componentContent(id: string): Promise<ComponentContent | undefined>;

  /** Layers a person's edit over a shipped or imported component. */
  overrideComponent(id: string, content: ComponentContentDraft): Promise<void>;

  /** Returns a component to the content its package ships. */
  resetComponent(id: string): Promise<void>;

  /** Downloads and installs the program an application connector needs. */
  installToolchain(id: string): Promise<void>;

  /** Asks for a local package directory and installs it, or is cancelled. */
  installPlugin(): Promise<PluginSourceOutcome>;
  /** Asks for a local package directory and updates the named plugin to it. */
  updatePlugin(id: string): Promise<PluginSourceOutcome>;
  rollbackPlugin(id: string): Promise<void>;
  removePlugin(id: string): Promise<void>;

  /** Creates an empty plugin, ready for skills, specialists, and connectors. */
  createPlugin(displayName: string, description: string): Promise<void>;
  /** Replaces one plugin's authored skills, specialists, and connectors. */
  savePluginContents(
    id: string,
    contents: AuthoredPluginContents,
  ): Promise<void>;
  /** One plugin's full authored content, for the component-edit form to open on. */
  editablePluginContents(
    id: string,
  ): Promise<AuthoredPluginContents | undefined>;

  setMcpServerToolEnabled(
    id: string,
    toolName: string,
    enabled: boolean,
  ): Promise<void>;

  /** A dry run against an endpoint and (optional) token, saving nothing. */
  testMcpConnection(
    server: McpServerDefinition,
    token?: string,
  ): Promise<McpConnectionTestOutcome>;

  /** Store an access token for one MCP server. The token is never read back. */
  saveMcpServerToken(id: string, token: string): Promise<void>;

  /** Forget the stored access token for one MCP server. */
  clearMcpServerToken(id: string): Promise<void>;

  /**
   * Re-checks every connection's status now, built-in and configured alike —
   * for a built-in, this is what notices a fixed prerequisite (git installed,
   * a browser now present) without waiting for an unrelated action to happen
   * to trigger a refresh.
   */
  refreshConnections(): Promise<void>;

  /** Whether the shell tool can run here, and why not when it can't. */
  shellAvailability(): Promise<ShellAvailability>;

  /** Re-detects the shell without restarting, so an install just now is picked up. */
  recheckShell(): Promise<ShellAvailability>;

  /**
   * Opens one of a small, known set of external links in the person's own
   * browser — never an arbitrary URL, so nothing rendered from untrusted
   * content can use this to reach somewhere unexpected.
   */
  openExternalUrl(url: string): Promise<void>;

  /** Ask the agent's browser to do one thing. */
  driveBrowser(intent: BrowserIntent): Promise<void>;

  saveProviderApiKey(apiKey: string): Promise<ApiKeySaveOutcome>;

  clearProviderApiKey(): Promise<void>;

  /** The models this account may use, or why the catalogue could not be read. */
  listModels(): Promise<ModelCatalog>;

  /** The upstreams that serve one model, with price and recent behaviour. */
  listModelProviders(model: string): Promise<ModelProviderList>;

  /**
   * Choose the model and the upstreams routing may use, together. They are one
   * command because a provider list belongs to the model it was chosen for;
   * applying them separately would leave a model briefly restricted to
   * upstreams that do not serve it.
   */
  selectModel(model: string, providers: readonly string[]): Promise<void>;

  /** Read a file this task produced, for review inside the app. */
  previewArtifact(taskId: string, path: string): Promise<ArtifactPreview>;
  /** The bytes of a picture an action produced, named by an `image` detail. */
  readPicture?(source: string): Promise<StoredPicture>;

  /**
   * Copy a file this task produced to a destination the person chooses. The
   * chooser lives in the main process; the renderer only asks for the copy.
   */
  exportArtifact(taskId: string, path: string): Promise<ArtifactExport>;

  /** Save a rendered conversation view to a destination the person chooses. */
  exportView(
    taskId: string,
    viewId: string,
    svg: string,
  ): Promise<ArtifactExport>;

  /** Subscribe to the event stream. Returns an unsubscribe function. */
  onAppEvent(handler: (event: AppEvent) => void): () => void;

  /**
   * Answer a question the core asked. The core cannot know whether a view is
   * drawable, because only the surface holding the drawing library can, so this
   * is the one place the renderer replies rather than requests (ADR 0017).
   */
  answerViewCheck(requestId: string, outcome: ViewCheckOutcome): Promise<void>;

  /** Subscribe to view checks the core asks for. Returns an unsubscribe. */
  onViewCheck(handler: (request: ViewCheckRequest) => void): () => void;
}

/**
 * What a view is made of. A view is stored and restored as its source, never as
 * a picture, because the conversation outlives any one render (ADR 0017).
 */
export type ViewKind =
  | "diagram"
  | "bar-chart"
  | "line-chart"
  | "scatter-plot"
  | "histogram"
  | "box-plot";

export type ProducedView = {
  readonly kind: ViewKind;
  readonly title: string;
  /** Mermaid for diagrams; normalized JSON for charts. */
  readonly source: string;
};

export type TaskView = ProducedView & {
  readonly id: string;
  readonly callId: string;
  readonly sequence?: number;
};

/**
 * The core asking the surface that draws views whether it can draw one. This is
 * the only question that travels core-first and waits for an answer; everything
 * else the core sends is a notification.
 */
export type ViewCheckRequest = {
  readonly id: string;
  readonly kind: ViewKind;
  readonly source: string;
};

/**
 * The answer. `reason` is the drawing library's own complaint, kept for the
 * repair model to work from — it is never shown to a person, who should see
 * either a view or nothing about it.
 */
export type ViewCheckOutcome =
  { readonly ok: true } | { readonly ok: false; readonly reason: string };

/**
 * A failure whose message is meant for the person, wherever it was raised. It
 * crosses a boundary — the core's workspace to a turn, say — and whoever ends
 * the work recognises it, so the two sides agree on a type rather than on the
 * spelling of a name.
 */
export class VisibleError extends Error {
  override name = "VisibleError";
}

/**
 * Who answers for a tool call. The permission engine decides on it, and a
 * remote tool cannot gain a built-in tool's authority by taking its name.
 */
export type ToolOwner = "built-in" | "mcp" | "skill" | "plugin";

export type { PluginDirectoryEntry } from "./plugin-directory.js";

/** A tool as named to the agent and shown to the user. */
export interface ToolSpec {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

/**
 * Whether the `bash` tool can run here. Absent a shell, it is a capability
 * that does not exist and is never advertised to the model — this is what a
 * person is told instead, so the gap is not silent.
 */
export type ShellAvailability =
  | { readonly available: true }
  | {
      readonly available: false;
      readonly reason: string;
      readonly installUrl: string;
    };

/**
 * Every external URL `openExternalUrl` may open. Fixed at build time, not
 * supplied at the call site's discretion — an allowlist, not a proxy for any
 * URL a renderer happens to have on hand.
 */
export const ALLOWED_EXTERNAL_URLS = [
  "https://git-scm.com/download/win",
] as const;

/** One entry of a described workspace folder. */
export type WorkspaceEntry = {
  readonly path: string;
  readonly kind: "directory" | "file" | "link" | "other";
};

/** A folder as a turn is told about it: bounded, and honest about being cut. */
export type WorkspaceDescription = {
  readonly rootName: string;
  readonly entries: readonly WorkspaceEntry[];
  readonly truncated: boolean;
};

/**
 * The folder the work happens in. The tools feature implements it; the agent
 * loop and the core read it. Three layers must agree on this shape exactly,
 * which is what the contract is for (ADR 0036).
 *
 * Nothing here is offered to the model, so this is not a tool and reaching it
 * is not reaching past the group that joins what the model may call.
 */
export interface WorkspaceContext {
  selectWorkspace?(path: string): Promise<void>;
  describeWorkspace(): Promise<WorkspaceDescription>;
  /**
   * Where the workspace currently is, or nothing when no folder is selected.
   * Present so a composition can point another feature at the same folder
   * without either feature reaching for the other.
   */
  workspaceRoot(): string | undefined;
}

/** IPC channel names. Shared so the two sides cannot disagree about them. */
export const CHANNEL = {
  configureProfile: "zhiyin:configure-profile",
  recoverHistory: "zhiyin:recover-history",
  chooseWorkspace: "zhiyin:choose-workspace",
  useRecentWorkspace: "zhiyin:use-recent-workspace",
  frontendReady: "zhiyin:frontend-ready",
  readEvidence: "zhiyin:read-evidence",
  clearEvidence: "zhiyin:clear-evidence",
  createTask: "zhiyin:create-task",
  selectTask: "zhiyin:select-task",
  selectNothing: "zhiyin:select-nothing",
  renameTask: "zhiyin:rename-task",
  deleteTask: "zhiyin:delete-task",
  sendMessage: "zhiyin:send-message",
  keepPaste: "zhiyin:keep-paste",
  setContextBudget: "zhiyin:set-context-budget",
  setDefaultContextBudget: "zhiyin:set-default-context-budget",
  condenseNow: "zhiyin:condense-now",
  openAttachment: "zhiyin:open-attachment",
  previewRewind: "zhiyin:preview-rewind",
  commitRewind: "zhiyin:commit-rewind",
  interruptTask: "zhiyin:interrupt-task",
  resolveApproval: "zhiyin:resolve-approval",
  resolveUserInput: "zhiyin:resolve-user-input",
  setPluginEnabled: "zhiyin:set-plugin-enabled",
  setComponentEnabled: "zhiyin:set-component-enabled",
  componentContent: "zhiyin:component-content",
  overrideComponent: "zhiyin:override-component",
  resetComponent: "zhiyin:reset-component",
  installToolchain: "zhiyin:install-toolchain",
  installPlugin: "zhiyin:install-plugin",
  updatePlugin: "zhiyin:update-plugin",
  rollbackPlugin: "zhiyin:rollback-plugin",
  removePlugin: "zhiyin:remove-plugin",
  createPlugin: "zhiyin:create-plugin",
  savePluginContents: "zhiyin:save-plugin-contents",
  editablePluginContents: "zhiyin:editable-plugin-contents",
  setMcpServerToolEnabled: "zhiyin:set-mcp-server-tool-enabled",
  testMcpConnection: "zhiyin:test-mcp-connection",
  saveMcpServerToken: "zhiyin:save-mcp-server-token",
  clearMcpServerToken: "zhiyin:clear-mcp-server-token",
  refreshConnections: "zhiyin:refresh-connections",
  shellAvailability: "zhiyin:shell-availability",
  recheckShell: "zhiyin:recheck-shell",
  openExternalUrl: "zhiyin:open-external-url",
  driveBrowser: "zhiyin:drive-browser",
  saveProviderApiKey: "zhiyin:save-provider-api-key",
  clearProviderApiKey: "zhiyin:clear-provider-api-key",
  listModels: "zhiyin:list-models",
  listModelProviders: "zhiyin:list-model-providers",
  selectModel: "zhiyin:select-model",
  previewArtifact: "zhiyin:preview-artifact",
  readPicture: "zhiyin:read-picture",
  exportArtifact: "zhiyin:export-artifact",
  exportView: "zhiyin:export-view",
  answerViewCheck: "zhiyin:answer-view-check",
  appEvent: "zhiyin:app-event",
  viewCheck: "zhiyin:view-check",
} as const;

/** A command the window can send, named as the channel it travels on. */
export type CommandName = Exclude<
  keyof typeof CHANNEL,
  "appEvent" | "viewCheck"
>;

/**
 * Every command channel and nothing else; the two event channels travel the
 * other way. The preload bridge offers exactly these and the main process
 * forwards exactly these, so a command is added in one place.
 */
export const COMMAND_CHANNELS = Object.fromEntries(
  Object.entries(CHANNEL).filter(
    ([name]) => name !== "appEvent" && name !== "viewCheck",
  ),
) as { readonly [Name in CommandName]: (typeof CHANNEL)[Name] };

/**
 * Every command, as the bridge offers it.
 *
 * The channel list and the bridge's interface are one vocabulary rather than
 * two lists kept in step by hand: a channel with no method here stops the
 * build, and so does a method with no channel — which would otherwise reach
 * the window as `undefined` and fail when someone pressed it.
 */
export type Commands = {
  [Name in CommandName]-?: NonNullable<CoreApi[Name]>;
};

type NothingLeft<Left extends never> = Left;

/** The other direction: a command on the bridge that travels on no channel. */
export type EveryCommandHasAChannel = NothingLeft<
  Exclude<keyof CoreApi, CommandName | "onAppEvent" | "onViewCheck">
>;

/** The property the preload bridge is exposed under on `window`. */
export const BRIDGE_KEY = "zhiyin";
