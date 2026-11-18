/**
 * The permission engine's fake, for the tests of the packages above it
 * (ADR 0002). It answers plainly and reaches nothing.
 */

import type { PermissionEngine } from "../src/index.js";

/** An engine that refuses every action. */
export function fakePermissions(): PermissionEngine {
  return { decide: async () => ({ outcome: "deny", reason: "stub" }) };
}
