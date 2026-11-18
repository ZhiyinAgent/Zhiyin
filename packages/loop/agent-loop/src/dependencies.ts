import type {
  ContextBudgetChoice,
  ModelWindow,
  PictureFitting,
  ReasoningCapabilities,
  ReasoningSelection,
  StudioReviews,
  WorkPauses,
  WorkspaceContext,
  WorkspaceTask,
} from "@zhiyin/contract";
import type { GrantRules, PermissionEngine } from "@zhiyin/permission-engine";
import type { CapabilityTools, CommandWatch } from "@zhiyin/capabilities";
import type { Artifacts } from "@zhiyin/artifacts";
import type { CorrectionsLog } from "@zhiyin/corrections-log";
import type { KeptStore } from "@zhiyin/session";
import type { ModelClient } from "@zhiyin/model-client";
import type { UsageTelemetry } from "@zhiyin/usage";
import type { ViewValidator } from "@zhiyin/views";
import type { FileBackups, Rewind, RunBackups } from "@zhiyin/rewind";
import type { Memory } from "@zhiyin/memory";
import type { WorkLimits } from "./turn/work-limits.js";
import type { AfterCallHook } from "./tools/after-calls.js";

export interface AgentLoopDependencies {
  readonly permissions: PermissionEngine;
  /** What the conversation's standing grants offer and cover. */
  readonly grants: GrantRules;
  readonly capabilities: CapabilityTools;
  /** Which commands run as jobs, kept with the conversation for a restart. */
  readonly commands: Pick<CommandWatch, "runningCommands">;
  readonly workspace: WorkspaceContext;
  readonly artifacts: Artifacts;
  readonly views: ViewValidator;
  /**
   * Whether files are being put back for a conversation right now, and when
   * that is over.
   */
  readonly rewind: Pick<Rewind, "restoring" | "settled">;
  /**
   * The copies of what each declared file change overwrites, taken before it
   * is decided and completed once it ran.
   */
  readonly backups: FileBackups;
  /**
   * The copies around each program that may change any file in its folder,
   * taken before approval and again just before it runs (ADR 0012).
   */
  readonly runs: Pick<
    RunBackups,
    "backUp" | "start" | "finish" | "waiting" | "discard"
  >;
  readonly corrections: CorrectionsLog;
  readonly kept: KeptStore;
  readonly model: ModelClient;
  /**
   * Writes the conversation's name and the copy shown around an action.
   * Wrong here costs a worse label.
   */
  readonly guidanceModel: Pick<ModelClient, "send">;
  readonly workLimits?: WorkLimits;
  /** What one specialist may use, apart from the main task's limits. */
  readonly specialistWorkLimits?: WorkLimits;
  readonly pictures?: PictureFitting;
  /**
   * What Zhiyin remembers across conversations (ADR 0026). Without it, no
   * memory is sent and its tools are not offered.
   */
  readonly memory?: Memory;
  /**
   * What each studio hands a reviewer of the work a turn changed; with
   * none, nothing is reviewed.
   */
  readonly reviews?: readonly StudioReviews[];
  /** Hooks run after a named tool's call succeeds, each able to add a note. */
  readonly afterCalls?: readonly AfterCallHook[];
  /**
   * How far the shown answer trails the model, in milliseconds. Defaults to
   * the loop's own value; ADR 0015.
   */
  readonly revealDelayMs?: number;
  /**
   * How long the model may send nothing before the conversation says it is
   * waiting for it, in milliseconds. Defaults to the loop's own value.
   */
  readonly quietAfterMs?: number;
  /**
   * How much one request may reason before it has answered or called
   * anything, in tokens as the loop estimates them. Defaults to the loop's own
   * value.
   */
  readonly longestThoughtTokens?: number;
  /**
   * Keeps an error of Zhiyin's own that ended a turn, where it can be read
   * afterwards. The conversation says only that there was one.
   */
  readonly recordDefect?: (defect: {
    readonly taskId: string;
    readonly error: unknown;
  }) => void;
  readonly newMessageId: () => string;
  readonly newActionId: () => string;
  readonly newSpecialistRunId: () => string;
  readonly newApprovalId: () => string;
  readonly newUserInputId: () => string;
  readonly now: () => Date;
  /**
   * The person's time zone, which today's date is told in. Left out, it is
   * the one this process runs in: the computer's own.
   */
  readonly timeZone?: string;
  readonly host: TurnHost;
}

/**
 * Another model the person chose to review studio work on (ADR 0024), as its
 * provider reports it now.
 */
export type ReviewerModel = {
  readonly client: Pick<ModelClient, "send" | "uncounted">;
  readonly acceptsImages: boolean;
  readonly leastReasoning: ReasoningSelection | undefined;
  readonly reasoningControls: ReasoningCapabilities | undefined;
  readonly modelWindow: ModelWindow & { readonly model: string };
};

export interface TurnHost {
  find(taskId: string): WorkspaceTask | undefined;
  store(
    task: WorkspaceTask,
    options: {
      readonly persist: boolean;
      readonly commit: () => boolean;
      readonly announce: () => boolean;
    },
  ): Promise<void>;
  historyAvailable(): boolean;
  capabilitiesAvailable(): boolean;
  acceptsImages(): boolean;
  /**
   * The least reasoning the chosen model can be asked for: none where it
   * answers without it, otherwise its lowest effort. Nothing when it can be
   * asked for no less than was chosen.
   */
  leastReasoning(): ReasoningSelection | undefined;
  /**
   * The chosen model's reasoning controls, which every request's reasoning is
   * held to; nothing while they are not known.
   */
  reasoningControls(): ReasoningCapabilities | undefined;
  /** The model the next request goes to, and what it lists of its size. */
  modelWindow(): ModelWindow & { readonly model: string };
  /**
   * How a toolkit the model opens reaches the chosen model (ADR 0017):
   * `native` where its provider loads tools mid-conversation, `bridge` where
   * opened tools run through `call`, and `list` where they are added at the
   * end of the tool list.
   */
  toolLoading(): "native" | "bridge" | "list";
  /**
   * The provider refused a request of `refusedTokens` as too long: plan with
   * `contextWindow` from now on, where that is lower than the window listed.
   */
  lowerWindow(contextWindow: number, refusedTokens: number): void;
  /**
   * The conversation's earlier part is being summarised now, or no longer
   * is: true only while the app runs, and never saved.
   */
  compacting(taskId: string, running: boolean): void;
  /** The budget a conversation without its own choice is kept under. */
  defaultContextBudget(): ContextBudgetChoice;
  /** When long work stops to ask whether to go on, as the person set it. */
  workPauses(): WorkPauses;
  /** Whether studio work with a spec is reviewed before a turn ends, as the person set it. */
  reviewsStudioWork(): boolean;
  /**
   * The model the person chose to review studio work on; nothing while
   * reviews run on the conversation's model. Throws, saying why, when the
   * chosen one cannot be reached.
   */
  reviewerModel(): Promise<ReviewerModel | undefined>;
  /**
   * Whether the person chose to use a folder's instructions with this hash:
   * nothing when they have not been asked.
   */
  folderInstructionsChoice(root: string, hash: string): boolean | undefined;
  rememberFolderInstructions(
    root: string,
    hash: string,
    use: boolean,
  ): Promise<void>;
  enterFolderOf(taskId: string): Promise<void>;
  /**
   * Lets go of a conversation a rewind or an undo left paused because its
   * save failed, once saving works again.
   */
  settleRewind(taskId: string): Promise<void>;
  watchBrowser(taskId: string): void;
  /**
   * Zhiyin wrote these workspace files for the conversation, workspace-
   * relative: what an action produced, or what a command changed. A
   * document among them is shown or drawn again (ADR 0019).
   */
  filesWritten(taskId: string, paths: readonly string[]): Promise<void>;
  /**
   * The main agent read a workspace document, from a page (ADR 0019). It is
   * shown by the rules a write follows; the answer says, in a sentence for
   * the agent, what the person now sees.
   */
  documentRead(taskId: string, path: string, page?: number): Promise<string>;
  /**
   * The main agent closed the document beside the conversation, unless the
   * person chose what that space shows this turn. The answer says
   * what the person now sees.
   */
  documentClose(taskId: string): Promise<string>;
  refreshConnections(): Promise<void>;
  recordUsage(
    usage: Parameters<UsageTelemetry["record"]>[0] extends infer Usage
      ? Omit<Usage, "recordedAt">
      : never,
  ): Promise<void>;
  reportIssue(notice: string): void;
}
