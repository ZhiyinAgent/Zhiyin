/**
 * The app's built-in features, each offered to the model as a connection. Each
 * adapter says which automation answers and nothing more: what the automation
 * does is its own package's.
 */

import type { ConnectionTool, OfferedConnection } from "@zhiyin/contract";
import type { BuiltInMcpServer } from "@zhiyin/mcp";

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

/** A feature whose one automation serves every conversation. */
function shared(
  id: string,
  name: string,
  automation: OfferedConnection,
): BuiltInMcpServer {
  return {
    id,
    name,
    open: async () => automation,
    inspect: (tool, args) => automation.inspect(tool, args),
    describeResult: (tool, args, result) =>
      automation.describeResult(tool, args, result),
    produced: (tool, args, value) =>
      automation.produced?.(tool, args, value) ?? [],
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

/** The document compiler, one connection for every conversation. */
export function documentsConnection(
  automation: OfferedConnection,
): BuiltInMcpServer {
  return shared("documents", "Document compiler", automation);
}

/** The Python environment: one serves every conversation, as one installed program would. */
export function pythonConnection(
  automation: OfferedConnection,
): BuiltInMcpServer {
  return shared("python", "Python environment", automation);
}

/** Local git: nothing about it belongs to one conversation, so it has no `forget`. */
export function gitConnection(automation: OfferedConnection): BuiltInMcpServer {
  return shared("git", "Git", automation);
}
