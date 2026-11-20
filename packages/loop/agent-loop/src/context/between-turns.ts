/**
 * A condensing the person asks for between turns. It condenses from the
 * request the next turn would start with, built by the same offering a turn
 * builds, so it repeats the start the provider cached for the turn before it.
 */

import { VisibleError } from "@zhiyin/contract";
import type { ModelMessage } from "@zhiyin/model-client";
import type { AgentLoopDependencies } from "../dependencies.js";
import {
  openTaskHistory,
  type HistoryDependencies,
} from "../request/request-plan.js";
import type { OfferingStart, TurnOffering } from "../turn/turn-offering.js";
import type { TurnRecords } from "../turn/turn-records.js";
import { describedWorkspace } from "../turn/turn-shared.js";
import type { ContextGuard } from "./context-guard.js";

/** What condensing between turns uses. */
export type BetweenTurnsDependencies = Pick<
  AgentLoopDependencies,
  "capabilities" | "host" | "now" | "timeZone" | "workspace"
> &
  HistoryDependencies;

export async function condenseBetweenTurns(
  deps: BetweenTurnsDependencies,
  records: TurnRecords,
  context: ContextGuard,
  taskId: string,
  signal: AbortSignal,
  /** What a turn would offer, made as a turn makes it. */
  offering: (
    taskId: string,
    start: OfferingStart,
    conversation: () => readonly ModelMessage[],
  ) => Promise<TurnOffering>,
): Promise<void> {
  const workspace = await describedWorkspace(deps.workspace, taskId);
  const { activatedPlugins } = records.task(taskId);
  const gathered = await deps.capabilities.toolsFor(taskId, {
    skills: deps.host.capabilitiesAvailable(),
    activatedPlugins,
  });
  if (!gathered.ok) throw new VisibleError(gathered.reason);
  const open = () => openTaskHistory(deps, records, taskId);
  const history = await open();
  const offer = await offering(
    taskId,
    {
      workspace,
      startedAt: deps.now(),
      timeZone: deps.timeZone,
      gathered: gathered.value,
      activatedPlugins,
      route: deps.host.toolLoading(),
      readiness: records.task(taskId).readinessSent,
    },
    () => history.messages(),
  );
  const plan = {
    fixed: offer.fixedMessages,
    tools: offer.advertised(),
    loads: (messages: readonly ModelMessage[]) => offer.loads(messages),
  };
  await context.prepare(taskId, history, plan, open, signal);
}
