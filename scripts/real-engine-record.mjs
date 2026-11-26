/**
 * The record of the tests that need a real engine, and the release's check
 * of it.
 *
 * The tests that run a real Blender or the real CAD environment run only on
 * a PC that has them and a graphics card, never in CI, and they are what
 * shows the 3D and CAD studios' Python works. As a Vitest reporter, this
 * keeps in `real-engine-record.json`, beside it, an entry for each such file
 * that ran: the commit it ran on, a fingerprint of the files that file's run
 * loads as that commit holds them, the Blender and build123d it ran with, and
 * how many of its tests passed, failed and were skipped. It writes only from
 * a working tree with no change but the record itself, so the commit named is
 * the code that ran, and says at a run's start when that run will not be
 * written. A file whose tests all skipped leaves its entry as it was.
 *
 *   node scripts/real-engine-record.mjs --check
 *
 * is the release gate's step: it fails unless every such file ran whole and
 * passed, with the Blender and build123d the app pins, on code that nothing
 * that file's run loads has changed since: no file of a package it loads
 * from, no file it loads outside the packages, and none of the workspace's
 * build files. A package's test folders count only when the run loads a file
 * from one of them; otherwise they hold that package's own tests. It names
 * each file that falls short, and why. The fingerprint shows it even when a
 * merge rewrote the commit the run named.
 *
 * That check assumes the code a run loads reads no file of a test folder it
 * does not count. A repository test holds it for paths written out
 * relatively, as `new URL("../test/x.json", import.meta.url)`; a path built
 * from parts is not checked.
 *
 *   node scripts/real-engine-record.mjs --stale
 *
 * prints those files, one path to a line, and
 *
 *   node scripts/real-engine-record.mjs --run
 *
 * runs exactly them, with this reporter, after refusing a working tree with
 * changes, an engine the files need that no variable names, and an engine
 * other than the pinned one.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { expected } from "./skipped-tests.mjs";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const recordName = "scripts/real-engine-record.json";

/** The variable each real engine is given in, which a test file's needs name. */
const engineVariables = {
  blender: "ZHIYIN_BLENDER",
  build123d: "ZHIYIN_CAD_PYTHON",
};

/** The skip list's files that need a real engine, each with the engines it needs. */
export function engineFiles(skipList) {
  const found = new Map();
  for (const [file, { needs }] of skipList) {
    const named = Object.keys(engineVariables).filter((engine) =>
      new RegExp(`${engineVariables[engine]}(?![A-Z_])`).test(needs),
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
 * ran gets the run's entry, with the fingerprint `loads` holds for it; the
 * others keep theirs; entries of files no longer listed go. Files are in
 * order, so a run changes only its lines.
 */
export function recorded(
  record,
  counts,
  files,
  { commit, loads, versions, at },
) {
  const next = {};
  for (const file of [...files.keys()].sort()) {
    const count = counts.get(file);
    if (count && count.passed + count.failed > 0) {
      const fingerprint = loads?.get(file);
      next[file] = {
        commit,
        ...(fingerprint === undefined ? {} : { loads: fingerprint }),
        ran: at,
        ...count,
      };
      for (const engine of files.get(file))
        next[file][engine] = versions[engine] ?? null;
    } else if (record?.[file]) next[file] = record[file];
  }
  return next;
}

/** What every test run loads besides its test files: the runner's configuration and the setup it names. */
const runnerFiles = ["vitest.config.ts", "scripts/test-tools.mjs"];

/** Files outside the packages that shape what any package builds and runs with. */
const buildFiles = new Set([
  ".gitattributes",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
]);

const codeExtensions = [".ts", ".tsx", ".mts", ".js", ".mjs"];

/** The folder of the workspace package a path is in, from the repository, if it is in one. */
function packageFolder(path) {
  return /^(packages\/[^/]+\/[^/]+|apps\/[^/]+)\//.exec(path)?.[1];
}

/** The workspace's packages, each name with its folder from the repository. */
function workspacePackages(root) {
  const folders = [];
  const within = (path) =>
    existsSync(join(root, path))
      ? readdirSync(join(root, path), { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => `${path}/${entry.name}`)
      : [];
  for (const layer of within("packages")) folders.push(...within(layer));
  folders.push(...within("apps"));
  const packages = new Map();
  for (const folder of folders) {
    const manifest = join(root, folder, "package.json");
    if (existsSync(manifest))
      packages.set(JSON.parse(readFileSync(manifest, "utf8")).name, folder);
  }
  return packages;
}

/** The file an import names, as TypeScript finds it: a `.js` import may be written `.ts`. */
function existingFile(base) {
  const candidates = [
    base,
    base.replace(/\.js$/, ".ts"),
    base.replace(/\.js$/, ".tsx"),
    base.replace(/\.mjs$/, ".mts"),
    ...codeExtensions.map((extension) => `${base}${extension}`),
    ...codeExtensions.map((extension) => join(base, `index${extension}`)),
  ];
  return candidates.find(
    (candidate) => existsSync(candidate) && statSync(candidate).isFile(),
  );
}

function importedFile(root, from, specifier, packages) {
  const named = specifier.replace(/\?.*$/, "");
  if (named.startsWith("."))
    return existingFile(join(dirname(join(root, from)), named));
  const workspace = /^(@zhiyin\/[^/]+)(\/.+)?$/.exec(named);
  const folder = workspace && packages.get(workspace[1]);
  if (!folder) return undefined;
  const manifest = JSON.parse(
    readFileSync(join(root, folder, "package.json"), "utf8"),
  );
  const entry = workspace[2] ? `.${workspace[2]}` : ".";
  const target =
    manifest.exports?.[entry] ?? (entry === "." ? manifest.main : undefined);
  return typeof target === "string"
    ? existingFile(join(root, folder, target))
    : undefined;
}

/**
 * The files a run of these test files loads, from the repository: each test
 * file and what it imports, statically or not, through relative paths and the
 * workspace's packages, with the runner's configuration and setup. Programs
 * from outside the workspace are not followed.
 */
export function reachedFiles(root, testFiles) {
  return reach(root, testFiles, workspacePackages(root), new Map());
}

/** For each test file, the files a run of that file alone loads, as `reachedFiles` follows them. */
export function reachedByFile(root, testFiles) {
  const packages = workspacePackages(root);
  const imports = new Map();
  return new Map(
    testFiles.map((file) => [file, reach(root, [file], packages, imports)]),
  );
}

/** `imports` keeps each file's imported files once read, for the next reach. */
function reach(root, testFiles, packages, imports) {
  const reached = new Set();
  const waiting = [...runnerFiles, ...testFiles].filter((file) =>
    existsSync(join(root, file)),
  );
  while (waiting.length) {
    const file = waiting.pop();
    if (reached.has(file)) continue;
    reached.add(file);
    if (!imports.has(file)) imports.set(file, importsOf(root, file, packages));
    waiting.push(...imports.get(file));
  }
  return reached;
}

function importsOf(root, file, packages) {
  if (!codeExtensions.includes(extname(file))) return [];
  const { importedFiles } = ts.preProcessFile(
    readFileSync(join(root, file), "utf8"),
    true,
    true,
  );
  return importedFiles
    .map(({ fileName }) => importedFile(root, file, fileName, packages))
    .filter(Boolean)
    .map((found) => relative(root, found).replaceAll("\\", "/"));
}

/** The test-only folder of a workspace package a path is in, from the repository, if it is in one. */
function testFolder(path) {
  return /^((?:packages\/[^/]+\/[^/]+|apps\/[^/]+)\/(?:test|system-boundary|installed))\//.exec(
    path,
  )?.[1];
}

/** Whether a change to a path can alter a run that loads the reached files, as `changesThatCount` says. */
function counts(reached) {
  const folders = new Set([...reached].map(packageFolder).filter(Boolean));
  const testedFrom = new Set(
    [...reached].filter(testFolder).map(packageFolder),
  );
  return (path) =>
    buildFiles.has(path) ||
    reached.has(path) ||
    (folders.has(packageFolder(path)) &&
      (!testFolder(path) || testedFrom.has(packageFolder(path))));
}

/**
 * The changes, among those named, that can alter a run that loads the
 * reached files: any file of a package it loads from, as the scripts and pins
 * a package reads while it runs are not imported; a file it loads outside the
 * packages; and the workspace's build files. A package's test folders
 * (`test`, `system-boundary`, `installed`) count whole when the run loads a
 * file from any of them, such as the test file itself or a test helper, so
 * the fixtures a test reads beside them count too; otherwise they hold only
 * that package's own tests, which the run does not load, and do not count.
 * That rests on the code a run loads reading no file of an uncounted test
 * folder by a path it builds: `uncountedReads` finds those it names by a
 * relative path written out, and nothing finds one built otherwise.
 */
export function changesThatCount(changed, reached) {
  return changed.filter(counts(reached));
}

/** A relative path written out as a string, with no part filled in at run time. */
const relativeLiteral = /(["'`])(\.{1,2}\/[^"'`\n$]*)\1/g;

/**
 * The relative paths, written in the code each run loads, that name a file of
 * a test folder that run does not count, one sentence each; none when there
 * are none. A path built from parts is not seen.
 */
export function uncountedReads(root, reachedEach) {
  const named = new Map();
  const found = new Set();
  for (const [testFile, reached] of reachedEach) {
    const countsHere = counts(reached);
    for (const file of reached) {
      if (!codeExtensions.includes(extname(file))) continue;
      if (!named.has(file)) named.set(file, relativePaths(root, file));
      for (const path of named.get(file))
        if (testFolder(path) && !countsHere(path))
          found.add(
            `${testFile}: ${file} names ${path}, a test folder its run does not count.`,
          );
    }
  }
  return [...found];
}

function relativePaths(root, file) {
  const source = readFileSync(join(root, file), "utf8");
  return [...source.matchAll(relativeLiteral)].map(([, , literal]) =>
    relative(root, join(root, dirname(file), literal)).replaceAll("\\", "/"),
  );
}

/**
 * The fingerprint of the files a run that loads the reached files depends
 * on, as `changesThatCount` counts them, from a tree's listing of each path
 * with its blob: the same files give the same fingerprint whatever commit
 * holds them, so a run stays true of a merge that rewrote its commit.
 */
export function loadsFingerprint(listing, reached) {
  const countsHere = counts(reached);
  const counted = listing
    .filter(({ path }) => countsHere(path))
    .map(({ path, blob }) => `${blob} ${path}`)
    .sort();
  return createHash("sha256").update(counted.join("\n")).digest("hex");
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
 * this one, or null when the history does not hold it; `reached` holds, for
 * each file, the files a run of it loads, and `loads` this commit's
 * fingerprint of them. A run whose fingerprint is this commit's ran on the
 * same code; otherwise the history between says whether what it loads
 * changed.
 */
export function recordProblems(record, files, context) {
  if (!record)
    return [
      `There is no record of the real-engine tests: run them on this commit to write ${recordName}.`,
    ];
  return [...files].flatMap(([file, needed]) =>
    fileProblems(file, needed, record[file], context),
  );
}

/** The real-engine files whose record `recordProblems` refuses, in the files' order. */
export function staleFiles(record, files, context) {
  return [...files]
    .filter(
      ([file, needed]) =>
        !record || fileProblems(file, needed, record[file], context).length,
    )
    .map(([file]) => file);
}

function fileProblems(
  file,
  needed,
  entry,
  { changedSince, loads, pins, reached },
) {
  if (!entry) return [`${file}: no run recorded.`];
  const problems = [];
  const short = String(entry.commit).slice(0, 8);
  const same = entry.loads !== undefined && entry.loads === loads?.get(file);
  const changed = same ? [] : changedSince(entry.commit);
  if (changed === null)
    problems.push(
      `${file}: ran on ${short}, which this repository's history does not hold.`,
    );
  else {
    const code = changesThatCount(changed, reached.get(file) ?? new Set());
    if (code.length)
      problems.push(
        `${file}: ran on ${short}, and ${code.length === 1 ? "1 file it loads from" : `${code.length} files it loads from`} changed since: ${code.slice(0, 3).join(", ")}${code.length > 3 ? ", ..." : ""}.`,
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
  return problems;
}

/**
 * The paths `git status --porcelain=v1 -z --untracked-files=all` lists as
 * differing from the commit, a rename by its new name, the record aside.
 */
export function changesBesideRecord(status) {
  const entries = status.split("\0");
  const paths = [];
  for (let at = 0; at < entries.length; at += 1) {
    const entry = entries[at];
    if (!entry) continue;
    paths.push(entry.slice(3));
    // A rename or copy is followed by the name it had.
    if (/^[RC]/.test(entry)) at += 1;
  }
  return paths.filter((path) => path !== recordName);
}

/** Why a run on a tree with these changes is not recorded. */
function unrecordedReason(changes) {
  return `${changes.length === 1 ? "1 file differs" : `${changes.length} files differ`} from the commit, such as ${changes[0]}, so no commit names the code that runs.`;
}

/**
 * Why a run of the files to run again would not be recorded, or not on the
 * engines a release needs, one sentence per reason; none when it may start.
 * `changes` are the working tree's, `env` the variables the run is given,
 * and `versions` the engines those variables name, as each reports itself.
 */
export function runRefusals(stale, files, { changes, env, versions, pins }) {
  const refusals = [];
  if (changes.length)
    refusals.push(
      `${unrecordedReason(changes)} Commit them or set them aside first.`,
    );
  for (const engine of Object.keys(engineVariables)) {
    const needing = stale.filter((file) => files.get(file)?.includes(engine));
    if (!needing.length) continue;
    const variable = engineVariables[engine];
    if (!env[variable])
      refusals.push(
        `${variable} is not set, and ${needing.length === 1 ? "1 file to run needs" : `${needing.length} files to run need`} it.`,
      );
    else if (versions[engine] !== pins[engine])
      refusals.push(
        `${variable} names ${engineWords[engine](versions[engine], pins[engine])}.`,
      );
  }
  return refusals;
}

/**
 * What a run's start says when it will run a real-engine file, as the skip
 * list says one runs with these variables, on a tree with changes: that the
 * run will not be recorded, and why. `changes()` is read only then.
 */
export function recordingNotice(runFiles, skipList, env, changes) {
  const engines = engineFiles(skipList);
  const running = runFiles.filter(
    (file) => engines.has(file) && !skipList.get(file).without(env),
  );
  if (!running.length) return undefined;
  const found = changes();
  if (!found.length) return undefined;
  return `Real-engine record: this run will not be written to ${recordName}. ${unrecordedReason(found)}`;
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

const changesFrom = new Map();

/** Read once for each commit, as many files ran on the same one. */
function changedSince(commit) {
  if (!changesFrom.has(commit)) {
    let changed = null;
    try {
      git("cat-file", "-e", `${commit}^{commit}`);
      changed = git("diff", "--name-only", commit, "HEAD")
        .split("\n")
        .filter(Boolean);
    } catch {
      // The history does not hold it.
    }
    changesFrom.set(commit, changed);
  }
  return changesFrom.get(commit);
}

/** Each file of this commit's tree with its blob. */
function headListing() {
  return git("ls-tree", "-r", "--format=%(objectname) %(path)", "HEAD")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const at = line.indexOf(" ");
      return { blob: line.slice(0, at), path: line.slice(at + 1) };
    });
}

function readRecord() {
  const path = join(repository, recordName);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined;
}

/** The tracked or untracked files that differ from the commit, the record aside. */
function treeChanges() {
  return changesBesideRecord(
    git("status", "--porcelain=v1", "-z", "--untracked-files=all"),
  );
}

/** Each real-engine file's fingerprint of what its run loads, as this commit holds it. */
function headLoads(reached) {
  const listing = headListing();
  return new Map(
    [...reached].map(([file, loads]) => [
      file,
      loadsFingerprint(listing, loads),
    ]),
  );
}

/** The record's check on this commit: the real-engine files and the context `recordProblems` takes. */
function checkOnHead() {
  const files = engineFiles(expected);
  const reached = reachedByFile(repository, [...files.keys()]);
  return {
    files,
    record: readRecord(),
    context: {
      changedSince,
      loads: headLoads(reached),
      pins: pinnedVersions(),
      reached,
    },
  };
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

  onTestRunStart(specifications) {
    const notice = recordingNotice(
      specifications.map(({ moduleId }) =>
        relative(this.#root, moduleId).replaceAll("\\", "/"),
      ),
      expected,
      process.env,
      treeChanges,
    );
    if (notice) console.log(`\n${notice}\n`);
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
    const changes = treeChanges();
    if (changes.length) {
      console.log(
        `\nReal-engine record not written: ${unrecordedReason(changes)}`,
      );
      return;
    }
    const record = recorded(readRecord(), counts, files, {
      commit: git("rev-parse", "HEAD").trim(),
      loads: headLoads(reachedByFile(repository, ran)),
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

/** Runs the files with this reporter, and the skip list's, as `pnpm test` names them. */
function runFiles(files) {
  const { status } = spawnSync(
    process.execPath,
    [
      join(repository, "node_modules/vitest/vitest.mjs"),
      "run",
      "--reporter=default",
      "--reporter=./scripts/skipped-tests.mjs",
      "--reporter=./scripts/real-engine-record.mjs",
      ...files,
    ],
    { cwd: repository, stdio: "inherit" },
  );
  return status ?? 1;
}

const command =
  process.argv[1] === fileURLToPath(import.meta.url)
    ? process.argv[2]
    : undefined;

if (command === "--check") {
  const { files, record, context } = checkOnHead();
  const problems = recordProblems(record, files, context);
  if (problems.length) {
    console.log(
      "The real-engine tests have not run whole and passed on this commit:",
    );
    for (const problem of problems) console.log(`  ${problem}`);
    console.log(
      "`node scripts/real-engine-record.mjs --run` runs those files again.",
    );
    process.exitCode = 1;
  } else
    console.log(
      `The real-engine tests ran whole and passed on this commit: ${files.size} files.`,
    );
} else if (command === "--stale") {
  const { files, record, context } = checkOnHead();
  for (const file of staleFiles(record, files, context)) console.log(file);
} else if (command === "--run") {
  const { files, record, context } = checkOnHead();
  const stale = staleFiles(record, files, context);
  if (!stale.length)
    console.log(
      `Nothing to run: the real-engine tests ran whole and passed on this commit, ${files.size} files.`,
    );
  else {
    const refusals = runRefusals(stale, files, {
      changes: treeChanges(),
      env: process.env,
      versions: engineVersions(process.env),
      pins: context.pins,
    });
    if (refusals.length) {
      console.log(`Not run: ${stale.length} real-engine files to run again.`);
      for (const refusal of refusals) console.log(`  ${refusal}`);
      process.exitCode = 1;
    } else {
      console.log(`Running ${stale.length} real-engine files again:`);
      for (const file of stale) console.log(`  ${file}`);
      process.exitCode = runFiles(stale);
    }
  }
} else if (command !== undefined) {
  console.log(
    "Usage: node scripts/real-engine-record.mjs --check | --stale | --run",
  );
  process.exitCode = 2;
}
