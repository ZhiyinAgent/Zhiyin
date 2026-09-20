import { defineConfig } from "vitest/config";

// One test runner for the whole workspace. Projects keep the renderer's DOM
// environment from being paid for by the packages, which need no DOM at all.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "packages",
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
          include: ["scripts/**/*.test.mjs"],
          environment: "node",
          sequence: { groupOrder: 0 },
        },
      },
      {
        // The real app, launched as a person launches it. These need the built
        // output, so they run as their own step after the build rather than in
        // the fast suite - see scripts/gate.ps1.
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
          include: ["apps/desktop/src/**/*.test.{ts,tsx}"],
          environment: "jsdom",
          setupFiles: ["./apps/desktop/vitest.setup.ts"],
          // A CSS Module's classes keep their written names in DOM tests, so a
          // test that finds an element by class finds the same element whether
          // or not its styles have moved into a module.
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
