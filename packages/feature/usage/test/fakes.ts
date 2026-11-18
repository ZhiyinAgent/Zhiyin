/**
 * The usage record's fake, for the tests of the packages above it
 * (ADR 0002). It writes nowhere.
 */

import type { UsageTelemetry } from "../src/index.js";

/** A usage record that keeps nothing and has nothing to show. */
export function fakeUsage(): UsageTelemetry {
  return {
    record: async () => {},
    state: async () => ({
      status: "unavailable",
      reason: "No usage yet.",
    }),
  };
}
