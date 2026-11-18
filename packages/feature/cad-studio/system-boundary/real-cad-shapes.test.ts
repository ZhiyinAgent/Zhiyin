/**
 * The shaping helpers, the surfaces a script names and the meshes written for
 * the 3D studio, against a real build123d: what a script given the helpers
 * builds, what the answer says of it, and what the .glb holds. Skipped unless
 * the CAD environment's Python is named, as the other real-CAD tests are:
 *
 *   $env:ZHIYIN_CAD_PYTHON = "…\cad\Scripts\python.exe"; npx vitest run --project system-boundary packages/feature/cad-studio
 */

import { execFile } from "node:child_process";
import { cp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CAD_MOTION_FORMAT,
  CAD_PART_EXTRAS,
  type CadMotionFile,
} from "@zhiyin/contract";
import { TemporaryFolders } from "@zhiyin/test-support";
import { cadAutomation } from "../src/index.js";
import { scriptHelpers } from "../src/script-helpers.js";
import { confinedPython, harness, python } from "./confined-cad-python.js";

type Result = {
  isError?: boolean;
  content: { type: string; text?: string }[];
};

type Gltf = {
  nodes: { name: string; mesh: number; matrix?: number[] }[];
  meshes: {
    name: string;
    extras?: Record<string, unknown>;
    primitives: {
      attributes: { POSITION: number };
      indices: number;
      material?: number;
    }[];
  }[];
  materials?: { name: string }[];
  accessors: {
    bufferView: number;
    count: number;
    min?: number[];
    max?: number[];
  }[];
  bufferViews: { byteOffset: number; byteLength: number }[];
};

const folders = new TemporaryFolders();

/** A .glb's description and its binary data. */
async function gltfOf(path: string) {
  const file = await readFile(path);
  const length = file.readUInt32LE(12);
  const json = JSON.parse(
    file.subarray(20, 20 + length).toString("utf8"),
  ) as Gltf;
  const binary = file.subarray(20 + length + 8);
  return { json, binary };
}

/** A node's mesh as points in the CAD's millimetres with z up, placed where the node puts it. */
function pointsOf(gltf: { json: Gltf; binary: Buffer }, nodeName: string) {
  const node = gltf.json.nodes.find((one) => one.name === nodeName)!;
  const mesh = gltf.json.meshes[node.mesh]!;
  const accessor =
    gltf.json.accessors[mesh.primitives[0]!.attributes.POSITION]!;
  const view = gltf.json.bufferViews[accessor.bufferView]!;
  const m = node.matrix ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const points: [number, number, number][] = [];
  for (let i = 0; i < accessor.count; i++) {
    const at = view.byteOffset + i * 12;
    const [x, y, z] = [0, 4, 8].map((k) => gltf.binary.readFloatLE(at + k)) as [
      number,
      number,
      number,
    ];
    // Column-major, as glTF writes a matrix; then y up back to z up, metres to mm.
    const wx = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
    const wy = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
    const wz = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!;
    points.push([wx * 1000, -wz * 1000, wy * 1000]);
  }
  return points;
}

/** How many of a mesh's edges border one triangle only, its points joined by place first. */
function openEdges(gltf: { json: Gltf; binary: Buffer }, meshName: string) {
  const mesh = gltf.json.meshes.find((one) => one.name === meshName)!;
  const positions =
    gltf.json.accessors[mesh.primitives[0]!.attributes.POSITION]!;
  const placeOf: string[] = [];
  const view = gltf.json.bufferViews[positions.bufferView]!;
  for (let i = 0; i < positions.count; i++) {
    const at = view.byteOffset + i * 12;
    placeOf.push(
      [0, 4, 8]
        .map((k) => Math.round(gltf.binary.readFloatLE(at + k) * 1e6))
        .join(","),
    );
  }
  const uses = new Map<string, number>();
  for (const primitive of mesh.primitives) {
    const indices = gltf.json.accessors[primitive.indices]!;
    const where = gltf.json.bufferViews[indices.bufferView]!;
    for (let t = 0; t < indices.count; t += 3) {
      const corner = [0, 1, 2].map(
        (k) =>
          placeOf[gltf.binary.readUInt32LE(where.byteOffset + (t + k) * 4)]!,
      );
      for (const [a, b] of [
        [corner[0], corner[1]],
        [corner[1], corner[2]],
        [corner[2], corner[0]],
      ] as const) {
        const key = a! < b! ? `${a}|${b}` : `${b}|${a}`;
        uses.set(key, (uses.get(key) ?? 0) + 1);
      }
    }
  }
  return [...uses.values()].filter((count) => count === 1).length;
}

describe.skipIf(!python)("shaping real parts with the helpers", () => {
  let root: string;
  let build: (args: Record<string, unknown>) => Promise<Result>;
  let draw: (args: Record<string, unknown>) => Promise<Result>;
  let lookUp: (args: Record<string, unknown>) => Promise<Result>;

  beforeAll(async () => {
    root = await folders.make("zhiyin-real-cad-shapes-");
    const data = await folders.make("zhiyin-real-cad-shapes-data-");
    const tools = cadAutomation(await confinedPython(), {
      workspaceRoot: () => root,
      harness,
      directory: join(data, "cad-studio"),
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
    lookUp = call("cad_api");
  }, 30_000);

  afterAll(() => folders.removeAll());

  const text = (result: Result) => result.content[0]?.text ?? "";

  /** A script that names where show and the helpers come from, as a person opening it reads. */
  const imported = [
    "from build123d import *",
    "from zhiyin_cad_helpers import *",
    "block = Box(40, 30, 6)",
    "plate = round_edges(block, block.edges().filter_by(Axis.Z), 3)",
    'show(plate, name="Plate")',
  ];

  it("builds a script that imports show and the helpers from zhiyin_cad_helpers", async () => {
    const result = await build({ code: imported.join("\n") });

    expect(result.isError, text(result)).toBeUndefined();
    expect(text(result)).toContain("Plate: a valid solid, 40 × 30 × 6 mm");
  }, 120_000);

  it("runs that script outside Zhiyin with the harness on Python's path, show printing each part", async () => {
    const script = join(root, "outside.py");
    await writeFile(script, imported.join("\n"));

    const { stdout } = await promisify(execFile)(python!, [script], {
      env: { ...process.env, PYTHONPATH: dirname(harness) },
      timeout: 120_000,
    });

    expect(stdout).toContain("show: Plate, 40 x 30 x 6 mm");
  }, 120_000);

  it("writes the helpers as one file beside a script, which then runs with nothing of Zhiyin's, saying what the build said", async () => {
    const folder = join(root, "kept");
    await mkdir(folder, { recursive: true });
    const script = join(folder, "thin.py");
    // A 2 mm plate cannot take a 3 mm round along its top edges: the helper rounds them by less.
    await writeFile(
      script,
      [
        "from build123d import *",
        "from zhiyin_cad_helpers import *",
        "block = Box(30, 20, 2)",
        "plate = round_edges(block, block.edges().group_by(Axis.Z)[-1], 3)",
        'show(plate, name="Thin")',
      ].join("\n"),
    );

    const built = await build({
      file: "kept/thin.py",
      exports: [{ path: "kept/zhiyin_cad_helpers.py" }],
    });
    expect(built.isError, text(built)).toBeUndefined();
    const said = /^- (round_edges: .*)$/m.exec(text(built))?.[1];
    expect(said, text(built)).toContain("not the 3 mm asked");

    const env = { ...process.env };
    delete env["PYTHONPATH"];
    const { stdout } = await promisify(execFile)(
      python!,
      ["-E", "-s", script],
      { cwd: folder, env, timeout: 120_000 },
    );
    expect(stdout).toContain(said);
    expect(stdout).toMatch(/show: Thin, 30 x 20 x 2 mm/);

    // Built again with the copy beside it, the build's own helpers still tell it what they did.
    const again = await build({ file: "kept/thin.py" });
    expect(again.isError, text(again)).toBeUndefined();
    expect(text(again)).toContain(said);
  }, 240_000);

  it("writes a part alone where the script placed it, turned as it was turned, each part a closed mesh", async () => {
    const result = await build({
      code: [
        "from build123d import *",
        'show(Pos(0, 0, 50) * Box(20, 40, 100), name="Tall")',
        'show(Box(20, 40, 100).moved(Location((100, 0, 50), (0, 0, 90))), name="Turned")',
        'show(fillet((Box(60, 40, 20) + Pos(0, 0, 15) * Cylinder(10, 20)).edges().filter_by(Axis.Z), 4), name="Rounded")',
      ].join("\n"),
      exports: [{ path: "alone.glb", parts: ["Tall"] }, { path: "all.glb" }],
    });

    expect(result.isError, text(result)).toBeUndefined();
    const alone = await gltfOf(join(root, "alone.glb"));
    const tall = pointsOf(alone, "Tall");
    const range = (axis: number) => [
      Math.min(...tall.map((p) => p[axis]!)),
      Math.max(...tall.map((p) => p[axis]!)),
    ];
    const rounded = (axis: number) => range(axis).map((v) => Math.round(v) + 0);
    expect(rounded(0)).toEqual([-10, 10]);
    expect(rounded(1)).toEqual([-20, 20]);
    expect(rounded(2)).toEqual([0, 100]);

    const all = await gltfOf(join(root, "all.glb"));
    const turned = pointsOf(all, "Turned");
    // Turned a quarter about z, its 40 mm side now runs along x.
    const across =
      Math.max(...turned.map((p) => p[0])) -
      Math.min(...turned.map((p) => p[0]));
    expect(Math.round(across)).toBe(40);
    for (const name of ["Tall", "Turned", "Rounded"])
      expect(openEdges(all, name), name).toBe(0);
  }, 120_000);

  it("gives each group of surfaces a script names a material of its own, and says the groups", async () => {
    const result = await build({
      code: [
        "from build123d import *",
        "part = Box(60, 40, 20) - Cylinder(8, 20)",
        "top = part.faces().sort_by(Axis.Z)[-1]",
        "bore = part.faces().filter_by(GeomType.CYLINDER)",
        'show(part, name="Block", surfaces={"machined": [top], "bore": bore})',
      ].join("\n"),
      exports: [{ path: "block.glb" }],
    });

    expect(result.isError, text(result)).toBeUndefined();
    expect(text(result)).toContain(
      "Surfaces named: machined (1 face), bore (1 face).",
    );
    const { json } = await gltfOf(join(root, "block.glb"));
    const mesh = json.meshes.find((one) => one.name === "Block")!;
    expect(json.materials?.map((one) => one.name)).toEqual([
      "machined",
      "bore",
    ]);
    expect(mesh.extras).toMatchObject({
      zhiyin_cad_part: "Block",
      zhiyin_surfaces: ["machined", "bore", ""],
    });
  }, 120_000);

  it("writes each part's exact size beside its mesh, which its facets only approach", async () => {
    const result = await build({
      code: [
        "from build123d import *",
        'show(Cylinder(40, 10), name="Disc")',
      ].join("\n"),
      exports: [{ path: "disc.glb" }],
    });

    expect(result.isError, text(result)).toBeUndefined();
    const { json } = await gltfOf(join(root, "disc.glb"));
    const mesh = json.meshes.find((one) => one.name === "Disc")!;
    const size = mesh.extras?.["zhiyin_cad_size"] as number[];
    [0.08, 0.08, 0.01].forEach((exact, index) =>
      expect(size[index]).toBeCloseTo(exact, 9),
    );
  }, 120_000);

  it("hands the 3D studio its parts and their motion in the contract's names", async () => {
    // Every field a motion file may hold. The compiler holds this list to the
    // contract's type, both ways.
    const motionFields = {
      motion: true,
      positions: true,
      parts: true,
      unfitted: true,
      still: true,
      straight: true,
    } satisfies Record<keyof CadMotionFile, true>;
    const mechanism = await build({
      code: [
        "import sys",
        "from build123d import *",
        "turn = float(sys.argv[1])",
        "base = Box(60, 40, 10)",
        'show(base, name="Base", surfaces={"machined": base.faces().sort_by(Axis.Z)[-1]})',
        'show(Rot(0, 0, turn) * Pos(0, 0, 20) * Box(30, 4, 4), name="Arm")',
      ].join("\n"),
      positions: [["0"], ["90"]],
      exports: [
        { path: "hand-off/parts.glb" },
        { path: "hand-off/motion.json" },
      ],
    });
    const sequence = await build({
      code: [
        "from build123d import *",
        'show(Box(60, 40, 10), name="Base")',
        'show(Pos(0, 0, 10) * Box(60, 40, 10), name="Lid")',
      ].join("\n"),
      explode: { stay: ["Base"] },
      exports: [{ path: "hand-off/sequence.json" }],
    });
    const { json } = await gltfOf(join(root, "hand-off", "parts.glb"));
    const extrasOf = (name: string) =>
      json.meshes.find((one) => one.name === name)!.extras!;
    const motion = JSON.parse(
      await readFile(join(root, "hand-off", "motion.json"), "utf8"),
    ) as Record<string, unknown>;
    const steps = JSON.parse(
      await readFile(join(root, "hand-off", "sequence.json"), "utf8"),
    ) as Record<string, unknown>;

    expect(mechanism.isError, text(mechanism)).toBeUndefined();
    expect(sequence.isError, text(sequence)).toBeUndefined();
    // A part with a group of surfaces carries every mark; one without, all but that.
    expect(Object.keys(extrasOf("Base")).sort()).toEqual(
      Object.values(CAD_PART_EXTRAS).sort(),
    );
    expect(Object.keys(extrasOf("Arm")).sort()).toEqual(
      [CAD_PART_EXTRAS.part, CAD_PART_EXTRAS.size].sort(),
    );
    expect(extrasOf("Base")).toMatchObject({
      [CAD_PART_EXTRAS.part]: "Base",
      [CAD_PART_EXTRAS.surfaces]: ["machined", ""],
    });
    expect(extrasOf("Arm")[CAD_PART_EXTRAS.size]).toHaveLength(3);
    // A mechanism's motion file, and an assembly sequence's, hold only the
    // contract's fields, every one a reader needs among them.
    for (const written of [motion, steps]) {
      expect(
        Object.keys(written).filter((key) => !(key in motionFields)),
      ).toEqual([]);
      expect(written).toMatchObject({
        motion: CAD_MOTION_FORMAT,
        positions: expect.any(Array),
        parts: expect.any(Object),
        unfitted: expect.any(Object),
        still: expect.any(Number),
      });
    }
    expect(motion["straight"]).toBeUndefined();
    expect(steps["straight"]).toBe(true);
    expect((motion["parts"] as CadMotionFile["parts"])["Arm"]).toHaveLength(2);
    for (const matrix of (motion["parts"] as CadMotionFile["parts"])["Arm"]!)
      expect(matrix).toHaveLength(16);
  }, 180_000);

  it("refuses surfaces that are not faces of the part shown", async () => {
    const result = await build({
      code: [
        "from build123d import *",
        "before = Box(60, 40, 20)",
        "after = before - Pos(25, 0, 10) * Box(20, 50, 10)",
        'show(after, name="Block", surfaces={"machined": before.faces().sort_by(Axis.Z)[-1]})',
      ].join("\n"),
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain(
      "Block: A face of the surfaces “machined” is not one of the part's",
    );
  }, 120_000);

  it("rounds what it can, leaves sharp what it cannot, and says which and where", async () => {
    const result = await build({
      code: [
        "from build123d import *",
        // A fin 0.6 mm thick, whose edges take no fillet of 1.5 mm, the least tried.
        "crowded = Box(60, 40, 20) + Pos(0, 0, 15) * Box(0.6, 30, 10)",
        'show(round_edges(crowded, crowded.edges(), 6), name="Tray")',
      ].join("\n"),
    });

    expect(result.isError, text(result)).toBeUndefined();
    expect(text(result)).toContain("Tray: a valid solid");
    expect(text(result)).toMatch(
      /What the helpers did:\n- round_edges: of 24 edges of the part, \d+ rounded by 6 mm; .*left sharp, as not even 1\.5 mm fits there: at \(/,
    );
  }, 120_000);

  it("rounds equal edges alike at the largest radius they all take, and tries down to the smallest before leaving an edge sharp", async () => {
    const result = await build({
      code: [
        "from build123d import *",
        "plate = Box(10, 10, 1)",
        'show(round_edges(plate, plate.edges().filter_by(Axis.Z), 30, smallest=1), name="Plate")',
        "tab = Box(1.2, 10, 5)",
        'show(Pos(30, 0, 0) * round_edges(tab, tab.edges().filter_by(Axis.Z).sort_by(Axis.X)[-1], 30, smallest=1), name="Tab")',
      ].join("\n"),
    });

    const said = text(result);
    expect(result.isError, said).toBeUndefined();
    // A 10 mm square takes no more than 5 mm at its four corners together.
    const plate =
      /round_edges: rounded 4 edges of the part by (\d+(?:\.\d+)?) mm, not the 30 mm asked, as the shape around them leaves no room for more\./.exec(
        said,
      );
    expect(plate, said).not.toBeNull();
    expect(Number(plate![1])).toBeGreaterThanOrEqual(3);
    expect(Number(plate![1])).toBeLessThanOrEqual(5);
    // A corner of a 1.2 mm tab takes at most 1.2 mm, and the smallest given, 1 mm, fits.
    const tab =
      /round_edges: rounded 1 edge of the part by (\d+(?:\.\d+)?) mm, not the 30 mm asked/.exec(
        said,
      );
    expect(tab, said).not.toBeNull();
    expect(Number(tab![1])).toBeGreaterThanOrEqual(1);
    expect(Number(tab![1])).toBeLessThanOrEqual(1.2);
    expect(said).not.toContain("left sharp");
  }, 120_000);

  it("builds a casting with a boss, a pad, a rib and bolts, a pipe, a hose and a belt, each a valid solid", async () => {
    const result = await build({
      code: [
        "from build123d import *",
        "body = cast(RectangleRounded(120, 80, 12), 40, draft=3, round=4)",
        "top = body.faces().sort_by(Axis.Z)[-1].center()",
        "body = boss(body, top, 24, 12, hole=10, root=3)",
        "body = rib(body, (-40, -39, 10), (40, -39, 10), 12, 5, direction=(0, -1, 0), root=2)",
        "body, bolts = bolt_row(body, (-45, 0, 40), (45, 0, 40), 2, 'M6', 16)",
        'show(body, name="Housing")',
        'show(bolts, name="Bolt")',
        'show(Pos(0, 0, 100) * pipe([(0, 0, 0), (100, 0, 0), (100, 80, 0)], 20, wall=2), name="Pipe")',
        "tube, clamps = hose(((0, 200, 0), (1, 0, 0)), ((150, 280, 40), (0, -1, 0)), 18)",
        'show(tube, name="Hose")',
        'show(clamps, name="Clamp")',
        'show(Pos(0, -300, 0) * belt([((0, 0, 0), 80), ((250, 120, 0), 50), ((-60, 200, 0), 45)], 22, 5), name="Belt")',
      ].join("\n"),
    });

    expect(result.isError, text(result)).toBeUndefined();
    for (const name of ["Housing", "Pipe", "Hose", "Clamp 1", "Belt"])
      expect(text(result)).toContain(`${name}: a valid solid`);
    expect(text(result)).toContain("Bolt 1 and Bolt 2, each: a valid solid");
    expect(text(result)).toContain(
      "bolts: 2 M6 hex bolts 16 mm long, holes of 6.6 mm cut.",
    );
    expect(text(result)).toMatch(
      /belt: \d+ mm long along its middle, wrapping the pulleys, in the order given, by \d+°, \d+°, \d+°\./,
    );
    expect(text(result)).toMatch(
      /Housing: .*Round holes: (2 of 6.6 mm, 1 of 10 mm|1 of 10 mm, 2 of 6.6 mm)./,
    );
  }, 180_000);

  it("bends a pipe no tighter than its own radius, which would fold it through itself, and says so", async () => {
    const result = await build({
      code: [
        "from build123d import *",
        'show(pipe([(0, 0, 0), (40, 0, 30), (80, 0, 30)], 32, bend=12), name="Elbow")',
      ].join("\n"),
      sections: [{ through: [0, 0, 0], looking: "front" }],
    });

    expect(result.isError, text(result)).toBeUndefined();
    expect(text(result)).toContain(
      "pipe: bent with a radius of 16.4 mm, not the 12 mm asked: a bend tighter than the pipe's radius, 16 mm, folds the pipe through itself.",
    );
    expect(text(result)).toContain("Below them, the section asked for");
    expect(text(result)).not.toContain("leaves out Elbow");
  }, 120_000);

  it("bends a short pipe as widely as its runs allow, and says so, rather than failing the script", async () => {
    const result = await build({
      code: [
        "from build123d import *",
        'show(pipe([(0, 0, 0), (0, 0, 20), (20, 0, 20)], 16), name="Bracket pipe")',
      ].join("\n"),
    });

    expect(result.isError, text(result)).toBeUndefined();
    expect(text(result)).toContain("Bracket pipe: a valid solid");
    // The default bend, 24 mm, needs 24 mm of straight on each side of the corner; the runs are 20.
    expect(text(result)).toContain(
      "pipe: bent with a radius of 20 mm at (0, 0, 20), not the 24 mm asked, as the runs either side leave no room for more.",
    );
  }, 120_000);

  it("leaves out a pipe whose corner has no room for a bend that does not fold it, saying how far apart its points must be, and the script goes on", async () => {
    const result = await build({
      code: [
        "from build123d import *",
        "tube = pipe([(0, 0, 0), (0, 0, 4), (40, 0, 4)], 16)",
        'print("pipe given:", tube)',
        'show(tube, name="Tube")',
        'show(Box(10, 10, 10), name="Block")',
      ].join("\n"),
    });

    expect(result.isError, text(result)).toBeUndefined();
    expect(text(result)).toContain("pipe given: None");
    expect(text(result)).toContain("Block: a valid solid");
    // Shown as it was given, the pipe left out is passed over, not a failure.
    expect(text(result)).toContain(
      "show() at line 4 of the script was given None for “Tube”, so nothing is shown there; a helper gives None where it could not build what was asked, and says why.",
    );
    expect(text(result)).not.toContain("Tube:");
    // 16 mm across, it bends no tighter than 8.2 mm, which a 90° corner takes 8.2 mm of each run for.
    expect(text(result)).toContain(
      "pipe: not built, as the corner at (0, 0, 4) has room for a bend of only 4 mm, and a pipe 16 mm across bends no tighter than 8.2 mm without folding through itself: the run from (0, 0, 0) to (0, 0, 4) is 4 mm and needs at least 8.2 mm.",
    );
  }, 120_000);

  it("lays a hose between two ports facing the same way in turns no tighter than itself, solid or hollow, however far apart", async () => {
    const section = (diameter: number, wall?: number) =>
      wall
        ? Math.PI * ((diameter / 2) ** 2 - (diameter / 2 - wall) ** 2)
        : Math.PI * (diameter / 2) ** 2;
    for (const gap of [100, 400])
      for (const wall of [undefined, 2]) {
        const result = await build({
          code: [
            "from build123d import *",
            `tube, clamps = hose(((0, 0, 0), (0, 0, 1)), ((${gap}, 0, 0), (0, 0, 1)), 24${wall ? `, wall=${wall}` : ""})`,
            'show(tube, name="Hose")',
          ].join("\n"),
        });
        const said = text(result);
        expect(result.isError, said).toBeUndefined();
        expect(said).toContain("Hose: a valid solid");
        const length = Number(/hose: (\d+) mm long/.exec(said)?.[1]);
        const tightest = Number(
          /its tightest bend (\d+(?:\.\d+)?) mm/.exec(said)?.[1],
        );
        const volume = Number(
          /Hose: .*Volume ([\d,]+) mm³/.exec(said)?.[1]?.replaceAll(",", ""),
        );
        // A tube folded through itself has less volume than its section along its length.
        expect(
          Math.abs(volume / (section(24, wall) * length) - 1),
          said,
        ).toBeLessThan(0.01);
        expect(tightest, said).toBeGreaterThanOrEqual(12);
      }
  }, 240_000);

  it("lays no hose between ports too close for it to turn without folding, saying how much further apart they must be, and the script goes on", async () => {
    const result = await build({
      code: [
        "from build123d import *",
        "tube, clamps = hose(((0, 0, 0), (0, 0, 1)), ((10, 0, 0), (0, 0, 1)), 24)",
        'print("hose given:", tube, len(clamps))',
        'show(Box(10, 10, 10), name="Block")',
      ].join("\n"),
    });

    const said = text(result);
    expect(result.isError, said).toBeUndefined();
    expect(said).toContain("hose given: None 0");
    expect(said).toContain("Block: a valid solid");
    expect(said).toMatch(
      /hose: not laid from \(0, 0, 0\) to \(10, 0, 0\), as a hose 24 mm across bends no tighter than 12\.3 mm without folding through itself, and between its ports it has room for a bend of only [\d.]+ mm: move them [\d.]+ mm further apart, or lead it round through via points\./,
    );
  }, 120_000);

  it("winds a coil spring with flat ends, light enough to put many in a scene, and refuses turns that cannot fit", async () => {
    const result = await build({
      code: [
        "from build123d import *",
        'show(coil(27, 3.2, 40, 6.5), name="Spring")',
      ].join("\n"),
      exports: [{ path: "spring.glb" }],
    });

    expect(result.isError, text(result)).toBeUndefined();
    expect(text(result)).toContain(
      "Spring: a valid solid, 27 × 27 × 40 mm, from (-13.5, -13.5, 0) to (13.5, 13.5, 40).",
    );
    expect(text(result)).toContain(
      "coil: 6.5 turns of 3.2 mm wire, 27 mm across and 40 mm long, its ends ground flat.",
    );
    // Round to the eye at a few tens of thousands of triangles, not hundreds.
    expect((await stat(join(root, "spring.glb"))).size).toBeLessThan(1_500_000);
    expect(openEdges(await gltfOf(join(root, "spring.glb")), "Spring")).toBe(0);

    // Beside a part a cut broke, which the script is run again for: the
    // spring kept from that run is meshed as lightly as on its own.
    const beside = await build({
      code: [
        "from build123d import *",
        'show(coil(27, 3.2, 40, 6.5), name="Spring")',
        "block = Pos(60, 0, 0) * Box(20, 20, 4)",
        "block -= Pos(60, 0, 0) * extrude(Polygon((0, 0), (10, 10), (10, 0), (0, 10), align=None), 5)",
        'show(block, name="Block")',
      ].join("\n"),
      exports: [{ path: "spring-beside.glb", parts: ["Spring"] }],
    });
    expect(beside.isError, text(beside)).toBeUndefined();
    expect(text(beside)).toContain("it would leave no valid solid");
    expect((await stat(join(root, "spring-beside.glb"))).size).toBe(
      (await stat(join(root, "spring.glb"))).size,
    );

    const crowded = await build({
      code: 'show(coil(27, 3.2, 20, 10), name="Spring")',
    });
    expect(crowded.isError).toBe(true);
    expect(text(crowded)).toContain(
      "10 turns of 3.2 mm wire run into each other in 20 mm: at most 5 fit, or make it longer.",
    );
  }, 180_000);

  it("meshes a .glb for viewing, finer for close-ups when asked, and keeps printing fineness for STL, saying how close each lies to the surface", async () => {
    // A grooved wheel with every edge rounded: hundreds of curved faces.
    const result = await build({
      code: [
        "from build123d import *",
        "wheel = Cylinder(80, 40)",
        "for r in (30, 45, 60):",
        "    wheel -= Pos(0, 0, 18) * (Cylinder(r + 4, 8) - Cylinder(r, 8))",
        "wheel = round_edges(wheel, wheel.edges(), 1.5)",
        'show(wheel, name="Wheel")',
      ].join("\n"),
      exports: [
        { path: "wheel.stl" },
        { path: "wheel.glb" },
        { path: "wheel-close.glb", detail: "close-up" },
      ],
    });

    expect(result.isError, text(result)).toBeUndefined();
    const triangles = async (file: string) => {
      const { json } = await gltfOf(join(root, file));
      return json.meshes
        .flatMap((mesh) => mesh.primitives)
        .reduce((sum, one) => sum + json.accessors[one.indices]!.count / 3, 0);
    };
    // A binary STL counts its triangles after an 80-byte header.
    const printed = (await readFile(join(root, "wheel.stl"))).readUInt32LE(80);
    const viewed = await triangles("wheel.glb");
    const close = await triangles("wheel-close.glb");
    expect(viewed).toBeLessThan(printed / 4);
    expect(close).toBeGreaterThan(viewed * 2);
    expect(close).toBeLessThan(printed);
    expect(text(result)).toMatch(
      /Wrote wheel\.stl \([^)]+\), meshed for printing, no facet more than 0\.02 mm from the surface, [\d,]+ triangles, closed: Wheel\./,
    );
    expect(text(result)).toMatch(
      /Wrote wheel\.glb \([^)]+\), meshed for viewing, no facet more than 0\.23 mm from the surface: Wheel\./,
    );
    expect(text(result)).toMatch(
      /Wrote wheel-close\.glb \([^)]+\), meshed for close-ups, no facet more than 0\.05 mm from the surface: Wheel\./,
    );
  }, 180_000);

  it("names the cut faces of a cutaway as their own surfaces", async () => {
    const result = await build({
      code: [
        "from build123d import *",
        "body = Box(80, 60, 40) - Cylinder(15, 40)",
        'show(cutaway(body, Pos(40, -30, 0) * Box(80, 60, 50)), name="Body")',
      ].join("\n"),
    });

    expect(result.isError, text(result)).toBeUndefined();
    expect(text(result)).toMatch(/Surfaces named: cut \(2 faces\)\./);
  }, 120_000);

  it("names the curved faces a round cutter leaves", async () => {
    const result = await build({
      code: [
        "from build123d import *",
        "body = Box(80, 60, 40) - Cylinder(15, 40)",
        'show(cutaway(body, Pos(40, 0, 0) * Cylinder(20, 50)), name="Body")',
      ].join("\n"),
    });

    expect(result.isError, text(result)).toBeUndefined();
    expect(text(result)).toMatch(/Surfaces named: cut \(1 face\)\./);
  }, 120_000);

  it("says where a part that is not valid goes wrong, and that the kernel's repair mends it", async () => {
    const result = await build({
      code: [
        "from build123d import *",
        "bow = Wire.make_polygon([(0, 0, 0), (40, 30, 0), (40, 0, 0), (0, 30, 0)], close=True)",
        'show(extrude(Face(bow), amount=10), name="Bow")',
      ].join("\n"),
    });

    expect(text(result)).toContain("Bow: not a valid solid");
    expect(text(result)).toMatch(
      /Where it goes wrong: a plane face at \(20, 15, -?\d+\), 40 × 30 × 0 mm across/,
    );
    expect(text(result)).toContain(
      "The kernel's repair makes it valid: part = part.fix()",
    );
  }, 120_000);

  it("tells a press fit from a part running into another by how deep they overlap", async () => {
    const result = await build({
      code: [
        "from build123d import *",
        'show(Box(100, 60, 40) - Cylinder(10, 40), name="Block")',
        'show(Cylinder(10.02, 50), name="Pin")',
        'show(Pos(40, 0, 25) * Box(30, 30, 30), name="Runner")',
      ].join("\n"),
    });

    expect(text(result)).toMatch(
      /Block and Pin overlap by [\d.]+ mm³, what they share 0\.02 mm thick, .*: as little as a press fit/,
    );
    expect(text(result)).toMatch(
      /Block and Runner overlap by 7,500 mm³, what they share 10 mm thick, .*: far deeper than a press fit/,
    );
  }, 120_000);

  it("tells a part shown twice, or lying wholly inside another, from a press fit by the thickness of what they share", async () => {
    const result = await build({
      code: [
        "from build123d import *",
        // The same pin shown twice in one place.
        'show(Cylinder(5, 20), name="Pin")',
        'show(Cylinder(5, 20), name="Copy")',
        // A 10 mm block inside one 10.2 mm across, a tenth of a millimetre from each of its faces.
        'show(Pos(100, 0, 0) * Box(10.2, 10.2, 10.2), name="Outer")',
        'show(Pos(100, 0, 0) * Box(10, 10, 10), name="Inner")',
        // Two plates, one sitting a millimetre down into the other.
        'show(Pos(-100, 0, 0) * Box(20, 20, 10), name="Lower")',
        'show(Pos(-100, 0, 9) * Box(20, 20, 10), name="Upper")',
      ].join("\n"),
    });

    expect(result.isError, text(result)).toBeUndefined();
    expect(text(result)).toMatch(
      /Pin and Copy overlap by 1,571 mm³, what they share 10 mm thick, .*: far deeper than a press fit/,
    );
    expect(text(result)).toMatch(
      /Outer and Inner overlap by 1,000 mm³, what they share 10 mm thick, .*: far deeper than a press fit/,
    );
    expect(text(result)).toMatch(
      /Lower and Upper overlap by 400 mm³, what they share 1 mm thick, .*: far deeper than a press fit/,
    );
    expect(text(result)).not.toContain("as little as a press fit");
  }, 120_000);

  it("imports the files at the workspace's top from code", async () => {
    await writeFile(join(root, "sizes.py"), "WIDTH = 42\n", "utf8");
    const result = await build({
      code: "from build123d import *\nimport sizes\nshow(Box(sizes.WIDTH, 10, 10), name='Bar')",
    });

    expect(result.isError, text(result)).toBeUndefined();
    expect(text(result)).toContain("Bar: a valid solid, 42 × 10 × 10 mm");
  }, 120_000);

  it("gives an arc round more than half its circle a diameter, and says a shorter one takes a radius", async () => {
    const ring = [
      "from build123d import *",
      "ring = Cylinder(40, 10) - Cylinder(30, 10)",
      "# A quarter cut away: the ring's edges are arcs round three quarters of their circles.",
      "ring = ring - Pos(25, 25, 0) * Box(50, 50, 20)",
      'show(ring, name="Clip")',
    ].join("\n");
    const measured = await draw({
      code: ring,
      views: [{ view: "top" }],
      dimensions: [
        { view: "top", kind: "diameter", at: [-40, 0, 5], expect: 80 },
      ],
      outputs: [{ path: "clip/clip.pdf" }],
    });
    expect(measured.isError, text(measured)).toBeUndefined();
    expect(text(measured)).toContain("Ø80");

    const quarter = await draw({
      code: "from build123d import *\nb = Box(60, 40, 10)\nshow(fillet(b.edges().filter_by(Axis.Z), 10), name='Plate')",
      views: [{ view: "top" }],
      // On the corner's round, R10 about (20, 10), halfway round it.
      dimensions: [{ view: "top", kind: "diameter", at: [27.07, 17.07, 5] }],
      outputs: [{ path: "clip/plate.pdf" }],
    });
    expect(quarter.isError).toBe(true);
    expect(text(quarter)).toContain(
      "only an arc of R10 round 90°, half its circle or less, which is given by its radius",
    );
  }, 180_000);

  it("looks up what the installed library accepts, and names what is near a name it lacks", async () => {
    const helper = await lookUp({ name: "round_edges" });
    expect(text(helper)).toMatch(
      /^round_edges\(part, edges, radius, smallest=None\): a helper given to scripts/,
    );

    // Every helper the tools name is one the harness gives.
    const helpers = text(await lookUp({ names: [...scriptHelpers] }));
    for (const name of scriptHelpers)
      expect(helpers).toMatch(
        new RegExp(`^${name}\\(.*\\): a helper given to scripts`, "m"),
      );

    const warehouse = await lookUp({
      name: "bd_warehouse.fastener.HexHeadScrew",
    });
    expect(text(warehouse)).toContain("bd_warehouse.fastener.HexHeadScrew");
    expect(text(warehouse)).toContain("Hex Head Screw");

    const misspelt = await lookUp({ name: "filet" });
    expect(text(misspelt)).toContain("Near it: fillet");

    // Several in one call, each answered in the order asked.
    const several = await lookUp({ names: ["coil", "filet", "round_edges"] });
    const answered = text(several);
    expect(answered).toMatch(/^coil\(diameter, wire, length, turns/);
    expect(answered).toContain("Nothing is named filet");
    expect(answered).toMatch(
      /\n\nround_edges\(part, edges, radius, smallest=None\): a helper/,
    );
    expect(answered.indexOf("Nothing is named filet")).toBeGreaterThan(
      answered.indexOf("coil("),
    );
  }, 120_000);
});

describe.skipIf(!python)(
  "looking up bd_warehouse where it cannot be imported",
  () => {
    afterAll(() => folders.removeAll());

    // The real harness, beside a bd_warehouse of its own that stands first on
    // its path, as a CAD environment from an older release lacks one or holds
    // one that breaks on import.
    async function lookUpWith(
      warehouse: Record<string, string>,
    ): Promise<(args: Record<string, unknown>) => Promise<string>> {
      const copy = await folders.make("zhiyin-real-cad-warehouse-");
      await cp(dirname(harness), copy, { recursive: true });
      await mkdir(join(copy, "bd_warehouse"));
      for (const [file, code] of Object.entries(warehouse))
        await writeFile(join(copy, "bd_warehouse", file), code);
      const data = await folders.make("zhiyin-real-cad-warehouse-data-");
      const tools = cadAutomation(await confinedPython(), {
        workspaceRoot: () => copy,
        harness: join(copy, "run.py"),
        directory: join(data, "cad-studio"),
      });
      return async (args) => {
        const asked = await tools.inspect("cad_api", args);
        if (!asked.ok) throw new Error(asked.reason);
        const result = (await tools.callTool(
          "cad_api",
          args,
          undefined,
          asked.identity,
        )) as Result;
        return result.content[0]?.text ?? "";
      };
    }

    it("says bd_warehouse is missing, with how to update, and offers no names near it", async () => {
      const lookUp = await lookUpWith({
        "__init__.py":
          "raise ModuleNotFoundError(\"No module named 'bd_warehouse'\", name='bd_warehouse')\n",
      });

      const answered = await lookUp({
        names: ["bd_warehouse.fastener.HexHeadScrew", "bd_warehouse.bearing"],
      });

      expect(answered).toBe(
        [
          "Cannot look up bd_warehouse.fastener.HexHeadScrew: bd_warehouse cannot be imported in this CAD environment (No module named 'bd_warehouse'). Update the CAD studio from the 3D & Rendering plugin on the Plugins page.",
          "Cannot look up bd_warehouse.bearing: bd_warehouse cannot be imported in this CAD environment (No module named 'bd_warehouse'). Update the CAD studio from the 3D & Rendering plugin on the Plugins page.",
        ].join("\n\n"),
      );
    }, 120_000);

    it("names the module that fails to import and its error, and offers a misspelt part's near names from its own module", async () => {
      const lookUp = await lookUpWith({
        "__init__.py": "",
        "fastener.py":
          "raise ImportError(\"cannot import name 'IsoThread' from 'build123d'\")\n",
        "bearing.py": "class Bearing:\n    pass\n",
      });

      const broken = await lookUp({
        name: "bd_warehouse.fastener.HexHeadScrew",
      });
      expect(broken).toBe(
        "Cannot look up bd_warehouse.fastener.HexHeadScrew: bd_warehouse.fastener cannot be imported in this CAD environment (cannot import name 'IsoThread' from 'build123d'). Update the CAD studio from the 3D & Rendering plugin on the Plugins page.",
      );

      const misspelt = await lookUp({ name: "bd_warehouse.bearing.Baering" });
      expect(misspelt).toBe(
        "Nothing is named bd_warehouse.bearing.Baering in build123d, bd_warehouse or the helpers. Near it: bd_warehouse.bearing.Bearing.",
      );
    }, 120_000);
  },
);
