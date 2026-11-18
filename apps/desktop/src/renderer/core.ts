import { BRIDGE_KEY, type CoreApi } from "@zhiyin/contract";

declare global {
  interface Window {
    readonly [BRIDGE_KEY]: CoreApi;
  }
}

/** The only route by which the renderer reaches the core. */
export const core: CoreApi = window[BRIDGE_KEY];
