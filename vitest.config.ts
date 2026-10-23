import { configDefaults, defineConfig } from "vitest/config";

/*
 * A time limit catches a test that hangs; no test here measures speed by it.
 * On a 16-thread machine, file-heavy tests that take 0.2-1 s alone take up to
 * 5.2 s with the suite running twice at once and Windows scanning every file
 * they write, so Vitest's 5 s default fails one of them at random. This leaves
 * room for that without letting a hang pass unnoticed.
 */
const parallelLimits = { testTimeout: 30_000, hookTimeout: 30_000 };

/**
 * Tests that call a model provider's real API. They spend credit on a real
 * account, so they are kept out of every other project and run only in their
 * own, by `pnpm test:live`, whatever keys the shell happens to hold.
 */
const liveTests = ["packages/**/live*.test.ts", "packages/**/*.live.test.ts"];

/** The installed app's live tests, run by `pnpm test:live:installed`. */
const installedLiveTests = ["apps/desktop/installed/**/*.live.test.ts"];

/** The installed app's tests start Electron, one file at a time. */
const installedLimits = {
  environment: "node",
  testTimeout: 60_000,
  hookTimeout: 60_000,
  fileParallelism: false,
} as const;

/*
 * When a test ends a page's process, Playwright drops the commands it had sent
 * that page as crashed. Chromium may still answer one of them, "Target
 * crashed", and Playwright then fails an assertion in its own message handler,
 * where no test can catch it. A test that needs the page back already fails
 * when it does not come back, so only this error is let through.
 */
function playwrightLateCrashReply(error: Error): boolean {
  return (
    error.message === "Target crashed" &&
    (error.stack ?? "").includes("_CRSession._onMessage")
  );
}

// One test runner for the whole workspace. Projects keep the renderer's DOM
// environment from being paid for by the packages, which need no DOM at all.
export default defineConfig({
  test: {
    onUnhandledError: (error) =>
      playwrightLateCrashReply(error) ? false : undefined,
    // Installs the programs some tests need, where ZHIYIN_TEST_TOOLS asks.
    globalSetup: ["./scripts/test-tools.mjs"],
    projects: [
      {
        test: {
          name: "packages",
          ...parallelLimits,
          include: [
            "packages/*/test/**/*.test.ts",
            // Each model provider keeps its tests in its own folder (ADR 0015).
            "packages/model-client/src/providers/*/test/**/*.test.ts",
          ],
          exclude: [...configDefaults.exclude, ...liveTests],
          environment: "node",
          sequence: { groupOrder: 0 },
        },
      },
      {
        test: {
          name: "live",
          ...parallelLimits,
          include: liveTests,
          environment: "node",
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
          exclude: [...configDefaults.exclude, ...installedLiveTests],
          globalSetup: ["apps/desktop/installed/opens.ts"],
          ...installedLimits,
        },
      },
      {
        test: {
          name: "installed-live",
          include: installedLiveTests,
          ...installedLimits,
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
