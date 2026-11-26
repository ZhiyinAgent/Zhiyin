/**
 * What a build says of its parts, against a real build123d: their sizes,
 * volumes and holes, the parts that overlap or float, and how each meets the
 * requirements file beside its script. Skipped unless the CAD environment's
 * Python is named, as the other real-CAD tests are:
 *
 *   $env:ZHIYIN_CAD_PYTHON = "…\cad\Scripts\python.exe"; npx vitest run --project "system-boundary*" packages/feature/cad-studio/system-boundary/real-cad-measuring.test.ts
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { python } from "./confined-cad-python.js";
import { type Call, type Result, openStudio } from "./real-cad-studio.js";

const folders = new TemporaryFolders();

describe.skipIf(!python)("building with a real build123d", () => {
  let root: string;
  let build: Call;

  beforeAll(async () => {
    ({ root, build } = await openStudio(folders));
  }, 30_000);

  afterAll(() => folders.removeAll());

  const text = (result: Result) => result.content[0]?.text ?? "";

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
});
