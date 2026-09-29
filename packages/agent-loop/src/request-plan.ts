/**
 * What every request to the conversation's model is built from, whether a turn
 * sends it or a condensing the person asked for between turns: the tools
 * offered and the history as saved. Built one way, so a condensing between
 * turns repeats the start the provider cached for the turn before it.
 */

import {
  VisibleError,
  type ToolSpec,
  type WorkspaceTask,
} from "@zhiyin/contract";
import type { ModelMessage } from "@zhiyin/model-client";
import { describedWorkspace } from "./turn-shared.js";
import { fixedModelMessages } from "./conversation-context.js";
import { delegateSpecialistTool } from "./specialist-execution.js";
import { activatePluginTool } from "./plugin-activation.js";
import { ModelHistory } from "./model-history.js";
import { selfDescribing } from "./self-description.js";
import { updatePlanTool } from "./plan-progress.js";
import type { ContextGuard, RequestPlan } from "./context-guard.js";
import type { TurnRecords } from "./turn-records.js";
import type { AgentLoopDependencies } from "./dependencies.js";

/** The places the next request can reuse unchanged from this one. */
export function cacheBoundaries(
  previousLengths: Map<string, number>,
  taskId: string,
  fixed: number,
  length: number,
): number[] {
  const previous = previousLengths.get(taskId);
  previousLengths.set(taskId, length);
  return [
    ...new Set([
      fixed - 1,
      ...(previous === undefined ? [] : [previous - 1]),
      length - 1,
    ]),
  ]
    .filter((index) => index >= 0 && index < length)
    .sort((left, right) => left - right);
}

/** One round's request, with the unchanged start marked for provider caching. */
export function modelRoundRequest(
  task: WorkspaceTask,
  messages: readonly ModelMessage[],
  tools: readonly ToolSpec[],
  fixedMessageCount: number,
  previousLengths: Map<string, number>,
) {
  return {
    messages,
    tools,
    ...(task.reasoning ? { reasoning: task.reasoning } : {}),
    session: task.id,
    cacheAfter: cacheBoundaries(
      previousLengths,
      task.id,
      fixedMessageCount,
      messages.length,
    ),
  };
}

/**
 * The tools a request offers: the gathered ones, each able to say what a call
 * is for, the plan's own tool, and how to reach more.
 */
export function advertisedTools(gathered: {
  readonly tools: readonly ToolSpec[];
  readonly specialists: Parameters<typeof delegateSpecialistTool>[0];
  readonly pluginDirectory: readonly { readonly activated: boolean }[];
}): readonly ToolSpec[] {
  return [
    ...gathered.tools.map(selfDescribing),
    updatePlanTool,
    ...(gathered.specialists.length
      ? [delegateSpecialistTool(gathered.specialists)]
      : []),
    ...(gathered.pluginDirectory.some((entry) => !entry.activated)
      ? [activatePluginTool]
      : []),
  ];
}

/** The conversation's history as saved, saving back every change to it. */
export function openTaskHistory(
  deps: AgentLoopDependencies,
  records: TurnRecords,
  taskId: string,
): Promise<ModelHistory> {
  return ModelHistory.open(records.task(taskId), {
    newId: () => deps.newMessageId(),
    readPicture: (source) => deps.sessions.readPicture(source),
    save: async (modelHistory) => {
      await records.replaceTask({ ...records.task(taskId), modelHistory });
    },
  });
}

/**
 * Condenses the conversation between turns, from the request its next turn
 * would start with.
 */
export async function condenseBetweenTurns(
  deps: AgentLoopDependencies,
  records: TurnRecords,
  context: ContextGuard,
  taskId: string,
  signal: AbortSignal,
): Promise<void> {
  const workspace = await describedWorkspace(deps.workspace);
  const gathered = await deps.capabilities.toolsFor(taskId, {
    skills: deps.host.capabilitiesAvailable(),
    activatedPlugins: records.task(taskId).activatedPlugins ?? [],
  });
  if (!gathered.ok) throw new VisibleError(gathered.reason);
  const { skills, pluginDirectory } = gathered.value;
  const plan: RequestPlan = {
    fixed: fixedModelMessages(workspace, skills, pluginDirectory, deps.now()),
    tools: advertisedTools(gathered.value),
  };
  const open = () => openTaskHistory(deps, records, taskId);
  await context.prepare(taskId, await open(), plan, open, signal);
}
