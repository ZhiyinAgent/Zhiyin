/**
 * Sheet metal with the sheet() helper and the bend requirement, in a real
 * build123d: an outline folded to the outside sizes drawn, its flat pattern
 * shorter by what each bend takes up and drawn to a DXF, reliefs where a
 * bend ends inside the sheet, flanges that run into each other at a corner,
 * hems and jogs, and the sheet-metal rules checked with their margins.
 * Skipped unless the CAD environment's Python is named, as the other
 * real-CAD tests are:
 *
 *   $env:ZHIYIN_CAD_PYTHON = "…\cad\Scripts\python.exe"; npx vitest run --project "system-boundary*" packages/feature/cad-studio/system-boundary/real-cad-sheet.test.ts
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
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
 * A channel 40 mm across and 60 long, 2 mm sheet, both sides folded up 20 mm
 * with a 2 mm inside radius, and its flat pattern shown beside it.
 */
const channel = [
  "from build123d import *",
  "c = sheet([(0, 0), (40, 0), (40, 60), (0, 60)], 2, bends=[",
  '    {"kind": "flange", "edge": ((0, 0), (0, 60)), "length": 20},',
  '    {"kind": "flange", "edge": ((40, 0), (40, 60)), "length": 20},',
  "])",
  'show(c, name="Channel", making="sheet")',
  'show(Pos(0, 100, 0) * c.flat, name="Flat")',
].join("\n");

describe.skipIf(!python)("sheet metal, with a real build123d", () => {
  let root: string;
  let run: (name: string, args: Record<string, unknown>) => Promise<Result>;
  const text = (result: Result) => result.content[0]?.text ?? "";
  const build = async (lines: string[]) => {
    const result = await run("cad_build", { code: lines.join("\n") });
    if (result.isError) throw new Error(text(result));
    return text(result);
  };
  /** A build of a script with its requirements file beside it. */
  const checked = async (
    folder: string,
    lines: string[],
    requirements: unknown[],
  ) => {
    await mkdir(join(root, folder), { recursive: true });
    await writeFile(join(root, folder, "part.py"), lines.join("\n"));
    await writeFile(
      join(root, folder, "requirements.json"),
      JSON.stringify({ requirements }),
    );
    const result = await run("cad_build", { file: `${folder}/part.py` });
    if (result.isError) throw new Error(text(result));
    return text(result);
  };

  beforeAll(async () => {
    root = await folders.make("zhiyin-real-cad-sheet-");
    const data = await folders.make("zhiyin-real-cad-sheet-data-");
    const tools = cadAutomation(await confinedPython(), {
      workspaceRoot: () => root,
      harness,
      directory: join(data, "cad-studio"),
    });
    run = async (name, args) => {
      const asked = await tools.inspect(name, args);
      if (!asked.ok) throw new Error(asked.reason);
      return (await tools.callTool(
        name,
        args,
        undefined,
        asked.identity,
      )) as Result;
    };
  }, 30_000);

  afterAll(() => folders.removeAll());

  it("folds an outline to the outside sizes drawn, its flat pattern shorter by what each bend takes up", async () => {
    const said = await build([channel]);

    // r = t = 2: K = (0.65 + 0.5 log10 1) / 2 = 0.325; each bend's
    // allowance (2 + 0.325 × 2) × π/2 = 4.16 mm and setback (r + t) tan 45°
    // = 4 mm, so the flat is 40 + 2 × 20 − 2 × (2 × 4 − 4.16) = 72.33 mm
    // across, each bend line midway through its allowance, 4 − 4.16 / 2 =
    // 1.92 mm in from where the outline drew the fold.
    expect(said).toContain(
      "- sheet: 2 mm thick, 2 bends, inside radius 2 mm, K 0.325; the flat pattern is 72.33 × 60 mm, from (-16.16, 0) to (56.16, 60); the part is 40 × 60 × 20 mm, a valid solid. Bend lines on the flat pattern: flange 1 (1.92, 0) to (1.92, 60), up 90°, allowance 4.16 mm; flange 2 (38.08, 0) to (38.08, 60), up 90°, allowance 4.16 mm. Show part.flat as a part of its own, apart from the bent part, and draw its top view to a .dxf with cad_draw for cutting.",
    );
    // Shown as sheet, it keeps every limit the build checks unasked.
    expect(said).not.toContain("Channel, bent from");
  }, 120_000);

  it("draws the flat pattern's top view to a DXF at the size it was worked out", async () => {
    const result = await run("cad_draw", {
      code: channel,
      parts: ["Flat"],
      views: [{ view: "top" }],
      dimensions: [
        {
          view: "top",
          kind: "overall",
          direction: "horizontal",
          expect: 72.33,
        },
      ],
      outputs: [{ path: "flat.dxf", view: "top" }],
    });

    expect(result.isError, text(result)).toBeUndefined();
    // Its outline at full size: the x and y of every point of its entities
    // (group codes 10 and 20) span the flat's 72.33 × 60 mm.
    const dxf = await readFile(join(root, "flat.dxf"), "utf8");
    const start = dxf.indexOf("ENTITIES");
    const entities = dxf.slice(start, dxf.indexOf("ENDSEC", start));
    expect(entities).toMatch(/\nLWPOLYLINE\r?\n/);
    const span = (code: number) => {
      const values = [
        ...entities.matchAll(
          new RegExp(`\\n\\s*${code}\\r?\\n\\s*(-?[\\d.]+)`, "g"),
        ),
      ].map((one) => Number(one[1]));
      return Math.max(...values) - Math.min(...values);
    };
    expect(span(10)).toBeCloseTo(72.325, 2);
    expect(span(20)).toBeCloseTo(60, 2);
  }, 180_000);

  it("cuts a relief where a flange narrower than its edge ends inside the sheet, and says where one is missing", async () => {
    const tab = (relief: string) => [
      "from build123d import *",
      `part = sheet([(0, 0), (50, 0), (50, 30), (0, 30)], 2, bends=[{"kind": "flange", "edge": ((10, 0), (30, 0)), "length": 15}], relief=${relief})`,
      'show(part, name="Tab")',
    ];
    const cut = await build(tab("True"));
    const torn = await build(tab("False"));

    expect(cut).toContain("2 reliefs cut where a bend ends inside the sheet.");
    expect(torn).toContain(
      "flange 1 ends inside the sheet at (10, 0) with no relief, where the sheet tears as it bends. flange 1 ends inside the sheet at (30, 0) with no relief, where the sheet tears as it bends.",
    );
  }, 120_000);

  it("says where flanges meeting at a corner run into each other, and folds a hem and a jog to their sizes", async () => {
    const said = await build([
      "from build123d import *",
      "box = sheet([(0, 0), (60, 0), (60, 40), (0, 40)], 1.5, bends=[",
      '    {"kind": "flange", "edge": ((0, 0), (60, 0)), "length": 20},',
      '    {"kind": "flange", "edge": ((0, 0), (0, 40)), "length": 20},',
      "])",
      'hem = sheet([(0, 0), (40, 0), (40, 30), (0, 30)], 1, bends=[{"kind": "hem", "edge": ((0, 30), (40, 30)), "length": 8}])',
      'jog = sheet([(0, 0), (80, 0), (80, 30), (0, 30)], 2, bends=[{"kind": "jog", "line": ((50, 0), (50, 30)), "offset": 10}])',
      'show(box, name="Box")',
      'show(Pos(100, 0, 0) * hem, name="Hem")',
      'show(Pos(0, 100, 0) * jog, name="Jog")',
    ]);

    // Both flanges reach the corner, each 1.5 mm thick, from where their
    // bends end, r + t = 3 mm up, to 20: a 1.5 × 1.5 × 17 column they share.
    expect(said).toContain(
      "Two folded flats of the sheet run into each other by 38.25 mm³ at (0.75, 0.75, 11.5), as flanges meeting at a corner do: draw one of them shorter there by the thickness and a gap.",
    );
    // A hem of 1 mm sheet with a 0.5 mm inside radius lies 2 × (0.5 + 1) = 3 mm thick.
    expect(said).toContain(
      "the flat pattern is 40 × 37.36 mm, from (0, 0) to (40, 37.36); the part is 40 × 30 × 3 mm, a valid solid. Bend lines on the flat pattern: hem 1 (0, 29.68) to (40, 29.68), up 180°, allowance 2.36 mm.",
    );
    // The side past the line, holding less of the outline, steps up 10 mm:
    // its underside at 10, its top at 12.
    expect(said).toContain(
      "the part is 66 × 30 × 12 mm, a valid solid. Bend lines on the flat pattern: jog 1 (48.08, 0) to (48.08, 30), up 90°, allowance 4.16 mm; jog 1 (56.24, 0) to (56.24, 30), down 90°, allowance 4.16 mm.",
    );
  }, 120_000);

  it("refuses a bend line that does not part the sheet, saying to run it from edge to edge", async () => {
    const result = await run("cad_build", {
      code: [
        "from build123d import *",
        'show(sheet([(0, 0), (30, 0), (30, 40), (0, 40)], 2, bends=[{"line": ((5, 20), (25, 20))}]), name="Plate")',
      ].join("\n"),
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain(
      "bend 1 from (5, 20) to (25, 20) does not part the sheet: run its line from edge to edge, or cut the outline to where it ends.",
    );
  }, 120_000);

  it("holds the sheet-metal rules from the thickness, each with its margin, and fails each one broken", async () => {
    // 2 mm sheet, a base 60 × 40 with a flange folded up along y = 40.
    const tray = (fold: string, holes: string[]) => [
      "from build123d import *",
      `outline = Rectangle(60, 40, align=Align.MIN)${holes.map((one) => ` - Pos(${one}) * Circle(2)`).join("")}`,
      `part = sheet(outline, 2, bends=[${fold}], relief=False)`,
      'show(part, name="Tray", making="sheet")',
    ];
    const rules = [{ id: "B1", check: "bend", part: "Tray", rules: true }];
    // The flange the whole edge long, 20 mm tall, R2; a Ø4 hole whose edge
    // is 19 mm from where the bend starts at y = 36, and 13 mm from the edge at y = 0.
    const good = await checked(
      "good-tray",
      tray('{"kind": "flange", "edge": ((0, 40), (60, 40)), "length": 20}', [
        "30, 15",
      ]),
      rules,
    );
    // A flange 20 mm wide and 6 tall in the middle of the edge, R1, with no
    // relief; one hole 5 mm from where the bend starts at y = 37 and one 3
    // mm from the edge at x = 0.
    const bad = await checked(
      "bad-tray",
      tray(
        '{"kind": "flange", "edge": ((20, 40), (40, 40)), "length": 6, "radius": 1}',
        ["30, 30", "5, 20"],
      ),
      rules,
    );

    expect(good).toMatch(
      new RegExp(
        `- B1 holds: Tray is sheet 2 mm thick with 1 bend; the tightest inside radius is 2 mm, at ${at}, where at least 2 mm \\(the thickness\\) is asked: 0 mm to spare; the shortest flange runs 16 mm past its bend, at ${at}, where at least 8 mm \\(4 thicknesses\\) is asked: 8 mm to spare; the nearest hole is 19 mm from a bend, at \\(30, 15, 1\\), where at least 7 mm \\(2\\.5 thicknesses and the bend's 2 mm radius\\) is asked: 12 mm to spare; the nearest hole is 13 mm from an edge, at \\(30, 15, 1\\), where at least 4 mm \\(2 thicknesses\\) is asked: 9 mm to spare; every bend ends at the sheet's edge or a relief; 0 mm to spare\\.`,
      ),
    );
    expect(bad).toMatch(
      new RegExp(
        `- B1 fails: Tray is sheet 2 mm thick with 1 bend; the tightest inside radius is 1 mm, at ${at}, where at least 2 mm \\(the thickness\\) is asked: 1 mm short; the shortest flange runs 3 mm past its bend, at ${at}, where at least 8 mm \\(4 thicknesses\\) is asked: 5 mm short; the nearest hole is 5 mm from a bend, at \\(30, 30, 1\\), where at least 6 mm \\(2\\.5 thicknesses and the bend's 1 mm radius\\) is asked: 1 mm short; the nearest hole is 3 mm from an edge, at \\(5, 20, 1\\), where at least 4 mm \\(2 thicknesses\\) is asked: 1 mm short; 2 bend ends lie inside the sheet with no relief, at \\((20|40), 37, 2\\), \\((20|40), 37, 2\\), where the sheet tears as it bends\\.`,
      ),
    );
  }, 180_000);

  it("says the same of a hole near a bend or an edge unasked as the bend requirement does by the rules", async () => {
    // 2 mm sheet, a flange the whole edge long with a 2 mm inside radius,
    // its bend starting at y = 36. A Ø4 hole whose edge is 7.5 mm from the
    // bend, where the rules ask 2.5 × 2 + 2 = 7, and one 3.5 mm from the
    // edge at x = 0, where they ask 2 × 2 = 4.
    const said = await checked(
      "one-rule-tray",
      [
        "from build123d import *",
        "outline = Rectangle(60, 40, align=Align.MIN) - Pos(30, 26.5) * Circle(2) - Pos(5.5, 15) * Circle(2)",
        'part = sheet(outline, 2, bends=[{"kind": "flange", "edge": ((0, 40), (60, 40)), "length": 20}])',
        'show(part, name="Tray", making="sheet")',
      ],
      [{ id: "B1", check: "bend", part: "Tray", rules: true }],
    );

    expect(said).toMatch(
      /the nearest hole is 7\.5 mm from a bend, at \(30, 26\.5, 1\), where at least 7 mm \(2\.5 thicknesses and the bend's 2 mm radius\) is asked: 0\.5 mm to spare/,
    );
    expect(said).toMatch(
      /the nearest hole is 3\.5 mm from an edge, at \(5\.5, 15, 1\), where at least 4 mm \(2 thicknesses\) is asked: 0\.5 mm short/,
    );
    expect(said).toContain(
      "Tray, bent from 2 mm sheet with 1 bend: a Ø4 hole at (5.5, 15, 1) 3.5 mm from an edge, under the 4 mm (2 thicknesses) a 2 mm sheet keeps.",
    );
    expect(said).not.toContain("mm from a bend, under the");
  }, 180_000);
});
