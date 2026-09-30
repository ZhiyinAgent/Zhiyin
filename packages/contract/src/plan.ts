/**
 * The plan the working model keeps for a task, rewritten whole with each
 * update. It shows a person where the work stands; nothing judges it.
 * ADR 0063.
 */

export type PlanStatus = "pending" | "in_progress" | "done" | "skipped";

export type TaskPlanItem = {
  /** Its position, as `plan-1`, `plan-2`: stable for a list shown in order. */
  readonly id: string;
  readonly title: string;
  readonly status: PlanStatus;
};
