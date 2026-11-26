/**
 * How a drawing draws a part's edges, against a real build123d: visible,
 * hidden, centre and thin lines, arcs and circles, the hatching of a section's
 * cut faces, revolved and uncut parts, and each section set level with the
 * view it looks as. Skipped unless the CAD environment's Python is named, as
 * the other real-CAD tests are:
 *
 *   $env:ZHIYIN_CAD_PYTHON = "…\cad\Scripts\python.exe"; npx vitest run --project "system-boundary*" packages/feature/cad-studio/system-boundary/real-cad-drawing-lines.test.ts
 */

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { inflateSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { confinedPython, harness, python } from "./confined-cad-python.js";
import { type Call, type Result, openStudio } from "./real-cad-studio.js";

const folders = new TemporaryFolders();

/** A one-page PDF's drawing commands, as the CAD studio writes them. */
function zlibInflated(pdf: Buffer): string {
  const start = pdf.indexOf("stream\n") + "stream\n".length;
  const end = pdf.indexOf("\nendstream", start);
  return inflateSync(pdf.subarray(start, end)).toString("latin1");
}

describe.skipIf(!python)("building with a real build123d", () => {
  let root: string;
  let build: Call;
  let draw: Call;

  beforeAll(async () => {
    ({ root, build, draw } = await openStudio(folders));
  }, 30_000);

  afterAll(() => folders.removeAll());

  const text = (result: Result) => result.content[0]?.text ?? "";

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
});
