/**
 * An assembly that moves, against a real build123d: the overlaps checked at
 * each position it is put in, the motion file the 3D studio keys from, and the
 * assembly taken apart part by part, built and drawn. Skipped unless the CAD
 * environment's Python is named, as the other real-CAD tests are:
 *
 *   $env:ZHIYIN_CAD_PYTHON = "…\cad\Scripts\python.exe"; npx vitest run --project "system-boundary*" packages/feature/cad-studio/system-boundary/real-cad-motion.test.ts
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { python } from "./confined-cad-python.js";
import {
  type Call,
  type Preview,
  type Result,
  openStudio,
} from "./real-cad-studio.js";

const folders = new TemporaryFolders();

describe.skipIf(!python)("building with a real build123d", () => {
  let root: string;
  let build: Call;
  let draw: Call;
  /** The meshes handed over for the person's view, read as they were. */
  const previews: Preview[] = [];

  beforeAll(async () => {
    ({ root, build, draw } = await openStudio(folders, previews));
  }, 30_000);

  afterAll(() => folders.removeAll());

  const text = (result: Result) => result.content[0]?.text ?? "";

  it("checks an arm for overlaps at each position it turns to, and says at which it strikes", async () => {
    // A stop from 25 to 35 mm up; the arm, 60 mm long, reaches it standing.
    const hinge = [
      "import sys",
      "from build123d import *",
      "turn = float(sys.argv[1])",
      'show(Box(40, 40, 10).moved(Location((0, 0, 30))), name="Stop")',
      'show(Box(4, 4, 60).rotate(Axis.X, turn), name="Arm")',
    ].join("\n");

    const result = await build({
      code: hinge,
      positions: [["0"], ["90"], ["180"]],
    });

    expect(result.isError, text(result)).toBeUndefined();
    expect(text(result)).toContain(
      "Checked for overlaps at 3 positions. At 0: Stop and Arm overlap by 80 mm³, what they share 4 mm thick, from (-2, -2, 25) to (2, 2, 30): far deeper than a press fit, which goes in by hundredths of a millimetre, so one part runs into the other. At 180: Stop and Arm overlap by 80 mm³, what they share 4 mm thick, from (-2, -2, 25) to (2, 2, 30): far deeper than a press fit, which goes in by hundredths of a millimetre, so one part runs into the other. No two parts overlap at 90.",
    );
  }, 120_000);

  it("writes where each part that moves is at each position, a stretched spring included, for the 3D studio to key", async () => {
    const mechanism = [
      "import sys, math",
      "from build123d import *",
      "turn = float(sys.argv[1])",
      'show(Box(100, 100, 5), name="Base")',
      'show(Rot(0, 0, turn) * Pos(30, 0, 10) * Box(60, 8, 4), name="Arm")',
      'show(Pos(50 * math.cos(math.radians(turn)), 60, 10) * Box(10, 10, 10), name="Slider")',
      "height = 20 + 10 * math.sin(math.radians(turn))",
      'show(Pos(-40, -40, 2.5 + height / 2) * Box(8, 8, height), name="Spring")',
      // A hole that moves within its plate: no move, turn or stretch takes one place to the other.
      'show(Pos(0, -60, 10) * (Box(40, 10, 4) - Pos(10 * math.cos(math.radians(turn)), 0, 0) * Cylinder(2, 4)), name="Gate")',
    ].join("\n");
    const result = await build({
      code: mechanism,
      positions: [["0"], ["90"], ["180"], ["270"]],
      exports: [{ path: "motion/mechanism.json" }],
    });
    const unplaced = await build({
      code: mechanism,
      arguments: ["0"],
      exports: [{ path: "motion/none.json" }],
    }).catch((error: Error) => error.message);
    const written = JSON.parse(
      await readFile(join(root, "motion", "mechanism.json"), "utf8"),
    ) as {
      positions: string[][];
      parts: Record<string, number[][]>;
      unfitted: Record<string, string>;
      still: number;
    };
    const rounded = (matrix: number[]) =>
      matrix.map((v) => Math.round(v * 1000) / 1000 + 0);

    expect(result.isError, text(result)).toBeUndefined();
    expect(text(result)).toContain("Wrote motion/mechanism.json (");
    expect(text(result)).toContain(
      "where 3 parts are at each of 4 positions, for blender_animate's cad_motion; 1 part stays put. Left out, as no move, turn and stretch takes it from the first position to another: Gate (its corners and edges stray",
    );
    expect(written.positions).toEqual([["0"], ["90"], ["180"], ["270"]]);
    expect(Object.keys(written.parts).sort()).toEqual([
      "Arm",
      "Slider",
      "Spring",
    ]);
    // The arm a quarter turn about z at 90; the slider 50 mm back along x; the spring 10 mm taller.
    expect(rounded(written.parts["Arm"]![1]!)).toEqual([
      0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
    ]);
    expect(rounded(written.parts["Slider"]![1]!)).toEqual([
      1, 0, 0, -50, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
    ]);
    expect(rounded(written.parts["Spring"]![1]!)).toEqual([
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1.5, -1.25, 0, 0, 0, 1,
    ]);
    expect(unplaced).toContain(
      "motion/none.json would hold where each part is at each position: give positions, two or more, or explode for the parts going together one at a time.",
    );
  }, 180_000);

  it("turns a plain round part about its own axis in the motion file, rather than sliding it, and shifts one that only slides", async () => {
    // A shaft and a ball have no corner off their axis: only their round edges say how they turned.
    const result = await build({
      code: [
        "import sys",
        "from build123d import *",
        "turn = float(sys.argv[1])",
        'show(Pos(50, 0, 0) * Rot(0, 0, turn) * Cylinder(10, 100), name="Shaft")',
        'show(Pos(-50, 0, 0) * Rot(0, 0, turn) * Sphere(10), name="Ball")',
        'show(Pos(0, 50 + turn / 9, 0) * Cylinder(5, 20), name="Roller")',
      ].join("\n"),
      positions: [["0"], ["90"]],
      exports: [{ path: "motion/round.json" }],
    });
    const written = JSON.parse(
      await readFile(join(root, "motion", "round.json"), "utf8"),
    ) as { parts: Record<string, number[][]>; unfitted: object };
    const rounded = (matrix: number[]) =>
      matrix.map((v) => Math.round(v * 1000) / 1000 + 0);

    expect(result.isError, text(result)).toBeUndefined();
    expect(text(result)).toContain(
      "where 3 parts are at each of 2 positions, for blender_animate's cad_motion; 0 parts stay put.",
    );
    expect(written.unfitted).toEqual({});
    // A quarter turn about z, about the shaft's own axis at (50, 0) and the ball's centre at (-50, 0).
    expect(rounded(written.parts["Shaft"]![1]!)).toEqual([
      0, -1, 0, 50, 1, 0, 0, -50, 0, 0, 1, 0, 0, 0, 0, 1,
    ]);
    expect(rounded(written.parts["Ball"]![1]!)).toEqual([
      0, -1, 0, -50, 1, 0, 0, 50, 0, 0, 1, 0, 0, 0, 0, 1,
    ]);
    // The roller slides 10 mm along y, unturned.
    expect(rounded(written.parts["Roller"]![1]!)).toEqual([
      1, 0, 0, 0, 0, 1, 0, 10, 0, 0, 1, 0, 0, 0, 0, 1,
    ]);
  }, 180_000);

  // A base with a lid on it and a bolt through both, the bolt's head on the
  // lid and its shank a sliding fit in their holes.
  const bolted = [
    "from build123d import *",
    'show(Box(60, 40, 20) - Pos(0, 0, 5) * Cylinder(3, 20), name="Base")',
    'show(Pos(0, 0, 15) * Box(60, 40, 10) - Pos(0, 0, 15) * Cylinder(3, 20), name="Lid")',
    'show(Pos(0, 0, 8) * Cylinder(3, 30) + Pos(0, 0, 25) * Cylinder(5, 4), name="Bolt")',
  ].join("\n");

  /** The highest and lowest z of a binary STL's corners. */
  const heights = (stl: Buffer) => {
    const count = stl.readUInt32LE(80);
    let low = Infinity;
    let high = -Infinity;
    for (let i = 0; i < count; i++)
      for (let corner = 0; corner < 3; corner++) {
        const z = stl.readFloatLE(84 + i * 50 + 12 + corner * 12 + 8);
        low = Math.min(low, z);
        high = Math.max(high, z);
      }
    return [Math.round(low * 100) / 100, Math.round(high * 100) / 100];
  };

  /** How high a part's top lies in a binary glTF, in mm: glTF's y is the CAD's z. */
  const topIn = (glb: Buffer, name: string) => {
    const json = JSON.parse(
      glb.subarray(20, 20 + glb.readUInt32LE(12)).toString("utf8"),
    ) as {
      nodes: {
        name?: string;
        mesh?: number;
        translation?: number[];
        matrix?: number[];
      }[];
      meshes: { primitives: { attributes: { POSITION: number } }[] }[];
      accessors: { max?: number[] }[];
    };
    const node = json.nodes.find((one) => one.name === name)!;
    const lift = node.matrix?.[13] ?? node.translation?.[1] ?? 0;
    const highest = Math.max(
      ...json.meshes[node.mesh!]!.primitives.map(
        (one) => json.accessors[one.attributes.POSITION]!.max![1]!,
      ),
    );
    return Math.round((lift + highest) * 1000 * 100) / 100;
  };

  it("takes an assembly apart from the outside in, each part along a way it is free to leave by, and writes the sequence it goes together in", async () => {
    previews.length = 0;
    const result = await build({
      code: bolted,
      explode: { stay: ["Base"] },
      exports: [
        { path: "apart/bolt-out.stl", parts: ["Bolt"], exploded: true },
        { path: "apart/bolt.stl", parts: ["Bolt"] },
        { path: "apart/sequence.json" },
      ],
    });
    const sequence = JSON.parse(
      await readFile(join(root, "apart", "sequence.json"), "utf8"),
    ) as {
      positions: string[][];
      parts: Record<string, number[][]>;
      still: number;
      straight: boolean;
    };
    // How far each part is moved up at each position: the matrix's z move.
    const up = (name: string) =>
      sequence.parts[name]!.map(
        (matrix) => Math.round(matrix[11]! * 100) / 100,
      );

    expect(result.isError, text(result)).toBeUndefined();
    // The bolt comes out first, up, clear of the lid it holds down, and
    // further by half its length; then the lid, by half its thickness.
    expect(text(result)).toContain(
      "Moved apart: 2 parts taken out one at a time, the first out first, each along a way found free on the parts' meshes and moved past what it sits against: Bolt +Z 44 mm; Lid +Z 5 mm.",
    );
    expect(text(result)).toContain("Kept in place: Base.");
    expect(
      heights(await readFile(join(root, "apart", "bolt-out.stl"))),
    ).toEqual([37, 71]);
    expect(heights(await readFile(join(root, "apart", "bolt.stl")))).toEqual([
      -7, 27,
    ]);
    // The person's view shows the bolt out too.
    expect(topIn(previews.at(-1)!.model, "Bolt")).toBe(71);
    // All out, then the lid goes in, then the bolt.
    expect(sequence.positions).toEqual([["all out"], ["Lid in"], ["Bolt in"]]);
    expect(sequence.straight).toBe(true);
    expect(up("Bolt")).toEqual([44, 44, 0]);
    expect(up("Lid")).toEqual([5, 0, 0]);
    expect(sequence.still).toBe(1);
    expect(text(result)).toContain(
      "the assembly sequence, from every part moved apart to all in, one part going in at each of its 2 steps",
    );
  }, 180_000);

  it("leaves in a part nothing frees, saying what blocks it, and takes a pin out along its own slanted axis", async () => {
    const result = await build({
      code: [
        "from build123d import *",
        'show(Box(60, 60, 20) - Rot(45, 0, 0) * Cylinder(4, 80), name="Plate")',
        'show(Rot(45, 0, 0) * Cylinder(3.9, 70), name="Pin")',
        'show(Pos(100, 0, 0) * (Box(40, 40, 40) - Box(30, 30, 30)), name="Shell")',
        'show(Pos(100, 0, 0) * Sphere(10), name="Ball")',
      ].join("\n"),
      explode: { stay: ["Plate", "Shell"] },
    });

    expect(result.isError, text(result)).toBeUndefined();
    expect(text(result)).toMatch(
      /Moved apart: 1 part taken out .*: Pin along \(0, -0\.707, 0\.707\) [\d.]+ mm\./,
    );
    expect(text(result)).toContain("Kept in place: Plate, Shell.");
    expect(text(result)).toContain(
      "Left in, as nothing frees it: Ball (every way out is blocked, by Shell (6 ways)).",
    );
  }, 180_000);

  it("takes out together parts none of which comes out alone, past the pocket they sit in", async () => {
    // A plug in a pocket with a pin across it: the pin cannot leave the
    // plug, nor the plug the pin, but the two come up out of the pocket.
    const result = await build({
      code: [
        "from build123d import *",
        'show(Box(60, 60, 30) - Pos(0, 0, 7.5) * Box(40, 40, 15), name="Base")',
        'show(Pos(0, 0, 7.5) * Box(20, 20, 15) - Pos(0, 0, 7.5) * Rot(0, 90, 0) * Cylinder(2, 30), name="Plug")',
        'show(Pos(0, 0, 7.5) * Rot(0, 90, 0) * Cylinder(2, 36), name="Pin")',
      ].join("\n"),
      explode: { stay: ["Base"] },
      exports: [{ path: "apart/plug.json" }],
    });
    const sequence = JSON.parse(
      await readFile(join(root, "apart", "plug.json"), "utf8"),
    ) as { positions: string[][] };

    expect(result.isError, text(result)).toBeUndefined();
    // Up past the base's top, 15 mm, and half its own height further.
    expect(text(result)).toContain(
      "Moved apart: 2 parts taken out in 1 step, those nothing frees alone together with what holds them in, the first out first, each along a way found free on the parts' meshes and moved past what it sits against: Plug with Pin +Z 22.5 mm.",
    );
    expect(sequence.positions).toEqual([
      ["all out"],
      ["Plug and 1 with it in"],
    ]);
  }, 180_000);

  it("moves parts taken out the same way further apart, so none lies where one taken out after it passes", async () => {
    const result = await build({
      code: [
        "from build123d import *",
        'show(Pos(0, 0, 5) * Box(40, 40, 10), name="Base")',
        'show(Pos(0, 0, 15) * Box(40, 40, 10), name="Low")',
        'show(Pos(0, 0, 25) * Box(40, 40, 10), name="Middle")',
        'show(Pos(0, 0, 35) * Box(40, 40, 10), name="High")',
      ].join("\n"),
      explode: { stay: ["Base"] },
    });

    expect(result.isError, text(result)).toBeUndefined();
    // Each first moved up by half its thickness; each taken out earlier then
    // moved on, 2 mm clear of where the next one ends up.
    expect(text(result)).toContain(
      "the first out first, each along a way found free on the parts' meshes and moved past what it sits against: High +Z 9 mm; Middle +Z 7 mm; Low +Z 5 mm.",
    );
  }, 180_000);

  it("draws an assembly moved apart, saying how", async () => {
    const result = await draw({
      code: bolted,
      explode: { stay: ["Base"] },
      views: [{ view: "front" }, { view: "iso" }],
      outputs: [{ path: "apart/drawn.pdf" }],
    });

    expect(result.isError, text(result)).toBeUndefined();
    expect(text(result)).toContain(
      "Moved apart: 2 parts taken out one at a time",
    );
    // From the base's foot at -10 to the bolt's head, moved up to 71.
    expect(text(result)).toContain("front view 60 × 81 mm");
  }, 180_000);

  it("moves every part but the largest apart when explode names none, in a build and in a drawing", async () => {
    const built = await build({
      code: bolted,
      explode: {},
      exports: [
        { path: "apart/all-but-base.json" },
        { path: "apart/all-but-base.stl", exploded: true },
      ],
    });

    expect(built.isError, text(built)).toBeUndefined();
    expect(text(built)).toContain(
      "each along a way found free on the parts' meshes and moved past what it sits against: Bolt +Z 44 mm; Lid +Z 5 mm.",
    );
    expect(text(built)).toContain("Kept in place: Base.");
    const sequence = JSON.parse(
      await readFile(join(root, "apart", "all-but-base.json"), "utf8"),
    ) as { positions: string[][] };
    expect(sequence.positions).toEqual([["all out"], ["Lid in"], ["Bolt in"]]);
    // The bolt's head moved up from 27 to 71.
    expect(
      heights(await readFile(join(root, "apart", "all-but-base.stl"))),
    ).toEqual([-10, 71]);

    const drawn = await draw({
      code: bolted,
      explode: {},
      views: [{ view: "front" }],
      outputs: [{ path: "apart/all-but-base.pdf" }],
    });

    expect(drawn.isError, text(drawn)).toBeUndefined();
    expect(text(drawn)).toContain("front view 60 × 81 mm");
  }, 180_000);
});
