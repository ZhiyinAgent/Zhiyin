/**
 * What every request to the conversation's model is built from, whether a turn
 * sends it or a condensing the person asked for between turns: the tools
 * offered and the history as saved. Built one way, so a condensing between
 * turns repeats the start the provider cached for the turn before it.
 */

import { VisibleError, type ToolSpec } from "@zhiyin/contract";
import { describedWorkspace } from "./turn-shared.js";
import { fixedModelMessages } from "./conversation-context.js";
import { delegateSpecialistTool } from "./specialist-execution.js";
import { activatePluginTool } from "./plugin-activation.js";
import { ModelHistory } from "./model-history.js";
import type { ContextGuard, RequestPlan } from "./context-guard.js";
import type { TurnRecords } from "./turn-records.js";
import type { AgentLoopDependencies } from "./dependencies.js";

/** The tools a request offers: the gathered ones, and how to reach more. */
export function advertisedTools(gathered: {
  readonly tools: readonly ToolSpec[];
  readonly specialists: Parameters<typeof delegateSpecialistTool>[0];
  readonly pluginDirectory: readonly { readonly activated: boolean }[];
}): readonly ToolSpec[] {
  return [
    ...gathered.tools,
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
