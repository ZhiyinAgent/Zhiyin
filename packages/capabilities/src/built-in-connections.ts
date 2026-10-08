/**
 * The app's built-in features, each offered to the model as a connection. Each
 * adapter says which automation answers and nothing more: what the automation
 * does is its own package's.
 */

import type {
  AutomationTool,
  BrowserAutomation,
} from "@zhiyin/interactive-browser";
import type { GitAutomation } from "@zhiyin/git-connector";
import type { CompilerAutomation } from "@zhiyin/document-compiler";
import type { SandboxAutomation } from "@zhiyin/python-sandbox";
import type { BuiltInMcpServer } from "@zhiyin/mcp";

/**
 * The app's own browser, offered to the model as a built-in connection. Each
 * conversation gets its own automation, opened on first use and kept until the
 * conversation is forgotten, so no conversation drives another's page. Its
 * general state — what it offers, and whether it can work here — is described
 * without opening any conversation's browser.
 */
export function browserConnection(
  openAutomation: (conversationId: string) => BrowserAutomation,
  describe: () => Promise<readonly AutomationTool[]>,
): BuiltInMcpServer {
  const automations = new Map<string, BrowserAutomation>();
  const automationFor = (conversationId: string): BrowserAutomation => {
    const existing = automations.get(conversationId);
    if (existing) return existing;
    const created = openAutomation(conversationId);
    automations.set(conversationId, created);
    return created;
  };
  return {
    id: "browser",
    name: "Zhiyin’s browser",
    scope: "conversation",
    describe,
    open: async (conversationId) => {
      if (!conversationId) throw new Error("A conversation is required.");
      return automationFor(conversationId);
    },
    inspect: async (name, args, conversationId) => {
      if (!conversationId)
        return { ok: false, reason: "A conversation is required." };
      return automationFor(conversationId).inspect(name, args);
    },
    describeResult: (name, args, result, conversationId) =>
      conversationId
        ? automationFor(conversationId).describeResult(name, args, result)
        : [],
    forget: async (conversationId) => {
      automations.delete(conversationId);
    },
  };
}

/**
 * The document compiler, offered to the model as a built-in connection. Like
 * git, one connection serves every conversation.
 */
export function documentsConnection(
  automation: CompilerAutomation,
): BuiltInMcpServer {
  return {
    id: "documents",
    name: "Document compiler",
    open: async () => automation,
    inspect: (name, args) => automation.inspect(name, args),
    describeResult: (name, args, result) =>
      automation.describeResult(name, args, result),
    produced: (name, args, value) => automation.produced(name, args, value),
  };
}

/**
 * The Python environment, offered to the model as a built-in connection. One
 * environment serves every conversation, as one installed program would.
 */
export function pythonConnection(
  automation: SandboxAutomation,
): BuiltInMcpServer {
  return {
    id: "python",
    name: "Python environment",
    open: async () => automation,
    inspect: (name, args) => automation.inspect(name, args),
    describeResult: (name, args, result) =>
      automation.describeResult(name, args, result),
  };
}

/**
 * Local git, offered to the model as a built-in connection. One connection
 * shared by every conversation — unlike the browser, nothing about it is
 * per-conversation state — so there is no scope to key automations by, and
 * no `forget`.
 */
export function gitConnection(automation: GitAutomation): BuiltInMcpServer {
  return {
    id: "git",
    name: "Git",
    open: async () => automation,
    inspect: (name, args) => automation.inspect(name, args),
    describeResult: (name, args, result) =>
      automation.describeResult(name, args, result),
  };
}
