/**
 * The requirement kinds a making method or a product asks for, measured on
 * the exact solids of a real build123d: inner corner radii a cutter can
 * make, ribs against the wall they stand on, bends in sheet metal, clearance
 * near the print bed, where the centre of mass lies, sizes as ranges, a
 * wall's spread about its nominal, the faces a mould traps, hollows nothing
 * drains, how smoothly faces meet, stress and strain from the solid's own
 * sections, and a clearance over a sweep between positions. Each kind is
 * built once holding and once failing. Skipped unless the CAD
 * environment's Python is named, as the other real-CAD tests are:
 *
 *   $env:ZHIYIN_CAD_PYTHON = "…\cad\Scripts\python.exe"; npx vitest run --project "system-boundary*" packages/feature/cad-studio/system-boundary/real-cad-requirements.test.ts
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

describe.skipIf(!python)("requirement kinds, with a real build123d", () => {
  let root: string;
  let build: (
    folder: string,
    lines: string[],
    requirements: unknown[],
    more?: Record<string, unknown>,
  ) => Promise<string>;

  beforeAll(async () => {
    root = await folders.make("zhiyin-real-cad-requirements-workspace-");
    const data = await folders.make("zhiyin-real-cad-requirements-data-");
    const tools = cadAutomation(await confinedPython(), {
      workspaceRoot: () => root,
      harness,
      directory: join(data, "cad-studio"),
    });
    build = async (folder, lines, requirements, more = {}) => {
      await mkdir(join(root, folder), { recursive: true });
      await writeFile(join(root, folder, "part.py"), lines.join("\n"));
      await writeFile(
        join(root, folder, "requirements.json"),
        JSON.stringify({ requirements }),
      );
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

  it("holds an inner corner a cutter of the radius can make, and fails a sharp one, along the cutter's axis or every one", async () => {
    // A 20 × 20 pocket 6 mm deep in a block, its upright corners sharp or rounded R3.
    const pocket = (round: number) => [
      "from build123d import *",
      "pocket = Box(20, 20, 6)",
      round
        ? `pocket = fillet(pocket.edges().filter_by(Axis.Z), ${round})`
        : "",
      'show(Box(40, 40, 10) - Pos(0, 0, 2) * pocket, name="Block")',
    ];
    const corners = [
      { id: "C1", check: "corner", part: "Block", min: 2, along: [0, 0, 1] },
      { id: "C2", check: "corner", part: "Block", min: 2 },
    ];
    const rounded = await build("rounded-pocket", pocket(3), corners);
    const sharp = await build("sharp-pocket", pocket(0), corners);

    expect(rounded).toMatch(
      new RegExp(
        `- C1 holds: Block's tightest inner corner along \\+z is R3 mm, at ${at}; 1 mm to spare\\.`,
      ),
    );
    // Its floor meets the walls at a sharp edge, which a cutter along z leaves.
    expect(rounded).toMatch(
      new RegExp(
        `- C2 fails: Block's tightest inner corner is a sharp edge, at ${at}; inner corners under R2 mm: 8 sharp edges; 2 mm past the limit\\.`,
      ),
    );
    expect(sharp).toMatch(
      new RegExp(
        `- C1 fails: Block's tightest inner corner along \\+z is a sharp edge, at ${at}; inner corners under R2 mm: 4 sharp edges; 2 mm past the limit\\.`,
      ),
    );
  }, 120_000);

  it("holds ribs thin and short against their wall, and fails one too thick or too tall, saying by how much", async () => {
    // Two ribs standing on a 3 mm plate, across its whole width.
    const ribbed = (thickness: number, height: number) => [
      "from build123d import *",
      "plate = Pos(0, 0, 1.5) * Box(60, 40, 3)",
      `for x in (-15, 15):`,
      `    plate += Pos(x, 0, 3 + ${height} / 2) * Box(${thickness}, 30, ${height})`,
      'show(plate, name="Plate")',
    ];
    const ribs = [
      {
        id: "F1",
        check: "ribs",
        part: "Plate",
        wall: 3,
        ratio: 0.6,
        height: 3,
      },
    ];
    const good = await build("good-ribs", ribbed(1.5, 6), ribs);
    const bad = await build("bad-ribs", ribbed(2.4, 12), ribs);

    expect(good).toMatch(
      new RegExp(
        `- F1 holds: Plate has 2 ribs; the thickest is 1\\.5 mm at its root, 0\\.5 of the 3 mm wall, at ${at}, where at most 0\\.6 \\(1\\.8 mm\\) is asked; the tallest stands 6 mm out, 2 times the wall, at ${at}, where at most 3 \\(9 mm\\) is asked; 0\\.3 mm to spare\\.`,
      ),
    );
    expect(bad).toMatch(
      new RegExp(
        `- F1 fails: Plate has 2 ribs; the thickest is 2\\.4 mm at its root, 0\\.8 of the 3 mm wall, at ${at}, where at most 0\\.6 \\(1\\.8 mm\\) is asked; the tallest stands 12 mm out, 4 times the wall, at ${at}, where at most 3 \\(9 mm\\) is asked; 3 mm past the limit\\.`,
      ),
    );
  }, 120_000);

  it("measures a lip by how far it stands out of the rim it rises from, and finds no rib in a pad", async () => {
    const said = await build(
      "lip-and-pad",
      [
        "from build123d import *",
        // An enclosure base, 2 mm walls, with a locating lip 1 mm thick and
        // 2 mm tall on its rim, flush with the inside wall.
        "box = Box(60, 40, 20, align=(Align.CENTER, Align.CENTER, Align.MIN)) - Pos(0, 0, 2) * Box(56, 36, 20, align=(Align.CENTER, Align.CENTER, Align.MIN))",
        "lip = Pos(0, 0, 20) * (Box(58, 38, 2, align=(Align.CENTER, Align.CENTER, Align.MIN)) - Box(56, 36, 2, align=(Align.CENTER, Align.CENTER, Align.MIN)))",
        'show(box + lip, name="Base")',
        // A square mounting pad on a plate.
        'show(Pos(100, 0, 0) * (Box(80, 40, 2) + Pos(0, 0, 3) * Box(20, 20, 4)), name="Pad")',
      ],
      [
        {
          id: "L1",
          check: "ribs",
          part: "Base",
          wall: 2,
          ratio: 0.6,
          height: 3,
        },
        { id: "L2", check: "ribs", part: "Pad", wall: 2, ratio: 0.6 },
      ],
    );

    expect(said).toMatch(
      new RegExp(
        `- L1 holds: Base has \\d+ ribs; the thickest is 1 mm at its root, 0\\.5 of the 2 mm wall, at ${at}, where at most 0\\.6 \\(1\\.2 mm\\) is asked; the tallest stands 2 mm out, 1 times the wall, at ${at}, where at most 3 \\(6 mm\\) is asked; 0\\.2 mm to spare\\.`,
      ),
    );
    expect(said).toContain(
      "- L2 not checked: no rib was found on Pad: a rib here is a flat-topped wall standing out from a face, more than three times as long as it is thick",
    );
  }, 120_000);

  it("holds a bend in sheet metal with room for its radius, flange and holes, and fails one too tight, too short or too near", async () => {
    // An L bracket of 2 mm sheet bent about y: a flange on the bed, the
    // bend's inside radius r, and a flange standing up; a hole in the flat
    // flange its distance from the bend.
    const bracket = (r: number, upright: number, hole: number) => [
      "from build123d import *",
      `t, r, w = 2, ${r}, 30`,
      "flat = Pos(-20, 0, t / 2) * Box(40, w, t)",
      "tube = Pos(0, 0, r + t) * Rot(90, 0, 0) * (Cylinder(r + t, w) - Cylinder(r, w))",
      "bend = tube & Pos((r + t) / 2, 0, (r + t) / 2) * Box(r + t, w, r + t)",
      `up = Pos(r + t / 2, 0, r + t + ${upright} / 2) * Box(t, w, ${upright})`,
      `bracket = flat + bend + up - Pos(-${hole} - 2, 0, t / 2) * Cylinder(2, t)`,
      'show(bracket, name="Bracket")',
    ];
    const bend = [
      {
        id: "K1",
        check: "bend",
        part: "Bracket",
        radius: 2,
        flange: 8,
        hole: 5,
      },
    ];
    const good = await build("good-bend", bracket(2, 20, 10), bend);
    const bad = await build("bad-bend", bracket(1, 6, 3), bend);

    expect(good).toMatch(
      new RegExp(
        `- K1 holds: Bracket is sheet 2 mm thick with 1 bend; the tightest inside radius is 2 mm, at ${at}, where at least 2 mm is asked; the shortest flange runs 20 mm past its bend, at ${at}, where at least 8 mm is asked; the nearest hole is 10 mm from a bend, at ${at}, where at least 5 mm is asked; 0 mm to spare\\.`,
      ),
    );
    expect(bad).toMatch(
      new RegExp(
        `- K1 fails: Bracket is sheet 2 mm thick with 1 bend; the tightest inside radius is 1 mm, at ${at}, where at least 2 mm is asked; the shortest flange runs 6 mm past its bend, at ${at}, where at least 8 mm is asked; the nearest hole is 3 mm from a bend, at ${at}, where at least 5 mm is asked; 2 mm past the limit\\.`,
      ),
    );
  }, 120_000);

  it("fails a clearance that is wide enough above the bed but too tight where the first layers spread", async () => {
    // A pin in a bore with 0.5 mm all round, or with a lip in the first
    // half millimetre leaving 0.35 mm, as the first layers spreading would.
    const hinge = (lip?: number) => [
      "from build123d import *",
      "barrel = Pos(0, 0, 10) * (Cylinder(8, 20) - Cylinder(5.5, 20))",
      lip
        ? `barrel += Pos(0, 0, 0.25) * (Cylinder(5.5, 0.5) - Cylinder(${5 + lip}, 0.5))`
        : "",
      'show(barrel, name="Barrel")',
      'show(Pos(0, 0, 10) * Cylinder(5, 20), name="Pin")',
    ];
    const clearance = [
      {
        id: "G1",
        check: "clearance",
        between: ["Pin", "Barrel"],
        min: 0.3,
        bed: 0.4,
      },
    ];
    const free = await build("free-hinge", hinge(), clearance);
    const fused = await build("fused-hinge", hinge(0.35), clearance);

    expect(free).toContain(
      "- G1 holds: Pin comes 0.5 mm from Barrel; within 0.5 mm of the bed, Pin comes 0.5 mm from Barrel, where at least 0.4 mm is asked; 0.1 mm to spare.",
    );
    // The bore clears the pin by more than min; only near the bed is it too tight.
    expect(fused).toContain(
      "- G1 fails: Pin comes 0.35 mm from Barrel; within 0.5 mm of the bed, Pin comes 0.35 mm from Barrel, where at least 0.4 mm is asked; 0.05 mm past the limit.",
    );
  }, 120_000);

  it("holds a gear pair's backlash and contact ratio, and fails a pair set at its pitch circles, two that do not mesh, or a part with no gear", async () => {
    // m 1 at 25°, 12 and 36 teeth: their pitch circles meet 24 mm apart.
    const train = [
      "from build123d import *",
      "from bd_warehouse.gear import SpurGear",
      "def gear(z, x, y=0, phase=0):",
      "    return Pos(x, y, 0) * (Rot(Z=phase) * SpurGear(module=1, tooth_count=z, pressure_angle=25, thickness=8))",
      'show(gear(12, 0) - Cylinder(1.6, 20), name="Pinion")',
      'show(gear(36, 24.15, 0, 185), name="Wheel")',
      'show(gear(12, 0, 60), name="Tight pinion")',
      'show(gear(36, 24, 60, 185), name="Tight wheel")',
      'show(Pos(0, -40, 0) * Box(10, 10, 8), name="Block")',
    ];
    const said = await build("gear-train", train, [
      {
        id: "M1",
        check: "mesh",
        between: ["Pinion", "Wheel"],
        min: 0.05,
        max: 0.3,
        contact_ratio: 1.2,
      },
      {
        id: "M2",
        check: "mesh",
        between: ["Tight pinion", "Tight wheel"],
        min: 0.05,
      },
      {
        id: "M3",
        check: "mesh",
        between: ["Pinion", "Tight wheel"],
        min: 0.05,
      },
      { id: "M4", check: "mesh", between: ["Pinion", "Block"], min: 0.05 },
    ]);

    // 0.15 mm wider: 2 × 0.15 × tan 25.75° = 0.1447 mm, 0.0947 mm over
    // the least asked; contact ratio 1.28.
    expect(said).toContain(
      "- M1 holds: Pinion (12 teeth) and Wheel (36 teeth) mesh 24.15 mm apart, 0.145 mm of backlash from that alone, contact ratio 1.28; where 0.05 to 0.3 mm of backlash and a contact ratio of at least 1.2 are asked; 0.0947 mm to spare.",
    );
    // At their pitch circles, bd_warehouse's teeth leave no backlash.
    expect(said).toContain(
      "- M2 fails: Tight pinion (12 teeth) and Tight wheel (36 teeth) mesh 24 mm apart, where their pitch circles meet, so with no backlash, contact ratio 1.41; where at least 0.05 mm of backlash is asked; 0.05 mm past the limit.",
    );
    expect(said).toContain(
      "- M3 fails: no gear of Pinion meshes one of Tight wheel: none lies beside another with their tips reaching into each other.",
    );
    expect(said).toMatch(
      /M4 not checked: Block keeps no gear the studio knows, one of bd_warehouse's SpurGear or HelicalGear/,
    );
  }, 120_000);

  it("holds a centre of mass over what the parts stand on or near a point, and fails one that tips", async () => {
    // A 40 mm square base with an arm reaching out along x, of steel or of PLA.
    const lamp = (reach: number) => [
      "from build123d import *",
      'show(Pos(0, 0, 2.5) * Box(40, 40, 5), name="Base")',
      `show(Pos(${reach} / 2, 0, 50) * Box(${reach}, 4, 4), name="Arm")`,
    ];
    const balance = [
      {
        id: "B1",
        check: "balance",
        footprint: true,
        materials: { Base: "PLA", Arm: "steel" },
      },
      {
        id: "B2",
        check: "balance",
        at: [0, 0, null],
        tolerance: 5,
        materials: { Base: "PLA", Arm: "steel" },
      },
    ];
    const steady = await build("steady-lamp", lamp(30), balance);
    const tipping = await build("tipping-lamp", lamp(120), balance);

    expect(steady).toMatch(
      new RegExp(
        `- B1 holds: the centre of mass of Base and Arm, [\\d.]+ g, is at ${at}, [\\d.]+ mm inside the edge of what they stand on; [\\d.]+ mm to spare\\.`,
      ),
    );
    expect(tipping).toMatch(
      new RegExp(
        `- B1 fails: the centre of mass of Base and Arm, [\\d.]+ g, is at ${at}, [\\d.]+ mm outside the edge of what they stand on, so they tip; [\\d.]+ mm past the limit\\.`,
      ),
    );
    expect(tipping).toMatch(
      new RegExp(
        `- B2 fails: the centre of mass of Base and Arm, [\\d.]+ g, is at ${at}, [\\d.]+ mm from \\(0, 0, any\\), where within 5 mm is asked; [\\d.]+ mm past the limit\\.`,
      ),
    );
  }, 120_000);

  it("holds a size in its range and fails one past it, a single number held to what the studio measures", async () => {
    const lines = [
      "from build123d import *",
      'show(Box(82, 82, 95), name="Body")',
    ];
    const said = await build("ranges", lines, [
      {
        id: "S1",
        check: "size",
        part: "Body",
        range: [[80, 85], [80, 85], 95],
      },
      {
        id: "S2",
        check: "size",
        part: "Body",
        range: [null, null, [100, 110]],
      },
    ]);

    expect(said).toContain(
      "- S1 holds: Body is 82 × 82 × 95 mm, 95 along z where 95 mm is asked; 0.01 mm to spare.",
    );
    expect(said).toContain(
      "- S2 fails: Body is 82 × 82 × 95 mm, 95 along z where 100 to 110 mm is asked; 5 mm past the limit.",
    );
  }, 120_000);

  it("says a margin under a hundredth of a millimetre to three figures, never as 0", async () => {
    const said = await build(
      "thin-margin",
      ["from build123d import *", 'show(Box(82, 82, 95), name="Body")'],
      [
        {
          id: "S3",
          check: "size",
          part: "Body",
          range: [null, null, [94.997, 100]],
        },
      ],
    );

    expect(said).toMatch(/- S3 holds: [^\n]*; 0\.003 mm to spare\./);
  }, 120_000);

  it("finds a wall's thinnest between the points first measured, saying how far apart they are", async () => {
    // A cone pocketed from below leaves 3.3 mm under its tip, a spot no
    // point spread over the whole plate lands on.
    const said = await build(
      "cone-floor",
      [
        "from build123d import *",
        'show(Box(60, 60, 6) - Pos(0, 0, -3) * Cone(10, 0, 5.4), name="Plate")',
      ],
      [{ id: "W1", check: "wall", part: "Plate", min: 3.5 }],
    );

    expect(said).toMatch(
      /- W1 fails: Plate's thinnest wall is 3\.[34]\d* mm, at \([-\d.]+, [-\d.]+, 3\), measured at 600 points over its faces, about 3\.8 mm apart, and \d+ more near its thinnest; walls under 3\.5 mm in 1 place: /,
    );
  }, 120_000);

  it("holds an even wall to its thickest and its band, and fails a solid boss past its ratio to the nominal", async () => {
    // An open box of 2 mm walls; the second has a solid Ø10 boss on its floor.
    const box = (boss: boolean) => [
      "from build123d import *",
      "case = Box(60, 40, 30) - Pos(0, 0, 2) * Box(56, 36, 30)",
      boss ? "case += Pos(0, 0, -8) * Cylinder(5, 10)" : "",
      'show(case, name="Case")',
    ];
    const walls = [
      { id: "W1", check: "wall", part: "Case", max: 3, band: 0.5 },
      { id: "W2", check: "wall", part: "Case", ratio: 1.5 },
    ];
    const even = await build("even-walls", box(false), walls);
    const bossed = await build("bossed-walls", box(true), walls);

    expect(even).toMatch(
      new RegExp(
        `- W1 holds: Case's wall is 2 mm nominal, over its largest faces; its thickest section is 2\\.\\d+ mm across, at ${at}, where at most 3 mm is asked; 0\\.0% of its surface lies outside 1\\.5 to 2\\.5 mm, where at most 0% is asked; its walls over its surface: 9\\d% 1\\.8 to 2\\.2 mm`,
      ),
    );
    expect(even).toMatch(/- W2 holds: [^\n]*; 0\.\d+ mm to spare\./);
    // The boss holds a ball of its own diameter, 5 times the 2 mm wall.
    expect(bossed).toMatch(
      new RegExp(
        `- W2 fails: Case's wall is 2 mm nominal, over its largest faces; its thickest section is (9\\.9\\d*|10) mm across, at ${at}; 5 times the nominal, where at most 1\\.5 \\(3 mm\\) is asked; [^\n]*; 7(\\.0\\d*)? mm past the limit\\.`,
      ),
    );
    expect(bossed).toMatch(
      /- W1 fails: [^\n]*% of its surface lies outside 1\.5 to 2\.5 mm \([\d.]+% thicker, to [\d.]+ mm at /,
    );
  }, 240_000);

  it("fails a groove the mould traps, and holds it with side actions that free it", async () => {
    // A groove 4 mm high cut 3 mm into one side of a block: its ceiling and its floor face the pull.
    const said = await build(
      "grooved",
      [
        "from build123d import *",
        'show(Box(30, 30, 20) - Pos(15, 0, 0) * Box(6, 40, 4), name="Block")',
      ],
      [
        { id: "U1", check: "undercut", part: "Block" },
        { id: "U2", check: "undercut", part: "Block", sides: true },
      ],
    );

    expect(said).toMatch(
      new RegExp(
        `- U1 fails: Block has 2 faces, 180 mm², trapped along \\+Z: 90 mm² at ${at}, a side action along \\+X[^;]* frees it; 90 mm² at ${at}, a side action along \\+X[^;]* frees it, where at most 0 mm² is asked; 180 mm² past the limit\\.`,
      ),
    );
    expect(said).toContain(
      "- U2 holds: no face of Block is trapped along +Z; 2 more faces, 180 mm², freed by side actions, where at most 0 mm² is asked; 0 mm² to spare.",
    );
  }, 120_000);

  it("fails a closed void and a hollow whose drain is too small, and holds one whose drain a ball passes", async () => {
    // A hollow 30 mm cube of 2 mm walls: closed, with a Ø2 drain on top, or with a Ø5 one.
    const said = await build(
      "hollows",
      [
        "from build123d import *",
        "shell = Box(30, 30, 30) - Box(26, 26, 26)",
        'show(shell, name="Closed")',
        'show(Pos(50, 0, 0) * (shell - Pos(0, 0, 14) * Cylinder(1, 4)), name="Small")',
        'show(Pos(100, 0, 0) * (shell - Pos(0, 0, 14) * Cylinder(2.5, 4)), name="Large")',
      ],
      [
        { id: "V1", check: "void", part: "Closed" },
        { id: "V2", check: "void", part: "Small", opening: 3.5 },
        { id: "V3", check: "void", part: "Large", opening: 3.5 },
      ],
    );

    expect(said).toContain(
      "- V1 fails: Closed holds 1 closed void: 17576 mm³, 26 × 26 × 26 mm about (0, 0, 0).",
    );
    expect(said).toMatch(
      /- V2 fails: Small holds no closed void; 1 hollow is open to the outside only through less than Ø3\.5 mm: about \d+(\.\d+)? mm³, [\d.]+ × [\d.]+ × [\d.]+ mm about \(49\.88, -0\.125, 0\.458\), found on a grid of 0\.583 mm\./,
    );
    expect(said).toContain(
      "- V3 holds: Large holds no closed void; every hollow wide enough for a ball of Ø3.5 mm opens to the outside through at least that, found on a grid of 0.583 mm.",
    );
  }, 240_000);

  it("holds rounded edges tangent but not of one curvature, and fails sharp ones, naming them", async () => {
    const said = await build(
      "smooth",
      [
        "from build123d import *",
        'show(fillet(Box(20, 20, 20).edges(), 3), name="Soft")',
        "sharp = Pos(40, 0, 0) * Box(20, 20, 20)",
        'show(sharp, name="Sharp", surfaces={"lid": sharp.faces().sort_by(Axis.Z)[-1], "side": sharp.faces().sort_by(Axis.X)[-1]})',
      ],
      [
        { id: "S1", check: "smooth", part: "Soft" },
        { id: "S2", check: "smooth", part: "Soft", level: "G2" },
        { id: "S3", check: "smooth", part: "Sharp" },
        {
          id: "S4",
          check: "smooth",
          part: "Sharp",
          surfaces: ["lid", "side"],
        },
        { id: "S5", check: "smooth", part: "Sharp", surfaces: ["base"] },
      ],
    );

    expect(said).toContain(
      "- S1 holds: Soft's faces meet across 48 edges, turning at most 0°, where at most 0.5° is asked; 0.5° to spare.",
    );
    // A flat face meets a round of R3 with no curvature on one side and 1/3 mm⁻¹ on the other.
    expect(said).toMatch(
      /- S2 fails: Soft's faces meet across 48 edges, turning at most 0°, their curvature jumping at most 100% across one at [^;]*, where at most 0\.5° and 10% are asked; 48 edges are past it: [^\n]*; 90% of the larger curvature past the limit\./,
    );
    expect(said).toMatch(
      /- S3 fails: Sharp's faces meet across 12 edges, turning at most 90° at [^;]*, where at most 0\.5° is asked; 12 edges are past it: 90° at [^\n]*; 89\.5° past the limit\./,
    );
    // Its lid and one side, as named, meet across the one edge between them.
    expect(said).toMatch(
      /- S4 fails: Sharp's faces meet across 1 edge, turning at most 90° at \(50, [-\d.]+, 10\), where at most 0\.5° is asked; 1 edge is past it: /,
    );
    expect(said).toContain(
      "- S5 not checked: Sharp has no named surface base; its named surfaces are lid, side.",
    );
  }, 120_000);

  it("measures a shaft's bending and torsion stress, its deflection and an arm's strain from the sections of the solid", async () => {
    const said = await build(
      "beams",
      [
        "from build123d import *",
        'show(Cylinder(5, 100, rotation=(0, 90, 0)), name="Shaft")',
        'show(Pos(0, 30, 10) * Box(2, 8, 20), name="Latch")',
      ],
      [
        {
          id: "T1",
          check: "stress",
          part: "Shaft",
          along: [1, 0, 0],
          load: 500,
          toward: [0, 0, -1],
          material: "steel",
          safety: 1.5,
          deflection: 1,
        },
        {
          id: "T2",
          check: "stress",
          part: "Shaft",
          along: [1, 0, 0],
          torque: 10,
          material: "steel",
          safety: 3,
        },
        {
          id: "T3",
          check: "stress",
          part: "Latch",
          along: [0, 0, 1],
          torque: 1,
          yield: 40,
          safety: 2,
        },
        {
          id: "E1",
          check: "strain",
          part: "Latch",
          along: [0, 0, 1],
          toward: [1, 0, 0],
          deflection: 1,
          max: 2.5,
        },
      ],
    );

    // Ø10 resting on ends 100 mm apart, 500 N at its middle: M = F·L/4 =
    // 12500 N·mm, I = π·10⁴/64 = 490.87 mm⁴, σ = M·c/I = 127.32 MPa; S235's
    // 235 MPa yield over it, 1.85; over 1.5, 156.67 MPa allowed. It sags
    // F·L³/(48 E I) = 500 × 100³ / (48 × 210000 × 490.87) = 0.101 mm.
    expect(said).toMatch(
      new RegExp(
        `- T1 holds: Shaft, 100 mm along \\+x resting at both ends, under 500 N toward -z at its middle, in S235JR, up to 16 mm thick \\(yield 235 MPa\\): its highest stress is 127\\.3\\d* MPa von Mises, 50 mm along it, at ${at} \\(bending 127\\.3\\d* MPa; its section there 78\\.54 mm², I 490\\.87 mm⁴\\), a safety factor of 1\\.85 where at least 1\\.5 is asked, 156\\.67 MPa allowed; it bends 0\\.1 mm at [\\d.]+ mm along it, where at most 1 mm is asked \\(E 210 GPa\\)\\. Beam theory on 61 sections: static, no stress raised at shoulders, grooves or holes; 29\\.3\\d* MPa to spare\\.`,
      ),
    );
    // 10 N·m twists it by 16 T / (π d³) = 50.93 MPa; von Mises √3 × 50.93 =
    // 88.21 MPa against 235 / 3 = 78.33 MPa allowed.
    expect(said).toMatch(
      /- T2 fails: Shaft, [^\n]*under 10 N·m about its length[^\n]*its highest stress is 88\.21 MPa von Mises[^\n]*\(shear 50\.93 MPa; [^\n]*a safety factor of 2\.66 where at least 3 is asked, 78\.33 MPa allowed[^\n]*; 9\.88 MPa past the limit\./,
    );
    // A 2 × 8 rectangle is not round, so its torsion is solved on the
    // section: for sides 4 to 1, J = 0.281 × 8 × 2³ = 17.98 mm⁴ and τ = T /
    // (0.282 × 8 × 2²) = 110.8 MPa (Timoshenko & Goodier, §109); von Mises
    // √3 × 110.8 = 192 MPa against 40 / 2 allowed.
    expect(said).toMatch(
      /- T3 fails: Latch, 20 mm along \+z resting at both ends, under 1 N·m about its length[^\n]*its highest stress is 19[12]\.\d+ MPa von Mises[^\n]*\(shear 11[01]\.\d+ MPa; its section there 16 mm², I [\d.]+ mm⁴, J 1[78]\.9\d* mm⁴ from Saint-Venant torsion solved on the section in \d+ points, its shear highest at \(-?1, [\d.]+, [\d.]+\)\)[^\n]*MPa past the limit\./,
    );
    // A 2 mm thick arm 20 mm long pushed 1 mm at its tip: 1.5 y t / L² = 0.75%.
    expect(said).toMatch(
      /- E1 holds: Latch, 20 mm along \+z from its root, its tip pushed 1 mm toward \+x: its highest strain is 0\.75%, [^\n]*where at most 2\.5% is asked[^\n]*; 1\.75% to spare\./,
    );
  }, 120_000);

  it("sweeps an arm past a post in steps between its positions, finding the near miss and the clearance between them", async () => {
    // An arm 30 mm long turning about z from 0° to 90°; a Ø4 post 33.5 mm out at 45°,
    // which the arm's end passes 33.5 − 30 − 2 = 1.5 mm from at 45° alone.
    const said = await build(
      "sweep",
      [
        "import sys",
        "from build123d import *",
        "angle = float(sys.argv[1])",
        'show(Rot(Z=angle) * Pos(15, 0, 0) * Box(30, 4, 4), name="Arm")',
        'show(Rot(Z=45) * Pos(33.5, 0, 0) * Cylinder(2, 10), name="Post")',
      ],
      [
        {
          id: "C1",
          check: "clearance",
          between: ["Arm", "Post"],
          min: 2,
        },
      ],
      { positions: [["0"], ["90"]], steps: 6 },
    );

    expect(said).toContain(
      "Checked for overlaps at 7 positions: no two parts overlap at any.",
    );
    expect(said).toMatch(
      /Swept through 7 positions, each move between the 2 listed cut into 6 steps: of the 1 pair of parts that move with respect to each other, those coming nearest: Arm and Post come 1\.5 mm apart at 45, step 3 of 6 from 0 to 90, at \([-\d.]+, [-\d.]+, [-\d.]+\)\./,
    );
    expect(said).toContain(
      "- C1 fails: Arm comes 1.5 mm from Post at the position 45; 0.5 mm past the limit.",
    );
  }, 240_000);

  it("turns a part built once about an axis in steps, finding how near it comes to a part that stays", async () => {
    // The arm and post above, the arm built at 0° and turned by the sweep.
    const said = await build(
      "rigid-near",
      [
        "from build123d import *",
        'show(Pos(15, 0, 0) * Box(30, 4, 4), name="Arm")',
        'show(Rot(Z=45) * Pos(33.5, 0, 0) * Cylinder(2, 10), name="Post")',
      ],
      [],
      {
        sweep: {
          parts: ["Arm"],
          through: [0, 0, 0],
          along: [0, 0, 1],
          from: 0,
          to: 90,
          steps: 6,
        },
      },
    );

    expect(said).toMatch(
      new RegExp(
        `Turned Arm 0° to 90° about the axis through \\(0, 0, 0\\) along \\(0, 0, 1\\) in 6 steps: Arm and Post come nearest 1\\.5 mm apart at 45°, at ${at}\\.`,
      ),
    );
  }, 120_000);

  it("finds where a part turned in fine steps goes into one that stays, and how deep at most", async () => {
    // The post 31 mm out: the arm's end, 30 mm out, goes about 1 mm into it
    // around 45°, and meets it over the degrees either side where the two
    // widths cross.
    const said = await build(
      "rigid-meet",
      [
        "from build123d import *",
        'show(Pos(15, 0, 0) * Box(30, 4, 4), name="Arm")',
        'show(Rot(Z=45) * Pos(31, 0, 0) * Cylinder(2, 10), name="Post")',
      ],
      [],
      {
        sweep: {
          parts: ["Arm"],
          through: [0, 0, 0],
          along: [0, 0, 1],
          from: 0,
          to: 90,
          steps: 90,
        },
      },
    );

    expect(said).toMatch(
      /Arm and Post meet from (3\d|4[0-4])° to (4[6-9]|5\d)°, going (0\.9\d*|1(\.0\d*)?) mm into each other at most, at (4[0-9]|50)°; elsewhere they come nearest [\d.]+ mm apart at \d+°/,
    );
  }, 120_000);

  it("says a sweep that names a part the script does not show", async () => {
    const said = await build(
      "rigid-missing",
      ["from build123d import *", 'show(Box(10, 10, 10), name="Block")'],
      [],
      {
        sweep: {
          parts: ["Lid"],
          along: [0, 0, 1],
          from: 0,
          to: 10,
          steps: 5,
        },
      },
    );

    expect(said).toContain(
      "The sweep names Lid, which the script does not show; it shows Block.",
    );
  }, 120_000);
});
