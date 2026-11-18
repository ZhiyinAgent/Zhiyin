/**
 * The toolchains' fake, for the tests of the packages above them
 * (ADR 0002). It answers plainly and reaches nothing.
 */

import type { Toolchains } from "../src/index.js";

/** Every toolchain ready, though none has a program to start. */
export function fakeToolchains(): Toolchains {
  return {
    state: async () => ({ status: "ready", version: "stub" }),
    install: async () => {},
    executable: async () => undefined,
  };
}
