/**
 * Writes the lock of the default Python packages, `default-packages.json`
 * beside this folder: each package the default environment asks for, and each
 * one they need, pinned to the version published by a date, with the SHA-256
 * of every file of that version. The default environment installs from it
 * with `--require-hashes`, so a file that differs is refused (ADR 0026).
 *
 * Run by hand with a release, when the date moves, with the uv Zhiyin pins:
 *
 *   node packages/python-sandbox/scripts/lock-default-packages.mjs --uv <uv.exe> --published-by 2026-10-18T00:00:00Z
 *
 * The packages asked for, the Python and the platform are read from the lock
 * as it is: change `asked` there first to change what the default environment
 * holds. Without `--published-by` the lock's own date is kept.
 * `--packages a,b` asks for those instead, and `--out <file>` writes the lock
 * there instead.
 */

import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import { parseArgs } from "node:util";

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
  const current = JSON.parse(await readFile(shipped, "utf8"));
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
  const lock = {
    python: current.python,
    platform: current.platform,
    publishedBy,
    asked,
    locked: parseCompiled(compiled.stdout),
  };
  const out = values.out ?? shipped;
  await writeFile(out, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
  const hashes = lock.locked.reduce(
    (sum, entry) => sum + entry.hashes.length,
    0,
  );
  process.stdout.write(
    `Locked ${lock.locked.length} packages, ${hashes} hashes, as published by ${publishedBy}, in ${out}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
