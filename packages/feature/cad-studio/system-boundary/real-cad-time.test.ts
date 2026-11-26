/**
 * What the CAD studio does with the time a call has, against a real build123d:
 * a build or a drawing given less than it needs answers with what it finished
 * and names the rest, a check of many parts takes seconds, and a drawing of a
 * busy scene finishes within its minute or says how far it got. Each outcome
 * depends on how fast the machine runs the harness. Skipped unless the CAD
 * environment's Python is named, as the other real-CAD tests are:
 *
 *   $env:ZHIYIN_CAD_PYTHON = "…\cad\Scripts\python.exe"; npx vitest run --project "system-boundary*" packages/feature/cad-studio/system-boundary/real-cad-time.test.ts
 */

import { stat } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { cadAutomation } from "../src/index.js";
import { confinedPython, harness, python } from "./confined-cad-python.js";
import {
  bladed,
  busyDrafting,
  type Call,
  type Result,
  openStudio,
} from "./real-cad-studio.js";

const folders = new TemporaryFolders();

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

describe.skipIf(!python)("drawing a busy scene with the real drafting", () => {
  let given: unknown;
  let draw: Call;
  /** Draws with only `ms` for the drawing, as a slower machine or a larger scene would leave. */
  let drawIn: (ms: number) => Call;
  const text = (result: Result) => result.content[0]?.text ?? "";

  beforeAll(async () => {
    ({ drawIn } = await busyDrafting(folders, () => given));
    draw = drawIn(60_000);
  }, 30_000);

  afterAll(() => folders.removeAll());

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
