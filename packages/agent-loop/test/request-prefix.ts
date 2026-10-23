/**
 * Where consecutive requests stop repeating each other.
 *
 * A provider that caches a request's start reuses it only while the next
 * request begins with the same bytes. Each place a request fails to start with
 * the whole of the one before it is a cache miss from that message on, so a
 * test lists them and says which it expects and why.
 */

import type { ModelMessage } from "@zhiyin/model-client";

/** How many of `previous`'s messages `next` repeats, byte for byte, from the start. */
export function sharedPrefix(
  previous: readonly ModelMessage[],
  next: readonly ModelMessage[],
): number {
  let index = 0;
  while (
    index < previous.length &&
    index < next.length &&
    JSON.stringify(previous[index]) === JSON.stringify(next[index])
  )
    index += 1;
  return index;
}

export type PrefixBreak = {
  /** The request that did not start with the whole of the one before it. */
  readonly request: number;
  /** The first message of the one before it that it did not repeat. */
  readonly at: number;
};

/** Every request that does not start with the whole of the request before it. */
export function prefixBreaks(
  requests: readonly (readonly ModelMessage[])[],
): PrefixBreak[] {
  const breaks: PrefixBreak[] = [];
  for (let request = 1; request < requests.length; request += 1) {
    const previous = requests[request - 1] ?? [];
    const at = sharedPrefix(previous, requests[request] ?? []);
    if (at < previous.length) breaks.push({ request, at });
  }
  return breaks;
}
