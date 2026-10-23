/**
 * How every request reaches a lab. A redirect is refused, not followed: a key
 * in a header of the lab's own naming, such as Xiaomi's `api-key`, would go
 * with the request to whatever host the redirect names.
 */

import type { CatalogFetch } from "./provider.js";

/**
 * How the feature goes online: a request in the standard `fetch` shape, handed
 * in by the composition root. In the app it is Chromium's, which reads
 * Windows' certificates and proxy settings (ADR 0004).
 */
export type Network = (url: string, init: RequestInit) => Promise<Response>;

/** Node's own, where no network is handed in: tests and runs outside the app. */
export const nodeNetwork: Network = (url, init) => fetch(url, init);

export function keyedFetch(
  url: string,
  init: RequestInit,
  network: Network = nodeNetwork,
): Promise<Response> {
  return network(url, { ...init, redirect: "error" });
}

/** A key check or a listing over `network`, given fifteen seconds. */
export function catalogFetchOver(network: Network = nodeNetwork): CatalogFetch {
  return (url, init) =>
    keyedFetch(
      url,
      {
        headers: init.headers,
        ...(init.method ? { method: init.method } : {}),
        ...(init.body === undefined ? {} : { body: init.body }),
        signal: AbortSignal.timeout(15_000),
      },
      network,
    );
}

export const catalogFetch: CatalogFetch = catalogFetchOver();
