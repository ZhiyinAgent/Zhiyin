/**
 * The rewind planner's fake, for the tests of the packages above it
 * (ADR 0002).
 */

import type { RewindPlanner } from "../src/index.js";

/** A planner that refuses every rewind and every undo. */
export function fakeRewindPlanner(): RewindPlanner {
  return {
    plan: () => ({ ok: false, reason: "stub" }),
    apply: () => ({ ok: false, reason: "stub" }),
    planUndo: () => ({ ok: false, reason: "stub" }),
    applyUndo: () => ({ ok: false, reason: "stub" }),
  };
}
