import { defineConfig } from "vitest/config";

/*
 * A time limit catches a test that hangs; no test here measures speed by it.
 * On a 16-thread machine, file-heavy tests that take 0.2-1 s alone take up to
 * 5.2 s with the suite running twice at once and Windows scanning every file
 * they write, so Vitest's 5 s default fails one of them at random. This leaves
 * room for that without letting a hang pass unnoticed.
 */
const parallelLimits = { testTimeout: 30_000, hookTimeout: 30_000 };

// One test runner for the whole workspace. Projects keep the renderer's DOM
// environment from being paid for by the packages, which need no DOM at all.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "packages",
          ...parallelLimits,
          include: ["packages/*/test/**/*.test.ts"],
          environment: "node",
          sequence: { groupOrder: 0 },
        },
      },
      {
        // Checks about the repository as a whole, such as the layer rules the
        // lint configuration holds every package to.
        test: {
          name: "repository",
          ...parallelLimits,
          include: ["scripts/**/*.test.mjs"],
          environment: "node",
          sequence: { groupOrder: 0 },
        },
      },
      {
        // The real app, launched as a person launches it. These need the built
        // output, so the gate runs them as their own step after the build
        // rather than in the fast suite.
        test: {
          name: "installed",
          include: ["apps/desktop/installed/**/*.test.ts"],
          environment: "node",
          testTimeout: 60_000,
          hookTimeout: 60_000,
          fileParallelism: false,
        },
      },
      {
        test: {
          name: "desktop",
          ...parallelLimits,
          include: ["apps/desktop/src/**/*.test.{ts,tsx}"],
          environment: "jsdom",
          setupFiles: ["./apps/desktop/vitest.setup.ts"],
          // A CSS Module's classes keep their written names in DOM tests, so a
          // test can find an element by the class its stylesheet names.
          css: { modules: { classNameStrategy: "non-scoped" } },
          sequence: { groupOrder: 0 },
        },
      },
      {
        // Real browsers and Windows-exclusive file replacement share machine
        // resources that unit-test workers do not. Run these after the
        // parallel projects and one file at a time, so their evidence measures
        // the product boundary rather than scheduler contention.
        test: {
          name: "system-boundary",
          include: [
            "apps/desktop/system-boundary/**/*.test.{ts,tsx}",
            "packages/*/system-boundary/**/*.test.ts",
          ],
          environment: "node",
          fileParallelism: false,
          testTimeout: 120_000,
          hookTimeout: 120_000,
          // These renderer boundary tests serve the module styles as plain CSS,
          // matching the desktop project's test-time class names.
          css: { modules: { classNameStrategy: "non-scoped" } },
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
