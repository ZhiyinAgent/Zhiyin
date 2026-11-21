/**
 * The built-in tools' fakes, for the tests of the packages above them
 * (ADR 0002). They answer plainly and reach nothing.
 */

import type { ShellCommands, ToolRegistry } from "../src/index.js";

/** No tools: the list is empty, and every call is refused. */
export function fakeTools(): ToolRegistry {
  return {
    list: () => [],
    inspect: async () => ({ ok: false, reason: "stub" }),
    execute: async () => ({ ok: false, reason: "stub" }),
  };
}

/** Jobs that do nothing but what a test gives them. */
export function jobsWith(overrides: Partial<ShellCommands>): ShellCommands {
  return {
    onCommandEnded: () => {},
    onCommandsChanged: () => {},
    onJobChanges: () => {},
    runningCommands: () => [],
    commandOutput: async () => undefined,
    stopCommandForPerson: async () => {},
    stopCommands: async () => {},
    forgetConversation: async () => {},
    stopAllCommands: async () => {},
    ...overrides,
  };
}
