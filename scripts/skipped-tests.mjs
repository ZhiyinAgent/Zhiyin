/**
 * A Vitest reporter that names the tests that did not run, and fails the run
 * when one did not run where it should have. A test that needs a tool, a
 * browser, a privilege or a key this machine lacks skips itself, and the run's
 * count alone does not say which: here each file is named with how many of its
 * tests were skipped. A file may skip only where the list below expects it to.
 */

import { execSync } from "node:child_process";
import { relative } from "node:path";

/** The console code page, as `chcp` reports it. */
function codePage() {
  if (process.platform !== "win32") return undefined;
  return Number(/(\d+)\s*$/.exec(execSync("chcp").toString().trim())?.[1]);
}

/**
 * Every file allowed to skip tests, what it needs, and where it may go
 * without. CI installs the programs (`ZHIYIN_TEST_TOOLS`), so a test that
 * needs one runs there; a Blender that runs scenes needs a graphics card too,
 * which CI's machine lacks.
 */
const expected = new Map([
  [
    "packages/blender-studio/system-boundary/real-blender.test.ts",
    {
      needs: "Blender on a PC with a graphics card (ZHIYIN_BLENDER)",
      without: (env) => !env.ZHIYIN_BLENDER,
    },
  ],
  [
    "apps/desktop/system-boundary/blender-install.test.ts",
    {
      needs: "Blender's archive (ZHIYIN_BLENDER_ARCHIVE)",
      without: (env) => !env.ZHIYIN_BLENDER_ARCHIVE && !env.CI,
    },
  ],
  [
    "packages/document-compiler/test/real-compilers.test.ts",
    {
      needs: "Typst and Tectonic (ZHIYIN_TYPST, ZHIYIN_TECTONIC)",
      without: (env) => !(env.ZHIYIN_TYPST && env.ZHIYIN_TECTONIC) && !env.CI,
    },
  ],
  [
    "packages/python-sandbox/test/real-uv.test.ts",
    {
      needs: "uv (ZHIYIN_UV)",
      without: (env) => !env.ZHIYIN_UV && !env.CI,
    },
  ],
  [
    "apps/desktop/installed/packaged-app.test.ts",
    {
      needs: "the packaged app, which the gate builds with -Full",
      without: (env) => !env.ZHIYIN_PACKAGED_APP,
    },
  ],
  [
    "packages/process-ownership/test/process-runs.test.ts",
    {
      needs: "a console code page of 437, 850 or 858",
      without: () => ![437, 850, 858].includes(codePage() ?? 0),
    },
  ],
  [
    "packages/tools/test/delete-file.test.ts",
    {
      needs: "an account Windows refuses, which GitHub's is not",
      without: (env) => Boolean(env.CI),
    },
  ],
]);

/** A run's skipped tests, counted by file, the files in order. */
export function skippedByFile(testModules, root) {
  const counts = new Map();
  for (const module of testModules)
    for (const test of module.children.allTests()) {
      if (test.result().state !== "skipped") continue;
      const file = relative(root, module.moduleId).replaceAll("\\", "/");
      counts.set(file, (counts.get(file) ?? 0) + 1);
    }
  return [...counts].sort(([a], [b]) => a.localeCompare(b));
}

/** What did not run where it should have, one sentence per file. */
export function unexpectedSkips(skipped, env) {
  const problems = [];
  for (const [file, count] of skipped) {
    const allowed = expected.get(file);
    if (!allowed)
      problems.push(`${file}: ${count} skipped, and it is never expected to.`);
    else if (!allowed.without(env))
      problems.push(
        `${file}: ${count} skipped, where it should have run with ${allowed.needs}.`,
      );
  }
  return problems;
}

export default class SkippedTests {
  #root = process.cwd();

  onInit(vitest) {
    this.#root = vitest.config.root;
  }

  onTestRunEnd(testModules) {
    const skipped = skippedByFile(testModules, this.#root);
    if (!skipped.length) return;
    const total = skipped.reduce((sum, [, count]) => sum + count, 0);
    console.log(
      `\nDid not run here: ${total} tests in ${skipped.length} files.`,
    );
    for (const [file, count] of skipped)
      console.log(
        `  ${file}  ${count}` +
          (expected.has(file) ? `  (needs ${expected.get(file).needs})` : ""),
      );
    const problems = unexpectedSkips(skipped, process.env);
    if (!problems.length) return;
    console.log("\nSkipped where they should have run:");
    for (const problem of problems) console.log(`  ${problem}`);
    process.exitCode = 1;
  }
}
