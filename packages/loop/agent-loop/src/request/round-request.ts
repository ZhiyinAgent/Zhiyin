/**
 * One request to the conversation's model, as a turn and a specialist both
 * send it: its reasoning, its session, and where the provider may reuse what
 * it cached from the request before.
 */

import {
  type ReasoningCapabilities,
  type ReasoningSelection,
  type ToolSpec,
  type WorkspaceTask,
} from "@zhiyin/contract";
import { offeredReasoning } from "@zhiyin/conversation-rules";
import type { ModelMessage } from "@zhiyin/model-client";

/** What a sender's last request was, for what its next one can reuse. */
export type RequestBefore = {
  /** How many messages it held. */
  readonly length: number;
  /** The last message before the oldest picture that could still go. */
  readonly beforePictures?: number;
};

/**
 * The places the next request can reuse unchanged from this one: the fixed
 * start, the end of the request before, the end of this one, and the last
 * message before the oldest picture that can still go, which stays the same
 * when pictures after it are let go.
 *
 * A provider reads a cached start only where a request marks it, or a few
 * blocks after. When pictures were let go since the request before, its end
 * no longer matches, and what still does is the place it marked before the
 * pictures: this request marks that place instead, so everything up to it is
 * read rather than sent anew.
 */
function cacheBoundaries(
  requestsBefore: Map<string, RequestBefore>,
  taskId: string,
  fixed: number,
  length: number,
  beforePictures: number | undefined,
): number[] {
  const previous = requestsBefore.get(taskId);
  requestsBefore.set(taskId, {
    length,
    ...(beforePictures === undefined ? {} : { beforePictures }),
  });
  const letGo =
    previous?.beforePictures !== undefined &&
    beforePictures !== previous.beforePictures;
  const unchangedFromBefore = letGo
    ? previous.beforePictures
    : previous === undefined
      ? undefined
      : previous.length - 1;
  return [
    ...new Set([
      fixed - 1,
      ...(beforePictures === undefined ? [] : [beforePictures]),
      ...(unchangedFromBefore === undefined ? [] : [unchangedFromBefore]),
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
 * `requestsBefore` holds the request before, for each sender of requests that
 * follow one another: one map per turn loop, and one per specialist run, so
 * neither moves the other's marks.
 */
export function modelRoundRequest(
  task: WorkspaceTask,
  controls: ReasoningCapabilities | undefined,
  messages: readonly ModelMessage[],
  tools: readonly ToolSpec[],
  fixedMessageCount: number,
  requestsBefore: Map<string, RequestBefore>,
  /** Where in the history the oldest picture that can still go is. */
  firstPictureThatCanGo?: number,
) {
  return {
    messages,
    tools,
    ...requestReasoning(task, controls),
    session: task.id,
    cacheAfter: cacheBoundaries(
      requestsBefore,
      task.id,
      fixedMessageCount,
      messages.length,
      firstPictureThatCanGo === undefined
        ? undefined
        : fixedMessageCount + firstPictureThatCanGo - 1,
    ),
  };
}
