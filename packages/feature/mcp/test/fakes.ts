/**
 * The connections' fake, for the tests of the packages above them
 * (ADR 0002). It answers plainly and reaches nothing.
 */

import type { McpServers } from "../src/index.js";

/** No connections: nothing is listed, and every check, test or call is refused. */
export function fakeMcp(): McpServers {
  return {
    states: async () => [],
    check: async () => {
      throw new Error("stub");
    },
    retryFailed: async () => {},
    builtInIds: () => [],
    listBuiltInsAgain: async () => {},
    setToolEnabled: async () => {},
    setToolTreatment: async () => {},
    test: async () => ({ ok: false, reason: "stub" }),
    saveToken: async () => {},
    clearToken: async () => {},
    signIn: async () => ({ status: "failed", reason: "stub" }),
    availableTools: async () => [],
    inspect: async () => ({ ok: false, reason: "stub" }),
    execute: async () => ({ ok: false, reason: "stub" }),
    shutdownScope: async () => {},
    shutdownAll: async () => {},
  };
}
