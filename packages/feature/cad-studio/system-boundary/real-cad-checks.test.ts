/**
 * The checks a build's answer makes of what the script did, against a real
 * build123d: a solid made with an operator inside a builder's block that went
 * into no part, a cut that takes nothing away, a face crossing the mould's
 * parting, and every wall thinner than a requirement allows. Skipped unless
 * the CAD environment's Python is named, as the other real-CAD tests are:
 *
 *   $env:ZHIYIN_CAD_PYTHON = "…\cad\Scripts\python.exe"; npx vitest run --project system-boundary packages/feature/cad-studio
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

describe.skipIf(!python)("a build's checks, with a real build123d", () => {
  let root: string;
  let build: (args: Record<string, unknown>) => Promise<string>;

  beforeAll(async () => {
    root = await folders.make("zhiyin-real-cad-checks-workspace-");
    const data = await folders.make("zhiyin-real-cad-checks-data-");
    const tools = cadAutomation(await confinedPython(), {
      workspaceRoot: () => root,
      harness,
      directory: join(data, "cad-studio"),
    });
    build = async (args) => {
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

  /** A script in a folder of its own, with the requirements beside it when given. */
  async function script(
    folder: string,
    lines: string[],
    requirements?: unknown[],
  ): Promise<string> {
    await mkdir(join(root, folder), { recursive: true });
    await writeFile(join(root, folder, "part.py"), lines.join("\n"));
    if (requirements)
      await writeFile(
        join(root, folder, "requirements.json"),
        JSON.stringify({ requirements }),
      );
    return `${folder}/part.py`;
  }

  it("names a solid an operator made inside a builder's block that went into no part, and none that was inserted, shown or used", async () => {
    const said = await build({
      code: [
        "from build123d import *",
        "with BuildPart() as block:",
        "    Box(10, 10, 10)",
        "    extra = Pos(20, 0, 0) * Box(5, 5, 5)",
        "    insert(Pos(0, 20, 0) * Box(5, 5, 5))",
        "    pin = Pos(0, -20, 0) * Cylinder(1, 5)",
        "    bore = Pos(0, 0, 3) * Cylinder(2, 4)",
        "    for x in (-30, -40):",
        "        Pos(x, 0, 0) * Box(2, 2, 2)",
        'show(block.part - bore, name="Block")',
        'show(pin, name="Pin")',
      ].join("\n"),
    });

    expect(said).toContain(
      "At line 4 of the script: a solid made with an operator inside the BuildPart block at line 2, 5 × 5 × 5 mm about (20, 0, 0), went into no part: a builder takes in what its own objects and operations make, never what an operator such as * or + gives. insert() it inside the block, or build the part in one mode.",
    );
    // A loop's line is said once, with how often.
    expect(said).toContain(
      "At line 9 of the script (2 times): a solid made with an operator inside the BuildPart block at line 2, 2 × 2 × 2 mm about (-30, 0, 0), went into no part:",
    );
    for (const line of [5, 6, 7])
      expect(said).not.toContain(`At line ${line} of the script`);
    // The block and the box added to it, less the bore.
    expect(said).toMatch(
      /Block: 2 separate solids, each valid, 10 × 27\.5 × 10 mm/,
    );
  }, 120_000);

  it("names each cut that takes nothing away, with where its cutter lies, and none that cuts", async () => {
    const said = await build({
      code: [
        "from build123d import *",
        "b = Box(10, 10, 10)",
        "b = b - Pos(0, 0, 50) * Cylinder(2, 4)",
        "b = b - Pos(0, 0, 7) * Cylinder(2, 4)",
        "b = b - Cylinder(2, 20)",
        "hollow = Box(30, 30, 30) - Box(20, 20, 20)",
        "hollow = hollow - Pos(0, 3, 0) * Box(4, 4, 4)",
        "with BuildPart() as plate:",
        "    Box(40, 20, 5)",
        "    with Locations((-15, 0, 0), (15, 0, 0), (60, 0, 0)):",
        "        Hole(2)",
        'show(b, name="Block")',
        'show(Pos(0, 100, 0) * hollow, name="Hollow")',
        'show(Pos(0, -100, 0) * plate.part, name="Plate")',
      ].join("\n"),
    });

    expect(said).toContain(
      "At line 3 of the script: a cut takes nothing away: its cutter, 4 × 4 × 4 mm about (0, 0, 50), lies 43 mm above the part it cuts, 10 × 10 × 10 mm about (0, 0, 0). Move the cutter into the part, or take the cut out.",
    );
    expect(said).toContain(
      "At line 4 of the script: a cut takes nothing away: its cutter, 4 × 4 × 4 mm about (0, 0, 7), only touches the surface of the part it cuts, 10 × 10 × 10 mm about (0, 0, 0). Move the cutter into the part, or take the cut out.",
    );
    expect(said).not.toContain("At line 5 of the script");
    expect(said).toContain(
      "At line 7 of the script: a cut takes nothing away: its cutter, 4 × 4 × 4 mm about (0, 3, 0), lies in a hollow or a gap of the part it cuts, 30 × 30 × 30 mm about (0, 0, 0). Move the cutter into the part, or take the cut out.",
    );
    // Two of the plate's holes go through it; the third lies past its end.
    expect(said).toMatch(
      /At line 11 of the script: 1 of the 3 cutters of a cut takes nothing away: its cutter, 4 × 4 × [\d.]+ mm about \(60, 0, [-\d.]+\), lies 38 mm off the \+X side of the part it cuts, 40 × 20 × 5 mm about \(0, 0, 0\)\. Move the cutter into the part, or take the cut out\./,
    );
    expect(said).toContain("Plate: a valid solid");
    expect(said).toContain("Round holes: 2 of 4 mm");
  }, 120_000);

  it("fails a draft requirement on a face that crosses the mould's parting, which one half leaves the wrong way", async () => {
    const draft = (id: string, parting: number) => ({
      id,
      check: "draft",
      part: "Taper",
      min: 3,
      parting,
    });
    const said = await build({
      file: await script(
        "mould",
        [
          "from build123d import *",
          // Tapered 5° from a 20 mm square, narrower at the top, 20 mm high.
          'show(extrude(Rectangle(20, 20), 20, taper=5), name="Taper")',
        ],
        [draft("D1", 0), draft("D2", 5), draft("D3", 20)],
      ),
    });

    // Parted at its foot, the whole taper leaves the half above.
    expect(said).toMatch(
      /- D1 holds: Taper's steepest wall has 5° of draft along the pull, at \(.*\), the mould parted at 0 mm along the pull; 2° to spare\./,
    );
    // Parted 5 mm up, the half below would have to leave the taper's foot,
    // which widens toward it.
    expect(said).toMatch(
      /- D2 fails: Taper has an undercut, a face with -5° of draft, leaning back from the way its half of the mould leaves it, at \([-\d.]+, [-\d.]+, [0-4](\.\d+)?\), the mould parted at 5 mm along the pull; the face crosses the parting and leans back from the way the half below it leaves; part the mould where the walls turn from leaning one way to the other; 8° past the limit\./,
    );
    expect(said).toMatch(
      /- D3 fails: Taper has an undercut, a face with -5° of draft, leaning back from the way its half of the mould leaves it, at \(.*\), the mould parted at 20 mm along the pull; 8° past the limit\./,
    );
  }, 120_000);

  it("lists every place a wall is thinner than a requirement allows, each with how thin, up to eight and how many more", async () => {
    // Pockets from below leave floors of these thicknesses in a 10 mm plate.
    const pockets = (floors: number[]) => [
      "from build123d import *",
      `floors = ${JSON.stringify(floors)}`,
      "plate = Box(30 * len(floors), 30, 10)",
      "for i, floor in enumerate(floors):",
      "    x = -15 * (len(floors) - 1) + 30 * i",
      "    plate -= Pos(x, 0, -5 + (10 - floor) / 2) * Box(20, 20, 10 - floor)",
      'show(plate, name="Plate")',
    ];
    const wall = [{ id: "W1", check: "wall", part: "Plate", min: 2 }];
    const three = await build({
      file: await script("walls", pockets([0.8, 1.6, 1.2, 3]), wall),
    });
    const many = await build({
      file: await script(
        "many-walls",
        pockets([1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9]),
        wall,
      ),
    });

    // Each floor is one place, over its pocket's top and ceiling, the
    // thinnest first; the 3 mm floor is thick enough.
    const place = (thickness: string, x: string) =>
      `${thickness} mm at \\(${x}, [-\\d.]+, [\\d.]+\\) over (1\\d|20)(\\.\\d+)? × (1\\d|20)(\\.\\d+)? × ${thickness} mm \\(\\d+ points\\)`;
    expect(three).toMatch(
      new RegExp(
        `- W1 fails: Plate's thinnest wall is 0\\.8 mm, at \\([-\\d.]+, [-\\d.]+, [\\d.]+\\), measured at 600 points over its faces, about [\\d.]+ mm apart, and \\d+ more near its thinnest; walls under 2 mm in 3 places: ${place("0\\.8", "-(3[5-9]|4\\d|5[0-5])(\\.\\d+)?")}, ${place("1\\.2", "([5-9]|1\\d|2[0-5])(\\.\\d+)?")}, ${place("1\\.6", "-([5-9]|1\\d|2[0-5])(\\.\\d+)?")}; 1\\.2 mm past the limit\\.`,
      ),
    );
    expect(many).toMatch(
      /walls under 2 mm in 10 places: 1 mm at .*, 1\.7 mm at [^;]*, and 2 more places; 1 mm past the limit\./,
    );
    expect(many).not.toContain("1.8 mm at");
  }, 120_000);
});
