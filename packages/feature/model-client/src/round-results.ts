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

import type { ModelMessage, ModelRequest } from "./model-client.js";

export type OrderedConversation = {
  readonly messages: readonly ModelMessage[];
  /** The same messages named as before, at their places in the new order. */
  readonly cacheAfter?: readonly number[];
  readonly callable?: NonNullable<ModelRequest["callable"]>;
  readonly loads?: NonNullable<ModelRequest["loads"]>;
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
  callable?: ModelRequest["callable"],
  loads?: ModelRequest["loads"],
): OrderedConversation {
  const sent = order(messages);
  const placeOf = new Map(sent.map((original, place) => [original, place]));
  const after = callable && placeOf.get(callable.after);
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
    ...(callable && after !== undefined
      ? { callable: { ...callable, after } }
      : {}),
    ...(loads
      ? {
          loads: loads.flatMap((load) => {
            const place = placeOf.get(load.after);
            return place === undefined ? [] : [{ ...load, after: place }];
          }),
        }
      : {}),
  };
}
