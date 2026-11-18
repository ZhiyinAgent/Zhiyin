import type {
  ActionApproval,
  ConversationPermission,
  ToolCallInspection,
  ToolOwner,
} from "@zhiyin/contract";
import type {
  Decision,
  FileOffer,
  PermissionScope,
} from "@zhiyin/permission-engine";
import type { FileBackup } from "@zhiyin/rewind";
import type { AgentLoopDependencies } from "../dependencies.js";
import type { TurnRecords } from "../turn/turn-records.js";
import type { TurnWaits, ApprovalAnswer } from "../turn/turn-waits.js";
import type {
  AssembledToolCall,
  PresentedAction,
} from "../turn/turn-shared.js";
import { contentDigest, fileStanding } from "./content-digest.js";
import {
  addressSeen,
  conversationFacts,
  outsideSource,
} from "./conversation-facts.js";

/** What deciding a call's permission uses. */
export type ToolPermissionDependencies = Pick<
  AgentLoopDependencies,
  "grants" | "permissions" | "workspace"
>;

export function approvalRecord(
  permission: Decision,
  decision: ApprovalAnswer,
  rule: ConversationPermission | undefined,
  at: string,
): ActionApproval {
  if (rule)
    return {
      by:
        decision === "allow-conversation" ||
        decision === "allow-file" ||
        decision === "allow-folder"
          ? "you"
          : "conversation-permission",
      at,
      permissionId: rule.id,
      label: rule.label,
    };
  if (permission.outcome === "allow")
    return { by: "no-approval-needed", at, reason: permission.reason };
  return { by: "you", at };
}

export async function decideToolPermission(options: {
  readonly deps: ToolPermissionDependencies;
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
  readonly candidate?: PermissionScope;
  /** The grants a change by Zhiyin's own file tools could be given: its file, or its folder. */
  readonly files?: FileOffer;
  readonly appliedRule?: ConversationPermission;
}> {
  const { deps, records, waits, taskId, owner, call, args, inspection } =
    options;
  const root = deps.workspace.workspaceRoot(taskId);
  const task = records.task(taskId);
  // A call is decided by what it says it does, with what the conversation
  // holds (ADR 0012); one that says nothing is decided as the worst it could
  // do. Whether it is asked every time is the engine's to apply, from the
  // tool's word.
  const effects = inspection.effects;
  const destination = effects?.destination;
  const permission = await deps.permissions.decide({
    kind: "tool",
    owner,
    name: call.name,
    arguments: args,
    action: inspection.action,
    target: inspection.target,
    command: inspection.command,
    ...(owner === "mcp" && inspection.builtInConnection
      ? { builtInConnection: true as const }
      : {}),
    ...(inspection.asksEachTime ? { asksEachTime: true as const } : {}),
    ...(owner === "mcp" && inspection.personSays
      ? { personSays: inspection.personSays }
      : {}),
    ...(effects
      ? {
          effects,
          ...(owner === "mcp" && inspection.effectsDeclaredByZhiyin
            ? { effectsDeclaredByZhiyin: true as const }
            : {}),
          conversation: await conversationFacts(task, root),
          // Only a send of the address alone is excused by the address
          // being known; anything else it carries is the model's.
          ...(destination &&
          effects.carries === "address" &&
          addressSeen(task, destination)
            ? { destinationSeen: true as const }
            : {}),
        }
      : {}),
  });
  options.signal.throwIfAborted();
  const {
    candidate,
    files,
    applied: appliedRule,
  } = await deps.grants.grants({
    owner,
    name: call.name,
    inspection,
    decision: permission,
    granted: task.conversationPermissions,
    digest: contentDigest,
    standing: fileStanding,
  });
  const decision: ApprovalAnswer =
    permission.outcome === "ask" && !appliedRule
      ? await waits.waitForApproval(taskId, {
          inspection,
          presentation: options.presentation,
          backup: options.backup,
          signal: options.signal,
          call,
          labelled: options.labelled,
          conversationRule: candidate,
          fileRules: files,
          ...(permission.why
            ? {
                why: {
                  code: permission.why,
                  ...(permission.parts ? { parts: permission.parts } : {}),
                  ...(permission.why === "outside-and-private" &&
                  outsideSource(task)
                    ? { outsideFrom: outsideSource(task)! }
                    : {}),
                },
              }
            : {}),
        })
      : permission.outcome === "deny"
        ? { kind: "deny" }
        : "allow";
  return {
    decision,
    permission,
    ...(candidate ? { candidate } : {}),
    ...(files ? { files } : {}),
    ...(appliedRule ? { appliedRule } : {}),
  };
}
