/**
 * Zhiyin's proxy for a program it runs outside any container on a sealed-off
 * run's behalf: the same hosts, refused and counted the same way, reached on
 * this computer's loopback for as long as that program runs.
 */

import type { ProxyRoute } from "./dial.js";
import { HostProxy, type FurtherHosts, type HostReach } from "./host-proxy.js";
import { hostEntries } from "./hosts.js";

export type LoopbackProxy = {
  /** Where the program is told the proxy is, such as `http://127.0.0.1:52011`. */
  readonly address: string;
  reached(): readonly HostReach[];
  further(): FurtherHosts | undefined;
  close(): Promise<void>;
};

/**
 * Opens a proxy passing only `hosts`, written as a confinement names them.
 * Throws, saying why, when the list cannot be given.
 */
export async function openLoopbackProxy(
  hosts: readonly string[],
  route?: ProxyRoute,
): Promise<LoopbackProxy> {
  const entries = hostEntries(hosts);
  if (typeof entries === "string") throw new Error(entries);
  const { proxy, port } = await HostProxy.onLoopback({
    hosts: entries,
    ...(route ? { route } : {}),
  });
  return {
    address: `http://127.0.0.1:${port}`,
    reached: () => proxy.reached(),
    further: () => proxy.further(),
    close: () => proxy.close(),
  };
}
