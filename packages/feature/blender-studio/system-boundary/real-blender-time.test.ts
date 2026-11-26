/**
 * The studio's timing against a real Blender: what holds only when Blender
 * runs at its own speed. A picture shown again once the previews have stayed
 * still for two seconds, a quick and a full picture within six, a slow scene's
 * full picture against drawing it to the end, a slow shape left alone within
 * five seconds, a render's estimate against the time it took, a spec's
 * measures within their time and the command's, and CAD parts brought in and
 * keyed within their seconds. Each outcome depends on how fast the machine
 * runs Blender, so this file runs with the machine to itself. Skipped unless
 * Blender is named, as the other real-Blender tests are:
 *
 *   $env:ZHIYIN_BLENDER = "…\blender.exe"; npx vitest run --project "system-boundary*" packages/feature/blender-studio/system-boundary/real-blender-time.test.ts
 */

import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type {
  ActionDetail,
  CadMotionFile,
  ScenePreview,
} from "@zhiyin/contract";
import { openProcessContainer } from "@zhiyin/sandbox";
import { TemporaryFolders } from "@zhiyin/test-support";
import { withKeptGlCache } from "../test/kept-gl-cache.js";
import {
  ConversationScenes,
  containedSessionLaunch,
  sceneAutomation,
} from "../src/index.js";
import { cadLikeGlb } from "./cad-like-glb.js";

const blender = process.env["ZHIYIN_BLENDER"];
const sessionScript = fileURLToPath(
  new URL("../src/session/start.py", import.meta.url),
);
type Result = {
  isError?: boolean;
  content: { type: string; text?: string; data?: string }[];
};
type Item = { label: string; holds: boolean | null; note?: string };

describe.runIf(blender)("a real Blender", () => {
  const rootFolders = new TemporaryFolders();
  let root: string;
  let workspace: string;
  let scenes: ConversationScenes;
  let tools: ReturnType<typeof sceneAutomation>;
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = (await tools.callTool(name, args)) as Result;
    return {
      ...result,
      said: result.content.map((c) => c.text ?? "").join("\n"),
    };
  };

  beforeAll(async () => {
    root = await rootFolders.make("zhiyin-studio-live-");
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
    tools = sceneAutomation(scenes.scene("live"), {
      workspaceRoot: () => workspace,
      blender: async () => blender,
      directory: scenes.directory("live"),
    });
    // The part the first test reloads from disk.
    await call("blender_open_scene", { path: "part.blend", create: true });
    await call("blender_add_objects", {
      objects: [{ name: "Plate", kind: "cube", size: [0.08, 0.04, 0.006] }],
    });
  });

  afterAll(async () => {
    await scenes.forget("live");
    await scenes.closeAll();
    await rootFolders.removeAll();
  });

  it("shows the scene again when it was loaded from disk, even when the command then fails", async () => {
    await copyFile(join(workspace, "part.blend"), join(root, "kept.blend"));
    await call("blender_edit_objects", {
      edits: [{ object: "Plate", move_by: [0.1, 0, 0] }],
    });
    await copyFile(join(root, "kept.blend"), join(workspace, "part.blend"));
    // The edit's own picture arrives first.
    let before = -1;
    while (before !== (scenes.scene("live").state().preview?.sequence ?? 0)) {
      before = scenes.scene("live").state().preview?.sequence ?? 0;
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }

    const failed = await call("blender_edit_objects", {
      edits: [{ object: "Nowhere", move_by: [0.1, 0, 0] }],
    });

    expect(failed.isError).toBe(true);
    expect(failed.said).toContain(
      "part.blend changed on disk, so it was loaded again.",
    );
    await vi.waitFor(
      () =>
        expect(
          scenes.scene("live").state().preview?.sequence ?? 0,
        ).toBeGreaterThan(before),
      { timeout: 30_000 },
    );
  });

  it("draws a quick picture in the objects' own colours while the view turns, and leaves the scene as it was", async () => {
    await call("blender_open_scene", { path: "quick.blend", create: true });
    await call("blender_add_objects", {
      objects: [{ name: "Brick", kind: "cube", size: [0.1, 0.1, 0.1] }],
    });
    await call("blender_set_material", {
      objects: ["Brick"],
      material: { name: "Brick red", color: "#c81e1e", roughness: 0.6 },
    });
    await call("blender_set_lighting", { preset: "product" });
    // A camera exposure for the render, which the solid view draws without.
    await call("blender_run_script", {
      code: "import bpy\nbpy.context.scene.view_settings.exposure = -3",
    });
    const settings =
      "import bpy\ns = bpy.context.scene\nm = bpy.data.materials['Brick red']\nv = s.view_settings\nprint('settings', s.render.engine, s.display.shading.color_type, s.render.resolution_percentage, tuple(round(c, 3) for c in m.diffuse_color), tuple(round(c, 3) for c in s.world.color), [o.hide_render for o in s.objects], v.view_transform, v.look, v.exposure, v.gamma)";
    const before = (await call("blender_run_script", { code: settings })).said;

    const session = scenes.scene("live");
    // The change's own picture is drawn before the view turns.
    await call("blender_api", { name: "Object" });
    const pictures: ScenePreview[] = [];
    const known = session.state().preview?.sequence ?? 0;
    const stop = session.onState((state) => {
      const latest = pictures.at(-1)?.sequence ?? known;
      if (state.preview && state.preview.sequence > latest)
        pictures.push(state.preview);
    });
    session.look({ kind: "turn", yaw: 20, pitch: 0 });
    for (let tries = 0; tries < 300 && pictures.length < 2; tries++)
      await new Promise((resolve) => setTimeout(resolve, 20));
    stop();
    const [quick, full] = pictures;
    await writeFile(
      join(workspace, "quick.jpg"),
      Buffer.from(quick!.data, "base64"),
    );
    // Blender reads the middle of the quick picture, where the brick is.
    const read = await call("blender_run_script", {
      code: [
        "import bpy",
        "image = bpy.data.images.load(bpy.path.abspath('//quick.jpg'))",
        "w, h = image.size",
        "p = image.pixels[:]",
        "patch = [(y * w + x) * 4 for x in range(w // 2 - 4, w // 2 + 4) for y in range(h // 2 - 4, h // 2 + 4)]",
        "print('brick', *[sum(p[i + c] for i in patch) / len(patch) for c in range(3)])",
        "bpy.data.images.remove(image)",
      ].join("\n"),
    });
    const [red, green, blue] = (/brick (.+)/.exec(read.said)?.[1] ?? "")
      .split(" ")
      .map(Number) as [number, number, number];
    const after = (await call("blender_run_script", { code: settings })).said;

    expect(quick?.quick).toBe(true);
    expect(full?.quick).toBeUndefined();
    expect(red).toBeGreaterThan(Math.max(green, blue) * 1.8);
    expect(
      red,
      "the brick's red at the exposure of a lit view",
    ).toBeGreaterThan(0.25);
    expect(after.match(/settings .+/)?.[0]).toBe(
      before.match(/settings .+/)?.[0],
    );
  });

  it("keeps the full picture of a slow see-through scene far quicker than drawing it to the end, and leaves its settings as they were", async () => {
    await call("blender_open_scene", { path: "slow.blend", create: true });
    await call("blender_add_objects", {
      objects: [
        { name: "Jar", kind: "cube", size: [0.1, 0.1, 0.1] },
        { name: "Smoke", kind: "cube", size: [0.08, 0.08, 0.08] },
      ],
    });
    await call("blender_set_material", {
      objects: ["Jar"],
      material: {
        name: "Glass",
        color: "#ffffff",
        transmission: 1,
        roughness: 0,
      },
    });
    await call("blender_set_lighting", { preset: "product" });
    await call("blender_set_camera", {
      frame: { objects: ["Jar"], direction: "front", margin: 0.3 },
    });
    // Smoke that light scatters through many times: slow to draw however
    // few samples a picture takes.
    await call("blender_run_script", {
      code: [
        "import bpy",
        "s = bpy.context.scene",
        "s.cycles.volume_bounces = 128",
        "s.cycles.max_bounces = 128",
        "s.cycles.volume_step_rate = 0.05",
        "m = bpy.data.materials.new('Smoke')",
        "m.use_nodes = True",
        "t = m.node_tree",
        "t.nodes.remove(t.nodes['Principled BSDF'])",
        "scatter = t.nodes.new('ShaderNodeVolumeScatter')",
        "noise = t.nodes.new('ShaderNodeTexNoise')",
        "noise.inputs['Scale'].default_value = 40",
        "density = t.nodes.new('ShaderNodeMath')",
        "density.operation = 'MULTIPLY'",
        "density.inputs[1].default_value = 40000",
        "t.links.new(noise.outputs['Fac'], density.inputs[0])",
        "t.links.new(density.outputs[0], scatter.inputs['Density'])",
        "t.links.new(scatter.outputs[0], t.nodes['Material Output'].inputs['Volume'])",
        "bpy.data.objects['Smoke'].data.materials.append(m)",
      ].join("\n"),
    });
    const limit =
      "import bpy\nprint('limit', bpy.context.scene.cycles.time_limit)";
    const before = (await call("blender_run_script", { code: limit })).said;
    const session = scenes.scene("live");
    await call("blender_api", { name: "Object" });
    let full: ScenePreview | undefined;
    const known = session.state().preview?.sequence ?? 0;
    const stop = session.onState((state) => {
      if (
        state.preview &&
        state.preview.sequence > known &&
        !state.preview.quick
      )
        full ??= state.preview;
    });
    const began = Date.now();
    session.look({ kind: "view", view: "camera" });
    while (!full && Date.now() - began < 60_000)
      await new Promise((resolve) => setTimeout(resolve, 20));
    const took = Date.now() - began;
    stop();
    const after = (await call("blender_run_script", { code: limit })).said;
    // The same scene at the full picture's size and samples, drawn to the
    // end. Whatever else is using the graphics card slows both, so the full
    // picture is held against this one rather than against the clock alone.
    const toTheEnd = await call("blender_render", {
      output: "renders/slow.png",
      engine: "cycles",
      samples: 16,
      resolution: [480, 270],
    });
    const drawing = Number(/ in ([\d.]+) s/.exec(toTheEnd.said)?.[1]) * 1000;

    expect(full).toBeDefined();
    // The wait before it, a second of drawing, and Blender's own preparation.
    expect(took).toBeLessThan(drawing / 2);
    expect(took).toBeLessThan(30_000);
    expect(after.match(/limit .+/)?.[0]).toBe(before.match(/limit .+/)?.[0]);
  });
});

describe.runIf(blender)("a real Blender's checks after a change", () => {
  const folders = new TemporaryFolders();
  let workspace: string;
  let scenes: ConversationScenes;
  let tools: ReturnType<typeof sceneAutomation>;
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = (await tools.callTool(name, args)) as Result;
    return {
      ...result,
      said: result.content.map((c) => c.text ?? "").join("\n"),
    };
  };
  const done = async (name: string, args: Record<string, unknown>) => {
    const answer = await call(name, args);
    expect(answer.isError, answer.said).toBeUndefined();
    return answer.said;
  };
  const script = (lines: string[]) =>
    done("blender_run_script", { code: lines.join("\n") });

  beforeAll(async () => {
    const root = await folders.make("zhiyin-studio-change-checks-");
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
    tools = sceneAutomation(scenes.scene("checks"), {
      workspaceRoot: () => workspace,
      blender: async () => blender,
      directory: scenes.directory("checks"),
    });
  });

  afterAll(async () => {
    await scenes.forget("checks");
    await scenes.closeAll();
    await folders.removeAll();
  });

  it("keeps a call that leaves a slow shape alone quick, its preview drawn from the shape as evaluated", async () => {
    await done("blender_open_scene", { path: "slow.blend", create: true });
    // Its poles, where 200 faces meet, make it slow to subdivide: seconds at each evaluation.
    await script([
      "import bpy, bmesh",
      "b = bmesh.new()",
      "bmesh.ops.create_uvsphere(b, u_segments=200, v_segments=125, radius=0.5)",
      "m = bpy.data.meshes.new('Ball')",
      "b.to_mesh(m)",
      "b.free()",
      "o = bpy.data.objects.new('Ball', m)",
      "o.location = (0, 0, 0.5)",
      "bpy.context.scene.collection.objects.link(o)",
      "o.modifiers.new('Sub', 'SUBSURF').levels = 1",
    ]);
    // Each call waits for the preview of the one before it.
    await script(["print('nothing')"]);
    const started = Date.now();
    const box = await done("blender_add_objects", {
      objects: [
        {
          name: "Box",
          kind: "box",
          size: [0.2, 0.2, 0.2],
          location: [2, 0, 0.1],
        },
      ],
    });
    await script(["print('nothing')"]);
    expect(box).toContain("Added Box");
    expect(Date.now() - started).toBeLessThan(5_000);
  }, 300_000);
});

describe.runIf(blender)(
  "a real Blender, measuring a scene against its spec",
  () => {
    const folders = new TemporaryFolders();
    let workspace: string;
    let scenes: ConversationScenes;
    let tools: ReturnType<typeof sceneAutomation>;
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = (await tools.callTool(name, args)) as Result;
      const details = tools.describeResult(name, args, {
        ok: true,
        value: result,
      }) as readonly ActionDetail[];
      const card = details.find((one) => one.kind === "checks");
      const items =
        card?.kind === "checks" ? (card.items as readonly Item[]) : [];
      return {
        ...result,
        said: result.content.map((c) => c.text ?? "").join("\n"),
        image: result.content.find((c) => c.type === "image"),
        card,
        verdict: (id: string) =>
          items.find(
            (one) => one.label === id || one.label.startsWith(`${id} ·`),
          ),
      };
    };
    const spec = (value: unknown) =>
      writeFile(join(workspace, "requirements.json"), JSON.stringify(value));

    beforeAll(async () => {
      const root = await folders.make("zhiyin-studio-spec-");
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
      tools = sceneAutomation(scenes.scene("spec"), {
        workspaceRoot: () => workspace,
        blender: async () => blender,
        directory: scenes.directory("spec"),
      });
      await call("blender_open_scene", { path: "mug.blend", create: true });
      // An 11 oz mug's body, 82 mm across and 95 high with 4 mm walls and a
      // 6 mm floor, turned round its axis.
      const added = await call("blender_add_objects", {
        objects: [
          {
            name: "Body",
            kind: "revolve",
            profile: [
              [0, 0],
              [0.041, 0],
              [0.041, 0.095],
              [0.037, 0.095],
              [0.037, 0.006],
              [0, 0.006],
            ],
          },
        ],
      });
      expect(added.isError, added.said).toBeUndefined();
    }, 180_000);

    afterAll(async () => {
      await scenes.forget("spec");
      await scenes.closeAll();
      await folders.removeAll();
    });

    it("says the requirements left when the spec's time is up not checked", async () => {
      // Three thousand beads, each measured through at 800 points, take
      // longer than the spec's measures may.
      const made = await call("blender_run_script", {
        code: [
          "import bpy, bmesh",
          "mesh = bpy.data.meshes.new('Bead')",
          "b = bmesh.new()",
          "bmesh.ops.create_uvsphere(b, u_segments=32, v_segments=16, radius=0.005)",
          "b.to_mesh(mesh)",
          "b.free()",
          "for i in range(3000):",
          "    o = bpy.data.objects.new(f'Bead_{i}', mesh)",
          "    o.location = ((i % 60) * 0.02, 4 + (i // 60) * 0.02, 0.005)",
          "    bpy.context.scene.collection.objects.link(o)",
        ].join("\n"),
      });
      expect(made.isError, made.said).toBeUndefined();
      await spec({
        requirements: [
          { id: "BW", check: "wall", part: "/Bead_.*/", min: 1 },
          { id: "BS", check: "size", part: "Bead_0", max: [20, 20, 20] },
        ],
      });

      const started = Date.now();
      const measured = await call("blender_describe_scene", {
        objects: ["Bead_0"],
      });
      const took = Date.now() - started;

      expect(took).toBeLessThan(45_000);
      // A description may run a minute: the spec has at most 30 s of it, and
      // half of what describing left.
      const seconds = Number(
        /- BW, BS not checked: the spec's measures took their (\d+) s; check fewer or smaller parts\./.exec(
          measured.said,
        )?.[1],
      );
      expect(seconds, measured.said).toBeGreaterThanOrEqual(15);
      expect(seconds, measured.said).toBeLessThanOrEqual(30);
    }, 180_000);

    it("keeps a description and its spec together within the command's time, however short", async () => {
      // Three thousand grains, each measured through at 800 points, take far
      // longer than the 6 s given; describing and the spec share them.
      const said = await call("blender_run_script", {
        code: [
          "import time, bpy, bmesh",
          "from zhiyin_studio import budget, describe, spec",
          "mesh = bpy.data.meshes.new('Grain')",
          "b = bmesh.new()",
          "bmesh.ops.create_uvsphere(b, u_segments=32, v_segments=16, radius=0.005)",
          "b.to_mesh(mesh)",
          "b.free()",
          "for i in range(3000):",
          "    o = bpy.data.objects.new(f'Grain_{i}', mesh)",
          "    o.location = ((i % 60) * 0.02, -4 - (i // 60) * 0.02, 0.005)",
          "    bpy.context.scene.collection.objects.link(o)",
          "class Named:",
          "    name = 'grains.blend'",
          "with budget.limited(6):",
          "    started = time.monotonic()",
          "    described = describe.describe_scene({'objects': ['Grain_0']}, Named())",
          "    verdicts = spec.checked([{'id': 'GW', 'check': 'wall', 'part': '/Grain_.*/', 'min': 1}])",
          "    took = time.monotonic() - started",
          "print('within 6 s:', took < 6)",
          "print('wall:', verdicts[0].get('why'))",
          "for o in [o for o in bpy.data.objects if o.name.startswith('Grain_')]: bpy.data.objects.remove(o)",
        ].join("\n"),
      });

      expect(said.isError, said.said).toBeUndefined();
      expect(said.said).toContain("within 6 s: True");
      expect(said.said).toMatch(
        /wall: the spec's measures took their [0-5](\.\d)? s; check fewer or smaller parts/,
      );
    }, 180_000);

    it("stops separate, reach and inside at the spec's time over 3,000 beads, each within its own measuring", async () => {
      // The beads' shapes take a few seconds; each of these measures alone,
      // uncut, takes well over a minute on them.
      const made = await call("blender_run_script", {
        code: [
          "import bpy, bmesh",
          "mesh = bpy.data.meshes.new('Dense')",
          "b = bmesh.new()",
          "bmesh.ops.create_uvsphere(b, u_segments=256, v_segments=128, radius=0.05)",
          "b.to_mesh(mesh)",
          "b.free()",
          "o = bpy.data.objects.new('Dense', mesh)",
          "o.location = (0.6, 4.5, 0.2)",
          "bpy.context.scene.collection.objects.link(o)",
        ].join("\n"),
      });
      expect(made.isError, made.said).toBeUndefined();
      const kinds = [
        { id: "SB", check: "separate", parts: ["/Bead_.*/"] },
        {
          id: "RB",
          check: "reach",
          part: "Dense",
          from: "/Bead_.*/",
          range: [0, 10],
        },
        { id: "IB", check: "inside", part: "Dense", of: "/Bead_.*/" },
      ];
      for (const one of kinds) {
        await spec({ requirements: [one] });
        const started = Date.now();
        const measured = await call("blender_describe_scene", {
          objects: ["Dense"],
        });
        const took = Date.now() - started;

        expect(measured.isError, measured.said).toBeUndefined();
        expect(took, one.id).toBeLessThan(45_000);
        expect(measured.verdict(one.id)).toMatchObject({
          holds: null,
          note: expect.stringMatching(
            /^the spec's measures took their (1[5-9]|2\d|30) s; check fewer or smaller parts$/,
          ),
        });
      }
    }, 240_000);

    it("measures a clearance among 600 parts within the spec's time, and says one it cannot finish not checked", async () => {
      await call("blender_open_scene", { path: "many.blend", create: true });
      // 600 balls 50 mm across, 100 mm apart, then 100 rods side by side on a
      // slant, whose boxes all overlap though the rods are 16 mm apart or more.
      const made = await call("blender_run_script", {
        code: [
          "import bpy, bmesh, math, mathutils",
          "s = bpy.context.scene",
          "ball = bpy.data.meshes.new('Ball')",
          "b = bmesh.new()",
          "bmesh.ops.create_uvsphere(b, u_segments=16, v_segments=8, radius=0.025)",
          "b.to_mesh(ball)",
          "b.free()",
          "for i in range(600):",
          "    o = bpy.data.objects.new(f'P_{i:03d}', ball)",
          "    o.location = ((i % 25) * 0.1, (i // 25) * 0.1, 0.025)",
          "    s.collection.objects.link(o)",
          "turn = mathutils.Matrix.Rotation(math.pi / 4, 4, 'Z') @ mathutils.Matrix.Rotation(math.pi / 2, 4, 'Y')",
          "for i in range(100):",
          "    b = bmesh.new()",
          "    bmesh.ops.create_cone(b, cap_ends=True, segments=16, radius1=0.002, radius2=0.002, depth=1.4, matrix=turn)",
          "    m = bpy.data.meshes.new(f'Rod_{i}')",
          "    b.to_mesh(m)",
          "    b.free()",
          "    o = bpy.data.objects.new(f'Rod_{i}', m)",
          "    o.location = (5 - i * 0.02 / math.sqrt(2), i * 0.02 / math.sqrt(2), 0.5)",
          "    s.collection.objects.link(o)",
        ].join("\n"),
      });
      expect(made.isError, made.said).toBeUndefined();
      await spec({
        requirements: [
          {
            id: "CB",
            check: "clearance",
            between: ["/P_.*/", "/P_.*/"],
            min: 40,
          },
        ],
      });

      const balls = await call("blender_describe_scene", {
        objects: ["P_000"],
      });

      expect(balls.isError, balls.said).toBeUndefined();
      expect(balls.verdict("CB")).toMatchObject({
        holds: true,
        note: expect.stringMatching(
          /^P_\d+ comes 50 mm from P_\d+, where at least 40 mm is asked/,
        ),
      });

      await spec({
        requirements: [
          {
            id: "CR",
            check: "clearance",
            between: ["/Rod_.*/", "/Rod_.*/"],
            min: 1,
          },
        ],
      });
      const started = Date.now();
      const rods = await call("blender_describe_scene", {
        objects: ["Rod_0"],
      });
      const took = Date.now() - started;

      expect(rods.isError, rods.said).toBeUndefined();
      expect(took).toBeLessThan(45_000);
      expect(rods.verdict("CR")).toMatchObject({
        holds: null,
        note: expect.stringMatching(
          /the spec's measures took their (1[5-9]|2\d|30) s/,
        ),
      });

      // Rods 16 mm apart fail a 20 mm clearance however many pairs are left.
      await spec({
        requirements: [
          {
            id: "CF",
            check: "clearance",
            between: ["/Rod_.*/", "/Rod_.*/"],
            min: 20,
          },
        ],
      });
      const short = await call("blender_describe_scene", {
        objects: ["Rod_0"],
      });

      expect(short.verdict("CF")).toMatchObject({
        holds: false,
        note: expect.stringMatching(
          /^Rod_\d+ comes 1[56](\.\d+)? mm from Rod_\d+, the nearest of [\d,]+ pairs measured before the spec's (1[5-9]|2\d|30) s ran out, where at least 20 mm is asked/,
        ),
      });
    }, 300_000);
  },
);

describe.runIf(blender)("a real Blender, checking renders and motion", () => {
  const folders = new TemporaryFolders();
  let workspace: string;
  let scenes: ConversationScenes;
  let tools: ReturnType<typeof sceneAutomation>;
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = (await tools.callTool(name, args)) as Result;
    return {
      ...result,
      said: result.content.map((c) => c.text ?? "").join("\n"),
    };
  };
  const done = async (name: string, args: Record<string, unknown>) => {
    const ran = await call(name, args);
    expect(ran.isError, ran.said).toBeUndefined();
    return ran.said;
  };

  beforeAll(async () => {
    const root = await folders.make("zhiyin-studio-checks-");
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
    tools = sceneAutomation(scenes.scene("checks"), {
      workspaceRoot: () => workspace,
      blender: async () => blender,
      directory: scenes.directory("checks"),
    });
    await done("blender_open_scene", { path: "checks.blend", create: true });
    await done("blender_add_objects", {
      objects: [
        { name: "Floor", kind: "plane", size: [4, 4], location: [0, 0, 0] },
        {
          name: "Block",
          kind: "cube",
          size: [0.3, 0.3, 0.3],
          location: [0, 0, 0.15],
        },
      ],
    });
    await done("blender_set_camera", {
      frame: { objects: ["Block"], direction: "three-quarter" },
      resolution: [320, 240],
    });
    await done("blender_set_lighting", { preset: "studio" });
  }, 240_000);

  afterAll(async () => {
    await scenes.forget("checks");
    await scenes.closeAll();
    await folders.removeAll();
  });

  describe("a render", () => {
    it("times a large picture beforehand, and says the scene's picture size it leaves", async () => {
      const large = await done("blender_render", {
        output: "large.png",
        samples: 128,
        resolution: [1920, 1080],
        noise: false,
      });
      await done("blender_set_camera", { resolution: [320, 240] });

      expect(large).toMatch(/Estimated beforehand at [\d.]+ (s|min)\./);
      // The estimate a refusal rests on is not far below the time the picture took.
      const took = Number(/ in ([\d.]+) s, /.exec(large)?.[1]);
      const ahead = Number(
        /Estimated beforehand at ([\d.]+) s\./.exec(large)?.[1],
      );
      expect(ahead, large).toBeGreaterThanOrEqual(took * 0.75);
      expect(large).toContain(
        "The scene's picture size is now 1920×1080, from 320×240, and stays for later pictures through its camera.",
      );
    }, 300_000);
  });
});

describe.runIf(blender)("a real Blender, on CAD parts and close checks", () => {
  const folders = new TemporaryFolders();
  let workspace: string;
  let scenes: ConversationScenes;
  let tools: ReturnType<typeof sceneAutomation>;
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = (await tools.callTool(name, args)) as Result;
    return {
      ...result,
      said: result.content.map((c) => c.text ?? "").join("\n"),
    };
  };
  /** The line blender_describe_scene gives one object. */
  const lineOf = async (name: string) => {
    const described = await call("blender_describe_scene", {
      objects: [name],
    });
    return (
      described.said
        .split("\n")
        .find((line) => line.startsWith(`- ${name}:`)) ?? ""
    );
  };
  /** What a script prints, as the scene has it. */
  const printed = async (code: string) =>
    (await call("blender_run_script", { code })).said;

  beforeAll(async () => {
    const root = await folders.make("zhiyin-studio-cad-parts-");
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
    tools = sceneAutomation(scenes.scene("cad-parts"), {
      workspaceRoot: () => workspace,
      blender: async () => blender,
      directory: scenes.directory("cad-parts"),
    });
    await writeFile(
      join(workspace, "parts.glb"),
      cadLikeGlb([
        {
          name: "Block",
          size: [0.12, 0.08, 0.04],
          at: [0, 0, 0.02],
          surfaces: { machined: ["top"], cut: ["front"] },
        },
        { name: "Cover", size: [0.1, 0.06, 0.01], at: [0, 0, 0.045] },
      ]),
    );
    await call("blender_open_scene", { path: "parts.blend", create: true });
    const added = await call("blender_add_objects", {
      objects: [
        {
          name: "Engine",
          kind: "model",
          path: "parts.glb",
          location: [0, 0, 0],
        },
      ],
    });
    expect(added.isError, added.said).toBeUndefined();
  }, 120_000);

  afterAll(async () => {
    await scenes.forget("cad-parts");
    await scenes.closeAll();
    await folders.removeAll();
  });

  it("brings in a model of four hundred parts in seconds, each closed", async () => {
    // The import leaves every part chosen: closing each in turn closed them
    // all again each time, minutes for an engine of a hundred and fifty.
    await writeFile(
      join(workspace, "many.glb"),
      cadLikeGlb(
        Array.from({ length: 400 }, (_, k) => ({
          name: `Pin ${k + 1}`,
          size: [0.01, 0.01, 0.03] as const,
          at: [
            20 + (k % 20) * 0.02,
            (Math.floor(k / 20) - 10) * 0.02,
            0.015,
          ] as const,
        })),
      ),
    );
    const started = Date.now();
    const added = await call("blender_add_objects", {
      objects: [{ name: "Pins", kind: "model", path: "many.glb" }],
    });
    const seconds = (Date.now() - started) / 1000;

    expect(added.isError, added.said).toBeUndefined();
    expect(seconds).toBeLessThan(20);
    expect(await lineOf("Pin 400")).toContain("closed");
    // Its parts turn by the angles a script sets, as every other object does.
    await printed(
      'import bpy, math\nbpy.data.objects["Pin 1"].rotation_euler[2] = math.radians(30)',
    );
    expect(await lineOf("Pin 1")).toContain("turned (0°, 0°, 30°)");
  }, 180_000);

  it("refuses a CAD motion that ends past the longest timeline, naming the limit, and keys several parts at that length well inside its time limit", async () => {
    // Eight parts, each turning a whole turn round z in 600 s, at 24 frames a second.
    const names = Array.from({ length: 8 }, (_, i) => `Long ${i}`);
    await writeFile(
      join(workspace, "long.glb"),
      cadLikeGlb(
        names.map((name, i) => ({
          name,
          size: [0.02, 0.004, 0.004],
          at: [0.01, 0.02 * i, 0],
        })),
      ),
    );
    const turned = (degrees: number) => {
      const [c, s] = [
        Math.cos((degrees * Math.PI) / 180),
        Math.sin((degrees * Math.PI) / 180),
      ];
      return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    };
    await writeFile(
      join(workspace, "long.json"),
      JSON.stringify({
        motion: 1,
        positions: [["0"], ["90"], ["180"], ["270"]],
        parts: Object.fromEntries(
          names.map((name) => [
            name,
            [turned(0), turned(90), turned(180), turned(270)],
          ]),
        ),
        unfitted: {},
        still: 0,
      } satisfies CadMotionFile),
    );
    const added = await call("blender_add_objects", {
      objects: [
        {
          name: "Long run",
          kind: "model",
          path: "long.glb",
          location: [3, 0, 0],
        },
      ],
    });
    const tooLong = await call("blender_animate", {
      fps: 24,
      cad_motion: { file: "long.json", to: 900, cycle: true },
    });
    const started = Date.now();
    const longest = await call("blender_animate", {
      cad_motion: { file: "long.json", to: 600, cycle: true },
    });
    const took = Date.now() - started;
    const halfway = await printed(
      [
        "import bpy, math",
        "s = bpy.context.scene",
        "s.frame_set(s.frame_start + 300 * 24)",
        "print(f\"at 300 s: {math.degrees(bpy.data.objects['Long 7'].rotation_euler.z):.2f}\")",
        "s.frame_set(s.frame_start)",
      ].join("\n"),
    );
    await call("blender_animate", { duration: 2, clear: ["/Long \\d/"] });

    expect(added.isError, added.said).toBeUndefined();
    expect(tooLong.isError).toBe(true);
    expect(tooLong.said).toContain("to is at most 600 s");
    expect(longest.isError, longest.said).toBeUndefined();
    expect(longest.said).toContain(
      "8 parts keyed at every frame from 0 s to 600 s",
    );
    // The command's limit is two minutes; this is well inside it.
    expect(took).toBeLessThan(30_000);
    expect(halfway).toContain("at 300 s: 180.00");
  }, 300_000);

  // Untimed, but it names the four hundred pins the first test here brings in.
  it("takes a name written as a pattern for every object it matches whole, and says which", async () => {
    const painted = await call("blender_set_material", {
      objects: ["/Pin 1[0-9]/", "Pin 3"],
      material: { name: "Pin steel", color: "#8a8d91", metallic: 1 },
    });
    expect(painted.isError, painted.said).toBeUndefined();
    expect(painted.said).toContain(
      "/Pin 1[0-9]/ named 10 objects: Pin 10, Pin 11, Pin 12, Pin 13, Pin 14, Pin 15, Pin 16, Pin 17, Pin 18, Pin 19.",
    );
    expect(painted.said).toContain(
      "on Pin 10, Pin 11, Pin 12, Pin 13, Pin 14, Pin 15, Pin 16, Pin 17, Pin 18, Pin 19, Pin 3.",
    );
    // Whole names only: "Pin 1" matches neither "Pin 10" nor "Pin 100".
    const described = await call("blender_describe_scene", {
      objects: ["/Pin 1/", "/Pin 39[0-9]/"],
    });
    expect(described.said).toContain("/Pin 1/ named 1 object: Pin 1.");
    expect(described.said.match(/^- Pin \d+:/gm)).toHaveLength(11);

    // The model's group is an empty, which takes no material: said, not dropped.
    const grouped = await call("blender_set_material", {
      objects: ["/Pins|Pin 5/"],
      material: { name: "Pin steel" },
    });
    expect(grouped.isError, grouped.said).toBeUndefined();
    expect(grouped.said).toContain(
      "/Pins|Pin 5/ named 1 object: Pin 5. Left out, as this cannot take them: Pins (an empty).",
    );

    const none = await call("blender_set_material", {
      objects: ["/Pni .*/"],
      material: { name: "Pin steel" },
    });
    expect(none.isError).toBe(true);
    expect(none.said).toContain("/Pni .*/ matches no object's whole name.");
    const broken = await call("blender_describe_scene", {
      objects: ["/Pin (1/"],
    });
    expect(broken.isError).toBe(true);
    expect(broken.said).toContain(
      "/Pin (1/ is not a pattern: missing ), unterminated subpattern",
    );
  }, 180_000);
});
