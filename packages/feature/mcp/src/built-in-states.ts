/** How the connections built in to Zhiyin are shown, apart from any conversation. */

import type { ConnectionTool, McpServerState } from "@zhiyin/contract";
import type { BuiltInDescriptions } from "./built-in-descriptions.js";
import type { Failure } from "./connection-problems.js";
import type { BuiltInMcpServer } from "./connection-types.js";

/**
 * Open connections and remembered failures, by connection key: a built-in's
 * id, or its id, a NUL and the conversation for one scoped to conversations.
 */
type Seen = {
  readonly connected: ReadonlyMap<
    string,
    { readonly tools: readonly ConnectionTool[] }
  >;
  readonly failures: ReadonlyMap<string, Failure>;
  readonly described: BuiltInDescriptions;
};

/**
 * A built-in's general state. One scoped to conversations speaks for itself,
 * since no single conversation's connection speaks for all of them.
 */
function builtInHealth(
  server: BuiltInMcpServer,
  { connected, failures, described }: Seen,
): {
  tools: readonly ConnectionTool[] | undefined;
  failure: Failure | undefined;
} {
  if (server.scope === "conversation" && server.describe)
    return described.health(server.id);
  const prefix = `${server.id}\0`;
  const open =
    connected.get(server.id) ??
    [...connected.entries()].find(([key]) => key.startsWith(prefix))?.[1];
  const failure =
    failures.get(server.id) ??
    [...failures.entries()].find(([key]) => key.startsWith(prefix))?.[1];
  return { tools: open?.tools, failure };
}

export function builtInStates(
  builtIns: readonly BuiltInMcpServer[],
  seen: Seen,
): McpServerState[] {
  return builtIns.map((server) => {
    const { tools, failure } = builtInHealth(server, seen);
    return {
      id: server.id,
      name: server.name,
      // It runs inside the application, so there is no address to show and
      // nothing leaves the machine on its account.
      url: "",
      enabled: true,
      builtIn: true,
      status: tools
        ? ("connected" as const)
        : (failure?.status ?? ("disconnected" as const)),
      toolCount: tools?.length ?? 0,
      tools:
        tools?.map(({ name, description }) => ({
          name,
          enabled: true,
          ...(description ? { description } : {}),
        })) ?? [],
      ...(failure ? { reason: failure.reason } : {}),
      credential: { status: "none" as const },
    };
  });
}
