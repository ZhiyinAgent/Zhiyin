/**
 * Writes the lock of the default Python packages, `default-packages.json`
 * beside this folder: each package the default environment asks for, and each
 * one they need, pinned to the version published by a date, with the SHA-256
 * of every file of that version. The default environment installs from it
 * with `--require-hashes`, so a file that differs is refused (ADR 0020).
 *
 * Run by hand with a release, when the date moves, with the uv Zhiyin pins:
 *
 *   node packages/feature/python-sandbox/scripts/lock-default-packages.mjs --uv <uv.exe> --published-by 2026-10-18T00:00:00Z
 *
 * Beside each package it records the size of the file uv installs of it for
 * the lock's Python and platform, as the Python Package Index publishes it,
 * and the size of the Python build this uv downloads for that Python, so
 * installing can say beforehand about how much it downloads.
 *
 * `--out <file>` writes the lock there instead. The packages asked for, the
 * Python, the platform and the date are read from the lock being written, as
 * it is: change `asked` there first to change what its environment holds.
 * Without `--published-by` its own date is kept, and `--packages a,b` asks for
 * those instead. A lock not written yet starts from the default one. A lock
 * of an environment another feature keeps in the sandbox lives beside that
 * feature, as the CAD studio's does, and is written so:
 *
 *   node packages/feature/python-sandbox/scripts/lock-default-packages.mjs --uv <uv.exe> --out packages/feature/cad-studio/cad-packages.json
 */

import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import { parseArgs } from "node:util";

import { format } from "prettier";

const shipped = fileURLToPath(
  new URL("../default-packages.json", import.meta.url),
);

/**
 * The lock in what `uv pip compile --generate-hashes --no-header
 * --no-annotate` prints: a `name==version` line for each package, then one
 * `--hash=sha256:…` line for each of its files. Any other line is refused, so
 * nothing but pinned, hashed packages reaches the lock.
 */
function parseCompiled(text) {
  const locked = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const pinned = /^([a-z0-9][a-z0-9._-]*)==([A-Za-z0-9.+!_-]+)(?: \\)?$/.exec(
      line,
    );
    const hash = /^ +--hash=(sha256:[0-9a-f]{64})(?: \\)?$/.exec(line);
    if (pinned)
      locked.push({ name: pinned[1], version: pinned[2], hashes: [] });
    else if (hash && locked.length) locked.at(-1).hashes.push(hash[1]);
    else throw new Error(`uv printed a line the lock cannot hold: ${line}`);
  }
  const unhashed = locked.filter((entry) => !entry.hashes.length);
  if (!locked.length || unhashed.length)
    throw new Error(
      `uv locked no hash for ${unhashed.map((entry) => entry.name).join(", ") || "anything"}.`,
    );
  return locked;
}

/** The wheel platform tag of the platforms a lock can be written for. */
const wheelPlatforms = { "x86_64-pc-windows-msvc": "win_amd64" };

/**
 * Whether a wheel installs on this Python and platform, by the tags in its
 * name: a pure wheel for Python 3, one built for this CPython, or one for the
 * stable ABI of a CPython no newer than this one.
 */
function installs(filename, python, platform) {
  const tags = /-([^-]+)-([^-]+)-([^-]+)\.whl$/.exec(filename);
  if (!tags) return false;
  const [, pythons, abis, platforms] = tags.map((tag) => tag.split("."));
  const [major, minor] = python.split(".").map(Number);
  const cpython = `cp${major}${minor}`;
  if (!platforms.some((tag) => tag === "any" || tag === platform)) return false;
  return pythons.some((tag) => {
    if (tag === `py${major}` || tag === `py${major}${minor}`)
      return abis.includes("none");
    if (tag === cpython)
      return abis.some(
        (abi) => abi === cpython || abi === "none" || abi === "abi3",
      );
    const stable = /^cp(\d)(\d+)$/.exec(tag);
    return (
      stable !== null &&
      Number(stable[1]) === major &&
      Number(stable[2]) <= minor &&
      abis.includes("abi3")
    );
  });
}

/**
 * The size of the file uv installs of one locked package: among the files the
 * index publishes for that version whose SHA-256 the lock holds, the largest
 * wheel that installs here, so the estimate errs high.
 */
async function installedSize(entry, python, platform) {
  const answer = await fetch(
    `https://pypi.org/pypi/${entry.name}/${entry.version}/json`,
  );
  if (!answer.ok)
    throw new Error(
      `The package index did not describe ${entry.name} ${entry.version} (HTTP ${answer.status}).`,
    );
  const locked = new Set(
    entry.hashes.map((hash) => hash.replace(/^sha256:/, "")),
  );
  const sizes = (await answer.json()).urls
    .filter(
      (file) =>
        locked.has(file.digests.sha256) &&
        installs(file.filename, python, platform),
    )
    .map((file) => file.size);
  if (!sizes.length)
    throw new Error(
      `No wheel of ${entry.name} ${entry.version} the lock holds installs on Python ${python} for ${platform}.`,
    );
  return Math.max(...sizes);
}

/**
 * The CPython build this uv downloads for the lock's Python, as `uv python
 * list` names it, and its size, as the site that serves it answers.
 */
async function pythonBuild(uv, python, environment) {
  const listed = spawnSync(
    uv,
    [
      "python",
      "list",
      python,
      "--only-downloads",
      "--output-format",
      "json",
      "--no-config",
    ],
    { encoding: "utf8", cwd: tmpdir(), env: environment },
  );
  if (listed.error) throw listed.error;
  if (listed.status !== 0)
    throw new Error(
      `uv could not list its Python downloads:\n${listed.stderr}`,
    );
  const build = JSON.parse(listed.stdout).find(
    (item) => item.implementation === "cpython" && item.variant === "default",
  );
  if (!build) throw new Error(`uv offers no CPython ${python} download.`);
  const answer = await fetch(build.url, { method: "HEAD", redirect: "follow" });
  const bytes = Number(answer.headers.get("content-length"));
  if (!answer.ok || !bytes)
    throw new Error(
      `${build.url} did not say its size (HTTP ${answer.status}).`,
    );
  return { version: build.version, bytes };
}

/** uv's variables, and pip's, which could name another index; everything else is passed on, proxies included. */
function withoutIndexSettings(environment) {
  return Object.fromEntries(
    Object.entries(environment).filter(([name]) => !/^(UV|PIP)_/i.test(name)),
  );
}

async function main() {
  const { values } = parseArgs({
    options: {
      uv: { type: "string" },
      "published-by": { type: "string" },
      packages: { type: "string" },
      out: { type: "string" },
    },
  });
  if (!values.uv) throw new Error("Name the uv program with --uv.");
  const out = values.out ?? shipped;
  // The lock being written is the one read: its own date, Python, platform
  // and packages are kept unless given. A new lock starts from the default.
  const current = JSON.parse(
    await readFile(out, "utf8").catch(() => readFile(shipped, "utf8")),
  );
  const publishedBy = values["published-by"] ?? current.publishedBy;
  if (Number.isNaN(Date.parse(publishedBy)))
    throw new Error(`--published-by ${publishedBy} is not a date.`);
  const asked = values.packages ? values.packages.split(",") : current.asked;
  const compiled = spawnSync(
    values.uv,
    [
      "pip",
      "compile",
      "--no-config",
      "--quiet",
      "--generate-hashes",
      "--no-build",
      "--no-header",
      "--no-annotate",
      "--exclude-newer",
      publishedBy,
      "--python-version",
      current.python,
      "--python-platform",
      current.platform,
      "-",
    ],
    {
      input: `${asked.join("\n")}\n`,
      encoding: "utf8",
      // Away from any project, whose settings uv would otherwise read.
      cwd: tmpdir(),
      env: withoutIndexSettings(process.env),
    },
  );
  if (compiled.error) throw compiled.error;
  if (compiled.status !== 0)
    throw new Error(`uv could not lock the packages:\n${compiled.stderr}`);
  const platform = wheelPlatforms[current.platform];
  if (!platform)
    throw new Error(`No wheel platform is known for ${current.platform}.`);
  const locked = [];
  for (const entry of parseCompiled(compiled.stdout))
    locked.push({
      name: entry.name,
      version: entry.version,
      bytes: await installedSize(entry, current.python, platform),
      hashes: entry.hashes,
    });
  const lock = {
    python: current.python,
    platform: current.platform,
    publishedBy,
    pythonBuild: await pythonBuild(
      values.uv,
      current.python,
      withoutIndexSettings(process.env),
    ),
    asked,
    locked,
  };
  // Formatted as the gate checks it, so a new lock passes as it is written.
  await writeFile(
    out,
    await format(JSON.stringify(lock), { parser: "json" }),
    "utf8",
  );
  const hashes = lock.locked.reduce(
    (sum, entry) => sum + entry.hashes.length,
    0,
  );
  const bytes = lock.locked.reduce((sum, entry) => sum + entry.bytes, 0);
  process.stdout.write(
    `Locked ${lock.locked.length} packages, ${hashes} hashes, as published by ${publishedBy}, in ${out}: ${Math.round(bytes / 1e6)} MB of packages and ${Math.round(lock.pythonBuild.bytes / 1e6)} MB of Python ${lock.pythonBuild.version}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
