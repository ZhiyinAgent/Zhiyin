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
  readonly guidance?: readonly TaskGuidance[];
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
  readonly conversationPermissions?: readonly ConversationPermission[];
  /** Optional so task history saved before explicit task plans existed can load. */
  readonly plan?: readonly TaskPlanItem[];
  /** The standing instructions the model was last sent, by source. ADR 0054. */
  readonly standingInstructions?: readonly StandingInstruction[];
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
