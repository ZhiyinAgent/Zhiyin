/**
 * The studio against a real build123d.
 *
 * The other tests use a stand-in that answers as the harness would, which
 * proves the approvals and the files but not that the harness measures, draws
 * and exports what a script builds. These run the harness in a made CAD
 * environment, confined as Zhiyin confines it. They are skipped unless that
 * environment's Python is named, because the gate installs nothing:
 *
 *   $env:ZHIYIN_CAD_PYTHON = "…\cad\Scripts\python.exe"; npx vitest run --project system-boundary packages/feature/cad-studio
 */

import { execFile } from "node:child_process";
import {
  mkdir,
  readFile,
  readdir,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { inflateRawSync, inflateSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { cadAutomation } from "../src/index.js";
import { confinedPython, harness, python } from "./confined-cad-python.js";

type Result = {
  isError?: boolean;
  content: { type: string; text?: string; data?: string }[];
};

const folders = new TemporaryFolders();

/** A one-page PDF's drawing commands, as the CAD studio writes them. */
function zlibInflated(pdf: Buffer): string {
  const start = pdf.indexOf("stream\n") + "stream\n".length;
  const end = pdf.indexOf("\nendstream", start);
  return inflateSync(pdf.subarray(start, end)).toString("latin1");
}

/** How many edges of a binary STL's mesh border one triangle only, its corners joined by place. */
function openEdgesOfStl(stl: Buffer): number {
  const uses = new Map<string, number>();
  const count = stl.readUInt32LE(80);
  for (let i = 0; i < count; i++) {
    const corners = [0, 1, 2].map((corner) =>
      [0, 4, 8]
        .map((k) =>
          Math.round(stl.readFloatLE(84 + i * 50 + 12 + corner * 12 + k) * 1e4),
        )
        .join(","),
    );
    for (const [a, b] of [
      [corners[0]!, corners[1]!],
      [corners[1]!, corners[2]!],
      [corners[2]!, corners[0]!],
    ] as const) {
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      uses.set(key, (uses.get(key) ?? 0) + 1);
    }
  }
  return [...uses.values()].filter((used) => used === 1).length;
}

/** The model file a 3MF package holds, read from the zip's central directory. */
async function modelOf3mf(path: string): Promise<string> {
  const zip = await readFile(path);
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let at = zip.readUInt32LE(end + 16);
  const entries = zip.readUInt16LE(end + 10);
  for (let i = 0; i < entries; i++) {
    const method = zip.readUInt16LE(at + 10);
    const size = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const extra = zip.readUInt16LE(at + 30);
    const comment = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.toString("utf8", at + 46, at + 46 + nameLength);
    if (name === "3D/3dmodel.model") {
      const start =
        local +
        30 +
        zip.readUInt16LE(local + 26) +
        zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + size);
      return (method === 8 ? inflateRawSync(data) : data).toString("utf8");
    }
    at += 46 + nameLength + extra + comment;
  }
  throw new Error(`${path} holds no 3D/3dmodel.model.`);
}

describe.skipIf(!python)("building with a real build123d", () => {
  let root: string;
  let data: string;
  let build: (args: Record<string, unknown>) => Promise<Result>;
  let draw: (args: Record<string, unknown>) => Promise<Result>;
  /** The meshes handed over for the person's view, read as they were. */
  const previews: { model: Buffer; parts: unknown }[] = [];

  beforeAll(async () => {
    root = await folders.make("zhiyin-real-cad-workspace-");
    data = await folders.make("zhiyin-real-cad-data-");
    const tools = cadAutomation(await confinedPython(), {
      workspaceRoot: () => root,
      harness,
      directory: join(data, "cad-studio"),
      preview: async (model, parts) => {
        previews.push({ model: await readFile(model), parts });
      },
    });
    const call = (name: string) => async (args: Record<string, unknown>) => {
      const asked = await tools.inspect(name, args);
      if (!asked.ok) throw new Error(asked.reason);
      return (await tools.callTool(
        name,
        args,
        undefined,
        asked.identity,
      )) as Result;
    };
    build = call("cad_build");
    draw = call("cad_draw");
  }, 30_000);

  afterAll(() => folders.removeAll());

  const text = (result: Result) => result.content[0]?.text ?? "";

  it("measures a plate's size, volume and holes, and writes every kind of file asked for", async () => {
    const result = await build({
      code: [
        "from build123d import *",
        "with BuildPart() as plate:",
        "    Box(80, 50, 8)",
        "    with Locations((-25, 0, 0), (25, 0, 0)):",
        "        Hole(radius=2.5)",
        "    CounterBoreHole(radius=3, counter_bore_radius=5.5, counter_bore_depth=3)",
        'show(plate.part, name="Plate")',
        "print('volume', round(plate.part.volume))",
      ].join("\n"),
      exports: [
        { path: "out/plate.step" },
        { path: "out/plate.stl" },
        { path: "out/plate.3mf" },
        { path: "out/plate.glb" },
        { path: "out/plate.png" },
      ],
    });

    expect(result.isError).toBeUndefined();
    expect(text(result)).toContain(
      "Plate: a valid solid, 80 × 50 × 8 mm, from (-40, -25, -4) to (40, 25, 4).",
    );
    expect(text(result)).toContain(
      "Round holes: 2 of 5 mm, 1 of 6 mm, 1 of 11 mm.",
    );
    expect(text(result)).toMatch(/What the script printed:\nvolume \d+/);
    const written = await readdir(join(root, "out"));
    expect(written.sort()).toEqual([
      "plate.3mf",
      "plate.glb",
      "plate.png",
      "plate.step",
      "plate.stl",
    ]);
    for (const file of written)
      expect((await stat(join(root, "out", file))).size).toBeGreaterThan(500);
    expect(await readFile(join(root, "out", "plate.step"), "latin1")).toMatch(
      /^ISO-10303-21;/,
    );
    const picture = Buffer.from(result.content[1]?.data ?? "", "base64");
    expect(picture.subarray(1, 4).toString()).toBe("PNG");
    expect([picture.readUInt32BE(16), picture.readUInt32BE(20)]).toEqual([
      960, 1004,
    ]);
    // The views written to the workspace are the picture the answer shows.
    const sheet = await readFile(join(root, "out", "plate.png"));
    expect(sheet.subarray(1, 4).toString()).toBe("PNG");
    expect([sheet.readUInt32BE(16), sheet.readUInt32BE(20)]).toEqual([
      960, 1004,
    ]);
  }, 120_000);

  it("runs a workspace script with its arguments, importing the files beside it", async () => {
    await mkdir(join(root, "parts"));
    await writeFile(join(root, "parts", "sizes.py"), "WIDTH = 30\n");
    await writeFile(
      join(root, "parts", "block.py"),
      [
        "import sys",
        "from build123d import *",
        "from sizes import WIDTH",
        "height = float(sys.argv[1])",
        'show(Box(WIDTH, 10, height), name="Block")',
      ].join("\n"),
    );

    const result = await build({ file: "parts/block.py", arguments: ["12"] });

    expect(text(result)).toContain("Block: a valid solid, 30 × 10 × 12 mm");
  }, 120_000);

  it("shows the parts a workspace module makes, quotes its lines in an error, and runs a script that only prints", async () => {
    await mkdir(join(root, "modules"));
    await writeFile(
      join(root, "modules", "pieces.py"),
      [
        "from build123d import *",
        "def make(width):",
        '    show(Box(width, 5, 5), name="Piece")',
        "def broken():",
        "    return Bx(1, 1, 1)",
      ].join("\n"),
    );
    await writeFile(
      join(root, "modules", "assemble.py"),
      "from pieces import make\nmake(20)\n",
    );
    await writeFile(
      join(root, "modules", "fails.py"),
      "from pieces import broken\nbroken()\n",
    );

    const shown = await build({ file: "modules/assemble.py" });
    const failed = await build({ file: "modules/fails.py" });
    const printed = await build({ code: "print('lift', 2 * 3.5)\n" });

    expect(text(shown)).toContain("Piece: a valid solid, 20 × 5 × 5 mm");
    expect(failed.isError).toBe(true);
    expect(text(failed)).toContain(
      'File "modules/fails.py", line 2, in <module>',
    );
    expect(text(failed)).toContain(
      'File "modules/pieces.py", line 5, in broken\n    return Bx(1, 1, 1)',
    );
    expect(printed.isError).toBeUndefined();
    expect(text(printed)).toContain("showed no part");
    expect(text(printed)).toContain("What the script printed:\nlift 7.0");
    expect(text(printed)).not.toContain("views could not be drawn");
  }, 120_000);

  it("runs a workspace module afresh at each position and in the run that checks every cut, so the parts it shows are in each", async () => {
    await mkdir(join(root, "slide"));
    await writeFile(
      join(root, "slide", "slider.py"),
      [
        "import sys",
        "from build123d import *",
        'show(Pos(float(sys.argv[1]), 0, 0) * Box(10, 10, 10), name="Slider")',
      ].join("\n"),
    );
    await writeFile(
      join(root, "slide", "main.py"),
      [
        "import slider",
        "from build123d import *",
        'show(Pos(30, 0, 0) * Box(10, 10, 10), name="Stop")',
      ].join("\n"),
    );
    await writeFile(
      join(root, "slide", "crossed.py"),
      [
        "import slider",
        "from build123d import *",
        "block = Pos(0, 40, 0) * Box(20, 20, 4)",
        "block -= Pos(0, 40, 0) * extrude(Polygon((0, 0), (10, 10), (10, 0), (0, 10), align=None), 5)",
        'print("hello from the script")',
        'show(block, name="Block")',
      ].join("\n"),
    );

    const positions = await build({
      file: "slide/main.py",
      positions: [["0"], ["30"]],
    });
    const rerun = await build({ file: "slide/crossed.py", arguments: ["0"] });

    expect(positions.isError, text(positions)).toBeUndefined();
    expect(text(positions)).toMatch(
      /At 30: Slider and Stop overlap by 1,000 mm³/,
    );
    expect(rerun.isError, text(rerun)).toBeUndefined();
    expect(text(rerun)).toContain("it would leave no valid solid");
    expect(text(rerun)).toContain("Slider: a valid solid, 10 × 10 × 10 mm");
    expect(text(rerun)).toContain("Block: a valid solid, 20 × 20 × 4 mm");
    // What the script printed, once, though it ran twice.
    expect(text(rerun).split("hello from the script")).toHaveLength(2);
  }, 120_000);

  it("draws the parts it can beside one whose faces cannot be divided into triangles, and says which", async () => {
    const result = await build({
      code: [
        "from build123d import *",
        'show(extrude(Polygon((0, 0), (10, 10), (10, 0), (0, 10), align=None), 5), name="Bowtie")',
        'show(Pos(40, 0, 0) * Box(10, 10, 10), name="Cube")',
      ].join("\n"),
    });
    const alone = await build({
      code: [
        "from build123d import *",
        'show(extrude(Polygon((0, 0), (10, 10), (10, 0), (0, 10), align=None), 5), name="Bowtie")',
      ].join("\n"),
    });

    expect(result.isError).toBeUndefined();
    expect(text(result)).toContain("Bowtie: not a valid solid");
    expect(text(result)).toContain("Cube: a valid solid");
    expect(result.content[1]?.type).toBe("image");
    expect(text(result)).toContain(
      "Not in the views: Bowtie, which is not a valid solid, so its faces could not be divided into triangles.",
    );
    expect(alone.content).toHaveLength(1);
    expect(text(alone)).toContain(
      "The views could not be drawn this time: Bowtie is not a valid solid, so its faces could not be divided into triangles. The measurements above stand.",
    );
  }, 120_000);

  it("writes no mesh file holding a part whose faces cannot be divided into triangles, and answers with the rest", async () => {
    const result = await build({
      code: [
        "from build123d import *",
        'show(extrude(Polygon((0, 0), (10, 10), (10, 0), (0, 10), align=None), 5), name="Bowtie")',
        'show(Pos(40, 0, 0) * Box(10, 10, 10), name="Cube")',
      ].join("\n"),
      exports: [
        { path: "unmeshed/all.stl" },
        { path: "unmeshed/all.3mf" },
        { path: "unmeshed/all.glb" },
        { path: "unmeshed/cube.stl", parts: ["Cube"] },
        { path: "unmeshed/cube.3mf", parts: ["Cube"] },
        { path: "unmeshed/all.step" },
      ],
    });

    expect(result.isError, text(result)).toBeUndefined();
    // The measurements and the faults stand.
    expect(text(result)).toContain("Bowtie: not a valid solid");
    expect(text(result)).toContain("Cube: a valid solid, 10 × 10 × 10 mm");
    for (const kind of ["stl", "3mf", "glb"])
      expect(text(result)).toContain(
        `unmeshed/all.${kind} was not written: Bowtie is not a valid solid, so its faces could not be divided into triangles.`,
      );
    for (const kind of ["stl", "3mf", "glb"])
      await expect(
        stat(join(root, "unmeshed", `all.${kind}`)),
      ).rejects.toThrow();
    expect(text(result)).toContain("Wrote unmeshed/all.step");
    // The cube alone is written whole: every edge of its mesh borders two triangles.
    const cube = await readFile(join(root, "unmeshed", "cube.stl"));
    expect(cube.readUInt32LE(80)).toBe(12);
    expect(openEdgesOfStl(cube)).toBe(0);
    const model = await modelOf3mf(join(root, "unmeshed", "cube.3mf"));
    expect(model).toContain('unit="millimeter"');
    expect(model).toContain('name="Cube"');
    expect(model.match(/<triangle /g)).toHaveLength(12);
    expect(model.match(/<vertex /g)).toHaveLength(8);
    expect(result.content[1]?.type).toBe("image");
  }, 120_000);

  it("reads a part exported earlier back from the workspace", async () => {
    await build({
      code: 'from build123d import *\nshow(Cylinder(10, 30), name="Peg")',
      exports: [{ path: "peg.step" }],
    });

    const result = await build({
      code: 'from build123d import *\npeg = import_step("peg.step")\nshow(peg, name="Read back")',
    });

    expect(text(result)).toContain(
      "Read back: a valid solid, 20 × 20 × 30 mm, from (-10, -10, -15) to (10, 10, 15).",
    );
  }, 120_000);

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

  it("checks every build against the design's requirements file beside its script, saying each margin and how it moved since the last build", async () => {
    await mkdir(join(root, "bracket"), { recursive: true });
    // A plate as thick as asked, with two holes, a 2 mm wall standing on it
    // and a ledge out over nothing at its top.
    await writeFile(
      join(root, "bracket", "bracket.py"),
      [
        "import sys",
        "from build123d import *",
        "thick = float(sys.argv[1])",
        "plate = Pos(0, 0, thick / 2) * Box(80, 40, thick) - [Pos(x, 0, thick / 2) * Cylinder(3.1, thick) for x in (-30, 30)]",
        "wall = Pos(0, 19, thick + 10) * Box(80, 2, 20)",
        "ledge = Pos(0, 15, thick + 19) * Box(80, 6, 2)",
        'show(plate + wall + ledge, name="Bracket")',
        'show(Pos(0, -30, thick / 2) * Cylinder(4, thick), name="Pin")',
      ].join("\n"),
    );
    await writeFile(
      join(root, "bracket", "requirements.json"),
      JSON.stringify({
        requirements: [
          {
            id: "R1",
            says: "Fits a 256 mm bed",
            check: "fits",
            box: [256, 256, 256],
          },
          {
            id: "R2",
            check: "hole",
            part: "Bracket",
            diameter: 6.2,
            tolerance: 0.1,
            count: 2,
          },
          { id: "R3", check: "wall", part: "Bracket", min: 1.5 },
          {
            id: "R4",
            says: "No overhang past 45°",
            check: "overhang",
            part: "Bracket",
            max: 45,
          },
          {
            id: "R5",
            says: "Under 50 g in PETG",
            check: "mass",
            parts: ["Bracket"],
            max: 50,
            material: "PETG",
          },
          { id: "R6", check: "size", part: "Gear", max: [10, 10, 10] },
          { id: "R7", check: "size", part: "Bracket", max: [90, 50, null] },
          { id: "R8", check: "draft", part: "Bracket", min: 1 },
          { id: "R9", check: "clearance", between: ["Bracket", "Pin"], min: 5 },
          { id: "R10", check: "separate" },
        ],
      }),
    );
    const first = await build({ file: "bracket/bracket.py", arguments: ["6"] });
    const thinner = await build({
      file: "bracket/bracket.py",
      arguments: ["4"],
    });

    expect(first.isError, text(first)).toBeUndefined();
    expect(text(first)).toContain(
      "Requirements in bracket/requirements.json: 7 of 9 checked hold, 1 not checked.",
    );
    expect(text(first)).toContain(
      "- R7 holds: Bracket is 80 × 40 × 26 mm, 80 along x where at most 90 is asked; 10 mm to spare.",
    );
    // The ledge's underside faces down, away from a mould pulled up.
    expect(text(first)).toMatch(
      /- R8 fails: Bracket has an undercut, a face with -90° of draft, leaning back from the way its half of the mould leaves it, at \(.*\); 91° past the limit\./,
    );
    // The pin's side 4 mm from its middle, 30 mm out; the plate's edge 20 mm out.
    expect(text(first)).toContain(
      "- R9 holds: Bracket comes 6 mm from Pin; 1 mm to spare.",
    );
    expect(text(first)).toContain("- R10 holds: no two of them overlap.");
    expect(text(first)).toContain(
      "- R2 holds: Bracket has 2 holes of Ø6.2; 0.1 mm to spare.",
    );
    expect(text(first)).toMatch(
      /- R3 holds: Bracket's thinnest wall is 2 mm, at \(.*\), measured at 600 points over its faces, about [\d.]+ mm apart, and \d+ more near its thinnest; 0\.5 mm to spare\./,
    );
    // The ledge's underside sticks 6 mm out from the wall, nothing below its far edge.
    expect(text(first)).toContain(
      "- R4 (No overhang past 45°) fails: Bracket has a surface steeper than 45° from upright, 480 mm² at (0, 15, 24), whose farthest point is 6 mm from an edge held up from below, where no bridge is asked.",
    );
    expect(text(first)).toContain(
      "- R6 not checked: Gear is not shown in this build.",
    );
    // 2 mm less plate is lighter, so the mass has more to spare than before.
    expect(text(thinner)).toMatch(
      /- R5 \(Under 50 g in PETG\) holds, its margin up from ([\d.]+) to ([\d.]+) g since the last build: [\d.]+ g in PETG, where at most 50 g is asked; [\d.]+ g to spare\./,
    );
    const [, before, after] = /margin up from ([\d.]+) to ([\d.]+) g/.exec(
      text(thinner),
    )!;
    expect(Number(after) - Number(before)).toBeCloseTo(
      ((80 * 40 * 2 - 2 * Math.PI * 3.1 ** 2 * 2) * 1.27) / 1000,
      1,
    );

    const missing = await build({
      file: "bracket/bracket.py",
      arguments: ["6"],
      requirements: "bracket/nowhere.json",
    }).catch((error: Error) => error.message);
    expect(missing).toBe(
      "bracket/nowhere.json does not exist in the workspace. Write it first, or leave out requirements.",
    );
    await writeFile(
      join(root, "bracket", "wrong.json"),
      JSON.stringify({
        requirements: [
          { id: "R1", check: "hole", part: "Bracket", diameter: 6 },
        ],
      }),
    );
    // A file that cannot be read as requirements does not block the build.
    const wrong = await build({
      file: "bracket/bracket.py",
      arguments: ["6"],
      requirements: "bracket/wrong.json",
    });
    expect(text(wrong)).toMatch(
      /Bracket and Pin are as the last build of bracket\/bracket\.py with the same arguments measured them\./,
    );
    expect(text(wrong)).toContain(
      "No requirement was checked: bracket/wrong.json: R1: a hole check needs tolerance. Fix the file, and the next build checks it.",
    );
  }, 240_000);

  it("measures each surface steeper than an overhang limit by how far it reaches from an edge held up from below, so a short bridge passes and a wide ceiling fails", async () => {
    await mkdir(join(root, "bridges"), { recursive: true });
    await writeFile(
      join(root, "bridges", "parts.py"),
      [
        "from build123d import *",
        // A box hollow from its open bottom up to a 74 × 54 mm ceiling at
        // 35 mm, with a Ø6 hole through its two side walls.
        "box = Pos(0, 0, 20) * Box(80, 60, 40) - Pos(0, 0, 17.5) * Box(74, 54, 35)",
        "box -= Pos(0, 0, 20) * Rot(0, 90, 0) * Cylinder(3, 100)",
        'show(box, name="Box")',
        // A block with a Ø6 hole and a 14 mm wide window through it, the
        // window's top at 19 mm.
        "block = Pos(0, 0, 15) * Box(40, 20, 30)",
        "block -= Pos(-10, 0, 15) * Rot(90, 0, 0) * Cylinder(3, 30)",
        "block -= Pos(10, 0, 15) * Box(14, 30, 8)",
        'show(Pos(0, 100, 0) * block, name="Pierced")',
        'show(Pos(0, -100, 10) * Box(20, 20, 20), name="Upright")',
      ].join("\n"),
    );
    await writeFile(
      join(root, "bridges", "requirements.json"),
      JSON.stringify({
        requirements: [
          { id: "O1", check: "overhang", part: "Box", max: 45, bridge: 10 },
          { id: "O2", check: "overhang", part: "Pierced", max: 45, bridge: 15 },
          { id: "O3", check: "overhang", part: "Pierced", max: 45, bridge: 10 },
          { id: "O4", check: "overhang", part: "Upright", max: 45 },
        ],
      }),
    );

    const built = await build({ file: "bridges/parts.py" });
    const said = text(built);
    const reach = (id: string) =>
      Number(
        new RegExp(`- ${id} .*?farthest point (?:is )?([\\d.]+) mm`).exec(
          said,
        )![1],
      );

    expect(built.isError, said).toBeUndefined();
    expect(said).toContain(
      "Requirements in bridges/requirements.json: 2 of 4 checked hold.",
    );
    // The ceiling's middle is 27 mm from the walls that hold it up.
    expect(said).toMatch(
      /- O1 fails: Box has 3 surfaces steeper than 45° from upright; the one reaching farthest, 3996 mm² at \(0, 0, 35\), has its farthest point [\d.]+ mm from an edge held up from below, where a bridge of 10 mm, 5 mm from either side, is asked\./,
    );
    expect(reach("O1")).toBeCloseTo(27, 0);
    // The window's top spans 14 mm between its sides, within a 15 mm bridge.
    expect(said).toMatch(
      /- O2 holds: Pierced's 2 surfaces steeper than 45° from upright are bridged, the farthest point [\d.]+ mm from an edge held up from below, where a bridge of 15 mm, 7.5 mm from either side, is asked\./,
    );
    expect(reach("O2")).toBeCloseTo(7, 0);
    expect(said).toMatch(
      /- O3 fails: Pierced has 2 surfaces steeper than 45° from upright; the one reaching farthest, 280 mm² at \(10, 100, 19\), has its farthest point [\d.]+ mm from an edge held up from below, where a bridge of 10 mm, 5 mm from either side, is asked\./,
    );
    expect(said).toContain(
      "- O4 holds: Upright overhangs at most 0° from upright, its bed below it; 45° to spare.",
    );
  }, 240_000);

  it("imports only the files the approval saw, not a compiled copy left beside them", async () => {
    const folder = join(root, "cached");
    await mkdir(folder, { recursive: true });
    const sizes = join(folder, "sizes.py");
    // A compiled sizes.py that says 90, left where Python looks first, then
    // the source changed to 80 with its time kept, so Python takes the copy.
    await writeFile(sizes, "WIDTH = 90\n");
    const { mtime } = await stat(sizes);
    await promisify(execFile)(python!, [
      "-I",
      "-c",
      "import py_compile, sys; py_compile.compile(sys.argv[1], doraise=True)",
      sizes,
    ]);
    await writeFile(sizes, "WIDTH = 80\n");
    await utimes(sizes, mtime, mtime);
    const { stdout } = await promisify(execFile)(python!, [
      "-I",
      "-c",
      "import sys; sys.path.insert(0, sys.argv[1]); import sizes; print(sizes.WIDTH)",
      folder,
    ]);
    expect(stdout.trim()).toBe("90");
    await writeFile(
      join(folder, "bar.py"),
      'from build123d import *\nfrom sizes import WIDTH\nshow(Box(WIDTH, 10, 10), name="Bar")\n',
    );

    const built = await build({ file: "cached/bar.py" });

    expect(text(built)).toContain("Bar: a valid solid, 80 × 10 × 10 mm");
  }, 120_000);

  describe("a script that tries to change what the studio says of its parts", () => {
    /** A 400 mm plate, which a 256 mm bed does not take, built after `tamper` runs. */
    const plate = (tamper: string[]) =>
      [
        "from build123d import *",
        ...tamper,
        'show(Box(400, 100, 5), name="Plate")',
      ].join("\n");
    const tampered = async (name: string, tamper: string[]) => {
      await mkdir(join(root, "tamper"), { recursive: true });
      await writeFile(
        join(root, "tamper", "requirements.json"),
        JSON.stringify({
          requirements: [{ id: "R1", check: "fits", box: [256, 256, 256] }],
        }),
      );
      await writeFile(join(root, "tamper", `${name}.py`), plate(tamper));
      return build({
        file: `tamper/${name}.py`,
        exports: [{ path: `tamper/${name}.step` }],
      });
    };
    /** What the studio must say of the plate, whatever the script did. */
    const truthful = (result: Result) => {
      expect(result.isError, text(result)).toBeUndefined();
      expect(text(result)).toContain("Plate: a valid solid, 400 × 100 × 5 mm");
      expect(text(result)).toMatch(/- R1 fails: /);
      expect(text(result)).not.toMatch(/- R1 holds/);
    };

    it("still finds the requirement unmet when the script replaces the checker", async () => {
      truthful(
        await tampered("checker", [
          "import sys, zhiyin_cad.requirements as checking",
          "def holds(parts, asked, *rest, **named):",
          "    return [{'id': one['id'], 'holds': True, 'margin': 1, 'said': one['id'] + ' holds'} for one in asked]",
          "checking.checked = holds",
          "sys.modules['zhiyin_cad.requirements'].checked = holds",
        ]),
      );
    }, 120_000);

    it("still says the true size when the script wraps the measuring", async () => {
      truthful(
        await tampered("measuring", [
          "import zhiyin_cad.measure as measuring",
          "real = measuring.measured",
          "def smaller(*given, **named):",
          "    said = real(*given, **named)",
          "    said['size'] = [100, 100, 5]",
          "    return said",
          "measuring.measured = smaller",
        ]),
      );
    }, 120_000);

    it("still answers from the measuring when the script writes an answer of its own", async () => {
      const answered = await tampered("answer", [
        "import json, os, sys",
        "said = {'parts': [{'name': 'Plate', 'valid': True, 'solids': 1, 'size': [100, 100, 5], 'min': [0, 0, 0], 'max': [100, 100, 5], 'volume': 50000, 'area': 1, 'centre': [0, 0, 0], 'faces': {}, 'holes': []}], 'overlaps': [], 'exports': [], 'seconds': {'total': 1}, 'picture': None, 'requirements': [{'id': 'R1', 'holds': True}]}",
        // The harness's own folder, found in its frames, and where the run after it might write.
        "frame = sys._getframe()",
        "while frame is not None:",
        "    folder = frame.f_locals.get('folder')",
        "    if isinstance(folder, str):",
        "        for place in (folder, os.path.join(os.path.dirname(folder), 'out')):",
        "            try:",
        "                os.makedirs(place, exist_ok=True)",
        "                with open(os.path.join(place, 'answer.json'), 'w') as out:",
        "                    json.dump(said, out)",
        "                print('wrote', os.path.basename(place))",
        "            except OSError:",
        "                print('refused', os.path.basename(place))",
        "    frame = frame.f_back",
      ]);

      truthful(answered);
      // It wrote an answer in its own folder, and could not reach the measuring run's.
      expect(text(answered)).toContain("wrote script");
      expect(text(answered)).toContain("refused out");
      expect(text(answered)).not.toContain("wrote out");
    }, 120_000);

    it("writes exports of the size the answer gives, from a build that wrapped the measuring", async () => {
      await tampered("measuring", [
        "import zhiyin_cad.measure as measuring",
        "real = measuring.measured",
        "measuring.measured = lambda *given, **named: {**real(*given, **named), 'size': [100, 100, 5]}",
      ]);
      const readBack = await build({
        code: 'from build123d import *\nshow(import_step("tamper/measuring.step"), name="Plate")\n',
      });

      expect(text(readBack)).toContain(
        "Plate: a valid solid, 400 × 100 × 5 mm",
      );
    }, 180_000);
  });

  it("checks the requirements of a part of overlapping solids by the material they make, as it measures it", async () => {
    await mkdir(join(root, "cubes"), { recursive: true });
    await writeFile(
      join(root, "cubes", "cubes.py"),
      [
        "from build123d import *",
        // Two 10 mm cubes overlapping by half, shown as one part: 15 × 10 × 10 of material.
        'show(Compound([Box(10, 10, 10), Pos(5, 0, 0) * Box(10, 10, 10)]), name="Cubes")',
      ].join("\n"),
    );
    await writeFile(
      join(root, "cubes", "requirements.json"),
      JSON.stringify({
        requirements: [
          {
            id: "M1",
            check: "mass",
            parts: ["Cubes"],
            max: 13,
            material: "steel",
          },
          { id: "W1", check: "wall", part: "Cubes", min: 1 },
        ],
      }),
    );

    const result = await build({ file: "cubes/cubes.py" });

    expect(result.isError, text(result)).toBeUndefined();
    expect(text(result)).toContain("Volume 1,500 mm³");
    expect(text(result)).toContain("- M1 holds: 11.78 g in steel");
    expect(text(result)).toMatch(/- W1 holds: Cubes's thinnest wall is 10 mm/);
  }, 120_000);

  it("fails a hole requirement short of holes, and a draft requirement on any face its half of the mould cannot leave", async () => {
    await mkdir(join(root, "moulds"), { recursive: true });
    await writeFile(
      join(root, "moulds", "moulds.py"),
      [
        "import math",
        "from build123d import *",
        "def plate(diameters):",
        "    p = Box(60, 30, 5)",
        "    for i, d in enumerate(diameters):",
        "        p -= Pos(-22.5 + 15 * i, 0, 0) * Cylinder(d / 2, 5)",
        "    return p",
        // Each tapered 5° from a 20 mm square, 20 mm high, standing on z = 0.
        "right = extrude(Rectangle(20, 20), 20, taper=5)",
        "lower = extrude(Rectangle(20, 20), 10, taper=5)",
        "neck = 20 - 20 * math.tan(math.radians(5))",
        "waist = lower + Pos(0, 0, 10) * extrude(Rectangle(neck, neck), 10, taper=-5)",
        // A groove round the right taper, its own walls drafted too, its ceiling facing down.
        "groove = Pos(0, 0, 9) * Box(30, 30, 2) - Pos(0, 0, 8) * extrude(Rectangle(14, 14), 2, taper=5)",
        "half = Pos(0, 0, 10) * extrude(Rectangle(20, 20), 10, taper=5)",
        "parts = {",
        '    "TwoHoles": plate([8, 8]),',
        '    "OneTooWide": plate([8, 8, 8, 8.3]),',
        '    "FourHoles": plate([8, 8, 8, 8]),',
        '    "Right": right,',
        '    "Reversed": extrude(Rectangle(20, 20), 20, taper=-5),',
        '    "Waist": waist,',
        '    "Grooved": right - groove,',
        // Widest at its middle, tapering away from it both ways.
        '    "Diamond": half + mirror(half, Plane.XY.offset(10)),',
        '    "Straight": Pos(0, 0, 10) * Box(20, 20, 20),',
        "}",
        "for i, (name, part) in enumerate(parts.items()):",
        "    show(Pos(70 * i, 0, 0) * part, name=name)",
      ].join("\n"),
    );
    const hole = (id: string, part: string) => ({
      id,
      check: "hole",
      part,
      diameter: 8,
      tolerance: 0.1,
      count: 4,
    });
    const draft = (id: string, part: string, parting?: number) => ({
      id,
      check: "draft",
      part,
      min: 3,
      ...(parting === undefined ? {} : { parting }),
    });
    await writeFile(
      join(root, "moulds", "requirements.json"),
      JSON.stringify({
        requirements: [
          hole("H1", "TwoHoles"),
          hole("H2", "OneTooWide"),
          hole("H3", "FourHoles"),
          draft("D1", "Right"),
          draft("D2", "Reversed"),
          draft("D3", "Reversed", 20),
          draft("D4", "Waist"),
          draft("D5", "Waist", 10),
          draft("D6", "Waist", 15),
          draft("D7", "Grooved"),
          draft("D8", "Diamond", 10),
          draft("D9", "Diamond"),
          draft("D10", "Straight"),
        ],
      }),
    );

    const built = await build({ file: "moulds/moulds.py" });
    const said = text(built);

    expect(built.isError, said).toBeUndefined();
    expect(said).toContain(
      "Requirements in moulds/requirements.json: 4 of 13 checked hold.",
    );
    // Short of holes is a failure, with no size margin to speak of.
    expect(said).toContain(
      "- H1 fails: TwoHoles has 2 of the 4 holes of Ø8 ± 0.1 asked; its holes are 2× Ø8.\n",
    );
    expect(said).toContain(
      "- H2 fails: OneTooWide has 3 of the 4 holes of Ø8 ± 0.1 asked; its holes are 3× Ø8, 1× Ø8.3.\n",
    );
    expect(said).toContain(
      "- H3 holds: FourHoles has 4 holes of Ø8; 0.1 mm to spare.",
    );
    // Narrower at the top, it leaves a mould pulled up.
    expect(said).toMatch(
      /- D1 holds: Right's steepest wall has 5° of draft along the pull, at \(.*\); 2° to spare\./,
    );
    // Wider at the top, it leaves only a mould parted at its top.
    expect(said).toMatch(
      /- D2 fails: Reversed has an undercut, a face with -5° of draft, leaning back from the way its half of the mould leaves it, at \(.*\); 8° past the limit\./,
    );
    expect(said).toMatch(
      /- D3 holds: Reversed's steepest wall has 5° of draft along the pull, at \(.*\), the mould parted at 20 mm along the pull; 2° to spare\./,
    );
    // A waist cannot leave a mould however it is parted.
    for (const [id, parted] of [
      ["D4", ""],
      ["D5", ", the mould parted at 10 mm along the pull"],
      ["D6", ", the mould parted at 15 mm along the pull"],
    ])
      expect(said).toMatch(
        new RegExp(
          `- ${id} fails: Waist has an undercut, a face with -5° of draft, leaning back from the way its half of the mould leaves it, at \\(.*\\)${parted}; 8° past the limit\\.`,
        ),
      );
    // The groove's ceiling, 10 mm up, faces straight down.
    expect(said).toMatch(
      /- D7 fails: Grooved has an undercut, a face with -90° of draft, leaning back from the way its half of the mould leaves it, at \([-\d.]+, [-\d.]+, 10\); 93° past the limit\./,
    );
    expect(said).toMatch(
      /- D8 holds: Diamond's steepest wall has 5° of draft along the pull, at \(.*\), the mould parted at 10 mm along the pull; 2° to spare\./,
    );
    expect(said).toMatch(
      /- D9 fails: Diamond has an undercut, a face with -5° of draft/,
    );
    expect(said).toMatch(
      /- D10 fails: Straight's steepest wall has 0° of draft along the pull, at \(.*\); 3° past the limit\./,
    );
  }, 240_000);

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

  it("tells a run that ended without an answer what it printed, and none of ezdxf's warnings about the system's fonts", async () => {
    const result = await build({
      code: [
        "import logging, os",
        "logging.getLogger('ezdxf').warning(\"cannot open font 'C:\\\\Windows\\\\Fonts\\\\broken.ttf'\")",
        "print('measured the lobes')",
        "os._exit(3)",
      ].join("\n"),
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("measured the lobes");
    expect(text(result)).not.toContain("cannot open font");
  }, 120_000);

  it("says where a script crashed the CAD studio's Python, and what it printed before", async () => {
    await mkdir(join(root, "crashing"), { recursive: true });
    // Reading memory at address 0 crashes Python itself, as the geometry
    // kernel does on a shape it cannot work; ctypes would catch it on Windows.
    await writeFile(
      join(root, "crashing", "kernel.py"),
      "import faulthandler\ndef soften(shape):\n    return faulthandler._read_null()\n",
    );
    await writeFile(
      join(root, "crashing", "stand.py"),
      [
        "from build123d import *",
        "from kernel import soften",
        "print('built the base')",
        "soften(Box(1, 1, 1))",
      ].join("\n"),
    );

    const result = await build({ file: "crashing/stand.py" });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain(
      "Python crashed at crashing/kernel.py line 3, in soften, and the build stopped there.",
    );
    expect(text(result)).toContain("What the script printed:\nbuilt the base");
  }, 120_000);

  it("colours a section's cut part as the build does, whatever order its parts are named in", async () => {
    // Plate is shown first and takes the first colour, Bar the second; the
    // section names them the other way round and cuts only the plate.
    const built = await build({
      code: [
        "from build123d import *",
        'show(Box(40, 40, 10), name="Plate")',
        'show(Pos(200, 0, 0) * Box(20, 20, 20), name="Bar")',
      ].join("\n"),
      sections: [
        { through: [0, 0, 0], looking: "right", parts: ["Bar", "Plate"] },
      ],
    });
    expect(built.isError, text(built)).toBeUndefined();
    await mkdir(join(root, "sections"), { recursive: true });
    await writeFile(
      join(root, "sections", "ordered.png"),
      Buffer.from(built.content[1]?.data ?? "", "base64"),
    );
    const seen = await build({
      code: [
        "import sys",
        "from PIL import Image",
        "picture = Image.open(sys.argv[1]).convert('RGB')",
        "below = picture.crop((0, 1004, 480, 1484))",
        "def near(colour):",
        "    lighter = [round(c + (255 - c) * 0.55) for c in colour]",
        "    return sum(1 for p in below.getdata() if all(abs(a - b) <= 6 for a, b in zip(p, lighter)))",
        "print('plate colour', near((92, 134, 186)) > 400, 'bar colour', near((222, 140, 66)) > 100)",
        "from build123d import Box",
        "show(Box(1, 1, 1), name='Check')",
      ].join("\n"),
      arguments: ["sections/ordered.png"],
    });

    expect(text(seen)).toContain("plate colour True bar colour False");
  }, 240_000);

  it("adds sections to the picture that show inside the parts, cuts through pieces a plane parts, and says a cut that misses", async () => {
    // A cup with a pin across it, the pin a part of its own; and a U whose
    // prongs a level cut parts into two pieces.
    const cupped = await build({
      code: [
        "from build123d import *",
        "cup = Cylinder(20, 40) - Pos(0, 0, -5) * Cylinder(16, 40)",
        'show(cup, name="Cup")',
        'show(Rot(0, 90, 0) * Cylinder(4, 44), name="Pin")',
      ].join("\n"),
      sections: [
        { through: [0, 0, 0], looking: "front" },
        { through: [0, 0, 500], looking: "top" },
      ],
    });
    const forked = await build({
      code: [
        "from build123d import *",
        'show(Box(40, 10, 30) - Pos(0, 0, 5) * Box(20, 12, 30), name="Fork")',
      ].join("\n"),
      sections: [{ through: [0, 0, 8], looking: "bottom" }],
    });
    // A bore cut away off its axis, whose round face build123d gives no radius.
    const cutaway = await build({
      code: [
        "from build123d import *",
        'show(Box(60, 60, 40) - Cylinder(15, 50) - Pos(0, -24, 0) * Box(70, 40, 50), name="Housing")',
      ].join("\n"),
      sections: [{ through: [0, -3, 0], looking: "front" }],
    });
    await mkdir(join(root, "sections"), { recursive: true });
    await writeFile(
      join(root, "sections", "cup.png"),
      Buffer.from(cupped.content[1]?.data ?? "", "base64"),
    );
    const seen = await build({
      code: [
        "import sys",
        "from PIL import Image",
        "picture = Image.open(sys.argv[1]).convert('RGB')",
        "print('size', *picture.size)",
        "below = picture.crop((0, 1004, 480, 1484))",
        "def near(colour):",
        "    lighter = [round(c + (255 - c) * 0.55) for c in colour]",
        "    return sum(1 for p in below.getdata() if all(abs(a - b) <= 6 for a, b in zip(p, lighter)))",
        "print('cup filled', near((92, 134, 186)) > 400, 'pin filled', near((222, 140, 66)) > 100)",
        "from build123d import Box",
        "show(Box(1, 1, 1), name='Check')",
      ].join("\n"),
      arguments: ["sections/cup.png"],
    });

    expect(cupped.isError, text(cupped)).toBeUndefined();
    expect(text(cupped)).toContain(
      "Below them, the section asked for, numbered in order",
    );
    expect(text(cupped)).toContain(
      "Section 2 was not drawn: section 2's plane through (0, 0, 500) cuts no part",
    );
    expect(forked.isError, text(forked)).toBeUndefined();
    expect(text(forked)).toContain("Below them, the section asked for");
    expect(text(forked)).not.toContain("could not be drawn");
    expect(text(cutaway)).toContain("Below them, the section asked for");
    expect(text(cutaway)).not.toContain("could not be drawn");
    // Under the four views, one panel: the cup cut, and the pin across it, each in its colour.
    expect(text(seen)).toContain("size 960 1484");
    expect(text(seen)).toContain("cup filled True pin filled True");
  }, 180_000);

  it("names each part in every view it shows in, a part too small to hold its name beside it, and alike numbered parts once", async () => {
    await mkdir(join(root, "named"), { recursive: true });
    const shown = await build({
      code: [
        "from build123d import *",
        'show(Box(80, 50, 30), name="Housing")',
        'show(Pos(0, 0, 18) * Cylinder(2, 6), name="Peg")',
        "for i in range(6):",
        '    show(Pos(-30 + 12 * i, -30, 0) * Cylinder(3, 10), name=f"Bolt {i + 1}")',
      ].join("\n"),
    });
    await writeFile(
      join(root, "named", "parts.png"),
      Buffer.from(shown.content[1]?.data ?? "", "base64"),
    );
    // Each name, written as the views write a part's name, looked for in
    // each of the four views pixel for pixel.
    const seen = await build({
      code: [
        "import sys",
        "import numpy as np",
        "from PIL import Image, ImageDraw, ImageFont",
        "sheet = np.asarray(Image.open(sys.argv[1]).convert('RGB')).astype(int)",
        "ink = np.array((52, 58, 68))",
        "def written(name):",
        "    im = Image.new('RGB', (240, 40), (255, 255, 255))",
        "    ImageDraw.Draw(im).text((10, 10), name, fill=tuple(ink), font=ImageFont.load_default(size=13))",
        "    a = np.asarray(im).astype(int)",
        "    ys, xs = np.nonzero((a != 255).any(axis=2))",
        "    return a[ys.min():ys.max() + 1, xs.min():xs.max() + 1]",
        "def found(panel, pattern):",
        "    h, w, _ = pattern.shape",
        "    py, px = [v[0] for v in np.nonzero((pattern == ink).all(axis=2))]",
        "    for y, x in zip(*np.nonzero((panel == ink).all(axis=2))):",
        "        y, x = y - py, x - px",
        "        if 0 <= y and 0 <= x and y + h <= panel.shape[0] and x + w <= panel.shape[1] and (panel[y:y + h, x:x + w] == pattern).all():",
        "            return True",
        "    return False",
        "panels = [sheet[44 + r * 480:44 + (r + 1) * 480, c * 480:(c + 1) * 480] for r in (0, 1) for c in (0, 1)]",
        "for name in ('Housing', 'Peg', 'Bolt (all 6)', 'Bolt 1'):",
        "    print(name, 'named in', sum(found(panel, written(name)) for panel in panels), 'views')",
        "from build123d import Box",
        "show(Box(1, 1, 1), name='Check')",
      ].join("\n"),
      arguments: ["named/parts.png"],
    });

    expect(text(seen)).toContain("Housing named in 4 views");
    expect(text(seen)).toContain("Peg named in 4 views");
    // The bolts stand in a row in front of the housing: hidden behind one
    // another from the right, but each view shows one, which names them all.
    expect(text(seen)).toContain("Bolt (all 6) named in 4 views");
    expect(text(seen)).toContain("Bolt 1 named in 0 views");
  }, 180_000);

  it("names two parts that overlap, and the volume they share", async () => {
    const result = await build({
      code: [
        "from build123d import *",
        'show(Box(20, 20, 20), name="Left")',
        'show(Pos(10, 0, 0) * Box(20, 20, 20), name="Right")',
      ].join("\n"),
    });

    expect(text(result)).toContain(
      "Left and Right overlap by 4,000 mm³, what they share 10 mm thick, from (0, -10, -10) to (10, 10, 10): far deeper than a press fit, which goes in by hundredths of a millimetre, so one part runs into the other.",
    );
  }, 120_000);

  it("measures what two parts of several solids each share, turned, as it does upright", async () => {
    // Four retainers sunk 1.1 mm into four buckets, each row one part,
    // turned and moved together as a bank of an engine is.
    const rows = (place: string) =>
      build({
        code: [
          "from build123d import *",
          `place = ${place}`,
          "retainer = lambda: Cylinder(14.0, 5.0) - Cylinder(3.2, 6.0)",
          "bucket = lambda: Cylinder(15.5, 26.0) - Pos(0, 0, 1.0) * Cylinder(12.9, 24.0)",
          "row = lambda make, z: Compound(children=[Pos(x, 0, z) * make() for x in (0, 40, 80, 120)])",
          'show(place * row(retainer, 10.0), name="Retainers")',
          'show(place * row(bucket, 0.0), name="Buckets")',
        ].join("\n"),
      });

    for (const placed of [
      await rows("Pos(0, 0, 0)"),
      await rows("Rotation(-45, 0, 0) * Pos(-200, 150, 200)"),
    ]) {
      expect(text(placed)).toContain(
        "Retainers and Buckets overlap by 1,859 mm³, what they share 1.1 mm thick",
      );
    }
  }, 180_000);

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

  it("names what floats in an assembly, held by nothing: a piece of a part, or a part on its own, but not one turning with a clearance, nor parts laid out apart", async () => {
    // A drum with four blades, the last put out beyond it in the air, a
    // casing round them that touches the drum, and a pin standing off alone;
    // a bearing on the casing, an axle turning in its bore with 0.2 mm all
    // round, and a washer standing 2 mm off the bearing's face.
    const assembly = await build({
      code: [
        "from build123d import *",
        "show(Cylinder(50, 100, rotation=(90, 0, 0)), name='Drum')",
        "blade = Box(2, 30, 60).moved(Location((0, 0, 80)))",
        "pieces = [blade.rotate(Axis.Y, 90 * k) for k in range(3)] + [blade.moved(Location((0, 200, 0)))]",
        "show(Compound(children=pieces), name='Blades')",
        "show(Cylinder(130, 20, rotation=(90, 0, 0)) - Cylinder(50, 20, rotation=(90, 0, 0)), name='Casing')",
        "show(Cylinder(3, 40).moved(Location((300, 0, 0))), name='Pin')",
        "show(Pos(0, 0, 140) * (Box(40, 20, 20) - Cylinder(5.2, 20, rotation=(90, 0, 0))), name='Bearing')",
        "show(Pos(0, 0, 140) * Cylinder(5, 60, rotation=(90, 0, 0)), name='Axle')",
        "show(Pos(15, 13, 140) * Box(8, 2, 8), name='Washer')",
      ].join("\n"),
    });
    // A bracket and its lid, side by side to be printed.
    const plate = await build({
      code: [
        "from build123d import *",
        "show(Box(40, 30, 5), name='Bracket')",
        "show(Pos(60, 0, 0) * Box(40, 30, 2), name='Lid')",
      ].join("\n"),
    });

    expect(assembly.isError, text(assembly)).toBeUndefined();
    expect(text(assembly)).toContain(
      "Held by nothing: Pin, Washer and 1 of the 4 pieces of Blades. Each piece of an assembly sits on, in or against another, or turns or slides in it with a clearance of a millimetre or less; one further than that from everything floats where it was put.",
    );
    expect(plate.isError, text(plate)).toBeUndefined();
    expect(text(plate)).not.toContain("Held by nothing");
  }, 180_000);

  it("hands over a mesh of the parts it built, for the person's view, and none for a drawing", async () => {
    previews.length = 0;
    await build({
      code: [
        "from build123d import *",
        'show(Box(80, 50, 8), name="Plate")',
        'show(Pos(0, 0, 20) * Cylinder(5, 10), name="Pin")',
      ].join("\n"),
    });

    expect(previews).toHaveLength(1);
    const [preview] = previews;
    // A binary glTF, whose nodes name the parts as the script did.
    expect(preview!.model.subarray(0, 4).toString()).toBe("glTF");
    expect(preview!.model.toString("latin1")).toContain('"name":"Pin"');
    expect(preview!.parts).toEqual([
      { name: "Plate", size: [80, 50, 8], valid: true },
      { name: "Pin", size: [10, 10, 10], valid: true },
    ]);

    await draw({
      code: 'from build123d import *\nshow(Box(80, 50, 8), name="Plate")',
      views: [{ view: "top" }],
      outputs: [{ path: "no-preview/plate.pdf" }],
    });
    expect(previews).toHaveLength(1);
  }, 180_000);

  it("answers a script's error with the line it failed on", async () => {
    const result = await build({
      code: "from build123d import *\nshow(Bx(1, 2, 3))\n",
    });

    expect(result.isError).toBe(true);
    // Named as the model knows it, with the line that failed, never by the
    // copy Zhiyin runs in its own folder.
    expect(text(result)).toContain(
      'File "the script", line 2, in <module>\n    show(Bx(1, 2, 3))',
    );
    expect(text(result)).toContain("NameError: name 'Bx' is not defined");
    expect(text(result)).not.toContain("zhiyin_cad");
    expect(text(result)).not.toContain("runs");

    await mkdir(join(root, "parts"), { recursive: true });
    await writeFile(
      join(root, "parts", "broken.py"),
      "from build123d import *\nshow(Bx(1, 2, 3))\n",
    );
    const fromFile = await build({ file: "parts/broken.py" });
    expect(text(fromFile)).toContain(
      'File "parts/broken.py", line 2, in <module>\n    show(Bx(1, 2, 3))',
    );
  }, 120_000);

  it("copies nothing a script names in its own answer, whatever it points at", async () => {
    const secret = join(data, "secret.txt");
    await writeFile(secret, "TOP SECRET CONTENT");

    const result = await build({
      code: [
        "import json, os",
        "request = json.load(open(os.path.join(os.path.dirname(__file__), 'request.json')))",
        "out = request['output']",
        `target = os.path.relpath(r'${secret}', out)`,
        "json.dump({'parts': [], 'overlaps': [], 'exports': [{'file': target, 'bytes': 1, 'parts': ['Box']}],",
        "           'seconds': {'total': 1}, 'picture': target}, open(os.path.join(out, 'answer.json'), 'w'))",
        "os._exit(0)",
      ].join("\n"),
      exports: [{ path: "loot.step" }],
    });

    expect(JSON.stringify(result)).not.toContain(
      Buffer.from("TOP SECRET CONTENT").toString("base64"),
    );
    expect(await readdir(root)).not.toContain("loot.step");
    expect(result.isError).toBe(true);
  }, 120_000);

  it("keeps nothing between builds but the files they write", async () => {
    await build({
      code: [
        "import pathlib",
        "(pathlib.Path.home() / 'left.txt').write_text('from build one')",
        "from build123d import *",
        "show(Box(1, 1, 1))",
      ].join("\n"),
    });

    const second = await build({
      code: [
        "import pathlib",
        "left = pathlib.Path.home() / 'left.txt'",
        "print(left.read_text() if left.exists() else 'nothing left')",
        "from build123d import *",
        "show(Box(1, 1, 1))",
      ].join("\n"),
    });

    expect(text(second)).toContain("What the script printed:\nnothing left");
  }, 120_000);

  it("measures a notch, a fillet and a slot without calling them holes, and counts crossing holes once each", async () => {
    const result = await build({
      code: [
        "from build123d import *",
        "with BuildPart() as notched:",
        "    Box(20, 20, 10)",
        "    with Locations((10, 0, 0)):",
        "        Hole(radius=3)",
        'show(notched.part, name="Notched")',
        "with BuildPart() as bracket:",
        "    with BuildSketch():",
        "        Polygon((0, 0), (40, 0), (40, 5), (5, 5), (5, 40), (0, 40))",
        "    extrude(amount=10)",
        "    fillet(bracket.edges().filter_by(Axis.Z).group_by(Axis.X)[1].sort_by(Axis.Y)[0:1], radius=3)",
        'show(Pos(100, 0, 0) * bracket.part, name="Bracket")',
        "with BuildPart() as slotted:",
        "    Box(50, 20, 5)",
        "    with BuildSketch():",
        "        SlotOverall(30, 8)",
        "    extrude(amount=5, both=True, mode=Mode.SUBTRACT)",
        'show(Pos(200, 0, 0) * slotted.part, name="Slotted")',
        "with BuildPart() as crossed:",
        "    Box(30, 30, 30)",
        "    Cylinder(2, 40, mode=Mode.SUBTRACT)",
        "    Cylinder(2, 40, rotation=(90, 0, 0), mode=Mode.SUBTRACT)",
        'show(Pos(300, 0, 0) * crossed.part, name="Crossed")',
      ].join("\n"),
    });

    const lineOf = (name: string) =>
      text(result)
        .split("\n")
        .find((line) => line.startsWith(`${name}:`)) ?? "";
    expect(result.isError).toBeUndefined();
    expect(lineOf("Notched")).not.toContain("Round holes");
    expect(lineOf("Bracket")).not.toContain("Round holes");
    expect(lineOf("Slotted")).not.toContain("Round holes");
    expect(lineOf("Crossed")).toContain("Round holes: 2 of 4 mm.");
  }, 120_000);

  it("writes each export of chosen parts whole, and shows one shape under two names", async () => {
    const result = await build({
      code: [
        "from build123d import *",
        "b = Box(10, 10, 10)",
        'show(b, name="Bracket")',
        'show(Pos(30, 0, 0) * Box(5, 5, 5), name="Pin")',
        'show(b, name="Spare")',
      ].join("\n"),
      exports: [
        { path: "asm/all.glb" },
        { path: "asm/bracket.glb", parts: ["Bracket"] },
        { path: "asm/bracket.step", parts: ["Bracket", "Spare"] },
      ],
    });

    expect(result.isError).toBeUndefined();
    const glb = await readFile(join(root, "asm", "bracket.glb"));
    const json = JSON.parse(
      glb.subarray(20, 20 + glb.readUInt32LE(12)).toString("utf8"),
    ) as { meshes?: unknown[] };
    expect(json.meshes?.length).toBeGreaterThan(0);
    expect(await readFile(join(root, "asm", "bracket.step"), "latin1")).toMatch(
      /^ISO-10303-21;/,
    );
  }, 120_000);

  it("says a size as it is, rounded once", async () => {
    const result = await build({
      code: "from build123d import *\nshow(Box(10.00049, 20.0005, 4), name='Block')",
    });

    expect(text(result)).toContain(
      "Block: a valid solid, 10 × 20.001 × 4 mm, from (-5, -10, -2) to (5, 10, 2).",
    );
  }, 120_000);

  it("measures a part of overlapping solids by the material they make, and refuses loose faces in a part", async () => {
    const overlapping = await build({
      code: "from build123d import *\nshow(Compound([Box(10, 10, 10), Pos(5, 0, 0) * Box(10, 10, 10)]), name='Pair')",
    });
    const loose = await build({
      code: "from build123d import *\nshow(Compound([Box(10, 10, 10), Pos(0, 0, 20) * Rectangle(50, 50)]), name='Odd')",
    });

    expect(text(overlapping)).toContain("2 separate solids");
    expect(text(overlapping)).toContain("Volume 1,500 mm³");
    expect(loose.isError).toBe(true);
    expect(text(loose)).toContain("a face that belongs to no solid");
  }, 120_000);

  it("finds a hole whose wall is halves from two surfaces, and one a larger hole crosses", async () => {
    const result = await build({
      code: [
        "from build123d import *",
        "from OCP.BRepAlgoAPI import BRepAlgoAPI_Fuse",
        "import build123d as bd",
        "whole = Box(20, 20, 10) - Cylinder(3, 10)",
        "top = whole.split(Plane.XZ, keep=Keep.TOP)",
        // Halves joined without merging their faces, as another program's STEP holds them.
        "def joined(a, b):",
        "    fuse = BRepAlgoAPI_Fuse(a.wrapped, b.wrapped)",
        "    fuse.Build()",
        "    return bd.Shape.cast(fuse.Shape()).solids()[0]",
        "show(joined(top, Rot(0, 0, 180) * top), name='Turned')",
        "show(Pos(100, 0, 0) * joined(top, top.mirror(Plane.XZ)), name='Mirrored')",
        "show(Pos(200, 0, 0) * (Box(30, 30, 30) - Cylinder(2, 30) - Rot(0, 90, 0) * Cylinder(6, 30)), name='Crossed')",
      ].join("\n"),
    });

    const lineOf = (name: string) =>
      text(result)
        .split("\n")
        .find((line) => line.startsWith(`${name}:`)) ?? "";
    expect(result.isError, text(result)).toBeUndefined();
    // The two joined the same way are one solid alike, said in one line.
    expect(lineOf("Turned and Mirrored, each")).toContain(
      "Round holes: 1 of 6 mm.",
    );
    expect(lineOf("Crossed")).toContain("Round holes: 1 of 4 mm, 1 of 12 mm.");
  }, 120_000);

  it("measures every side of overlapping solids by the material they make, however many", async () => {
    const result = await build({
      code: [
        "from build123d import *",
        "show(Compound([Box(20, 20, 20), Pos(5, 0, 0) * Box(10, 10, 10)]), name='Inner')",
        "plate = Pos(100, 0, 0) * (Box(40, 40, 10) - Cylinder(4, 10))",
        "show(Compound([plate, Pos(100, 0, 0) * Cylinder(5, 30)]), name='Pinned')",
        "show(Pos(200, 0, 0) * Compound([Pos(i * 0.1, 0, 0) * Sphere(5) for i in range(65)]), name='Beads')",
      ].join("\n"),
    });

    const lineOf = (name: string) =>
      text(result)
        .split("\n")
        .find((line) => line.startsWith(`${name}:`)) ?? "";
    expect(result.isError, text(result)).toBeUndefined();
    expect(lineOf("Inner")).toContain(
      "Volume 8,000 mm³ (8 cm³), surface 2,400 mm², centre of mass at (0, 0, 0). 6 faces: 6 flat.",
    );
    // A pin larger than the hole fills it: the material has no hole.
    expect(lineOf("Pinned")).toContain("that share");
    expect(lineOf("Pinned")).not.toContain("Round holes");
    expect(lineOf("Beads")).toContain(
      "65 separate solids, each valid, that share",
    );
    const volume = Number(
      /Volume ([\d,]+) mm³/.exec(lineOf("Beads"))?.[1]?.replaceAll(",", ""),
    );
    // The union of the spheres: one sphere stretched by 6.4 mm along x.
    expect(volume).toBeGreaterThan(1000);
    expect(volume).toBeLessThan(1050);
  }, 180_000);

  it("refuses a loose face beside solids that share a face", async () => {
    const result = await build({
      code: [
        "from build123d import *",
        "from OCP.BRepAlgoAPI import BRepAlgoAPI_BuilderAlgo",
        "from OCP.OCP.collections import List_TopoDS_Shape",
        "import build123d as bd",
        "shapes = List_TopoDS_Shape()",
        "for box in (Box(10, 10, 10), Pos(10, 0, 0) * Box(10, 10, 10)):",
        "    shapes.Append(box.wrapped)",
        "builder = BRepAlgoAPI_BuilderAlgo()",
        "builder.SetArguments(shapes)",
        "builder.Build()",
        "touching = bd.Shape.cast(builder.Shape())",
        "show(Compound([*touching.solids(), Pos(0, 0, 50) * Face.make_rect(30, 30)]), name='Odd')",
      ].join("\n"),
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("a face that belongs to no solid");
  }, 120_000);

  it("leaves no container in the person's profile once a build ends", async () => {
    const packages = join(process.env["LOCALAPPDATA"]!, "Packages");
    const containers = async () =>
      (await readdir(packages)).filter((name) =>
        name.toLowerCase().startsWith("zhiyin.python-cad-test."),
      );
    const before = await containers();

    await build({
      code: "from build123d import *\nshow(Box(1, 1, 1), name='Cube')",
    });

    expect(await containers()).toEqual(before);
  }, 120_000);

  const bracket = [
    "from build123d import *",
    "with BuildPart() as bracket:",
    "    Box(80, 50, 10)",
    "    with Locations((-25, -12, 0), (25, -12, 0)):",
    "        Hole(radius=3)",
    "    with Locations((0, 10, 5)):",
    "        CounterBoreHole(radius=4, counter_bore_radius=7, counter_bore_depth=4)",
    "    with Locations((0, 22.5, 20)):",
    "        Box(80, 5, 30)",
    "    fillet(bracket.edges().filter_by(Axis.Z).group_by(Axis.Y)[0], radius=5)",
    'show(bracket.part, name="Bracket")',
  ].join("\n");

  it("draws a sheet of a part, dimensioned from its geometry, and writes it in every kind asked for", async () => {
    const result = await draw({
      code: bracket,
      views: [
        { view: "front" },
        { view: "top" },
        { view: "right" },
        { view: "iso" },
        { section: "A", looking: "front", through: [0, 10, 0] },
        { detail: "B", of: "top", at: [0, 10, 5], radius: 10, scale: 2 },
      ],
      dimensions: [
        {
          view: "top",
          kind: "length",
          from: [-40, 25, 5],
          to: [40, 25, 5],
          expect: 80,
        },
        {
          view: "top",
          kind: "diameter",
          at: [-25, -12, 5],
          all: true,
          tolerance: "H7",
        },
        { view: "front", kind: "length", from: [40, 25, -5], to: [40, 25, 35] },
        { view: "top", kind: "radius", at: [-38, -23, 5] },
      ],
      title: { title: "Shelf bracket", number: "ZY-0001", material: "PLA" },
      outputs: [
        { path: "drawings/bracket.pdf" },
        { path: "drawings/bracket.svg" },
        { path: "drawings/bracket.dxf" },
        { path: "drawings/bracket.png" },
        { path: "drawings/profile.dxf", view: "top" },
      ],
    });

    expect(result.isError, text(result)).toBeUndefined();
    expect(text(result)).toMatch(
      /^Drew A3 landscape at 1:1, first-angle projection, in [\d.]+ s: front view, top view, right view, iso view, section A and detail B at 2:1\./,
    );
    expect(text(result)).toContain("Dimensions on top: 80, 2× Ø6 H7, R5.");
    expect(text(result)).toContain("Dimensions on front: 40.");
    expect(result.content[1]).toMatchObject({
      type: "image",
      mimeType: "image/png",
    });
    // Drawn at the most a model is shown, so no line of it is resampled.
    const shown = Buffer.from(
      (result.content[1] as { data: string }).data,
      "base64",
    );
    expect(Math.max(shown.readUInt32BE(16), shown.readUInt32BE(20))).toBe(2000);
    const folder = join(root, "drawings");
    expect((await readdir(folder)).sort()).toEqual([
      "bracket.dxf",
      "bracket.pdf",
      "bracket.png",
      "bracket.svg",
      "profile.dxf",
    ]);
    expect(await readFile(join(folder, "bracket.pdf"), "latin1")).toMatch(
      /^%PDF-1\.4/,
    );
    expect(await readFile(join(folder, "bracket.svg"), "utf8")).toContain(
      "<svg",
    );
    expect(
      (await readFile(join(folder, "bracket.png"))).subarray(1, 4).toString(),
    ).toBe("PNG");
    // The profile is the top view alone, at full size: its holes are drawn as circles.
    const profile = await readFile(join(folder, "profile.dxf"), "utf8");
    expect(profile).toMatch(/\nCIRCLE\r?\n/);
    expect(profile).not.toContain("ZY-0001");
  }, 180_000);

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

  it("refuses a drawing whose detail's view was not drawn for no reason said, naming it, rather than dropping it", async () => {
    // Zhiyin refuses details of each other before anyone is asked; the
    // harness, handed them all the same, names what it could not draw.
    const folder = await folders.make("zhiyin-real-cad-cycle-");
    const out = join(folder, "out");
    await mkdir(out);
    const script = join(folder, "script.py");
    await writeFile(
      script,
      'from build123d import *\nshow(Box(40, 20, 10), name="Block")\n',
    );
    // The script's run first, which hands on the parts it built.
    const made = join(folder, "made");
    await mkdir(made);
    const built = join(folder, "script.json");
    await writeFile(
      built,
      JSON.stringify({
        phase: "script",
        script,
        file: null,
        name: null,
        arguments: [],
        output: made,
        seconds: 120,
      }),
    );
    const python = await confinedPython();
    const first = await python.run({
      arguments: ["-P", "-B", harness, built],
      cwd: folder,
      read: [dirname(harness), folder],
      write: [made],
      home: await folders.make("zhiyin-real-cad-cycle-home-"),
      timeoutMs: 120_000,
    });
    expect(first, JSON.stringify(first)).toMatchObject({
      ok: true,
      run: { exitCode: 0 },
    });
    const request = join(folder, "request.json");
    await writeFile(
      request,
      JSON.stringify({
        parts: join(made, "manifest.json"),
        output: out,
        seconds: 120,
        exports: [],
        picture: null,
        drawing: {
          views: [
            { view: "front" },
            { detail: "A", of: "B", at: [0, 0, 0], radius: 5 },
            { detail: "B", of: "A", at: [0, 0, 0], radius: 5 },
          ],
          dimensions: [{ view: "A", kind: "overall", direction: "horizontal" }],
          outputs: [{ file: "export-0.pdf", name: "cycle.pdf", kind: "pdf" }],
          picture: "picture.png",
        },
      }),
    );

    const ran = await python.run({
      arguments: ["-I", "-X", "utf8", harness, request],
      cwd: folder,
      read: [dirname(harness), folder],
      write: [out],
      home: await folders.make("zhiyin-real-cad-cycle-measuring-home-"),
      timeoutMs: 120_000,
    });
    expect(ran, JSON.stringify(ran)).toMatchObject({
      ok: true,
      run: { exitCode: 2 },
    });
    const answer = JSON.parse(
      await readFile(join(out, "answer.json"), "utf8"),
    ) as { failed?: string };
    expect(answer.failed).toBe(
      "The drawing could not be made as asked:\n- detail A is of the B view, which was not drawn before it",
    );
    await expect(stat(join(out, "export-0.pdf"))).rejects.toThrow();
  }, 120_000);

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

  it("takes a part name written as a pattern in exports, sections and drawings, and says what each named", async () => {
    const pins = [
      "from build123d import *",
      'show(Box(60, 20, 10), name="Block")',
      "for k in range(3):",
      '    show(Pos(-20 + 20 * k, 0, 0) * Cylinder(3, 30), name=f"Pin_{k + 1}")',
    ].join("\n");
    const built = await build({
      code: pins,
      exports: [{ path: "patterns/pins.step", parts: ["/Pin_.*/"] }],
      sections: [
        {
          through: [0, 0, 0],
          looking: "front",
          parts: ["/Pin_[12]/", "Block"],
        },
      ],
    });
    const drawn = await draw({
      code: pins,
      parts: ["Block", "/Pin_[23]/"],
      views: [
        { view: "top" },
        {
          section: "A",
          looking: "front",
          through: [0, 0, 0],
          uncut: ["/Pin_.*/"],
        },
      ],
      outputs: [{ path: "patterns/pins.pdf" }],
    });
    const missed = await build({
      code: pins,
      exports: [{ path: "patterns/none.step", parts: ["/Bolt_.*/"] }],
    });

    expect(built.isError, text(built)).toBeUndefined();
    expect(text(built)).toMatch(
      /^\/Pin_\.\*\/ named 3 parts: Pin_1, Pin_2, Pin_3\.\n\/Pin_\[12\]\/ named 2 parts: Pin_1, Pin_2\.\n/,
    );
    expect(text(built)).toContain("Wrote patterns/pins.step (");
    expect(text(built)).toContain("Below them, the section asked for");
    expect(drawn.isError, text(drawn)).toBeUndefined();
    expect(text(drawn)).toMatch(
      /^\/Pin_\[23\]\/ named 2 parts: Pin_2, Pin_3\.\n\/Pin_\.\*\/ named 2 parts: Pin_2, Pin_3\.\n/,
    );
    expect(missed.isError).toBe(true);
    expect(text(missed)).toContain(
      "exports[0].parts gives /Bolt_.*/, which matches no part's whole name; the parts are Block, Pin_1, Pin_2, Pin_3",
    );
  }, 180_000);

  it("refuses a part show() cannot take, naming which part it is and the line that showed it", async () => {
    const result = await build({
      code: [
        "from build123d import *",
        'show(Box(10, 10, 10), name="Base")',
        'show([Box(5, 5, 5), Rectangle(4, 4)], name="Valve")',
      ].join("\n"),
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain(
      "At line 3 of the script, part 2 of the 2 shown as “Valve”: show() takes 3D parts, and this Rectangle has no solid. Extrude or revolve it first.",
    );
  }, 120_000);

  it("skips a cut that would break the part it cuts, saying where it is, what it cut and why", async () => {
    const result = await build({
      code: [
        "from build123d import *",
        "plate = Box(100, 60, 10)",
        "plate -= Cylinder(5, 20)",
        // A cutter turned inside out, which takes away all but itself.
        "plate -= Solid((Pos(30, 0, 0) * Cylinder(5, 20)).wrapped.Reversed())",
        "plate -= Box(200, 200, 200)",
        'show(plate, name="Plate")',
      ].join("\n"),
    });
    // A cutter whose faces cross: the cut leaves a broken solid, which a
    // second run, each cut checked, finds and skips.
    const crossed = await build({
      code: [
        "from build123d import *",
        "block = Box(20, 20, 4)",
        "bowtie = extrude(Polygon((0, 0), (10, 10), (10, 0), (0, 10), align=None), 5)",
        "block -= bowtie",
        'show(block, name="Block")',
      ].join("\n"),
    });

    expect(crossed.isError, text(crossed)).toBeUndefined();
    expect(text(crossed)).toContain(
      "- At line 4 of the script: a cut of the part 20 × 20 × 4 mm about (0, 0, 0), its cutter 10 × 10 × 5 mm about (5, 5, -2.5): it would leave no valid solid, so the part was kept as it was before it.",
    );
    expect(text(crossed)).toContain("Block: a valid solid, 20 × 20 × 4 mm");
    expect(result.isError, text(result)).toBeUndefined();
    expect(text(result)).toContain(
      [
        "Cuts skipped, as each would break the part it cuts; change each in the script:",
        "- At line 4 of the script: a cut of the part 100 × 60 × 10 mm about (0, 0, 0), its cutter 10 × 10 × 20 mm about (30, 0, 0): its cutter is turned inside out, so it would take away all of the part but where the cutter is, so the part was kept as it was before it. Its cutter lies where Plate is shown.",
        "- At line 5 of the script: a cut of the part 100 × 60 × 10 mm about (0, 0, 0), its cutter 200 × 200 × 200 mm about (0, 0, 0): it would leave nothing of the part, so the part was kept as it was before it. Its cutter lies where Plate is shown.",
      ].join("\n"),
    );
    // The hole alone is cut.
    expect(text(result)).toContain("Volume 59,215 mm³");
  }, 120_000);

  it("leaves out of a section a part whose cut the kernel gives back broken, and says so", async () => {
    // A tube swept round a bend tighter than its own radius folds through
    // itself: the kernel's check passes it, yet a cut through it is no
    // valid solid.
    const result = await draw({
      code: [
        "from build123d import *",
        "path = FilletPolyline((0, 0, 0), (40, 0, 30), (80, 0, 30), radius=12).wire()",
        'show(sweep(Plane(origin=(0, 0, 0), z_dir=path.tangent_at(0)) * Circle(16), path=path), name="Elbow")',
        'show(Pos(40, 0, -40) * Box(100, 40, 10), name="Base")',
      ].join("\n"),
      views: [
        { view: "front" },
        { view: "top" },
        { section: "A", looking: "front", through: [0, 0, 0] },
      ],
      outputs: [{ path: "drawings/elbow.pdf" }],
    });

    expect(result.isError, text(result)).toBeUndefined();
    expect(text(result)).toMatch(/front view, top view(,| and) section A/);
    expect(text(result)).toContain(
      "Section A leaves out Elbow: the kernel's cut of it along its plane is not a valid solid, as a cut through a part that folds through itself or whose faces cross comes back. Name it in uncut to draw it whole, or check how it was made.",
    );
  }, 120_000);

  it("dimensions a view's whole width and height, and a circle by its size, with no points given", async () => {
    const result = await draw({
      code: bracket,
      views: [{ view: "front" }, { view: "top" }],
      dimensions: [
        { view: "top", kind: "overall", direction: "horizontal" },
        { view: "top", kind: "diameter", expect: 6, all: true },
        { view: "top", kind: "diameter", expect: 14 },
        { view: "front", kind: "overall", direction: "vertical" },
      ],
      outputs: [{ path: "drawings/overall.pdf" }],
    });
    expect(result.isError, text(result)).toBeUndefined();
    expect(text(result)).toContain("Dimensions on top: 80, 2× Ø6, Ø14.");
    expect(text(result)).toContain("Dimensions on front: 40.");

    const missing = await draw({
      code: bracket,
      views: [{ view: "top" }],
      dimensions: [{ view: "top", kind: "diameter", expect: 9 }],
      outputs: [{ path: "drawings/missing.pdf" }],
    });
    expect(missing.isError).toBe(true);
    expect(text(missing)).toContain(
      "the top view shows no circle of Ø9 for dimension 1; it shows Ø6, Ø8, Ø14",
    );
  }, 180_000);

  it("dimensions a curved part's whole width and height where its curves reach, not at their ends or centres", async () => {
    // An arched block 100 wide, 30 high at its ends and 40 at its crown: its
    // arch's centre lies 90 below the base. A spring coiled at a radius of 15
    // from wire 2 thick is 32 across.
    const arched = await draw({
      code: [
        "from build123d import *",
        "with BuildSketch() as side:",
        "    with BuildLine():",
        "        Polyline((50, 30), (50, 0), (-50, 0), (-50, 30))",
        "        ThreePointArc((-50, 30), (0, 40), (50, 30))",
        "    make_face()",
        'show(extrude(side.sketch, 20), name="Arch")',
      ].join("\n"),
      views: [{ view: "top" }],
      dimensions: [
        { view: "top", kind: "overall", direction: "horizontal" },
        { view: "top", kind: "overall", direction: "vertical" },
      ],
      outputs: [{ path: "drawings/arch.pdf" }],
    });
    const spring = await draw({
      code: [
        "from build123d import *",
        "path = Helix(5, 30, 15)",
        "wire = sweep(Plane(origin=path @ 0, z_dir=path % 0) * Circle(1), path=path)",
        'show(wire, name="Spring")',
      ].join("\n"),
      views: [{ view: "front" }],
      dimensions: [{ view: "front", kind: "overall", direction: "horizontal" }],
      outputs: [{ path: "drawings/spring.pdf" }],
    });

    expect(arched.isError, text(arched)).toBeUndefined();
    expect(text(arched)).toContain("Dimensions on top: 100, 40.");
    expect(spring.isError, text(spring)).toBeUndefined();
    expect(text(spring)).toContain("Dimensions on front: 32.");
  }, 180_000);

  it("draws the iso view at most two standard scales below the sheet, stepping the sheet down rather than shrinking it to a speck", async () => {
    // A rocker arm's size: on A4 its front and top views fit at 2:1 only if
    // the iso view beside them is next to nothing.
    const result = await draw({
      code: [
        "from build123d import *",
        "arm = Box(98.85, 15, 26) - Rot(90, 0, 0) * Cylinder(8.3, 20)",
        'show(arm, name="Rocker")',
      ].join("\n"),
      sheet: "A4",
      views: [{ view: "front" }, { view: "top" }, { view: "iso" }],
      dimensions: [
        { view: "front", kind: "overall", direction: "horizontal" },
        { view: "front", kind: "overall", direction: "vertical" },
        { view: "front", kind: "diameter", expect: 16.6, tolerance: "H7" },
        { view: "top", kind: "overall", direction: "vertical" },
      ],
      outputs: [{ path: "drawings/rocker.pdf" }],
    });

    expect(result.isError, text(result)).toBeUndefined();
    const standard = [
      "5:1",
      "2:1",
      "1:1",
      "1:2",
      "1:5",
      "1:10",
      "1:20",
      "1:50",
      "1:100",
      "1:200",
      "1:500",
      "1:1000",
    ];
    const sheet = /Drew A4 landscape at (\S+),/.exec(text(result))?.[1];
    const iso = /iso view at (\d+:\d+)/.exec(text(result))?.[1] ?? sheet;
    expect(standard).toContain(sheet);
    expect(standard).toContain(iso);
    expect(
      standard.indexOf(iso!) - standard.indexOf(sheet!),
    ).toBeLessThanOrEqual(2);
  }, 180_000);

  it("draws a hidden or centre line too short to dash as solid, never with a dash of no length", async () => {
    // A sliver of an edge, as booleans leave, and a short line that still
    // has room for a visible dash.
    const folder = await folders.make("zhiyin-real-cad-dashes-");
    const script = join(folder, "dashes.py");
    await writeFile(
      script,
      [
        "import sys",
        "sys.path.insert(0, sys.argv[1])",
        "from zhiyin_cad.drafting.sheet import Sheet",
        "from zhiyin_cad.drafting import writers",
        "sheet = Sheet('A4')",
        "sheet.line('hidden', [(100, 100), (100.0001, 100), (100.0001, 100.0001)])",
        "sheet.line('centre', [(150, 100), (150.0002, 100)])",
        "sheet.line('hidden', [(50, 50), (52, 50)])",
        "writers.pdf(sheet, sys.argv[2] + '.pdf')",
        "writers.svg(sheet, sys.argv[2] + '.svg')",
        "writers.png(sheet, sys.argv[2] + '.png')",
      ].join("\n"),
    );
    const out = join(folder, "sheet");

    const ran = await (
      await confinedPython()
    ).run({
      arguments: ["-I", script, dirname(harness), out],
      cwd: folder,
      read: [dirname(harness)],
      write: [folder],
      home: await folders.make("zhiyin-real-cad-dashes-home-"),
      timeoutMs: 60_000,
    });
    expect(ran, JSON.stringify(ran)).toMatchObject({
      ok: true,
      run: { exitCode: 0 },
    });

    const pdf = zlibInflated(await readFile(`${out}.pdf`));
    const pdfDashes = [...pdf.matchAll(/\[([^\]]*)\] 0 d/g)].map((m) =>
      m[1]!.split(" ").filter(Boolean).map(Number),
    );
    expect(pdfDashes.filter((dash) => dash.some((d) => d <= 0))).toEqual([]);
    // The two slivers are drawn solid; the short line keeps a dash a reader
    // can see.
    expect(pdfDashes.map((dash) => dash.length > 0)).toEqual([
      false,
      false,
      true,
    ]);
    const svgDashes = [
      ...(await readFile(`${out}.svg`, "utf8")).matchAll(
        /stroke-dasharray="([^"]*)"/g,
      ),
    ].map((m) => m[1]!);
    expect(
      svgDashes.filter((dash) => dash.split(" ").some((d) => Number(d) <= 0)),
    ).toEqual([]);
    expect(svgDashes.filter((dash) => dash === "none")).toHaveLength(2);
    expect((await readFile(`${out}.png`)).subarray(1, 4).toString()).toBe(
      "PNG",
    );
  }, 120_000);

  it("refuses a drawing whose part differs from a size it was given, or names geometry it lacks", async () => {
    const differs = await draw({
      code: bracket,
      dimensions: [
        {
          view: "top",
          kind: "length",
          from: [-40, 25, 5],
          to: [40, 25, 5],
          expect: 75,
        },
        { view: "top", kind: "diameter", at: [0, -200, 5] },
      ],
      outputs: [{ path: "refused/bracket.pdf" }],
    });

    expect(differs.isError).toBe(true);
    expect(text(differs)).toContain("The drawing could not be made as asked:");
    expect(text(differs)).toContain(
      "dimension 1 is 80 on the part, where 75 was expected",
    );
    expect(text(differs)).toMatch(/dimension 2/);
    expect(await readdir(root)).not.toContain("refused");

    const misplaced = await draw({
      code: bracket,
      views: [
        { view: "front" },
        { view: "top" },
        { view: "iso" },
        { section: "A", looking: "front", through: [0, -60, 0] },
        { detail: "C", of: "iso", at: [0, 0, 0], radius: 10 },
        { detail: "D", of: "front", at: [300, 0, 300], radius: 5 },
      ],
      dimensions: [
        { view: "C", kind: "length", from: [-40, 25, 5], to: [40, 25, 5] },
        // The counterbore's two circles share a centre.
        { view: "top", kind: "diameter", at: [0, 10, 5] },
      ],
      outputs: [{ path: "refused/bracket.pdf" }],
    });
    expect(misplaced.isError).toBe(true);
    expect(text(misplaced)).toContain(
      "detail D's circle round (300, 0, 300) holds nothing of the front view; put it on the part",
    );
    expect(text(misplaced)).toContain(
      "(0, 10, 5) is the centre of circles Ø8, Ø14 in the top view, for dimension 2; give a point on the one meant: (4, 10, 5) for Ø8, (7, 10, 5) for Ø14",
    );
    expect(text(misplaced)).toContain(
      "section A's plane through (0, -60, 0) cuts no part: it lies beside them; put it through the part",
    );
    expect(text(misplaced)).toContain(
      "dimension 1 is on detail C, of the angled view, where lengths are foreshortened; dimension a straight view",
    );

    const tooLarge = await draw({
      code: bracket,
      sheet: "A4",
      scale: "5:1",
      outputs: [{ path: "refused/bracket.pdf" }],
    });
    expect(tooLarge.isError).toBe(true);
    expect(text(tooLarge)).toContain(
      "the views do not fit on A4 at 5:1; choose a smaller scale or a larger sheet",
    );
  }, 120_000);

  it("checks an expected size to the decimals it is written with", async () => {
    const plate =
      'from build123d import *\nshow(Box(80.04, 30, 5), name="Plate")';
    const across = (expect: number) => ({
      code: plate,
      views: [{ view: "top" }],
      dimensions: [
        {
          view: "top",
          kind: "length",
          from: [-40.02, 15, 2.5],
          to: [40.02, 15, 2.5],
          expect,
        },
      ],
      outputs: [{ path: "expected/plate.pdf" }],
    });

    const whole = await draw(across(80));
    const exact = await draw(across(80.04));
    const tenth = await draw(across(80.1));

    expect(whole.isError).toBeUndefined();
    expect(exact.isError).toBeUndefined();
    expect(text(exact)).toContain("Dimensions on top: 80.04.");
    expect(tenth.isError).toBe(true);
    expect(text(tenth)).toContain(
      "dimension 1 is 80.04 on the part, where 80.1 was expected",
    );
  }, 120_000);

  it("names the nearest corners to a point that misses, and says where an end was found away from the point given", async () => {
    const missed = await draw({
      code: bracket,
      views: [{ view: "top" }],
      dimensions: [
        { view: "top", kind: "length", from: [38, 23, 5], to: [-40, 25, 5] },
      ],
      outputs: [{ path: "refused/bracket.pdf" }],
    });
    const found = await draw({
      code: bracket,
      views: [{ view: "top" }],
      dimensions: [
        { view: "top", kind: "length", from: [-39.8, 25, 5], to: [40, 25, 5] },
      ],
      outputs: [{ path: "snapped/bracket.pdf" }],
    });

    expect(missed.isError).toBe(true);
    expect(text(missed)).toContain(
      "no corner, end or circle centre of the top view lies within 1 mm of (38, 23, 5), its start for dimension 1; the nearest are (40, 25, 5), 2.83 mm away and (40, 20, 5), 3.61 mm away",
    );
    expect(found.isError, text(found)).toBeUndefined();
    expect(text(found)).toContain("Dimensions on top: 80.");
    expect(text(found)).toContain(
      "Measured from the nearest corner, end or centre, away from the point given: 80 on top, its start at (-40, 25, 5), 0.2 mm from the point given.",
    );
  }, 120_000);

  /**
   * Reads drawn sheets back from the workspace, as a build script, and says
   * per sheet how many line pieces cross its lettering and how many points
   * lie outside its frame.
   */
  const sheetCheck = [
    "import sys",
    "import ezdxf",
    "from build123d import Box",
    "",
    "def pieces(entity):",
    "    kind = entity.dxftype()",
    "    if kind == 'LWPOLYLINE':",
    "        points = [(p[0], p[1]) for p in entity.get_points()]",
    "        if entity.closed:",
    "            points.append(points[0])",
    "    elif kind in ('ARC', 'CIRCLE'):",
    "        points = [(p.x, p.y) for p in entity.flattening(0.05)]",
    "    else:",
    "        return []",
    "    return list(zip(points, points[1:]))",
    "",
    "def side(p, q, r):",
    "    return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])",
    "",
    "def crosses(a, b, c, d):",
    "    d1, d2, d3, d4 = side(c, d, a), side(c, d, b), side(a, b, c), side(a, b, d)",
    "    return d1 * d2 < -1e-12 and d3 * d4 < -1e-12",
    "",
    "for path in sys.argv[1:]:",
    "    space = ezdxf.readfile(path).modelspace()",
    "    lettering, others, everything, frame = [], [], [], None",
    "    for entity in space:",
    "        layer = entity.dxf.layer",
    "        if layer == 'FRAME' and entity.dxftype() == 'LWPOLYLINE' and entity.closed:",
    "            frame = entity",
    "        for piece in pieces(entity):",
    "            (lettering if layer == 'TEXT' else others).append(piece)",
    "            everything += piece",
    "    xs = [p[0] for p in frame.get_points()]",
    "    ys = [p[1] for p in frame.get_points()]",
    "    outside = sum(1 for x, y in everything if not (min(xs) - 1e-6 <= x <= max(xs) + 1e-6 and min(ys) - 1e-6 <= y <= max(ys) + 1e-6))",
    "    grid = {}",
    "    for a, b in others:",
    "        for gx in range(int(min(a[0], b[0]) // 5), int(max(a[0], b[0]) // 5) + 1):",
    "            for gy in range(int(min(a[1], b[1]) // 5), int(max(a[1], b[1]) // 5) + 1):",
    "                grid.setdefault((gx, gy), []).append((a, b))",
    "    crossed = 0",
    "    for a, b in lettering:",
    "        near = {id(o): o for gx in range(int(min(a[0], b[0]) // 5), int(max(a[0], b[0]) // 5) + 1) for gy in range(int(min(a[1], b[1]) // 5), int(max(a[1], b[1]) // 5) + 1) for o in grid.get((gx, gy), [])}",
    "        crossed += any(crosses(a, b, c, d) for c, d in near.values())",
    "    # A thin line, a leader or a dimension's, that runs across a hole it neither starts in nor ends on.",
    "    holes = [(c.dxf.center.x, c.dxf.center.y, c.dxf.radius) for c in space.query('CIRCLE[layer==\"VISIBLE\"]')]",
    "    thin = [piece for e in space.query('LWPOLYLINE[layer==\"THIN\"]') for piece in pieces(e)]",
    "    def across(a, b, x, y, r):",
    "        dx, dy = b[0] - a[0], b[1] - a[1]",
    "        t = max(0.0, min(1.0, ((x - a[0]) * dx + (y - a[1]) * dy) / ((dx * dx + dy * dy) or 1e-18)))",
    "        near = ((a[0] + t * dx - x) ** 2 + (a[1] + t * dy - y) ** 2) ** 0.5",
    "        ends = [((p[0] - x) ** 2 + (p[1] - y) ** 2) ** 0.5 for p in (a, b)]",
    "        return near < r - 0.05 and min(ends) > r + 0.05",
    "    through = sum(1 for a, b in thin if any(across(a, b, *hole) for hole in holes))",
    "    print(f'{path}: lettering crossed {crossed}, outside the frame {outside}, holes crossed {through}')",
    "show(Box(1, 1, 1), name='Check')",
  ].join("\n");

  const plate = [
    "from build123d import *",
    "with BuildPart() as p:",
    "    Box(120, 80, 10, align=(Align.MIN, Align.MIN, Align.MIN))",
    "    for (x, y, r) in [(15, 15, 2), (105, 15, 2.5), (15, 65, 3), (105, 65, 3.5), (60, 40, 12), (40, 20, 1.5), (80, 60, 4.5), (90, 30, 5.5)]:",
    "        with Locations((x, y, 10)):",
    "            Hole(radius=r)",
    'show(p.part, name="Plate")',
  ].join("\n");

  it("keeps every line off the lettering and inside the frame, however crowded the sheet", async () => {
    const holes: [number, number][] = [
      [15, 15],
      [105, 15],
      [15, 65],
      [105, 65],
      [60, 40],
      [40, 20],
      [80, 60],
      [90, 30],
    ];
    const crowded = await draw({
      code: plate,
      views: ["front", "top", "right"].map((view) => ({ view })),
      dimensions: [
        ...holes.map(([x, y]) => ({
          view: "top",
          kind: "diameter",
          at: [x, y, 10],
        })),
        { view: "top", kind: "length", from: [0, 0, 10], to: [120, 0, 10] },
        {
          view: "top",
          kind: "length",
          from: [0, 0, 10],
          to: [15, 15, 10],
          direction: "horizontal",
        },
        {
          view: "top",
          kind: "length",
          from: [0, 0, 10],
          to: [40, 20, 10],
          direction: "horizontal",
        },
        { view: "top", kind: "length", from: [0, 0, 10], to: [0, 80, 10] },
        {
          view: "top",
          kind: "length",
          from: [0, 0, 10],
          to: [15, 15, 10],
          direction: "vertical",
        },
        {
          view: "top",
          kind: "length",
          from: [120, 80, 10],
          to: [105, 65, 10],
          direction: "horizontal",
        },
        { view: "front", kind: "length", from: [0, 0, 0], to: [0, 0, 10] },
      ],
      outputs: [{ path: "crowded/plate.dxf" }],
    });
    const marked = await draw({
      code: bracket,
      views: [
        { view: "front" },
        { view: "top" },
        { section: "A", looking: "front", through: [0, -12, 0] },
        { auxiliary: "B", direction: [0.5, 0, -0.866] },
        { detail: "C", of: "front", at: [40, 0, 0], radius: 8, scale: 4 },
      ],
      dimensions: [
        { view: "top", kind: "length", from: [-40, 25, 5], to: [40, 25, 5] },
        { view: "top", kind: "length", from: [-40, -20, 5], to: [-40, 25, 5] },
        { view: "top", kind: "diameter", at: [-25, -12, 5], all: true },
        { view: "top", kind: "radius", at: [-38, -23, 5] },
        { view: "A", kind: "length", from: [-40, -12, -5], to: [40, -12, -5] },
      ],
      outputs: [{ path: "crowded/bracket.dxf" }],
    });
    const titled = await draw({
      code: bracket,
      sheet: "A4",
      orientation: "portrait",
      title: {
        title:
          "Mounting bracket for the left-hand conveyor drive, revision with fillet",
        number: "ZH-2026-000123-BRK-LEFT-CONVEYOR-DRIVE-MOUNT",
        material: "Aluminium alloy EN AW-6082-T6 anodised clear 15 µm",
        author: "Bastien Hottelet, mechanical design office",
        company: "Zhiyin Precision Components Manufacturing Ltd",
        revision: "C.2 — after customer review",
        date: "24 October 2026",
      },
      outputs: [{ path: "crowded/titled.dxf" }],
    });
    // A view at the sheet's top edge, seen down at an angle from above it.
    const aimed = await draw({
      code: [
        "from build123d import *",
        "block = Box(60, 40, 30, align=(Align.CENTER, Align.CENTER, Align.MIN))",
        "ramp = Solid.make_box(60, 40, 10).moved(Location((-30, -20, 30)))",
        "ramp = ramp - Pos(0, 0, 40) * Rot(0, 30, 0) * Box(100, 100, 10, align=(Align.CENTER, Align.CENTER, Align.MIN))",
        "show(block + ramp, name='Block')",
      ].join("\n"),
      views: [
        { view: "front" },
        { view: "top" },
        { auxiliary: "B", direction: [0.5, 0, -0.866] },
      ],
      outputs: [{ path: "crowded/aimed.dxf" }],
    });
    for (const result of [crowded, marked, titled, aimed]) {
      expect(result.isError, text(result)).toBeUndefined();
      expect(text(result)).not.toContain("Drawn where it meets");
      expect(text(result)).not.toContain("Drawn past the frame");
    }

    const checked = await build({
      code: sheetCheck,
      arguments: [
        "crowded/plate.dxf",
        "crowded/bracket.dxf",
        "crowded/titled.dxf",
        "crowded/aimed.dxf",
      ],
    });

    expect(text(checked)).toContain(
      "crowded/aimed.dxf: lettering crossed 0, outside the frame 0, holes crossed 0",
    );
    expect(text(checked)).toContain(
      "crowded/plate.dxf: lettering crossed 0, outside the frame 0, holes crossed 0",
    );
    expect(text(checked)).toContain(
      "crowded/bracket.dxf: lettering crossed 0, outside the frame 0, holes crossed 0",
    );
    expect(text(checked)).toContain(
      "crowded/titled.dxf: lettering crossed 0, outside the frame 0, holes crossed 0",
    );
  }, 240_000);

  const lBracket = [
    "from build123d import *",
    "with BuildPart() as b:",
    "    Box(80, 50, 8, align=(Align.MIN, Align.MIN, Align.MIN))",
    "    Box(8, 50, 40, align=(Align.MIN, Align.MIN, Align.MIN))",
    "    with Locations((30, 15, 8), (65, 35, 8)):",
    "        Hole(radius=3)",
    "    with Locations(Location((0, 25, 28), (0, 90, 0))):",
    "        Hole(radius=5, depth=20)",
    "    fillet(b.edges().filter_by(Axis.Y).group_by(Axis.X)[-1].group_by(Axis.Z)[-1], radius=6)",
    'show(b.part, name="Bracket")',
  ].join("\n");

  it("draws at the largest scale where every dimension finds clear room, and writes each scale as a drawing does", async () => {
    const dimensioned = await draw({
      code: lBracket,
      sheet: "A4",
      views: [{ view: "front" }, { view: "top" }, { view: "right" }],
      dimensions: [
        { view: "front", kind: "length", from: [0, 0, 0], to: [80, 0, 0] },
        { view: "front", kind: "length", from: [0, 0, 0], to: [0, 0, 40] },
        {
          view: "front",
          kind: "length",
          from: [80, 0, 0],
          to: [74, 0, 8],
          direction: "vertical",
        },
        {
          view: "front",
          kind: "length",
          from: [0, 0, 40],
          to: [8, 0, 40],
          direction: "horizontal",
        },
        { view: "front", kind: "radius", at: [78, 0, 6] },
        ...(["horizontal", "vertical"] as const).flatMap((direction) => [
          {
            view: "top",
            kind: "length",
            from: [0, 0, 0],
            to: [30, 15, 0],
            direction,
          },
          {
            view: "top",
            kind: "length",
            from: [0, 0, 0],
            to: [65, 35, 0],
            direction,
          },
        ]),
        { view: "top", kind: "length", from: [0, 0, 0], to: [0, 50, 0] },
        { view: "top", kind: "diameter", at: [30, 15, 8], all: true },
        { view: "right", kind: "diameter", at: [8, 25, 28] },
        {
          view: "right",
          kind: "length",
          from: [8, 0, 0],
          to: [8, 25, 28],
          direction: "vertical",
        },
      ],
      outputs: [{ path: "scales/bracket.dxf" }],
    });
    const base = [
      "from build123d import *",
      "with BuildPart() as p:",
      "    Box(600, 300, 20, align=(Align.MIN, Align.MIN, Align.MIN))",
      "    with Locations((30, 30, 20), (570, 30, 20), (30, 270, 20), (570, 270, 20)):",
      "        Hole(radius=5)",
      'show(p.part, name="Base")',
    ].join("\n");
    const detailed = await draw({
      code: base,
      sheet: "A4",
      views: [
        { view: "front" },
        { view: "top" },
        { detail: "B", of: "top", at: [30, 30, 20], radius: 15, scale: 3 },
      ],
      outputs: [{ path: "scales/base.pdf" }],
    });

    expect(text(dimensioned)).toMatch(/^Drew A4 landscape at 1:2,/);
    expect(text(dimensioned)).not.toContain("Drawn where it meets");
    // A detail three times its sheet's 1:5 is drawn at 3:5.
    expect(text(detailed)).toMatch(
      /^Drew A4 landscape at 1:5,.* detail B at 3:5\./,
    );
    const checked = await build({
      code: sheetCheck,
      arguments: ["scales/bracket.dxf"],
    });
    expect(text(checked)).toContain(
      "scales/bracket.dxf: lettering crossed 0, outside the frame 0, holes crossed 0",
    );
  }, 240_000);

  it("keeps dimensions clear of each other's lettering, beside a chamfer and in a corner's arc, and letters a detail clear", async () => {
    const wedge = [
      "from build123d import *",
      "with BuildPart() as p:",
      "    Box(80, 40, 40, align=(Align.MIN, Align.MIN, Align.MIN))",
      "    chamfer(p.edges().filter_by(Axis.Y).group_by(Axis.X)[-1].group_by(Axis.Z)[-1], length=30)",
      'show(p.part, name="Wedge")',
    ].join("\n");
    const rounded = [
      "from build123d import *",
      "with BuildPart() as p:",
      "    Box(100, 60, 8, align=(Align.MIN, Align.MIN, Align.MIN))",
      "    fillet(p.edges().filter_by(Axis.Z), radius=10)",
      "    with Locations((50, 30, 8)):",
      "        Hole(radius=6)",
      'show(p.part, name="Plate")',
    ].join("\n");
    const crossing = await draw({
      code: plate,
      views: [
        { view: "top" },
        { detail: "C", of: "top", at: [60, 78, 10], radius: 3 },
      ],
      dimensions: [
        {
          view: "top",
          kind: "length",
          from: [40, 20, 10],
          to: [80, 60, 10],
          direction: "horizontal",
        },
        {
          view: "top",
          kind: "length",
          from: [0, 0, 10],
          to: [60, 40, 10],
          direction: "horizontal",
        },
      ],
      outputs: [{ path: "clear/plate.dxf" }],
    });
    const chamfered = await draw({
      code: wedge,
      views: [{ view: "front" }],
      dimensions: [
        {
          view: "front",
          kind: "length",
          from: [50, 0, 40],
          to: [80, 0, 10],
          direction: "aligned",
        },
      ],
      outputs: [{ path: "clear/wedge.dxf" }],
    });
    // Each radius asked for at its corner's centre.
    const corners = await draw({
      code: rounded,
      views: [{ view: "top" }],
      dimensions: [
        { view: "top", kind: "radius", at: [10, 10, 8] },
        { view: "top", kind: "radius", at: [90, 50, 8] },
      ],
      outputs: [{ path: "clear/rounded.dxf" }],
    });
    for (const result of [crossing, chamfered, corners]) {
      expect(result.isError, text(result)).toBeUndefined();
      expect(text(result)).not.toContain("Drawn where it meets");
    }

    const checked = await build({
      code: [
        sheetCheck.replace("show(Box(1, 1, 1), name='Check')", ""),
        // Each arrowhead's tip, and whether it lies on a visible arc, within the arc's sweep.
        "import math",
        "space = ezdxf.readfile('clear/rounded.dxf').modelspace()",
        "arcs = list(space.query('ARC[layer==\"VISIBLE\"]'))",
        "def on_arc(x, y):",
        "    for a in arcs:",
        "        cx, cy, r = a.dxf.center.x, a.dxf.center.y, a.dxf.radius",
        "        angle = math.degrees(math.atan2(y - cy, x - cx)) % 360",
        "        sweep = (a.dxf.end_angle - a.dxf.start_angle) % 360",
        "        if abs(math.hypot(x - cx, y - cy) - r) < 0.05 and (angle - a.dxf.start_angle) % 360 <= sweep:",
        "            return True",
        "    return False",
        "tips = [s.dxf.vtx0 for s in space.query('SOLID')]",
        "print('arrows on arcs', sum(on_arc(t.x, t.y) for t in tips))",
        "show(Box(1, 1, 1), name='Check')",
      ].join("\n"),
      arguments: ["clear/plate.dxf", "clear/wedge.dxf", "clear/rounded.dxf"],
    });

    for (const name of ["plate", "wedge", "rounded"])
      expect(text(checked)).toContain(
        `clear/${name}.dxf: lettering crossed 0, outside the frame 0, holes crossed 0`,
      );
    expect(text(checked)).toContain("arrows on arcs 2");
  }, 240_000);

  it("letters Chinese text in the title block, and draws details in whatever order they are listed", async () => {
    const titled = (title: string, path: string) =>
      draw({
        code: lBracket,
        views: [
          { view: "front" },
          { detail: "C", of: "B", at: [80, 0, 2], radius: 3, scale: 4 },
          { detail: "B", of: "front", at: [78, 0, 4], radius: 8 },
        ],
        title: { title },
        outputs: [{ path }],
      });

    const chinese = await titled("支架", "titles/chinese.dxf");
    const unknown = await titled("??", "titles/unknown.dxf");
    expect(chinese.isError, text(chinese)).toBeUndefined();
    expect(unknown.isError, text(unknown)).toBeUndefined();
    // Each detail's scale is its sheet's times its own: 2:1 times 2, and times 4.
    expect(text(chinese)).toMatch(/detail B at 4:1 and detail C at 8:1\./);

    const checked = await build({
      code: [
        "import sys",
        "import ezdxf",
        "from build123d import Box",
        "for path in sys.argv[1:]:",
        "    space = ezdxf.readfile(path).modelspace()",
        "    closed = 0",
        "    for e in space.query('LWPOLYLINE[layer==\"TEXT\"]'):",
        "        points = [tuple(round(v, 6) for v in p[:2]) for p in e.get_points()]",
        "        closed += len(points) > 2 and points[0] == points[-1]",
        "    print(path, closed)",
        "show(Box(1, 1, 1), name='Check')",
      ].join("\n"),
      arguments: ["titles/chinese.dxf", "titles/unknown.dxf"],
    });
    const outlines = (path: string) =>
      Number(new RegExp(`${path} (\\d+)`).exec(text(checked))?.[1]);
    // The drawing lettering is single open strokes; characters it lacks are
    // drawn from a font that has them, as closed outlines, not as question marks.
    expect(outlines("titles/unknown.dxf")).toBe(0);
    expect(outlines("titles/chinese.dxf")).toBeGreaterThanOrEqual(4);
  }, 240_000);

  it("draws a detail's arcs as arcs and its cut face inside its circle, and round edges of any curve as circles", async () => {
    const shaft = [
      "from build123d import *",
      "with BuildPart() as s:",
      "    with BuildSketch(Plane.XZ):",
      "        with BuildLine():",
      "            Polyline((0, 0), (0, 10), (30, 10), (30, 15), (70, 15), (70, 8), (100, 8), (100, 0), close=True)",
      "        make_face()",
      "    revolve(axis=Axis.X)",
      "    chamfer(s.edges().group_by(Axis.X)[-1], length=1)",
      "    with Locations(Location((50, 0, 0), (90, 0, 0))):",
      "        Hole(radius=3, depth=40)",
      "    with Locations(Location((0, 0, 0), (0, 90, 0))):",
      "        Hole(radius=4, depth=25)",
      'show(s.part, name="Shaft")',
    ].join("\n");
    const result = await draw({
      code: shaft,
      views: [
        { view: "front" },
        { view: "top" },
        { section: "A", looking: "front", through: [0, 0, 0] },
        { detail: "C", of: "A", at: [100, 0, 8], radius: 5, scale: 5 },
        { detail: "D", of: "front", at: [53, 0, 0], radius: 2 },
      ],
      dimensions: [
        { view: "front", kind: "diameter", at: [50, 0, 0], expect: 6 },
      ],
      outputs: [
        { path: "detail/shaft.dxf" },
        { path: "detail/hole.dxf", view: "D" },
      ],
    });
    expect(result.isError, text(result)).toBeUndefined();
    expect(text(result)).toContain("Dimensions on front: Ø6.");

    const checked = await build({
      code: [
        "import math, sys",
        "import ezdxf",
        "from build123d import Box",
        "hole = ezdxf.readfile(sys.argv[2]).modelspace()",
        "far = max(math.hypot(p.x, p.y) for e in hole for p in (e.flattening(0.01) if e.dxftype() != 'LWPOLYLINE' else [ezdxf.math.Vec2(q[:2]) for q in e.get_points()]))",
        "print('detail D: arcs', len(hole.query('ARC')), 'reach', round(far, 3))",
        "sheet = ezdxf.readfile(sys.argv[1]).modelspace()",
        "window = max(sheet.query('CIRCLE[layer==\"THIN\"]'), key=lambda c: c.dxf.radius)",
        "cx, cy, r = window.dxf.center.x, window.dxf.center.y, window.dxf.radius",
        "inside = outside = 0",
        "for e in sheet.query('LWPOLYLINE[layer==\"HATCH\"]'):",
        "    points = e.get_points()",
        "    if any(math.hypot(p[0] - cx, p[1] - cy) < 1.5 * r for p in points):",
        "        far = max(math.hypot(p[0] - cx, p[1] - cy) for p in points)",
        "        inside += far <= r + 0.01",
        "        outside += far > r + 0.01",
        "print('detail C hatch: inside', inside > 0, 'outside', outside)",
        "show(Box(1, 1, 1), name='Check')",
      ].join("\n"),
      arguments: ["detail/shaft.dxf", "detail/hole.dxf"],
    });

    // The hole's edge, round on the shaft's curved face, is cut by the window into arcs.
    expect(text(checked)).toMatch(
      /detail D: arcs [1-9]\d* reach (1\.\d+|2(\.0+)?)\b/,
    );
    expect(text(checked)).toContain("detail C hatch: inside True outside 0");
  }, 180_000);

  it("draws centre lines for holes and shafts, and none for a rounded corner", async () => {
    const result = await draw({
      code: "from build123d import *\nshow(fillet(Box(40, 30, 10).edges().filter_by(Axis.Z), radius=4), name='Tile')",
      views: [{ view: "front" }, { view: "top" }, { view: "right" }],
      outputs: [{ path: "rounded/tile.dxf" }],
    });
    expect(result.isError, text(result)).toBeUndefined();

    const checked = await build({
      code: [
        "import sys",
        "import ezdxf",
        "from build123d import Box",
        "space = ezdxf.readfile(sys.argv[1]).modelspace()",
        "print('centre lines', len(space.query('*[layer==\"CENTRE\"]')))",
        "show(Box(1, 1, 1), name='Check')",
      ].join("\n"),
      arguments: ["rounded/tile.dxf"],
    });

    // The one centre line on the sheet is the projection symbol's, in the title block.
    expect(text(checked)).toContain("centre lines 1");
  }, 120_000);

  it("refuses a point between two corners, a section it cannot mark or that cuts nothing, and counts holes apart from pins", async () => {
    const chamfered = await draw({
      code: [
        "from build123d import *",
        "with BuildPart() as p:",
        "    Box(40, 20, 5, align=(Align.MIN, Align.MIN, Align.MIN))",
        "    chamfer(p.edges().filter_by(Axis.Z), length=0.5)",
        'show(p.part, name="Tag")',
      ].join("\n"),
      views: [{ view: "top" }],
      dimensions: [
        { view: "top", kind: "length", from: [0, 0, 5], to: [40, 0, 5] },
      ],
      outputs: [{ path: "refused/tag.pdf" }],
    });
    expect(chamfered.isError).toBe(true);
    expect(text(chamfered)).toMatch(
      /\(0, 0, 5\) is no corner or end of the top view, its start for dimension 1, and lies between \((0\.5, 0|0, 0\.5), 5\) and \((0, 0\.5|0\.5, 0), 5\); give the one meant/,
    );

    const unmarked = await draw({
      code: lBracket,
      views: [
        { view: "front" },
        { section: "A", looking: "front", through: [0, 15, 0] },
        { section: "B", looking: "front", through: [40, 0, 4] },
      ],
      outputs: [{ path: "refused/bracket.pdf" }],
    });
    expect(unmarked.isError).toBe(true);
    expect(text(unmarked)).toContain(
      "section A's cutting plane shows on no view of the drawing, which it is marked on; add one, such as top or right",
    );
    // Through the bracket's front face, which it only touches.
    expect(text(unmarked)).toContain(
      "section B's plane through (40, 0, 4) cuts no part: it lies on a face of the part, and passes through none of it; put it through the part",
    );

    const pinned = await draw({
      code: [
        "from build123d import *",
        "with BuildPart() as p:",
        "    Box(100, 60, 10, align=(Align.MIN, Align.MIN, Align.MIN))",
        "    with Locations((10, 10, 10), (90, 10, 10), (10, 50, 10), (90, 50, 10)):",
        "        Hole(radius=3)",
        "    with Locations((50, 30, 10)):",
        "        Cylinder(3, 15, align=(Align.CENTER, Align.CENTER, Align.MIN))",
        'show(p.part, name="Locator")',
      ].join("\n"),
      views: [{ view: "front" }, { view: "top" }],
      dimensions: [
        { view: "top", kind: "diameter", at: [10, 10, 10], all: true },
        { view: "top", kind: "diameter", at: [53, 30, 25] },
      ],
      outputs: [{ path: "pinned/locator.pdf" }],
    });
    expect(pinned.isError, text(pinned)).toBeUndefined();
    expect(text(pinned)).toContain("Dimensions on top: 4× Ø6, Ø6.");
  }, 180_000);

  it("draws a section through the line where a hollow's walls touch a post standing in it", async () => {
    // A water jacket as an engine block has one: a slot whose sides touch the
    // round post left in it along a line, which the plane runs through.
    const jacketed = await draw({
      code: [
        "from build123d import *",
        "hollow = Box(150, 40, 30) - Cylinder(20, 30)",
        'show(Box(200, 100, 80) - hollow, name="Block")',
      ].join("\n"),
      views: [
        { view: "front" },
        { view: "top" },
        { section: "A", looking: "right", through: [0, 0, 0] },
      ],
      dimensions: [
        { view: "A", kind: "length", from: [0, -50, 40], to: [0, 50, 40] },
      ],
      outputs: [{ path: "jacket/block.png" }],
    });

    expect(jacketed.isError, text(jacketed)).toBeUndefined();
    expect(text(jacketed)).toContain("Dimensions on A: 100.");
    expect(text(jacketed)).toContain("section A 100 × 80 mm");
  });

  it("draws a sliver of a curved edge as the line it is, never as an arc of a vast circle", async () => {
    // A head of one cylinder: a plug well and two valve wells tilted across
    // it, whose meeting leaves slivers of curves a hundredth of a millimetre long.
    const drawn = await draw({
      code: [
        "from build123d import *",
        "head = Box(108, 130, 110) - Cylinder(12, 110)",
        "for side in (-1, 1):",
        "    head = head - Location((0, side * 32, -6), (-side * 12, 0, 0)) * Cylinder(13, 97)",
        'show(head, name="Head")',
      ].join("\n"),
      views: [{ view: "front" }, { view: "right" }],
      // The sheet's DXF holds every edge as drawn, seen or behind, arcs as arcs.
      outputs: [{ path: "slivers/head.dxf" }],
    });

    expect(drawn.isError, text(drawn)).toBeUndefined();
    expect(text(drawn)).toContain("right view 130 × 110 mm");
    // Each arc and circle of the sheet, by its radius on paper.
    const pairs = (await readFile(join(root, "slivers", "head.dxf"), "utf8"))
      .split(/\r?\n/)
      .map((line) => line.trim());
    const radii: number[] = [];
    let entity = "";
    for (let i = 0; i + 1 < pairs.length; i += 2) {
      if (pairs[i] === "0") entity = pairs[i + 1] ?? "";
      else if (pairs[i] === "40" && (entity === "ARC" || entity === "CIRCLE"))
        radii.push(Number(pairs[i + 1]));
    }
    expect(radii.length).toBeGreaterThan(0);
    expect(Math.max(...radii)).toBeLessThan(65);
  });

  it("steps the scale down once at most for room, leads past a hole's own circles, and marks every section across its view and alike", async () => {
    const shaft = await draw({
      code: [
        "from build123d import *",
        "with BuildPart() as s:",
        "    with BuildSketch(Plane.XZ):",
        "        with BuildLine():",
        "            Polyline((0, 0), (0, 10), (30, 10), (30, 15), (70, 15), (70, 8), (100, 8), (100, 0), close=True)",
        "        make_face()",
        "    revolve(axis=Axis.X)",
        "    chamfer(s.edges().group_by(Axis.X)[-1], length=1)",
        "    with Locations(Location((50, 0, 0), (90, 0, 0))):",
        "        Hole(radius=3, depth=40)",
        "    with Locations(Location((0, 0, 0), (0, 90, 0))):",
        "        Hole(radius=4, depth=25)",
        'show(s.part, name="Shaft")',
      ].join("\n"),
      sheet: "A4",
      orientation: "portrait",
      projection: "third",
      views: [
        { view: "front" },
        { view: "right" },
        { section: "A", looking: "right", through: [50, 0, 0] },
        { detail: "B", of: "front", at: [100, 0, 8], radius: 4, scale: 4 },
      ],
      dimensions: [
        { view: "front", kind: "length", from: [0, 0, 10], to: [30, 0, 10] },
        { view: "front", kind: "length", from: [30, 0, 15], to: [70, 0, 15] },
        { view: "front", kind: "length", from: [0, 0, 10], to: [100, 0, 7] },
        {
          view: "front",
          kind: "length",
          from: [30, 0, 15],
          to: [30, 0, -15],
          diameter: true,
        },
        { view: "right", kind: "diameter", at: [0, 15, 0] },
        { view: "A", kind: "diameter", at: [50, 15, 0] },
      ],
      outputs: [{ path: "shaft/shaft.pdf" }],
    });
    expect(shaft.isError, text(shaft)).toBeUndefined();
    // 1:1 does not fit A4 with four views; 1:2 does, and is no more than a step below.
    expect(text(shaft)).toMatch(/at 1:2\b/);
    expect(text(shaft)).not.toContain("Drawn where it meets");

    const flange = await draw({
      code: [
        "from build123d import *",
        "with BuildPart() as f:",
        "    Cylinder(50, 12, align=(Align.CENTER, Align.CENTER, Align.MIN))",
        "    with Locations((0, 0, 12)):",
        "        Cylinder(25, 20, align=(Align.CENTER, Align.CENTER, Align.MIN))",
        "    Hole(radius=15)",
        "    with Locations((0, 0, 12)):",
        "        with PolarLocations(38, 6):",
        "            Hole(radius=4)",
        'show(f.part, name="Flange")',
      ].join("\n"),
      views: [{ view: "front" }, { view: "top" }],
      dimensions: [
        { view: "top", kind: "diameter", at: [38, 0, 12], all: true },
        { view: "top", kind: "diameter", at: [15, 0, 32] },
      ],
      outputs: [{ path: "flange/flange.pdf" }],
    });
    expect(flange.isError, text(flange)).toBeUndefined();
    expect(text(flange)).toContain("6× Ø8");
    expect(text(flange)).not.toContain("Drawn where it meets");

    // A bar marked off its middle, two holes in a block, and two boxes side by side.
    const marked = await draw({
      code: [
        "from build123d import *",
        "with BuildPart() as p:",
        "    Box(200, 20, 10, align=(Align.MIN, Align.MIN, Align.MIN))",
        "    with Locations((20, 5, 10), (180, 15, 10)):",
        "        Hole(radius=3)",
        'show(p.part, name="Bar")',
      ].join("\n"),
      views: [
        { view: "top" },
        { section: "A", looking: "front", through: [0, 5, 0] },
      ],
      outputs: [{ path: "marked/bar.dxf" }],
    });
    const pair = (sections: Record<string, unknown>[], path: string) =>
      draw({
        code: [
          "from build123d import *",
          'show(Box(20, 20, 20, align=(Align.MIN, Align.MIN, Align.MIN)), name="Base")',
          'show(Pos(20, 0, 0) * Box(20, 20, 10, align=(Align.MIN, Align.MIN, Align.MIN)), name="Cap")',
        ].join("\n"),
        views: [{ view: "front" }, { view: "top" }, ...sections],
        outputs: [{ path }],
      });
    const both = await pair(
      [{ section: "A", looking: "front", through: [20, 10, 0] }],
      "marked/both.dxf",
    );
    const capOnly = await pair(
      [{ section: "B", looking: "left", through: [30, 10, 0] }],
      "marked/cap.dxf",
    );
    for (const result of [marked, both, capOnly])
      expect(result.isError, text(result)).toBeUndefined();

    const checked = await build({
      code: [
        "import math",
        "import sys",
        "import ezdxf",
        "from build123d import Box",
        "def lines(path, layer):",
        "    return [e.get_points() for e in ezdxf.readfile(path).modelspace().query(f'LWPOLYLINE[layer==\"{layer}\"]')]",
        "cutting = lines(sys.argv[1], 'CUTTING')",
        "print('cutting line', round(max(abs(l[-1][0] - l[0][0]) for l in cutting)))",
        "# The projection symbol's one, the top view's two crosses, and the section's centre line of the hole it cuts.",
        "print('centre lines', len(lines(sys.argv[1], 'CENTRE')))",
        "for path in sys.argv[2:]:",
        "    angles = sorted({round(math.degrees(math.atan2(l[-1][1] - l[0][1], l[-1][0] - l[0][0]))) % 180 for l in lines(path, 'HATCH')})",
        "    print(path, 'hatched at', angles)",
        "show(Box(1, 1, 1), name='Check')",
      ].join("\n"),
      arguments: ["marked/bar.dxf", "marked/both.dxf", "marked/cap.dxf"],
    });

    // Across the whole 200 mm bar, though the plane passes a quarter of its width from one side.
    expect(text(checked)).toMatch(/cutting line (20\d|21\d)\b/);
    expect(text(checked)).toContain("centre lines 6");
    expect(text(checked)).toContain("marked/both.dxf hatched at [45, 135]");
    expect(text(checked)).toContain("marked/cap.dxf hatched at [135]");
  }, 240_000);

  it("keeps a length's extension lines from running just beside an edge, where they would read as that edge's", async () => {
    // A window 32 wide high in a block, under a post 34 wide: above, the
    // window's extension lines would run a millimetre beside the post's sides.
    const block = await draw({
      code: [
        "from build123d import *",
        "body = Box(60, 20, 50, align=(Align.CENTER, Align.CENTER, Align.MIN))",
        "window = Pos(0, 0, 42) * Box(32, 20, 8)",
        "post = Pos(0, 0, 50) * Box(34, 20, 30, align=(Align.CENTER, Align.CENTER, Align.MIN))",
        'show(body - window + post, name="Block")',
      ].join("\n"),
      views: [{ view: "front" }],
      scale: "1:1",
      dimensions: [
        {
          view: "front",
          kind: "length",
          from: [-16, -10, 46],
          to: [16, -10, 46],
          direction: "horizontal",
        },
      ],
      outputs: [{ path: "beside/block.dxf" }],
    });
    expect(block.isError, text(block)).toBeUndefined();

    const checked = await build({
      code: [
        "import sys",
        "import ezdxf",
        "from build123d import Box",
        "space = ezdxf.readfile(sys.argv[1]).modelspace()",
        "def points(layer):",
        "    return [[tuple(p[:2]) for p in e.get_points()] for e in space.query(f'LWPOLYLINE[layer==\"{layer}\"]')]",
        "part = [p for line in points('VISIBLE') for p in line]",
        "low, high = min(p[1] for p in part), max(p[1] for p in part)",
        "left, right = min(p[0] for p in part), max(p[0] for p in part)",
        "upright = [l for l in points('THIN') if abs(l[0][0] - l[-1][0]) < 1e-6 and abs(l[0][1] - l[-1][1]) > 3 and left < l[0][0] < right]",
        "print('extension lines', len(upright), 'below the part', all(min(p[1] for p in l) < low for l in upright), 'above it', any(max(p[1] for p in l) > high for l in upright))",
        "show(Box(1, 1, 1), name='Check')",
      ].join("\n"),
      arguments: ["beside/block.dxf"],
    });

    expect(text(checked)).toContain(
      "extension lines 2 below the part True above it False",
    );
    expect(text(block)).not.toContain("run just beside");

    // With a foot as narrow as the post, every side runs beside an edge: the answer says so.
    const boxed = await draw({
      code: [
        "from build123d import *",
        "body = Box(60, 20, 50, align=(Align.CENTER, Align.CENTER, Align.MIN))",
        "window = Pos(0, 0, 42) * Box(32, 20, 8)",
        "post = Pos(0, 0, 50) * Box(34, 20, 30, align=(Align.CENTER, Align.CENTER, Align.MIN))",
        "foot = Box(34, 20, 30, align=(Align.CENTER, Align.CENTER, Align.MAX))",
        'show(body - window + post + foot, name="Block")',
      ].join("\n"),
      views: [{ view: "front" }],
      scale: "1:1",
      dimensions: [
        {
          view: "front",
          kind: "length",
          from: [-16, -10, 46],
          to: [16, -10, 46],
          direction: "horizontal",
        },
      ],
      outputs: [{ path: "beside/boxed.pdf" }],
    });
    expect(boxed.isError, text(boxed)).toBeUndefined();
    expect(text(boxed)).toContain(
      "Its extension lines run just beside other edges, where they can read as those edges: 32 on front.",
    );
  }, 120_000);

  it("hatches a thin cut wall closely enough to read as cut along its whole length", async () => {
    const tube = await draw({
      code: [
        "from build123d import *",
        'show(Cylinder(15, 40) - Cylinder(14.2, 40), name="Sleeve")',
      ].join("\n"),
      views: [
        { view: "top" },
        { section: "A", looking: "front", through: [0, 0, 0] },
      ],
      scale: "1:1",
      outputs: [{ path: "thin/sleeve.dxf" }],
    });
    expect(tube.isError, text(tube)).toBeUndefined();

    const checked = await build({
      code: [
        "import sys",
        "import ezdxf",
        "from build123d import Box",
        "strokes = [e.get_points() for e in ezdxf.readfile(sys.argv[1]).modelspace().query('LWPOLYLINE[layer==\"HATCH\"]')]",
        "middles = [((s[0][0] + s[-1][0]) / 2, (s[0][1] + s[-1][1]) / 2) for s in strokes]",
        "centre = (min(m[0] for m in middles) + max(m[0] for m in middles)) / 2",
        "for name, wall in (('left', [m for m in middles if m[0] < centre]), ('right', [m for m in middles if m[0] > centre])):",
        "    heights = sorted(m[1] for m in wall)",
        "    gap = max(b - a for a, b in zip(heights, heights[1:]))",
        "    print(name, 'wall strokes', len(wall), 'widest gap under 2 mm', gap < 2, 'from end to end', heights[-1] - heights[0] > 36)",
        "show(Box(1, 1, 1), name='Check')",
      ].join("\n"),
      arguments: ["thin/sleeve.dxf"],
    });

    expect(text(checked)).toMatch(
      /left wall strokes \d+ widest gap under 2 mm True from end to end True/,
    );
    expect(text(checked)).toMatch(
      /right wall strokes \d+ widest gap under 2 mm True from end to end True/,
    );
  }, 120_000);

  it("draws smooth edges thin, hidden lines unbroken, and a centre cross on every small hole and slot end", async () => {
    const tile = await draw({
      code: "from build123d import *\nshow(fillet(Box(40, 30, 10).edges().filter_by(Axis.Z), radius=4), name='Tile')",
      views: [{ view: "front" }],
      outputs: [{ path: "smooth/front.dxf", view: "front" }],
    });
    const bush = await draw({
      code: [
        "from build123d import *",
        "with BuildPart() as b:",
        "    Cylinder(20, 30, align=(Align.CENTER, Align.CENTER, Align.MIN))",
        "    Hole(radius=10)",
        "    with Locations((0, 0, 30)):",
        "        Cylinder(15, 10, align=(Align.CENTER, Align.CENTER, Align.MAX), mode=Mode.SUBTRACT)",
        'show(b.part, name="Bush")',
      ].join("\n"),
      views: [{ view: "front" }, { view: "top" }],
      outputs: [{ path: "smooth/bush.dxf" }],
    });
    const plate = await draw({
      code: [
        "from build123d import *",
        "with BuildPart() as p:",
        "    Box(300, 150, 5, align=(Align.MIN, Align.MIN, Align.MIN))",
        "    with Locations((10, 10, 5), (290, 10, 5), (10, 140, 5), (290, 140, 5)):",
        "        Hole(radius=1)",
        "    with BuildSketch(Plane.XY.offset(5)):",
        "        with Locations((150, 75)):",
        "            SlotCenterToCenter(16, 9)",
        "    extrude(amount=-5, mode=Mode.SUBTRACT)",
        'show(p.part, name="Plate")',
      ].join("\n"),
      views: [{ view: "top" }],
      scale: "1:1",
      outputs: [{ path: "smooth/plate.dxf" }],
    });
    for (const result of [tile, bush, plate])
      expect(result.isError, text(result)).toBeUndefined();

    const checked = await build({
      code: [
        "import sys",
        "import ezdxf",
        "from build123d import Box",
        "def lines(path, layer):",
        "    return [[tuple(p[:2]) for p in e.get_points()] for e in ezdxf.readfile(path).modelspace().query(f'LWPOLYLINE[layer==\"{layer}\"]')]",
        "upright = sorted({float(round(l[0][0], 3)) for l in lines(sys.argv[1], 'VISIBLE') if abs(l[0][0] - l[-1][0]) < 1e-6})",
        "print('tile front upright edges at', upright)",
        "def overlap(a, b):",
        "    (p, q), (r, s) = a[:2], b[:2]",
        "    d = (q[0] - p[0], q[1] - p[1])",
        "    n = (d[0] ** 2 + d[1] ** 2) ** 0.5",
        "    if n < 1e-9: return False",
        "    off = lambda t: abs((t[0] - p[0]) * d[1] - (t[1] - p[1]) * d[0]) / n",
        "    if off(r) > 1e-3 or off(s) > 1e-3: return False",
        "    along = lambda t: ((t[0] - p[0]) * d[0] + (t[1] - p[1]) * d[1]) / n",
        "    lo, hi = sorted((along(r), along(s)))",
        "    return hi > 1e-3 and lo < n - 1e-3",
        "hidden = [l for l in lines(sys.argv[2], 'HIDDEN') if len(l) == 2]",
        "print('hidden lines over another', sum(overlap(a, b) for i, a in enumerate(hidden) for b in hidden[i + 1:]))",
        "print('plate centre lines', len(lines(sys.argv[3], 'CENTRE')))",
        "show(Box(1, 1, 1), name='Check')",
      ].join("\n"),
      arguments: ["smooth/front.dxf", "smooth/bush.dxf", "smooth/plate.dxf"],
    });

    // Its two sides, and no line where the rounded corners meet its front face, 4 mm in.
    expect(text(checked)).toContain(
      "tile front upright edges at [-20.0, 20.0]",
    );
    expect(text(checked)).toContain("hidden lines over another 0");
    // Four holes' crosses, the slot's two ends on one shared line, and the projection symbol's.
    expect(text(checked)).toContain("plate centre lines 12");
  }, 180_000);

  it("draws only the visible line where a hidden one lies under it, keeping the length of a hidden edge it does not cover", async () => {
    // A plate with two through holes and a blind hole from below: from the
    // top, each through hole's far circle and the plate's bottom outline lie
    // under what is seen; the blind hole lies only behind.
    const plate = await draw({
      code: [
        "from build123d import *",
        "plate = Box(60, 30, 10) - Pos(-15, 0, 0) * Cylinder(5, 20) - Pos(15, 0, 0) * Cylinder(5, 20)",
        "plate -= Pos(0, 0, -5) * Cylinder(3, 6)",
        'show(plate, name="Plate")',
      ].join("\n"),
      views: [{ view: "front" }, { view: "top" }],
      scale: "1:1",
      outputs: [{ path: "under/plate.dxf" }],
    });
    expect(plate.isError, text(plate)).toBeUndefined();
    // A groove along the underside, and a step on top whose front edge lies
    // over the left half of the groove's back edge.
    const stepped = await draw({
      code: [
        "from build123d import *",
        "part = Box(60, 30, 10) - Pos(0, 0, -3.5) * Box(60, 10, 3) + Pos(-15, 10, 10) * Box(30, 10, 10)",
        'show(part, name="Stepped")',
      ].join("\n"),
      views: [{ view: "top" }],
      scale: "1:1",
      outputs: [{ path: "under/stepped.dxf" }],
    });
    expect(stepped.isError, text(stepped)).toBeUndefined();

    const checked = await build({
      code: [
        "import math, sys",
        "import ezdxf",
        "from build123d import Box",
        "def segments(space, layer):",
        "    found = []",
        "    for e in space.query(f'LWPOLYLINE[layer==\"{layer}\"]'):",
        "        points = [tuple(p[:2]) for p in e.get_points()]",
        "        found += list(zip(points, points[1:]))",
        "    return found",
        "def under(h, v):",
        "    (p, q), (r, s) = h, v",
        "    n = math.dist(p, q)",
        "    if n < 1e-9: return 0.0",
        "    d = ((q[0] - p[0]) / n, (q[1] - p[1]) / n)",
        "    off = lambda t: abs((t[0] - p[0]) * d[1] - (t[1] - p[1]) * d[0])",
        "    if off(r) > 1e-3 or off(s) > 1e-3: return 0.0",
        "    along = lambda t: (t[0] - p[0]) * d[0] + (t[1] - p[1]) * d[1]",
        "    lo, hi = sorted((along(r), along(s)))",
        "    return max(0.0, min(n, hi) - max(0.0, lo))",
        "def rounds(space, layer):",
        "    found = [(c.dxf.center.x, c.dxf.center.y, c.dxf.radius) for c in space.query(f'CIRCLE[layer==\"{layer}\"]')]",
        "    return found + [(a.dxf.center.x, a.dxf.center.y, a.dxf.radius) for a in space.query(f'ARC[layer==\"{layer}\"]')]",
        "for path in sys.argv[1:]:",
        "    space = ezdxf.readfile(path).modelspace()",
        "    hidden, seen = segments(space, 'HIDDEN'), segments(space, 'VISIBLE')",
        "    covered = sum(under(h, v) for h in hidden for v in seen)",
        "    behind, front = rounds(space, 'HIDDEN'), rounds(space, 'VISIBLE')",
        "    doubled = sum(1 for h in behind if any(math.dist(h[:2], v[:2]) < 1e-3 and abs(h[2] - v[2]) < 1e-3 for v in front))",
        "    radii = lambda found: sorted(round(r, 2) for _, _, r in found)",
        "    total = sum(math.dist(a, b) for a, b in hidden)",
        "    print(path, 'hidden length under visible', round(covered, 2), 'hidden circles under visible', doubled,",
        "          'visible radii', radii(front), 'hidden radii', radii(behind), 'hidden length', round(total, 2))",
        "show(Box(1, 1, 1), name='Check')",
      ].join("\n"),
      arguments: ["under/plate.dxf", "under/stepped.dxf"],
    });

    // Each through hole is one circle seen end on; the blind hole stays hidden.
    expect(text(checked)).toContain(
      "under/plate.dxf hidden length under visible 0.0 hidden circles under visible 0 visible radii [5.0, 5.0] hidden radii [3.0]",
    );
    // Only the groove's front edge, 60 long, and the half of its back edge the step does not cover, 30.
    expect(text(checked)).toContain(
      "under/stepped.dxf hidden length under visible 0.0 hidden circles under visible 0 visible radii [] hidden radii [] hidden length 90.0",
    );
  }, 180_000);

  it("wraps a long title block field, names one cut short, and names dimensions that meet another view", async () => {
    const titled = (material: string) =>
      draw({
        code: "from build123d import *\nshow(Box(60, 40, 10), name='Plate')",
        views: [{ view: "top" }],
        title: { title: "Plate", material },
        outputs: [{ path: "titled/plate.pdf" }],
      });
    const wrapped = await titled(
      "EN AW-6082-T6 (AlSi1MgMn), clear anodised 15 µm, edges deburred",
    );
    const cut = await titled(
      "铝合金板材表面阳极氧化处理并去除毛刺".repeat(4).slice(0, 80),
    );
    expect(wrapped.isError, text(wrapped)).toBeUndefined();
    expect(text(wrapped)).not.toContain("Cut short");
    expect(cut.isError, text(cut)).toBeUndefined();
    expect(text(cut)).toContain(
      "Cut short to fit the title block, with an ellipsis: material.",
    );

    const busy = await draw({
      code: [
        "from build123d import *",
        "with BuildPart() as p:",
        "    Box(160, 100, 12, align=(Align.MIN, Align.MIN, Align.MIN))",
        "    with Locations((10, 10, 12), (60, 10, 12), (110, 10, 12), (150, 10, 12), (10, 90, 12), (150, 90, 12)):",
        "        Hole(radius=4)",
        "    with Locations((40, 60, 12), (120, 60, 12)):",
        "        Hole(radius=6)",
        "    with Locations((80, 55, 12)):",
        "        Box(40, 30, 5, align=(Align.CENTER, Align.CENTER, Align.MAX), mode=Mode.SUBTRACT)",
        "    chamfer(p.edges().filter_by(Axis.Z).group_by(Axis.X)[-1], length=8)",
        'show(p.part, name="Base plate")',
      ].join("\n"),
      sheet: "A4",
      projection: "first",
      outputs: [{ path: "busy/plate.pdf" }],
      // The front and the top alone, one row apart: a section beside the
      // front would bring its name's room into that row, and room with it.
      views: [{ view: "top" }, { view: "front" }],
      dimensions: [
        ...[
          [160, 8],
          [10, 10],
          [60, 10],
          [110, 10],
          [150, 10],
          [40, 60],
          [120, 60],
        ].map(([x, y]) => ({
          view: "top",
          kind: "length",
          from: [0, 0, 12],
          to: [x, y, 12],
          direction: "horizontal",
        })),
        { view: "top", kind: "length", from: [0, 0, 12], to: [0, 100, 12] },
        ...[
          [10, 10],
          [40, 60],
          [10, 90],
        ].map(([x, y]) => ({
          view: "top",
          kind: "length",
          from: [0, 0, 12],
          to: [x, y, 12],
          direction: "vertical",
        })),
        {
          view: "top",
          kind: "length",
          from: [60, 40, 12],
          to: [100, 70, 12],
          direction: "horizontal",
        },
        { view: "top", kind: "length", from: [100, 40, 12], to: [100, 70, 12] },
        {
          view: "top",
          kind: "length",
          from: [152, 0, 12],
          to: [160, 8, 12],
          direction: "horizontal",
        },
        {
          view: "top",
          kind: "length",
          from: [160, 8, 12],
          to: [152, 0, 12],
          direction: "vertical",
        },
        { view: "top", kind: "diameter", at: [10, 10, 12], all: true },
        {
          view: "top",
          kind: "diameter",
          at: [40, 60, 12],
          all: true,
          tolerance: "H7",
        },
        { view: "front", kind: "length", from: [0, 0, 0], to: [0, 0, 12] },
      ],
    });
    expect(busy.isError, text(busy)).toBeUndefined();
    // The overall length, stacked furthest out, lies over the front view, which
    // stands above the top view in first angle; the answer names it.
    expect(text(busy)).toMatch(/for want of room: (.*, )?160 on top\b/);
  }, 180_000);

  it("letters Korean and Vietnamese, and refuses joined scripts, a Ø across nothing round and a section's unknown or only parts", async () => {
    const block =
      "from build123d import *\nshow(Box(40, 30, 20), name='Block')";
    const korean = await draw({
      outputs: [{ path: "lettered/korean.pdf" }],
      code: block,
      views: [{ view: "front" }],
      title: {
        title: "브래킷 블록 ⌀6 구멍",
        author: "김민수",
        company: "Công ty Cơ khí Đức Việt",
      },
    });
    expect(korean.isError, text(korean)).toBeUndefined();

    const arabic = await draw({
      outputs: [{ path: "refused/sheet.pdf" }],
      code: block,
      views: [{ view: "front" }],
      title: { title: "كتلة" },
    });
    expect(arabic.isError).toBe(true);
    expect(text(arabic)).toContain(
      "the title's title has characters the lettering cannot draw: ك ت ل ة",
    );

    // Across a square block's width is no diameter; across a shaft's is.
    const square = await draw({
      outputs: [{ path: "refused/sheet.pdf" }],
      code: block,
      views: [{ view: "front" }],
      dimensions: [
        {
          view: "front",
          kind: "length",
          from: [-20, -15, -10],
          to: [20, -15, -10],
          diameter: true,
        },
      ],
    });
    expect(square.isError).toBe(true);
    expect(text(square)).toContain(
      "dimension 1 is written as a diameter, but no round face's axis or circle lies midway between its ends in the front view",
    );
    const shaft = await draw({
      outputs: [{ path: "lettered/shaft.pdf" }],
      code: "from build123d import *\nshow(Cylinder(10, 60), name='Shaft')",
      views: [{ view: "front" }],
      dimensions: [
        {
          view: "front",
          kind: "length",
          from: [-10, 0, -30],
          to: [10, 0, -30],
          diameter: true,
        },
      ],
    });
    expect(shaft.isError, text(shaft)).toBeUndefined();

    const assembly = [
      "from build123d import *",
      "show(Box(40, 40, 40) - Cylinder(10, 40, rotation=(0, 90, 0)), name='Block')",
      "show(Cylinder(10, 100, rotation=(0, 90, 0)), name='Shaft')",
    ].join("\n");
    const unknown = await draw({
      outputs: [{ path: "refused/sheet.pdf" }],
      code: assembly,
      views: [
        { view: "top" },
        { section: "A", looking: "front", through: [0, 0, 0], uncut: ["Pin"] },
      ],
    });
    expect(unknown.isError).toBe(true);
    expect(text(unknown)).toContain(
      "section A leaves Pin whole, which the drawing does not show; it shows Block, Shaft",
    );
    // A plane through the shaft beyond the block cuts only what it leaves whole.
    const only = await draw({
      outputs: [{ path: "refused/sheet.pdf" }],
      code: assembly,
      views: [
        { view: "top" },
        {
          section: "A",
          looking: "right",
          through: [40, 0, 0],
          uncut: ["Shaft"],
        },
      ],
    });
    expect(only.isError).toBe(true);
    expect(text(only)).toContain("cuts only parts it leaves whole");
  }, 180_000);

  it("draws a section's revolved parts turned into its plane about their axis: each blade whole from hub to tip, both sides of the axis, hiding what lies behind", async () => {
    // A drum along y, twelve flat blades round it from 50 to 110 mm out,
    // 30 mm along the axis, in a casing; and behind the cutting plane, among
    // the blades, a pin, which the blades turned into the plane stand in front of.
    const rotor = [
      "from build123d import *",
      "drum = Cylinder(50, 100, rotation=(90, 0, 0))",
      "blade = Box(2, 30, 60).moved(Location((0, 0, 80)))",
      "show(drum, name='Drum')",
      "show(Compound(children=[blade.rotate(Axis.Y, 30 * k) for k in range(12)]), name='Blades')",
      "show(Cylinder(130, 100, rotation=(90, 0, 0)) - Cylinder(120, 100, rotation=(90, 0, 0)), name='Casing')",
      "show(Cylinder(3, 40).moved(Location((-40, 0, 80))), name='Pin')",
    ].join("\n");
    const section = (dimensions: unknown[]) =>
      draw({
        code: rotor,
        scale: "1:2",
        views: [
          { view: "front" },
          {
            section: "A",
            looking: "right",
            through: [0, 0, 0],
            revolved: ["Blades"],
            axis: { through: [0, 0, 0], along: [0, 1, 0] },
          },
        ],
        dimensions,
        outputs: [{ path: "revolved/rotor.pdf" }],
      });

    const spans = await section([
      // Root to tip above the axis, and tip to tip across it.
      {
        view: "A",
        kind: "length",
        from: [0, -15, 110],
        to: [0, -15, 50],
        direction: "vertical",
        expect: 60,
      },
      {
        view: "A",
        kind: "length",
        from: [0, 15, 110],
        to: [0, 15, -110],
        direction: "vertical",
        expect: 220,
      },
    ]);
    const behind = await section([
      {
        view: "A",
        kind: "length",
        from: [0, 3, 100],
        to: [0, 3, 60],
        direction: "vertical",
      },
    ]);

    expect(spans.isError, text(spans)).toBeUndefined();
    // The blades' corners lie a hair out from the drum, so the spans read so to the hundredth.
    expect(text(spans)).toMatch(/Dimensions on A: (59\.99|60), 220(\.01)?\./);
    expect(behind.isError).toBe(true);
    expect(text(behind)).toContain("dimension 1");
  }, 180_000);

  it("cuts a part's profile, draws uncut parts whole, names a lone back view, aims the auxiliary arrow and letters a detail clear", async () => {
    const cover = await draw({
      code: [
        "from build123d import *",
        "with BuildPart() as p:",
        "    Box(80, 50, 3, align=(Align.CENTER, Align.CENTER, Align.MIN))",
        "    with Locations((0, 0, 3)):",
        "        with GridLocations(64, 34, 2, 2):",
        "            CounterSinkHole(radius=1.7, counter_sink_radius=3.2)",
        "    chamfer(p.edges().group_by(Axis.Z)[-1].filter_by(GeomType.LINE), length=0.5)",
        'show(p.part, name="Cover")',
      ].join("\n"),
      views: [{ view: "top" }],
      outputs: [{ path: "seven/cut.dxf", view: "top" }],
    });

    const assembly = [
      "from build123d import *",
      "show(Box(40, 40, 40) - Cylinder(10, 40, rotation=(0, 90, 0)), name='Block')",
      "show(Cylinder(10, 100, rotation=(0, 90, 0)), name='Shaft')",
    ].join("\n");
    const sectioned = (path: string, uncut: string[]) =>
      draw({
        code: assembly,
        scale: "1:1",
        views: [
          { view: "top" },
          { section: "A", looking: "front", through: [0, 0, 0], uncut },
        ],
        dimensions: [
          { view: "A", kind: "length", from: [-20, 0, -20], to: [20, 0, -20] },
        ],
        outputs: [{ path }],
      });
    const whole = await sectioned("seven/whole.dxf", ["Shaft"]);
    const allCut = await sectioned("seven/cut-shaft.dxf", []);

    // A hole in the back face, seen through the part from the front; and a taper.
    const hidden = await draw({
      code: [
        "from build123d import *",
        "with BuildPart() as b:",
        "    Box(60, 40, 30)",
        "    with Locations(Location((10, 20, 0), (90, 0, 0))):",
        "        Hole(radius=3, depth=10)",
        'show(b.part, name="Block")',
      ].join("\n"),
      scale: "1:1",
      views: [{ view: "front" }],
      outputs: [{ path: "seven/hidden.dxf" }],
    });
    const taper = await draw({
      code: "from build123d import *\nshow(Cone(20, 10, 40), name='Taper')",
      scale: "1:1",
      views: [{ view: "front" }],
      outputs: [{ path: "seven/taper.dxf" }],
    });

    const block =
      "from build123d import *\nshow(Box(60, 40, 30), name='Block')";
    const backed = (path: string, views: string[]) =>
      draw({
        code: block,
        sheet: "A3",
        scale: "1:2",
        projection: "third",
        views: views.map((view) => ({ view })),
        outputs: [{ path }],
      });
    const alone = await backed("seven/back-alone.dxf", [
      "front",
      "top",
      "back",
    ]);
    const beside = await backed("seven/back-beside.dxf", [
      "front",
      "top",
      "right",
      "back",
    ]);

    const arm = [
      "from build123d import *",
      "import math",
      "with BuildPart() as b:",
      "    Box(100, 40, 10, align=(Align.MIN, Align.CENTER, Align.MIN))",
      "    with Locations(Location((100, 0, 0), (0, -30, 0))):",
      "        Box(60, 40, 10, align=(Align.MIN, Align.CENTER, Align.MIN))",
      "    face = b.faces().filter_by(lambda f: abs(f.normal_at().Z - math.cos(math.radians(30))) < 1e-6).sort_by(Axis.Z)[-1]",
      "    with Locations(Plane(face)):",
      "        with Locations((0, -10), (0, 10)):",
      "            Hole(radius=4)",
      'show(b.part, name="Arm")',
    ].join("\n");
    const auxiliary = await draw({
      code: arm,
      sheet: "A3",
      views: [
        { view: "front" },
        { auxiliary: "A", direction: [0.5, 0, -0.866025] },
      ],
      outputs: [{ path: "seven/arm.dxf" }],
    });

    // A cross hole seen at 45°, an ellipse just inside the detail's circle.
    const spindle = [
      "from build123d import *",
      "pts = [(5, 0), (20, 0), (20, 12), (12.5, 12), (12.5, 40), (11.5, 40), (11.5, 42), (12.5, 42), (12.5, 70), (10, 70), (10, 95), (5, 95)]",
      "with BuildPart() as s:",
      "    with BuildSketch(Plane.XZ):",
      "        Polygon(*pts, align=None)",
      "    revolve(axis=Axis.Z)",
      "    chamfer(s.edges().filter_by(GeomType.CIRCLE).group_by(Axis.Z)[-1].sort_by(SortBy.RADIUS)[-1], length=1)",
      "    with Locations(Location((0, 30, 55), (90, 0, 0))):",
      "        Hole(radius=3, depth=60)",
      'show(s.part, name="Spindle")',
    ].join("\n");
    const detailed = await draw({
      code: spindle,
      sheet: "A3",
      scale: "2:1",
      projection: "first",
      views: [
        { detail: "D", of: "B", at: [12, 0, 40], radius: 1.2, scale: 4 },
        { detail: "B", of: "A", at: [12, 0, 41], radius: 5, scale: 2 },
        { section: "A", looking: "front", through: [0, 0, 0] },
        { view: "top" },
        { auxiliary: "C", direction: [1, 1, 0] },
        { detail: "E", of: "C", at: [0, 0, 55], radius: 6 },
      ],
      dimensions: [
        { view: "D", kind: "length", from: [11.5, 0, 40], to: [12.5, 0, 40] },
      ],
      outputs: [{ path: "seven/spindle.dxf" }],
    });

    for (const result of [
      cover,
      whole,
      allCut,
      hidden,
      taper,
      alone,
      beside,
      auxiliary,
      detailed,
    ])
      expect(result.isError, text(result)).toBeUndefined();

    const checked = await build({
      code: [
        "import math",
        "import sys",
        "import ezdxf",
        "from build123d import Box",
        "def space(path):",
        "    return ezdxf.readfile(path).modelspace()",
        "def segments(path, layers):",
        "    found = []",
        "    for e in space(path):",
        "        if e.dxf.layer not in layers:",
        "            continue",
        "        if e.dxftype() == 'LWPOLYLINE':",
        "            points = [(p[0], p[1]) for p in e.get_points()]",
        "        elif e.dxftype() in ('ARC', 'CIRCLE'):",
        "            points = [(p.x, p.y) for p in e.flattening(0.05)]",
        "        else:",
        "            continue",
        "        found += list(zip(points, points[1:]))",
        "    return found",
        // The cutting profile: its outline and the holes' narrowest circles, nothing of the countersinks or chamfer.
        "cut = space('seven/cut.dxf')",
        "radii = sorted(round(c.dxf.radius, 2) for c in cut.query('CIRCLE'))",
        "xs = [p[0] for e in cut.query('LWPOLYLINE') for p in e.get_points()]",
        "ys = [p[1] for e in cut.query('LWPOLYLINE') for p in e.get_points()]",
        "print('profile circles', radii, 'outline', round(max(xs) - min(xs), 2), 'by', round(max(ys) - min(ys), 2), 'arcs', len(cut.query('ARC')))",
        // Hatch strokes whose middle lies inside the shaft, between its two long edges in the section.
        "def hatched_in_shaft(path):",
        "    long = [s for s in segments(path, ('VISIBLE',)) if abs(s[0][1] - s[1][1]) < 1e-6 and abs(s[0][0] - s[1][0]) > 60]",
        "    bands = [(min(a[0][0], a[1][0]), max(a[0][0], a[1][0]), min(a[0][1], b[0][1]), max(a[0][1], b[0][1])) for a in long for b in long if abs(abs(a[0][1] - b[0][1]) - 20) < 1e-3 and abs(min(a[0][0], a[1][0]) - min(b[0][0], b[1][0])) < 1e-3]",
        "    middles = [((a[0] + b[0]) / 2, (a[1] + b[1]) / 2) for a, b in segments(path, ('HATCH',))]",
        "    return sum(1 for x, y in middles if any(l < x < r and lo + 1e-3 < y < hi - 1e-3 for l, r, lo, hi in bands))",
        "print('shaft hatched uncut', hatched_in_shaft('seven/whole.dxf'), 'cut', hatched_in_shaft('seven/cut-shaft.dxf'))",
        // Under the section: its dimension line, then its name, the lowest lettering there.
        "hatches = segments('seven/whole.dxf', ('HATCH',))",
        "left, right = min(p[0] for s in hatches for p in s) - 40, max(p[0] for s in hatches for p in s) + 40",
        "floor = min(p[1] for s in hatches for p in s)",
        "under = lambda s: all(left < p[0] < right and p[1] < floor for p in s)",
        "dimension_line = min(s[0][1] for s in segments('seven/whole.dxf', ('THIN',)) if under(s) and abs(s[0][1] - s[1][1]) < 1e-6 and abs(s[0][0] - s[1][0]) > 30)",
        // The dimension's number stands above its line; only the name can reach below it.
        "lowest_letter = min(p[1] for s in segments('seven/whole.dxf', ('TEXT',)) if under(s) for p in s)",
        "print('section name below its dimension', lowest_letter < dimension_line)",
        "near_three = lambda e: abs(e.dxf.radius - 3) < 1e-6",
        "hidden_space = space('seven/hidden.dxf')",
        "print('hidden hole circles', sum(map(near_three, hidden_space.query('CIRCLE[layer==\"HIDDEN\"]'))), 'arcs', sum(map(near_three, hidden_space.query('ARC[layer==\"HIDDEN\"]'))))",
        "axes = [s for s in segments('seven/taper.dxf', ('CENTRE',)) if abs(s[0][0] - s[1][0]) < 1e-6 and abs(s[0][1] - s[1][1]) > 40]",
        "print('taper axis', len(axes) > 0)",
        "strokes = lambda path: len(segments(path, ('TEXT',)))",
        "print('back view lettered more alone', strokes('seven/back-alone.dxf') > strokes('seven/back-beside.dxf'))",
        // The auxiliary arrow, carried on, meets the arm's inclined top edge: it points at the face it looks at.
        "arrow = next(iter(space('seven/arm.dxf').query('SOLID')))",
        "tip = (arrow.dxf.vtx0.x, arrow.dxf.vtx0.y)",
        "base = ((arrow.dxf.vtx1.x + arrow.dxf.vtx2.x) / 2, (arrow.dxf.vtx1.y + arrow.dxf.vtx2.y) / 2)",
        "ux, uy = tip[0] - base[0], tip[1] - base[1]",
        "n = math.hypot(ux, uy)",
        "ux, uy = ux / n, uy / n",
        "print('arrow looks', round(ux, 3), round(uy, 3))",
        "inclined = [s for s in segments('seven/arm.dxf', ('VISIBLE',)) if abs(math.degrees(math.atan2(s[1][1] - s[0][1], s[1][0] - s[0][0])) % 180 - 30) < 0.5]",
        "def meets(s):",
        "    (ax, ay), (bx, by) = s",
        "    dx, dy = bx - ax, by - ay",
        "    det = dx * uy - dy * ux",
        "    if abs(det) < 1e-12: return False",
        "    t = ((ay - tip[1]) * dx - (ax - tip[0]) * dy) / det",
        "    s_ = ((ay - tip[1]) * ux - (ax - tip[0]) * uy) / det",
        "    return t > 0 and 0 <= s_ <= 1",
        "top_edge = max(inclined, key=lambda s: s[0][1] + s[1][1])",
        "print('arrow meets the inclined face', meets(top_edge))",
        // The detail's letter: its strokes near the detail's circle on view C, and the clear paper between them
        // and the part's lines, less half a visible line's 0.5 mm width and half the lettering's 0.25 mm.
        "def apart(p, q, r, s):",
        "    def to(pt, a, b):",
        "        dx, dy = b[0] - a[0], b[1] - a[1]",
        "        t = max(0.0, min(1.0, ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / ((dx * dx + dy * dy) or 1e-18)))",
        "        return math.hypot(a[0] + t * dx - pt[0], a[1] + t * dy - pt[1])",
        "    return min(to(p, r, s), to(q, r, s), to(r, p, q), to(s, p, q))",
        "spindle = space('seven/spindle.dxf')",
        "mark = next(c for c in spindle.query('CIRCLE[layer==\"THIN\"]') if abs(c.dxf.radius - 12) < 1e-6)",
        "cx, cy = mark.dxf.center.x, mark.dxf.center.y",
        "letter = [s for s in segments('seven/spindle.dxf', ('TEXT',)) if all(math.hypot(p[0] - cx, p[1] - cy) < 30 for p in s)]",
        "part = [s for s in segments('seven/spindle.dxf', ('VISIBLE', 'HIDDEN', 'CENTRE')) if min(math.hypot(p[0] - cx, p[1] - cy) for p in s) < 80]",
        "clear = min(apart(a, b, c, d) for a, b in letter for c, d in part) - 0.375",
        "print('detail letter strokes', len(letter) > 0, 'clear paper', 'under 1 mm' if clear < 0.99 else 'at least 1 mm')",
        "show(Box(1, 1, 1), name='Check')",
      ].join("\n"),
    });
    const said = text(checked);
    expect(said).toContain(
      "profile circles [1.7, 1.7, 1.7, 1.7] outline 80.0 by 50.0 arcs 0",
    );
    expect(said).toMatch(/shaft hatched uncut 0 cut [1-9]\d*/);
    expect(said).toContain("section name below its dimension True");
    expect(said).toContain("hidden hole circles 1 arcs 0");
    expect(said).toContain("taper axis True");
    expect(said).toContain("back view lettered more alone True");
    expect(said).toContain("arrow looks 0.5 -0.866");
    expect(said).toContain("arrow meets the inclined face True");
    expect(said).toContain(
      "detail letter strokes True clear paper at least 1 mm",
    );
  }, 300_000);

  it("leads a hole's leader out of its view rather than across it", async () => {
    const frame = await draw({
      code: [
        "from build123d import *",
        "outer = Box(1500, 600, 60) - Box(1380, 480, 60)",
        "frame = outer + Pos(-250, 0, 0) * Box(60, 480, 60) + Pos(250, 0, 0) * Box(60, 480, 60)",
        "for x in (-690, 690):",
        "    for y in (-240, 240):",
        "        frame = frame + Pos(x, y, -35) * Box(120, 120, 10)",
        "        frame = frame - Pos(x + (40 if x > 0 else -40), y + (40 if y > 0 else -40), -35) * Cylinder(7, 10)",
        'show(frame, name="Frame")',
      ].join("\n"),
      sheet: "A3",
      projection: "first",
      views: [
        { view: "front" },
        { view: "top" },
        { view: "right" },
        { view: "iso" },
      ],
      dimensions: [
        ...[
          [-750, -300, 30, 750, -300, 30],
          [-750, -300, 30, -750, 300, 30],
          [-730, -280, -40, 730, -280, -40],
          [-730, -280, -40, -730, 280, -40],
          [-280, -240, 30, 280, -240, 30],
        ].map(([x1, y1, z1, x2, y2, z2]) => ({
          view: "top",
          kind: "length",
          from: [x1, y1, z1],
          to: [x2, y2, z2],
        })),
        { view: "top", kind: "diameter", at: [737, 280, -40], all: true },
        ...[
          [-750, 0, 30, -750, 0, -30],
          [-750, 0, -40, -630, 0, -40],
          [750, 0, -40, 750, 0, 30],
        ].map(([x1, y1, z1, x2, y2, z2]) => ({
          view: "front",
          kind: "length",
          from: [x1, y1, z1],
          to: [x2, y2, z2],
        })),
      ],
      outputs: [{ path: "leader/frame.dxf" }],
    });
    expect(frame.isError, text(frame)).toBeUndefined();
    // Two holes and two dowels, where a hole's way out past the plate's
    // corner is as clear as the short way, but runs across the plate.
    const plate = await draw({
      code: [
        "from build123d import *",
        "with BuildPart() as half:",
        "    Box(50, 60, 10, align=(Align.MIN, Align.CENTER, Align.MIN))",
        "    with Locations((0, 20, 10), (0, -20, 10)):",
        "        Hole(radius=4)",
        "    with Locations((35, 0, 10)):",
        "        Cylinder(4, 12, align=(Align.CENTER, Align.CENTER, Align.MIN))",
        "    mirror(about=Plane.YZ)",
        'show(half.part, name="Plate")',
      ].join("\n"),
      sheet: "A4",
      views: [{ view: "top" }],
      dimensions: [
        { view: "top", kind: "diameter", at: [4, 20, 10], all: true },
        { view: "top", kind: "diameter", at: [39, 0, 22], all: true },
      ],
      outputs: [{ path: "leader/plate.dxf" }],
    });
    expect(plate.isError, text(plate)).toBeUndefined();

    const checked = await build({
      code: [
        "import math",
        "import sys",
        "import ezdxf",
        "from build123d import Box",
        "def side(p, q, r):",
        "    return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])",
        "def crosses(a, b, c, d):",
        "    return side(c, d, a) * side(c, d, b) < -1e-12 and side(a, b, c) * side(a, b, d) < -1e-12",
        "def near(p, a, b):",
        "    dx, dy = b[0] - a[0], b[1] - a[1]",
        "    t = max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / ((dx * dx + dy * dy) or 1e-18)))",
        "    return math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]) < 0.5",
        "for path in sys.argv[1:]:",
        "    space = ezdxf.readfile(path).modelspace()",
        '    circles = [(c.dxf.center.x, c.dxf.center.y, c.dxf.radius) for c in space.query(\'CIRCLE[layer=="VISIBLE" | layer=="HIDDEN"]\')]',
        "    edges, corners = [], []",
        "    for e in space.query('LWPOLYLINE[layer==\"VISIBLE\"]'):",
        "        points = [(p[0], p[1]) for p in e.get_points()]",
        "        edges += list(zip(points, points[1:]))",
        "        corners += [points[0], points[-1]]",
        // A leader is a thin line that starts on a hole's circle.
        "    for e in space.query('LWPOLYLINE[layer==\"THIN\"]'):",
        "        points = [(p[0], p[1]) for p in e.get_points()]",
        "        if any(abs(math.hypot(points[0][0] - x, points[0][1] - y) - r) < 0.05 for x, y, r in circles):",
        "            crossed = sum(crosses(a, b, c, d) for a, b in zip(points, points[1:]) for c, d in edges)",
        "            cornered = sum(near(q, a, b) for a, b in zip(points, points[1:]) for q in corners)",
        "            print(path, 'leader crosses edges', crossed, 'passes corners', cornered)",
        "show(Box(1, 1, 1), name='Check')",
      ].join("\n"),
      arguments: ["leader/frame.dxf", "leader/plate.dxf"],
    });
    // Leaving the part once is allowed; the hole lies under the frame's tube, so it need not.
    expect(text(checked)).toMatch(
      /leader\/frame.dxf leader crosses edges [01] /,
    );
    expect(text(checked)).not.toMatch(/leader crosses edges ([2-9]|\d\d)/);
    // The plate's two leaders each leave it across one edge, by no corner.
    expect(
      text(checked).match(
        /leader\/plate.dxf leader crosses edges \d+ passes corners \d+/g,
      ),
    ).toEqual([
      "leader/plate.dxf leader crosses edges 1 passes corners 0",
      "leader/plate.dxf leader crosses edges 1 passes corners 0",
    ]);
  }, 180_000);

  it("explains an empty builder and a list shown under one name", async () => {
    const empty = await build({
      code: "from build123d import *\nwith BuildPart() as p:\n    pass\nshow(p)",
    });
    const listed = await build({
      code: "from build123d import *\nshow([Box(1, 1, 1), Pos(5, 0, 0) * Box(1, 1, 1)], name='Pair')",
    });

    expect(text(empty)).toContain("built nothing");
    expect(text(listed)).toContain("Pair 1");
    expect(text(listed)).toContain("Pair 2");
  }, 120_000);

  it("sets a section level with the view it looks as, and in the place of one not drawn", async () => {
    const plate = [
      "from build123d import *",
      "with BuildPart() as p:",
      "    Box(80, 40, 10)",
      "    Hole(radius=5)",
      'show(p.part, name="Plate")',
    ].join("\n");
    const level = await draw({
      code: plate,
      scale: "1:1",
      views: [
        { view: "front" },
        { view: "top" },
        { view: "iso" },
        { section: "A", looking: "front", through: [0, 0, 0] },
      ],
      outputs: [{ path: "aligned/level.dxf" }],
    });
    const under = await draw({
      code: plate,
      scale: "1:1",
      views: [
        { view: "front" },
        { section: "B", looking: "top", through: [0, 0, 0] },
      ],
      outputs: [{ path: "aligned/under.dxf" }],
    });
    expect(level.isError, text(level)).toBeUndefined();
    expect(under.isError, text(under)).toBeUndefined();

    // The section's hatched faces against the front view's outline: the
    // visible lines left of the hatch, in its band of the sheet.
    const checked = await build({
      code: [
        "import ezdxf",
        "from build123d import Box",
        "def bounds(points):",
        "    xs, ys = [p[0] for p in points], [p[1] for p in points]",
        "    return min(xs), min(ys), max(xs), max(ys)",
        "def points(space, layer):",
        "    return [(p[0], p[1]) for e in space.query(f'LWPOLYLINE[layer==\"{layer}\"]') for p in e.get_points()]",
        "level = ezdxf.readfile('aligned/level.dxf').modelspace()",
        "hatch = bounds(points(level, 'HATCH'))",
        "front = bounds([p for p in points(level, 'VISIBLE') if p[0] < hatch[0] - 5 and hatch[1] - 5 <= p[1] <= hatch[3] + 5])",
        "print('level', round(front[1] - hatch[1], 2), round(front[3] - hatch[3], 2))",
        "under = ezdxf.readfile('aligned/under.dxf').modelspace()",
        "hatch = bounds(points(under, 'HATCH'))",
        "front = bounds([p for p in points(under, 'VISIBLE') if p[1] > hatch[3] + 5])",
        "print('under', round((front[0] + front[2]) / 2 - (hatch[0] + hatch[2]) / 2, 2), front[1] > hatch[3])",
        "show(Box(1, 1, 1), name='Check')",
      ].join("\n"),
    });

    // Level: the section's top and bottom are the front's, to the hundredth of a millimetre.
    expect(text(checked)).toContain("level 0.0 0.0");
    // Under: the plan-like section is centred under the front, as a top view would be.
    expect(text(checked)).toContain("under 0.0 True");
  }, 180_000);

  it("cannot change the workspace or reach the internet from the script", async () => {
    await writeFile(join(root, "kept.txt"), "the person's");

    const result = await build({
      code: [
        "import socket, pathlib",
        "outcomes = []",
        "try:",
        "    pathlib.Path('kept.txt').write_text('changed')",
        "    outcomes.append('wrote')",
        "except OSError:",
        "    outcomes.append('no write')",
        "try:",
        "    socket.create_connection(('pypi.org', 443), timeout=5)",
        "    outcomes.append('online')",
        "except OSError:",
        "    outcomes.append('offline')",
        "print(' '.join(outcomes))",
        "from build123d import *",
        "show(Box(1, 1, 1))",
      ].join("\n"),
    });

    expect(text(result)).toContain(
      "What the script printed:\nno write offline",
    );
    expect(await readFile(join(root, "kept.txt"), "utf8")).toBe("the person's");
  }, 120_000);
});

describe.skipIf(!python)(
  "drawing a scene's lines with the real drafting",
  () => {
    let root: string;
    let draw: (args: Record<string, unknown>) => Promise<Result>;
    let build: (args: Record<string, unknown>) => Promise<Result>;
    const text = (result: Result) => result.content[0]?.text ?? "";
    /** A ring modelled with `sides` sides, as Line Art gives its outline: one stroke back to its start. */
    const ring = (cx: number, cy: number, r: number, sides: number) =>
      Array.from({ length: sides + 1 }, (_, i) => [
        cx + r * Math.cos((2 * Math.PI * i) / sides),
        cy + r * Math.sin((2 * Math.PI * i) / sides),
      ]);
    // A 100 mm square seen from the top, as Line Art strokes it: round and on
    // past its first corner, its far edge found again behind it, a line behind
    // it across the middle, a ring of 12 sides and one of 6.
    const lines = {
      names: ["Board"],
      centre: [0, 0, 0],
      views: {
        top: {
          look: [0, 0, -1],
          up: [0, 1, 0],
          lines: [
            [
              "visible",
              [
                [-50, -50],
                [50, -50],
                [50, 50],
                [-50, 50],
                [-50, -50],
                [50, -50],
              ],
            ],
            [
              "hidden",
              [
                [-50, 50],
                [50, 50],
              ],
            ],
            [
              "hidden",
              [
                [0, -40],
                [0, 40],
              ],
            ],
            ["visible", ring(20, 0, 10, 12)],
            ["visible", ring(-25, 0, 10, 6)],
          ],
          cut: [],
          facing: null,
        },
        // Seen from the front: a round top's edge and its chamfer's, 5 mm
        // apart, and a flat into a fillet of 50 mm and on 5 mm straight.
        front: {
          look: [0, 1, 0],
          up: [0, 0, 1],
          lines: [
            ["visible", ring(0, 0, 600, 64)],
            ["visible", ring(0, 0, 595, 64)],
            [
              "visible",
              [
                [-1000, -50],
                ...Array.from({ length: 9 }, (_, i) => [
                  -900 + 50 * Math.cos(-Math.PI / 2 + (Math.PI / 2) * (i / 8)),
                  50 * Math.sin(-Math.PI / 2 + (Math.PI / 2) * (i / 8)),
                ]),
                [-850, 5],
              ],
            ],
          ],
          cut: [],
          facing: null,
        },
        // A section with nothing cut: as Blender gives one whose plane
        // misses every object, or cuts only those it leaves whole.
        A: {
          look: [0, 1, 0],
          up: [0, 0, 1],
          lines: [
            [
              "visible",
              [
                [-50, 0],
                [50, 0],
              ],
            ],
          ],
          cut: [],
          facing: null,
        },
      },
    };
    /** Says how many circles and lines a view's DXF holds, and how long the sheet's hidden lines are. */
    const counted = [
      "import ezdxf, math",
      "from build123d import Box",
      "view = ezdxf.readfile('scene/top.dxf').modelspace()",
      "print('circles', len(view.query('CIRCLE')), 'lines', len(view.query('LWPOLYLINE')))",
      "sheet = ezdxf.readfile('scene/sheet.dxf').modelspace()",
      "hidden = 0.0",
      "for line in sheet.query('LWPOLYLINE[layer==\"HIDDEN\"]'):",
      "    points = [(p[0], p[1]) for p in line.get_points()]",
      "    hidden += sum(math.dist(a, b) for a, b in zip(points, points[1:]))",
      "print('hidden', round(hidden, 1))",
      "show(Box(1, 1, 1), name='Check')",
    ].join("\n");

    beforeAll(async () => {
      root = await folders.make("zhiyin-real-cad-scene-");
      const data = await folders.make("zhiyin-real-cad-scene-data-");
      const tools = cadAutomation(await confinedPython(), {
        workspaceRoot: () => root,
        harness,
        directory: join(data, "cad-studio"),
        sceneLines: {
          installed: async () => true,
          open: async () => "board.blend",
          lines: async () => ({ ok: true, lines: JSON.stringify(lines) }),
        },
      });
      const call = (name: string) => async (args: Record<string, unknown>) => {
        const asked = await tools.inspect(name, args);
        if (!asked.ok) throw new Error(asked.reason);
        return (await tools.callTool(
          name,
          args,
          undefined,
          asked.identity,
        )) as Result;
      };
      draw = call("cad_draw");
      build = call("cad_build");
    }, 30_000);

    it("joins what Line Art finds twice, leaves out what is behind what is seen, and reads a ring of 12 sides or more as a circle", async () => {
      const drawn = await draw({
        scene: true,
        views: [{ view: "top" }],
        scale: "1:1",
        dimensions: [
          {
            view: "top",
            kind: "length",
            from: [-50, -50, 0],
            to: [50, -50, 0],
          },
          { view: "top", kind: "diameter", at: [30, 0, 0] },
        ],
        outputs: [
          { path: "scene/top.dxf", view: "top" },
          { path: "scene/sheet.dxf" },
        ],
      });
      const checked = await build({ code: counted });

      expect(drawn.isError, text(drawn)).toBeUndefined();
      expect(text(drawn)).toContain("Dimensions on top: 100, Ø20.");
      // The square's four sides once each, the hexagon's six, the ring one circle.
      expect(text(checked)).toContain("circles 1 lines 10");
      // Only the line across the middle is behind: the far edge lies under what is seen.
      expect(text(checked)).toContain("hidden 80.0");
    }, 120_000);

    it("says why a section shows no cut: the plane misses the objects, or cuts only those it leaves whole", async () => {
      const section = (uncut?: string[]) =>
        draw({
          scene: true,
          views: [
            {
              section: "A",
              looking: "front",
              through: [0, 0, 0],
              ...(uncut ? { uncut } : {}),
            },
          ],
          outputs: [{ path: "scene/uncut.pdf" }],
        });

      const beside = await section();
      const whole = await section(["Board"]);

      expect(beside.isError).toBe(true);
      expect(text(beside)).toContain(
        "section A's plane through (0, 0, 0) cuts no object: it lies beside them; put it through one",
      );
      expect(whole.isError).toBe(true);
      expect(text(whole)).toContain(
        "section A's plane through (0, 0, 0) cuts no object it does not leave whole; put it through another, or cut the ones it leaves whole",
      );
    }, 120_000);

    it("finds no circle on a ring of fewer than 12 sides", async () => {
      const drawn = await draw({
        scene: true,
        views: [{ view: "top" }],
        dimensions: [{ view: "top", kind: "diameter", at: [-15, 0, 0] }],
        outputs: [{ path: "scene/refused.pdf" }],
      });

      expect(drawn.isError).toBe(true);
      expect(text(drawn)).toContain("dimension 1");
      expect(text(drawn)).toContain("no circle of the top view passes within");
    }, 120_000);

    it("keeps round edges a chamfer apart as two circles, and a fillet's radius beside a short flat", async () => {
      const drawn = await draw({
        scene: true,
        views: [{ view: "front" }],
        dimensions: [
          { view: "front", kind: "diameter", at: [600, 0, 0], expect: 1200 },
          { view: "front", kind: "diameter", at: [595, 0, 0], expect: 1190 },
          {
            view: "front",
            kind: "radius",
            at: [-900 + 50 * Math.SQRT1_2, 0, -50 * Math.SQRT1_2],
            expect: 50,
          },
        ],
        outputs: [{ path: "scene/front.pdf" }],
      });

      expect(drawn.isError, text(drawn)).toBeUndefined();
      expect(text(drawn)).toContain("Dimensions on front: Ø1200, Ø1190, R50.");
    }, 120_000);
  },
);

describe.skipIf(!python)("drawing a busy scene with the real drafting", () => {
  let root: string;
  let given: unknown;
  let draw: (args: Record<string, unknown>) => Promise<Result>;
  /** Draws with only `ms` for the drawing, as a slower machine or a larger scene would leave. */
  let drawIn: (
    ms: number,
  ) => (args: Record<string, unknown>) => Promise<Result>;
  const text = (result: Result) => result.content[0]?.text ?? "";
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

  beforeAll(async () => {
    root = await folders.make("zhiyin-real-cad-busy-");
    const data = await folders.make("zhiyin-real-cad-busy-data-");
    const confined = await confinedPython();
    drawIn = (ms) => {
      const tools = cadAutomation(confined, {
        workspaceRoot: () => root,
        harness,
        directory: join(data, "cad-studio"),
        buildTimeMs: ms,
        sceneLines: {
          installed: async () => true,
          open: async () => "engine.blend",
          lines: async () => ({ ok: true, lines: JSON.stringify(given) }),
        },
      });
      return async (args) => {
        const asked = await tools.inspect("cad_draw", args);
        if (!asked.ok) throw new Error(asked.reason);
        return (await tools.callTool(
          "cad_draw",
          args,
          undefined,
          asked.identity,
        )) as Result;
      };
    };
    draw = drawIn(60_000);
  }, 30_000);

  /** A rectangle `across` by `up` mm round the view's middle, as one stroke. */
  const box = (across: number, up: number) => ({
    look: [0, 1, 0],
    up: [0, 0, 1],
    lines: [
      [
        "visible",
        [
          [-across / 2, -up / 2],
          [across / 2, -up / 2],
          [across / 2, up / 2],
          [-across / 2, up / 2],
          [-across / 2, -up / 2],
        ],
      ],
    ],
    cut: [],
    facing: null,
  });
  /** How many of a DXF's entities lie on its HIDDEN layer. */
  const hiddenIn = async (path: string) =>
    (await readFile(join(root, path), "utf8")).match(/\n\s*8\r?\nHIDDEN\r?\n/g)
      ?.length ?? 0;

  it("says how large each view is on the model, so its scale can be checked against the part", async () => {
    given = {
      names: ["Plate"],
      centre: [0, 0, 0],
      views: {
        front: box(100, 40),
        top: { ...box(100, 60), look: [0, 0, -1], up: [0, 1, 0] },
      },
    };

    const drawn = await draw({
      scene: true,
      views: [{ view: "front" }, { view: "top" }],
      outputs: [{ path: "busy/sizes.pdf" }],
    });

    expect(drawn.isError, text(drawn)).toBeUndefined();
    expect(text(drawn)).toContain(
      "Each view's size on the model, across by up: front view 100 × 40 mm, top view 100 × 60 mm.",
    );
  }, 120_000);

  it("names each view a failure inside the drafting came from", async () => {
    // Strokes with a point of one coordinate, which nothing checks before the drafting reads them.
    given = {
      names: ["Plate"],
      centre: [0, 0, 0],
      views: {
        front: box(100, 40),
        top: {
          ...box(100, 60),
          look: [0, 0, -1],
          up: [0, 1, 0],
          lines: [["visible", [[0, 0], [5, 0], [5, 5], [9]]]],
        },
        right: {
          ...box(60, 40),
          look: [-1, 0, 0],
          lines: [["visible", [[0, 0], [5, 0], [5, 5], [9]]]],
        },
      },
    };

    const drawn = await draw({
      scene: true,
      views: [{ view: "front" }, { view: "top" }, { view: "right" }],
      outputs: [{ path: "busy/failed.pdf" }],
    });

    expect(drawn.isError).toBe(true);
    expect(text(drawn)).toMatch(
      /the top view could not be drawn: [A-Za-z]+Error/,
    );
    expect(text(drawn)).toMatch(
      /the right view could not be drawn: [A-Za-z]+Error/,
    );
    expect(text(drawn)).not.toContain("front view could not");
  }, 120_000);

  it("steps the angled view down a scale, before the whole sheet, when only it keeps the views from fitting", async () => {
    // On A3 the front and top fit at 1:1 one above the other, and the
    // angled view, as large as the front, fits beside them only at 1:2.
    given = {
      names: ["Block"],
      centre: [0, 0, 0],
      views: {
        front: box(180, 100),
        top: { ...box(180, 80), look: [0, 0, -1], up: [0, 1, 0] },
        iso: { ...box(200, 150), look: [-1, 1, -1] },
      },
    };

    const drawn = await draw({
      scene: true,
      views: [{ view: "front" }, { view: "top" }, { view: "iso" }],
      outputs: [{ path: "busy/stepped.pdf" }],
    });

    expect(drawn.isError, text(drawn)).toBeUndefined();
    expect(text(drawn)).toContain(
      "Drew A3 landscape at 1:1, first-angle projection, in",
    );
    expect(text(drawn)).toContain(
      ": front view, top view and iso view at 1:2.",
    );
  }, 120_000);

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
