/**
 * The app's built-in features, each offered to the model as a connection. Each
 * adapter says which automation answers and nothing more: what the automation
 * does is its own package's.
 */

import type { ConnectionTool, OfferedConnection } from "@zhiyin/contract";
import type { BuiltInMcpServer } from "@zhiyin/mcp";
import type {
  ConnectionSetup,
  ConnectionSetups,
  ConnectionToolchains,
} from "./capabilities.js";

/**
 * A feature that keeps one automation for each conversation, opened on first
 * use and kept until the conversation is forgotten, so no conversation reaches
 * another's. What it offers, and whether it can work here, is described
 * without opening any conversation's.
 */
function perConversation(
  id: string,
  name: string,
  openAutomation: (conversationId: string) => OfferedConnection,
  describe: () => Promise<readonly ConnectionTool[]>,
): BuiltInMcpServer {
  const automations = new Map<string, OfferedConnection>();
  const automationFor = (conversationId: string): OfferedConnection => {
    const existing = automations.get(conversationId);
    if (existing) return existing;
    const created = openAutomation(conversationId);
    automations.set(conversationId, created);
    return created;
  };
  return {
    id,
    name,
    scope: "conversation",
    describe,
    open: async (conversationId) => {
      if (!conversationId) throw new Error("A conversation is required.");
      return automationFor(conversationId);
    },
    inspect: async (tool, args, conversationId) => {
      if (!conversationId)
        return { ok: false, reason: "A conversation is required." };
      return automationFor(conversationId).inspect(tool, args);
    },
    describeResult: (tool, args, result, conversationId) =>
      conversationId
        ? automationFor(conversationId).describeResult(tool, args, result)
        : [],
    produced: (tool, args, value, conversationId) =>
      conversationId
        ? (automationFor(conversationId).produced?.(tool, args, value) ?? [])
        : [],
    forget: async (conversationId) => {
      automations.delete(conversationId);
    },
  };
}

/** The app's own browser: each conversation drives its own page. */
export function browserConnection(
  openAutomation: (conversationId: string) => OfferedConnection,
  describe: () => Promise<readonly ConnectionTool[]>,
): BuiltInMcpServer {
  return perConversation(
    "browser",
    "Zhiyin’s browser",
    openAutomation,
    describe,
  );
}

/** The 3D studio: each conversation has its own Blender and its own scene. */
export function sceneConnection(
  openAutomation: (conversationId: string) => OfferedConnection,
  describe: () => Promise<readonly ConnectionTool[]>,
): BuiltInMcpServer {
  return perConversation("blender", "3D studio", openAutomation, describe);
}

/**
 * The CAD studio: each conversation builds parts in its own folder, from one
 * CAD environment Zhiyin keeps (ADR 0023).
 */
export function cadConnection(
  openAutomation: (conversationId: string) => OfferedConnection,
  describe: () => Promise<readonly ConnectionTool[]>,
): BuiltInMcpServer {
  return perConversation("cad", "CAD studio", openAutomation, describe);
}

/**
 * The document compiler: each conversation compiles in its own folder, from
 * one compiler and its one package cache (ADR 0008).
 */
export function documentsConnection(
  openAutomation: (conversationId: string) => OfferedConnection,
  describe: () => Promise<readonly ConnectionTool[]>,
): BuiltInMcpServer {
  return perConversation(
    "documents",
    "Document compiler",
    openAutomation,
    describe,
  );
}

/**
 * The Python environment: each conversation runs scripts in its own folder,
 * from one set of environments (ADR 0008).
 */
export function pythonConnection(
  openAutomation: (conversationId: string) => OfferedConnection,
  describe: () => Promise<readonly ConnectionTool[]>,
): BuiltInMcpServer {
  return perConversation(
    "python",
    "Python environment",
    openAutomation,
    describe,
  );
}

/** Local git: each conversation works on the repository in its own folder. */
export function gitConnection(
  openAutomation: (conversationId: string) => OfferedConnection,
  describe: () => Promise<readonly ConnectionTool[]>,
): BuiltInMcpServer {
  return perConversation("git", "Git", openAutomation, describe);
}

/** What an application connection needs before it can run. */
export type ConnectionNeeds = {
  /** The programs installed for it, by toolchain id. */
  readonly programs?: readonly string[];
  /** What is made with them as it is installed. */
  readonly setup?: ConnectionSetup;
};

/** A connection with what it needs before it can run. */
export type NeedingConnection = {
  readonly server: BuiltInMcpServer;
  readonly needs: ConnectionNeeds;
};

/** A connection that runs only once its programs are installed. */
export function needing(
  server: BuiltInMcpServer,
  needs: ConnectionNeeds,
): NeedingConnection {
  return { server, needs };
}

/**
 * The application's connections, and what each needs by its id, as the
 * capabilities take them.
 */
export function joinedConnections(
  connections: readonly (BuiltInMcpServer | NeedingConnection)[],
): {
  readonly builtIns: readonly BuiltInMcpServer[];
  readonly toolchains: ConnectionToolchains;
  readonly setups: ConnectionSetups;
} {
  const toolchains: Record<string, readonly string[]> = {};
  const setups: Record<string, ConnectionSetup> = {};
  const builtIns = connections.map((connection) => {
    if (!("needs" in connection)) return connection;
    const { server, needs } = connection;
    if (needs.programs?.length) toolchains[server.id] = needs.programs;
    if (needs.setup) setups[server.id] = needs.setup;
    return server;
  });
  return { builtIns, toolchains, setups };
}
