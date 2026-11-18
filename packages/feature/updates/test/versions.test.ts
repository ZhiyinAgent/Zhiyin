/**
 * Release versions are ordered as semantic versioning orders them, so an
 * alpha is never taken for a newer release than the one it leads to.
 */

import { describe, expect, it } from "vitest";
import { compareVersions, isVersion } from "../src/versions.js";

describe("release versions", () => {
  it("orders alphas by their number, not their text", () => {
    expect(compareVersions("0.1.0-alpha.2", "0.1.0-alpha.1")).toBe(1);
    expect(compareVersions("0.1.0-alpha.10", "0.1.0-alpha.9")).toBe(1);
    expect(compareVersions("0.1.0-alpha.1", "0.1.0-alpha.1")).toBe(0);
  });

  it("puts a release after its own alphas and before the next one's", () => {
    expect(compareVersions("0.1.0", "0.1.0-alpha.9")).toBe(1);
    expect(compareVersions("0.1.0-alpha.1", "0.1.0")).toBe(-1);
    expect(compareVersions("0.2.0-alpha.1", "0.1.0")).toBe(1);
    expect(compareVersions("0.1.1", "0.1.0")).toBe(1);
    expect(compareVersions("1.0.0", "0.99.99")).toBe(1);
  });

  it("puts a beta after an alpha of the same release", () => {
    expect(compareVersions("0.1.0-beta.1", "0.1.0-alpha.7")).toBe(1);
  });

  it("knows a version from anything else", () => {
    expect(isVersion("0.1.0-alpha.1")).toBe(true);
    expect(isVersion("0.1.0")).toBe(true);
    expect(isVersion("v0.1.0")).toBe(false);
    expect(isVersion("0.1")).toBe(false);
    expect(isVersion("0.1.0-alpha.01")).toBe(false);
    expect(isVersion("0.1.0\n")).toBe(false);
    expect(() => compareVersions("0.1.0", "latest")).toThrow();
  });
});
