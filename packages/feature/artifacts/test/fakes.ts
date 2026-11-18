/**
 * The produced files' fake, for the tests of the packages above it
 * (ADR 0002). It reads and writes no file.
 */

import type { Artifacts } from "../src/index.js";

/**
 * Produced files with no folder behind them: a record stays as it was, a
 * preview finds nothing, and every export is cancelled.
 */
export function fakeArtifacts(): Artifacts {
  return {
    record: (existing) => existing,
    preview: async () => ({
      status: "missing",
      path: "",
      reason: "No workspace in this test.",
    }),
    exportTo: async () => ({ status: "cancelled" }),
    exportView: async () => ({ status: "cancelled" }),
  };
}
