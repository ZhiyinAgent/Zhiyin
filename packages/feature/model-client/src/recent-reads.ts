/**
 * One account's reads of what its provider lists, shared for a short while.
 * The model picker and the description of the chosen model read the same
 * catalogue moments apart, as when a model is picked from the list just read:
 * one download answers both. A read with other headers, as with another key,
 * is its own. Only an answer that came back whole is shared; a read that
 * failed, or that the provider refused, is made again the next time.
 */

import type { CatalogFetch } from "./provider.js";

/** How long an answer is shared: long enough for a pick, not for a session. */
export const sharedForMs = 60_000;

type Kept = {
  readonly at: number;
  readonly status: number;
  /** The answer's body; nothing when it could not be read. */
  readonly body: Promise<{ readonly value: unknown } | undefined>;
};

export function recentReads(
  fetcher: CatalogFetch,
  now: () => number = Date.now,
): CatalogFetch {
  const kept = new Map<string, Kept>();
  return async (url, init) => {
    // A request that is not a plain read, as a key check posted, is never shared.
    if (init.method !== undefined) return fetcher(url, init);
    const at = now();
    for (const [key, read] of kept)
      if (at - read.at >= sharedForMs) kept.delete(key);
    const key = JSON.stringify([url, init.headers]);
    const earlier = kept.get(key);
    const shared = await earlier?.body;
    if (earlier && shared)
      return {
        ok: true,
        status: earlier.status,
        json: async () => shared.value,
      };
    const response = await fetcher(url, init);
    if (!response.ok) return response;
    const body = response.json();
    const read: Kept = {
      at,
      status: response.status,
      body: body.then(
        (value) => ({ value }),
        () => undefined,
      ),
    };
    kept.set(key, read);
    void read.body.then((whole) => {
      if (!whole && kept.get(key) === read) kept.delete(key);
    });
    return { ok: true, status: response.status, json: () => body };
  };
}
