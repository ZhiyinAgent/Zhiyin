/**
 * What the CAD studio does with the time a call has, against a real build123d:
 * a build or a drawing given less than it needs answers with what it finished
 * and names the rest, a check of many parts takes seconds, a train of gears in
 * their bearings is built within a minute and swept within two and a half, a
 * part's making checks stop where their deadline falls, and a drawing of a
 * busy scene finishes within its minute or says how far it got. Each outcome
 * depends on how fast the machine runs the harness. Skipped unless the CAD
 * environment's Python is named, as the other real-CAD tests are:
 *
 *   $env:ZHIYIN_CAD_PYTHON = "…\cad\Scripts\python.exe"; npx vitest run --project "system-boundary*" packages/feature/cad-studio/system-boundary/real-cad-time.test.ts
 */

import { execFile } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { cadAutomation } from "../src/index.js";
import { confinedPython, harness, python } from "./confined-cad-python.js";
import {
  busyDrafting,
  type Call,
  type Result,
  openStudio,
} from "./real-cad-studio.js";

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

/** A ring modelled with `sides` sides, as Line Art gives its outline: one stroke back to its start. */
const ring = (r: number, sides: number) =>
  Array.from({ length: sides + 1 }, (_, i) => [
    r * Math.cos((2 * Math.PI * i) / sides),
    r * Math.sin((2 * Math.PI * i) / sides),
  ]);
/**
 * A bladed row seen end on, as Line Art strokes one: a casing ring in
 * sight, and behind it the short edges of `count` blades' sections, each
 * blade at its own turn and every edge at its own slant.
 */
const bladed = (count: number) => ({
  look: [0, 1, 0],
  up: [0, 0, 1],
  lines: [
    ["visible", ring(400, 64)],
    ...Array.from({ length: count }, (_, i) => {
      const turn = (2 * Math.PI * i) / count;
      const r = 150 + (i % 200);
      const slant = turn + 0.3 + (i % 7) * 0.05;
      const [x, y] = [r * Math.cos(turn), r * Math.sin(turn)];
      return [
        "hidden",
        [
          [x, y],
          [x + 3 * Math.cos(slant), y + 3 * Math.sin(slant)],
        ],
      ];
    }),
  ],
  cut: [],
  facing: null,
});

describe.skipIf(!python)("building with a real build123d", () => {
  let root: string;
  let data: string;
  let build: Call;

  beforeAll(async () => {
    ({ root, data, build } = await openStudio(folders));
  }, 30_000);

  afterAll(() => folders.removeAll());

  const text = (result: Result) => result.content[0]?.text ?? "";

  it("answers with the positions checked in the time a build has, names the rest, and keeps what was printed", async () => {
    // A build given a minute, whose positions after the first take 12 s each.
    const tools = cadAutomation(await confinedPython(), {
      workspaceRoot: () => root,
      harness,
      directory: join(data, "cad-studio-timed"),
      buildTimeMs: 60_000,
    });
    const run = async (args: Record<string, unknown>) => {
      const asked = await tools.inspect("cad_build", args);
      if (!asked.ok) throw new Error(asked.reason);
      return (await tools.callTool(
        "cad_build",
        args,
        undefined,
        asked.identity,
      )) as Result;
    };
    const slow = [
      "import sys, time",
      "from build123d import *",
      "turn = float(sys.argv[1])",
      "if turn:",
      "    time.sleep(12)",
      "print('at', turn)",
      'show(Box(10, 10, 10), name="Base")',
      'show(Pos(30, 0, 0) * Box(10, 10, 10), name="Arm")',
    ].join("\n");

    const timed = await run({
      code: slow,
      positions: [["0"], ["1"], ["2"], ["3"], ["4"], ["5"], ["6"]],
    });
    const endless = await run({
      code: "import time\nprint('started', flush=False)\nwhile True:\n    time.sleep(1)\n",
    });

    expect(timed.isError, text(timed)).toBeUndefined();
    expect(text(timed)).toMatch(
      /Checked for overlaps at [2-5] positions: no two parts overlap at any\./,
    );
    expect(text(timed)).toMatch(
      /Not checked, for want of time, each position taking about 1\d(\.\d)? s: at [^.]*6\. Check them in another call\./,
    );
    expect(endless.isError).toBe(true);
    expect(text(endless)).toContain(
      "The build did not finish: it ran past the minute a build has.",
    );
    expect(text(endless)).toContain("What the script printed:\nstarted");
  }, 240_000);

  it("checks a part of many curved faces against dozens of others in seconds, not minutes", async () => {
    // A shaft of thirty rounded webs, its box slow to measure exactly, with
    // a pin clear of it in each gap on either side: 58 pairs to check.
    const result = await build({
      code: [
        "from build123d import *",
        "shaft = Cylinder(20, 900, align=(Align.CENTER, Align.CENTER, Align.MIN))",
        "for k in range(30):",
        "    shaft = shaft + fillet((Pos(0, 0, 15 + k * 30) * Box(140, 60, 14)).edges(), 5)",
        "shaft = fillet(shaft.edges().filter_by(GeomType.CIRCLE), 2)",
        "show(shaft, name='Shaft')",
        "for k in range(29):",
        "    for side in (-1, 1):",
        "        show(Pos(side * 45, 0, 30 + k * 30) * Rot(0, 90, 0) * Cylinder(3, 30), name=f'Pin {k}{side}')",
      ].join("\n"),
    });

    expect(result.isError, text(result)).toBeUndefined();
    const seconds = Number(
      /Built 59 parts in ([\d.]+) s/.exec(text(result))?.[1],
    );
    // Measured again for each pair, the shaft's box alone took over a minute.
    expect(seconds).toBeLessThan(40);
    expect(text(result)).not.toContain("overlap by");
  }, 300_000);

  it("draws a sheet with the views done in the time it has, naming those left out and the dimensions on them", async () => {
    // A plate of 576 pins, whose views from the front and the side take half
    // a minute each, and a small block far behind it, the only part section
    // A keeps: a drawing given 70 s has its views due 15 s in, so only the
    // section is done.
    const tools = cadAutomation(await confinedPython(), {
      workspaceRoot: () => root,
      harness,
      directory: join(data, "cad-studio-timed-drawing"),
      buildTimeMs: 70_000,
    });
    const args = {
      code: [
        "from build123d import *",
        "pins = [Pos(10 * i - 115, 10 * j - 115, 6) * Cylinder(3, 6) for i in range(24) for j in range(24)]",
        "plate = Box(250, 250, 6) + pins",
        "plate = plate.fillet(0.5, [e for e in plate.edges() if e.geom_type == GeomType.CIRCLE and e.center().Z > 8])",
        'show(plate, name="Plate")',
        'show(Pos(0, 400, 0) * Box(40, 20, 10), name="Block")',
      ].join("\n"),
      views: [
        { view: "front" },
        { view: "right" },
        { section: "A", looking: "front", through: [0, 400, 0] },
      ],
      dimensions: [{ view: "front", kind: "overall", direction: "horizontal" }],
      outputs: [
        { path: "drawings/timed.pdf" },
        // A profile of a view left out for time is not written; the rest is.
        { path: "drawings/front.dxf", view: "front" },
      ],
    };
    const drawn = async (args: Record<string, unknown>) => {
      const asked = await tools.inspect("cad_draw", args);
      if (!asked.ok) throw new Error(asked.reason);
      return (await tools.callTool(
        "cad_draw",
        args,
        undefined,
        asked.identity,
      )) as Result;
    };
    const began = Date.now();
    const result = await drawn(args);
    const took = Date.now() - began;
    const none = await drawn({
      ...args,
      views: [{ view: "front" }, { view: "right" }],
      outputs: [{ path: "drawings/none.pdf" }],
    });

    expect(result.isError, text(result)).toBeUndefined();
    expect(text(result)).toMatch(/: section A\./);
    expect(text(result)).toContain(
      "Left out, not done in the time the drawing has: the front view and the right view, with dimension 1 on them. Draw them in a call of their own, or of fewer parts.",
    );
    expect(text(result)).toContain(
      "It had 70 s: draw one subsystem per call, or, where the whole assembly is needed, ask again with more minutes, up to 30.",
    );
    expect(text(result)).toContain("Wrote drawings/timed.pdf");
    expect(text(result)).toContain(
      "drawings/front.dxf was not written: the front view was not done in the time the drawing has; draw it in a call of its own.",
    );
    await expect(stat(join(root, "drawings", "front.dxf"))).rejects.toThrow();
    expect(took).toBeLessThan(70_000);
    expect(none.isError).toBe(true);
    expect(text(none)).toContain(
      "no view was done in the time the drawing has (the front view and the right view); draw fewer parts, or fewer views in a call",
    );
    expect(text(none)).toContain(
      "It had 70 s: draw one subsystem per call, or, where the whole assembly is needed, ask again with more minutes, up to 30.",
    );
  }, 180_000);

  it("draws a build's sections side by side, naming one not done in the time the build has", async () => {
    // A build given 85 s has its sections due 40 s in, some 20 s after its
    // parts are measured: the cut through a small block takes seconds, the
    // cut through a plate of 900 pins half a minute.
    const tools = cadAutomation(await confinedPython(), {
      workspaceRoot: () => root,
      harness,
      directory: join(data, "cad-studio-timed-sections"),
      buildTimeMs: 85_000,
    });
    const args = {
      code: [
        "from build123d import *",
        "pins = [Pos(10 * i - 145, 10 * j - 145, 6) * Cylinder(3, 6) for i in range(30) for j in range(30)]",
        "plate = Box(310, 310, 6) + pins",
        "plate = plate.fillet(0.5, [e for e in plate.edges() if e.geom_type == GeomType.CIRCLE and e.center().Z > 8])",
        'show(plate, name="Plate")',
        'show(Pos(0, 400, 0) * Box(40, 20, 10), name="Block")',
      ].join("\n"),
      sections: [
        { through: [0, 400, 0], looking: "front", parts: ["Block"] },
        { through: [0, 0, 3], looking: "front", parts: ["Plate"] },
      ],
    };
    const asked = await tools.inspect("cad_build", args);
    if (!asked.ok) throw new Error(asked.reason);
    const began = Date.now();
    const result = (await tools.callTool(
      "cad_build",
      args,
      undefined,
      asked.identity,
    )) as Result;
    const took = Date.now() - began;

    expect(result.isError, text(result)).toBeUndefined();
    expect(text(result)).toContain("Below them, the section asked for");
    expect(text(result)).toContain(
      "Section 2 was not drawn: it was not done in the time the build has; ask for it in a build of its own, or of fewer parts.",
    );
    expect(took).toBeLessThan(85_000);
  }, 120_000);
});

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

describe.skipIf(!python)(
  "the checks a build makes unasked, with a real build123d",
  () => {
    it("stops a part's checks when the build's time runs out during them, keeping what they found, and names the part as not checked", async () => {
      // The measuring run's checks, given the time they are due by as the
      // build gives it: a fifth of a second after they start, for a ribbed grid
      // and a hollow block in one part, whose checks take several seconds.
      // Its closed void is found first, so its line and its name together
      // show the checks stopped inside the part, not before or after it.
      const script = [
        "import json, sys, time",
        "import numpy",
        "sys.path.insert(0, sys.argv[1])",
        "from build123d import *",
        "from zhiyin_cad import making",
        "grid = Box(300, 300, 2)",
        "ribs = [Pos(i * 10, 0, 4) * Box(1.2, 290, 6) for i in range(-14, 15)] + [Pos(0, j * 10, 4) * Box(290, 1.2, 6) for j in range(-14, 15)]",
        "part = Compound([grid + Compound(ribs), Pos(-200, 0, 0) * (Box(10, 10, 10) - Box(5, 5, 5))])",
        'ways = {"Part": {"method": "moulded", "why": "as shown", "pull": numpy.array([0.0, 0.0, 1.0]), "parting": None}}',
        "started = time.time()",
        'lines, unchecked = making.checked([("Part", part)], ways, [], started + 0.2)',
        'print(json.dumps({"lines": lines, "unchecked": unchecked}))',
      ].join("\n");
      const { stdout } = await promisify(execFile)(
        python!,
        ["-I", "-c", script, dirname(harness)],
        { timeout: 120_000 },
      );
      const checked = JSON.parse(stdout) as {
        lines: string[];
        unchecked: string[];
      };

      expect(checked.lines).toEqual([
        "Part holds 1 closed void inside it, where none can be: 125 mm³, 5 × 5 × 5 mm about (-200, 0, 0). No tool or mould reaches a closed void, and a resin or powder print keeps it full; open it to the outside, or fill it.",
      ]);
      expect(checked.unchecked).toEqual(["Part"]);
    }, 120_000);
  },
);

describe.skipIf(!python)("drawing a busy scene with the real drafting", () => {
  let root: string;
  let given: unknown;
  let draw: Call;
  /** Draws with only `ms` for the drawing, as a slower machine or a larger scene would leave. */
  let drawIn: (ms: number) => Call;
  const text = (result: Result) => result.content[0]?.text ?? "";
  /** How many of a DXF's entities lie on its HIDDEN layer. */
  const hiddenIn = async (path: string) =>
    (await readFile(join(root, path), "utf8")).match(/\n\s*8\r?\nHIDDEN\r?\n/g)
      ?.length ?? 0;

  beforeAll(async () => {
    ({ root, drawIn } = await busyDrafting(folders, () => given));
    draw = drawIn(60_000);
  }, 30_000);

  afterAll(() => folders.removeAll());

  it("says when hidden edges crowd a view into a mass, and leaves them out of a view given hidden: false", async () => {
    given = {
      names: ["Rotor"],
      centre: [0, 0, 0],
      views: { front: bladed(60_000) },
    };

    const crowded = await draw({
      scene: true,
      views: [{ view: "front" }],
      outputs: [{ path: "busy/crowded.dxf" }],
    });
    const clear = await draw({
      scene: true,
      views: [{ view: "front", hidden: false }],
      outputs: [{ path: "busy/clear.dxf" }],
    });

    expect(crowded.isError, text(crowded)).toBeUndefined();
    expect(text(crowded)).toContain(
      "Hidden edges crowd the front view so closely that they read as a mass: give it hidden: false to leave them out.",
    );
    expect(await hiddenIn("busy/crowded.dxf")).toBeGreaterThan(1000);
    expect(clear.isError, text(clear)).toBeUndefined();
    expect(text(clear)).not.toContain("Hidden edges crowd");
    expect(await hiddenIn("busy/clear.dxf")).toBe(0);
  }, 180_000);

  it("draws a view of sixty thousand edges within the minute a drawing has", async () => {
    given = {
      names: ["Rotor"],
      centre: [0, 0, 0],
      views: { front: bladed(60_000) },
    };

    const drawn = await draw({
      scene: true,
      views: [{ view: "front" }],
      outputs: [{ path: "busy/front.pdf" }],
    });

    expect(drawn.isError, text(drawn)).toBeUndefined();
    expect(text(drawn)).toContain("front view");
  }, 120_000);

  it("says, of a drawing that runs out of time, the views it drew and the one it was drawing", async () => {
    given = {
      names: ["Rotor"],
      centre: [0, 0, 0],
      views: { top: bladed(100), front: bladed(400_000) },
    };

    const drawn = await drawIn(12_000)({
      scene: true,
      views: [{ view: "top" }, { view: "front" }],
      outputs: [{ path: "busy/late.pdf" }],
    });

    expect(drawn.isError).toBe(true);
    expect(text(drawn)).toContain(
      "The drawing did not finish: it ran past the 12 s a drawing has.\nHow far it got:\n",
    );
    expect(text(drawn)).toMatch(
      /s: Drew the top view: \d+ lines and \d+ arcs\./,
    );
    expect(text(drawn)).toMatch(
      /s: Drawing the front view, from the 400001 lines Blender found\.\nDraw one subsystem per call, or, where the whole assembly is needed, ask again with more minutes, up to 30\.$/,
    );
  }, 120_000);
});
