/**
 * Where a drawing puts things on its sheet, against a real build123d: the
 * scale it draws at, the room each view and dimension finds, every line kept
 * off the lettering and inside the frame, and the title block lettered in any
 * script it can draw. Skipped unless the CAD environment's Python is named, as
 * the other real-CAD tests are:
 *
 *   $env:ZHIYIN_CAD_PYTHON = "…\cad\Scripts\python.exe"; npx vitest run --project "system-boundary*" packages/feature/cad-studio/system-boundary/real-cad-drawing-layout.test.ts
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { python } from "./confined-cad-python.js";
import {
  bracket,
  type Call,
  lBracket,
  type Result,
  openStudio,
} from "./real-cad-studio.js";

const folders = new TemporaryFolders();

describe.skipIf(!python)("building with a real build123d", () => {
  let build: Call;
  let draw: Call;

  beforeAll(async () => {
    ({ build, draw } = await openStudio(folders));
  }, 30_000);

  afterAll(() => folders.removeAll());

  const text = (result: Result) => result.content[0]?.text ?? "";

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
});
