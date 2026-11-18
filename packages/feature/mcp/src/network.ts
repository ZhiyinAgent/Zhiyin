import type { FetchLike } from "@modelcontextprotocol/client";

/**
 * How the feature goes online: a request in the standard `fetch` shape, handed
 * in by the composition root. In the app it is Chromium's, which reads
 * Windows' certificates and proxy settings (ADR 0004).
 */
export type Network = (url: string, init: RequestInit) => Promise<Response>;

/** Node's own, where no network is handed in: tests and runs outside the app. */
export const nodeNetwork: Network = (url, init) => fetch(url, init);

/** How long one sign-in or token request may take before it counts as failed. */
export const authRequestMs = 10_000;

/**
 * The network in the SDK's shape, each request ended once `limitMs` passes:
 * for the sign-in's discovery and token requests, which the SDK sends without
 * a limit of their own.
 */
export function limitedFetch(
  network: Network,
  limitMs = authRequestMs,
): FetchLike {
  return (url, init) => {
    const limit = AbortSignal.timeout(limitMs);
    const signal = init?.signal ? AbortSignal.any([init.signal, limit]) : limit;
    return network(String(url), { ...init, signal });
  };
}
