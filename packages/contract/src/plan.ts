/**
 * The plan a turn is judged on. Two voices write to each item and are kept
 * apart: the working model's progress, which is its claim, and the verdict,
 * which only the judge sets. ADRs 0052 and 0053.
 */

/** Where the working model says an item stands. */
export type PlanProgress = "pending" | "in_progress" | "done" | "cancelled";

/** A call the working model cites for an item, and what it says it shows. */
export type PlanEvidence = {
  readonly callId: string;
  readonly shows: string;
};

/** A step the working model keeps under an item, for its own tracking. */
export type PlanStep = {
  readonly text: string;
  readonly done: boolean;
};

export type TaskPlanItem = {
  readonly id: string;
  readonly title: string;
  readonly criterion: string;
  /**
   * The judge's side. `needs-attention` is "not verified": the judge found
   * something missing. `couldnt-judge` is the judge failing to answer, never
   * shown as either verdict. `active` is kept for plans saved before
   * `progress`.
   */
  readonly status:
    | "pending"
    | "active"
    | "checking"
    | "verified"
    | "needs-attention"
    | "couldnt-judge";
  /** The judge's reason for its verdict, or why it could not give one. */
  readonly verification?: string;
  /** The calls of the turn a verified verdict relied on. */
  readonly verdictEvidence?: readonly string[];
  /** The working model's side, absent until it reports on the item. */
  readonly progress?: PlanProgress;
  /** Why an item was cancelled, in the working model's words. */
  readonly progressNote?: string;
  /** The calls cited when the item was claimed done. */
  readonly evidence?: readonly PlanEvidence[];
  readonly steps?: readonly PlanStep[];
  /** Set on a criterion the working model added, rather than the planner. */
  readonly addedBy?: "assistant";
};
