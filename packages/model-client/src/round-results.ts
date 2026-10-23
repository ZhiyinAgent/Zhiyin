/**
 * Every format wants the results of a round of calls directly after the calls:
 * Chat Completions refuses a request where anything else comes between them,
 * and Anthropic wants them ahead of anything else in the next turn. What a
 * call made beyond its result, a picture, is told after the result, so a round
 * whose first call made a picture is kept with the picture between two
 * results. It is sent with the round's results first and everything else after
 * them, each in the order it was kept, which also mends a conversation stored
 * that way before.
 */

import type { ModelMessage } from "./model-client.js";

export type OrderedConversation = {
  readonly messages: readonly ModelMessage[];
  /** The same messages named as before, at their places in the new order. */
  readonly cacheAfter?: readonly number[];
};

/** Where each message goes: the place in `messages` of each one sent, in order. */
function order(messages: readonly ModelMessage[]): number[] {
  const sent: number[] = [];
  let index = 0;
  while (index < messages.length) {
    const message = messages[index] as ModelMessage;
    sent.push(index);
    index += 1;
    if (message.role !== "assistant" || !message.toolCalls?.length) continue;
    // The round runs until the model speaks again.
    const calls = new Set(message.toolCalls.map((call) => call.id));
    const results: number[] = [];
    const rest: number[] = [];
    while (index < messages.length && messages[index]?.role !== "assistant") {
      const next = messages[index] as ModelMessage;
      (next.role === "tool" && calls.has(next.toolCallId)
        ? results
        : rest
      ).push(index);
      index += 1;
    }
    sent.push(...results, ...rest);
  }
  return sent;
}

export function resultsAfterTheirCalls(
  messages: readonly ModelMessage[],
  cacheAfter?: readonly number[],
): OrderedConversation {
  const sent = order(messages);
  const placeOf = new Map(sent.map((original, place) => [original, place]));
  return {
    messages: sent.map((original) => messages[original] as ModelMessage),
    ...(cacheAfter
      ? {
          cacheAfter: cacheAfter.flatMap((original) => {
            const place = placeOf.get(original);
            return place === undefined ? [] : [place];
          }),
        }
      : {}),
  };
}
