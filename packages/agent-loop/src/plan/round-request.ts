/**
 * One request to the conversation's model, as a turn and a specialist both
 * send it: its reasoning, its session, and where the provider may reuse what
 * it cached from the request before.
 */

import {
  offeredReasoning,
  type ReasoningCapabilities,
  type ReasoningSelection,
  type ToolSpec,
  type WorkspaceTask,
} from "@zhiyin/contract";
import type { ModelMessage } from "@zhiyin/model-client";

/**
 * The places the next request can reuse unchanged from this one: the fixed
 * start, the end of the request before, the end of this one, and the last
 * message before the oldest picture that can still go, which stays the same
 * when pictures after it are let go.
 */
function cacheBoundaries(
  previousLengths: Map<string, number>,
  taskId: string,
  fixed: number,
  length: number,
  beforePictures: number | undefined,
): number[] {
  const previous = previousLengths.get(taskId);
  previousLengths.set(taskId, length);
  return [
    ...new Set([
      fixed - 1,
      ...(beforePictures === undefined ? [] : [beforePictures]),
      ...(previous === undefined ? [] : [previous - 1]),
      length - 1,
    ]),
  ]
    .filter((index) => index >= 0 && index < length)
    .sort((left, right) => left - right);
}

/**
 * The conversation's reasoning as the chosen model can take it: a setting
 * saved with another model may name an effort this one does not offer.
 */
export function requestReasoning(
  task: WorkspaceTask,
  controls: ReasoningCapabilities | undefined,
): { readonly reasoning?: ReasoningSelection } {
  const reasoning = offeredReasoning(controls, task.reasoning);
  return reasoning ? { reasoning } : {};
}

/**
 * One round's request, with the unchanged start marked for provider caching.
 * `previousLengths` holds the length of the request before, for each sender
 * of requests that follow one another: one map per turn loop, and one per
 * specialist run, so neither moves the other's marks.
 */
export function modelRoundRequest(
  task: WorkspaceTask,
  controls: ReasoningCapabilities | undefined,
  messages: readonly ModelMessage[],
  tools: readonly ToolSpec[],
  fixedMessageCount: number,
  previousLengths: Map<string, number>,
  /** Where in the history the oldest picture that can still go is. */
  firstPictureThatCanGo?: number,
) {
  return {
    messages,
    tools,
    ...requestReasoning(task, controls),
    session: task.id,
    cacheAfter: cacheBoundaries(
      previousLengths,
      task.id,
      fixedMessageCount,
      messages.length,
      firstPictureThatCanGo === undefined
        ? undefined
        : fixedMessageCount + firstPictureThatCanGo - 1,
    ),
  };
}
