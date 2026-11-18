/**
 * An assembly drawing as a draughtsman draws one, against a real build123d
 * and bd_warehouse: gears drawn as ISO 2203 draws them, every parts-list item
 * ballooned on a view that shows it, the overall sizes and the gears' centre
 * distance given when no dimension is asked for, and the views laid out in
 * the frame round the parts list. Skipped unless the CAD environment's
 * Python is named, as the other real-CAD tests are:
 *
 *   $env:ZHIYIN_CAD_PYTHON = "…\cad\Scripts\python.exe"; npx vitest run --project system-boundary packages/feature/cad-studio/system-boundary/real-cad-drawing-assembly.test.ts
 */

import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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

type Entity = {
  readonly type: string;
  readonly layer: string;
  readonly points: readonly (readonly [number, number])[];
  readonly radius?: number;
};

/** The entities of a DXF file: each one's type, layer, points and radius. */
function entities(dxf: string): Entity[] {
  const lines = dxf.split(/\r?\n/);
  const found: Entity[] = [];
  let current: {
    type: string;
    layer: string;
    xs: number[];
    ys: number[];
    radius?: number;
  } | null = null;
  const push = () => {
    if (current)
      found.push({
        type: current.type,
        layer: current.layer,
        points: current.xs.map((x, i) => [x, current!.ys[i] ?? 0] as const),
        ...(current.radius !== undefined ? { radius: current.radius } : {}),
      });
  };
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = lines[i]!.trim();
    const value = lines[i + 1]!.trim();
    if (code === "0") {
      push();
      current = { type: value, layer: "", xs: [], ys: [] };
    } else if (current && code === "8") current.layer = value;
    // A line's start, then its end.
    else if (current && (code === "10" || code === "11"))
      current.xs.push(Number(value));
    else if (current && (code === "20" || code === "21"))
      current.ys.push(Number(value));
    else if (current && code === "40") current.radius = Number(value);
  }
  push();
  return found;
}

const folders = new TemporaryFolders();

/**
 * Two of bd_warehouse's spur gears in mesh, module 2, their axes along z:
 * one of 20 teeth bored for a 6 mm shaft and moved into place, one of 10
 * teeth beside it, where their pitch circles meet, 30 mm apart.
 */
const pair = [
  "from build123d import *",
  "from bd_warehouse.gear import SpurGear",
  "big = SpurGear(module=2, tooth_count=20, pressure_angle=20, thickness=10, root_fillet=0.5)",
  "big = big - Cylinder(3, 20)",
  'show(Pos(0, 0, 5) * big, name="Gear")',
  "small = SpurGear(module=2, tooth_count=10, pressure_angle=20, thickness=10, root_fillet=0.5)",
  'show(Pos(30, 0, 5) * Rot(Z=18) * small, name="Pinion")',
].join("\n");

describe.skipIf(!python)("an assembly drawing, with a real build123d", () => {
  let root: string;
  let draw: (args: Record<string, unknown>) => Promise<Result>;
  let build: (args: Record<string, unknown>) => Promise<Result>;
  const text = (result: Result) => result.content[0]?.text ?? "";

  beforeAll(async () => {
    root = await folders.make("zhiyin-real-cad-assembly-workspace-");
    const data = await folders.make("zhiyin-real-cad-assembly-data-");
    const tools = cadAutomation(await confinedPython(), {
      workspaceRoot: () => root,
      harness,
      directory: join(data, "cad-studio"),
    });
    const call = async (name: string, args: Record<string, unknown>) => {
      const asked = await tools.inspect(name, args);
      if (!asked.ok) throw new Error(asked.reason);
      return (await tools.callTool(
        name,
        args,
        undefined,
        asked.identity,
      )) as Result;
    };
    draw = (args) => call("cad_draw", args);
    build = (args) => call("cad_build", args);
  }, 30_000);

  afterAll(() => folders.removeAll());

  it("draws gears as solids bounded by their tips, with their pitch circles in chain line, and gives their overall sizes and centre distance", async () => {
    const result = await draw({
      code: pair,
      views: [{ view: "top" }, { view: "front" }],
      outputs: [{ path: "drawings/pair.dxf" }],
    });
    const answer = text(result);

    expect(result.isError, answer).toBeUndefined();
    // On the front view, across both tips, from the large gear's at -22 to
    // the small one's at 30 + 12, and up the face width; on the top view,
    // which looks along their axes, the large tip circle's 44 deep, and the
    // 30 between the axes.
    expect(answer).toContain("Dimensions on front: 64, 10.");
    expect(answer).toContain("Dimensions on top: 44, 30.");
    expect(answer).toContain(
      "No dimensions asked for, so the drawing gives the overall sizes and the distance between the axes of each pair of gears in mesh. Give dimensions to choose them, or dimensions: [] for none.",
    );
    const drawn = entities(
      await readFile(join(root, "drawings", "pair.dxf"), "utf8"),
    );
    const circles = drawn.filter((one) => one.type === "CIRCLE");
    const tips = circles
      .filter((one) => one.layer === "VISIBLE")
      .sort((a, b) => b.radius! - a.radius!);
    const tip = tips[0]!;
    // The large gear's tip, 22 mm, and its pitch circle, 20 mm, about one centre, at the sheet's scale.
    const pitch = circles.find(
      (one) =>
        one.layer === "CENTRE" &&
        Math.abs(one.radius! / tip.radius! - 20 / 22) < 1e-3 &&
        Math.hypot(
          one.points[0]![0] - tip.points[0]![0],
          one.points[0]![1] - tip.points[0]![1],
        ) < 1e-6,
    );
    expect(pitch).toBeDefined();
    // No tooth's edges: the gears' outlines and the bore's are a few lines
    // and circles, where 30 teeth seen along and across would draw hundreds.
    const visible = drawn.filter((one) => one.layer === "VISIBLE");
    expect(visible.length).toBeLessThan(30);
    // Seen across their axes, on the front view, the face width's lines up
    // the sheet: each gear's outer tip line, and in the mesh, where neither
    // hides the other, both inner ones, drawn as seen.
    const upright = visible.filter(
      (one) =>
        one.type === "LWPOLYLINE" &&
        one.points.length === 2 &&
        Math.abs(one.points[0]![0] - one.points[1]![0]) < 1e-6,
    );
    const height = (one: Entity) =>
      Math.abs(one.points[0]![1] - one.points[1]![1]);
    const tallest = Math.max(...upright.map(height));
    expect(
      upright.filter((one) => Math.abs(height(one) - tallest) < 1e-6),
    ).toHaveLength(4);
  }, 240_000);

  it("draws a bought bearing as its outline, and in a section through its axis unhatched with a cross in each half", async () => {
    const code = [
      "from build123d import *",
      "from bd_warehouse.bearing import SingleRowDeepGrooveBallBearing",
      'show(SingleRowDeepGrooveBallBearing("M8-22-7", "SKT"), name="Bearing")',
    ].join("\n");
    for (const [views, path] of [
      [[{ view: "front" }], "drawings/bearing-view.dxf"],
      [
        [
          { view: "top" },
          { section: "A", looking: "front", through: [0, 0, 0] },
        ],
        "drawings/bearing-section.dxf",
      ],
    ] as const) {
      const result = await draw({
        code,
        views,
        dimensions: [],
        outputs: [{ path }],
      });
      expect(result.isError, text(result)).toBeUndefined();
    }
    const of = async (file: string) =>
      entities(await readFile(join(root, "drawings", file), "utf8"));
    const seen = await of("bearing-view.dxf");
    const cut = await of("bearing-section.dxf");
    const lines = (all: Entity[], layer: string) =>
      all.filter((one) => one.layer === layer && one.type === "LWPOLYLINE");

    // Seen across its axis: a rectangle and its bore hidden, all straight
    // lines, no ball or groove.
    expect(
      seen.filter(
        (one) =>
          ["VISIBLE", "HIDDEN"].includes(one.layer) &&
          (one.type !== "LWPOLYLINE" || one.points.length !== 2),
      ),
    ).toEqual([]);
    expect(lines(seen, "VISIBLE").length).toBeLessThanOrEqual(8);
    expect(lines(seen, "HIDDEN").length).toBeLessThanOrEqual(4);
    // Cut: nothing hatched, and two crosses, each two lines of one length
    // crossing square at their middles.
    expect(cut.filter((one) => one.layer === "HATCH")).toEqual([]);
    const middle = (one: Entity) =>
      one.points.length === 2
        ? `${((one.points[0]![0] + one.points[1]![0]) / 2).toFixed(2)},${((one.points[0]![1] + one.points[1]![1]) / 2).toFixed(2)}`
        : "";
    const byMiddle = new Map<string, number>();
    for (const one of lines(cut, "VISIBLE"))
      byMiddle.set(middle(one), (byMiddle.get(middle(one)) ?? 0) + 1);
    expect([...byMiddle.values()].filter((count) => count === 2)).toHaveLength(
      2,
    );
  }, 240_000);

  it("lays the angled view in the emptiest room left round the parts list, clear of the other views and the frame", async () => {
    // A gearbox sheet as boxes: a top view, four sections and the angled
    // view on A2, round a parts list of 15 rows, too tall to line up in one
    // grid at full size, so packed round the parts list.
    const script = join(root, "layout.py");
    await writeFile(
      script,
      [
        "import json, sys",
        "sys.path.insert(0, sys.argv[1])",
        "from zhiyin_cad.drafting import layout, parts_list, sheet",
        "class View:",
        "    def __init__(self, name, kind, w, h, label=None, looks_as=None):",
        "        self.name, self.kind, self.label, self.looks_as = name, kind, label, looks_as",
        "        self.box = (-w / 2, -h / 2, w / 2, h / 2)",
        "        self.circles, self.axes, self.arcs = [], [], []",
        "    def bounds(self):",
        "        return self.box",
        "views = [View('top', 'named', 111, 130)]",
        "views += [View(n, 'section', w, 115, f'SECTION {n}-{n}', 'front' if n == 'A' else 'right') for n, w in (('A', 111), ('B', 116), ('C', 119), ('D', 102))]",
        "views.append(View('iso', 'named', 132, 110))",
        "slots = [layout.Slot(v, 1, 0, 0, v.kind == 'section') for v in views]",
        "target = sheet.Sheet('A2', 'landscape')",
        "area, corner = parts_list.area(target, {'rows': [{}] * 15})",
        "scale = layout.arrange(slots, 'first', area, None, corner)",
        "boxes = {s.view.name: layout._box(s, scale) for s in slots}",
        "print(json.dumps({'scale': float(scale), 'boxes': boxes, 'area': area, 'corner': corner, 'gap': layout.GAP}))",
      ].join("\n"),
    );
    const { stdout } = await promisify(execFile)(python!, [
      script,
      dirname(harness),
    ]);
    type Box = [number, number, number, number];
    const { scale, boxes, area, corner, gap } = JSON.parse(stdout) as {
      scale: number;
      boxes: Record<string, Box>;
      area: Box;
      corner: Box;
      gap: number;
    };
    const iso = boxes["iso"]!;
    const apart = (a: Box, b: Box) =>
      Math.max(b[0] - a[2], a[0] - b[2], b[1] - a[3], a[1] - b[3]);

    expect(scale).toBe(1);
    // Above the parts list, in the quarter the packed views leave empty.
    expect(iso[1]).toBeGreaterThan(corner[3]);
    expect((iso[0] + iso[2]) / 2).toBeGreaterThan((area[0] + area[2]) / 2);
    for (const [name, box] of Object.entries(boxes))
      if (name !== "iso") expect(apart(iso, box)).toBeGreaterThanOrEqual(gap);
    // Room left between it and the frame for its balloons.
    expect(area[2] - iso[2]).toBeGreaterThan(gap);
    expect(area[3] - iso[3]).toBeGreaterThan(gap);
  }, 60_000);

  it("spreads views that line up in one grid across the room a parts list leaves, keeping them in line", async () => {
    // A gearbox about 80 × 88 × 94 mm on A2 round a parts list of 17 rows:
    // front, top and right in third-angle projection and the angled view,
    // which fit one grid at 1:1 and not at 2:1.
    const script = join(root, "aligned.py");
    await writeFile(
      script,
      [
        "import json, sys",
        "sys.path.insert(0, sys.argv[1])",
        "from zhiyin_cad.drafting import layout, parts_list, sheet",
        "class View:",
        "    def __init__(self, name, w, h):",
        "        self.name, self.kind, self.label, self.looks_as = name, 'named', None, None",
        "        self.box = (-w / 2, -h / 2, w / 2, h / 2)",
        "        self.circles, self.axes, self.arcs = [], [], []",
        "    def bounds(self):",
        "        return self.box",
        "views = [View('front', 79, 94), View('top', 79, 88), View('right', 88, 94), View('iso', 100, 108)]",
        "slots = [layout.Slot(v, 1, 0 if v.name == 'iso' else 14, 0 if v.name == 'iso' else 14, False) for v in views]",
        "target = sheet.Sheet('A2', 'landscape')",
        "area, corner = parts_list.area(target, {'rows': [{}] * 17})",
        "scale = layout.arrange(slots, 'third', area, None, corner)",
        "boxes = {s.view.name: layout._box(s, scale) for s in slots}",
        "origins = {s.view.name: s.origin for s in slots}",
        "print(json.dumps({'scale': float(scale), 'boxes': boxes, 'origins': origins, 'area': area, 'corner': corner, 'gap': layout.GAP}))",
      ].join("\n"),
    );
    const { stdout } = await promisify(execFile)(python!, [
      script,
      dirname(harness),
    ]);
    type Box = [number, number, number, number];
    const { scale, boxes, origins, area, corner, gap } = JSON.parse(stdout) as {
      scale: number;
      boxes: Record<string, Box>;
      origins: Record<string, [number, number]>;
      area: Box;
      corner: Box;
      gap: number;
    };
    const meets = (a: Box, b: Box) =>
      a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
    const apart = (a: Box, b: Box) =>
      Math.max(b[0] - a[2], a[0] - b[2], b[1] - a[3], a[1] - b[3]);
    // The largest box of the area that holds no view and keeps out of the
    // parts list's corner, as a share of the area: tried between every
    // pair of edges the views, the corner and the area have.
    const obstacles = [...Object.values(boxes), corner];
    const xs = [
      ...new Set([area[0], area[2], ...obstacles.flatMap((b) => [b[0], b[2]])]),
    ]
      .filter((x) => x >= area[0] && x <= area[2])
      .sort((a, b) => a - b);
    const ys = [
      ...new Set([area[1], area[3], ...obstacles.flatMap((b) => [b[1], b[3]])]),
    ]
      .filter((y) => y >= area[1] && y <= area[3])
      .sort((a, b) => a - b);
    let emptiest = 0;
    for (const [i, x0] of xs.entries())
      for (const x1 of xs.slice(i + 1))
        for (const [j, y0] of ys.entries())
          for (const y1 of ys.slice(j + 1)) {
            const room: Box = [x0, y0, x1, y1];
            if (!obstacles.some((b) => meets(room, b)))
              emptiest = Math.max(emptiest, (x1 - x0) * (y1 - y0));
          }
    const share = emptiest / ((area[2] - area[0]) * (area[3] - area[1]));

    expect(scale).toBe(1);
    // Front and top share a column, front and right a row.
    expect(origins["top"]![0]).toBeCloseTo(origins["front"]![0], 6);
    expect(origins["right"]![1]).toBeCloseTo(origins["front"]![1], 6);
    expect(origins["top"]![1]).toBeGreaterThan(origins["front"]![1]);
    expect(origins["right"]![0]).toBeGreaterThan(origins["front"]![0]);
    for (const [name, box] of Object.entries(boxes)) {
      expect(meets(box, corner), name).toBe(false);
      expect(box[0]).toBeGreaterThanOrEqual(area[0] - 1e-6);
      expect(box[1]).toBeGreaterThanOrEqual(area[1] - 1e-6);
      expect(box[2]).toBeLessThanOrEqual(area[2] + 1e-6);
      expect(box[3]).toBeLessThanOrEqual(area[3] + 1e-6);
      for (const [other, then] of Object.entries(boxes))
        if (other !== name)
          expect(
            apart(box, then),
            `${name} and ${other}`,
          ).toBeGreaterThanOrEqual(gap - 1e-6);
    }
    // Bunched in the left half, the views left a quarter of the area empty
    // in one piece, beside them and above the parts list; spread, with the
    // angled view in the middle of the room they leave, no piece is as
    // large as a sixth.
    expect(share).toBeLessThan(1 / 6);
  }, 60_000);

  it("marks a helical gear seen across its axis with three thin lines along its teeth", async () => {
    const result = await draw({
      code: [
        "from build123d import *",
        "from bd_warehouse.gear import HelicalGear",
        'show(HelicalGear(module=2, tooth_count=20, pressure_angle=20, helix_angle=20, thickness=12), name="Gear")',
      ].join("\n"),
      views: [{ view: "front" }],
      dimensions: [],
      outputs: [{ path: "drawings/helical.dxf" }],
    });
    expect(result.isError, text(result)).toBeUndefined();
    const thin = entities(
      await readFile(join(root, "drawings", "helical.dxf"), "utf8"),
    ).filter(
      (one) =>
        one.layer === "THIN" &&
        one.type === "LWPOLYLINE" &&
        one.points.length === 2,
    );
    // Each leaning from the upright axis by the helix angle, rising to the
    // right: bd_warehouse turns a tooth of a positive helix angle positively
    // about the axis as it rises, so its face toward the viewer runs right.
    // The title block's lines run across and up the sheet; the rest of the
    // thin layer leans.
    const leaning = thin
      .map(({ points: [a, b] }) => [b![0] - a![0], b![1] - a![1]] as const)
      .filter(([dx, dy]) => Math.hypot(dx, dy) > 1)
      .map(([dx, dy]) => (dy < 0 ? Math.atan2(-dx, -dy) : Math.atan2(dx, dy)))
      .filter(
        (angle) =>
          Math.abs(angle) > 0.01 &&
          Math.abs(Math.abs(angle) - Math.PI / 2) > 0.01,
      );
    expect(leaning).toHaveLength(3);
    for (const angle of leaning)
      expect(angle).toBeCloseTo((20 * Math.PI) / 180, 3);
  }, 240_000);

  it("gives a long material its whole cell, the other columns making room", async () => {
    const script = join(root, "columns.py");
    await writeFile(
      script,
      [
        "import json, sys",
        "sys.path.insert(0, sys.argv[1])",
        "from zhiyin_cad.drafting import lettering, parts_list",
        "from zhiyin_cad.drafting.sheet import SMALL, TITLE_WIDTH",
        "head = [name for name, _ in parts_list.COLUMNS]",
        "rows = [['3', '1', 'Motor', '', '550 DC motor (bought)', ''], ['1', '1', 'Base', '', 'PETG', '54.39']]",
        "widths = parts_list.column_widths([head, *rows])",
        "print(json.dumps({'widths': widths, 'needs': lettering.width('550 DC motor (bought)', SMALL) + 2.4, 'whole': TITLE_WIDTH}))",
      ].join("\n"),
    );
    const { stdout } = await promisify(execFile)(python!, [
      script,
      dirname(harness),
    ]);
    const { widths, needs, whole } = JSON.parse(stdout) as {
      widths: number[];
      needs: number;
      whole: number;
    };

    // Written at full size, with its margins, the material fits its cell,
    // and the columns still fill the title block's width.
    expect(widths[4]).toBeGreaterThanOrEqual(needs);
    expect(widths.reduce((sum, one) => sum + one, 0)).toBeCloseTo(whole, 6);
  }, 60_000);

  it("keeps the default dimensions off the letters of the sections' cutting planes", async () => {
    const result = await draw({
      code: pair,
      views: [
        { view: "top" },
        { view: "front" },
        { section: "B", looking: "right", through: [30, 0, 0] },
        { section: "C", looking: "right", through: [0, 0, 0] },
      ],
      outputs: [{ path: "drawings/letters.dxf" }],
    });
    expect(result.isError, text(result)).toBeUndefined();
    const drawn = entities(
      await readFile(join(root, "drawings", "letters.dxf"), "utf8"),
    );
    const ends = drawn.filter((one) => one.layer === "CUTTING-ENDS");
    const lettering = drawn
      .filter((one) => one.layer === "TEXT")
      .flatMap((one) => one.points);
    // Two planes, two ends each; round each end, where its letter stands
    // beside its arrow, no lettering but one letter's: nothing wider or
    // taller than a capital.
    expect(ends).toHaveLength(4);
    for (const { points } of ends) {
      const [x, y] = points[0]!;
      const near = lettering.filter(
        ([px, py]) => Math.hypot(px - x, py - y) < 9,
      );
      expect(near.length).toBeGreaterThan(0);
      const xs = near.map(([px]) => px);
      const ys = near.map(([, py]) => py);
      expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(4.5);
      expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(4.5);
    }
  }, 240_000);

  it("fills a parts list given no materials from a requirement naming a part's material, with its mass", async () => {
    await writeFile(
      join(root, "plate.py"),
      [
        "from build123d import *",
        'show(Box(40, 30, 5), name="Plate")',
        'show(Pos(0, 0, 10) * Cylinder(2, 10), name="Pin")',
      ].join("\n"),
    );
    await writeFile(
      join(root, "requirements.json"),
      JSON.stringify({
        requirements: [
          {
            id: "R1",
            says: "The plate weighs under 10 g",
            check: "mass",
            parts: ["Plate"],
            material: "PETG",
            max: 10,
          },
        ],
      }),
    );

    const result = await draw({
      file: "plate.py",
      views: [{ view: "front" }],
      parts_list: true,
      outputs: [{ path: "drawings/plate.dxf" }],
    });
    const answer = text(result);

    expect(result.isError, answer).toBeUndefined();
    expect(answer).toContain(
      "No materials were given, so the parts list takes them from requirements.json (R1).",
    );
    // 40 × 30 × 5 mm of PETG at 1.27 g/cm³; the pin, which no requirement
    // names, stays without.
    expect(answer).toMatch(/× Plate: made, [^,]+ mm, PETG, 7\.62 g\./);
    expect(answer).toMatch(/× Pin: made, [^,]+ mm\./);
  }, 240_000);

  it("gives a made part with no material of its own, made a known way, the title block's, with its mass, and says so", async () => {
    // In a folder of its own, away from the requirements beside the other scripts.
    await mkdir(join(root, "titled"), { recursive: true });
    await writeFile(
      join(root, "titled", "titled.py"),
      [
        "from build123d import *",
        "from bd_warehouse.fastener import SocketHeadCapScrew",
        'show(Box(40, 30, 5), name="Plate", making="printed")',
        'show(Pos(60, 0, 0) * Box(20, 20, 5), name="Bracket")',
        'show(Pos(-40, 0, 0) * Box(10, 10, 10), name="Knob")',
        'show(Pos(0, 0, 10) * Cylinder(2, 10), name="Pin")',
        'show(Pos(15, 0, 2.5) * SocketHeadCapScrew("M3-0.5", 10, "iso4762", simple=True), name="Screw")',
      ].join("\n"),
    );
    // An earlier build wrote the bracket for printing.
    const built = await build({
      file: "titled/titled.py",
      exports: [{ path: "titled/bracket.stl", parts: ["Bracket"] }],
    });
    expect(built.isError, text(built)).toBeUndefined();

    const result = await draw({
      file: "titled/titled.py",
      views: [{ view: "front" }],
      parts_list: true,
      materials: { Pin: "steel" },
      title: { material: "PETG printed parts; steel pins" },
      outputs: [{ path: "drawings/titled.dxf" }],
    });
    const answer = text(result);

    expect(result.isError, answer).toBeUndefined();
    // The title block names PETG and steel; steel is the pin's, so the
    // plate, shown as printed, and the bracket, written for printing, are
    // PETG: 40 × 30 × 5 mm and 20 × 20 × 5 mm at 1.27 g/cm³.
    expect(answer).toMatch(/× Plate: made, [^,]+ mm, PETG, 7\.62 g\./);
    expect(answer).toMatch(/× Bracket: made, [^,]+ mm, PETG, 2\.54 g\./);
    expect(answer).toMatch(/× Pin: made, [^,]+ mm, steel, [\d.]+ g\./);
    expect(answer).toContain(
      "Plate and Bracket, printed, have no material of their own, so the parts list gives them PETG, from the title block's material, PETG printed parts; steel pins; give materials to set another.",
    );
    // How the knob is made is not known, so it is not taken to be of the
    // drawing's material; a bought screw is not made of it either.
    expect(answer).toMatch(/× Knob: made, [^,]+ mm\./);
    expect(answer).toMatch(
      /× Screw: bought, [^\n]*ISO 4762[^\n]*, bd_warehouse's SocketHeadCapScrew\./,
    );
    expect(answer).toContain("No material or mass for Knob and Screw:");
    expect(answer).toContain(
      'Knob takes no material from the title block, as how it is made is not known: give it one in materials, or show it with making="printed", or the way it is made, to give it PETG.',
    );
  }, 240_000);

  it("gives no dimensions when asked for none", async () => {
    const result = await draw({
      code: pair,
      views: [{ view: "top" }],
      dimensions: [],
      outputs: [{ path: "drawings/none.pdf" }],
    });
    const answer = text(result);

    expect(result.isError, answer).toBeUndefined();
    expect(answer).toContain("No dimensions asked for.");
    expect(answer).not.toContain("Dimensions on");
  }, 240_000);

  it("balloons each item on the first view that shows it, a part hidden inside on the section that cuts it", async () => {
    const result = await draw({
      code: [
        "from build123d import *",
        "from bd_warehouse.fastener import SocketHeadCapScrew",
        "plate = Box(80, 50, 8)",
        "for x in (-30, 30):",
        "    plate -= Pos(x, 0, 0) * Cylinder(3.3, 8)",
        'show(plate, name="Plate")',
        'screw = SocketHeadCapScrew("M6-1", 20, "iso4762", simple=True)',
        'show([Pos(x, 0, 4) * screw for x in (-30, 30)], name="Screw")',
        'show(Pos(0, 60, 0) * (Box(30, 30, 30) - Box(20, 20, 20)), name="Housing")',
        'show(Pos(0, 60, 0) * Cylinder(4, 10), name="Pin")',
      ].join("\n"),
      views: [
        { view: "front" },
        { view: "top" },
        { view: "iso" },
        { section: "A", looking: "front", through: [0, 60, 0] },
      ],
      dimensions: [],
      parts_list: true,
      materials: { Plate: "aluminium", "/Screw.*/": "steel", Pin: "steel" },
      outputs: [{ path: "drawings/balloons.dxf" }],
    });
    const answer = text(result);

    expect(result.isError, answer).toBeUndefined();
    expect(answer).toContain(
      "A parts list of 4 rows from 5 parts above the title block, each item ballooned on the first view that shows it: items 1–3 on the iso view and item 4 on section A:",
    );
    expect(answer).not.toContain("No balloon");
    // No view reaches into the A3 sheet's bottom right corner, where the
    // title block, 180 wide and 40 high inside the 10 mm frame, and the
    // table of 4 rows and a header, 7 mm each, above it stand.
    const drawn = entities(
      await readFile(join(root, "drawings", "balloons.dxf"), "utf8"),
    );
    const inCorner = drawn.filter(
      (one) =>
        ["VISIBLE", "HIDDEN", "HATCH"].includes(one.layer) &&
        one.points.some(([x, y]) => x > 410 - 180 && y < 10 + 40 + 5 * 7),
    );
    expect(inCorner).toEqual([]);
  }, 240_000);
});
