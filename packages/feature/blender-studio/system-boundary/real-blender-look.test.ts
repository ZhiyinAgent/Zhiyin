/**
 * Looking at a scene from four sides against a real Blender: the sheet in
 * each shading, and the counts of a mesh's faults, each on a mesh that has
 * the fault and one that does not.
 *
 *   $env:ZHIYIN_BLENDER = "…\blender.exe"; npx vitest run --project "system-boundary*" packages/feature/blender-studio/system-boundary/real-blender-look.test.ts
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openProcessContainer } from "@zhiyin/sandbox";
import { TemporaryFolders } from "@zhiyin/test-support";
import { withKeptGlCache } from "../test/kept-gl-cache.js";
import {
  ConversationScenes,
  containedSessionLaunch,
  sceneAutomation,
} from "../src/index.js";

const blender = process.env["ZHIYIN_BLENDER"];
const sessionScript = fileURLToPath(
  new URL("../src/session/start.py", import.meta.url),
);
type Result = {
  isError?: boolean;
  content: { type: string; text?: string; data?: string }[];
};

/** Python that adds a mesh object built by bmesh, for a script to use. */
const meshMaker = [
  "import bmesh, bpy",
  "s = bpy.context.scene",
  "def made(name, build, at=(0, 0, 0)):",
  "    shape = bmesh.new()",
  "    build(shape)",
  "    mesh = bpy.data.meshes.new(name)",
  "    shape.to_mesh(mesh)",
  "    shape.free()",
  "    obj = bpy.data.objects.new(name, mesh)",
  "    obj.location = at",
  "    s.collection.objects.link(obj)",
  "    return obj",
];

/** The line a look gives one object. */
const lineOf = (said: string, name: string) =>
  said.split("\n").find((line) => line.startsWith(`${name}:`)) ?? "";

describe.runIf(blender)("a real Blender, looking from four sides", () => {
  const folders = new TemporaryFolders();
  let workspace: string;
  let scenes: ConversationScenes;
  let tools: ReturnType<typeof sceneAutomation>;
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = (await tools.callTool(name, args)) as Result;
    return {
      ...result,
      said: result.content.map((c) => c.text ?? "").join("\n"),
      image: result.content.find((c) => c.type === "image")?.data,
    };
  };
  const script = async (lines: string[]) => {
    const ran = await call("blender_run_script", { code: lines.join("\n") });
    expect(ran.isError, ran.said).toBeUndefined();
    return ran.said;
  };

  beforeAll(async () => {
    const root = await folders.make("zhiyin-studio-look-");
    workspace = join(root, "workspace");
    await mkdir(workspace, { recursive: true });
    scenes = new ConversationScenes({
      blender: async () => blender,
      directory: join(root, "data"),
      launch: withKeptGlCache(containedSessionLaunch)(
        { open: openProcessContainer },
        { scripts: join(root, "session-scripts") },
      ),
      script: sessionScript,
    });
    tools = sceneAutomation(scenes.scene("look"), {
      workspaceRoot: () => workspace,
      blender: async () => blender,
      directory: scenes.directory("look"),
    });
    await call("blender_open_scene", { path: "look.blend", create: true });
    // A cup: a closed cylinder whose 32-sided ends are n-gons, with the
    // faces of its left side turned inward. A box with a hollow 4 mm walls
    // all round, a sound cube, and an open plane with a loose point.
    await script([
      ...meshMaker,
      "def cup(b):",
      "    bmesh.ops.create_cone(b, cap_ends=True, cap_tris=False, segments=32, radius1=0.04, radius2=0.04, depth=0.1)",
      "    left = [f for f in b.faces if len(f.verts) == 4 and f.calc_center_median().x < -0.03]",
      "    bmesh.ops.reverse_faces(b, faces=left)",
      "made('Cup', cup, (0, 0, 0.05))",
      "def hollow(b):",
      "    bmesh.ops.create_cube(b, size=0.1)",
      "    inner = bmesh.ops.create_cube(b, size=0.092)",
      "    bmesh.ops.reverse_faces(b, faces=list({f for v in inner['verts'] for f in v.link_faces}))",
      "made('Hollow', hollow, (0.3, 0, 0.05))",
      "made('Block', lambda b: bmesh.ops.create_cube(b, size=0.1), (0.6, 0, 0.05))",
      "def sheet(b):",
      "    bmesh.ops.create_grid(b, x_segments=2, y_segments=2, size=0.05)",
      "    b.verts.new((0.2, 0.2, 0.2))",
      "made('Sheet', sheet, (0.9, 0, 0.05))",
    ]);
  }, 180_000);

  afterAll(async () => {
    await scenes.forget("look");
    await scenes.closeAll();
    await folders.removeAll();
  });

  it("counts faces pointing inward and where, and faces of more than four sides, and says none on a sound cube", async () => {
    const look = await call("blender_look", {
      objects: ["Cup", "Block"],
      shading: "faces",
    });

    expect(look.isError, look.said).toBeUndefined();
    expect(look.image).toBeTruthy();
    expect(look.said).toContain(
      "A look at Cup, Block: front, right, top and three-quarter on one sheet",
    );
    expect(look.said).toContain(
      "blue faces point outward, red inward, drawn with",
    );
    expect(lineOf(look.said, "Cup")).toContain("closed, 0 open edges");
    expect(lineOf(look.said, "Cup")).toMatch(
      /\d+ faces pointing inward, on the left side/,
    );
    expect(lineOf(look.said, "Cup")).toContain(
      "2 faces of more than 4 sides, the largest 32 sides",
    );
    // A cube is as thick everywhere, so where its thinnest wall is named is any side.
    expect(lineOf(look.said, "Block")).toMatch(
      /^Block: closed, 0 open edges; no faces pointing inward; no faces of more than 4 sides; 1 piece, no loose points or edges; thinnest wall 100 mm, (at|on) the \w+( side)?$/,
    );
    // The object with a fault comes first.
    expect(look.said.indexOf("\nCup:")).toBeLessThan(
      look.said.indexOf("\nBlock:"),
    );
  }, 180_000);

  it("measures the thinnest wall of a hollow shape, whose inner faces point into the hollow", async () => {
    const look = await call("blender_look", { objects: ["Hollow"] });

    expect(look.isError, look.said).toBeUndefined();
    expect(lineOf(look.said, "Hollow")).toContain("no faces pointing inward");
    expect(lineOf(look.said, "Hollow")).toMatch(/thinnest wall 4(\.0+)? mm/);
  }, 180_000);

  it("counts no face pointing inward on a subdivided cube, whose faces bend, and measures its wall across it", async () => {
    const made = await call("blender_run_script", {
      code: [
        "import bmesh, bpy",
        "b = bmesh.new()",
        "bmesh.ops.create_cube(b, size=1)",
        "m = bpy.data.meshes.new('Rounded'); b.to_mesh(m); b.free()",
        "o = bpy.data.objects.new('Rounded', m); o.location = (0, 6, 0.5)",
        "bpy.context.scene.collection.objects.link(o)",
        "o.modifiers.new('Smooth', 'SUBSURF').levels = 3",
      ].join("\n"),
    });
    expect(made.isError, made.said).toBeUndefined();

    const look = await call("blender_look", { objects: ["Rounded"] });

    expect(look.isError, look.said).toBeUndefined();
    expect(lineOf(look.said, "Rounded")).toContain("no faces pointing inward");
    // Rounded from a 1 m cube, it is about 800 mm across at its narrowest.
    expect(lineOf(look.said, "Rounded")).toMatch(
      /thinnest wall [6-9]\d\d(\.\d+)? mm/,
    );
  }, 180_000);

  it("counts an open sheet's open edges and its loose point, and has no wall to measure", async () => {
    const look = await call("blender_look", {
      objects: ["Sheet"],
      shading: "wireframe",
    });

    expect(look.isError, look.said).toBeUndefined();
    expect(look.image).toBeTruthy();
    expect(look.said).toContain("as wires along every edge");
    expect(lineOf(look.said, "Sheet")).toContain("open, 8 open edges");
    expect(lineOf(look.said, "Sheet")).toContain(
      "1 piece, 1 loose points and 0 loose edges",
    );
    expect(lineOf(look.said, "Sheet")).toContain(
      "no wall to measure: no piece is closed",
    );
  }, 180_000);

  it("counts a flat cap and an open sheet as sound, and a gap in a closed shape as a fault", async () => {
    await call("blender_add_objects", {
      objects: [
        {
          name: "Drum",
          kind: "cylinder",
          size: [0.2, 0.2, 0.1],
          location: [2, 0, 0.05],
        },
        { name: "Rug", kind: "plane", size: [0.5, 0.5], location: [2.5, 0, 0] },
      ],
    });
    await script([
      ...meshMaker,
      "def torn(b):",
      "    bmesh.ops.create_icosphere(b, subdivisions=3, radius=0.1)",
      "    b.faces.ensure_lookup_table()",
      "    top = max(b.faces, key=lambda f: f.calc_center_median().z)",
      "    bmesh.ops.delete(b, geom=[top], context='FACES_ONLY')",
      "made('Torn', torn, (3, 0, 0.1))",
    ]);
    const look = await call("blender_look", {
      objects: ["Drum", "Rug", "Torn"],
    });

    expect(look.isError, look.said).toBeUndefined();
    expect(lineOf(look.said, "Drum")).toMatch(
      /2 faces of more than 4 sides, the largest \d+ sides (at|on) the \w+( side)?, all flat/,
    );
    expect(lineOf(look.said, "Rug")).toContain("open, 4 open edges");
    expect(lineOf(look.said, "Torn")).toContain("open, 3 open edges");
    // Only the torn shape has a fault, so it comes first.
    expect(look.said.indexOf("\nTorn:")).toBeLessThan(
      look.said.indexOf("\nDrum:"),
    );
    expect(look.said.indexOf("\nDrum:")).toBeLessThan(
      look.said.indexOf("\nRug:"),
    );
  }, 180_000);

  it("names the faces a script left selected, and where they are", async () => {
    await script([
      "obj = bpy.data.objects['Block']",
      "for face in obj.data.polygons:",
      "    face.select = face.normal.z > 0.5",
    ]);
    const look = await call("blender_look", { objects: ["Block"] });
    await script([
      "for face in bpy.data.objects['Block'].data.polygons:",
      "    face.select = False",
    ]);

    expect(lineOf(look.said, "Block")).toContain(
      "selected: 1 of 6 faces, from 100 mm to 100 mm high",
    );
  }, 180_000);

  it("looks at the whole scene shaded and leaves it as it was", async () => {
    const before = await call("blender_describe_scene", {});
    const look = await call("blender_look", {});
    const after = await call("blender_describe_scene", {});

    expect(look.isError, look.said).toBeUndefined();
    expect(look.image).toBeTruthy();
    expect(look.said).toContain(
      "A look at the scene: front, right, top and three-quarter",
    );
    for (const name of ["Cup", "Hollow", "Block", "Sheet"])
      expect(lineOf(look.said, name)).not.toBe("");
    expect(after.said).toBe(before.said);
  }, 180_000);

  it("draws the solid view in each surface's own colour, whatever exposure the camera is given", async () => {
    const lookAt = async (exposure: number, file: string) => {
      await script([
        "import bpy",
        `bpy.context.scene.view_settings.exposure = ${exposure}`,
      ]);
      const look = await call("blender_look", { objects: ["Block"] });
      expect(look.isError, look.said).toBeUndefined();
      await writeFile(
        join(workspace, file),
        Buffer.from(look.image ?? "", "base64"),
      );
    };
    await lookAt(0, "as-lit.png");
    await lookAt(-4, "darkened.png");
    await script([
      "import bpy",
      "bpy.context.scene.view_settings.exposure = 0",
    ]);

    // How bright the block is drawn in each sheet, as Blender reads the file:
    // the pixels that are neither the sheet's ground, its commonest colour,
    // nor the white of the views' labels.
    const measured = await script([
      "import bpy, numpy",
      "def drawn(name):",
      "    image = bpy.data.images.load(bpy.path.abspath('//' + name))",
      "    pixels = numpy.array(image.pixels[:]).reshape(-1, 4)[:, :3].sum(axis=1)",
      "    bpy.data.images.remove(image)",
      "    values, counts = numpy.unique(numpy.round(pixels, 4), return_counts=True)",
      "    ground = values[counts.argmax()]",
      "    block = pixels[(numpy.abs(pixels - ground) > 0.01) & (pixels < 2.9)]",
      "    return float(block.mean())",
      "print('ratio', round(drawn('darkened.png') / drawn('as-lit.png'), 3))",
    ]);
    const ratio = Number(/ratio ([\d.]+)/.exec(measured)?.[1]);
    expect(ratio).toBeGreaterThan(0.97);
    expect(ratio).toBeLessThan(1.03);
  }, 180_000);

  it("draws reflections of a banded light, and measures where neighbouring faces turn most, more on a kinked ball than a smooth one", async () => {
    await script([
      ...meshMaker,
      "def ball(b):",
      "    bmesh.ops.create_uvsphere(b, u_segments=48, v_segments=24, radius=0.05)",
      "    for f in b.faces:",
      "        f.smooth = True",
      "made('Ball', ball, (0, 0.5, 0.05))",
      "def kinked(b):",
      "    ball(b)",
      "    top = max(b.verts, key=lambda v: v.co.x)",
      "    top.co.x += 0.02",
      "made('Kinked', kinked, (0.3, 0.5, 0.05))",
    ]);
    const look = await call("blender_look", {
      objects: ["Ball", "Kinked"],
      shading: "reflections",
      stripes: "y",
    });
    expect(look.isError, look.said).toBeUndefined();
    expect(look.image).toBeTruthy();
    expect(look.said).toContain(
      "by their reflections of a light in bands across y, each surface's own colour left out",
    );
    const turn = (name: string) => {
      const line = look.said
        .split("\n")
        .find((one) => one.startsWith(`Reflections on ${name}: `));
      expect(line, look.said).toMatch(
        /across the [\d,]+ edges it shades smooth across, neighbouring faces turn up to [\d.]+° from each other, most at \([-\d., ]+ mm\).*; 95% of them turn [\d.]+° or less\./,
      );
      return Number(/turn up to ([\d.]+)°/.exec(line ?? "")?.[1]);
    };
    expect(turn("Kinked")).toBeGreaterThan(2 * turn("Ball"));
    const measured = await script([
      "found = zhiyin.reflection_lines('Kinked', direction='y')",
      "print('most', round(found['most'], 1), 'places', len(found['at']))",
      "print('flat', zhiyin.reflection_lines('Block'))",
    ]);
    expect(measured).toMatch(/most \d+\.\d places [1-3]/);
    expect(measured).toContain("flat None");
    expect(measured).toMatch(
      /- Reflection lines on Kinked: across the [\d,]+ edges it shades smooth across, neighbouring faces turn up to [\d.]+° .* blender_look with shading reflections and stripes y draws its reflections/,
    );
    expect(measured).toContain(
      "- Reflection lines on Block: it shades smooth across no edge, so no curvature is measured.",
    );
  }, 180_000);
});
