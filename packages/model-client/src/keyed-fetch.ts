/**
 * How every request that carries a key reaches a lab. A redirect is refused,
 * not followed: a key in a header of the lab's own naming, such as Xiaomi's
 * `api-key`, would go with the request to whatever host the redirect names.
 */

import type { CatalogFetch } from "./provider.js";

export function keyedFetch(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, { ...init, redirect: "error" });
}

/** A key check or a listing, given fifteen seconds. */
export const catalogFetch: CatalogFetch = (url, init) =>
  keyedFetch(url, {
    headers: init.headers,
    ...(init.method ? { method: init.method } : {}),
    ...(init.body === undefined ? {} : { body: init.body }),
    signal: AbortSignal.timeout(15_000),
  });
