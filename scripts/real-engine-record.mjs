/**
 * The record of the tests that need a real engine, and the release's check
 * of it.
 *
 * The tests that run a real Blender or the real CAD environment run only on
 * a PC that has them and a graphics card, never in CI, and they are what
 * shows the 3D and CAD studios' Python works. As a Vitest reporter, this
 * keeps in `real-engine-record.json`, beside it, an entry for each such file
 * that ran: the commit it ran on, the Blender and build123d it ran with, and
 * how many of its tests passed, failed and were skipped. It writes only from
 * a working tree with no change but the record itself, so the commit named is
 * the code that ran. A file whose tests all skipped leaves its entry as it was.
 *
 *   node scripts/real-engine-record.mjs --check
 *
 * is the release gate's step: it fails unless every such file ran whole and
 * passed, with the Blender and build123d the app pins, on this commit or on
 * one this commit differs from only by the record.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expected } from "./skipped-tests.mjs";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const recordName = "scripts/real-engine-record.json";

/** The engines a test file's needs name, by the variable each is given in. */
const engines = {
  blender: /ZHIYIN_BLENDER(?![A-Z_])/,
  build123d: /ZHIYIN_CAD_PYTHON(?![A-Z_])/,
};

/** The skip list's files that need a real engine, each with the engines it needs. */
export function engineFiles(skipList) {
  const found = new Map();
  for (const [file, { needs }] of skipList) {
    const named = Object.keys(engines).filter((engine) =>
      engines[engine].test(needs),
    );
    if (named.length) found.set(file, named);
  }
  return found;
}

/** Each file's passed, failed and skipped tests in a run, by its path from the repository. */
export function runCounts(testModules, root) {
  const counts = new Map();
  for (const module of testModules) {
    const file = relative(root, module.moduleId).replaceAll("\\", "/");
    const count = { passed: 0, failed: 0, skipped: 0 };
    for (const test of module.children.allTests()) {
      const state = test.result().state;
      if (state in count) count[state] += 1;
    }
    counts.set(file, count);
  }
  return counts;
}

/**
 * The record after a run: each real-engine file at least one of whose tests
 * ran gets the run's entry; the others keep theirs; entries of files no
 * longer listed go. Files are in order, so a run changes only its lines.
 */
export function recorded(record, counts, files, { commit, versions, at }) {
  const next = {};
  for (const file of [...files.keys()].sort()) {
    const count = counts.get(file);
    if (count && count.passed + count.failed > 0) {
      next[file] = { commit, ran: at, ...count };
      for (const engine of files.get(file))
        next[file][engine] = versions[engine] ?? null;
    } else if (record?.[file]) next[file] = record[file];
  }
  return next;
}

const engineWords = {
  blender: (found, pin) =>
    `Blender ${found ?? "unknown"}, where the app installs ${pin}`,
  build123d: (found, pin) =>
    `build123d ${found ?? "unknown"}, where the CAD environment pins ${pin}`,
};

/**
 * Why a record does not show this commit's real-engine tests run whole and
 * passing, one sentence per file and reason; none when it does.
 * `changedSince(commit)` answers the files changed between that commit and
 * this one, or null when the history does not hold it.
 */
export function recordProblems(record, files, { changedSince, pins }) {
  if (!record)
    return [
      `There is no record of the real-engine tests: run them on this commit to write ${recordName}.`,
    ];
  const problems = [];
  for (const [file, needed] of files) {
    const entry = record[file];
    if (!entry) {
      problems.push(`${file}: no run recorded.`);
      continue;
    }
    const short = String(entry.commit).slice(0, 8);
    const changed = changedSince(entry.commit);
    if (changed === null)
      problems.push(
        `${file}: ran on ${short}, which this repository's history does not hold.`,
      );
    else {
      const code = changed.filter((path) => path !== recordName);
      if (code.length)
        problems.push(
          `${file}: ran on ${short}, and ${code.length} files changed since, such as ${code[0]}.`,
        );
    }
    if (entry.failed > 0)
      problems.push(`${file}: ${entry.failed} failed when it ran on ${short}.`);
    if (entry.skipped > 0)
      problems.push(
        `${file}: ${entry.skipped} skipped when it ran on ${short}; a release needs every test run.`,
      );
    for (const engine of needed)
      if (entry[engine] !== pins[engine])
        problems.push(
          `${file}: ran with ${engineWords[engine](entry[engine], pins[engine])}.`,
        );
  }
  return problems;
}

/** The Blender the app installs and the build123d the CAD environment's lock pins. */
function pinnedVersions() {
  const toolchains = readFileSync(
    join(repository, "packages/feature/toolchains/src/toolchains.ts"),
    "utf8",
  );
  const blender = /blender-(\d+\.\d+\.\d+)-windows-x64\.zip/.exec(
    toolchains,
  )?.[1];
  const lock = JSON.parse(
    readFileSync(
      join(repository, "packages/feature/cad-studio/cad-packages.json"),
      "utf8",
    ),
  );
  const build123d = lock.locked.find(
    ({ name }) => name === "build123d",
  )?.version;
  if (!blender || !build123d)
    throw new Error(
      "The pinned Blender or build123d version could not be read.",
    );
  return { blender, build123d };
}

function git(...args) {
  return execFileSync("git", args, {
    cwd: repository,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function changedSince(commit) {
  try {
    git("cat-file", "-e", `${commit}^{commit}`);
  } catch {
    return null;
  }
  return git("diff", "--name-only", commit, "HEAD").split("\n").filter(Boolean);
}

function readRecord() {
  const path = join(repository, recordName);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined;
}

/** The tracked or untracked files that differ from the commit, the record aside. */
function changesBesideRecord() {
  return git("status", "--porcelain=v1", "--untracked-files=all")
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3))
    .filter((path) => path !== recordName);
}

/** The versions of the engines the environment names, as each reports itself. */
function engineVersions(env) {
  const versions = {};
  const run = (program, args) =>
    execFileSync(program, args, {
      encoding: "utf8",
      timeout: 120_000,
      windowsHide: true,
    });
  if (env.ZHIYIN_BLENDER)
    try {
      versions.blender = /Blender (\d+\.\d+\.\d+)/.exec(
        run(env.ZHIYIN_BLENDER, ["--factory-startup", "--version"]),
      )?.[1];
    } catch {
      // Recorded as unknown, which the release check refuses.
    }
  if (env.ZHIYIN_CAD_PYTHON)
    try {
      versions.build123d = run(env.ZHIYIN_CAD_PYTHON, [
        "-I",
        "-c",
        "from importlib.metadata import version; print(version('build123d'))",
      ]).trim();
    } catch {
      // As above.
    }
  return versions;
}

export default class RealEngineRecord {
  #root = repository;

  onInit(vitest) {
    this.#root = vitest.config.root;
  }

  onTestRunEnd(testModules, _errors, reason) {
    if (reason === "interrupted") return;
    const files = engineFiles(expected);
    const counts = runCounts(testModules, this.#root);
    const ran = [...files.keys()].filter((file) => {
      const count = counts.get(file);
      return count && count.passed + count.failed > 0;
    });
    if (!ran.length) return;
    const changes = changesBesideRecord();
    if (changes.length) {
      console.log(
        `\nReal-engine record not written: ${changes.length} files differ from the commit, such as ${changes[0]}, so no commit names the code that ran.`,
      );
      return;
    }
    const record = recorded(readRecord(), counts, files, {
      commit: git("rev-parse", "HEAD").trim(),
      versions: engineVersions(process.env),
      at: new Date().toISOString(),
    });
    const path = join(repository, recordName);
    writeFileSync(`${path}.tmp`, `${JSON.stringify(record, null, 2)}\n`);
    renameSync(`${path}.tmp`, path);
    console.log(
      `\nReal-engine record: ${ran.length} files written to ${recordName}.`,
    );
  }
}

if (
  process.argv[1] === fileURLToPath(import.meta.url) &&
  process.argv[2] === "--check"
) {
  const files = engineFiles(expected);
  const problems = recordProblems(readRecord(), files, {
    changedSince,
    pins: pinnedVersions(),
  });
  if (problems.length) {
    console.log(
      "The real-engine tests have not run whole and passed on this commit:",
    );
    for (const problem of problems) console.log(`  ${problem}`);
    process.exitCode = 1;
  } else
    console.log(
      `The real-engine tests ran whole and passed on this commit: ${files.size} files.`,
    );
}
