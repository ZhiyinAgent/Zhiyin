/**
 * The network of one confined run that names hosts: the proxy on a pipe its
 * container alone may open, and the relay in the container, started before
 * the program, which is then told to use it.
 */

import { readFile } from "node:fs/promises";
import { networkOf, type Confined } from "../confinement.js";
import { windowsEnvironment } from "../windows-environment.js";
import type { ProcessContainer } from "../windows.js";
import type { ProxyRoute } from "./dial.js";
import { HostProxy, type FurtherHosts, type HostReach } from "./host-proxy.js";
import { relayStart } from "./relay.js";

export type RunNetwork = {
  /** The program's environment, told to reach the network through the relay. */
  environment(
    given: Readonly<Record<string, string | undefined>>,
  ): Record<string, string | undefined>;
  reached(): readonly HostReach[];
  further(): FurtherHosts | undefined;
  close(): Promise<void>;
};

const relayStartMs = 20_000;
const proxyVariables = new Set([
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
]);

/** An environment that names no proxy, for a program that can reach none. */
export function withoutProxies(
  given: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(given).filter(
      ([name]) => !proxyVariables.has(name.toUpperCase()),
    ),
  );
}

/** Whether a confined run names hosts, and so needs a network of its own. */
export function namesHosts(
  confined: Confined | undefined,
): confined is Confined {
  return confined !== undefined && networkOf(confined).hosts.length > 0;
}

/**
 * Starts the proxy and the relay in `container`. Throws, saying why, when the
 * relay does not start; nothing is left listening then.
 */
export async function startRunNetwork(
  container: ProcessContainer,
  confined: Confined,
  route: ProxyRoute | undefined,
  relayOutput: { readonly stdout: string; readonly stderr: string },
): Promise<RunNetwork> {
  const { container: sid, home, hosts } = networkOf(confined);
  const proxy = await HostProxy.open({
    container: sid,
    hosts,
    ...(route ? { route } : {}),
  });
  try {
    const relay = relayStart(proxy.pipe);
    const child = container.launch({
      executable: relay.executable,
      arguments: relay.arguments,
      cwd: home,
      stdout: relayOutput.stdout,
      stderr: relayOutput.stderr,
      environment: windowsEnvironment(),
      confined,
    });
    let timer: NodeJS.Timeout | undefined;
    const port = await Promise.race([
      proxy.relayPort(),
      child.wait().then(() => undefined),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), relayStartMs);
      }),
    ]).finally(() => clearTimeout(timer));
    if (port === undefined) {
      const said = await readFile(relayOutput.stderr, "utf8").catch(() => "");
      throw new Error(
        `Zhiyin's network relay did not start in the program's container.${said.trim() ? ` It said: ${said.trim().slice(-400)}` : ""}`,
      );
    }
    const address = `http://127.0.0.1:${port}`;
    return {
      environment: (given) => ({
        ...withoutProxies(given),
        HTTPS_PROXY: address,
        HTTP_PROXY: address,
      }),
      reached: () => proxy.reached(),
      further: () => proxy.further(),
      close: () => proxy.close(),
    };
  } catch (error) {
    await proxy.close();
    throw error;
  }
}
