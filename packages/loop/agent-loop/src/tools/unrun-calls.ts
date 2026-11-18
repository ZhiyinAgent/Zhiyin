/**
 * What becomes of a tool call that is not run: one the person declined, one
 * the policy blocked, and one that no longer matches what the person
 * approved. Each is refused to the model, saying why, and kept on the record
 * as it ended, inputs whole.
 */

import type {
  ToolCallInspection,
  ToolInvocationResult,
} from "@zhiyin/contract";
import type { TurnRecords } from "../turn/turn-records.js";
import type {
  AssembledToolCall,
  PresentedAction,
} from "../turn/turn-shared.js";
import type { ActionBackup } from "./action-backup.js";
import { refusal } from "./refusals.js";
import {
  approvalRecord,
  type decideToolPermission,
} from "./tool-permission.js";

/** What the permission decision for a call came to. */
export type Decided = Awaited<ReturnType<typeof decideToolPermission>>;

/** What every record of an action holds, whatever becomes of it. */
export type RecordedAction = {
  readonly inspection: Extract<ToolCallInspection, { readonly ok: true }>;
  readonly presentation: PresentedAction;
  readonly call: AssembledToolCall;
  readonly specialistRunId?: string;
  readonly readOnly: boolean;
};

/** What a call that is not run answers. */
type Unrun = {
  readonly result: ToolInvocationResult;
  readonly denied?: boolean;
  readonly fromPerson?: boolean;
};

/** What keeping an unrun call on the record uses. */
export type UnrunRecords = {
  readonly records: Pick<TurnRecords, "recordToolAction" | "progress">;
  readonly now: () => Date;
};

/**
 * A call the person declined, or the policy blocked: never run, and what
 * was asked for stays on the record.
 */
export async function declined(
  { records, now }: UnrunRecords,
  taskId: string,
  actionId: string,
  unrun: {
    readonly permission: Decided["permission"];
    readonly decision: Extract<Decided["decision"], { kind: "deny" }>;
    readonly backups: ActionBackup;
    readonly recorded: () => RecordedAction;
  },
): Promise<Unrun> {
  const { permission, decision } = unrun;
  await unrun.backups.discard();
  const userDenied = permission.outcome === "ask";
  const reason = userDenied
    ? decision.reason
      ? `The person declined this action: ${decision.reason}`
      : "The person declined this action."
    : permission.reason;
  const result = userDenied
    ? refusal(
        "person",
        reason,
        "Follow the person's guidance or choose another approach. Do not retry this action unchanged.",
      )
    : refusal(
        "permission",
        reason,
        "Choose an action permitted by the current policy.",
      );
  await recordUnrun(records, taskId, actionId, {
    ...unrun.recorded(),
    status: userDenied ? "denied" : "blocked",
    reason,
    approval: {
      by: userDenied ? "you" : "blocked",
      at: now().toISOString(),
      reason,
    },
  });
  return userDenied
    ? { result, denied: true, fromPerson: true }
    : { result, denied: false };
}

/**
 * An approved action that no longer matches what the person approved is
 * never run. The turn goes on: the model can look again and propose it anew,
 * which the person is asked about afresh (ADR 0007, ADR 0013).
 */
export async function notRun(
  { records, now }: UnrunRecords,
  taskId: string,
  actionId: string,
  reason: string,
  unrun: {
    readonly decided: Decided;
    readonly backups: ActionBackup;
    readonly recorded: () => RecordedAction;
  },
): Promise<Unrun> {
  const { decided } = unrun;
  await unrun.backups.discard();
  const result = refusal(
    "safety",
    reason,
    "Nothing was changed. Look at the target again and propose the change from what it holds now; the person will be asked again. If it cannot be reached, tell the person why.",
  );
  await recordUnrun(records, taskId, actionId, {
    ...unrun.recorded(),
    status: "failed",
    reason,
    approval: approvalRecord(
      decided.permission,
      decided.decision,
      decided.appliedRule,
      now().toISOString(),
    ),
  });
  return { result };
}

/**
 * An action that will not run kept on the record as it ended, and the
 * person's view of the turn's steps brought back.
 */
async function recordUnrun(
  records: UnrunRecords["records"],
  taskId: string,
  actionId: string,
  fields: Parameters<TurnRecords["recordToolAction"]>[2],
): Promise<void> {
  await records.recordToolAction(taskId, actionId, fields);
  await records.progress.working(
    taskId,
    undefined,
    records.progress.steps(taskId),
  );
}
