/**
 * Building materials in scripts, against a real Blender: the zhiyin shading
 * functions say what each mask, pattern and link did, measured on the shapes
 * that wear the material; a script-built node graph is described by what
 * feeds each input; a material a change left unsound is named with its input;
 * and an export names the pictures its file lays otherwise.
 *
 *   $env:ZHIYIN_BLENDER = "…\blender.exe"; npx vitest run --project system-boundary packages/feature/blender-studio
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

/** An empty scene and a maker of boxes: `solid(name, size, at)`, a closed box of six faces with no layout. */
const fresh = [
  "import bmesh, bpy",
  "for old in list(bpy.data.objects): bpy.data.objects.remove(old)",
  "for old in list(bpy.data.materials): bpy.data.materials.remove(old)",
  "def solid(name, size, at=(0, 0, 0)):",
  "    bm = bmesh.new()",
  "    bmesh.ops.create_cube(bm, size=1)",
  "    bmesh.ops.scale(bm, vec=size, verts=bm.verts)",
  "    mesh = bpy.data.meshes.new(name); bm.to_mesh(mesh); bm.free()",
  "    while mesh.uv_layers: mesh.uv_layers.remove(mesh.uv_layers[0])",
  "    obj = bpy.data.objects.new(name, mesh); obj.location = at",
  "    bpy.context.scene.collection.objects.link(obj)",
  "    return obj",
];
/** A 1 m box standing on the floor, wearing a new material Steel. */
const steelBox = [
  ...fresh,
  "solid('Box', (1, 1, 1), (0, 0, 0.5))",
  "steel = zhiyin.material('Steel', ['Box'])",
];

describe.runIf(blender)(
  "the zhiyin shading library and material checks in a real Blender",
  () => {
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
    const run = (lines: string[]) =>
      call("blender_run_script", { code: lines.join("\n") });
    /** The faults said of one object or material, from a change's answer. */
    const faultsOf = (said: string, name: string) =>
      said.split("\n").find((l) => l.startsWith(`- ${name}: `)) ?? "";
    /** The line describing the scene gives an object. */
    const lineOf = async (name: string) => {
      const { said } = await call("blender_describe_scene", {
        objects: [name],
      });
      return said.split("\n").find((l) => l.startsWith(`- ${name}: `)) ?? "";
    };

    beforeAll(async () => {
      const root = await folders.make("zhiyin-studio-shading-");
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
      tools = sceneAutomation(scenes.scene("shading"), {
        workspaceRoot: () => workspace,
        blender: async () => blender,
        directory: scenes.directory("shading"),
      });
      await tools.callTool("blender_open_scene", {
        path: "shading.blend",
        create: true,
      });
    });

    afterAll(async () => {
      await scenes.forget("shading");
      await scenes.closeAll();
      await folders.removeAll();
    });

    it("makes a material with a Principled BSDF and gives it to objects, saying the area they wear it on", async () => {
      const { failed, said } = await run([
        ...steelBox,
        "zhiyin.material('Steel')",
        "zhiyin.material('Spare')",
      ]);

      expect(failed, said).toBe(false);
      expect(said).toContain(
        "- Material Steel, new: a Principled BSDF into its Material Output, on Box (6 m²).",
      );
      expect(said).toContain(
        "- Material Steel, kept with its nodes, on Box (6 m²).",
      );
      expect(said).toContain(
        "- Material Spare, new: a Principled BSDF into its Material Output, on no object yet.",
      );
    });

    it("masks edges, recesses, up-facing faces and points by the shape, in metres, saying where each lands and which engines show it", async () => {
      const { failed, said } = await run([
        ...steelBox,
        "zhiyin.mask(steel, 'edges', reach=0.002)",
        "zhiyin.mask(steel, 'cavity')",
        "zhiyin.mask(steel, 'up', within=45)",
        "zhiyin.mask(steel, 'pointiness')",
      ]);

      expect(failed, said).toBe(false);
      expect(said).toContain(
        "- Mask edges of Steel: 1 within about 2 mm of convex edges, by occlusion from inside the shape; Cycles, and EEVEE only where the camera sees. On Box: 12 m of convex edges, about 0.8% of its 6 m².",
      );
      expect(said).toContain(
        "- Mask cavity of Steel: 1 where the shape closes in within about 20 mm, by occlusion from outside, other objects included; Cycles, and EEVEE only where the camera sees. On Box: no concave edges, so only where other objects come near.",
      );
      expect(said).toContain(
        "- Mask up of Steel: 1 on faces turned within 45° of up, +z in the world, fading over 10°; Cycles and EEVEE. On Box: 1 m², 17% of its 6 m².",
      );
      expect(said).toContain(
        "- Mask pointiness of Steel: 1 on convex points, 0 on flat and hollow ones, from the mesh's own points; Cycles only: EEVEE gives every point 0.5, so it stays 0. On Box: 8 points, 1 m apart on average, so it changes only from point to point.",
      );
    });

    it("measures a thickness mask by rays through the shape and an island mask by its loose parts, both Cycles only", async () => {
      const { failed, said } = await run([
        ...fresh,
        "solid('Plate', (0.1, 0.1, 0.002), (0, 0, 0.001))",
        "solid('Block', (0.05, 0.05, 0.05), (0.2, 0, 0.025))",
        "bm = bmesh.new()",
        "bmesh.ops.create_cube(bm, size=0.1)",
        "far = bmesh.ops.create_cube(bm, size=0.1)['verts']",
        "bmesh.ops.translate(bm, vec=(0.3, 0, 0), verts=far)",
        "mesh = bpy.data.meshes.new('Parts'); bm.to_mesh(mesh); bm.free()",
        "parts = bpy.data.objects.new('Parts', mesh); parts.location = (0, 1, 0.05)",
        "bpy.context.scene.collection.objects.link(parts)",
        "thin = zhiyin.material('Thin', ['Plate', 'Block'])",
        "zhiyin.mask(thin, 'thickness', below=0.005)",
        "apart = zhiyin.material('Apart', ['Parts'])",
        "zhiyin.mask(apart, 'island_random')",
      ]);

      expect(failed, said).toBe(false);
      expect(said).toContain(
        "- Mask thickness of Thin: rising to 1 where the shape is thinner than 5 mm, by occlusion from inside it; Cycles only: EEVEE does not see through the shape, so it stays near 0. On Plate: 2 mm at its thinnest, 96% of its surface thinner than 5 mm; on Block: 50 mm at its thinnest, none of it thinner than 5 mm.",
      );
      expect(said).toContain(
        "- Mask island_random of Apart: one random value from 0 to 1 for each loose part of a mesh; Cycles only: EEVEE gives 0 everywhere. On Parts: 2 loose parts.",
      );
    });

    it("measures thickness and occlusion on a shape whose faces bend from rays that start on its surface", async () => {
      const { failed, said } = await run([
        ...fresh,
        "solid('Lump', (1, 1, 1), (0, 0, 0.5))",
        "lump = bpy.data.objects['Lump']",
        "lump.modifiers.new('Smooth', 'SUBSURF').levels = 3",
        "lump.data = bpy.data.meshes.new_from_object(lump.evaluated_get(bpy.context.evaluated_depsgraph_get()))",
        "lump.modifiers.clear()",
        "clay = zhiyin.material('Clay', ['Lump'])",
        "zhiyin.mask(clay, 'thickness', below=0.005)",
        "zhiyin.mask(clay, 'occlusion', reach=0.1)",
      ]);

      expect(failed, said).toBe(false);
      // Rounded from a 1 m cube, it is hundreds of millimetres through everywhere, and nothing is near it.
      expect(said).toMatch(
        /- Mask thickness of Clay: [^\n]*On Lump: [6-9]\d\d(\.\d+)? mm at its thinnest, none of it thinner than 5 mm\./,
      );
      expect(said).toMatch(
        /- Mask occlusion of Clay: [^\n]*On Lump: nothing closes it in within 100 mm\./,
      );
    });

    it("measures an occlusion mask by rays from the surface into the scene, other objects included", async () => {
      const { failed, said } = await run([
        ...fresh,
        "solid('Floor', (4, 4, 0.01), (0, 0, -0.005))",
        "solid('Box', (1, 1, 1), (0, 0, 0.501))",
        "steel = zhiyin.material('Steel', ['Box'])",
        "zhiyin.mask(steel, 'occlusion', reach=0.1)",
      ]);

      expect(failed, said).toBe(false);
      expect(said).toContain(
        "- Mask occlusion of Steel: 1 where the shape is closed in within 100 mm, by occlusion from outside, other objects included; Cycles, and EEVEE only where the camera sees. On Box: 0.17 on average, more than half closed in over 17% of its surface.",
      );
    });

    it("says a view-dependent mask follows the view, and refuses an option a mask does not take or a kind it does not know", async () => {
      const masks = await run([
        ...steelBox,
        "zhiyin.mask(steel, 'layer_weight', blend=0.3)",
        "zhiyin.mask(steel, 'fresnel', ior=1.5)",
      ]);
      const option = await run([
        ...steelBox,
        "zhiyin.mask(steel, 'up', reach=0.01)",
      ]);
      const kind = await run([...steelBox, "zhiyin.mask(steel, 'rust')"]);

      expect(masks.failed, masks.said).toBe(false);
      expect(masks.said).toContain(
        "- Mask layer_weight of Steel: 0 where a surface faces the camera to 1 where it turns side-on, at blend 0.3; Cycles and EEVEE. It follows the view, so it is not measured on the shape.",
      );
      expect(masks.said).toContain(
        "- Mask fresnel of Steel: the light a surface of ior 1.5 reflects, 4% facing the camera to 100% side-on; Cycles and EEVEE. It follows the view, so it is not measured on the shape.",
      );
      expect(option.failed, option.said).toBe(true);
      expect(option.said).toContain(
        "A mask of up takes within; reach is not one of its options.",
      );
      expect(kind.failed, kind.said).toBe(true);
      expect(kind.said).toContain(
        "A mask is one of edges, cavity, occlusion, up, thickness, pointiness, layer_weight, fresnel or island_random.",
      );
    });

    it("draws patterns at their size in metres, saying how many fit across each object", async () => {
      const { failed, said } = await run([
        ...steelBox,
        "zhiyin.pattern(steel, 'noise', 0.003)",
        "zhiyin.pattern(steel, 'noise', 2)",
        "zhiyin.pattern(steel, 'cells', 0.005)",
        "zhiyin.pattern(steel, 'stripes', 0.01, axis='x', width=0.005)",
        "zhiyin.pattern(steel, 'weave', 0.001)",
        "zhiyin.pattern(steel, 'cracks', 0.02, width=0.0004)",
        "zhiyin.pattern(steel, 'flakes', 0.0001)",
      ]);

      expect(failed, said).toBe(false);
      expect(said).toContain(
        "- Pattern noise for Steel: features about 3 mm across, drawn in metres on each object (Noise Texture at scale 333.3); Cycles and EEVEE. On Box: about 333 across its 1 m.",
      );
      expect(said).toContain(
        "- Pattern noise for Steel: features about 2 m across, drawn in metres on each object (Noise Texture at scale 0.5); Cycles and EEVEE. On Box: one is wider than its 1 m, so it shows part of one.",
      );
      expect(said).toContain(
        "- Pattern cells for Steel: cells about 5 mm across, 0 at the middle of each and rising toward its edge; Cycles and EEVEE. On Box: about 200 across its 1 m.",
      );
      expect(said).toContain(
        "- Pattern stripes for Steel: stripes 5 mm wide, 10 mm apart, repeating along the object's own x; Cycles and EEVEE. On Box: about 100 across its 1 m.",
      );
      expect(said).toContain(
        "- Pattern weave for Steel: threads 1 mm apart, each over one and under the next, on whichever of the object's own planes a face lies nearest; Cycles and EEVEE. On Box: about 1,000 across its 1 m.",
      );
      expect(said).toContain(
        "- Pattern cracks for Steel: cracks 0.4 mm wide round cells about 20 mm across; Cycles and EEVEE. On Box: about 50 across its 1 m.",
      );
      expect(said).toContain(
        "- Pattern flakes for Steel: flakes about 0.1 mm across, each its own random value from 0 to 1; Cycles and EEVEE. On Box: about 10,000 across its 1 m.",
      );
    });

    it("mixes, remaps and feeds a graph into the shader, each saying what feeds what, and the scene's description says the same", async () => {
      const { failed, said } = await run([
        ...steelBox,
        "grain = zhiyin.pattern(steel, 'noise', 0.003)",
        "zhiyin.feed(steel, 'Base Color', zhiyin.mix(steel, grain, '#8a5a3c', '#b07a50'))",
        "zhiyin.feed(steel, 'Roughness', zhiyin.remap(steel, grain, 0.4, 0.6))",
        "zhiyin.feed(steel, 'Roughness', 0.35)",
        "zhiyin.relief(steel, grain, 0.0005)",
      ]);

      expect(failed, said).toBe(false);
      expect(said).toContain(
        "- Mix for Steel: Mix(Noise 3 mm, #8a5a3c..#b07a50), a colour.",
      );
      expect(said).toContain(
        "- Remap for Steel: Remap(Noise 3 mm, 0.4..0.6), 0 below 0.4 and 1 above 0.6.",
      );
      expect(said).toContain(
        "- Steel's Base Color <- Mix(Noise 3 mm, #8a5a3c..#b07a50).",
      );
      expect(said).toContain(
        "- Steel's Roughness <- Remap(Noise 3 mm, 0.4..0.6).",
      );
      expect(said).toContain(
        "- Steel's Roughness set to 0.35, in place of Remap(Noise 3 mm, 0.4..0.6).",
      );
      expect(said).toContain(
        "- Relief for Steel: Noise 3 mm raised up to 0.5 mm, as a bump: the light follows it and the outline does not; Cycles and EEVEE.",
      );
      // The remap a plain roughness replaced stays in the graph, named as feeding nothing.
      expect(await lineOf("Box")).toContain(
        "material Steel (roughness 0.35; Base Color <- Mix(Noise 3 mm, #8a5a3c..#b07a50); Normal <- Relief(Noise 3 mm, 0.5 mm); Map Range feeds nothing)",
      );
    });

    it("refuses an input the shader does not have, a number for a direction, and a value outside an input's range", async () => {
      const unknown = await run([
        ...steelBox,
        "zhiyin.feed(steel, 'Colour', '#ff0000')",
      ]);
      const normal = await run([
        ...steelBox,
        "zhiyin.feed(steel, 'Normal', 1)",
      ]);
      // Blender holds a value set from Python past an input's range without a word.
      const rough = await run([
        ...steelBox,
        "zhiyin.feed(steel, 'Roughness', 1.5)",
      ]);

      expect(unknown.failed, unknown.said).toBe(true);
      expect(unknown.said).toContain(
        "Steel's Principled BSDF has no input Colour: it has Base Color, Metallic, Roughness, IOR, Alpha,",
      );
      expect(normal.failed, normal.said).toBe(true);
      expect(normal.said).toContain(
        "Normal takes a direction: give a height to zhiyin.relief instead.",
      );
      expect(rough.failed, rough.said).toBe(true);
      expect(rough.said).toContain(
        "Steel's Roughness takes 0 to 1, and 1.5 is outside it.",
      );
    });

    it("describes a graph a script built with bpy by what feeds each input, naming what feeds nothing, a picture node with none, and what only Cycles draws", async () => {
      const { failed, said } = await run([
        ...fresh,
        "solid('Crate', (0.5, 0.5, 0.5), (0, 0, 0.25))",
        "m = bpy.data.materials.new('Crate paint')",
        "m.use_nodes = True",
        "tree = m.node_tree",
        "shader = tree.nodes['Principled BSDF']",
        "noise = tree.nodes.new('ShaderNodeTexNoise')",
        "noise.inputs['Scale'].default_value = 5",
        "ramp = tree.nodes.new('ShaderNodeValToRGB')",
        "tree.links.new(noise.outputs[0], ramp.inputs[0])",
        "tree.links.new(ramp.outputs['Color'], shader.inputs['Base Color'])",
        "bevel = tree.nodes.new('ShaderNodeBevel')",
        "tree.links.new(bevel.outputs['Normal'], shader.inputs['Normal'])",
        "tree.nodes.new('ShaderNodeTexVoronoi')",
        "empty = tree.nodes.new('ShaderNodeTexImage')",
        "tree.links.new(empty.outputs['Color'], shader.inputs['Roughness'])",
        "bpy.data.objects['Crate'].data.materials.append(m)",
        "bpy.context.scene.render.engine = 'BLENDER_EEVEE'",
      ]);

      expect(failed, said).toBe(false);
      const line = await lineOf("Crate");
      expect(line).toContain(
        "material Crate paint (Base Color <- Ramp(Noise, scale 5, #000000..#ffffff); Roughness <- picture node with no picture; Normal <- Bevel 50 mm; Voronoi Texture feeds nothing; Image Texture has no picture; Bevel shows only in Cycles, and the scene renders with EEVEE, which gives the plain normal)",
      );
    });

    it("names, after a script, the values and nodes in a material no real surface has or EEVEE cannot draw, and a picture nothing keeps", async () => {
      const { failed, said } = await run([
        ...fresh,
        "solid('Pot', (0.1, 0.1, 0.1), (0, 0, 0.05))",
        "solid('Cup', (0.1, 0.1, 0.1), (1, 0, 0.05))",
        "bpy.context.scene.render.engine = 'BLENDER_EEVEE'",
        "dark = zhiyin.material('Dark', ['Pot'])",
        "zhiyin.feed(dark, 'Base Color', '#202020')",
        "zhiyin.feed(dark, 'IOR', 0.8)",
        "tree = dark.node_tree",
        "bevel = tree.nodes.new('ShaderNodeBevel')",
        "tree.links.new(bevel.outputs['Normal'], tree.nodes['Principled BSDF'].inputs['Normal'])",
        "spare = tree.nodes.new('ShaderNodeTexNoise')",
        "tree.links.new(spare.outputs[0], tree.nodes.new('ShaderNodeValToRGB').inputs[0])",
        "bright = zhiyin.material('Bright', ['Cup'])",
        "zhiyin.feed(bright, 'Base Color', '#f5f5f5')",
        "painted = bpy.data.images.new('Painted', 4, 4)",
        "painted.pixels[:] = [1.0, 0.0, 0.0, 1.0] * 16",
        "picture = bright.node_tree.nodes.new('ShaderNodeTexImage')",
        "picture.image = painted",
        "bright.node_tree.links.new(picture.outputs['Color'], bright.node_tree.nodes['Principled BSDF'].inputs['Emission Color'])",
      ]);

      expect(failed, said).toBe(false);
      const dark = faultsOf(said, "Material Dark");
      expect(dark).toContain(
        "its colour #202020 reflects 1.4% of light, less than any real surface: charcoal reflects about 4%",
      );
      expect(dark).toContain(
        "its ior 0.8 is below air's 1, which no material is: water is 1.33, glass 1.5",
      );
      expect(dark).toContain(
        "its Bevel, feeding Normal, shows only in Cycles: this scene renders with EEVEE, which gives the plain normal",
      );
      // A chain feeding nothing is named by its last node.
      expect(dark).toContain("its Color Ramp feeds nothing it shows");
      expect(dark).not.toContain("Noise Texture");
      const bright = faultsOf(said, "Material Bright");
      expect(bright).toContain(
        "its colour #f5f5f5 reflects 91.3% of light, more than any real surface: fresh snow reflects about 90%",
      );
      expect(bright).toContain(
        "its picture Painted holds pixels a script set that nothing keeps: it is neither packed nor saved, so the scene file keeps it blank; pack it with image.pack() or save it with image.save()",
      );
    });

    it("names a mesh with no layout when a material it already wears comes to lay a picture by layout", async () => {
      await run([...steelBox]);
      const { failed, said } = await run([
        "import bpy",
        "picture = bpy.data.images.new('grain.png', 8, 8)",
        "steel = bpy.data.materials['Steel']",
        "node = steel.node_tree.nodes.new('ShaderNodeTexImage')",
        "node.image = picture",
        "steel.node_tree.links.new(node.outputs['Color'], steel.node_tree.nodes['Principled BSDF'].inputs['Base Color'])",
      ]);

      expect(failed, said).toBe(false);
      expect(faultsOf(said, "Box")).toContain(
        "a material on it lays a picture by its layout, and it has none, so the picture shows as one colour",
      );
    });

    it("names, on export, a picture laid by projection or mixed with nodes, and what each format gives it instead", async () => {
      await run([
        ...fresh,
        "picture = bpy.data.images.new('grain.png', 8, 8)",
        "picture.filepath_raw = '//grain.png'",
        "picture.file_format = 'PNG'",
        "picture.save()",
        "for name, x in (('Boxed', 0), ('Mixed', 2)):",
        "    obj = solid(name, (1, 1, 1), (x, 0, 0.5))",
        "    obj.data.uv_layers.new()",
        "    m = zhiyin.material(name, [name])",
        "    image = m.node_tree.nodes.new('ShaderNodeTexImage')",
        "    image.image = picture",
        "boxed = bpy.data.materials['Boxed'].node_tree",
        "boxed.nodes['Image Texture'].projection = 'BOX'",
        "coords = boxed.nodes.new('ShaderNodeTexCoord')",
        "boxed.links.new(coords.outputs['Object'], boxed.nodes['Image Texture'].inputs['Vector'])",
        "boxed.links.new(boxed.nodes['Image Texture'].outputs['Color'], boxed.nodes['Principled BSDF'].inputs['Base Color'])",
        "mixed = bpy.data.materials['Mixed']",
        "grain = zhiyin.pattern(mixed, 'noise', 0.01)",
        "zhiyin.feed(mixed, 'Base Color', zhiyin.mix(mixed, grain, mixed.node_tree.nodes['Image Texture'].outputs['Color'], '#804020'))",
      ]);

      const glb = await call("blender_export", { output: "laid.glb" });
      const usd = await call("blender_export", { output: "laid.usda" });
      const fbx = await call("blender_export", { output: "laid.fbx" });

      expect(glb.failed, glb.said).toBe(false);
      expect(glb.said).toContain(
        "Boxed's colour comes from its picture grain.png laid by box projection, which a .glb cannot hold: the file lays the picture by the shape's UV layout instead.",
      );
      expect(glb.said).toContain(
        "Mixed's colour mixes its picture grain.png with nodes a .glb cannot hold: the file gives it the picture alone. Exporting to a .glb with bake: true keeps it.",
      );
      expect(usd.said).toContain(
        "Mixed's colour mixes its picture grain.png with nodes a .usda cannot hold: the file gives it the picture alone.",
      );
      expect(fbx.said).toContain(
        "Mixed's colour mixes its picture grain.png with nodes a .fbx cannot hold: the file gives it plain #e7e7e7 instead.",
      );
    });
  },
);
