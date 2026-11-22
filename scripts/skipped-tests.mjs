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
  return Number(/(\d+)\s*$/.exec(execSync("chcp").toString().trim())?.[1]);
}

/**
 * Every file allowed to skip tests, what it needs, and where it may go
 * without. CI installs the programs (`ZHIYIN_TEST_TOOLS`), so a test that
 * needs one runs there; a Blender that runs scenes needs a graphics card too,
 * which CI's machine lacks.
 */
export const expected = new Map([
  [
    "apps/desktop/system-boundary/large-scene-recovery.test.ts",
    {
      needs: "Blender on a PC with a graphics card (ZHIYIN_BLENDER)",
      without: (env) => !env.ZHIYIN_BLENDER,
    },
  ],
  [
    "packages/feature/blender-studio/system-boundary/real-blender.test.ts",
    {
      needs: "Blender on a PC with a graphics card (ZHIYIN_BLENDER)",
      without: (env) => !env.ZHIYIN_BLENDER,
    },
  ],
  [
    "packages/feature/blender-studio/system-boundary/real-blender-passes.test.ts",
    {
      needs: "Blender on a PC with a graphics card (ZHIYIN_BLENDER)",
      without: (env) => !env.ZHIYIN_BLENDER,
    },
  ],
  [
    "packages/feature/blender-studio/system-boundary/real-blender-shared-geometry.test.ts",
    {
      needs: "Blender on a PC with a graphics card (ZHIYIN_BLENDER)",
      without: (env) => !env.ZHIYIN_BLENDER,
    },
  ],
  [
    "packages/feature/blender-studio/system-boundary/real-blender-commands.test.ts",
    {
      needs: "Blender on a PC with a graphics card (ZHIYIN_BLENDER)",
      without: (env) => !env.ZHIYIN_BLENDER,
    },
  ],
  [
    "packages/feature/blender-studio/system-boundary/real-blender-scenes.test.ts",
    {
      needs: "Blender on a PC with a graphics card (ZHIYIN_BLENDER)",
      without: (env) => !env.ZHIYIN_BLENDER,
    },
  ],
  [
    "packages/feature/blender-studio/system-boundary/real-blender-motion.test.ts",
    {
      needs: "Blender on a PC with a graphics card (ZHIYIN_BLENDER)",
      without: (env) => !env.ZHIYIN_BLENDER,
    },
  ],
  [
    "packages/feature/blender-studio/system-boundary/real-blender-linked-motion.test.ts",
    {
      needs: "Blender on a PC with a graphics card (ZHIYIN_BLENDER)",
      without: (env) => !env.ZHIYIN_BLENDER,
    },
  ],
  [
    "packages/feature/blender-studio/system-boundary/real-blender-cad-sizes.test.ts",
    {
      needs: "Blender on a PC with a graphics card (ZHIYIN_BLENDER)",
      without: (env) => !env.ZHIYIN_BLENDER,
    },
  ],
  [
    "packages/feature/blender-studio/system-boundary/real-blender-outside.test.ts",
    {
      needs: "Blender on a PC with a graphics card (ZHIYIN_BLENDER)",
      without: (env) => !env.ZHIYIN_BLENDER,
    },
  ],
  [
    "packages/feature/blender-studio/system-boundary/real-blender-cad-parts.test.ts",
    {
      needs: "Blender on a PC with a graphics card (ZHIYIN_BLENDER)",
      without: (env) => !env.ZHIYIN_BLENDER,
    },
  ],
  [
    "packages/feature/blender-studio/system-boundary/real-blender-library.test.ts",
    {
      needs: "Blender on a PC with a graphics card (ZHIYIN_BLENDER)",
      without: (env) => !env.ZHIYIN_BLENDER,
    },
  ],
  [
    "packages/feature/blender-studio/system-boundary/real-blender-library-curves.test.ts",
    {
      needs: "Blender on a PC with a graphics card (ZHIYIN_BLENDER)",
      without: (env) => !env.ZHIYIN_BLENDER,
    },
  ],
  [
    "packages/feature/blender-studio/system-boundary/real-blender-library-details.test.ts",
    {
      needs: "Blender on a PC with a graphics card (ZHIYIN_BLENDER)",
      without: (env) => !env.ZHIYIN_BLENDER,
    },
  ],
  [
    "packages/feature/blender-studio/system-boundary/real-blender-library-edits.test.ts",
    {
      needs: "Blender on a PC with a graphics card (ZHIYIN_BLENDER)",
      without: (env) => !env.ZHIYIN_BLENDER,
    },
  ],
  [
    "packages/feature/blender-studio/system-boundary/real-blender-library-loops.test.ts",
    {
      needs: "Blender on a PC with a graphics card (ZHIYIN_BLENDER)",
      without: (env) => !env.ZHIYIN_BLENDER,
    },
  ],
  [
    "packages/feature/blender-studio/system-boundary/real-blender-placement.test.ts",
    {
      needs: "Blender on a PC with a graphics card (ZHIYIN_BLENDER)",
      without: (env) => !env.ZHIYIN_BLENDER,
    },
  ],
  [
    "packages/feature/blender-studio/system-boundary/real-blender-rig-bones.test.ts",
    {
      needs: "Blender on a PC with a graphics card (ZHIYIN_BLENDER)",
      without: (env) => !env.ZHIYIN_BLENDER,
    },
  ],
  [
    "packages/feature/blender-studio/system-boundary/real-blender-rig-bind.test.ts",
    {
      needs: "Blender on a PC with a graphics card (ZHIYIN_BLENDER)",
      without: (env) => !env.ZHIYIN_BLENDER,
    },
  ],
  [
    "packages/feature/blender-studio/system-boundary/real-blender-motion-rig.test.ts",
    {
      needs: "Blender on a PC with a graphics card (ZHIYIN_BLENDER)",
      without: (env) => !env.ZHIYIN_BLENDER,
    },
  ],
  [
    "packages/feature/blender-studio/system-boundary/real-blender-simulate-bodies.test.ts",
    {
      needs: "Blender on a PC with a graphics card (ZHIYIN_BLENDER)",
      without: (env) => !env.ZHIYIN_BLENDER,
    },
  ],
  [
    "packages/feature/blender-studio/system-boundary/real-blender-simulate-cloth.test.ts",
    {
      needs: "Blender on a PC with a graphics card (ZHIYIN_BLENDER)",
      without: (env) => !env.ZHIYIN_BLENDER,
    },
  ],
  [
    "packages/feature/blender-studio/system-boundary/real-blender-cloth-through.test.ts",
    {
      needs: "Blender on a PC with a graphics card (ZHIYIN_BLENDER)",
      without: (env) => !env.ZHIYIN_BLENDER,
    },
  ],
  [
    "packages/feature/blender-studio/system-boundary/real-blender-sculpt.test.ts",
    {
      needs: "Blender on a PC with a graphics card (ZHIYIN_BLENDER)",
      without: (env) => !env.ZHIYIN_BLENDER,
    },
  ],
  [
    "packages/feature/blender-studio/system-boundary/real-blender-measures.test.ts",
    {
      needs: "Blender on a PC with a graphics card (ZHIYIN_BLENDER)",
      without: (env) => !env.ZHIYIN_BLENDER,
    },
  ],
  [
    "packages/feature/blender-studio/system-boundary/real-blender-bake.test.ts",
    {
      needs: "Blender on a PC with a graphics card (ZHIYIN_BLENDER)",
      without: (env) => !env.ZHIYIN_BLENDER,
    },
  ],
  [
    "packages/feature/blender-studio/system-boundary/real-blender-decals.test.ts",
    {
      needs: "Blender on a PC with a graphics card (ZHIYIN_BLENDER)",
      without: (env) => !env.ZHIYIN_BLENDER,
    },
  ],
  [
    "packages/feature/blender-studio/system-boundary/real-blender-finishes.test.ts",
    {
      needs: "Blender on a PC with a graphics card (ZHIYIN_BLENDER)",
      without: (env) => !env.ZHIYIN_BLENDER,
    },
  ],
  [
    "packages/feature/blender-studio/system-boundary/real-blender-materials.test.ts",
    {
      needs: "Blender on a PC with a graphics card (ZHIYIN_BLENDER)",
      without: (env) => !env.ZHIYIN_BLENDER,
    },
  ],
  [
    "packages/feature/blender-studio/system-boundary/real-blender-measure.test.ts",
    {
      needs: "Blender on a PC with a graphics card (ZHIYIN_BLENDER)",
      without: (env) => !env.ZHIYIN_BLENDER,
    },
  ],
  [
    "packages/feature/blender-studio/system-boundary/real-blender-render-light.test.ts",
    {
      needs: "Blender on a PC with a graphics card (ZHIYIN_BLENDER)",
      without: (env) => !env.ZHIYIN_BLENDER,
    },
  ],
  [
    "packages/feature/blender-studio/system-boundary/real-blender-render-motion-loops.test.ts",
    {
      needs: "Blender on a PC with a graphics card (ZHIYIN_BLENDER)",
      without: (env) => !env.ZHIYIN_BLENDER,
    },
  ],
  [
    "packages/feature/blender-studio/system-boundary/real-blender-render-styles.test.ts",
    {
      needs: "Blender on a PC with a graphics card (ZHIYIN_BLENDER)",
      without: (env) => !env.ZHIYIN_BLENDER,
    },
  ],
  [
    "packages/feature/blender-studio/system-boundary/real-blender-scatter.test.ts",
    {
      needs: "Blender on a PC with a graphics card (ZHIYIN_BLENDER)",
      without: (env) => !env.ZHIYIN_BLENDER,
    },
  ],
  [
    "packages/feature/blender-studio/system-boundary/real-blender-shading.test.ts",
    {
      needs: "Blender on a PC with a graphics card (ZHIYIN_BLENDER)",
      without: (env) => !env.ZHIYIN_BLENDER,
    },
  ],
  [
    "packages/feature/blender-studio/system-boundary/real-blender-shapes-surfaces.test.ts",
    {
      needs: "Blender on a PC with a graphics card (ZHIYIN_BLENDER)",
      without: (env) => !env.ZHIYIN_BLENDER,
    },
  ],
  [
    "packages/feature/blender-studio/system-boundary/real-blender-shapes.test.ts",
    {
      needs: "Blender on a PC with a graphics card (ZHIYIN_BLENDER)",
      without: (env) => !env.ZHIYIN_BLENDER,
    },
  ],
  [
    "packages/feature/blender-studio/system-boundary/real-blender-unwrap.test.ts",
    {
      needs: "Blender on a PC with a graphics card (ZHIYIN_BLENDER)",
      without: (env) => !env.ZHIYIN_BLENDER,
    },
  ],
  [
    "packages/feature/blender-studio/system-boundary/real-blender-calls.test.ts",
    {
      needs: "Blender on a PC with a graphics card (ZHIYIN_BLENDER)",
      without: (env) => !env.ZHIYIN_BLENDER,
    },
  ],
  [
    "packages/feature/blender-studio/system-boundary/real-blender-knowledge.test.ts",
    {
      needs: "Blender on a PC with a graphics card (ZHIYIN_BLENDER)",
      without: (env) => !env.ZHIYIN_BLENDER,
    },
  ],
  [
    "packages/feature/blender-studio/system-boundary/real-blender-look.test.ts",
    {
      needs: "Blender on a PC with a graphics card (ZHIYIN_BLENDER)",
      without: (env) => !env.ZHIYIN_BLENDER,
    },
  ],
  [
    "packages/feature/blender-studio/system-boundary/real-blender-checks.test.ts",
    {
      needs: "Blender on a PC with a graphics card (ZHIYIN_BLENDER)",
      without: (env) => !env.ZHIYIN_BLENDER,
    },
  ],
  [
    "packages/feature/blender-studio/system-boundary/real-blender-change-checks.test.ts",
    {
      needs: "Blender on a PC with a graphics card (ZHIYIN_BLENDER)",
      without: (env) => !env.ZHIYIN_BLENDER,
    },
  ],
  [
    "packages/feature/blender-studio/system-boundary/real-blender-spec.test.ts",
    {
      needs: "Blender on a PC with a graphics card (ZHIYIN_BLENDER)",
      without: (env) => !env.ZHIYIN_BLENDER,
    },
  ],
  [
    "packages/feature/blender-studio/system-boundary/real-blender-spec-motion.test.ts",
    {
      needs: "Blender on a PC with a graphics card (ZHIYIN_BLENDER)",
      without: (env) => !env.ZHIYIN_BLENDER,
    },
  ],
  [
    "packages/feature/blender-studio/system-boundary/real-blender-own-heights.test.ts",
    {
      needs: "Blender on a PC with a graphics card (ZHIYIN_BLENDER)",
      without: (env) => !env.ZHIYIN_BLENDER,
    },
  ],
  [
    // It draws as a PC without a graphics card does, so it needs none.
    "packages/feature/blender-studio/system-boundary/real-blender-processor.test.ts",
    {
      needs: "Blender (ZHIYIN_BLENDER)",
      without: (env) => !env.ZHIYIN_BLENDER,
    },
  ],
  [
    // The CAD environment is made by Zhiyin from its lock, about 570 MB,
    // which CI does not download.
    "packages/feature/cad-studio/system-boundary/real-cad.test.ts",
    {
      needs: "the CAD environment's Python (ZHIYIN_CAD_PYTHON)",
      without: (env) => !env.ZHIYIN_CAD_PYTHON,
    },
  ],
  [
    "packages/feature/cad-studio/system-boundary/real-cad-shapes.test.ts",
    {
      needs: "the CAD environment's Python (ZHIYIN_CAD_PYTHON)",
      without: (env) => !env.ZHIYIN_CAD_PYTHON,
    },
  ],
  [
    "packages/feature/cad-studio/system-boundary/real-cad-answers.test.ts",
    {
      needs: "the CAD environment's Python (ZHIYIN_CAD_PYTHON)",
      without: (env) => !env.ZHIYIN_CAD_PYTHON,
    },
  ],
  [
    "packages/feature/cad-studio/system-boundary/real-cad-knowledge.test.ts",
    {
      needs: "the CAD environment's Python (ZHIYIN_CAD_PYTHON)",
      without: (env) => !env.ZHIYIN_CAD_PYTHON,
    },
  ],
  [
    "packages/feature/cad-studio/system-boundary/real-cad-fit.test.ts",
    {
      needs: "the CAD environment's Python (ZHIYIN_CAD_PYTHON)",
      without: (env) => !env.ZHIYIN_CAD_PYTHON,
    },
  ],
  [
    "packages/feature/cad-studio/system-boundary/real-cad-checks.test.ts",
    {
      needs: "the CAD environment's Python (ZHIYIN_CAD_PYTHON)",
      without: (env) => !env.ZHIYIN_CAD_PYTHON,
    },
  ],
  [
    "packages/feature/cad-studio/system-boundary/real-cad-requirements.test.ts",
    {
      needs: "the CAD environment's Python (ZHIYIN_CAD_PYTHON)",
      without: (env) => !env.ZHIYIN_CAD_PYTHON,
    },
  ],
  [
    "packages/feature/cad-studio/system-boundary/real-cad-torsion.test.ts",
    {
      needs: "the CAD environment's Python (ZHIYIN_CAD_PYTHON)",
      without: (env) => !env.ZHIYIN_CAD_PYTHON,
    },
  ],
  [
    "packages/feature/cad-studio/system-boundary/real-cad-geared-sweep.test.ts",
    {
      needs: "the CAD environment's Python (ZHIYIN_CAD_PYTHON)",
      without: (env) => !env.ZHIYIN_CAD_PYTHON,
    },
  ],
  [
    "packages/feature/cad-studio/system-boundary/real-cad-many-parts.test.ts",
    {
      needs: "the CAD environment's Python (ZHIYIN_CAD_PYTHON)",
      without: (env) => !env.ZHIYIN_CAD_PYTHON,
    },
  ],
  [
    "packages/feature/cad-studio/system-boundary/real-cad-drawing-assembly.test.ts",
    {
      needs: "the CAD environment's Python (ZHIYIN_CAD_PYTHON)",
      without: (env) => !env.ZHIYIN_CAD_PYTHON,
    },
  ],
  [
    "packages/feature/cad-studio/system-boundary/real-cad-bom.test.ts",
    {
      needs: "the CAD environment's Python (ZHIYIN_CAD_PYTHON)",
      without: (env) => !env.ZHIYIN_CAD_PYTHON,
    },
  ],
  [
    "packages/feature/cad-studio/system-boundary/real-cad-drawing-kinds.test.ts",
    {
      needs: "the CAD environment's Python (ZHIYIN_CAD_PYTHON)",
      without: (env) => !env.ZHIYIN_CAD_PYTHON,
    },
  ],
  [
    "packages/feature/cad-studio/system-boundary/real-cad-sheet.test.ts",
    {
      needs: "the CAD environment's Python (ZHIYIN_CAD_PYTHON)",
      without: (env) => !env.ZHIYIN_CAD_PYTHON,
    },
  ],
  [
    "packages/feature/cad-studio/system-boundary/real-cad-strength.test.ts",
    {
      needs: "the CAD environment's Python (ZHIYIN_CAD_PYTHON)",
      without: (env) => !env.ZHIYIN_CAD_PYTHON,
    },
  ],
  [
    "packages/feature/cad-studio/system-boundary/real-cad-making.test.ts",
    {
      needs: "the CAD environment's Python (ZHIYIN_CAD_PYTHON)",
      without: (env) => !env.ZHIYIN_CAD_PYTHON,
    },
  ],
  [
    // Both studios at once: a Blender scene drawn by the CAD studio.
    "apps/desktop/system-boundary/scene-drawing.test.ts",
    {
      needs:
        "Blender on a PC with a graphics card and the CAD environment's Python (ZHIYIN_BLENDER, ZHIYIN_CAD_PYTHON)",
      without: (env) => !env.ZHIYIN_BLENDER || !env.ZHIYIN_CAD_PYTHON,
    },
  ],
  [
    // Both studios at once: a CAD assembly animated in Blender and reshaped
    // from a new export.
    "apps/desktop/system-boundary/mechanism.test.ts",
    {
      needs:
        "Blender on a PC with a graphics card and the CAD environment's Python (ZHIYIN_BLENDER, ZHIYIN_CAD_PYTHON)",
      without: (env) => !env.ZHIYIN_BLENDER || !env.ZHIYIN_CAD_PYTHON,
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
    "packages/feature/document-compiler/test/real-compilers.test.ts",
    {
      needs: "Typst and Tectonic (ZHIYIN_TYPST, ZHIYIN_TECTONIC)",
      without: (env) => !(env.ZHIYIN_TYPST && env.ZHIYIN_TECTONIC) && !env.CI,
    },
  ],
  // Zhiyin's shell, which the gate builds from its pins before the tests.
  [
    "packages/feature/tools/system-boundary/sealed-shell.test.ts",
    {
      needs: "Zhiyin's busybox (ZHIYIN_BUSYBOX)",
      without: (env) => !env.ZHIYIN_BUSYBOX && !env.CI,
    },
  ],
  [
    "apps/desktop/system-boundary/sealed-git.test.ts",
    {
      needs: "Zhiyin's busybox (ZHIYIN_BUSYBOX)",
      without: (env) => !env.ZHIYIN_BUSYBOX && !env.CI,
    },
  ],
  [
    "apps/desktop/system-boundary/sealed-git-hold.test.ts",
    {
      needs: "Zhiyin's busybox (ZHIYIN_BUSYBOX)",
      without: (env) => !env.ZHIYIN_BUSYBOX && !env.CI,
    },
  ],
  [
    "packages/core/core/system-boundary/sealed-granted-going-back.test.ts",
    {
      needs: "Zhiyin's busybox (ZHIYIN_BUSYBOX)",
      without: (env) => !env.ZHIYIN_BUSYBOX && !env.CI,
    },
  ],
  [
    "packages/core/core/system-boundary/sealed-going-back.test.ts",
    {
      needs: "Zhiyin's busybox (ZHIYIN_BUSYBOX)",
      without: (env) => !env.ZHIYIN_BUSYBOX && !env.CI,
    },
  ],
  [
    "packages/feature/tools/system-boundary/sealed-node.test.ts",
    {
      needs: "Zhiyin's busybox and Node (ZHIYIN_BUSYBOX, ZHIYIN_NODE)",
      without: (env) => !(env.ZHIYIN_BUSYBOX && env.ZHIYIN_NODE) && !env.CI,
    },
  ],
  [
    "packages/feature/python-sandbox/test/real-uv.test.ts",
    {
      needs: "uv (ZHIYIN_UV)",
      without: (env) => !env.ZHIYIN_UV && !env.CI,
    },
  ],
  [
    "packages/feature/conversation-export/test/atif-validator.test.ts",
    {
      needs: "uv (ZHIYIN_UV), to run ATIF's validator",
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
    "packages/feature/model-client/test/model-list-format.test.ts",
    {
      needs:
        "the maintainers' public signing keys in model-list-keys.ts, which a release must carry",
      without: (env) => !env.ZHIYIN_RELEASE_CHECK,
    },
  ],
  [
    "packages/feature/updates/test/release-keys.test.ts",
    {
      needs:
        "the maintainers' public release keys in release-keys.ts, which a release must carry",
      without: (env) => !env.ZHIYIN_RELEASE_CHECK,
    },
  ],
  [
    "packages/platform/sandbox/test/process-runs.test.ts",
    {
      needs: "a console code page of 437, 850 or 858",
      without: () => ![437, 850, 858].includes(codePage() ?? 0),
    },
  ],
  [
    "packages/feature/tools/test/delete-file.test.ts",
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

/** The variables that name a program a listed test needs, such as ZHIYIN_BLENDER. */
const programs = new Set(
  [...expected.values()].flatMap(
    ({ needs }) => needs.match(/ZHIYIN_[A-Z_]+/g) ?? [],
  ),
);

/**
 * The test files, given as [path, source], that read a program's path but are
 * not listed where they may skip. The run would fail on them only at its end;
 * read from the source, they are named before any test runs.
 */
export function unlistedToolTests(files) {
  return files
    .filter(
      ([path, source]) =>
        !expected.has(path) &&
        [...source.matchAll(/process\.env(?:\.|\[["'])(ZHIYIN_[A-Z_]+)/g)].some(
          ([, name]) => programs.has(name),
        ),
    )
    .map(([path]) => path);
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
