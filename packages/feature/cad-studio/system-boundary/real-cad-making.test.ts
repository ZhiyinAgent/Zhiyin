/**
 * The checks a build makes unasked, against a real build123d: shapes a line
 * of the script makes and keeps nowhere, closed voids, and each part checked
 * for the way it is made: undercuts, thick sections, ribs and bosses on a
 * moulded part, inside corners on a milled one, bends on a sheet part, and
 * whether a file for printing closes. Each with a part that has the fault and
 * one that does not. Skipped unless the CAD environment's Python is named, as
 * the other real-CAD tests are:
 *
 *   $env:ZHIYIN_CAD_PYTHON = "…\cad\Scripts\python.exe"; npx vitest run --project system-boundary packages/feature/cad-studio/system-boundary/real-cad-making.test.ts
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

describe.skipIf(!python)(
  "the checks a build makes unasked, with a real build123d",
  () => {
    let root: string;
    let build: (args: Record<string, unknown>) => Promise<string>;

    beforeAll(async () => {
      root = await folders.make("zhiyin-real-cad-making-workspace-");
      const data = await folders.make("zhiyin-real-cad-making-data-");
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

    it("names a line whose new shape nothing keeps and a part never shown or used, and none that is kept, moved in place or shown", async () => {
      const said = await build({
        code: [
          "from build123d import *",
          "b = Box(10, 10, 10)",
          "b.rotate(Axis.Z, 45)",
          "b - Cylinder(2, 20)",
          "b.move(Pos(0, 0, 1))",
          "b = b - Cylinder(1, 20)",
          "with BuildPart() as spare:",
          "    Cylinder(3, 6)",
          "kept = Pos(30, 0, 0) * Box(4, 4, 4)",
          'show(b, name="Block")',
          'show(kept, name="Kept")',
        ].join("\n"),
      });

      expect(said).toContain(
        "At line 3 of the script: “b.rotate(Axis.Z, 45)” gives a new shape, 14.142 × 14.142 × 10 mm about (0, 0, 0), which nothing keeps: build123d's operators and methods return their result and leave the shape they work on as it was. Assign it, as part = part.rotate(…), or take the line out.",
      );
      expect(said).toContain(
        "At line 4 of the script: “b - Cylinder(2, 20)” gives a new shape, 10 × 10 × 10 mm about (0, 0, 0), which nothing keeps:",
      );
      expect(said).toContain(
        'At line 7 of the script: spare, 6 × 6 × 6 mm about (0, 0, 0), is neither shown nor used after: show(spare, name="…") to build it, or take it out.',
      );
      for (const line of [5, 6, 9])
        expect(said).not.toContain(`At line ${line} of the script`);
      // Moved up by 1 in place, then bored.
      expect(said).toMatch(
        /Block: a valid solid, 10 × 10 × 10 mm, from \(-5, -5, -4\)/,
      );
    }, 120_000);

    it("takes a builder nested in another's block as joined to it, unless private, and a part moved in place through an attribute as kept", async () => {
      const said = await build({
        code: [
          "from build123d import *",
          "with BuildPart() as body:",
          "    Box(20, 20, 10)",
          "    with BuildPart(Plane.XY.offset(5)) as knob:",
          "        Cylinder(4, 10, align=(Align.CENTER, Align.CENTER, Align.MIN))",
          "    with BuildPart(mode=Mode.PRIVATE) as aside:",
          "        Box(2, 2, 2)",
          "body.part.move(Pos(0, 0, 5))",
          "body.part.rotate(Axis.Z, 45)",
          'show(body, name="Body")',
        ].join("\n"),
      });

      expect(said).not.toContain("knob,");
      expect(said).not.toContain("At line 8 of the script");
      expect(said).toContain(
        'At line 6 of the script: aside, 2 × 2 × 2 mm about (0, 0, 0), is neither shown nor used after: show(aside, name="…") to build it, or take it out.',
      );
      expect(said).toContain(
        "At line 9 of the script: “body.part.rotate(Axis.Z, 45)” gives a new shape,",
      );
      // The box and the knob joined, then moved up by 5 in place.
      expect(said).toMatch(
        /Body: a valid solid, 20 × 20 × 20 mm, from \(-10, -10, 0\)/,
      );
    }, 120_000);

    it("names a closed void inside a part, and nothing of a part open to the outside", async () => {
      const said = await build({
        code: [
          "from build123d import *",
          "hollow = Box(20, 20, 20) - Box(10, 10, 10)",
          "cup = Pos(40, 0, 0) * (Box(20, 20, 20) - Pos(0, 0, 5) * Box(10, 10, 10))",
          'show(hollow, name="Hollow")',
          'show(cup, name="Cup")',
        ].join("\n"),
      });

      expect(said).toContain(
        "Hollow holds 1 closed void inside it, where none can be: 1000 mm³, 10 × 10 × 10 mm about (0, 0, 0). No tool or mould reaches a closed void, and a resin or powder print keeps it full; open it to the outside, or fill it.",
      );
      expect(said).not.toContain("Cup holds");
    }, 120_000);

    it("names the faces a moulded part traps along the pull, with the side action that frees each, and nothing of a part that leaves the mould", async () => {
      const said = await build({
        code: [
          "from build123d import *",
          // A slot through a block's side, open along X and Y.
          "slotted = Box(20, 20, 20) - Pos(5, 0, 0) * Box(10, 30, 8)",
          // A groove all the way round: no side action frees it.
          "grooved = Pos(40, 0, 0) * (Box(20, 20, 20) - Box(22, 22, 4) + Box(16, 16, 4))",
          "taper = Pos(80, 0, -10) * extrude(Rectangle(20, 20), 20, taper=3)",
          'show(slotted, name="Slotted", making="moulded")',
          'show(grooved, name="Grooved", making="moulded")',
          'show(taper, name="Taper", making="moulded")',
        ].join("\n"),
      });

      expect(said).toMatch(
        /Slotted, moulded \(as shown\) along \+Z: 2 faces, 400 mm², trapped where the mould leaving along the pull meets the part again, against none allowed: 200 mm² at \([-\d.]+, [-\d.]+, -4\), a side action along \+X or \+Y or -Y frees it; 200 mm² at \([-\d.]+, [-\d.]+, 4\), a side action along \+X or \+Y or -Y frees it\./,
      );
      expect(said).toMatch(
        /Grooved, moulded \(as shown\) along \+Z: 2 faces, 288 mm², trapped .*: 144 mm² at \(.*\), no side action square to the pull frees it; 144 mm² at \(.*\), no side action square to the pull frees it\./,
      );
      expect(said).not.toContain("Taper, moulded");
    }, 120_000);

    it("takes no rounded face that looks along the pull for trapped, and names the faces under a ledge hanging inside a tray", async () => {
      const said = await build({
        code: [
          "from build123d import *",
          "block = fillet(Box(40, 30, 20).edges().group_by(Axis.Z)[-1], 3)",
          "outer = fillet(Box(60, 40, 20).edges().filter_by(Axis.Z), 5)",
          "outer = fillet(outer.edges().group_by(Axis.Z)[-1], 3)",
          "cover = offset(outer, amount=-2, openings=outer.faces().sort_by(Axis.Z)[0])",
          "body = cast(RectangleRounded(60, 40, 8), 15, draft=2, round=2)",
          // A shelf 8 mm deep on the tray's wall, half way up, over its floor.
          "tray = Box(60, 40, 20) - Pos(0, 0, 2) * Box(56, 36, 20)",
          "ledged = tray + Pos(-24, 0, 4) * Box(8, 36, 2)",
          'show(block, name="Block", making="moulded")',
          'show(Pos(100, 0, 0) * Sphere(10), name="Ball", making="moulded")',
          'show(Pos(200, 0, 0) * cover, name="Cover", making="moulded")',
          'show(Pos(300, 0, 0) * body, name="Body")',
          'show(Pos(400, 0, 0) * ledged, name="Ledged", making="moulded")',
        ].join("\n"),
      });

      for (const name of ["Block", "Ball", "Cover", "Body"])
        expect(said).not.toMatch(new RegExp(`${name}, moulded .*trapped`));
      expect(said).toMatch(
        /Ledged, moulded \(as shown\) along \+Z: \d+ faces?, [\d.]+ mm², trapped where the mould leaving along the pull meets the part again, against none allowed: 288 mm² at \(-?[\d.]+, -?[\d.]+, 3\)/,
      );
    }, 120_000);

    it("takes the nominal wall from the part's largest faces, so dense ribs within the guidelines are not thick sections, nor the corners of any even-walled tray", async () => {
      const trays: string[] = [];
      [
        [40, 30, 20],
        [60, 40, 20],
        [80, 50, 25],
        [50, 50, 15],
        [100, 60, 30],
        [30, 20, 10],
      ].forEach(([x, y, z], i) =>
        [1.5, 2, 2.5].forEach((wall, j) =>
          trays.push(
            `show(Pos(${i * 150}, ${j * 150 + 200}, 0) * (Box(${x}, ${y}, ${z}) - Pos(0, 0, ${wall}) * Box(${x! - 2 * wall}, ${y! - 2 * wall}, ${z})), name="Tray ${x}x${y}x${z} ${wall}", making="moulded")`,
          ),
        ),
      );
      const said = await build({
        code: [
          "from build123d import *",
          // A 2 mm plate, ribs 1.2 mm thick (0.6 of its wall) and 6 tall (three walls), 4 mm apart.
          "plate = Box(100, 100, 2)",
          "for i in range(-11, 12):",
          "    plate = plate + Pos(i * 4, 0, 4) * Box(1.2, 90, 6)",
          'show(plate, name="Dense", making="moulded")',
          ...trays,
        ].join("\n"),
      });

      expect(said).toMatch(/Tray 100x60x30 2\.5: a valid solid/);
      expect(said).not.toMatch(/^Dense(, moulded|: walls|: the rib)/m);
      expect(said).not.toMatch(/Tray [\dx.]+ [\d.]+: walls/);
    }, 240_000);

    it("measures the wall a rib stands on clear of the round at its root", async () => {
      const said = await build({
        code: [
          "from build123d import *",
          "plate = rib(Box(80, 40, 2), (0, -15, 1), (0, 15, 1), 5, 1.4, draft=0, root=1)",
          'show(plate, name="Rooted", making="moulded")',
        ].join("\n"),
      });

      expect(said).toMatch(
        /Rooted: the rib at \([-\d.]+, 0, [\d.]+\), on a 2 mm wall, is 1\.4 mm thick at its root, over the 1\.2 mm \(0\.6 of the wall\) that keeps the face behind it from sinking\./,
      );
    }, 120_000);

    it("takes a shelled box with closed rounded corners for no sheet part, and a U channel bent from sheet for one", async () => {
      // A profile `t` thick along `points` in XZ, its bends rounded to inside radius `r`, `width` deep.
      const bent = [
        "def bent(points, t, r, width):",
        "    path = fillet(Polyline(*points).vertices()[1:-1], r + t / 2)",
        "    face = make_face(offset(path, amount=t / 2, side=Side.BOTH, kind=Kind.ARC))",
        "    return extrude(Plane.XZ * face, amount=width / 2, both=True)",
      ];
      const said = await build({
        code: [
          "from build123d import *",
          ...bent,
          "outer = fillet(Box(60, 40, 20).edges().filter_by(Axis.Z), 3)",
          "tray = offset(outer, amount=-2, openings=outer.faces().sort_by(Axis.Z)[-1])",
          "tray = tray - Pos(24, -20, 2) * Cylinder(2.5, 10, rotation=(90, 0, 0))",
          'show(tray, name="Tray")',
          'show(Pos(100, 0, 0) * bent([(-20, 20), (-20, 0), (20, 0), (20, 20)], 1.5, 0.75, 60), name="Tight")',
          'show(Pos(200, 0, 0) * bent([(-20, 20), (-20, 0), (20, 0), (20, 20)], 1.5, 1.5, 60), name="Channel")',
        ].join("\n"),
      });

      expect(said).not.toMatch(/Tray, bent/);
      expect(said).toMatch(
        /Tight, bent from 1\.5 mm sheet with 2 bends: a bend at \(.*\) with an inside radius of 0\.75 mm, under the 1\.5 mm thickness/,
      );
      expect(said).not.toContain("Channel, bent");
    }, 120_000);

    it("says nothing of sound parts: a plain shelled box, a cast housing with bosses at the guidelines, a sound U channel and a printed bracket", async () => {
      const said = await build({
        code: [
          "from build123d import *",
          "box = Box(60, 40, 20) - Pos(0, 0, 2) * Box(56, 36, 20)",
          "body = cast(Rectangle(60, 40), 20, draft=1)",
          "housing = offset(body, amount=-2, openings=body.faces().sort_by(Axis.Z)[-1])",
          // Ø5 round a Ø2.6 hole: a wall of 1.2 mm, 0.6 of the 2 mm floor.
          "for x in (-20, 20):",
          "    housing = boss(housing, (x, 0, 2), 5, 6, hole=2.6)",
          "path = fillet(Polyline((-20, 20), (-20, 0), (20, 0), (20, 20)).vertices()[1:-1], 1.5 + 0.75)",
          "channel = extrude(Plane.XZ * make_face(offset(path, amount=0.75, side=Side.BOTH, kind=Kind.ARC)), amount=30, both=True)",
          "leg = fillet(Polyline((0, 30), (0, 0), (30, 0)).vertices()[1:-1], 3 + 1.5)",
          "bracket = extrude(Plane.XZ * make_face(offset(leg, amount=1.5, side=Side.BOTH, kind=Kind.ARC)), amount=10, both=True)",
          "bracket = bracket - Pos(8, 0, 0) * Cylinder(2, 10)",
          'show(box, name="Box")',
          'show(Pos(0, 100, 0) * box, name="Moulded box", making="moulded")',
          'show(Pos(100, 0, 0) * housing, name="Housing")',
          'show(Pos(200, 0, 0) * channel, name="Channel")',
          'show(Pos(300, 0, 0) * bracket, name="Bracket")',
        ].join("\n"),
        exports: [{ path: "out/bracket.stl", parts: ["Bracket"] }],
      });

      for (const name of [
        "Box",
        "Moulded box",
        "Housing",
        "Channel",
        "Bracket",
      ])
        expect(said).not.toMatch(
          new RegExp(
            `^${name}(, (moulded|bent|milled|flat|shown)| holds| could not|: (walls|the rib|the boss))`,
            "m",
          ),
        );
    }, 120_000);

    it("takes a part cast with the helper and then shelled for moulded", async () => {
      const said = await build({
        code: [
          "from build123d import *",
          "body = cast(Rectangle(60, 40), 20, draft=1)",
          "housing = offset(body, amount=-2, openings=body.faces().sort_by(Axis.Z)[-1])",
          // Ø7 round a Ø2.5 hole on its 2 mm floor: a wall of 2.25 mm, over 0.6 of the floor.
          "for x in (-20, 20):",
          "    housing = boss(housing, (x, 0, 2), 7, 8, hole=2.5)",
          'show(housing, name="Housing")',
        ].join("\n"),
      });

      expect(said).toContain(
        "Housing: the boss at (-20, 0, 2), Ø7 round a Ø2.5 hole, has a wall of 2.25 mm, over the 1.2 mm (0.6 of the 2 mm wall beside it) that keeps the face behind it from sinking.",
      );
    }, 120_000);

    it("takes a part a draft requirement names by a pattern for moulded", async () => {
      await mkdir(join(root, "patterned"), { recursive: true });
      await writeFile(
        join(root, "patterned", "part.py"),
        [
          "from build123d import *",
          'show(Box(20, 20, 20) - Pos(5, 0, 0) * Box(10, 30, 8), name="Body left")',
        ].join("\n"),
      );
      await writeFile(
        join(root, "patterned", "requirements.json"),
        JSON.stringify({
          requirements: [
            { id: "D1", check: "draft", part: "/Body.*/", min: 0 },
          ],
        }),
      );
      const said = await build({ file: "patterned/part.py" });

      expect(said).toContain(
        "Body left, moulded (its draft requirement) along +Z: 2 faces, 400 mm², trapped",
      );
    }, 120_000);

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

    it("checks a flat part shown as sheet for holes near its edge, and says a part shown as sheet whose folds have no bend has none", async () => {
      const said = await build({
        code: [
          "from build123d import *",
          "flat = Box(50, 30, 2) - Pos(22, 0, 0) * Cylinder(2, 4)",
          // Folded square, with no inside or outside round.
          "folded = Box(40, 20, 2) + Pos(-19, 0, 10) * Box(2, 20, 20)",
          'show(flat, name="Flat", making="sheet")',
          'show(Pos(100, 0, 0) * folded, name="Folded", making="sheet")',
        ].join("\n"),
      });

      expect(said).toContain(
        "Flat, flat 2 mm sheet: a Ø4 hole at (22, 0, 0) 1 mm from an edge, under the 4 mm (2 thicknesses) a 2 mm sheet keeps.",
      );
      expect(said).toContain(
        "Folded, shown as sheet, has no bend of one thickness to check:",
      );
    }, 120_000);

    it("says a check the kernel cannot make of a part whose way is known, and nothing of one whose way is not", async () => {
      // So small that no facet of its mesh has an area to measure.
      const said = await build({
        code: [
          "from build123d import *",
          'show(Box(5e-7, 5e-7, 5e-7), name="Speck", making="moulded")',
          'show(Pos(1, 0, 0) * Box(5e-7, 5e-7, 5e-7), name="Mote")',
        ].join("\n"),
      });

      expect(said).toContain(
        "Speck could not be checked for the way it is made: its mesh has no facet large enough to measure.",
      );
      expect(said).not.toContain("Mote could not");
    }, 120_000);

    it("gives a small part's measures to three figures, never as 0", async () => {
      const said = await build({
        code: [
          "from build123d import *",
          'show(Box(0.1, 0.1, 0.1) - Box(0.05, 0.05, 0.05), name="Bead")',
        ].join("\n"),
      });

      expect(said).toContain(
        "Bead holds 1 closed void inside it, where none can be: 0.000125 mm³, 0.05 × 0.05 × 0.05 mm about (0, 0, 0).",
      );
    }, 120_000);

    it("says a closed void in a part for printing prints sealed, and no more", async () => {
      const said = await build({
        code: [
          "from build123d import *",
          'show(Box(20, 20, 20) - Box(10, 10, 10), name="Hollow")',
        ].join("\n"),
        exports: [{ path: "out/hollow.stl", parts: ["Hollow"] }],
      });

      expect(said).toContain(
        "Hollow holds 1 closed void inside it: 1000 mm³, 10 × 10 × 10 mm about (0, 0, 0). It prints sealed.",
      );
      expect(said).not.toContain("No tool or mould reaches");
    }, 120_000);

    it("takes a part with a draft requirement, or cast with the helper, as moulded along its pull", async () => {
      await mkdir(join(root, "drafted"), { recursive: true });
      await writeFile(
        join(root, "drafted", "part.py"),
        [
          "from build123d import *",
          "slotted = Box(20, 20, 20) - Pos(5, 0, 0) * Box(10, 30, 8)",
          "body = cast(Rectangle(20, 20), 20, draft=2)",
          "body = body - Pos(0, 0, 10) * Box(30, 10, 4)",
          'show(Pos(50, 0, 0) * slotted, name="Slotted")',
          'show(body, name="Body")',
          // Narrowing upward: one way out, unless the mould parts half way up.
          'show(Pos(100, 0, 0) * extrude(Rectangle(20, 20), 20, taper=3), name="Whole")',
          'show(Pos(150, 0, 0) * extrude(Rectangle(20, 20), 20, taper=3), name="Parted")',
        ].join("\n"),
      );
      await writeFile(
        join(root, "drafted", "requirements.json"),
        JSON.stringify({
          requirements: [
            {
              id: "D1",
              check: "draft",
              part: "Slotted",
              min: 0,
              pull: [0, 0, 1],
            },
            { id: "D2", check: "draft", part: "Whole", min: 0 },
            { id: "D3", check: "draft", part: "Parted", min: 0, parting: 10 },
          ],
        }),
      );
      const said = await build({ file: "drafted/part.py" });

      expect(said).toContain(
        "Slotted, moulded (its draft requirement) along +Z: 2 faces, 400 mm², trapped",
      );
      expect(said).toMatch(
        /Body, moulded \(cast\(\)\) along \+Z: 2 faces, [\d.]+ mm², trapped .* a side action along \+X or -X frees it/,
      );
      // Below the parting, the half leaving downward meets the sides widening toward the foot.
      expect(said).toMatch(
        /Parted, moulded \(its draft requirement\) along \+Z: 4 faces, [\d.]+ mm², trapped/,
      );
      expect(said).not.toContain("Whole, moulded");
    }, 120_000);

    it("names a section of a moulded part thicker than its nominal wall allows, and nothing of an even shell", async () => {
      const said = await build({
        code: [
          "from build123d import *",
          "tray = Box(40, 30, 20) - Pos(0, 0, 2) * Box(36, 26, 20)",
          // A solid boss inside the tray, 10 mm across on its 2 mm floor.
          "bossed = Pos(60, 0, 0) * (tray + Pos(0, 0, -8) * Cylinder(5, 8, align=(Align.CENTER, Align.CENTER, Align.MIN)))",
          'show(tray, name="Tray", making="moulded")',
          'show(bossed, name="Bossed", making="moulded")',
        ].join("\n"),
      });

      expect(said).toMatch(
        /Bossed: walls 2 mm nominal, thicker than the 2\.6 mm \(1\.3 × nominal\) a moulded wall keeps to, corners included, over \d+% of its surface, in 1 place: (9\.\d+|10) mm at \((59|6\d)(\.\d+)?, [-\d.]+, [-\d.]+\)\. A thick section sinks and holds voids as it cools; core it out to the nominal wall\./,
      );
      expect(said).not.toContain("Tray: walls");
    }, 120_000);

    it("names a rib or a boss thicker or taller than the wall it stands on allows, on a moulded part, and none that keeps to it", async () => {
      const said = await build({
        code: [
          "from build123d import *",
          "plate = Box(80, 40, 2)",
          // On the 2 mm plate: a rib 3 mm thick and 8 mm tall made by the helper,
          // and by hand one 1 mm thick and 5 mm tall and one 2 mm thick and 4 mm tall.
          "plate = rib(plate, (-30, -10, 1), (-30, 10, 1), 8, 3, draft=0)",
          "plate = plate + Pos(-15, 0, 3.5) * Box(1, 20, 5)",
          "plate = plate + Pos(-36, 0, 3) * Box(2, 20, 4)",
          // A boss of 10 round a 3 mm hole, and one of 5 round 3.4.
          "plate = boss(plate, (10, 0, 1), 10, 6, hole=3)",
          "plate = boss(plate, (30, 0, 1), 5, 6, hole=3.4)",
          'show(plate, name="Cover", making="moulded")',
        ].join("\n"),
      });

      expect(said).toMatch(
        /Cover: the rib at \(-(31|28)\.5, 0, 1\), on a 2 mm wall, is 3 mm thick at its root, over the 1\.2 mm \(0\.6 of the wall\) that keeps the face behind it from sinking and 8 mm tall, over the 6 mm \(3 walls\) a mould fills and releases\./,
      );
      expect(said).toMatch(
        /Cover: the rib at \(-3[57], 0, 1\), on a 2 mm wall, is 2 mm thick at its root, over the 1\.2 mm \(0\.6 of the wall\) that keeps the face behind it from sinking\./,
      );
      expect(said).not.toMatch(/the rib at \(-1[45]\.5/);
      expect(said).toContain(
        "Cover: the boss at (10, 0, 1), Ø10 round a Ø3 hole, has a wall of 3.5 mm, over the 1.2 mm (0.6 of the 2 mm wall beside it) that keeps the face behind it from sinking.",
      );
      expect(said).not.toContain("the boss at (30");
    }, 120_000);

    it("takes no pad, boss, lip, filleted bracket or ribbed grid within the guidelines for a rib past its limits, on a moulded part", async () => {
      const said = await build({
        code: [
          "from build123d import *",
          "plate = Box(80, 40, 2)",
          // A square mounting pad and a boss: neither is a rib.
          'show(pad(plate, (0, 0, 1), (20, 20), 4), name="Pad", making="moulded")',
          'show(Pos(100, 0, 0) * boss(plate, (0, 0, 1), 8, 6), name="Boss", making="moulded")',
          // An enclosure base, 2 mm walls, with a locating lip 1 mm thick and
          // 2 mm tall on its rim, flush with the inside wall.
          "box = Box(60, 40, 20, align=(Align.CENTER, Align.CENTER, Align.MIN)) - Pos(0, 0, 2) * Box(56, 36, 20, align=(Align.CENTER, Align.CENTER, Align.MIN))",
          "lip = Pos(0, 0, 20) * (Box(58, 38, 2, align=(Align.CENTER, Align.CENTER, Align.MIN)) - Box(56, 36, 2, align=(Align.CENTER, Align.CENTER, Align.MIN)))",
          'show(Pos(0, 100, 0) * (box + lip), name="Base", making="moulded")',
          // Its lid: a 2 mm plate with a lip 1 mm thick and 3 mm tall below it, inset 2 mm.
          "lid = Box(60, 40, 2) + Pos(0, 0, -2.5) * (Box(56, 36, 3) - Box(54, 34, 3))",
          'show(Pos(100, 100, 0) * lid, name="Lid", making="moulded")',
          // An L bracket of 2 mm, its root and outer edges rounded.
          "bracket = Box(30, 20, 2, align=(Align.MIN, Align.CENTER, Align.MIN)) + Box(2, 20, 20, align=(Align.MIN, Align.CENTER, Align.MIN))",
          "bracket = fillet(bracket.edges().filter_by(Axis.Y), 0.5)",
          'show(Pos(0, 200, 0) * bracket, name="Bracket", making="moulded")',
          // A grid of crossing ribs 1.2 mm thick and 5 mm tall on a 2 mm plate.
          "grid = Box(60, 60, 2)",
          "for k in (-20, 0, 20):",
          "    grid = grid + Pos(k, 0, 3.5) * Box(1.2, 50, 5) + Pos(0, k, 3.5) * Box(50, 1.2, 5)",
          'show(Pos(100, 200, 0) * grid, name="Grid", making="moulded")',
          // A cover shelled to 2 mm, open below, its upright and top edges rounded.
          "outer = fillet(Box(60, 40, 20).edges().filter_by(Axis.Z), 5)",
          "outer = fillet(outer.edges().group_by(Axis.Z)[-1], 3)",
          "cover = offset(outer, amount=-2, openings=outer.faces().sort_by(Axis.Z)[0])",
          'show(Pos(0, 300, 0) * cover, name="Cover", making="moulded")',
        ].join("\n"),
      });

      expect(said).toMatch(/Grid: a valid solid/);
      expect(said).toMatch(/Cover: a valid solid/);
      expect(said).not.toContain("the rib at");
    }, 120_000);

    it("names a milled part's inside corners along the tool that are sharp or tighter than a third of their depth, and none of a pocket rounded enough", async () => {
      const pocket = (radius: number, x: number) =>
        radius
          ? `Pos(${x}, 0, 0) * (Box(60, 40, 20) - Pos(0, 0, 5) * fillet(Box(30, 20, 10).edges().filter_by(Axis.Z), ${radius}))`
          : `Pos(${x}, 0, 0) * (Box(60, 40, 20) - Pos(0, 0, 5) * Box(30, 20, 10))`;
      const said = await build({
        code: [
          "from build123d import *",
          `show(${pocket(0, 0)}, name="Sharp", making="milled")`,
          `show(${pocket(1, 100)}, name="Tight", making="milled")`,
          // Its corners rounded enough, and a drilled hole, which is no corner.
          `show(${pocket(4, 200)} - Pos(200, 15, 0) * Cylinder(3, 20), name="Easy", making="milled")`,
        ].join("\n"),
      });

      expect(said).toMatch(
        /Sharp, milled with the tool along Z: 4 sharp inside corners along the tool, where an end mill leaves its own radius: 10 mm deep at \(-?15, -?10, 5\), /,
      );
      expect(said).toMatch(
        /Tight, milled with the tool along Z: 4 inside corners rounded tighter than a third of their depth, the smallest tool that reaches it: R1 10 mm deep at \([-\d.]+, [-\d.]+, 5\), under R3\.33/,
      );
      expect(said).not.toContain("Easy, milled");
    }, 120_000);

    it("names a sheet part's tight bend, short flange and holes too near a bend or an edge, and nothing of one bent to the rules", async () => {
      // An L of 2 mm sheet, bent about Y with the inside radius given, its legs
      // `up` tall and `along` long past the bend.
      const bracket = (inner: number, up: number, along: number) =>
        [
          `t, r = 2, ${inner}`,
          "c = r + t",
          `leg_up = Pos(0, 0, c) * Box(t, 20, ${up}, align=(Align.MIN, Align.CENTER, Align.MIN))`,
          `leg_along = Pos(c, 0, 0) * Box(${along}, 20, t, align=(Align.MIN, Align.CENTER, Align.MIN))`,
          "ring = Cylinder(c, 20, rotation=(90, 0, 0)) - Cylinder(r, 20, rotation=(90, 0, 0))",
          "bend = Pos(c, 0, c) * (ring & Pos(-c / 2, 0, -c / 2) * Box(c, 20, c))",
          "part = leg_up + leg_along + bend",
        ].join("\n");
      const said = await build({
        code: [
          "from build123d import *",
          bracket(1, 6, 40),
          // A hole 3 mm from the bend.
          "bad = part - Pos(3 + 3 + 2, 0, 0) * Cylinder(2, 10)",
          // And one 1 mm from the long leg's far end, at 43.
          "bad = bad - Pos(40, 0, 0) * Cylinder(2, 10)",
          bracket(2, 30, 40),
          "good = part - Pos(4 + 20, 0, 0) * Cylinder(2, 10)",
          'show(bad, name="Bad")',
          'show(Pos(0, 60, 0) * good, name="Good")',
          // Said to be sheet, it is checked the same and not told why it was taken for sheet.
          'show(Pos(0, 120, 0) * bad, name="Said", making="sheet")',
        ].join("\n"),
      });
      expect(said).toMatch(
        /Said, bent from 2 mm sheet with 1 bend: a bend at .*a 2 mm sheet keeps\.\n/,
      );

      expect(said).toMatch(
        /Bad, bent from 2 mm sheet with 1 bend: a bend at \(.*\) with an inside radius of 1 mm, under the 2 mm thickness, which cracks the outside of most sheet; a flange 6 mm long at \(.*\), under the 8 mm \(4 thicknesses\) a press brake holds; a Ø4 hole at \(8, 0, 1\) 3 mm from a bend, under the 6 mm \(2\.5 thicknesses and the bend's 1 mm radius\) that keeps it round as the sheet bends; .*\. It is taken for sheet by its shape: show it with making= naming how it is made, if not\./,
      );
      expect(said).toMatch(
        /Bad, bent from .*; a Ø4 hole at \(40, 0, 1\) 1 mm from an edge, under the 4 mm \(2 thicknesses\) a 2 mm sheet keeps[;.]/,
      );
      expect(said).not.toContain("Good, bent");
    }, 120_000);

    it("says how many triangles a file for printing holds and that its mesh closes", async () => {
      const said = await build({
        code: [
          "from build123d import *",
          'show(Box(20, 20, 10) - Cylinder(4, 10), name="Washer")',
        ].join("\n"),
        exports: [{ path: "out/washer.stl", parts: ["Washer"] }],
      });

      expect(said).toMatch(
        /Wrote out\/washer\.stl \(\d+ KB\), meshed for printing, no facet more than [\d.]+ mm from the surface, [\d,]+ triangles, closed: Washer\./,
      );
    }, 120_000);
  },
);
