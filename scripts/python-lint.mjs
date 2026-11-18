#!/usr/bin/env node
/**
 * The gate's Python lint: Ruff, at the version `ruff.toml` pins, over every
 * Python file in the repository, with the rules that file chooses.
 *
 *   node scripts/python-lint.mjs [ruff check arguments]
 *
 * Ruff is run by uv, which fetches that exact release from the Python Package
 * Index once and keeps it. The uv is the one `ZHIYIN_UV` names, or else the
 * release the app pins, installed and verified as the tests install it: into
 * `ZHIYIN_TEST_TOOLS` when that names a folder, and otherwise into
 * `node_modules/.cache/zhiyin-tools`.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveWorkspaceTypeScript } from "./workspace-typescript.mjs";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The exact Ruff release `ruff.toml` requires, which is the one run. */
export function pinnedRuff(config) {
  const version = /^required-version\s*=\s*"==(\d+\.\d+\.\d+)"\s*$/m.exec(
    config,
  )?.[1];
  if (!version)
    throw new Error(
      'ruff.toml must pin one release, as required-version = "==X.Y.Z".',
    );
  return version;
}

/** uv's executable: the one named, or the pinned release, installed if needed. */
export async function uv(env) {
  if (env.ZHIYIN_UV) return env.ZHIYIN_UV;
  resolveWorkspaceTypeScript();
  const { prepareTestTools } = await import(
    pathToFileURL(join(repository, "scripts/test-tools.mjs")).href
  );
  const { fetchDownload, pinnedToolchains } =
    await import("@zhiyin/toolchains");
  const found = { ...env };
  await prepareTestTools({
    folder:
      env.ZHIYIN_TEST_TOOLS ||
      join(repository, "node_modules/.cache/zhiyin-tools"),
    specs: pinnedToolchains.filter(({ id }) => id === "uv"),
    fetch: fetchDownload,
    env: found,
  });
  return found.ZHIYIN_UV;
}

async function main(args) {
  const version = pinnedRuff(
    readFileSync(join(repository, "ruff.toml"), "utf8"),
  );
  const ran = spawnSync(
    await uv(process.env),
    ["tool", "run", `ruff@${version}`, "check", ...args],
    { cwd: repository, stdio: "inherit" },
  );
  if (ran.error) throw ran.error;
  process.exitCode = ran.status ?? 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  await main(process.argv.slice(2));
