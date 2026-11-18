/**
 * A build of many parts on the exact solids of a real build123d: a plate
 * with ten bd_warehouse ball bearings of sixteen solids each pressed in its
 * bores, a shaft in each and a spur gear on each shaft meshing with the
 * next, and one block floating clear of them all. The answer, with what
 * nothing holds, comes within a minute, and with a geared sweep of 60 steps
 * as well, within two and a half. Skipped unless the CAD environment's Python is named, as the other
 * real-CAD tests are:
 *
 *   $env:ZHIYIN_CAD_PYTHON = "…\cad\Scripts\python.exe"; npx vitest run --project system-boundary packages/feature/cad-studio/system-boundary/real-cad-many-parts.test.ts
 */

import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { cadAutomation } from "../src/index.js";
import { confinedPython, harness, python } from "./confined-cad-python.js";

type Result = {
  isError?: boolean;
  content: { type: string; text?: string }[];
};

const folders = new TemporaryFolders();

/** Ten bearings in a row in a plate, a shaft in each, a gear on each shaft meshing with the next, and a block clear of all of them. */
const train = [
  "from build123d import *",
  "from bd_warehouse.bearing import SingleRowDeepGrooveBallBearing",
  "from bd_warehouse.gear import SpurGear",
  "COUNT = 10",
  "CENTRES = 20.15",
  "plate = Pos(-10, 0, 0) * Box(COUNT * CENTRES + 20, 30, 6, align=(Align.MIN, Align.CENTER, Align.MIN))",
  "for i in range(COUNT):",
  "    plate -= Pos(i * CENTRES, 0, 0) * Cylinder(9.5, 6, align=(Align.CENTER, Align.CENTER, Align.MIN))",
  'show(plate, name="Plate")',
  "for i in range(COUNT):",
  "    x = i * CENTRES",
  '    show(Pos(x, 0, 0) * SingleRowDeepGrooveBallBearing("M6-19-6"), name=f"Bearing_{i + 1}")',
  '    show(Pos(x, 0, -4) * Cylinder(3, 24, align=(Align.CENTER, Align.CENTER, Align.MIN)), name=f"Shaft_{i + 1}")',
  "    gear = SpurGear(module=1, tooth_count=20, pressure_angle=20, thickness=6)",
  "    gear = Pos(-gear.center().X, -gear.center().Y, 0) * gear - Cylinder(3, 20)",
  '    show(Pos(x, 0, 10) * Rot(Z=9 * (i % 2)) * gear, name=f"Gear_{i + 1}")',
  'show(Pos(-30, 0, 30) * Box(5, 5, 5), name="Spacer")',
];

/** The seconds a build's answer says it took, from its first line. */
const took = (said: string) =>
  Number(/^Built \d+ parts in ([\d.]+) s\./m.exec(said)?.[1] ?? NaN);

describe.skipIf(!python)("a build of many parts, with a real build123d", () => {
  let root: string;
  let build: (more: Record<string, unknown>) => Promise<string>;

  beforeAll(async () => {
    root = await folders.make("zhiyin-real-cad-many-parts-workspace-");
    const data = await folders.make("zhiyin-real-cad-many-parts-data-");
    const tools = cadAutomation(await confinedPython(), {
      workspaceRoot: () => root,
      harness,
      directory: join(data, "cad-studio"),
    });
    await mkdir(join(root, "train"), { recursive: true });
    await writeFile(join(root, "train", "part.py"), train.join("\n"));
    build = async (more) => {
      const args = { file: "train/part.py", ...more };
      const asked = await tools.inspect("cad_build", args);
      if (!asked.ok) throw new Error(asked.reason);
      const result = (await tools.callTool(
        "cad_build",
        args,
        undefined,
        asked.identity,
      )) as Result;
      const said = result.content[0]?.text ?? "";
      if (result.isError) throw new Error(said);
      return said;
    };
  }, 30_000);

  afterAll(() => folders.removeAll());

  it("finds what nothing holds among 170 pieces, the bearings' balls held in their races, within a minute", async () => {
    const said = await build({});

    expect(said).toMatch(/^Built 32 parts in/m);
    expect(said).toContain("No two parts overlap.");
    expect(said).toContain("Held by nothing: Spacer.");
    expect(said).not.toMatch(/pieces of Bearing_/);
    expect(said).not.toContain("for want of time");
    expect(took(said)).toBeLessThan(60);
  }, 300_000);

  it("turns two gears of the train through a tooth and more in 60 steps, finding the third gear standing in the way, within two and a half minutes", async () => {
    const said = await build({
      sweep: {
        parts: ["Gear_1", "Shaft_1"],
        through: [0, 0, 0],
        along: [0, 0, 1],
        from: 0,
        to: 30,
        steps: 60,
        with: [
          {
            parts: ["Gear_2", "Shaft_2"],
            through: [20.15, 0, 0],
            along: [0, 0, 1],
            rate: -1,
          },
        ],
      },
    });

    // Gear_3 stays while Gear_2 turns against it; each shaft turns in its bearing.
    expect(said).toContain(
      "Turned Gear_1 and Shaft_1 0° to 30° about the axis through (0, 0, 0) along (0, 0, 1), with Gear_2 and Shaft_2 turned 0° to -30° about the axis through (20.15, 0, 0) along (0, 0, 1), in 60 steps, each position said as Gear_1 and Shaft_1's: " +
        "Gear_2 and Gear_3 meet from 0.5° to 17.5° and from 18.5° to 30°, going 1.42 mm into each other at most, at 9°; elsewhere they come nearest 0.0527 mm apart at 18°, at (29.96, -0.689, 7); " +
        "Shaft_1 and Bearing_1 meet from 0° to 30°, touching without going into each other; " +
        "Shaft_2 and Bearing_2 meet from 0° to 30°, touching without going into each other; " +
        "Gear_1 and Gear_2 come nearest 0.0526 mm apart at 13°, at (10.64, -1.45, 13).",
    );
    expect(said).toContain("Held by nothing: Spacer.");
    expect(took(said)).toBeLessThan(150);
  }, 600_000);
});

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
