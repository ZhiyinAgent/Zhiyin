#!/usr/bin/env node
/**
 * The gate's Python tests: pytest, at the release pinned here, over the code
 * of the two harnesses that needs neither Blender nor the CAD environment.
 *
 *   node scripts/python-tests.mjs [pytest arguments]
 *
 * pytest runs through uv, the same uv the Python lint runs Ruff with, on
 * Python 3.13, the version Blender 5.2 and the CAD environment run the
 * harnesses on: uv fetches that pytest from the Python Package Index once and
 * keeps it, and uses a Python 3.13 on the machine or one it downloads. The
 * tests run with the NumPy release Blender 5.2.2 bundles, which the 3D
 * studio's geometry is worked out with. No compiled files are written beside
 * the harnesses, which ship as source.
 */

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { uv } from "./python-lint.mjs";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const pytest = "9.2.0";
const python = "3.13";
const numpy = "2.3.4";
const folders = [
  "packages/feature/blender-studio/test/python",
  "packages/feature/cad-studio/test/python",
];

const ran = spawnSync(
  await uv(process.env),
  [
    "tool",
    "run",
    "--python",
    python,
    "--with",
    `numpy==${numpy}`,
    `pytest@${pytest}`,
    "-p",
    "no:cacheprovider",
    "--import-mode=importlib",
    ...folders,
    ...process.argv.slice(2),
  ],
  {
    cwd: repository,
    stdio: "inherit",
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  },
);
if (ran.error) throw ran.error;
process.exitCode = ran.status ?? 1;
