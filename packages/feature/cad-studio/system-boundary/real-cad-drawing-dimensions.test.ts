/**
 * A drawing's dimensions against a real build123d: each read from the part as
 * drawn, from the points given or from its geometry alone, checked against the
 * size expected, its extension lines and leaders kept clear of the part; and
 * the drawings refused for what they ask that the part does not have. Skipped
 * unless the CAD environment's Python is named, as the other real-CAD tests
 * are:
 *
 *   $env:ZHIYIN_CAD_PYTHON = "…\cad\Scripts\python.exe"; npx vitest run --project "system-boundary*" packages/feature/cad-studio/system-boundary/real-cad-drawing-dimensions.test.ts
 */

import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { confinedPython, harness, python } from "./confined-cad-python.js";
import {
  bracket,
  type Call,
  lBracket,
  type Result,
  openStudio,
} from "./real-cad-studio.js";

const folders = new TemporaryFolders();

describe.skipIf(!python)("building with a real build123d", () => {
  let root: string;
  let build: Call;
  let draw: Call;

  beforeAll(async () => {
    ({ root, build, draw } = await openStudio(folders));
  }, 30_000);

  afterAll(() => folders.removeAll());

  const text = (result: Result) => result.content[0]?.text ?? "";

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
});
