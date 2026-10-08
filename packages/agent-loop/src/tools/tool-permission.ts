import type {
  ActionApproval,
  ConversationPermission,
  ToolCallInspection,
  ToolOwner,
} from "@zhiyin/contract";
import type { Decision } from "@zhiyin/permission-engine";
import type { FileBackup } from "@zhiyin/rewind";
import type { AgentLoopDependencies } from "../dependencies.js";
import type { TurnRecords } from "../turn/turn-records.js";
import type { TurnWaits, ApprovalAnswer } from "../turn/turn-waits.js";
import type {
  AssembledToolCall,
  PresentedAction,
} from "../turn/turn-shared.js";
import {
  matchingPermission,
  offeredPermission,
} from "./conversation-permissions.js";

export function approvalRecord(
  permission: Decision,
  decision: ApprovalAnswer,
  rule: ConversationPermission | undefined,
  at: string,
): ActionApproval {
  if (rule)
    return {
      by: decision === "allow-conversation" ? "you" : "conversation-permission",
      at,
      permissionId: rule.id,
      label: rule.label,
    };
  if (permission.outcome === "allow")
    return { by: "no-approval-needed", at, reason: permission.reason };
  return { by: "you", at };
}

export async function decideToolPermission(options: {
  readonly deps: AgentLoopDependencies;
  readonly records: TurnRecords;
  readonly waits: TurnWaits;
  readonly taskId: string;
  readonly owner: ToolOwner;
  readonly call: AssembledToolCall;
  readonly args: unknown;
  readonly inspection: Extract<ToolCallInspection, { readonly ok: true }>;
  readonly presentation: PresentedAction;
  readonly backup?: FileBackup | undefined;
  readonly signal: AbortSignal;
  readonly labelled?:
    | Promise<
        { readonly title: string; readonly description: string } | undefined
      >
    | undefined;
}): Promise<{
  readonly decision: ApprovalAnswer;
  readonly permission: Awaited<
    ReturnType<AgentLoopDependencies["permissions"]["decide"]>
  >;
  readonly candidate?: Awaited<ReturnType<typeof offeredPermission>>;
  readonly appliedRule?: ConversationPermission;
}> {
  const { deps, records, waits, taskId, owner, call, args, inspection } =
    options;
  const permission = await deps.permissions.decide({
    kind: "tool",
    owner,
    name: call.name,
    arguments: args,
    action: inspection.action,
    target: inspection.target,
    command: inspection.command,
    ...(inspection.access ? { access: inspection.access } : {}),
    ...(inspection.scope ? { scope: inspection.scope } : {}),
  });
  options.signal.throwIfAborted();
  const root = deps.workspace.workspaceRoot();
  const candidate =
    permission.outcome === "ask"
      ? await offeredPermission(owner, call.name, inspection, root)
      : undefined;
  const appliedRule =
    permission.outcome === "ask"
      ? await matchingPermission(
          records.task(taskId).conversationPermissions,
          owner,
          call.name,
          inspection,
          root,
        )
      : undefined;
  const decision: ApprovalAnswer =
    permission.outcome === "ask" && !appliedRule
      ? await waits.waitForApproval(
          taskId,
          inspection,
          options.presentation,
          options.backup,
          options.signal,
          call,
          options.labelled,
          candidate,
        )
      : permission.outcome === "deny"
        ? { kind: "deny" }
        : "allow";
  return {
    decision,
    permission,
    ...(candidate ? { candidate } : {}),
    ...(appliedRule ? { appliedRule } : {}),
  };
}
