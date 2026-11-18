/**
 * Cloth, colliders and liquids against a real Blender: a tablecloth draped
 * over a table and kept as its shape, a curtain pinned along its top edge
 * left to move, a cushion inflated, two panels sewn together, and a blob of
 * water dropped into a thin glass and a thick one, baked and measured. Each
 * answer says what was set and what the simulation measured.
 *
 *   $env:ZHIYIN_BLENDER = "…\blender.exe"; npx vitest run --project system-boundary packages/feature/blender-studio/system-boundary/real-blender-simulate-cloth.test.ts
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

const cube = (name: string, size: number[], location: number[]) => ({
  name,
  kind: "cube",
  size,
  location,
});

describe.runIf(blender)("cloth and liquids in a real Blender", () => {
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
  const script = (code: string) => call("blender_run_script", { code });
  const fresh = async (objects: Record<string, unknown>[]) => {
    await script(
      "import bpy\nfor o in list(bpy.data.objects): bpy.data.objects.remove(o)",
    );
    const added = await call("blender_add_objects", { objects });
    expect(added.failed, added.said).toBe(false);
  };

  beforeAll(async () => {
    const root = await folders.make("zhiyin-studio-cloth-");
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
    tools = sceneAutomation(scenes.scene("cloth"), {
      workspaceRoot: () => workspace,
      blender: async () => blender,
      directory: scenes.directory("cloth"),
    });
    await call("blender_open_scene", { path: "cloth.blend", create: true });
  });

  afterAll(async () => {
    await scenes.forget("cloth");
    await scenes.closeAll();
    await folders.removeAll();
  });

  it("drapes a tablecloth over a table, keeps where it came to rest and says how it lies", async () => {
    await fresh([
      cube("Table", [1, 1, 1], [0, 0, 0.5]),
      {
        name: "Tablecloth",
        kind: "plane",
        size: [1.6, 1.6],
        location: [0, 0, 1.2],
      },
    ]);

    const { failed, said } = await call("blender_simulate", {
      cloth: {
        object: "Tablecloth",
        subdivide_to: 0.08,
        colliders: ["Table"],
        drape: true,
      },
    });
    const after = await script(
      "c = bpy.data.objects['Tablecloth']\nzs = [(c.matrix_world @ v.co).z for v in c.data.vertices]\n" +
        "print('steps', [m.type for m in c.modifiers], [m.type for m in bpy.data.objects['Table'].modifiers])\n" +
        "print('lies on top', 1.0 < max(zs) < 1.05, 'hangs down', min(zs) < 0.9)",
    );

    expect(failed, said).toBe(false);
    expect(said).toContain(
      "Tablecloth: cotton cloth (Blender's preset), 441 points 80 mm apart, subdivided from 4 points; self-collision on, 5 steps a frame.",
    );
    expect(said).toContain(
      "Collides with Table: each 8 mm thick on the outside, and the cloth keeps 8 mm from them, a tenth of its spacing each.",
    );
    expect(said).toMatch(
      /Draped: came to rest after [\d.]+ s \(\d+ frames\), no point moving more than [\d.]+ mm over its last 10 frames; kept as its shape, the cloth and the collision given for it removed, back at frame 1\./,
    );
    expect(said).toMatch(/Rests 1\d(\.\d+)? mm off Table at its nearest\./);
    expect(said).toMatch(
      /Folds: \d+ of \d+ edges fold past 60°, the sharpest \d+°: /,
    );
    expect(said).toMatch(
      /Sound: stretched at most [\d.]+× its rest length, no point inside a collider, and it crosses itself nowhere\./,
    );
    expect(after.said).toContain("steps [] []");
    expect(after.said).toContain("lies on top True hangs down True");
  });

  it("drapes a cloth over the colliders the same call gives every simulation", async () => {
    await fresh([
      cube("Table", [1, 1, 1], [0, 0, 0.5]),
      {
        name: "Tablecloth",
        kind: "plane",
        size: [1.6, 1.6],
        location: [0, 0, 1.2],
      },
    ]);

    const { failed, said } = await call("blender_simulate", {
      cloth: { object: "Tablecloth", subdivide_to: 0.08, drape: true },
      colliders: { objects: ["Table"] },
    });
    const after = await script(
      "c = bpy.data.objects['Tablecloth']\nzs = [(c.matrix_world @ v.co).z for v in c.data.vertices]\n" +
        "print('lies on top', 1.0 < max(zs) < 1.05, 'hangs down', min(zs) < 0.9)",
    );

    expect(failed, said).toBe(false);
    expect(said).toMatch(/Draped: came to rest after [\d.]+ s/);
    expect(said).toMatch(/Rests 1?\d(\.\d+)? mm off Table at its nearest\./);
    expect(after.said).toContain("lies on top True hangs down True");
  });

  it("pins a curtain along its top edge and leaves it to move over the scene's frames", async () => {
    await fresh([
      {
        name: "Curtain",
        kind: "grid",
        size: [1, 2],
        segments: 10,
        rows: 20,
        location: [0, 0, 1.2],
        rotation: [90, 0, 0],
      },
    ]);
    await script(
      "bpy.context.scene.frame_start = 1\nbpy.context.scene.frame_end = 48",
    );

    const { failed, said } = await call("blender_simulate", {
      cloth: { object: "Curtain", fabric: "silk", pinned: { edge: "top" } },
    });
    const pressed = await call("blender_simulate", {
      cloth: { object: "Curtain", pressure: 5 },
    });

    expect(failed, said).toBe(false);
    expect(said).toContain(
      "Curtain: silk cloth (Blender's preset), 231 points 100 mm apart; self-collision on, 5 steps a frame.",
    );
    expect(said).toContain(
      "Pinned: 11 points along its top edge, held in vertex group “Pinned”.",
    );
    expect(said).toContain(
      "Moves over frames 1–48 (2 s) from where it is at frame 1; until it is baked, Blender simulates it as the scene plays from that frame.",
    );
    expect(pressed.failed).toBe(true);
    expect(pressed.said).toContain(
      "pressure inflates a closed shape, and “Curtain” is open at 60 edges.",
    );
  });

  it("bakes a pinned curtain in the same call and measures how it moved", async () => {
    await fresh([
      {
        name: "Curtain",
        kind: "grid",
        size: [1, 2],
        segments: 10,
        rows: 20,
        location: [0, 0, 1.2],
        rotation: [90, 0, 0],
      },
    ]);
    await script(
      "bpy.context.scene.frame_start = 1\nbpy.context.scene.frame_end = 24",
    );

    const { failed, said } = await call("blender_simulate", {
      cloth: { object: "Curtain", pinned: { edge: "top" } },
      bake: true,
    });

    expect(failed, said).toBe(false);
    expect(said).toMatch(
      /Baked cloth on Curtain: frames 1 to 24 in [\d.]+ s, [\d.]+ [KM]?i?B kept in the scene file\./,
    );
    expect(said).toMatch(
      /Curtain, baked over frames 1–24: (at rest at the end|still moving [\d.]+ mm over its last 10 frames at the end)/,
    );
    expect(said).toMatch(
      /(Sound|Unsound): [^\n]*; measured at frame \d+, where it stretched most\./,
    );
    // The baked cloth is measured once, after the bake, not twice.
    expect(said.split("Curtain, baked over").length).toBe(2);
  });

  const flag = () =>
    fresh([
      {
        name: "Flag",
        kind: "grid",
        size: [1, 1],
        segments: 10,
        rows: 10,
        location: [0, 0, 1],
      },
    ]);
  // The mean height of the Flag's +x edge at frames, as baked.
  const edgeHeights = (frames: number[]) =>
    script(
      [
        "c = bpy.data.objects['Flag']",
        "edge = [v.index for v in c.data.vertices if v.co.x > 0.49]",
        "def z(f):",
        "    bpy.context.scene.frame_set(f)",
        "    e = c.evaluated_get(bpy.context.evaluated_depsgraph_get())",
        "    m = e.to_mesh()",
        "    found = sum((c.matrix_world @ m.vertices[i].co).z for i in edge) / len(edge)",
        "    e.to_mesh_clear()",
        "    return round(found, 3)",
        `print('edge', [z(f) for f in ${JSON.stringify(frames)}])`,
      ].join("\n"),
    );
  const releaseSteps =
    "c = bpy.data.objects['Flag']\n" +
    "print('steps', [m.type for m in c.modifiers])\n" +
    "keys = [k.co.x for f in fcurves_of(c) if 'mask_constant' in f.data_path for k in f.keyframe_points]\n" +
    "print('keys', keys)";

  it("lets pinned points go at the time given: held still before it, falling after it", async () => {
    await flag();
    await script(
      "bpy.context.scene.frame_start = 1\nbpy.context.scene.frame_end = 36",
    );

    const { failed, said } = await call("blender_simulate", {
      cloth: { object: "Flag", pinned: { edge: "+x", release: 0.5 } },
      bake: true,
    });
    const heights = await edgeHeights([1, 6, 12, 24, 36]);

    expect(failed, said).toBe(false);
    expect(said).toContain(
      "Pinned: 11 points along its +x edge, held in vertex group “Pinned”; they let go at 0.5 s (frame 13) and move freely from then on.",
    );
    // Held at 1 m through frame 12, then falling.
    const [z1, z6, z12, z24, z36] = JSON.parse(
      /edge (\[.*\])/.exec(heights.said)?.[1] ?? "[]",
    ) as number[];
    expect([z1, z6, z12]).toEqual([1, 1, 1]);
    expect(z24).toBeLessThan(0.9);
    expect(z36).toBeLessThan(z24 ?? 0);

    // Set up again, the release replaces the one before; without one, it goes.
    const again = await call("blender_simulate", {
      cloth: { object: "Flag", pinned: { edge: "+x", release: 1 } },
    });
    expect(again.said).toContain("they let go at 1 s (frame 25)");
    const once = await script(releaseSteps);
    expect(once.said).toContain(
      "steps ['VERTEX_WEIGHT_MIX', 'CLOTH']\nkeys [24.0, 25.0]",
    );
    const held = await call("blender_simulate", {
      cloth: { object: "Flag", pinned: { edge: "+x" } },
    });
    expect(held.said).not.toContain("let go");
    const gone = await script(releaseSteps);
    expect(gone.said).toContain("steps ['CLOTH']\nkeys []");
  });

  it("refuses a release with a drape, or outside the timeline", async () => {
    await flag();
    await script(
      "bpy.context.scene.frame_start = 1\nbpy.context.scene.frame_end = 24",
    );

    const draped = await call("blender_simulate", {
      cloth: {
        object: "Flag",
        pinned: { edge: "+x", release: 0.5 },
        drape: true,
      },
    });
    const late = await call("blender_simulate", {
      cloth: { object: "Flag", pinned: { edge: "+x", release: 2 } },
    });
    const first = await call("blender_simulate", {
      cloth: { object: "Flag", pinned: { edge: "+x", release: 0 } },
    });

    expect(draped.failed).toBe(true);
    expect(draped.said).toContain(
      "pinned.release lets the pins go as the cloth moves over the scene's frames; a drape holds them until it rests.",
    );
    expect(late.failed).toBe(true);
    expect(late.said).toContain(
      "pinned.release is after the timeline's start and by its end, 0.958 s (frame 24).",
    );
    expect(first.failed).toBe(true);
    expect(first.said).toContain(
      "pinned.release is after the timeline's start and by its end, 0.958 s (frame 24).",
    );
  });

  it("says pinned points carry a cloth through a collider only while they are pinned", async () => {
    // The whole Flag is pinned, so every point that goes through was pinned:
    // only whether its pins still held then differs.
    const pulledDown = async (pinned: Record<string, unknown>) => {
      await flag();
      await script(
        "c = bpy.data.objects['Flag']\ng = c.vertex_groups.new(name='All')\ng.add(list(range(len(c.data.vertices))), 1.0, 'REPLACE')",
      );
      await call("blender_add_objects", {
        objects: [
          {
            name: "Ledge",
            kind: "plane",
            size: [0.1, 1.2],
            location: [0.5, 0, 0.6],
          },
        ],
      });
      await call("blender_animate", {
        keys: [
          { object: "Flag", at: 0, location: [0, 0, 1] },
          { object: "Flag", at: 1, location: [0, 0, 0.2], easing: "linear" },
        ],
      });
      await script(
        "bpy.context.scene.frame_start = 1\nbpy.context.scene.frame_end = 36",
      );
      const made = await call("blender_simulate", {
        cloth: { object: "Flag", pinned, colliders: ["Ledge"] },
      });
      expect(made.failed, made.said).toBe(false);
      // The cloth is made to ignore its colliders, so it goes through the
      // Ledge whether pinned or let go.
      await script(
        "bpy.data.objects['Flag'].modifiers['Cloth'].collision_settings.use_collision = False",
      );
      return call("blender_simulate", { bake: true });
    };

    const pinned = await pulledDown({ group: "All" });
    const let_go = await pulledDown({ group: "All", release: 0.25 });

    expect(pinned.failed, pinned.said).toBe(false);
    expect(pinned.said).toContain(
      "its pinned points carry it through Ledge, as pins follow what holds them and no collider stops them",
    );
    expect(let_go.failed, let_go.said).toBe(false);
    expect(let_go.said).toContain("it went through Ledge");
    expect(let_go.said).not.toContain("its pinned points carry it through");
  });

  it("keeps self-collision off when told, through the bake and a call that does not name it", async () => {
    await flag();
    await script(
      "bpy.context.scene.frame_start = 1\nbpy.context.scene.frame_end = 12",
    );
    const meetsItself = async () =>
      (
        await script(
          "print('self', bpy.data.objects['Flag'].modifiers['Cloth'].collision_settings.use_self_collision)",
        )
      ).said;

    const off = await call("blender_simulate", {
      cloth: { object: "Flag", self_collision: false },
      bake: true,
    });
    expect(off.failed, off.said).toBe(false);
    expect(off.said).toContain(
      "Flag: cotton cloth (Blender's preset), 121 points 100 mm apart; self-collision off, 5 steps a frame.",
    );
    expect(await meetsItself()).toContain("self False");

    const again = await call("blender_simulate", {
      cloth: { object: "Flag", steps: 8 },
    });
    expect(again.said).toContain(
      "; self-collision off as it was set (self_collision true turns it on), 8 steps a frame as given.",
    );
    expect(await meetsItself()).toContain("self False");

    const on = await call("blender_simulate", {
      cloth: { object: "Flag", self_collision: true },
    });
    expect(on.said).toContain("; self-collision on, 8 steps a frame.");
    expect(await meetsItself()).toContain("self True");
  });

  it("says a bake made before the cloth was set up again does not show the change, and measures none of it", async () => {
    await flag();
    await script(
      "bpy.context.scene.frame_start = 1\nbpy.context.scene.frame_end = 12",
    );
    const baked = await call("blender_simulate", {
      cloth: { object: "Flag", pinned: { edge: "+x" } },
      bake: true,
    });
    expect(baked.said).toContain("Flag, baked over frames 1–12:");

    const changed = await call("blender_simulate", {
      cloth: { object: "Flag", pinned: { edge: "+x" }, steps: 8 },
    });
    const cache = await script(
      "print('baked', bpy.data.objects['Flag'].modifiers['Cloth'].point_cache.is_baked)",
    );

    expect(changed.failed, changed.said).toBe(false);
    expect(changed.said).not.toContain("Flag, baked over frames");
    expect(changed.said).not.toMatch(/stretched at most/);
    expect(changed.said).toContain(
      "Flag keeps the bake made before this call set it up again, over frames 1–12, which Blender still plays as it was baked: it does not show what has changed since. Bake again with bake true to see it, or free the bake with bake false.",
    );
    // Blender keeps the bake: setting the cloth up again does not free it.
    expect(cache.said).toContain("baked True");

    const rebaked = await call("blender_simulate", {
      cloth: { object: "Flag", pinned: { edge: "+x" }, steps: 8 },
      bake: true,
    });
    expect(rebaked.said).not.toContain("keeps the bake made before");
    expect(rebaked.said).toContain("Flag, baked over frames 1–12:");
  });

  it("refuses colliders thinner than the least Blender keeps", async () => {
    await flag();
    await call("blender_simulate", { cloth: { object: "Flag" } });
    await call("blender_add_objects", {
      objects: [cube("Box", [0.2, 0.2, 0.2], [0, 0, 0.5])],
    });

    const thin = await call("blender_simulate", {
      colliders: { objects: ["Box"], thickness: 0.0003 },
    });

    expect(thin.failed).toBe(true);
    expect(thin.said).toContain(
      "colliders.thickness is at least 1 mm, the least Blender keeps on a collider's outside: 0.3 mm was given.",
    );
  });

  it("keeps the fabric a script set when the cloth is given again without one, and takes a preset when given one", async () => {
    await fresh([
      { name: "Banner", kind: "plane", size: [1, 1], location: [0, 0, 1] },
    ]);
    const first = await call("blender_simulate", {
      cloth: { object: "Banner", subdivide_to: 0.1, pinned: { edge: "+y" } },
    });
    expect(first.failed, first.said).toBe(false);
    await script(
      "bpy.data.objects['Banner'].modifiers['Cloth'].settings.tension_stiffness = 60",
    );
    const tension = async () =>
      (
        await script(
          "print('tension', bpy.data.objects['Banner'].modifiers['Cloth'].settings.tension_stiffness)",
        )
      ).said;

    const again = await call("blender_simulate", {
      cloth: { object: "Banner", pinned: { edge: "+y" }, steps: 12 },
    });

    expect(again.failed, again.said).toBe(false);
    expect(again.said).toMatch(
      /Banner: cloth kept as it was set \(mass [\d.]+ kg, tension 60, compression [\d.]+, shear [\d.]+, bending [\d.]+\), 121 points 100 mm apart; give fabric to start again from one of Blender's presets; self-collision on, 12 steps a frame as given\./,
    );
    expect(await tension()).toContain("tension 60.0");

    const preset = await call("blender_simulate", {
      cloth: { object: "Banner", fabric: "denim", pinned: { edge: "+y" } },
    });

    expect(preset.said).toContain(
      "Banner: denim cloth (Blender's preset), 121 points 100 mm apart;",
    );
    expect(await tension()).not.toContain("tension 60.0");
  });

  it("inflates a cushion by pressure and says how its volume grew", async () => {
    await fresh([
      cube("Floor", [2, 2, 0.1], [0, 0, -0.05]),
      cube("Cushion", [0.4, 0.4, 0.1], [0, 0, 0.1]),
    ]);

    const { failed, said } = await call("blender_simulate", {
      cloth: {
        object: "Cushion",
        subdivide_to: 0.05,
        pressure: 10,
        colliders: ["Floor"],
        drape: true,
      },
    });

    expect(failed, said).toBe(false);
    expect(said).toMatch(/Pressure 10 inflated it from 16 L to [\d.]+ L\./);
  });

  it("sews two panels together along their loose edges", async () => {
    await script(
      [
        "import bmesh",
        "for o in list(bpy.data.objects): bpy.data.objects.remove(o)",
        "mesh = bpy.data.meshes.new('Panels')",
        "bm = bmesh.new()",
        "for x0 in (-0.45, 0.05):",
        "    bmesh.ops.create_grid(bm, x_segments=4, y_segments=4, size=0.2, matrix=__import__('mathutils').Matrix.Translation((x0 + 0.2, 0, 1)))",
        "bm.verts.ensure_lookup_table()",
        "left = sorted([v for v in bm.verts if abs(v.co.x + 0.05) < 1e-6], key=lambda v: v.co.y)",
        "right = sorted([v for v in bm.verts if abs(v.co.x - 0.05) < 1e-6], key=lambda v: v.co.y)",
        "for a, b in zip(left, right): bm.edges.new((a, b))",
        "bm.to_mesh(mesh)",
        "obj = bpy.data.objects.new('Panels', mesh)",
        "bpy.context.scene.collection.objects.link(obj)",
        "print(len(left), len(right))",
      ].join("\n"),
    );

    const { failed, said } = await call("blender_simulate", {
      cloth: {
        object: "Panels",
        sew: true,
        pinned: {
          points: [
            [-0.45, 0.2, 1],
            [0.45, 0.2, 1],
          ],
        },
        drape: true,
      },
    });

    expect(failed, said).toBe(false);
    expect(said).toMatch(
      /Sewn: 5 loose edges pull their ends together, the longest from 100 mm to [\d.]+ mm/,
    );
  });

  const glass = async (wall: number) => {
    await fresh([
      {
        name: "Glass",
        kind: "revolve",
        profile: [
          [0, -wall],
          [0.04 + wall, -wall],
          [0.04 + wall, 0.1],
          [0.04, 0.1],
          [0.04, 0],
          [0, 0],
        ],
        location: [0, 0, 0],
      },
      {
        name: "Blob",
        kind: "sphere",
        size: [0.05, 0.05, 0.05],
        location: [0, 0, 0.14],
      },
    ]);
    await script(
      "bpy.context.scene.frame_start = 1\nbpy.context.scene.frame_end = 36",
    );
  };

  it("bakes water dropped into a thin glass, warns of the leak before and measures it after", async () => {
    await glass(0.002);

    const { failed, said } = await call("blender_simulate", {
      liquid: {
        container: "Glass",
        sources: [{ object: "Blob" }],
        resolution: 24,
      },
    });

    expect(failed, said).toBe(false);
    expect(said).toMatch(
      /Liquid: water, in a new domain “Liquid” [\d.]+ × [\d.]+ × [\d.]+ mm round Blob, Glass, resolution 24: voxels [\d.]+ mm, a draft; raise resolution for the final\. Liquid that leaves the domain by its sides or top is gone; its floor holds what falls on it\./,
    );
    expect(said).toContain(
      "It shows with material “Water (liquid)”, clear and refracting at IOR 1.333.",
    );
    expect(said).toMatch(
      /Blob starts as liquid, [\d.]+ cm³ as modelled; hidden from renders, the liquid shows in its place\./,
    );
    expect(said).toMatch(
      /Glass is an obstacle: its thinnest wall, 2 mm, is under 1\.5 voxels \([\d.]+ mm\) and may let liquid through: resolution \d+ or a voxel of 1\.333 mm holds it\./,
    );
    expect(said).toMatch(
      /Baked frames 1–36 \(1\.5 s\) in [\d.]+ s; the cache, [\d.]+ MB, is kept in this conversation's own folder for renders of the scene\./,
    );
    expect(said).toMatch(
      /Liquid volume, sampled every [\d.]+ mm: [\d.]+ cm³ at 0 s, .* at 1\.46 s; at the end 100% less than at the start\. The sources hold [\d.]+ cm³ as modelled, [\d.]+ cm³ as the voxels first held them\./,
    );
    expect(said).toContain(
      "No liquid is left at the end: all of it left the domain by its sides or top.",
    );
  });

  it("holds water in a glass whose walls are thick enough and says how deep it stands", async () => {
    await glass(0.016);
    await script(
      "clear = bpy.data.materials.new('Clear')\nclear.use_nodes = True\n" +
        "clear.node_tree.nodes['Principled BSDF'].inputs['Transmission Weight'].default_value = 1\n" +
        "bpy.data.objects['Glass'].data.materials.append(clear)",
    );

    const { failed, said } = await call("blender_simulate", {
      liquid: {
        container: "Glass",
        sources: [{ object: "Blob" }],
        resolution: 24,
      },
    });
    const after = await script(
      "print(sorted(o.name for o in bpy.data.objects if o.get('zhiyin_liquid')), bpy.data.objects['Blob'].hide_render)",
    );

    expect(failed, said).toBe(false);
    expect(said).toContain(
      "It shows with material “Water (liquid)”, clear and refracting at IOR 1.333; seen through Glass's glass it shows in Cycles, as EEVEE draws light through one layer of glass at most.",
    );
    expect(said).toMatch(
      /Glass is an obstacle: its thinnest wall, 16 mm, is at least 1\.5 voxels\./,
    );
    expect(said).toMatch(
      /Outside Glass at the end: [\d.]+ cm³, [0-4](\.\d+)?% of the liquid\./,
    );
    expect(said).toMatch(
      /In Glass at the end: the liquid stands 1\d(\.\d+)? mm deep, its surface at [\d.]+ mm high \([\d.]+ mm to [\d.]+ mm across it\), [\d.]+ mm below the rim\./,
    );
    expect(after.said).toContain("['Liquid'] True");
    // Baked again with every simulation, into a new folder of its own.
    const again = await call("blender_simulate", { bake: true });
    expect(again.failed, again.said).toBe(false);
    expect(again.said).toMatch(
      /Baked liquid in Liquid: frames 1 to \d+ in [\d.]+ s, [\d.]+ [KM]?i?B kept in this conversation's own folder, for renders of the scene\./,
    );
  });

  it("pours honey into a glass from a tap and says how fast it grew", async () => {
    await glass(0.016);
    await call("blender_add_objects", {
      objects: [
        {
          name: "Tap",
          kind: "cylinder",
          size: [0.02, 0.02, 0.02],
          location: [0, 0, 0.12],
        },
      ],
    });

    const { failed, said } = await call("blender_simulate", {
      liquid: {
        container: "Glass",
        preset: "honey",
        sources: [{ object: "Tap", flow: "pour", speed: [0, 0, -0.5] }],
        resolution: 20,
      },
    });

    expect(failed, said).toBe(false);
    expect(said).toContain(
      "Tap pours liquid in at every frame, moving at (0, 0, -500 mm)/s; hidden from renders, the liquid shows in its place.",
    );
    expect(said).toMatch(
      /Liquid volume, sampled every [\d.]+ mm: .*; it grew by [\d.]+ cm³ a second while the sources poured\./,
    );
    expect(said).toMatch(
      /Outside Glass at the end: [\d.]+ cm³, [0-4](\.\d+)?% of the liquid\./,
    );
    expect(said).toMatch(/Above Glass, still falling in: [\d.]+ cm³\./);
  });

  it("keeps liquid caches under their cap by removing the oldest the open scene does not name", async () => {
    // Three caches of 1,000 bytes each, the oldest first; the scene names
    // the middle one, and the caches may hold 1,500 bytes.
    const { failed, said } = await script(
      [
        "import os, tempfile",
        "from zhiyin_studio.sim_liquid import trim_caches",
        "root = tempfile.mkdtemp(prefix='caches-')",
        "for i, name in enumerate(['old', 'named', 'new']):",
        "    os.makedirs(os.path.join(root, name))",
        "    with open(os.path.join(root, name, 'cache.bin'), 'wb') as f: f.write(b'x' * 1000)",
        "    os.utime(os.path.join(root, name), (1e9 + i * 100, 1e9 + i * 100))",
        "named = os.path.normcase(os.path.realpath(os.path.join(root, 'named')))",
        "removed = trim_caches(root, 1500, {named})",
        "print('removed', sorted(os.path.basename(p) for p in removed), 'left', sorted(os.listdir(root)))",
      ].join("\n"),
    );

    expect(failed, said).toBe(false);
    expect(said).toContain("removed ['new', 'old'] left ['named']");
  });

  it("leaves liquid caches as they are while they hold less than their cap", async () => {
    const { failed, said } = await script(
      [
        "import os, tempfile",
        "from zhiyin_studio.sim_liquid import trim_caches",
        "root = tempfile.mkdtemp(prefix='caches-')",
        "for name in ['one', 'two']:",
        "    os.makedirs(os.path.join(root, name))",
        "    with open(os.path.join(root, name, 'cache.bin'), 'wb') as f: f.write(b'x' * 1000)",
        "print('removed', trim_caches(root, 2000, set()), 'left', sorted(os.listdir(root)))",
      ].join("\n"),
    );

    expect(failed, said).toBe(false);
    expect(said).toContain("removed [] left ['one', 'two']");
  });

  it("refuses a liquid given both a resolution and a voxel", async () => {
    const { failed, said } = await call("blender_simulate", {
      liquid: { sources: [{ object: "Blob" }], resolution: 24, voxel: 0.01 },
    });

    expect(failed).toBe(true);
    expect(said).toContain(
      "liquid takes resolution or voxel, not both: one sets the other.",
    );
  });
});
