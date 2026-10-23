/**
 * How the feature goes online: a request in the standard `fetch` shape, handed
 * in by the composition root. In the app it is Chromium's, which reads
 * Windows' certificates and proxy settings (ADR 0004).
 */
export type Network = (url: string, init: RequestInit) => Promise<Response>;

/** Node's own, where no network is handed in: tests and runs outside the app. */
export const nodeNetwork: Network = (url, init) => fetch(url, init);
