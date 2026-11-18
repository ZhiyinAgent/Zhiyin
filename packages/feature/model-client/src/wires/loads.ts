/**
 * Where the tools a conversation opened join it (ADR 0017): right after the
 * message each load names, past any results of the same round that follow it,
 * since a round's results go directly after its calls. Nothing before that
 * place changes, so what the provider cached before it still matches.
 */

import type { ModelMessage, ModelRequest, ModelTool } from "../model-client.js";

/**
 * Each message's items, with each load's items after the place it joins at.
 * `ordinal` counts the loads from one, in the order they were opened, so a
 * load is sent the same way on every request.
 */
export function withLoads<Item>(
  messages: readonly ModelMessage[],
  itemsOf: (message: ModelMessage, index: number) => readonly Item[],
  loads: ModelRequest["loads"],
  loaded: (tools: readonly ModelTool[], ordinal: number) => readonly Item[],
): Item[] {
  const joining = new Map<number, Item[]>();
  (loads ?? []).forEach((load, index) => {
    if (load.after < 0 || load.after >= messages.length) return;
    let place = load.after;
    while (messages[place + 1]?.role === "tool") place += 1;
    joining.set(place, [
      ...(joining.get(place) ?? []),
      ...loaded(load.tools, index + 1),
    ]);
  });
  return messages.flatMap((message, index) => [
    ...itemsOf(message, index),
    ...(joining.get(index) ?? []),
  ]);
}
