/**
 * What a build's answer says beside this build's measures, against a real
 * build123d: how a part changed since the last build of its script, a file an
 * earlier build wrote whose part has changed since, a join or a cut with a
 * shape of no volume, how many objects a part meant to print prints as, and
 * how many of each part's outside edges are sharp, rounded and chamfered,
 * and the build123d operations the scripts page names, built and measured.
 * Skipped unless the CAD environment's Python is named, as the other
 * real-CAD tests are:
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

describe.skipIf(!python)("a build's answer, with a real build123d", () => {
  let root: string;
  let build: (args: Record<string, unknown>) => Promise<string>;

  beforeAll(async () => {
    root = await folders.make("zhiyin-real-cad-answers-workspace-");
    const data = await folders.make("zhiyin-real-cad-answers-data-");
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
      return result.content[0]?.text ?? "";
    };
    await mkdir(join(root, "shop"), { recursive: true });
  }, 30_000);

  afterAll(() => folders.removeAll());

  it("says how a part changed since the last build of its script, a part no longer shown, and a file written of a part that has changed since", async () => {
    const script = (lines: string[]) =>
      writeFile(
        join(root, "shop", "stand.py"),
        ["from build123d import *", ...lines].join("\n"),
      );
    await script([
      'show(Box(100, 50, 20), name="Body")',
      'show(Pos(0, 0, 40) * Box(10, 10, 10), name="Wing")',
      'show(Pos(0, 100, 0) * Cylinder(10, 5), name="Wheel")',
    ]);
    const first = await build({
      file: "shop/stand.py",
      exports: [{ path: "shop/body.step", parts: ["Body"] }],
    });
    // Taller, with a block standing apart above it; the wing gone.
    await script([
      'show(Box(100, 50, 30) + Pos(0, 0, 40) * Box(10, 10, 10), name="Body")',
      'show(Pos(0, 100, 0) * Cylinder(10, 5), name="Wheel")',
    ]);
    const second = await build({ file: "shop/stand.py" });
    const written = await build({
      file: "shop/stand.py",
      exports: [{ path: "shop/body.step", parts: ["Body"] }],
    });

    expect(first).not.toContain("changed since");
    expect(second).toContain(
      "Body changed since the last build of shop/stand.py: volume 100 → 151 cm³ (+51%), size 100 × 50 × 20 → 100 × 50 × 60 mm, 1 → 2 solids.",
    );
    expect(second).not.toContain("Wheel changed");
    expect(second).toContain(
      "Wing was shown by the last build of shop/stand.py and is not shown now.",
    );
    expect(second).toContain(
      "shop/body.step was written by an earlier build; Body has changed since.",
    );
    expect(written).not.toContain("changed since");
    expect(written).not.toContain("was written by an earlier build");
  }, 180_000);

  it("names each join and cut the script made with a shape of no volume, as a loft of sections in one plane gives", async () => {
    const text = await build({
      code: [
        "from build123d import *",
        "def section(x):",
        "    face = Face(Wire.make_polygon([(-10, 18, 0), (10, 18, 0), (8, 30, 0), (-8, 30, 0)], close=True))",
        "    return Pos(x, 0, 0) * (Plane.XZ * face)",
        "cabin = loft([section(x) for x in (-20, 0, 20)])",
        "body = Box(100, 50, 20)",
        "body = body - cabin",
        "body += cabin",
        "fused = Solid.make_box(10, 10, 10) + cabin",
        'show(Box(100, 50, 20), name="Body")',
      ].join("\n"),
    });

    expect(text).toMatch(
      /At line 7 of the script: a cut by a shape of no volume, 60 × 0 × 12 mm about \(0, 0, 24\), takes nothing away; the step that made that shape came out flat or empty\./,
    );
    expect(text).toMatch(
      /At line 8 of the script: a join with a shape of no volume, 60 × 0 × 12 mm about \(0, 0, 24\), adds nothing; the step that made that shape came out flat or empty\./,
    );
    expect(text).toMatch(
      /At line 9 of the script: a join with a shape of no volume/,
    );
  }, 120_000);

  it("says how many objects a part meant to print prints as, and holds a piece of it only by one it touches, while parts turning in each other stay held", async () => {
    // Two blocks side by side, touching, and a mirror a quarter of a
    // millimetre off them; a bearing standing on them with an axle turning
    // in its bore with 0.2 mm all round.
    const code = [
      "from build123d import *",
      "block = Box(40, 20, 10)",
      "beside = Pos(30, 0, 0) * Box(20, 20, 10)",
      "mirror = Pos(0, 12.25, 0) * Box(4, 4, 4)",
      'show(Compound(children=[block.solids()[0], beside.solids()[0], mirror.solids()[0]]), name="Body")',
      'show(Pos(0, 0, 15) * (Box(20, 20, 20) - Cylinder(5.2, 20, rotation=(90, 0, 0))), name="Bearing")',
      'show(Pos(0, 0, 15) * Cylinder(5, 30, rotation=(90, 0, 0)), name="Axle")',
    ].join("\n");
    const printed = await build({
      code,
      exports: [
        { path: "print/body.stl", parts: ["Body"] },
        { path: "print/turning.3mf", parts: ["Bearing", "Axle"] },
      ],
    });
    const viewed = await build({ code });

    expect(printed).toMatch(
      /Wrote print\/body\.stl \([^)]*\), meshed for printing, [^:]*: Body\. Body is 3 solids; they print as 2 separate objects\./,
    );
    expect(printed).toMatch(
      /Wrote print\/turning\.3mf \([^)]*\), meshed for printing, [^:]*: Bearing and Axle\.\n/,
    );
    expect(printed).toContain(
      "Held by nothing: 1 of the 3 pieces of Body. Each piece of an assembly sits on, in or against another, or turns or slides in it with a clearance of a millimetre or less; one further than that from everything floats where it was put. A piece of a part meant to print is held by another piece of it only where they touch.",
    );
    expect(viewed).not.toContain("Held by nothing");
  }, 180_000);

  it("counts each part's outside edges, sharp, rounded and chamfered, with a pocket's rim among them and its inside corners not", async () => {
    // A 40 × 30 × 20 mm box has 12 edges, each a right angle; a pocket 10 mm
    // deep in its top adds the 4 edges of its rim, and its floor and its
    // corners are inside the part.
    const text = await build({
      code: [
        "from build123d import *",
        "box = Box(40, 30, 20)",
        "pocketed = box - Pos(0, 0, 5) * Box(20, 10, 10)",
        "corners = [e for e in pocketed.edges().filter_by(Axis.Z) if abs(e.center().X) < 15]",
        'show(box, name="Plain")',
        'show(Pos(60, 0, 0) * round_edges(box, box.edges().filter_by(Axis.Z), 3), name="Rounded")',
        'show(Pos(120, 0, 0) * chamfer(box.edges().filter_by(Axis.Z), 2), name="Chamfered")',
        'show(Pos(180, 0, 0) * pocketed, name="Pocketed")',
        'show(Pos(240, 0, 0) * round_edges(pocketed, corners, 2), name="Eased")',
        'show(Pos(300, 0, 0) * round_edges(box, box.edges(), 2), name="Smooth")',
      ].join("\n"),
    });
    const lineOf = (name: string) =>
      text.split("\n").find((line) => line.startsWith(`${name}:`)) ?? "";

    expect(lineOf("Plain")).toContain(
      "6 faces: 6 flat. Outside edges: 12 sharp, 0 rounded, 0 chamfered.",
    );
    expect(lineOf("Rounded")).toContain(
      "Outside edges: 8 sharp, 4 rounded, 0 chamfered.",
    );
    expect(lineOf("Chamfered")).toContain(
      "Outside edges: 8 sharp, 0 rounded, 4 chamfered.",
    );
    expect(lineOf("Pocketed")).toContain(
      "Outside edges: 16 sharp, 0 rounded, 0 chamfered.",
    );
    // The pocket's corners rounded inside: still its rim and the box's edges.
    expect(lineOf("Eased")).toContain(
      "Outside edges: 16 sharp, 0 rounded, 0 chamfered.",
    );
    // Every edge rounded: 12 rounds, the corners where three meet not counted again.
    expect(lineOf("Smooth")).toContain(
      "Outside edges: 0 sharp, 12 rounded, 0 chamfered.",
    );
  }, 120_000);

  it("builds and measures the build123d operations the scripts page names: loft, a sweep along a spline, mirror, raised text and the largest fillet an edge takes", async () => {
    const text = await build({
      code: [
        "from build123d import *",
        "loft_part = loft([Rectangle(40, 40), Plane.XY.offset(30) * Circle(10)])",
        "path = Spline((0, 0, 0), (40, 20, 0), (80, 0, 30))",
        "swept = sweep(Plane(origin=path @ 0, z_dir=path % 0) * Circle(4), path=path)",
        "half = Pos(30, 0, 0) * Box(20, 20, 20)",
        "both = half + mirror(half, about=Plane.YZ)",
        "plate = Box(60, 20, 4) + Pos(0, 0, 2) * extrude(Text('ZY', font_size=12), amount=1.5)",
        "block = Box(30, 30, 30)",
        "largest = block.max_fillet(block.edges(), max_iterations=20)",
        "print(f'largest fillet {largest:.1f}')",
        'show(loft_part, name="Lofted")',
        'show(Pos(100, 0, 0) * swept, name="Swept")',
        'show(Pos(0, 100, 0) * both, name="Mirrored")',
        'show(Pos(100, 100, 0) * plate, name="Lettered")',
        'show(Pos(200, 0, 0) * fillet(block.edges(), largest * 0.9), name="Rounded")',
      ].join("\n"),
    });
    const lineOf = (name: string) =>
      text.split("\n").find((line) => line.startsWith(`${name}:`)) ?? "";

    // A square base lofted to a round top 30 mm above it.
    expect(lineOf("Lofted"), text).toContain("a valid solid, 40 × 40 × 30 mm");
    // A round section swept along a curve that climbs 30 mm.
    expect(lineOf("Swept"), text).toContain("a valid solid");
    expect(lineOf("Swept")).toContain("freeform");
    // A 20 mm block 30 mm right of the middle, and its mirror on the left.
    expect(lineOf("Mirrored"), text).toContain("80 × 20 × 20 mm");
    // A 4 mm plate with letters 1.5 mm proud of it.
    expect(lineOf("Lettered"), text).toContain(
      "a valid solid, 60 × 20 × 5.5 mm",
    );
    // A 30 mm cube's edges take a radius up to half its side.
    expect(text).toContain("largest fillet 15.0");
    expect(lineOf("Rounded")).toContain(
      "Outside edges: 0 sharp, 12 rounded, 0 chamfered.",
    );
  }, 120_000);
});
