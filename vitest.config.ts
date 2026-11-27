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

/** Where the system-boundary tests are: each scope has a folder of its own. */
const systemBoundaryTests = [
  "apps/desktop/system-boundary/**/*.test.{ts,tsx}",
  "packages/*/*/system-boundary/**/*.test.ts",
];

/**
 * The system-boundary files whose evidence holds only with the machine to
 * themselves, run one at a time after the others. Each asserts something that
 * work beside it would change: how long a step takes, a fixed pause before a
 * result is read, or a count taken across the whole machine.
 */
const systemBoundaryAlone = [
  // A stopped command's next run within 30 s; fixed 100-700 ms pauses
  // between steps.
  "apps/desktop/system-boundary/sealed-git-hold.test.ts",
  // The reading position compared after fixed 300 and 500 ms pauses.
  "apps/desktop/system-boundary/reading-place.test.ts",
  // A fixed 500 ms pause for the panel to settle before it is measured.
  "apps/desktop/system-boundary/document-fit.test.ts",
  // Each call on a busy page answers within 15 s, a click within 1 s.
  "packages/feature/interactive-browser/system-boundary/busy-page.test.ts",
  // Requests counted after fixed pauses of 0.5 to 2 s.
  "packages/feature/interactive-browser/system-boundary/preview-seal.test.ts",
  // Streamed pictures counted over 2 s, 20 to 34 of them.
  "packages/feature/interactive-browser/system-boundary/playwright-launcher.test.ts",
  // A command's first output read before it becomes a job, 1.5 s in.
  "packages/feature/tools/system-boundary/command-jobs.test.ts",
  // The kernel's non-paged memory, which every process on the machine moves.
  "packages/platform/file-watch/system-boundary/file-watch.test.ts",
  // A change timed against reading 3,000 records again.
  "packages/feature/recovery/system-boundary/recovery.test.ts",
  // Tens of thousands of files written and watched: they fill the file system
  // and the watch every other file shares (79 s alone, 379 s beside others).
  "packages/feature/recovery/system-boundary/turn-files-watch-room.test.ts",
  // A preview's number read once the previews stay still for 2 s, two
  // previews awaited for 6 s, a full preview timed against drawing to the end
  // and 30 s, a call within 5 s, a render's estimate against its time, spec
  // measures within 45 s and 6 s, and CAD parts brought in within 20 s and
  // keyed within 30 s.
  "packages/feature/blender-studio/system-boundary/real-blender-time.test.ts",
  // A new conversation's first session on the kept shader cache timed
  // against one without it, which another Blender's compiling slows.
  "packages/feature/blender-studio/system-boundary/real-blender-shader-caches.test.ts",
  // The Blender containers in the person's profile counted, which another
  // Blender's adds to.
  "packages/feature/blender-studio/system-boundary/real-blender-confinement.test.ts",
  // Builds within 40, 60, 70, 85 and 150 s, none stopped for want of time,
  // sixty thousand edges drawn within the minute a drawing has, a position's
  // time read from the answer, where a 0.2 s deadline stops the making
  // checks, and a drawing that runs out of time.
  "packages/feature/cad-studio/system-boundary/real-cad-time.test.ts",
  // The CAD containers in the person's profile counted before and after a
  // build, which another lane's build adds to.
  "packages/feature/cad-studio/system-boundary/real-cad-confinement.test.ts",
];

/**
 * The real-CAD files, which use the processor and no graphics card. A file
 * of drawings holds about 1.5 GB at its peak, while a drawing works out
 * several views at once, and a few hundred megabytes between; a file of
 * builds alone holds about 400 MB.
 */
const realCadTests = [
  "packages/feature/cad-studio/system-boundary/real-cad-*.test.ts",
];

const systemBoundaryLimits = {
  environment: "node",
  testTimeout: 120_000,
  hookTimeout: 120_000,
  // These renderer boundary tests serve the module styles as plain CSS,
  // matching the desktop project's test-time class names.
  css: { modules: { classNameStrategy: "non-scoped" } },
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
    // Records the runs of the tests that need a real Blender or the CAD
    // environment, which a release asks for. A --reporter given on the
    // command line replaces these, so `pnpm test` names it too.
    reporters: ["default", "./scripts/real-engine-record.mjs"],
    projects: [
      {
        test: {
          name: "packages",
          ...parallelLimits,
          include: [
            "packages/*/*/test/**/*.test.ts",
            // Each model provider keeps its tests in its own folder (ADR 0014).
            "packages/feature/model-client/src/providers/*/test/**/*.test.ts",
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
        // Real browsers, Blenders and sealed-off processes, each taking far
        // more of the machine than a unit-test worker. They run after the
        // parallel projects, three files at a time: three real Blenders
        // together hold about 4 GB, and a browser file less. The real-CAD
        // files run after these, four at a time: four at their peaks hold
        // about 6 GB. Then, one at a time, run the files that need the
        // machine to themselves. Vitest gives each group order its own worker
        // limit, so each project here has an order of its own.
        test: {
          name: "system-boundary",
          ...systemBoundaryLimits,
          include: systemBoundaryTests,
          exclude: [
            ...configDefaults.exclude,
            ...systemBoundaryAlone,
            ...realCadTests,
          ],
          maxWorkers: 3,
          sequence: { groupOrder: 1 },
        },
      },
      {
        test: {
          name: "system-boundary-cad",
          ...systemBoundaryLimits,
          include: realCadTests,
          exclude: [...configDefaults.exclude, ...systemBoundaryAlone],
          maxWorkers: 4,
          sequence: { groupOrder: 2 },
        },
      },
      {
        test: {
          name: "system-boundary-alone",
          ...systemBoundaryLimits,
          include: systemBoundaryAlone,
          fileParallelism: false,
          sequence: { groupOrder: 3 },
        },
      },
    ],
  },
});
