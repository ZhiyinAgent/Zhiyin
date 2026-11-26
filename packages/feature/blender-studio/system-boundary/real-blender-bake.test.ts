/**
 * Baking against a real Blender, at small sizes on the processor: a painted
 * box's colour, roughness, metalness, relief and ORM written as PNG files in
 * the workspace and the box given a copy of its material drawn from them; a
 * box baked from a detailed ball over it, its cage set from the gap measured
 * between them, and from a lid that covers only its top, whose rays miss the
 * rest; the shape maps; what is refused; and the bake an export calls for a
 * look a model file cannot hold.
 *
 *   $env:ZHIYIN_BLENDER = "…\blender.exe"; npx vitest run --project "system-boundary*" packages/feature/blender-studio/system-boundary/real-blender-bake.test.ts
 */

import { mkdir, readFile, stat } from "node:fs/promises";
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

/** A material made in a script: a Principled BSDF with the inputs given, as Python. */
const painted = (object: string, lines: readonly string[]) =>
  [
    "import bpy",
    `o = bpy.data.objects['${object}']`,
    "m = bpy.data.materials.new('Paint')",
    "t = m.node_tree",
    "p = next(n for n in t.nodes if n.type == 'BSDF_PRINCIPLED')",
    ...lines,
    "o.data.materials.clear()",
    "o.data.materials.append(m)",
  ].join("\n");

describe.runIf(blender)("baking materials in a real Blender", () => {
  const folders = new TemporaryFolders();
  let scenes: ConversationScenes;
  let tools: ReturnType<typeof sceneAutomation>;
  let workspace: string;
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = (await tools.callTool(name, args)) as Result;
    return {
      failed: result.isError === true,
      said: result.content.map((c) => c.text ?? "").join("\n"),
      pictures: result.content.filter((c) => c.type === "image").length,
    };
  };
  const script = async (code: string) => {
    const ran = await call("blender_run_script", { code });
    expect(ran.failed, ran.said).toBe(false);
    return ran.said;
  };
  const fresh = async (objects: Record<string, unknown>[]) => {
    await script(
      "import bpy\nfor o in list(bpy.data.objects): bpy.data.objects.remove(o)",
    );
    const added = await call("blender_add_objects", { objects });
    expect(added.failed, added.said).toBe(false);
  };

  beforeAll(async () => {
    const root = await folders.make("zhiyin-studio-bake-");
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
    tools = sceneAutomation(scenes.scene("bake"), {
      workspaceRoot: () => workspace,
      blender: async () => blender,
      directory: scenes.directory("bake"),
    });
    await call("blender_open_scene", { path: "bake.blend", create: true });
  });

  afterAll(async () => {
    await scenes.forget("bake");
    await scenes.closeAll();
    await folders.removeAll();
  });

  it("bakes a painted box into PNG maps in the workspace and gives it a copy of its material drawn from them", async () => {
    await fresh([
      {
        name: "Crate",
        kind: "cube",
        size: [0.3, 0.3, 0.3],
        location: [0, 0, 0.15],
      },
    ]);
    await script(
      painted("Crate", [
        // #c0392b, in Blender's linear values.
        "p.inputs['Base Color'].default_value = (0.5271, 0.0409, 0.0242, 1)",
        "p.inputs['Metallic'].default_value = 0.25",
        "noise = t.nodes.new('ShaderNodeTexNoise')",
        "t.links.new(noise.outputs['Fac'], p.inputs['Roughness'])",
      ]),
    );
    const settings = [
      "import bpy",
      "s = bpy.context.scene",
      "print('settings', s.render.engine, s.cycles.samples, s.render.bake.margin, s.render.bake.use_selected_to_active, [o.name for o in s.objects if o.select_get()])",
    ].join("\n");
    const before = await script(settings);

    const baked = await call("blender_bake", {
      objects: ["Crate"],
      maps: ["color", "roughness", "metallic", "normal", "orm"],
      resolution: 64,
    });
    const material = await script(
      [
        "import bpy",
        "m = bpy.data.objects['Crate'].material_slots[0].material",
        "p = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')",
        "def fed(name):",
        "    s = p.inputs[name]",
        "    return s.links[0].from_node.image.filepath.replace('\\\\', '/').split('/')[-1] if s.is_linked and s.links[0].from_node.type == 'TEX_IMAGE' else s.links[0].from_node.type if s.is_linked else 'nothing'",
        "print(m.name, '|', fed('Base Color'), fed('Roughness'), fed('Metallic'), fed('Normal'))",
        "print('kept', bpy.data.materials['Paint'].use_fake_user)",
        "i = bpy.data.images.load(bpy.path.abspath('//textures/Crate_metallic.png'))",
        "i.colorspace_settings.name = 'Non-Color'",
        "v = sorted(round(x, 2) for x in i.pixels[0::4])",
        "print('metallic file', v[len(v) - 1])",
      ].join("\n"),
    );

    expect(baked.failed, baked.said).toBe(false);
    expect(baked.said).toMatch(
      /^Crate: 5 maps at 64 × 64 px, 1 px bleed; its layout covers \d+% of the texels; islands /m,
    );
    expect(baked.said).toContain(
      "- color: textures/Crate_color.png, #c0392b to #c0392b, mean #c0392b.",
    );
    expect(baked.said).toMatch(
      /- roughness: textures\/Crate_roughness\.png, 0\.\d+ to 0\.\d+, mean 0\.\d+\./,
    );
    expect(baked.said).toContain(
      "- metallic: textures/Crate_metallic.png, 0.25 to 0.25, mean 0.25.",
    );
    expect(baked.said).toContain(
      "- normal: textures/Crate_normal.png, tilting 0° on average from the surface, 0° at most.",
    );
    expect(baked.said).toMatch(
      /- orm: textures\/Crate_orm\.png, ao [\d.]+ to 1, mean [\d.]+; roughness 0\.\d+ to 0\.\d+, mean 0\.\d+; metallic 0\.25 to 0\.25, mean 0\.25\./,
    );
    expect(baked.said).toContain(
      "Crate's material is now Crate baked, drawn from its maps; Paint stays in the file.",
    );
    expect(baked.pictures).toBe(1);
    for (const map of ["color", "roughness", "metallic", "normal", "orm"])
      expect(
        (await stat(join(workspace, "textures", `Crate_${map}.png`))).size,
      ).toBeGreaterThan(0);
    expect(material).toContain(
      "Crate baked | Crate_color.png Crate_roughness.png Crate_metallic.png NORMAL_MAP",
    );
    expect(material).toContain("kept True");
    // The scene renders, bakes and selects as it did before.
    expect(await script(settings)).toBe(before);
    expect(material).toContain("metallic file 0.25");
  });

  it("bakes a detailed ball onto a box, its cage from the gap measured between them", async () => {
    await fresh([
      { name: "Low", kind: "cube", size: [1, 1, 1], location: [0, 0, 0.5] },
      {
        name: "High",
        kind: "sphere",
        size: [1.2, 1.2, 1.2],
        location: [0, 0, 0.5],
      },
    ]);

    const baked = await call("blender_bake", {
      objects: ["Low"],
      maps: ["normal"],
      from: ["High"],
      resolution: 64,
    });

    expect(baked.failed, baked.said).toBe(false);
    const found =
      /Low: 1 map at 64 × 64 px, 1 px bleed; from High, which lies up to ([\d.]+) mm outside Low and ([\d.]+) mm inside it, so rays start [\d.]+ mm out and reach [\d.]+ mm in; its layout covers \d+% of the texels; rays from High missed (\d+)% of them, so those texels hold nothing baked from them;/.exec(
        baked.said,
      );
    expect(found, baked.said).not.toBeNull();
    // The ball reaches past the middle of each face and falls short of each corner.
    expect(Number(found?.[1])).toBeGreaterThan(90);
    expect(Number(found?.[1])).toBeLessThanOrEqual(100);
    expect(Number(found?.[2])).toBeGreaterThan(250);
    expect(Number(found?.[2])).toBeLessThan(270);
    // Straight in from a face's corners, a ray passes the ball by: about a twentieth of each face.
    expect(Number(found?.[3])).toBeGreaterThan(2);
    expect(Number(found?.[3])).toBeLessThan(15);
    const tilt =
      /- normal: textures\/Low_normal\.png, tilting (\d+)° on average/.exec(
        baked.said,
      );
    expect(Number(tilt?.[1])).toBeGreaterThan(5);
  });

  it("says how many of the texels the rays from a lid over the top missed", async () => {
    await fresh([
      { name: "Low", kind: "cube", size: [1, 1, 1], location: [0, 0, 0.5] },
      { name: "Lid", kind: "plane", size: [1, 1], location: [0, 0, 1.05] },
    ]);

    const baked = await call("blender_bake", {
      objects: ["Low"],
      maps: ["normal"],
      from: ["Lid"],
      resolution: 64,
    });

    expect(baked.failed, baked.said).toBe(false);
    const missed =
      /rays from Lid missed (\d+)% of them, so those texels hold nothing baked from them;/.exec(
        baked.said,
      );
    expect(missed, baked.said).not.toBeNull();
    // Of a box's six faces, rays from two meet the lid: the top's, and the bottom's through the box.
    expect(Number(missed?.[1])).toBeGreaterThan(60);
    expect(Number(missed?.[1])).toBeLessThan(72);
  });

  it("bakes the shape maps, glow and opacity, each saying what it holds", async () => {
    await fresh([
      {
        name: "Box",
        kind: "cube",
        size: [0.3, 0.3, 0.3],
        location: [0, 0, 0.15],
      },
    ]);
    await script(
      painted("Box", [
        "p.inputs['Emission Color'].default_value = (1, 0, 0, 1)",
        "p.inputs['Emission Strength'].default_value = 1",
        "p.inputs['Alpha'].default_value = 0.5",
      ]),
    );

    const baked = await call("blender_bake", {
      objects: ["Box"],
      maps: [
        "ao",
        "curvature",
        "cavity",
        "thickness",
        "edge",
        "emission",
        "opacity",
      ],
      resolution: 32,
    });

    expect(baked.failed, baked.said).toBe(false);
    expect(baked.said).toMatch(
      /- ao: textures\/Box_ao\.png, [\d.]+ to [\d.]+, mean [\d.]+\./,
    );
    expect(baked.said).toMatch(
      /- curvature: textures\/Box_curvature\.png, [\d.]+ to [\d.]+, mean [\d.]+\./,
    );
    expect(baked.said).toMatch(
      /- cavity: textures\/Box_cavity\.png, [\d.]+ to [\d.]+, mean [\d.]+\./,
    );
    expect(baked.said).toMatch(
      /- thickness: textures\/Box_thickness\.png, [\d.]+ to [\d.]+, mean [\d.]+, white where thin\./,
    );
    expect(baked.said).toMatch(
      // The flat faces read 0, or a rounding error of it (2e-07 on the processor).
      /- edge: textures\/Box_edge\.png, (?:0|[\d.]+e-\d+) to [\d.]+, mean [\d.]+\./,
    );
    expect(baked.said).toContain(
      "- emission: textures/Box_emission.png, #ff0000 to #ff0000, mean #ff0000.",
    );
    expect(baked.said).toContain(
      "- opacity: textures/Box_opacity.png, 0.5 to 0.5, mean 0.5.",
    );
  });

  it("refuses height with nothing to measure it from, and an object with no layout", async () => {
    await fresh([
      {
        name: "Box",
        kind: "cube",
        size: [0.3, 0.3, 0.3],
        location: [0, 0, 0.15],
      },
      {
        name: "Bare",
        kind: "cube",
        size: [0.3, 0.3, 0.3],
        location: [1, 0, 0.15],
      },
    ]);
    await script(
      "import bpy\nm = bpy.data.objects['Bare'].data\nwhile m.uv_layers: m.uv_layers.remove(m.uv_layers[0])",
    );

    const height = await call("blender_bake", {
      objects: ["Box"],
      maps: ["height"],
      resolution: 32,
    });
    const bare = await call("blender_bake", {
      objects: ["Bare"],
      maps: ["color"],
      resolution: 32,
    });

    expect(height.failed).toBe(true);
    expect(height.said).toContain(
      "height needs from: high-detail objects to measure “Box” against, or a material with a displacement to read it from.",
    );
    expect(bare.failed).toBe(true);
    expect(bare.said).toContain(
      "“Bare” has no layout to bake into: lay it out first with blender_unwrap.",
    );
  });

  it("bakes a look a model file cannot hold into pictures the file carries, for the length of an export", async () => {
    await fresh([
      {
        name: "Stone",
        kind: "cube",
        size: [0.3, 0.3, 0.3],
        location: [0, 0, 0.15],
      },
    ]);
    await script(
      painted("Stone", [
        "noise = t.nodes.new('ShaderNodeTexNoise')",
        "t.links.new(noise.outputs['Color'], p.inputs['Base Color'])",
      ]),
    );

    const exported = await script(
      [
        "import bpy",
        "from zhiyin_studio.baking import baked_for_export",
        "o = bpy.data.objects['Stone']",
        "print('before', o.material_slots[0].material.name == 'Paint' or o.material_slots[0].material.name.startswith('Paint.'))",
        "own = o.material_slots[0].material",
        "with baked_for_export([o], 32) as said:",
        "    print(*said)",
        "    print('wearing', o.material_slots[0].material.name)",
        "    for x in bpy.data.objects: x.select_set(x is o)",
        "    bpy.ops.export_scene.gltf(filepath='stone.glb', export_format='GLB', use_selection=True)",
        "print('after', o.material_slots[0].material == own, len([i for i in bpy.data.images if i.name.startswith('Stone ')]))",
      ].join("\n"),
    );
    const glb = await readFile(join(workspace, "stone.glb"));
    const json = JSON.parse(
      glb.subarray(20, 20 + glb.readUInt32LE(12)).toString("utf8"),
    ) as { images?: unknown[] };

    expect(exported).toContain(
      "Stone's color baked into 32 px pictures the file carries.",
    );
    expect(exported).toContain("wearing Stone for the file");
    expect(exported).toContain("before True");
    expect(exported).toContain("after True 0");
    expect(json.images?.length).toBe(1);
  });

  it("exports with bake: true carrying the look in pictures, and says so instead of what the file loses", async () => {
    const plain = await call("blender_export", {
      output: "plain.glb",
      objects: ["Stone"],
    });
    const baked = await call("blender_export", {
      output: "baked.glb",
      objects: ["Stone"],
      bake: true,
      bake_size: 32,
    });
    const glb = await readFile(join(workspace, "baked.glb"));
    const json = JSON.parse(
      glb.subarray(20, 20 + glb.readUInt32LE(12)).toString("utf8"),
    ) as { images?: unknown[] };
    const kept = await script(
      "import bpy\nprint('wears', bpy.data.objects['Stone'].material_slots[0].material.name)",
    );
    const flat = await call("blender_export", {
      output: "stone.stl",
      objects: ["Stone"],
      bake: true,
    });

    expect(plain.said).toContain(
      "comes from nodes a .glb cannot hold: the file gives it",
    );
    expect(plain.said).toContain(
      "Exporting to a .glb with bake: true keeps it.",
    );
    expect(baked.failed, baked.said).toBe(false);
    expect(baked.said).toContain(
      "Exported Stone to baked.glb. Stone's color baked into 32 px pictures the file carries.",
    );
    expect(baked.said).not.toContain("cannot hold");
    expect(json.images?.length).toBe(1);
    expect(kept).toMatch(/wears Paint/);
    expect(flat.failed).toBe(true);
    expect(flat.said).toContain(
      "A .stl carries no materials, so there is nothing to bake for it: leave bake out.",
    );
  });
});
