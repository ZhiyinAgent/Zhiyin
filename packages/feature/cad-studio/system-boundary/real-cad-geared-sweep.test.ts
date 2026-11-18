/**
 * A geared sweep on the exact solids of a real build123d: a pinion turned
 * about its axis and the gear it drives turned about its own at their rate,
 * from one build, measured against each other and against the parts that
 * stay. Skipped unless the CAD environment's Python is named, as the other
 * real-CAD tests are:
 *
 *   $env:ZHIYIN_CAD_PYTHON = "…\cad\Scripts\python.exe"; npx vitest run --project system-boundary packages/feature/cad-studio/system-boundary/real-cad-geared-sweep.test.ts
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { cadAutomation } from "../src/index.js";
import { confinedPython, harness, python } from "./confined-cad-python.js";

type Result = {
  isError?: boolean;
  content: { type: string; text?: string }[];
};

const folders = new TemporaryFolders();

/** A point as the answer says it. */
const at = "\\([-\\d.]+, [-\\d.]+, [-\\d.]+\\)";

/**
 * A pinion of 15 teeth on the z axis and a gear of 52 at `centres` mm from
 * it along x, both module 1, the gear turned half a tooth so a gap of its
 * faces the pinion's tooth; and a block that stays, `stop` mm past the
 * gear's tip circle. bd_warehouse centres a gear's box on the origin, which
 * puts the axis of one of an odd tooth count beside it: the pinion is moved
 * back onto its axis unless `offAxis`.
 */
const gears = (centres: number, stop?: number, offAxis = false) => [
  "from build123d import *",
  "from bd_warehouse.gear import SpurGear",
  "pinion = SpurGear(module=1, tooth_count=15, pressure_angle=20, thickness=6)",
  offAxis
    ? ""
    : "pinion = Pos(-pinion.center().X, -pinion.center().Y, 0) * pinion",
  'show(pinion, name="Pinion")',
  `show(Pos(${centres}, 0, 0) * Rot(Z=180 + 180 / 52) * SpurGear(module=1, tooth_count=52, pressure_angle=20, thickness=6), name="Gear")`,
  stop === undefined
    ? ""
    : `show(Pos(${centres} + 27 + ${stop} + 2, 0, 0) * Box(4, 10, 6), name="Stop")`,
];

/** The pinion turned two tooth pitches, 48°, and the gear the other way at 15/52 of its rate. */
const sweep = (centres: number) => ({
  parts: ["Pinion"],
  through: [0, 0, 0],
  along: [0, 0, 1],
  from: 0,
  to: 48,
  steps: 60,
  with: [
    {
      parts: ["Gear"],
      through: [centres, 0, 0],
      along: [0, 0, 1],
      rate: -15 / 52,
    },
  ],
});

describe.skipIf(!python)("a geared sweep, with a real build123d", () => {
  let root: string;
  let build: (
    folder: string,
    lines: string[],
    more: Record<string, unknown>,
  ) => Promise<string>;

  beforeAll(async () => {
    root = await folders.make("zhiyin-real-cad-geared-sweep-workspace-");
    const data = await folders.make("zhiyin-real-cad-geared-sweep-data-");
    const tools = cadAutomation(await confinedPython(), {
      workspaceRoot: () => root,
      harness,
      directory: join(data, "cad-studio"),
    });
    build = async (folder, lines, more) => {
      await mkdir(join(root, folder), { recursive: true });
      await writeFile(join(root, folder, "part.py"), lines.join("\n"));
      const args = { file: `${folder}/part.py`, ...more };
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

  it("turns two gears at their own rates, finding the gap between their teeth and between the gear and a part that stays", async () => {
    // Their pitch circles meet at 33.5 mm; 0.15 mm more opens backlash.
    const said = await build("geared-clear", gears(33.65, 1), {
      sweep: sweep(33.65),
    });

    expect(said).toContain(
      "Turned Pinion 0° to 48° about the axis through (0, 0, 0) along (0, 0, 1), with Gear turned 0° to -13.846° about the axis through (33.65, 0, 0) along (0, 0, 1), in 60 steps, each position said as Pinion's: ",
    );
    expect(said).toMatch(
      new RegExp(
        `Pinion and Gear come nearest 0\\.\\d+ mm apart at [\\d.]+°, at ${at}`,
      ),
    );
    expect(said).toMatch(
      new RegExp(
        `Gear and Stop come nearest (0\\.9\\d*|1(\\.0\\d*)?) mm apart at [\\d.]+°, at ${at}`,
      ),
    );
    expect(said).not.toMatch(/Pinion and Gear meet/);
    expect(said).not.toMatch(/turned about an axis not its own/);
    // How long the sweep took, so a longer one can be planned.
    expect(said).toMatch(
      /The sweep took (\d+ min )?[\d.]+ s, [\d.]+ s a position\./,
    );
  }, 240_000);

  it("finds where gears set too close meet, and how deep their teeth go into each other", async () => {
    // 0.3 mm closer than their pitch circles meet.
    const said = await build("geared-close", gears(33.2), {
      sweep: sweep(33.2),
    });

    expect(said).toMatch(
      /Pinion and Gear meet from 0° to 48°, going 0\.\d+ mm into each other at most, at [\d.]+°/,
    );
  }, 240_000);

  it("says a gear turned about an axis that is not its own, and where its own runs", async () => {
    const said = await build("geared-off-axis", gears(33.65, undefined, true), {
      sweep: { ...sweep(33.65), steps: 4 },
    });

    expect(said).toContain(
      "Pinion is turned about an axis not its own: its own, found on its solid, runs through (-0.0619, 0, 0) along (0, 0, 1), 0.0619 mm from the axis it is turned about, so it swings in and out of its mesh; turn it about its own axis.",
    );
    expect(said).not.toMatch(/Gear is turned about an axis not its own/);
  }, 120_000);

  it("says a gear left standing while the gear it meshes turns, and the rate that turns it with it", async () => {
    const said = await build("geared-still", gears(33.65), {
      sweep: {
        parts: ["Gear"],
        through: [33.65, 0, 0],
        along: [0, 0, 1],
        from: 0,
        to: 14,
        steps: 4,
      },
    });

    // Turned with the gear, the pinion turns 52 / 15 times as far, the other way.
    expect(said).toContain(
      "Pinion (15 teeth) meshes Gear (52 teeth), which turns, but stays still, so their teeth run into each other: add Pinion to with, turned about its own axis through (0, 0, 0) along (0, 0, 1) at rate -3.467.",
    );
  }, 120_000);

  it("says which way each group that turns can slide along its axis, and what stops it the other way", async () => {
    // A block under the pinion's lower face, nothing over it, nothing at the gear.
    const said = await build(
      "geared-float",
      [...gears(33.65), 'show(Pos(0, 0, -4) * Box(8, 8, 2), name="Block")'],
      { sweep: { ...sweep(33.65), steps: 4 } },
    );

    expect(said).toContain(
      "Pinion slides along its axis toward (0, 0, 1) with nothing to stop it; Block stops it toward (0, 0, -1).",
    );
    expect(said).toContain(
      "Gear slides along its axis either way with nothing to stop it.",
    );
    expect(said).toContain(
      "A part that turns needs a stop each way along its axis, as a shoulder or collar against a bearing, or a circlip.",
    );
  }, 120_000);

  it("says a shaft fused into a part that stays, which the part turned on it meets", async () => {
    // A motor whose D-shaft is part of its body, and a pinion on the shaft
    // with a D bore 0.05 mm clear: turned, the bore's flat meets the shaft.
    const said = await build(
      "fused-shaft",
      [
        "from build123d import *",
        "shaft = Pos(0, 0, 6) * Cylinder(1.5, 12) - Pos(6, 0, 6) * Box(10, 10, 14)",
        'show(Pos(0, 0, -5) * Box(20, 20, 10) + shaft, name="Motor")',
        "bore = Pos(0, 0, 6) * Cylinder(1.55, 6) - Pos(6.05, 0, 6) * Box(10, 10, 8)",
        'show(Pos(0, 0, 6) * Cylinder(5, 6) - bore, name="Pinion")',
      ],
      {
        sweep: {
          parts: ["Pinion"],
          through: [0, 0, 0],
          along: [0, 0, 1],
          from: 0,
          to: 90,
          steps: 6,
        },
      },
    );

    expect(said).toMatch(/Pinion and Motor meet/);
    expect(said).toContain(
      "Motor has a round face 3 mm across on the axis Pinion turns about, inside Pinion, as a shaft in its bore, but stays still while Pinion turns: if that shaft turns with Pinion, show it as a part of its own and add it to Pinion's group.",
    );
  }, 120_000);

  it("says a group that names a part the script does not show", async () => {
    const said = await build("geared-missing", gears(33.65), {
      sweep: {
        ...sweep(33.65),
        with: [{ ...sweep(33.65).with[0], parts: ["Wheel"] }],
      },
    });

    expect(said).toContain(
      "The sweep names Wheel, which the script does not show; it shows Pinion and Gear.",
    );
  }, 120_000);
});
