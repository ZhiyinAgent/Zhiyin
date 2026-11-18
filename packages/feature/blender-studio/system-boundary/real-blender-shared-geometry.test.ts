/**
 * The geometry the 3D studio's measures share, against a real Blender, where
 * two ways of asking one question once gave two answers: whether a point is
 * inside a shape whose faces point inward, as a liquid's obstacle may; what
 * the physics meets of a shape whose steps make it, as settling and
 * simulating both run it; how many faces a voxel remesh of a stretched
 * shape makes, as a shaping step and a sculpt pass both remesh; and how far
 * one shape goes into another, as describing and measuring both say.
 *
 *   $env:ZHIYIN_BLENDER = "…\blender.exe"; npx vitest run --project system-boundary packages/feature/blender-studio/system-boundary/real-blender-shared-geometry.test.ts
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openProcessContainer } from "@zhiyin/sandbox";
import { TemporaryFolders } from "@zhiyin/test-support";
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

describe.runIf(blender)("the shared geometry in a real Blender", () => {
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
    const result = await call(name, args);
    expect(result.failed, result.said).toBe(false);
    return result.said;
  };
  const refused = async (name: string, args: Record<string, unknown>) => {
    const result = await call(name, args);
    expect(result.failed, result.said).toBe(true);
    return result.said;
  };
  const fresh = async (objects: Record<string, unknown>[]) => {
    await done("blender_run_script", {
      code: "import bpy\nfor o in list(bpy.data.objects): bpy.data.objects.remove(o)\nfor c in list(bpy.data.collections): bpy.data.collections.remove(c)",
    });
    return objects.length ? done("blender_add_objects", { objects }) : "";
  };

  beforeAll(async () => {
    const root = await folders.make("zhiyin-studio-geometry-");
    const workspace = join(root, "workspace");
    await mkdir(workspace, { recursive: true });
    scenes = new ConversationScenes({
      blender: async () => blender,
      directory: join(root, "data"),
      launch: containedSessionLaunch(
        { open: openProcessContainer },
        { scripts: join(root, "session-scripts") },
      ),
      script: sessionScript,
    });
    tools = sceneAutomation(scenes.scene("geometry"), {
      workspaceRoot: () => workspace,
      blender: async () => blender,
      directory: scenes.directory("geometry"),
    });
    await call("blender_open_scene", { path: "geometry.blend", create: true });
  });

  afterAll(async () => {
    await scenes.forget("geometry");
    await scenes.closeAll();
    await folders.removeAll();
  });

  it("measures a liquid round an obstacle whose faces point inward as round any other", async () => {
    await fresh([]);
    // A rounded box of liquid with a stone in its middle whose faces point
    // into it: the liquid is everywhere but in the stone.
    const said = await done("blender_run_script", {
      code: [
        "import bmesh",
        "from zhiyin_studio.sim_liquid_measures import sampled",
        "def cube(name, size, inward=False):",
        "    me = bpy.data.meshes.new(name)",
        "    bm = bmesh.new()",
        "    bmesh.ops.create_cube(bm, size=size)",
        "    if inward:",
        "        bmesh.ops.reverse_faces(bm, faces=list(bm.faces))",
        "    bm.to_mesh(me)",
        "    bm.free()",
        "    o = bpy.data.objects.new(name, me)",
        "    bpy.context.scene.collection.objects.link(o)",
        "    return o",
        "liquid = cube('Liquid', 1.0)",
        "liquid.modifiers.new('Rounded', 'BEVEL').width = 0.01",
        "stone = cube('Stone', 0.4, inward=True)",
        "bpy.context.view_layer.update()",
        "points, step = sampled(liquid, [stone], 0.1)",
        "within = sum(1 for p in points if max(abs(p.x), abs(p.y), abs(p.z)) < 0.2)",
        "print('in the stone', within, 'round it', len(points) - within)",
      ].join("\n"),
    });
    const [, within, round] =
      /in the stone (\d+) round it (\d+)/.exec(said) ?? [];
    expect(Number(within), said).toBe(0);
    // The grid's step is 50 mm: 20 points along each side, but for the 8
    // along each side of the stone.
    expect(Number(round), said).toBe(20 ** 3 - 8 ** 3);
  }, 180_000);

  it("settles an object onto the part of a floor its steps make", async () => {
    await fresh([
      {
        name: "Floor",
        kind: "cube",
        size: [1, 1, 0.2],
        location: [0, 0, -0.1],
      },
      {
        name: "Box",
        kind: "cube",
        size: [0.2, 0.2, 0.2],
        location: [2, 0, 0.3],
      },
    ]);
    // The floor's mesh is one tile; an array step lays two more beside it,
    // under the box.
    await done("blender_run_script", {
      code: "bpy.data.objects['Floor'].modifiers.new('Tiles', 'ARRAY').count = 3",
    });

    const said = await done("blender_settle_objects", {
      objects: ["Box"],
      on: ["Floor"],
      seconds: 1.5,
    });

    expect(said).toMatch(/Box: fell [\d.]+ mm.*, rests on Floor; now Box/);
  }, 180_000);

  it("refuses a voxel remesh of a stretched shape by the faces it would make, as a shaping step and between sculpt passes", async () => {
    // A box 2 m square and 20 mm thick, its mesh a 2 m cube squashed by its
    // scale: the remesh works on the mesh, where voxels of 3 mm make millions
    // of faces, though the box's own surface of 8.16 m² is a third of the
    // cube's and would take them by about 1.4 million.
    await fresh([
      { name: "Slab", kind: "cube", size: [2, 2, 2], location: [0, 0, 1] },
    ]);
    await done("blender_run_script", {
      code: "bpy.data.objects['Slab'].scale = (1, 1, 0.01)",
    });

    const shaped = await refused("blender_shape_objects", {
      object: "Slab",
      operations: [{ kind: "remesh", voxel_size: 0.003 }],
    });
    const sculpted = await refused("blender_run_script", {
      code: "zhiyin.sculpt_remesh(bpy.data.objects['Slab'], 0.003)",
    });

    const estimate = (said: string) =>
      /would make about ([\d,]+) faces/.exec(said)?.[1];
    expect(estimate(shaped), shaped).toMatch(/^[34],\d{3},\d{3}$/);
    expect(estimate(sculpted), sculpted).toBe(estimate(shaped));
  }, 180_000);

  it("says how far one shape goes into another alike in describing and measuring, each part moved in by its own thickness", async () => {
    await fresh([]);
    await done("blender_run_script", {
      code: [
        "import bmesh, mathutils",
        "def made(name, build, at, parent=None):",
        "    me = bpy.data.meshes.new(name)",
        "    bm = bmesh.new()",
        "    build(bm)",
        "    bm.to_mesh(me)",
        "    bm.free()",
        "    o = bpy.data.objects.new(name, me)",
        "    bpy.context.scene.collection.objects.link(o)",
        "    o.parent = parent",
        "    o.matrix_world = mathutils.Matrix.Translation(at)",
        "    return o",
        "def box(x, y, z):",
        "    def build(bm):",
        "        bmesh.ops.create_cube(bm, size=1.0)",
        "        for v in bm.verts:",
        "            v.co = mathutils.Vector((v.co.x * x, v.co.y * y, v.co.z * z))",
        "    return build",
        // A plate 0.4 mm thick laid 0.25 mm into a block's top.
        "made('Block', box(0.1, 0.1, 0.1), (0, 0, 0.05))",
        "made('Plate', box(0.3, 0.3, 0.0004), (0, 0, 0.1 + 0.0002 - 0.00025))",
        // A ball of 50 mm radius sunk 20 mm into ground of one open face, none of whose points is in it.
        "made('Stone', lambda bm: bmesh.ops.create_uvsphere(bm, u_segments=48, v_segments=24, radius=0.05), (2, 0, 0.03))",
        "made('Ground', lambda bm: bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=0.5), (2.3, 0.3, 0))",
        // A jar whose label, a part of it 0.4 mm thick, goes 0.25 mm into a wall; the jar stays clear of it.
        "jar = made('Jar', box(0.1, 0.1, 0.1), (4, 0, 0.05))",
        "made('Label', box(0.06, 0.0004, 0.04), (4, -0.0502, 0.05), jar)",
        "made('Wall', box(0.2, 0.05, 0.2), (4, -0.0504 - 0.025 + 0.00025, 0.1))",
        // A peg 20 mm into a block, its corners sunk as deep as its faces.
        "made('Base', box(0.2, 0.2, 0.1), (6, 0, 0.05))",
        "made('Peg', box(0.02, 0.02, 0.1), (6, 0, 0.13))",
      ].join("\n"),
    });
    const described = await done("blender_describe_scene", {});
    const depthDescribed = (name: string, other: string) =>
      Number(
        new RegExp(
          `^- ${name}: .*goes ([\\d.]+) mm into ${other}\\b`,
          "m",
        ).exec(described)?.[1],
      );
    const depthMeasured = async (name: string, other: string) => {
      const said = await done("blender_measure", { between: [name, other] });
      return Number(
        new RegExp(
          `^${name} and ${other} go ([\\d.]+) mm into each other`,
          "m",
        ).exec(said)?.[1],
      );
    };

    for (const [name, other, depth] of [
      ["Plate", "Block", 0.25],
      ["Stone", "Ground", 20],
      ["Jar", "Wall", 0.25],
      ["Peg", "Base", 20],
    ] as const) {
      expect(depthDescribed(name, other), described).toBeCloseTo(depth, 2);
      expect(await depthMeasured(name, other)).toBeCloseTo(depth, 2);
    }
  }, 180_000);
});
