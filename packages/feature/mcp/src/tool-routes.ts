/**
 * Which connection each offered tool name goes to: every tool of an open
 * built-in, and every switched-on tool of an open, enabled connector.
 */

import type { ConnectionTool, McpServerDefinition } from "@zhiyin/contract";
import type { McpConnection } from "./connection-types.js";
import type { ConnectedServer } from "./connection-pool.js";
import type { OpenBuiltIn } from "./built-in-connections.js";
import { routedName } from "./action-title.js";
import { withheldReason } from "./schema-limit.js";

export type RoutedTool = {
  readonly server: McpServerDefinition;
  readonly tool: ConnectionTool;
  readonly connection: McpConnection;
  readonly connectionKey: string;
};

export function routeTools(
  builtIns: Iterable<OpenBuiltIn>,
  definitions: readonly McpServerDefinition[],
  open: ReadonlyMap<string, ConnectedServer>,
  excluded: ReadonlySet<string>,
): Map<string, RoutedTool> {
  const routes = new Map<string, RoutedTool>();
  const claimed = new Set<string>();
  // A name two tools would answer to routes to neither.
  const route = (name: string, value: RoutedTool) => {
    if (claimed.has(name)) routes.delete(name);
    else routes.set(name, value);
    claimed.add(name);
  };
  for (const { server, connectionKey, connected } of builtIns)
    for (const tool of connected.tools) {
      if (withheldReason(tool)) continue;
      route(routedName(server.id, tool.name), {
        server,
        tool,
        connection: connected.connection,
        connectionKey,
      });
    }
  for (const server of definitions) {
    if (excluded.has(server.id)) continue;
    const connected = open.get(server.id);
    if (!server.enabled || !connected) continue;
    const disabledTools = new Set(server.disabledTools ?? []);
    for (const tool of connected.tools) {
      if (disabledTools.has(tool.name) || withheldReason(tool)) continue;
      route(routedName(server.id, tool.name), {
        server,
        tool,
        connection: connected.connection,
        connectionKey: server.id,
      });
    }
  }
  return routes;
}
