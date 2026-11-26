/**
 * Rigid bodies and baking against a real Blender: objects given to the
 * rigid-body physics with masses from their measured volumes, run over the
 * timeline, each said with when it comes to rest, its top speed and what it
 * rests on; bodies that start inside each other refused; the bodies kept
 * where they rest or keyed for animation; and every simulation in a scene
 * baked in order, each with its frames, seconds and cache size.
 *
 *   $env:ZHIYIN_BLENDER = "…\blender.exe"; npx vitest run --project system-boundary packages/feature/blender-studio/system-boundary/real-blender-simulate-bodies.test.ts
 */

import { readdirSync } from "node:fs";
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

const cube = (name: string, size: number[], location: number[]) => ({
  name,
  kind: "cube",
  size,
  location,
});

// Earth's gravity and a timeline of two seconds, which keeps each run short.
const twoSeconds =
  "bpy.context.scene.frame_end = 48\nbpy.context.scene.gravity = (0, 0, -9.81)";

describe.runIf(blender)("rigid bodies and baking in a real Blender", () => {
  const folders = new TemporaryFolders();
  let workspace: string;
  let scenes: ConversationScenes;
  let tools: ReturnType<typeof sceneAutomation>;
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = (await tools.callTool(name, args)) as Result;
    return {
      failed: result.isError === true,
      said: result.content.map((c) => c.text ?? "").join("\n"),
    };
  };
  const script = async (code: string) => {
    const ran = await call("blender_run_script", { code });
    expect(ran.failed, ran.said).toBe(false);
    return ran.said;
  };
  /** Every file in the workspace, beside the scene file and below it. */
  const besideScene = () =>
    readdirSync(workspace, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name))
      .filter((path) => !/\.blend1?$/.test(path))
      .sort();
  /**
   * The same, once the previews queued after earlier changes are done: a
   * preview evaluates the scene, and Blender writes a disk cache's frames as
   * it evaluates. A command waits for the previews before it.
   */
  const besideSceneOncePreviewed = async () => {
    const described = await call("blender_describe_scene", {});
    expect(described.failed, described.said).toBe(false);
    return besideScene();
  };
  const fresh = async (objects: Record<string, unknown>[]) => {
    await script(
      "import bpy\nfor o in list(bpy.data.objects): bpy.data.objects.remove(o)\n" +
        "w = bpy.context.scene.rigidbody_world\n" +
        "if w is not None: bpy.ops.rigidbody.world_remove()\n" +
        twoSeconds,
    );
    const added = await call("blender_add_objects", { objects });
    expect(added.failed, added.said).toBe(false);
  };

  beforeAll(async () => {
    const root = await folders.make("zhiyin-studio-simulate-bodies-");
    workspace = join(root, "workspace");
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
    tools = sceneAutomation(scenes.scene("simulate-bodies"), {
      workspaceRoot: () => workspace,
      blender: async () => blender,
      directory: scenes.directory("simulate-bodies"),
    });
    await call("blender_open_scene", { path: "bodies.blend", create: true });
  });

  afterAll(async () => {
    await scenes.forget("simulate-bodies");
    await scenes.closeAll();
    await folders.removeAll();
  });

  it("weighs each body by its measured volume and says when each comes to rest, how fast it went and what it rests on", async () => {
    await fresh([
      cube("Floor", [3, 3, 0.2], [0, 0, -0.1]),
      cube("Box", [0.2, 0.2, 0.2], [0, 0, 1]),
      cube("Crate", [0.4, 0.4, 0.4], [1, 0, 0.5]),
      cube("Bag", [0.3, 0.2, 0.1], [-1, 0, 0.3]),
    ]);

    const { failed, said } = await call("blender_simulate", {
      rigid: [
        { objects: ["Box"], material: "Steel" },
        { objects: ["Crate"], density: 600, friction: 0.8 },
        { objects: ["Bag"], mass: 5, shape: "box" },
        { objects: ["Floor"], role: "passive" },
      ],
    });
    const after = await script(
      "s = bpy.context.scene\nprint(s.frame_current, round(bpy.data.objects['Box'].matrix_world.translation.z, 3))",
    );

    expect(failed, said).toBe(false);
    expect(said).toContain(
      "Box: active, collision shape hull, 62.88 kg (8 L of Steel at 7860 kg/m³), friction 0.5, bounce 0.",
    );
    expect(said).toContain(
      "Crate: active, collision shape hull, 38.4 kg (64 L at 600 kg/m³), friction 0.8, bounce 0.",
    );
    expect(said).toContain(
      "Bag: active, collision shape box, 5 kg as given, friction 0.5, bounce 0.",
    );
    expect(said).toContain(
      "Floor: passive, collision shape hull, as it is convex, friction 0.5, bounce 0.",
    );
    expect(said).toContain(
      "Rigid-body world: gravity (0, 0, -9.81 m/s²), 10 substeps a frame, 10 solver iterations, over the timeline: 0 s to 1.96 s at 24 frames a second (frames 1 to 48).",
    );
    // Dropped from 0.9 m: about 0.43 s and 4.2 m/s to the floor, which speeds
    // measured frame to frame, a 24th of a second apart, read a little under.
    expect(said).toMatch(
      /Box: comes to rest at 0\.[4-9]\d* s; top speed [34]\.\d+ m\/s at 0\.4\d* s; rests on Floor; now Box \(200 × 200 × 200 mm\) at \(-?0(\.\d+)?, -?0(\.\d+)?, 100(\.\d+)? mm\)/,
    );
    expect(said).toMatch(/Crate: comes to rest at [\d.]+ s; .*rests on Floor/);
    // Each run measured, the scene is back on the frame it was on.
    expect(after).toBe("1 1.0");
  });

  it("runs the world at the gravity, substeps and solver iterations given", async () => {
    const { failed, said } = await call("blender_simulate", {
      world: { gravity: [0, 0, -1.62], substeps: 20, iterations: 15 },
    });

    expect(failed, said).toBe(false);
    expect(said).toContain(
      "Rigid-body world: gravity (0, 0, -1.62 m/s²), 20 substeps a frame, 15 solver iterations",
    );
    // On the Moon the box falls 0.9 m in about 1.05 s, at 1.7 m/s.
    expect(said).toMatch(
      /Box: comes to rest at 1\.\d+ s; top speed 1\.\d+ m\/s/,
    );
  });

  it("refuses bodies that start inside each other, or inside another's convex collision shape, with how deep", async () => {
    await fresh([
      cube("Floor", [3, 3, 0.2], [0, 0, -0.1]),
      cube("Box", [0.2, 0.2, 0.2], [0, 0, 0.05]),
    ]);
    const sunk = await call("blender_simulate", {
      rigid: [
        { objects: ["Box"], density: 500 },
        { objects: ["Floor"], role: "passive" },
      ],
    });

    await fresh([
      {
        name: "Bowl",
        kind: "revolve",
        profile: [
          [0, 0],
          [0.15, 0],
          [0.2, 0.12],
          [0.19, 0.12],
          [0.14, 0.01],
          [0, 0.01],
        ],
        location: [0, 0, 0],
      },
      {
        name: "Apple",
        kind: "sphere",
        size: [0.08, 0.08, 0.08],
        location: [0, 0, 0.06],
      },
    ]);
    const hulled = await call("blender_simulate", {
      rigid: [
        { objects: ["Apple"], density: 800 },
        { objects: ["Bowl"], role: "passive", shape: "hull" },
      ],
    });
    const hollow = await call("blender_simulate", {
      rigid: [
        { objects: ["Apple"], density: 800 },
        { objects: ["Bowl"], role: "passive", shape: "mesh" },
      ],
    });

    expect(sunk.failed).toBe(true);
    // Sunk 50 mm, as the overlap measure reads it to a fraction of a millimetre.
    expect(sunk.said).toMatch(
      /“Box” starts 50(\.\d+)? mm into “Floor”: rigid bodies that start inside each other are thrown apart\. Move it out first; blender_edit_objects rest_on sets it down on what is below\./,
    );
    expect(hulled.failed).toBe(true);
    expect(hulled.said).toMatch(
      /“Apple” starts [\d.]+ mm inside “Bowl”'s collision shape, its convex hull, which fills its hollow: give “Bowl” shape mesh, so the physics sees the hollow\./,
    );
    expect(hollow.failed, hollow.said).toBe(false);
    // A ball on the bowl's flat floor may still be rolling at the end.
    expect(hollow.said).toMatch(/Apple: .*; rests on Bowl;/);
  });

  it("refuses an active body with no closed volume to weigh, and an animated one with no keys", async () => {
    await fresh([
      { name: "Card", kind: "plane", size: [0.1, 0.1], location: [0, 0, 1] },
      cube("Paddle", [0.1, 0.5, 0.3], [0, 0, 0.15]),
    ]);

    const card = await call("blender_simulate", {
      rigid: [{ objects: ["Card"], density: 700 }],
    });
    const paddle = await call("blender_simulate", {
      rigid: [{ objects: ["Paddle"], role: "animated" }],
    });
    const weighed = await call("blender_simulate", {
      rigid: [{ objects: ["Paddle"], role: "passive", density: 700 }],
    });

    expect(card.said).toContain(
      "“Card” is not closed, so it has no volume to weigh: give its mass in kg.",
    );
    expect(paddle.said).toContain(
      "“Paddle” has no keys to move it: key it with blender_animate first, or make it passive.",
    );
    expect(weighed.said).toContain(
      "“Paddle” is passive, which nothing moves, so it has no mass: leave out density, material and mass.",
    );
  });

  it("keeps the bodies where they rest at the end for a still, and takes the physics away", async () => {
    await fresh([
      cube("Floor", [3, 3, 0.2], [0, 0, -0.1]),
      cube("Box", [0.2, 0.2, 0.2], [0, 0, 1]),
    ]);

    const { failed, said } = await call("blender_simulate", {
      rigid: [
        { objects: ["Box"], density: 500 },
        { objects: ["Floor"], role: "passive" },
      ],
      then: "settle",
    });
    const after = await script(
      "b = bpy.data.objects['Box']\nprint(bpy.context.scene.rigidbody_world, b.rigid_body, round(b.location.z, 4))",
    );

    expect(failed, said).toBe(false);
    expect(said).toContain(
      "Kept Box where it is at 1.96 s, the end of the timeline, as its plain place, and removed the rigid-body physics.",
    );
    expect(after).toBe("None None 0.1");
  });

  it("keys the bodies' motion for animation and export, and takes the physics away", async () => {
    await fresh([
      cube("Floor", [3, 3, 0.2], [0, 0, -0.1]),
      cube("Box", [0.2, 0.2, 0.2], [0, 0, 1]),
    ]);

    const { failed, said } = await call("blender_simulate", {
      rigid: [
        { objects: ["Box"], density: 500 },
        { objects: ["Floor"], role: "passive" },
      ],
      then: "to_keys",
    });
    const after = await script(
      "s = bpy.context.scene\nb = bpy.data.objects['Box']\ns.frame_set(48)\nprint(s.rigidbody_world, b.rigid_body, round(b.location.z, 4))\ns.frame_set(1)",
    );

    expect(failed, said).toBe(false);
    expect(said).toMatch(
      /Box: keyed where it is and how it turns on \d+ of 48 frames, 0 s to 1\.96 s, straight between them\./,
    );
    expect(said).toContain(
      "Removed the rigid-body physics: the keys play and export without it.",
    );
    expect(after).toBe("None None 0.1");
  });

  it("bakes every simulation in the scene in order, each with its frames, seconds and cache size", async () => {
    await fresh([
      cube("Floor", [3, 3, 0.2], [0, 0, -0.1]),
      cube("Box", [0.2, 0.2, 0.2], [0, 0, 1]),
    ]);
    await script(
      [
        "import bpy",
        "bpy.ops.mesh.primitive_grid_add(x_subdivisions=8, y_subdivisions=8, size=1, location=(0, 1.5, 1))",
        "sheet = bpy.context.object; sheet.name = 'Sheet'",
        "sheet.modifiers.new('Cloth', 'CLOTH')",
        "bpy.ops.mesh.primitive_cube_add(size=0.3, location=(1.5, 0, 1))",
        "jelly = bpy.context.object; jelly.name = 'Jelly'",
        "jelly.modifiers.new('Softbody', 'SOFT_BODY')",
        "bpy.ops.mesh.primitive_plane_add(size=0.5, location=(-1.5, 0, 1))",
        "emitter = bpy.context.object; emitter.name = 'Emitter'",
        "emitter.modifiers.new('Sparks', 'PARTICLE_SYSTEM').particle_system.settings.count = 100",
        "bpy.ops.mesh.primitive_ico_sphere_add(radius=0.1, subdivisions=1, location=(0, -1.5, 1))",
        "zone = bpy.context.object; zone.name = 'Zone'",
        "tree = bpy.data.node_groups.new('Falling', 'GeometryNodeTree')",
        "tree.interface.new_socket('Geometry', in_out='INPUT', socket_type='NodeSocketGeometry')",
        "tree.interface.new_socket('Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')",
        "n = tree.nodes; l = tree.links",
        "i, o = n.new('NodeGroupInput'), n.new('NodeGroupOutput')",
        "si, so = n.new('GeometryNodeSimulationInput'), n.new('GeometryNodeSimulationOutput')",
        "si.pair_with_output(so)",
        "move = n.new('GeometryNodeSetPosition'); move.inputs['Offset'].default_value = (0, 0, -0.01)",
        "l.new(i.outputs[0], si.inputs['Geometry']); l.new(si.outputs['Geometry'], move.inputs['Geometry'])",
        "l.new(move.outputs['Geometry'], so.inputs['Geometry']); l.new(so.outputs['Geometry'], o.inputs[0])",
        "zone.modifiers.new('Falling', 'NODES').node_group = tree",
      ].join("\n"),
    );

    const { failed, said } = await call("blender_simulate", {
      rigid: [
        { objects: ["Box"], density: 500 },
        { objects: ["Floor"], role: "passive" },
      ],
      bake: true,
    });
    const baked = await script(
      [
        "o = bpy.data.objects",
        "print(bpy.context.scene.rigidbody_world.point_cache.is_baked, o['Sheet'].modifiers['Cloth'].point_cache.is_baked,",
        "      o['Jelly'].modifiers['Softbody'].point_cache.is_baked, o['Emitter'].particle_systems[0].point_cache.is_baked)",
      ].join("\n"),
    );
    const lines = said.split("\n");
    const at = (start: string) => lines.findIndex((l) => l.startsWith(start));

    expect(failed, said).toBe(false);
    expect(said).toMatch(
      /Baked the rigid-body world: frames 1 to 48 in [\d.]+ s, [\d.]+ [KM]?i?B kept in the scene file\./,
    );
    expect(said).toMatch(
      /Baked cloth on Sheet: frames 1 to 48 in [\d.]+ s, [\d.]+ [KM]?i?B kept in the scene file\./,
    );
    expect(said).toMatch(
      /Baked soft body on Jelly: frames 1 to 48 in [\d.]+ s, [\d.]+ [KM]?i?B kept in the scene file\./,
    );
    expect(said).toMatch(
      /Baked particles Sparks on Emitter: frames 1 to 48 in [\d.]+ s, [\d.]+ [KM]?i?B kept in the scene file\./,
    );
    // An icosphere of one subdivision has 12 points; 100 mm round, falling
    // 10 mm a frame for 48 frames, they reach 580 mm from its origin.
    expect(said).toMatch(
      /Baked the simulation zone of Falling on Zone: frames 1 to 48 in [\d.]+ s, [\d.]+ [KM]?i?B kept in the scene file; 12 points at every frame, all finite, at most 580 mm from Zone's origin\./,
    );
    // In the order one depends on another: rigid bodies, cloth and soft
    // bodies, particles, then simulation zones.
    expect(at("Baked the rigid-body world")).toBeLessThan(at("Baked cloth"));
    expect(at("Baked cloth")).toBeLessThan(at("Baked soft body"));
    expect(at("Baked soft body")).toBeLessThan(at("Baked particles"));
    expect(at("Baked particles")).toBeLessThan(at("Baked the simulation zone"));
    expect(said).toMatch(/Box: comes to rest at [\d.]+ s; .*rests on Floor/);
    expect(baked).toBe("True True True True");
  });

  it("frees every bake, so each simulation follows changes again", async () => {
    const { failed, said } = await call("blender_simulate", { bake: false });
    const freed = await script(
      "print(bpy.context.scene.rigidbody_world.point_cache.is_baked, bpy.data.objects['Sheet'].modifiers['Cloth'].point_cache.is_baked)",
    );

    expect(failed, said).toBe(false);
    expect(said).toContain(
      "Freed the bakes of the rigid-body world, cloth on Sheet, soft body on Jelly, particles Sparks on Emitter and the simulation zone of Falling on Zone: each follows changes again.",
    );
    expect(freed).toBe("False False");
  });

  it("says where a simulation zone's state stops being finite", async () => {
    await fresh([cube("Seed", [0.1, 0.1, 0.1], [0, 0, 1])]);
    await script(
      [
        "import bpy",
        "zone = bpy.data.objects['Seed']",
        "tree = bpy.data.node_groups.new('Growing', 'GeometryNodeTree')",
        "tree.interface.new_socket('Geometry', in_out='INPUT', socket_type='NodeSocketGeometry')",
        "tree.interface.new_socket('Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')",
        "n = tree.nodes; l = tree.links",
        "i, o = n.new('NodeGroupInput'), n.new('NodeGroupOutput')",
        "si, so = n.new('GeometryNodeSimulationInput'), n.new('GeometryNodeSimulationOutput')",
        "si.pair_with_output(so)",
        "grow = n.new('GeometryNodeSetPosition'); scale = n.new('ShaderNodeVectorMath'); scale.operation = 'SCALE'",
        "scale.inputs['Scale'].default_value = 30.0",
        "l.new(n.new('GeometryNodeInputPosition').outputs[0], scale.inputs[0]); l.new(scale.outputs[0], grow.inputs['Position'])",
        "l.new(i.outputs[0], si.inputs['Geometry']); l.new(si.outputs['Geometry'], grow.inputs['Geometry'])",
        "l.new(grow.outputs['Geometry'], so.inputs['Geometry']); l.new(so.outputs['Geometry'], o.inputs[0])",
        "zone.modifiers.new('Growing', 'NODES').node_group = tree",
      ].join("\n"),
    );

    const { failed, said } = await call("blender_simulate", { bake: true });

    expect(failed, said).toBe(false);
    expect(said).toMatch(
      /Baked the simulation zone of Growing on Seed: frames 1 to 48 in [\d.]+ s, [\d.]+ [KM]?i?B kept in the scene file; 8 points at every frame; positions are not finite from frame \d+ \([\d.]+ s\): the zone's state blew up, [\d.e+]+ m from Seed's origin at frame \d+ before it\./,
    );
  });

  it("leaves dynamic paint and a liquid cached beside the scene for a script, changing nothing there", async () => {
    await fresh([
      {
        name: "Canvas",
        kind: "grid",
        size: [1, 1],
        segments: 8,
        location: [3, 0, 0],
      },
      {
        name: "Brush",
        kind: "sphere",
        size: [0.3, 0.3, 0.3],
        location: [3, 0, 0.1],
      },
      cube("Domain", [0.2, 0.2, 0.2], [0, 0, 0.1]),
      {
        name: "Tap",
        kind: "sphere",
        size: [0.04, 0.04, 0.04],
        location: [0, 0, 0.15],
      },
    ]);
    await script(
      [
        "import bpy",
        "s = bpy.context.scene; s.frame_end = 6",
        "o = bpy.data.objects",
        "for name, kind in (('Canvas', 'CANVAS'), ('Brush', 'BRUSH')):",
        "    o[name].modifiers.new('Dynamic Paint', 'DYNAMIC_PAINT')",
        "    with bpy.context.temp_override(object=o[name], active_object=o[name]):",
        "        bpy.ops.dpaint.type_toggle(type=kind)",
        "d = o['Domain'].modifiers.new('Fluid', 'FLUID'); d.fluid_type = 'DOMAIN'",
        "d.domain_settings.domain_type = 'LIQUID'; d.domain_settings.resolution_max = 12",
        "d.domain_settings.cache_directory = '//cache_liquid'",
        "f = o['Tap'].modifiers.new('Fluid', 'FLUID'); f.fluid_type = 'FLOW'",
        "f.flow_settings.flow_type = 'LIQUID'; f.flow_settings.flow_behavior = 'INFLOW'",
      ].join("\n"),
    );

    const before = await besideSceneOncePreviewed();
    const { failed, said } = await call("blender_simulate", { bake: true });
    const after = await besideSceneOncePreviewed();

    expect(failed, said).toBe(false);
    expect(said).toContain(
      "Left dynamic paint Surface on Canvas unbaked: Blender keeps its cache only in a folder beside the scene, which this writes none of: bake it in a script, with bpy.ops.ptcache.bake(bake=True) under bpy.context.temp_override(scene=scene, point_cache=surface.point_cache).",
    );
    expect(said).toContain(
      "Left liquid in Domain unbaked: its cache folder is the scene's own, beside it, which this writes none of: bake it in a script, with bpy.ops.fluid.bake_all() under bpy.context.temp_override(object=domain, active_object=domain), or make the liquid with blender_simulate's liquid.",
    );
    // Blender makes a domain's folder as it evaluates the scene; the bake writes nothing there.
    expect(after).toEqual(before);
  });

  it("keeps a cloth set to a disk cache in the scene file instead, and says it switched", async () => {
    await fresh([cube("Floor", [3, 3, 0.2], [0, 0, -0.1])]);
    await script(
      [
        "import bpy",
        "s = bpy.context.scene; s.frame_end = 6",
        "bpy.ops.mesh.primitive_grid_add(x_subdivisions=4, y_subdivisions=4, size=1, location=(0, 0, 1))",
        "sheet = bpy.context.object; sheet.name = 'Sheet'",
        "cache = sheet.modifiers.new('Cloth', 'CLOTH').point_cache",
        "with bpy.context.temp_override(scene=s, point_cache=cache):",
        "    cache.use_disk_cache = True",
      ].join("\n"),
    );

    const before = await besideSceneOncePreviewed();
    const { failed, said } = await call("blender_simulate", { bake: true });
    const after = await besideSceneOncePreviewed();

    expect(failed, said).toBe(false);
    expect(said).toMatch(
      /Baked cloth on Sheet: frames 1 to 6 in [\d.]+ s, [\d.]+ [KM]?i?B kept in the scene file, its disk cache switched off, as this writes no folder beside the scene\./,
    );
    expect(after).toEqual(before);
  });

  it("gives colliders to a soft body and particles a script made, says how each look reached them, refuses a video that would jump them, and checks them after a bake", async () => {
    await fresh([cube("Floor", [3, 3, 0.2], [0, 0, -0.1])]);
    const nothing = await call("blender_simulate", {
      colliders: { objects: ["Floor"] },
    });
    expect(nothing.failed).toBe(true);
    expect(nothing.said).toContain(
      "The scene has no cloth, soft body or particles for colliders to meet.",
    );
    await script(
      [
        "import bpy",
        "s = bpy.context.scene; s.frame_end = 12",
        "bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=0.2, location=(0, 0, 0.5))",
        "jelly = bpy.context.object; jelly.name = 'Jelly'",
        "jelly.modifiers.new('Softbody', 'SOFT_BODY').settings.use_goal = False",
        "bpy.ops.mesh.primitive_plane_add(size=0.5, location=(1, 0, 1))",
        "emitter = bpy.context.object; emitter.name = 'Emitter'",
        "emitter.modifiers.new('Sparks', 'PARTICLE_SYSTEM')",
        "settings = emitter.particle_systems[0].settings",
        "settings.count, settings.frame_start, settings.frame_end, settings.lifetime = 20, 1, 3, 50",
        "jelly.modifiers['Softbody'].settings.collision_collection = bpy.data.collections.new('Bowls only')",
      ].join("\n"),
    );
    await call("blender_set_camera", {
      location: [0, -6, 2],
      look_at: [0, 0, 0.3],
    });

    const colliders = await call("blender_simulate", {
      colliders: { objects: ["Floor"] },
    });
    const looked = await call("blender_frame_sheet", {
      pictures: false,
      time: 0,
      end: 0.25,
    });
    const described = await call("blender_describe_scene", {});
    const jumped = await call("blender_render_video", {
      output: "videos/late.mp4",
      start: 0.2,
      end: 0.3,
      samples: 1,
      resolution: [64, 36],
    });
    const stepped = await call("blender_render_video", {
      output: "videos/stepped.mp4",
      end: 0.1,
      samples: 1,
      resolution: [64, 36],
    });
    const baked = await call("blender_simulate", { bake: true });
    const after = await call("blender_describe_scene", {});
    const read = await call("blender_frame_sheet", {
      pictures: false,
      time: 0,
      end: 0.25,
    });
    await script("import bpy\nbpy.context.scene.frame_end = 24");
    const short = await call("blender_describe_scene", {});
    const past = await call("blender_render_video", {
      output: "videos/past.mp4",
      end: 0.9,
      samples: 1,
      resolution: [64, 36],
    });

    expect(colliders.failed, colliders.said).toBe(false);
    expect(colliders.said).toMatch(
      /Colliders Floor, each [\d.]+ mm thick on the outside, a tenth of the finest spacing, [\d.]+ mm, met by the soft body on Jelly and the particles Sparks on Emitter\./,
    );
    expect(colliders.said).toContain(
      "The soft body on Jelly meets only the collection Bowls only, which holds no Floor: it passes through them.",
    );
    expect(looked.said).toContain(
      "Simulations: soft body on Jelly and particles Sparks on Emitter are not baked, so each moment was reached by stepping every frame from frame 1 (0 s).",
    );
    expect(described.said).toContain(
      "Simulations, against the scene's frames 1 to 12: soft body on Jelly not baked: worked out frame by frame from frame 1",
    );
    expect(jumped.failed).toBe(true);
    expect(jumped.said).toContain(
      "soft body on Jelly is not baked, and this video starts after it does, which would jump it",
    );
    expect(stepped.failed, stepped.said).toBe(false);
    expect(stepped.said).toContain(
      "soft body on Jelly, not baked, worked out by Blender frame by frame as it rendered from frame 1",
    );
    expect(baked.failed, baked.said).toBe(false);
    expect(baked.said).toMatch(
      /(Sound|Unsound) soft body on Jelly after the bake: [^\n]*top speed [\d.]+ m\/s at [\d.]+ s/,
    );
    expect(baked.said).toMatch(
      /Sound particles Sparks on Emitter after the bake: top speed [\d.]+ m\/s at [\d.]+ s, under the [\d.]+ m\/s that would mean it blew up, 20 alive at the end/,
    );
    expect(after.said).toContain(
      "soft body on Jelly baked over frames 1 to 12",
    );
    expect(read.said).toContain(
      "soft body on Jelly was read from its bake of frames 1 to 12",
    );
    expect(short.said).toContain(
      "soft body on Jelly baked over frames 1 to 12, ending before the scene's 24",
    );
    expect(past.failed).toBe(true);
    expect(past.said).toMatch(
      /soft body on Jelly is baked over frames 1 to 12, and the video runs over frames 1 to 23/,
    );
  }, 300_000);
});
