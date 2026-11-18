/**
 * The view checker's fake, for the tests of the packages above it
 * (ADR 0002). It draws nothing.
 */

import type { ViewValidator } from "../src/index.js";

/** A checker that accepts every view. */
export function fakeViews(): ViewValidator {
  return { validate: async () => ({ ok: true }) };
}
