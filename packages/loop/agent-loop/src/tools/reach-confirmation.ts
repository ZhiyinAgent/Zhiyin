/**
 * The cards around what sealed-off commands reach (ADR 0029): a request for
 * a website says what it lets out by the conversation's facts now; a request
 * the person allowed becomes a grant holding those facts; and the next
 * command that could reach a grant the conversation has outgrown first shows
 * one card naming every such grant, which keeps them or takes them back.
 */

import type { ToolCallInspection } from "@zhiyin/contract";
import type { AgentLoopDependencies } from "../dependencies.js";
import type { TurnRecords } from "../turn/turn-records.js";
import type { TurnWaits } from "../turn/turn-waits.js";
import { conversationFacts } from "./conversation-facts.js";
import {
  accessGrant,
  confirmationDetail,
  reachToConfirm,
  registriesAnswer,
  websiteDetail,
} from "./shell-reach.js";

type AllowedInspection = Extract<ToolCallInspection, { readonly ok: true }>;

export type ReachContext = {
  readonly deps: Pick<
    AgentLoopDependencies,
    "workspace" | "newApprovalId" | "now"
  >;
  readonly records: TurnRecords;
  readonly waits: TurnWaits;
};

async function factsNow(context: ReachContext, taskId: string) {
  const root = context.deps.workspace.workspaceRoot(taskId);
  return {
    root,
    facts: await conversationFacts(context.records.task(taskId), root),
  };
}

/** A request for a website, its card saying what it lets out now. */
export async function withGrantCard(
  context: ReachContext,
  taskId: string,
  inspection: AllowedInspection,
): Promise<AllowedInspection> {
  if (inspection.grants?.kind !== "website") return inspection;
  const { facts } = await factsNow(context, taskId);
  return {
    ...inspection,
    detail: websiteDetail(inspection.grants.label, facts),
  };
}

/** Keeps what a request the person allowed grants, with the facts its card stated. */
export async function keepAccessGrant(
  context: ReachContext,
  taskId: string,
  inspection: AllowedInspection,
): Promise<void> {
  if (!inspection.grants) return;
  const { root, facts } = await factsNow(context, taskId);
  await context.records.grants.grant(taskId, {
    ...accessGrant(inspection.grants, facts, root),
    id: context.deps.newApprovalId(),
    at: context.deps.now().toISOString(),
  });
}

/**
 * Before a sealed-off command: confirms each grant it could reach whose
 * facts the conversation has outgrown, and the package registries once
 * outside content and something private meet. Says whether what it reaches
 * changed, so the command is looked at again.
 */
export async function confirmedReach(
  context: ReachContext,
  taskId: string,
  inspection: AllowedInspection,
  signal: AbortSignal,
): Promise<"unchanged" | "confirmed" | "changed" | "cancelled"> {
  if (!inspection.reachesGrants) return "unchanged";
  const { root, facts } = await factsNow(context, taskId);
  const task = context.records.task(taskId);
  const confirm = reachToConfirm(task, root, facts);
  if (!confirm) return "unchanged";
  const { places, since } = confirmationDetail(confirm, facts);
  const title =
    places.length === 1
      ? "Keep letting commands reach this?"
      : "Keep letting commands reach these?";
  const target = places.map((place) => place.label).join("; ");
  const answer = await context.waits.waitForApproval(taskId, {
    inspection: {
      ok: true,
      action: title,
      target,
      detail: since,
      asksEachTime: true,
      command: `confirm reach: ${target}`,
    },
    presentation: { title, description: since },
    signal,
    reach: { kind: "confirm", places, since },
  });
  if (answer === "cancelled") return "cancelled";
  const declined = typeof answer === "object";
  const stated = {
    outsideContent: facts.outsideContent,
    privateWithinReach: facts.privateWithinReach,
  };
  for (const grant of confirm.grants)
    if (declined) await context.records.grants.revoke(taskId, grant.id);
    else
      await context.records.grants.update(taskId, { ...grant, facts: stated });
  if (confirm.registries) {
    const earlier = context.records
      .task(taskId)
      .conversationPermissions.find(
        (permission) => permission.kind === "reach-registries",
      );
    const answered = {
      ...registriesAnswer(facts, declined),
      id: earlier?.id ?? context.deps.newApprovalId(),
      at: context.deps.now().toISOString(),
    };
    if (earlier) await context.records.grants.update(taskId, answered);
    else await context.records.grants.grant(taskId, answered);
  }
  return declined ? "changed" : "confirmed";
}
