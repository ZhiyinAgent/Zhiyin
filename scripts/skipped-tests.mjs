/**
 * A Vitest reporter that names the tests that did not run. A test that needs a
 * tool, a browser, a privilege or a key this machine lacks skips itself, and
 * the run's count alone does not say which: here each file is named with how
 * many of its tests were skipped.
 */

import { relative } from "node:path";

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
    for (const [file, count] of skipped) console.log(`  ${file}  ${count}`);
  }
}
