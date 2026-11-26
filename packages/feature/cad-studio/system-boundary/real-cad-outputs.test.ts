/**
 * What a build hands back, against a real build123d: the files it exports,
 * whole or of the parts chosen by name or pattern, a part read back from them;
 * the picture of its views, with the sections and part names asked for; and
 * the mesh for the person's view. Skipped unless the CAD environment's Python
 * is named, as the other real-CAD tests are:
 *
 *   $env:ZHIYIN_CAD_PYTHON = "…\cad\Scripts\python.exe"; npx vitest run --project "system-boundary*" packages/feature/cad-studio/system-boundary/real-cad-outputs.test.ts
 */

import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { python } from "./confined-cad-python.js";
import {
  type Call,
  type Preview,
  type Result,
  openStudio,
} from "./real-cad-studio.js";

const folders = new TemporaryFolders();

/** How many edges of a binary STL's mesh border one triangle only, its corners joined by place. */
function openEdgesOfStl(stl: Buffer): number {
  const uses = new Map<string, number>();
  const count = stl.readUInt32LE(80);
  for (let i = 0; i < count; i++) {
    const corners = [0, 1, 2].map((corner) =>
      [0, 4, 8]
        .map((k) =>
          Math.round(stl.readFloatLE(84 + i * 50 + 12 + corner * 12 + k) * 1e4),
        )
        .join(","),
    );
    for (const [a, b] of [
      [corners[0]!, corners[1]!],
      [corners[1]!, corners[2]!],
      [corners[2]!, corners[0]!],
    ] as const) {
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      uses.set(key, (uses.get(key) ?? 0) + 1);
    }
  }
  return [...uses.values()].filter((used) => used === 1).length;
}

/** The model file a 3MF package holds, read from the zip's central directory. */
async function modelOf3mf(path: string): Promise<string> {
  const zip = await readFile(path);
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let at = zip.readUInt32LE(end + 16);
  const entries = zip.readUInt16LE(end + 10);
  for (let i = 0; i < entries; i++) {
    const method = zip.readUInt16LE(at + 10);
    const size = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const extra = zip.readUInt16LE(at + 30);
    const comment = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.toString("utf8", at + 46, at + 46 + nameLength);
    if (name === "3D/3dmodel.model") {
      const start =
        local +
        30 +
        zip.readUInt16LE(local + 26) +
        zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + size);
      return (method === 8 ? inflateRawSync(data) : data).toString("utf8");
    }
    at += 46 + nameLength + extra + comment;
  }
  throw new Error(`${path} holds no 3D/3dmodel.model.`);
}

describe.skipIf(!python)("building with a real build123d", () => {
  let root: string;
  let build: Call;
  let draw: Call;
  /** The meshes handed over for the person's view, read as they were. */
  const previews: Preview[] = [];

  beforeAll(async () => {
    ({ root, build, draw } = await openStudio(folders, previews));
  }, 30_000);

  afterAll(() => folders.removeAll());

  const text = (result: Result) => result.content[0]?.text ?? "";

  it("measures a plate's size, volume and holes, and writes every kind of file asked for", async () => {
    const result = await build({
      code: [
        "from build123d import *",
        "with BuildPart() as plate:",
        "    Box(80, 50, 8)",
        "    with Locations((-25, 0, 0), (25, 0, 0)):",
        "        Hole(radius=2.5)",
        "    CounterBoreHole(radius=3, counter_bore_radius=5.5, counter_bore_depth=3)",
        'show(plate.part, name="Plate")',
        "print('volume', round(plate.part.volume))",
      ].join("\n"),
      exports: [
        { path: "out/plate.step" },
        { path: "out/plate.stl" },
        { path: "out/plate.3mf" },
        { path: "out/plate.glb" },
        { path: "out/plate.png" },
      ],
    });

    expect(result.isError).toBeUndefined();
    expect(text(result)).toContain(
      "Plate: a valid solid, 80 × 50 × 8 mm, from (-40, -25, -4) to (40, 25, 4).",
    );
    expect(text(result)).toContain(
      "Round holes: 2 of 5 mm, 1 of 6 mm, 1 of 11 mm.",
    );
    expect(text(result)).toMatch(/What the script printed:\nvolume \d+/);
    const written = await readdir(join(root, "out"));
    expect(written.sort()).toEqual([
      "plate.3mf",
      "plate.glb",
      "plate.png",
      "plate.step",
      "plate.stl",
    ]);
    for (const file of written)
      expect((await stat(join(root, "out", file))).size).toBeGreaterThan(500);
    expect(await readFile(join(root, "out", "plate.step"), "latin1")).toMatch(
      /^ISO-10303-21;/,
    );
    const picture = Buffer.from(result.content[1]?.data ?? "", "base64");
    expect(picture.subarray(1, 4).toString()).toBe("PNG");
    expect([picture.readUInt32BE(16), picture.readUInt32BE(20)]).toEqual([
      960, 1004,
    ]);
    // The views written to the workspace are the picture the answer shows.
    const sheet = await readFile(join(root, "out", "plate.png"));
    expect(sheet.subarray(1, 4).toString()).toBe("PNG");
    expect([sheet.readUInt32BE(16), sheet.readUInt32BE(20)]).toEqual([
      960, 1004,
    ]);
  }, 120_000);

  it("draws the parts it can beside one whose faces cannot be divided into triangles, and says which", async () => {
    const result = await build({
      code: [
        "from build123d import *",
        'show(extrude(Polygon((0, 0), (10, 10), (10, 0), (0, 10), align=None), 5), name="Bowtie")',
        'show(Pos(40, 0, 0) * Box(10, 10, 10), name="Cube")',
      ].join("\n"),
    });
    const alone = await build({
      code: [
        "from build123d import *",
        'show(extrude(Polygon((0, 0), (10, 10), (10, 0), (0, 10), align=None), 5), name="Bowtie")',
      ].join("\n"),
    });

    expect(result.isError).toBeUndefined();
    expect(text(result)).toContain("Bowtie: not a valid solid");
    expect(text(result)).toContain("Cube: a valid solid");
    expect(result.content[1]?.type).toBe("image");
    expect(text(result)).toContain(
      "Not in the views: Bowtie, which is not a valid solid, so its faces could not be divided into triangles.",
    );
    expect(alone.content).toHaveLength(1);
    expect(text(alone)).toContain(
      "The views could not be drawn this time: Bowtie is not a valid solid, so its faces could not be divided into triangles. The measurements above stand.",
    );
  }, 120_000);

  it("writes no mesh file holding a part whose faces cannot be divided into triangles, and answers with the rest", async () => {
    const result = await build({
      code: [
        "from build123d import *",
        'show(extrude(Polygon((0, 0), (10, 10), (10, 0), (0, 10), align=None), 5), name="Bowtie")',
        'show(Pos(40, 0, 0) * Box(10, 10, 10), name="Cube")',
      ].join("\n"),
      exports: [
        { path: "unmeshed/all.stl" },
        { path: "unmeshed/all.3mf" },
        { path: "unmeshed/all.glb" },
        { path: "unmeshed/cube.stl", parts: ["Cube"] },
        { path: "unmeshed/cube.3mf", parts: ["Cube"] },
        { path: "unmeshed/all.step" },
      ],
    });

    expect(result.isError, text(result)).toBeUndefined();
    // The measurements and the faults stand.
    expect(text(result)).toContain("Bowtie: not a valid solid");
    expect(text(result)).toContain("Cube: a valid solid, 10 × 10 × 10 mm");
    for (const kind of ["stl", "3mf", "glb"])
      expect(text(result)).toContain(
        `unmeshed/all.${kind} was not written: Bowtie is not a valid solid, so its faces could not be divided into triangles.`,
      );
    for (const kind of ["stl", "3mf", "glb"])
      await expect(
        stat(join(root, "unmeshed", `all.${kind}`)),
      ).rejects.toThrow();
    expect(text(result)).toContain("Wrote unmeshed/all.step");
    // The cube alone is written whole: every edge of its mesh borders two triangles.
    const cube = await readFile(join(root, "unmeshed", "cube.stl"));
    expect(cube.readUInt32LE(80)).toBe(12);
    expect(openEdgesOfStl(cube)).toBe(0);
    const model = await modelOf3mf(join(root, "unmeshed", "cube.3mf"));
    expect(model).toContain('unit="millimeter"');
    expect(model).toContain('name="Cube"');
    expect(model.match(/<triangle /g)).toHaveLength(12);
    expect(model.match(/<vertex /g)).toHaveLength(8);
    expect(result.content[1]?.type).toBe("image");
  }, 120_000);

  it("reads a part exported earlier back from the workspace", async () => {
    await build({
      code: 'from build123d import *\nshow(Cylinder(10, 30), name="Peg")',
      exports: [{ path: "peg.step" }],
    });

    const result = await build({
      code: 'from build123d import *\npeg = import_step("peg.step")\nshow(peg, name="Read back")',
    });

    expect(text(result)).toContain(
      "Read back: a valid solid, 20 × 20 × 30 mm, from (-10, -10, -15) to (10, 10, 15).",
    );
  }, 120_000);

  it("colours a section's cut part as the build does, whatever order its parts are named in", async () => {
    // Plate is shown first and takes the first colour, Bar the second; the
    // section names them the other way round and cuts only the plate.
    const built = await build({
      code: [
        "from build123d import *",
        'show(Box(40, 40, 10), name="Plate")',
        'show(Pos(200, 0, 0) * Box(20, 20, 20), name="Bar")',
      ].join("\n"),
      sections: [
        { through: [0, 0, 0], looking: "right", parts: ["Bar", "Plate"] },
      ],
    });
    expect(built.isError, text(built)).toBeUndefined();
    await mkdir(join(root, "sections"), { recursive: true });
    await writeFile(
      join(root, "sections", "ordered.png"),
      Buffer.from(built.content[1]?.data ?? "", "base64"),
    );
    const seen = await build({
      code: [
        "import sys",
        "from PIL import Image",
        "picture = Image.open(sys.argv[1]).convert('RGB')",
        "below = picture.crop((0, 1004, 480, 1484))",
        "def near(colour):",
        "    lighter = [round(c + (255 - c) * 0.55) for c in colour]",
        "    return sum(1 for p in below.getdata() if all(abs(a - b) <= 6 for a, b in zip(p, lighter)))",
        "print('plate colour', near((92, 134, 186)) > 400, 'bar colour', near((222, 140, 66)) > 100)",
        "from build123d import Box",
        "show(Box(1, 1, 1), name='Check')",
      ].join("\n"),
      arguments: ["sections/ordered.png"],
    });

    expect(text(seen)).toContain("plate colour True bar colour False");
  }, 240_000);

  it("adds sections to the picture that show inside the parts, cuts through pieces a plane parts, and says a cut that misses", async () => {
    // A cup with a pin across it, the pin a part of its own; and a U whose
    // prongs a level cut parts into two pieces.
    const cupped = await build({
      code: [
        "from build123d import *",
        "cup = Cylinder(20, 40) - Pos(0, 0, -5) * Cylinder(16, 40)",
        'show(cup, name="Cup")',
        'show(Rot(0, 90, 0) * Cylinder(4, 44), name="Pin")',
      ].join("\n"),
      sections: [
        { through: [0, 0, 0], looking: "front" },
        { through: [0, 0, 500], looking: "top" },
      ],
    });
    const forked = await build({
      code: [
        "from build123d import *",
        'show(Box(40, 10, 30) - Pos(0, 0, 5) * Box(20, 12, 30), name="Fork")',
      ].join("\n"),
      sections: [{ through: [0, 0, 8], looking: "bottom" }],
    });
    // A bore cut away off its axis, whose round face build123d gives no radius.
    const cutaway = await build({
      code: [
        "from build123d import *",
        'show(Box(60, 60, 40) - Cylinder(15, 50) - Pos(0, -24, 0) * Box(70, 40, 50), name="Housing")',
      ].join("\n"),
      sections: [{ through: [0, -3, 0], looking: "front" }],
    });
    await mkdir(join(root, "sections"), { recursive: true });
    await writeFile(
      join(root, "sections", "cup.png"),
      Buffer.from(cupped.content[1]?.data ?? "", "base64"),
    );
    const seen = await build({
      code: [
        "import sys",
        "from PIL import Image",
        "picture = Image.open(sys.argv[1]).convert('RGB')",
        "print('size', *picture.size)",
        "below = picture.crop((0, 1004, 480, 1484))",
        "def near(colour):",
        "    lighter = [round(c + (255 - c) * 0.55) for c in colour]",
        "    return sum(1 for p in below.getdata() if all(abs(a - b) <= 6 for a, b in zip(p, lighter)))",
        "print('cup filled', near((92, 134, 186)) > 400, 'pin filled', near((222, 140, 66)) > 100)",
        "from build123d import Box",
        "show(Box(1, 1, 1), name='Check')",
      ].join("\n"),
      arguments: ["sections/cup.png"],
    });

    expect(cupped.isError, text(cupped)).toBeUndefined();
    expect(text(cupped)).toContain(
      "Below them, the section asked for, numbered in order",
    );
    expect(text(cupped)).toContain(
      "Section 2 was not drawn: section 2's plane through (0, 0, 500) cuts no part",
    );
    expect(forked.isError, text(forked)).toBeUndefined();
    expect(text(forked)).toContain("Below them, the section asked for");
    expect(text(forked)).not.toContain("could not be drawn");
    expect(text(cutaway)).toContain("Below them, the section asked for");
    expect(text(cutaway)).not.toContain("could not be drawn");
    // Under the four views, one panel: the cup cut, and the pin across it, each in its colour.
    expect(text(seen)).toContain("size 960 1484");
    expect(text(seen)).toContain("cup filled True pin filled True");
  }, 180_000);

  it("names each part in every view it shows in, a part too small to hold its name beside it, and alike numbered parts once", async () => {
    await mkdir(join(root, "named"), { recursive: true });
    const shown = await build({
      code: [
        "from build123d import *",
        'show(Box(80, 50, 30), name="Housing")',
        'show(Pos(0, 0, 18) * Cylinder(2, 6), name="Peg")',
        "for i in range(6):",
        '    show(Pos(-30 + 12 * i, -30, 0) * Cylinder(3, 10), name=f"Bolt {i + 1}")',
      ].join("\n"),
    });
    await writeFile(
      join(root, "named", "parts.png"),
      Buffer.from(shown.content[1]?.data ?? "", "base64"),
    );
    // Each name, written as the views write a part's name, looked for in
    // each of the four views pixel for pixel.
    const seen = await build({
      code: [
        "import sys",
        "import numpy as np",
        "from PIL import Image, ImageDraw, ImageFont",
        "sheet = np.asarray(Image.open(sys.argv[1]).convert('RGB')).astype(int)",
        "ink = np.array((52, 58, 68))",
        "def written(name):",
        "    im = Image.new('RGB', (240, 40), (255, 255, 255))",
        "    ImageDraw.Draw(im).text((10, 10), name, fill=tuple(ink), font=ImageFont.load_default(size=13))",
        "    a = np.asarray(im).astype(int)",
        "    ys, xs = np.nonzero((a != 255).any(axis=2))",
        "    return a[ys.min():ys.max() + 1, xs.min():xs.max() + 1]",
        "def found(panel, pattern):",
        "    h, w, _ = pattern.shape",
        "    py, px = [v[0] for v in np.nonzero((pattern == ink).all(axis=2))]",
        "    for y, x in zip(*np.nonzero((panel == ink).all(axis=2))):",
        "        y, x = y - py, x - px",
        "        if 0 <= y and 0 <= x and y + h <= panel.shape[0] and x + w <= panel.shape[1] and (panel[y:y + h, x:x + w] == pattern).all():",
        "            return True",
        "    return False",
        "panels = [sheet[44 + r * 480:44 + (r + 1) * 480, c * 480:(c + 1) * 480] for r in (0, 1) for c in (0, 1)]",
        "for name in ('Housing', 'Peg', 'Bolt (all 6)', 'Bolt 1'):",
        "    print(name, 'named in', sum(found(panel, written(name)) for panel in panels), 'views')",
        "from build123d import Box",
        "show(Box(1, 1, 1), name='Check')",
      ].join("\n"),
      arguments: ["named/parts.png"],
    });

    expect(text(seen)).toContain("Housing named in 4 views");
    expect(text(seen)).toContain("Peg named in 4 views");
    // The bolts stand in a row in front of the housing: hidden behind one
    // another from the right, but each view shows one, which names them all.
    expect(text(seen)).toContain("Bolt (all 6) named in 4 views");
    expect(text(seen)).toContain("Bolt 1 named in 0 views");
  }, 180_000);

  it("hands over a mesh of the parts it built, for the person's view, and none for a drawing", async () => {
    previews.length = 0;
    await build({
      code: [
        "from build123d import *",
        'show(Box(80, 50, 8), name="Plate")',
        'show(Pos(0, 0, 20) * Cylinder(5, 10), name="Pin")',
      ].join("\n"),
    });

    expect(previews).toHaveLength(1);
    const [preview] = previews;
    // A binary glTF, whose nodes name the parts as the script did.
    expect(preview!.model.subarray(0, 4).toString()).toBe("glTF");
    expect(preview!.model.toString("latin1")).toContain('"name":"Pin"');
    expect(preview!.parts).toEqual([
      { name: "Plate", size: [80, 50, 8], valid: true },
      { name: "Pin", size: [10, 10, 10], valid: true },
    ]);

    await draw({
      code: 'from build123d import *\nshow(Box(80, 50, 8), name="Plate")',
      views: [{ view: "top" }],
      outputs: [{ path: "no-preview/plate.pdf" }],
    });
    expect(previews).toHaveLength(1);
  }, 180_000);

  it("writes each export of chosen parts whole, and shows one shape under two names", async () => {
    const result = await build({
      code: [
        "from build123d import *",
        "b = Box(10, 10, 10)",
        'show(b, name="Bracket")',
        'show(Pos(30, 0, 0) * Box(5, 5, 5), name="Pin")',
        'show(b, name="Spare")',
      ].join("\n"),
      exports: [
        { path: "asm/all.glb" },
        { path: "asm/bracket.glb", parts: ["Bracket"] },
        { path: "asm/bracket.step", parts: ["Bracket", "Spare"] },
      ],
    });

    expect(result.isError).toBeUndefined();
    const glb = await readFile(join(root, "asm", "bracket.glb"));
    const json = JSON.parse(
      glb.subarray(20, 20 + glb.readUInt32LE(12)).toString("utf8"),
    ) as { meshes?: unknown[] };
    expect(json.meshes?.length).toBeGreaterThan(0);
    expect(await readFile(join(root, "asm", "bracket.step"), "latin1")).toMatch(
      /^ISO-10303-21;/,
    );
  }, 120_000);

  it("takes a part name written as a pattern in exports, sections and drawings, and says what each named", async () => {
    const pins = [
      "from build123d import *",
      'show(Box(60, 20, 10), name="Block")',
      "for k in range(3):",
      '    show(Pos(-20 + 20 * k, 0, 0) * Cylinder(3, 30), name=f"Pin_{k + 1}")',
    ].join("\n");
    const built = await build({
      code: pins,
      exports: [{ path: "patterns/pins.step", parts: ["/Pin_.*/"] }],
      sections: [
        {
          through: [0, 0, 0],
          looking: "front",
          parts: ["/Pin_[12]/", "Block"],
        },
      ],
    });
    const drawn = await draw({
      code: pins,
      parts: ["Block", "/Pin_[23]/"],
      views: [
        { view: "top" },
        {
          section: "A",
          looking: "front",
          through: [0, 0, 0],
          uncut: ["/Pin_.*/"],
        },
      ],
      outputs: [{ path: "patterns/pins.pdf" }],
    });
    const missed = await build({
      code: pins,
      exports: [{ path: "patterns/none.step", parts: ["/Bolt_.*/"] }],
    });

    expect(built.isError, text(built)).toBeUndefined();
    expect(text(built)).toMatch(
      /^\/Pin_\.\*\/ named 3 parts: Pin_1, Pin_2, Pin_3\.\n\/Pin_\[12\]\/ named 2 parts: Pin_1, Pin_2\.\n/,
    );
    expect(text(built)).toContain("Wrote patterns/pins.step (");
    expect(text(built)).toContain("Below them, the section asked for");
    expect(drawn.isError, text(drawn)).toBeUndefined();
    expect(text(drawn)).toMatch(
      /^\/Pin_\[23\]\/ named 2 parts: Pin_2, Pin_3\.\n\/Pin_\.\*\/ named 2 parts: Pin_2, Pin_3\.\n/,
    );
    expect(missed.isError).toBe(true);
    expect(text(missed)).toContain(
      "exports[0].parts gives /Bolt_.*/, which matches no part's whole name; the parts are Block, Pin_1, Pin_2, Pin_3",
    );
  }, 180_000);
});
