/**
 * What set_material does beyond colour, metal and roughness, against a real
 * Blender: the coat's tint and ior, the reflections' tint, diffuse roughness
 * and the distribution; light scattered inside, weighed against the object's
 * thinnest part; a tint seen through glass, measured through its thickest
 * part; relief by bump or by moving the surface, weighed against the mesh's
 * edges; a material on some faces only; a texture set found in a folder; and
 * a normal map's convention, given or guessed.
 *
 *   $env:ZHIYIN_BLENDER = "…\blender.exe"; npx vitest run --project system-boundary packages/feature/blender-studio/system-boundary/real-blender-materials.test.ts
 */

import { mkdir } from "node:fs/promises";
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
  content: { type: string; text?: string }[];
};

/** Python that saves a square picture of a few pixels in the scene's folder, for a call to read. */
const pictures = (names: string[], size = 64) => [
  "import bpy, os",
  `for name in ${JSON.stringify(names)}:`,
  "    path = bpy.path.abspath('//' + name)",
  "    if not os.path.isdir(os.path.dirname(path)): os.mkdir(os.path.dirname(path))",
  `    picture = bpy.data.images.new(os.path.basename(name), ${size}, ${size})`,
  "    picture.filepath_raw = path",
  "    picture.file_format = 'PNG'",
  "    picture.save()",
  "    bpy.data.images.remove(picture)",
];

describe.runIf(blender)("a real Blender's materials", () => {
  const folders = new TemporaryFolders();
  let scenes: ConversationScenes;
  let tools: ReturnType<typeof sceneAutomation>;
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = (await tools.callTool(name, args)) as Result;
    return {
      failed: result.isError === true,
      said: result.content.map((c) => c.text ?? "").join("\n"),
    };
  };
  const done = async (name: string, args: Record<string, unknown>) => {
    const { failed, said } = await call(name, args);
    expect(failed, said).toBe(false);
    return said;
  };
  /** The answer's first line: what the call did, before the checks after it. */
  const material = async (args: Record<string, unknown>) =>
    (await done("blender_set_material", args)).split("\n")[0] ?? "";
  const script = (lines: string[]) =>
    done("blender_run_script", { code: lines.join("\n") });
  const open = (path: string) =>
    done("blender_open_scene", { path, create: true });
  const add = (objects: Record<string, unknown>[]) =>
    done("blender_add_objects", { objects });

  beforeAll(async () => {
    const root = await folders.make("zhiyin-studio-materials-");
    const workspace = join(root, "workspace");
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
    tools = sceneAutomation(scenes.scene("materials"), {
      workspaceRoot: () => workspace,
      blender: async () => blender,
      directory: scenes.directory("materials"),
    });
  });

  afterAll(async () => {
    await scenes.forget("materials");
    await scenes.closeAll();
    await folders.removeAll();
  });

  it("sets the coat's tint and ior, the reflections' tint, diffuse roughness and the distribution, and names each that is not the default", async () => {
    await open("inputs.blend");
    await add([{ name: "Shell", kind: "sphere", size: [0.1, 0.1, 0.1] }]);
    const said = await material({
      objects: ["Shell"],
      material: {
        name: "Candy",
        color: "#2050a0",
        coat: 1,
        coat_tint: "#ff4040",
        coat_ior: 1.6,
        specular_tint: "#ffd0a0",
        diffuse_roughness: 0.5,
        distribution: "ggx",
      },
    });
    expect(said).toBe(
      "Material Candy (#2050a0, roughness 0.5, coat 1, coat tint #ff4040, coat ior 1.6, specular tint #ffd0a0 on its reflections," +
        " diffuse roughness 0.5, as chalk, clay or cloth scatter light (Cycles only: EEVEE draws it smooth)," +
        " GGX reflections, which lose some of the light a rough surface reflects: multiscatter GGX, the default, keeps it) on Shell.",
    );
    // Named again, it keeps the rest and says what changed.
    const changed = await material({
      objects: ["Shell"],
      material: {
        name: "Candy",
        coat_ior: 1.5,
        distribution: "multiscatter-ggx",
      },
    });
    expect(changed).toContain(
      "Candy changed: distribution ggx to multiscatter-ggx; coat ior 1.6 to 1.5.",
    );
  }, 120_000);

  it("scatters light inside from a named starting point, and weighs its reach against the object's thinnest part", async () => {
    await open("inside.blend");
    await add([
      { name: "Head", kind: "sphere", size: [0.1, 0.1, 0.1] },
      {
        name: "Ear",
        kind: "box",
        size: [0.05, 0.05, 0.002],
        location: [0.2, 0, 0],
      },
    ]);
    const solid = await done("blender_set_material", {
      objects: ["Head"],
      material: { name: "Skin", subsurface: { preset: "skin" } },
    });
    const jelly = await done("blender_set_material", {
      objects: ["Ear"],
      material: { name: "Thin skin", subsurface: { preset: "skin" } },
    });
    // A 100 mm head is far thicker than skin's reach: it stays solid.
    expect(solid.split("\n")[0]).toBe(
      "Material Skin (#b18165 (its starting point's own colour), roughness 0.5, subsurface skin (as Jensen et al. (2001) measured it), subsurface weight 1) on Head." +
        " Its light reaches 3.67 mm, 1.37 mm, 0.68 mm in red, green and blue, drawn by random walk (skin) in Cycles." +
        " Head's thinnest part is 99.7 mm across, 27.2 times the reach, so it stays solid." +
        " EEVEE draws subsurface light by its own approximation, without the random walk and the skin's ior, so it looks different there from Cycles.",
    );
    // A 2 mm ear is thinner than its 3.67 mm reach: the answer gives the scale that keeps it under half of 2 mm.
    expect(jelly.split("\n")[0]).toBe(
      "Material Thin skin (#b18165 (its starting point's own colour), roughness 0.5, subsurface skin (as Jensen et al. (2001) measured it), subsurface weight 1) on Ear." +
        " Its light reaches 3.67 mm, 1.37 mm, 0.68 mm in red, green and blue, drawn by random walk (skin) in Cycles." +
        " That is wider than Ear's thinnest part, 2 mm across, so light passes through it there and it looks like jelly: a scale of 0.272 or less keeps it under half of that." +
        " EEVEE draws subsurface light by its own approximation, without the random walk and the skin's ior, so it looks different there from Cycles.",
    );
    const scaled = await material({
      objects: ["Ear"],
      material: {
        name: "Thin skin",
        subsurface: { preset: "skin", scale: 0.25 },
      },
    });
    expect(scaled).toContain(
      "Its light reaches 0.9175 mm, 0.3425 mm, 0.17 mm in red, green and blue",
    );
    expect(scaled).toContain(
      "Ear's thinnest part is 2 mm across, 2.18 times the reach, so it stays solid.",
    );
  }, 120_000);

  it("tints glass so that the colour given shows through the depth given, and says the colour through its thickest part", async () => {
    await open("tint.blend");
    await add([
      { name: "Slab", kind: "box", size: [0.1, 0.1, 0.02] },
      {
        name: "Pane",
        kind: "plane",
        size: [0.1, 0.1],
        location: [0.3, 0, 0],
      },
    ]);
    const said = await done("blender_set_material", {
      objects: ["Slab"],
      material: {
        name: "Blue glass",
        transmission: 1,
        roughness: 0,
        tint: { color: "#4080c0", depth: 0.01 },
      },
    });
    const opaque = await call("blender_set_material", {
      objects: ["Slab"],
      material: {
        name: "Tinted paint",
        tint: { color: "#4080c0", depth: 0.01 },
      },
    });
    const sheet = await call("blender_set_material", {
      objects: ["Pane"],
      material: {
        name: "Pane glass",
        transmission: 1,
        tint: { color: "#4080c0", depth: 0.01 },
      },
    });
    // #4080c0 through 10 mm is, through 20 mm, each channel's share squared:
    // 0.0513, 0.216 and 0.527 linear become 0.0026, 0.0466 and 0.278, #093d90.
    expect(said.split("\n")[0]).toBe(
      "Material Blue glass (#ffffff, roughness 0, transmission 1, ior 1.5, tint #4080c0 at 10 mm) on Slab." +
        " Its tint is #4080c0 seen through 10 mm: #093d90 through Slab's thickest part, 20 mm." +
        " EEVEE does not show the tint through glass, so it shows there untinted: render in Cycles to see it.",
    );
    expect(opaque).toEqual({
      failed: true,
      said: "tint colours the light that passes through a material: give transmission with it, 1 for glass and liquids.",
    });
    expect(sheet).toEqual({
      failed: true,
      said: "Pane is not closed, so it has no inside for light to cross and a tint shows nothing: give a closed shape, or a colour for a thin sheet's glass.",
    });
  }, 120_000);

  it("draws relief by bump or by moving the surface, weighing the detail against the mesh's edges and saying how far its box grows", async () => {
    await open("height.blend");
    await add([
      { name: "Box", kind: "box", size: [0.1, 0.1, 0.1] },
      {
        name: "Fine",
        kind: "box",
        size: [0.1, 0.1, 0.1],
        location: [0.3, 0, 0],
      },
    ]);
    await script([
      ...pictures(["bumps.png"]),
      "step = bpy.data.objects['Fine'].modifiers.new('Dice', 'SUBSURF')",
      "step.use_adaptive_subdivision = True",
      "step.adaptive_space = 'OBJECT'",
      "step.adaptive_object_edge_length = 0.001",
    ]);
    const bump = await done("blender_set_material", {
      objects: ["Box"],
      material: {
        name: "Hammered",
        height: { pattern: { kind: "cells", size: 0.005 }, depth: 0.001 },
      },
    });
    const moved = await done("blender_set_material", {
      objects: ["Box"],
      material: {
        name: "Hammered",
        height: {
          pattern: { kind: "cells", size: 0.005 },
          depth: 0.001,
          method: "displace",
        },
      },
    });
    const diced = await done("blender_set_material", {
      objects: ["Fine"],
      material: {
        name: "Pictured relief",
        height: {
          path: "bumps.png",
          projection: "box",
          size: 0.1,
          depth: 0.002,
          method: "both",
        },
      },
    });
    expect(bump.split("\n")[0]).toBe(
      "Material Hammered (#cccccc, roughness 0.5, height 1 mm by bump) on Box." +
        " Its height is a pattern of dimpled cells 5 mm across, rising up to 1 mm, drawn as bump: the light shows it, the outline does not.",
    );
    // A box of six faces has 100 mm edges: moving its eight corners shows none of 5 mm cells.
    // Its corners move out along their normals, a third of the way along each axis.
    expect(moved.split("\n")[0]).toBe(
      "Material Hammered (#cccccc, roughness 0.5, height 1 mm by displace) on Box." +
        " Its height is a pattern of dimpled cells 5 mm across, rising up to 1 mm, drawn by moving the surface." +
        " Box has edges of about 100 mm, 20 times the detail's 5 mm, so moving its points shows little of the detail:" +
        " subdivide it to edges of 2.5 mm or less, or draw the height as bump." +
        " Displaced, Box's box grows to at most 101.2 × 101.2 × 101.2 mm, from 100 × 100 × 100 mm." +
        " Hammered changed: height cells 1 mm by bump to cells 1 mm by displace.",
    );
    // A 64-pixel picture over 100 mm has 1.562 mm pixels; dicing to 1 mm edges blurs the finest of them.
    expect(diced).toContain(
      "Its height is the picture bumps.png, whose pixels are its finest detail, rising up to 2 mm, drawn by moving the surface with bump for what is finer." +
        " Fine is diced at render to edges of 1 mm, 0.64 times the detail's 1.562 mm, so moving its points blurs the finest of the detail:" +
        " subdivide it to edges of 0.7812 mm or less to show it all.",
    );
    expect(diced).toContain("Checked what this call changed: no faults.");
  }, 120_000);

  it("gives a material to the faces picked alone, saying how many and their area", async () => {
    await open("faces.blend");
    await add([{ name: "Box", kind: "box", size: [1, 1, 1] }]);
    await done("blender_set_material", {
      objects: ["Box"],
      material: { name: "Body", color: "#808080" },
    });
    const top = await done("blender_set_material", {
      objects: ["Box"],
      faces: { facing: [0, 0, 1] },
      material: { color: "#c03020" },
    });
    const sides = await done("blender_set_material", {
      objects: ["Box"],
      faces: {
        slot: "Body",
        inside: [
          [-1, -1, -1],
          [1, 0.1, 1],
        ],
      },
      material: { name: "Front", color: "#2030c0" },
    });
    const none = await call("blender_set_material", {
      objects: ["Box"],
      faces: { facing: [0, 1, 0], slot: "Front" },
      material: { name: "Nothing" },
    });
    const counted = await script([
      "import bpy",
      "box = bpy.data.objects['Box']",
      "print([s.material.name if s.material else None for s in box.material_slots])",
      "print(sorted(box.material_slots[p.material_index].material.name for p in box.data.polygons))",
    ]);
    expect(top.split("\n")[0]).toBe(
      "Material Box +z faces material (#c03020, roughness 0.5) on 1 face of Box, 1 m², 17% of its surface, facing [0, 0, 1] within 15°.",
    );
    // The box reaches y 0.1: its bottom, its two ends and its front have their middles inside it.
    expect(sides.split("\n")[0]).toBe(
      "Material Front (#2030c0, roughness 0.5) on 4 faces of Box, 4 m², 67% of its surface, inside the box given and showing Body.",
    );
    expect(none).toEqual({
      failed: true,
      said: "None of Box's 6 faces is facing [0, 1, 0] within 15° and showing Front.",
    });
    expect(counted.split("\n").slice(0, 2)).toEqual([
      "['Body', 'Box +z faces material', 'Front']",
      "['Body', 'Box +z faces material', 'Front', 'Front', 'Front', 'Front']",
    ]);
  }, 120_000);

  it("lays a texture set found in a folder, each map read as its kind and said with its pixels on the object", async () => {
    await open("maps.blend");
    await add([{ name: "Wall", kind: "box", size: [2, 0.2, 1] }]);
    await script(
      pictures([
        "bricks/Bricks_Color.png",
        "bricks/Bricks_Roughness.png",
        "bricks/Bricks_NormalGL.png",
        "bricks/Bricks_NormalDX.png",
        "bricks/Bricks_AmbientOcclusion.png",
        "bricks/Bricks_Displacement.png",
        "bricks/preview.png",
      ]),
    );
    // A smaller picture of the same kind, which the larger is taken over.
    await script(pictures(["bricks/Bricks_1k_Color.png"], 32));
    const set = await done("blender_set_material", {
      objects: ["Wall"],
      material: {
        name: "Bricks",
        roughness: 0.4,
        maps: { folder: "bricks", size: 1, projection: "box" },
      },
    });
    const relief = await done("blender_set_material", {
      objects: ["Wall"],
      material: { name: "Bricks", height: { depth: 0.003 } },
    });
    const wiring = await script([
      "import bpy",
      "tree = bpy.data.materials['Bricks'].node_tree",
      "for n in sorted(tree.nodes, key=lambda n: n.name):",
      "    if n.type == 'TEX_IMAGE':",
      "        print(n.image.name, n.image.colorspace_settings.name, n.interpolation, n.extension, [l.to_socket.name for o in n.outputs for l in o.links])",
      "    if n.type == 'NORMAL_MAP':",
      "        print('normal map', n.convention)",
      "print(bpy.data.materials['Bricks'].displacement_method)",
    ]);
    const pixels = "64 × 64 px, 15.62 mm a pixel on Wall";
    const maps =
      `Its maps: color Bricks_Color.png (sRGB, ${pixels}); roughness Bricks_Roughness.png (Non-Color, ${pixels});` +
      ` normal Bricks_NormalGL.png (Non-Color, ${pixels}; OpenGL, guessed from Bricks_NormalGL.png's name, made for OpenGL as Blender reads it);` +
      " ao Bricks_AmbientOcclusion.png left out: Cycles and EEVEE shade the shape's own crevices themselves;" +
      " left out Bricks_1k_Color.png (another color map), Bricks_NormalDX.png (another normal map); not a map by its name: preview.png." +
      " Its maps drive its roughness, so the roughness given is not used.";
    expect(set.split("\n")[0]).toBe(
      `Material Bricks (#cccccc, roughness 0.4, maps) on Wall. ${maps}` +
        " Its maps' height Bricks_Displacement.png is not drawn: give height a depth to draw it.",
    );
    expect(set).toContain("Checked what this call changed: no faults.");
    expect(relief.split("\n")[0]).toBe(
      `Material Bricks (#cccccc, roughness 0.4, maps, height 3 mm by bump) on Wall. ${maps}` +
        " Its height is the picture Bricks_Displacement.png, whose pixels are its finest detail, rising up to 3 mm, drawn as bump: the light shows it, the outline does not." +
        " Bricks changed: height none to its maps' 3 mm by bump.",
    );
    // Colour is read as colour, data as numbers, and relief smoothly.
    expect(wiring.split("\n")).toEqual([
      "Bricks_Color.png sRGB Linear REPEAT ['Base Color']",
      "Bricks_Roughness.png Non-Color Linear REPEAT ['Roughness']",
      "Bricks_NormalGL.png Non-Color Linear REPEAT ['Color']",
      "Bricks_Displacement.png Non-Color Cubic REPEAT ['Height']",
      "normal map OPENGL",
      "BUMP",
    ]);
  }, 120_000);

  it("reads a normal map in the convention given, or guesses it from the name and says why", async () => {
    await open("normals.blend");
    await add([{ name: "Tile", kind: "box", size: [0.2, 0.2, 0.02] }]);
    await script(
      pictures(["tile_normal_dx.png", "tile_nor_gl_2k.png", "tile_normal.png"]),
    );
    const answers = [];
    for (const normal_map of [
      { path: "tile_normal_dx.png" },
      { path: "tile_nor_gl_2k.png" },
      { path: "tile_normal.png" },
      { path: "tile_normal.png", convention: "directx" },
    ])
      answers.push(
        await done("blender_set_material", {
          objects: ["Tile"],
          material: { name: "Tile", normal_map },
        }),
      );
    expect(answers.map((said) => said.split("\n")[0])).toEqual([
      "Material Tile (#cccccc, roughness 0.5, surface detail) on Tile. Its normal map is read as DirectX, guessed from tile_normal_dx.png's name, made for DirectX: its green is flipped to Blender's.",
      "Material Tile (#cccccc, roughness 0.5, surface detail) on Tile. Its normal map is read as OpenGL, guessed from tile_nor_gl_2k.png's name, made for OpenGL as Blender reads it." +
        " Tile changed: surface detail tile_normal_dx.png to tile_nor_gl_2k.png.",
      "Material Tile (#cccccc, roughness 0.5, surface detail) on Tile. Its normal map is read as OpenGL, nothing in tile_normal.png's name or its set says which," +
        " so it is read as OpenGL, Blender's own: give convention directx if its bumps look like dents." +
        " Tile changed: surface detail tile_nor_gl_2k.png to tile_normal.png.",
      "Material Tile (#cccccc, roughness 0.5, surface detail) on Tile. Its normal map is read as DirectX, as given." +
        " Tile changed: surface detail tile_normal.png to tile_normal.png, read as DirectX.",
    ]);
    // A normal map laid by the shape's layout needs a layout to lie on.
    await script([
      "import bpy",
      "bare = bpy.data.objects['Tile'].copy()",
      "bare.data = bare.data.copy()",
      "bare.name = 'Bare'",
      "bpy.context.scene.collection.objects.link(bare)",
      "bare.data.uv_layers.remove(bare.data.uv_layers[0])",
    ]);
    expect(
      await call("blender_set_material", {
        objects: ["Bare"],
        material: {
          name: "Bare relief",
          normal_map: { path: "tile_normal.png" },
        },
      }),
    ).toEqual({
      failed: true,
      said: "Bare has no layout that fits a uv picture, which would show stretched, mirrored or as one colour; use cylinder, box, sphere or front.",
    });
    // Blender flips the green of a map read as DirectX itself.
    expect(
      await script([
        "import bpy",
        "print([n.convention for n in bpy.data.materials['Tile'].node_tree.nodes if n.type == 'NORMAL_MAP'])",
      ]),
    ).toContain("['DIRECTX']");
  }, 120_000);

  it("describes each value set_material gave beyond the defaults, so a later call can keep them", async () => {
    await open("described.blend");
    await add([
      { name: "Shell", kind: "sphere", size: [0.1, 0.1, 0.1] },
      {
        name: "Head",
        kind: "sphere",
        size: [0.1, 0.1, 0.1],
        location: [0.3, 0, 0],
      },
      {
        name: "Slab",
        kind: "box",
        size: [0.1, 0.1, 0.02],
        location: [0.6, 0, 0],
      },
      {
        name: "Tile",
        kind: "box",
        size: [0.2, 0.2, 0.02],
        location: [0.9, 0, 0],
      },
    ]);
    await script(pictures(["tile_normal_dx.png"]));
    await material({
      objects: ["Shell"],
      material: {
        name: "Lacquer",
        color: "#2050a0",
        coat: 1,
        coat_tint: "#ff4040",
        coat_ior: 1.6,
        specular_tint: "#ffd0a0",
        diffuse_roughness: 0.5,
        distribution: "ggx",
      },
    });
    await material({
      objects: ["Head"],
      material: { name: "Skin", subsurface: { preset: "skin" } },
    });
    await material({
      objects: ["Slab"],
      material: {
        name: "Blue glass",
        transmission: 1,
        roughness: 0,
        tint: { color: "#4080c0", depth: 0.01 },
      },
    });
    await material({
      objects: ["Tile"],
      material: { name: "Tile", normal_map: { path: "tile_normal_dx.png" } },
    });
    const described = await done("blender_describe_scene", {});
    expect(described).toContain(
      "material Lacquer (#2050a0, roughness 0.5, coat 1, coat tint #ff4040, coat ior 1.6, specular tint #ffd0a0, diffuse roughness 0.5, GGX reflections)",
    );
    expect(described).toMatch(/material Skin \([^)]*subsurface skin/);
    expect(described).toContain(
      "roughness 0, tint #4080c0 at 10 mm, transmission 1, ior 1.5",
    );
    expect(described).toContain(
      "material Tile (#cccccc, roughness 0.5, surface detail, read as DirectX)",
    );
  }, 120_000);

  it("says a texture's pixels per centimetre against what the shot needs of it, near and far", async () => {
    await open("texels.blend");
    await add([{ name: "Poster", kind: "plane", size: [1, 1] }]);
    await script(pictures(["poster.png"], 1024));
    await done("blender_set_material", {
      objects: ["Poster"],
      material: {
        name: "Print",
        texture: { path: "poster.png", projection: "uv" },
      },
    });
    const looking = (height: number) =>
      script([
        "import bpy",
        "s = bpy.context.scene",
        "cam = s.camera or bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera'))",
        "if cam.name not in s.collection.objects: s.collection.objects.link(cam)",
        `cam.location = (0, 0, ${height})`,
        "cam.rotation_euler = (0, 0, 0)",
        "s.camera = cam",
      ]);
    const line = async () =>
      (await done("blender_describe_scene", { objects: ["Poster"] }))
        .split("\n")
        .find((l) => l.startsWith("- Poster: ")) ?? "";

    await looking(2);
    const near = await line();
    await looking(20);
    const far = await line();

    // 1024 px across a 1 m layout is 10.24 px/cm. A 50 mm lens on a 36 mm
    // sensor sees 1.44 m across at 2 m, 1920 px: 13.3 px/cm; at 20 m, 1.33.
    expect(near).toContain(
      "texture 10.2 px/cm (poster.png, 1024 px across); the shot needs up to 13.3 px/cm, at its nearest point in view 2 m from the camera: blurred there",
    );
    expect(far).toContain(
      "texture 10.2 px/cm (poster.png, 1024 px across); the shot needs up to 1.33 px/cm, at its nearest point in view 20 m from the camera: 7.68× more than the shot shows",
    );
  }, 120_000);

  it("reads a partly transparent picture's colour whole, and names one a script reads with straight alpha", async () => {
    await open("alpha.blend");
    await add([{ name: "Sign", kind: "box", size: [0.4, 0.02, 0.3] }]);
    await script([
      "import bpy, numpy",
      "img = bpy.data.images.new('fade.png', 8, 8, alpha=True)",
      "px = numpy.ones((8, 8, 4), dtype=numpy.float32)",
      "px[:, :4, 3] = 0.5",
      "img.pixels.foreach_set(px.ravel())",
      "img.filepath_raw = bpy.path.abspath('//fade.png')",
      "img.file_format = 'PNG'",
      "img.save()",
      "bpy.data.images.remove(img)",
    ]);
    await done("blender_set_material", {
      objects: ["Sign"],
      material: { name: "Painted", texture: { path: "fade.png" } },
    });
    const laid = await script([
      "import bpy",
      "node = next(n for n in bpy.data.materials['Painted'].node_tree.nodes if n.type == 'TEX_IMAGE')",
      "print('laid', node.image.alpha_mode)",
    ]);
    const straight = await script([
      "import bpy",
      "m = bpy.data.materials.new('Straight')",
      "t = m.node_tree.nodes.new('ShaderNodeTexImage')",
      "t.image = bpy.data.images.load(bpy.path.abspath('//fade.png'), check_existing=False)",
      "t.image.alpha_mode = 'STRAIGHT'",
      "m.node_tree.links.new(t.outputs['Color'], m.node_tree.nodes['Principled BSDF'].inputs['Base Color'])",
      "bpy.data.objects['Sign'].data.materials.append(m)",
    ]);

    expect(laid).toContain("laid CHANNEL_PACKED");
    expect(straight).toContain(
      "is partly transparent and read with straight alpha, so Cycles and EEVEE darken its colour by its alpha where it is clear, a dark fringe round what it shows: set image.alpha_mode = 'CHANNEL_PACKED' to read its colour whole",
    );
  }, 120_000);
});
