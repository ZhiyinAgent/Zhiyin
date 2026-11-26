/**
 * The held check of a build of many parts, against a real build123d, given no
 * time beyond its first quick test. Skipped unless the CAD environment's
 * Python is named, as the other real-CAD tests are:
 *
 *   $env:ZHIYIN_CAD_PYTHON = "…\cad\Scripts\python.exe"; npx vitest run --project "system-boundary*" packages/feature/cad-studio/system-boundary/real-cad-many-parts.test.ts
 */

import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { harness, python } from "./confined-cad-python.js";

const folders = new TemporaryFolders();

/**
 * The held check given no time beyond its first quick test: inserts lying
 * wholly in a plate are found held by a point of one lying in the other, pins
 * standing on it only by their meshes or exactly, which the time no longer
 * allows, and one floats above it. Run on the harness directly, so the time
 * is passed in rather than left to the machine's speed.
 */
const heldInNoTime = [
  "import json, sys",
  "sys.path.insert(0, sys.argv[1])",
  "from build123d import *",
  "from zhiyin_cad import measure",
  "parts = [('Plate', Box(120, 20, 10))]",
  "parts += [(f'Insert {i}', Pos(-50 + 20 * i, 0, 0) * Cylinder(3, 4)) for i in range(3)]",
  "parts += [(f'Standing {i}', Pos(10 + 20 * i, 0, 7) * Cylinder(3, 4)) for i in range(2)]",
  "parts.append(('Floating', Pos(50, 0, 14) * Cylinder(3, 4)))",
  "print(json.dumps({'timed': measure.loose(parts, seconds=0), 'whole': measure.loose(parts)}))",
];

describe.skipIf(!python)("a held check that runs out of time", () => {
  it("names the floating part among those left unchecked, and every part it does not name is held", async () => {
    const folder = await folders.make("zhiyin-real-cad-held-in-no-time-");
    const script = join(folder, "held.py");
    await writeFile(script, heldInNoTime.join("\n"));

    const { stdout } = await promisify(execFile)(
      python!,
      [script, dirname(harness)],
      { cwd: folder },
    );
    const { timed, whole } = JSON.parse(stdout) as {
      timed: { unchecked?: boolean; left?: string[] };
      whole: { parts: string[] };
    };

    expect(timed.unchecked).toBe(true);
    expect(timed.left).toContain("Floating");
    // Found held at once, the inserts and the plate are not left.
    expect(timed.left).not.toContain("Insert 0");
    expect(timed.left).not.toContain("Plate");
    // Measured with time enough, only the floating part is held by nothing:
    // every part the timed check does not name is held.
    expect(whole.parts).toEqual(["Floating"]);
    const named = [
      "Plate",
      "Insert 0",
      "Insert 1",
      "Insert 2",
      "Standing 0",
      "Standing 1",
      "Floating",
    ];
    for (const name of named.filter((one) => !timed.left?.includes(one)))
      expect(whole.parts).not.toContain(name);
  }, 120_000);
});
