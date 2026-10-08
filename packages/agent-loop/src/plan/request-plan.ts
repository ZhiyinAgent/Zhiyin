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
import { describedWorkspace } from "../turn/turn-shared.js";
import { fixedModelMessages } from "../context/conversation-context.js";
import { delegateSpecialistTool } from "../specialist/specialist-execution.js";
import { activatePluginTool } from "../tools/plugin-activation.js";
import { ModelHistory } from "../context/model-history.js";
import { selfDescribing } from "../context/self-description.js";
import { updatePlanTool } from "./plan-progress.js";
import type { ContextGuard, RequestPlan } from "../context/context-guard.js";
import type { TurnRecords } from "../turn/turn-records.js";
import type { AgentLoopDependencies } from "../dependencies.js";

/** The places the next request can reuse unchanged from this one. */
function cacheBoundaries(
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
type Gathered = {
  readonly tools: readonly ToolSpec[];
  readonly specialists: Parameters<typeof delegateSpecialistTool>[0];
  readonly pluginDirectory: readonly { readonly activated: boolean }[];
};

export function advertisedTools(gathered: Gathered): readonly ToolSpec[] {
  return [...gathered.tools.map(selfDescribing), ...loopTools(gathered)];
}

/**
 * Every tool the model is offered, as its own spec: what a call is checked
 * against once the model has made it, whichever part of the loop answers it.
 */
export function offeredTools(gathered: Gathered): readonly ToolSpec[] {
  return [...gathered.tools, ...loopTools(gathered)];
}

/** The tools the loop answers itself. */
function loopTools(gathered: Gathered): readonly ToolSpec[] {
  return [
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
    activatedPlugins: records.task(taskId).activatedPlugins,
  });
  if (!gathered.ok) throw new VisibleError(gathered.reason);
  const { skills, pluginDirectory, tools } = gathered.value;
  const plan: RequestPlan = {
    fixed: fixedModelMessages(
      workspace,
      skills,
      pluginDirectory,
      deps.now(),
      tools,
    ),
    tools: advertisedTools(gathered.value),
  };
  const open = () => openTaskHistory(deps, records, taskId);
  await context.prepare(taskId, await open(), plan, open, signal);
}
