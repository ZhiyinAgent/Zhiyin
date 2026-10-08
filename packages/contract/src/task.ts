import type { TaskArtifact } from "./artifacts.js";
import type { TaskContext } from "./context-budget.js";
import type { WorkStep } from "./core-info.js";
import type { FileChange } from "./file-change.js";
import type { StandingInstruction } from "./instructions.js";
import type { TaskInteraction } from "./interaction.js";
import type { TaskGuidance, TaskMessage } from "./messages.js";
import type { ModelHistoryEntry } from "./model-history.js";
import type { ModelResponseRecord } from "./model-response.js";
import type { TaskPlanItem } from "./plan.js";
import type { TaskUndo } from "./rewind.js";
import type { ReasoningSelection } from "./reasoning.js";
import type { SpecialistRun } from "./specialist-run.js";
import type { ConversationPermission, TaskAction } from "./task-action.js";
import type { TaskOutcome } from "./task-outcome.js";
import type { ToolInvocation } from "./tool-invocation.js";
import type { PendingUserInputRequest } from "./user-input.js";
import type { TaskView } from "./views.js";

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
  /** A precise conversation permission the person may choose to grant. */
  readonly conversationRule?: { readonly label: string };
};

export type TaskPhase =
  | { readonly kind: "draft" | "loading" }
  | {
      readonly kind: "working";
      readonly steps: readonly WorkStep[];
      readonly note?: string;
      readonly retry?: { readonly readyAt: string; readonly count?: string };
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
  | {
      readonly kind: "failed";
      readonly reason: string;
      /** What the person can do about it, in the order offered. */
      readonly remedies?: readonly TurnRemedy[];
    }
  | { readonly kind: "interrupted"; readonly reason?: string };

/**
 * A step a person can take after a turn failed. `tryAgain` sends the last
 * message again; `continue` asks the model to carry on from completed work.
 */
export type TurnRemedy =
  | "tryAgain"
  | "continue"
  | "updateApiKey"
  | "openSettings"
  | "chooseModel"
  | "chooseLargerModel"
  | "addCredits"
  | "editMessage";

export type WorkspaceTask = TaskContext & {
  readonly reasoning?: ReasoningSelection;
  readonly id: string;
  readonly title: string;
  /** Whether Zhiyin named it or the person did; a person's name is never replaced. */
  readonly titleSource: "generated" | "manual";
  /** ISO timestamp. */
  readonly updatedAt: string;
  readonly updatedLabel: string;
  readonly messages: readonly TaskMessage[];
  readonly guidance: readonly TaskGuidance[];
  /** The record of each model request: kept for audit, never sent to the window. */
  readonly modelResponses: readonly ModelResponseRecord[];
  /** What the model has been sent of this conversation, in order and as sent. */
  readonly modelHistory: readonly ModelHistoryEntry[];
  /**
   * The folder this conversation was last worked in. A conversation is about
   * the files it is about, so returning to it returns to them; a turn runs in
   * this folder whatever the window last displayed. Absent until a folder is
   * chosen for it.
   */
  readonly workspace?: { readonly path: string; readonly name: string };
  readonly actions: readonly TaskAction[];
  readonly conversationPermissions: readonly ConversationPermission[];
  readonly plan: readonly TaskPlanItem[];
  /** The standing instructions the model was last sent, by source. ADR 0012. */
  readonly standingInstructions: readonly StandingInstruction[];
  readonly artifacts: readonly TaskArtifact[];
  readonly specialistRuns: readonly SpecialistRun[];
  /**
   * Its commands running as jobs when it was last saved (ADR 0007). A job does
   * not outlive Zhiyin, so after a restart these were stopped, and the model
   * is told so.
   */
  readonly runningJobs: readonly {
    readonly id: string;
    readonly command: string;
  }[];
  readonly views: readonly TaskView[];
  readonly interactions: readonly TaskInteraction[];
  readonly phase: TaskPhase;
  /**
   * Plugin ids activated in this conversation, adding their skills,
   * specialists, and connectors to context from that point on. Empty means
   * nothing beyond the workspace tools is active.
   */
  readonly activatedPlugins: readonly string[];
  /** Turns whose file changes the person undid, keeping the conversation. */
  readonly undos: readonly TaskUndo[];
};

/**
 * Every list a conversation holds, each empty. A conversation always has all
 * of them, so a new one starts from these.
 */
export const emptyConversationLists = {
  guidance: [],
  modelResponses: [],
  modelHistory: [],
  actions: [],
  conversationPermissions: [],
  plan: [],
  standingInstructions: [],
  artifacts: [],
  specialistRuns: [],
  runningJobs: [],
  views: [],
  interactions: [],
  activatedPlugins: [],
  undos: [],
  condensings: [],
} as const satisfies Partial<WorkspaceTask>;
