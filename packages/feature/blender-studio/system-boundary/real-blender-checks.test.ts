/**
 * What a render and a frame sheet measure against a real Blender: a render's
 * light, noise and memory, and a motion checked at every frame, each on a
 * scene that has the fault and one that does not.
 *
 *   $env:ZHIYIN_BLENDER = "…\blender.exe"; npx vitest run --project "system-boundary*" packages/feature/blender-studio/system-boundary/real-blender-checks.test.ts
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
  content: { type: string; text?: string; data?: string }[];
};

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
  const script = (lines: string[]) =>
    done("blender_run_script", { code: lines.join("\n") });
  /** A frame sheet's answer, drawn small and quick, from 0 s every so many milliseconds. */
  const sheet = (
    every_ms: number,
    count: number,
    more: Record<string, unknown> = {},
  ) =>
    done("blender_frame_sheet", {
      every_ms,
      count,
      tile_width: 160,
      engine: "solid",
      view: "overview",
      ...more,
    });
  const remove = (names: string[]) =>
    done("blender_edit_objects", {
      edits: names.map((object) => ({ object, delete: true })),
    });

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
    it("says how much of an overexposed picture is clipped to white, over the limit, and what exposure brings it back", async () => {
      await done("blender_set_camera", { exposure: 5 });
      const bright = await done("blender_render", {
        output: "bright.png",
        engine: "eevee",
      });
      await done("blender_set_camera", { exposure: 0 });

      expect(bright).toMatch(
        /Light: [\d.]+% of the picture clipped to white, over the 1% past which a picture loses its highlights: mostly [^;]*Block/,
      );
      expect(bright).toMatch(
        /the middle of its light [\d.]+ stops over middle grey, where a white surface lit to show white is about 2\.2 over/,
      );
    }, 240_000);

    it("says the light of a picture exposed as it should be without calling anything over a limit, and where the subject sits", async () => {
      const fine = await done("blender_render", {
        output: "fine.png",
        engine: "eevee",
      });

      expect(fine).toMatch(/Light: [\d.]+% of the picture clipped to white;/);
      expect(fine).not.toContain("over the 1%");
      expect(fine).not.toContain("over the 5%");
      expect(fine).toMatch(/[\d.]+ stops from its darkest twentieth/);
      expect(fine).toMatch(
        /The subject covers [\d.]+% of the picture, its middle \d+% across and \d+% down/,
      );
    }, 240_000);

    it("measures a noisy Cycles picture's noise over the limit, and a clean one under it", async () => {
      await script(["bpy.context.scene.cycles.use_denoising = False"]);
      const noisy = await done("blender_render", {
        output: "noisy.png",
        samples: 2,
      });
      await script(["bpy.context.scene.cycles.use_denoising = True"]);
      const clean = await done("blender_render", {
        output: "clean.png",
        samples: 64,
      });

      expect(noisy).toMatch(
        /Noise, from two pictures at half size with other seeds and 2 samples: [\d.]+% of the brightness, over the 2% past which it shows as grain/,
      );
      expect(clean).toMatch(
        /Noise, from two pictures at half size with other seeds and 64 samples: [\d.]+% of the brightness;/,
      );
      expect(clean).toMatch(/It took [\d.]+ (MB|GB) of memory at most\./);
    }, 240_000);

    it("leaves the noise unmeasured when asked not to", async () => {
      const unmeasured = await done("blender_render", {
        output: "quick.png",
        samples: 8,
        noise: false,
      });

      expect(unmeasured).not.toContain("Noise, from two pictures");
    }, 240_000);

    it("says a scene with no lights is lit only by its background", async () => {
      await script([
        "for o in list(bpy.context.scene.objects):",
        "    if o.type == 'LIGHT':",
        "        o.hide_render = True",
      ]);
      const unlit = await done("blender_render", {
        output: "unlit.png",
        engine: "eevee",
      });
      await script([
        "for o in list(bpy.context.scene.objects):",
        "    if o.type == 'LIGHT':",
        "        o.hide_render = False",
      ]);
      const lit = await done("blender_render", {
        output: "lit.png",
        engine: "eevee",
      });

      expect(unlit).toContain(
        "The scene has no lights: only its background lights it.",
      );
      expect(lit).not.toContain("The scene has no lights");
    }, 240_000);

    it("says nothing of missing lights under a sky whose sun is up", async () => {
      await done("blender_set_lighting", { preset: "daylight" });
      await script([
        "for o in list(bpy.context.scene.objects):",
        "    if o.type == 'LIGHT':",
        "        o.hide_render = True",
      ]);
      const sunlit = await done("blender_render", {
        output: "sunlit.png",
        engine: "eevee",
      });
      await script([
        "for o in list(bpy.context.scene.objects):",
        "    if o.type == 'LIGHT':",
        "        o.hide_render = False",
      ]);
      await done("blender_set_lighting", { preset: "studio" });

      expect(sunlit).not.toContain("The scene has no lights");
    }, 240_000);

    it("says where the subject sits and what is clipped by where they really are in the picture", async () => {
      // Seen level from 3 m up: a glowing lamp high on the left, and a post
      // low on the right that the picture's bottom edge cuts.
      await done("blender_add_objects", {
        objects: [
          {
            name: "Lamp",
            kind: "cube",
            size: [0.6, 0.05, 0.2],
            location: [-0.6, 0, 3.7],
          },
          {
            name: "Post",
            kind: "cube",
            size: [0.6, 0.3, 1.2],
            location: [0.7, 0, 2.2],
          },
        ],
      });
      await done("blender_set_material", {
        objects: ["Lamp"],
        material: {
          name: "Glow",
          color: "#ffffff",
          emission: { color: "#ffffff", strength: 40 },
        },
      });
      await done("blender_set_camera", {
        location: [0, -4, 3],
        look_at: [0, 0, 3],
      });
      const said = await done("blender_render", {
        output: "placed.png",
        engine: "eevee",
      });
      await remove(["Lamp", "Post"]);
      await done("blender_set_camera", {
        frame: { objects: ["Block"], direction: "three-quarter" },
      });

      const where =
        /its middle (\d+)% across and (\d+)% down, with (\d+)% of the height above it; it meets the bottom edge\./.exec(
          said,
        );
      expect(where, said).not.toBeNull();
      // Mostly the post, well below the middle; the lamp's top is an eighth of the way down.
      expect(Number(where![2]), said).toBeGreaterThan(60);
      expect(Number(where![3]), said).toBeGreaterThanOrEqual(10);
      expect(Number(where![3]), said).toBeLessThanOrEqual(16);
      expect(said).not.toContain("meets the top");
      expect(said).toMatch(
        /clipped to white, over the 1% past which a picture loses its highlights: mostly Lamp/,
      );
    }, 240_000);
  });

  describe("a motion, at every frame", () => {
    it("finds parts that go into each other between the frames drawn, and over which spans", async () => {
      await done("blender_add_objects", {
        objects: [
          {
            name: "Arm",
            kind: "cube",
            size: [0.02, 0.02, 0.4],
            location: [0, 0, 1],
          },
          {
            name: "Stop",
            kind: "cube",
            size: [0.04, 0.04, 0.04],
            location: [0, 0.15, 1],
          },
        ],
      });
      await done("blender_animate", {
        keys: [
          { object: "Arm", at: 0, rotation: [0, 0, 0] },
          { object: "Arm", at: 1, rotation: [360, 0, 0], easing: "linear" },
        ],
      });
      // Drawn at 0 s and 1 s only, when the arm stands upright, clear of the stop.
      const said = await sheet(1000, 2);
      await remove(["Arm", "Stop"]);

      expect(said).toContain(
        "Checked at every frame from 0 s to 1 s, 25 frames",
      );
      expect(said).toMatch(
        /Deepest overlaps, measured on the parts' surfaces, not their boxes, at every frame checked: Arm and Stop, [\d.]+ mm deep at 0\.25 s and 0\.75 s; in each other at 0\.25 s and at 0\.75 s\./,
      );
    }, 240_000);

    it("finds a pop, and says nothing of a steady move", async () => {
      await done("blender_add_objects", {
        objects: [
          {
            name: "Popper",
            kind: "cube",
            size: [0.1, 0.1, 0.1],
            location: [0, 1, 1],
          },
          {
            name: "Glider",
            kind: "cube",
            size: [0.1, 0.1, 0.1],
            location: [0, -1, 1],
          },
        ],
      });
      await done("blender_animate", {
        keys: [
          { object: "Popper", at: 0, location: [0, 1, 1], easing: "constant" },
          { object: "Popper", at: 1, location: [1, 1, 1], easing: "constant" },
          { object: "Glider", at: 0, location: [0, -1, 1] },
          {
            object: "Glider",
            at: 1.5,
            location: [1, -1, 1],
            easing: "linear",
          },
        ],
      });
      const said = await sheet(500, 4);
      await remove(["Popper", "Glider"]);

      expect(said).toMatch(
        /Pops: Popper jumps 1 m between 0\.958 s and 1 s, moving 0 mm in the frames either side\./,
      );
      expect(said).not.toMatch(/Pops:[^.]*Glider/);
    }, 240_000);

    it("finds a turn too fast for the frame rate, and says nothing of a slow one", async () => {
      await done("blender_add_objects", {
        objects: [
          {
            name: "Fan",
            kind: "cube",
            size: [0.3, 0.02, 0.02],
            location: [0, 2, 1],
          },
          {
            name: "Dial",
            kind: "cube",
            size: [0.3, 0.02, 0.02],
            location: [0, -2, 1],
          },
        ],
      });
      await done("blender_animate", {
        keys: [
          { object: "Fan", at: 0, rotation: [0, 0, 0] },
          { object: "Fan", at: 1, rotation: [0, 0, 3600], easing: "linear" },
          { object: "Dial", at: 0, rotation: [0, 0, 0] },
          { object: "Dial", at: 1, rotation: [0, 0, 90], easing: "linear" },
        ],
      });
      const said = await sheet(500, 3);
      await remove(["Fan", "Dial"]);

      expect(said).toMatch(
        /Turning faster than 30° a frame, which a video shows turning backward or jerking: Fan 150° a frame/,
      );
      expect(said).not.toMatch(/Turning faster[^.]*Dial/);
      expect(said).toMatch(/Fastest: Fan [\d.]+ turns a minute/);
    }, 240_000);

    it("finds a block that slides where it rests and a wheel that slips, and says nothing of one that rolls or one in the air", async () => {
      await script([
        "import bmesh, math",
        "s = bpy.context.scene",
        "def made(name, build, at):",
        "    shape = bmesh.new()",
        "    build(shape)",
        "    mesh = bpy.data.meshes.new(name)",
        "    shape.to_mesh(mesh)",
        "    shape.free()",
        "    obj = bpy.data.objects.new(name, mesh)",
        "    obj.location = at",
        "    s.collection.objects.link(obj)",
        "    return obj",
        "wheel = lambda b: bmesh.ops.create_cone(b, cap_ends=True, segments=48, radius1=0.1, radius2=0.1, depth=0.05)",
        "bpy.context.preferences.edit.keyframe_new_interpolation_type = 'LINEAR'",
        "def key(obj, frame, x, turn=None):",
        "    obj.location.x = x",
        "    obj.keyframe_insert('location', frame=frame)",
        "    if turn is not None:",
        "        # Stood on its rim, then turned round the world's y, which rolls it along x.",
        "        obj.rotation_euler = (math.pi / 2, turn, 0)",
        "        obj.keyframe_insert('rotation_euler', frame=frame)",
        "slider = made('Slider', lambda b: bmesh.ops.create_cube(b, size=0.1), (-1, 1, 0.05))",
        "flyer = made('Flyer', lambda b: bmesh.ops.create_cube(b, size=0.1), (-1, 1.5, 0.6))",
        "for obj in (slider, flyer):",
        "    key(obj, 1, -1)",
        "    key(obj, 25, -0.5)",
        "roller = made('Roller', wheel, (0, -1, 0.1))",
        "skidder = made('Skidder', wheel, (0, -1.5, 0.1))",
        "key(roller, 1, 0, 0)",
        "key(roller, 25, 2 * math.pi * 0.1, 2 * math.pi)",
        "key(skidder, 1, 0, 0)",
        "key(skidder, 25, 2 * math.pi * 0.1, math.pi / 2)",
      ]);
      const said = await sheet(500, 3);
      await remove(["Slider", "Flyer", "Roller", "Skidder"]);

      expect(said).toMatch(
        /Sliding where they rest: [^.]*Slider slides 500 mm along Floor between 0\.0417 s and 1 s while it rests on it/,
      );
      expect(said).toMatch(
        /Skidder travels 628\.3 mm on Floor between 0\.0417 s and 1 s while its turn rolls it 157(\.\d)? mm: it slips by 75%/,
      );
      expect(said).not.toMatch(/Sliding where they rest:[^.]*Flyer/);
      expect(said).not.toMatch(/Sliding where they rest:[^.]*Roller/);
    }, 240_000);

    it("finds a rod whose distance to what it aims at changes, and says nothing of one whose distance holds or of what only looks at a moving part", async () => {
      // Each rod reaches from its middle, where it turns, to the pin it aims at.
      await done("blender_add_objects", {
        objects: [
          {
            name: "Rod",
            kind: "cube",
            size: [0.02, 1, 0.02],
            location: [0, 3, 1],
          },
          {
            name: "Pin",
            kind: "sphere",
            size: [0.05, 0.05, 0.05],
            location: [0, 3.5, 1],
          },
          {
            name: "Eye",
            kind: "sphere",
            size: [0.05, 0.05, 0.05],
            location: [1, 3, 1],
          },
          {
            name: "Link",
            kind: "cube",
            size: [0.02, 1, 0.02],
            location: [0, -3, 1],
          },
          {
            name: "Peg",
            kind: "sphere",
            size: [0.05, 0.05, 0.05],
            location: [0, -3.5, 1],
          },
        ],
      });
      // A second camera, which only looks at the pin as it moves away.
      await script([
        "watcher = bpy.data.objects.new('Watcher', bpy.data.cameras.new('Watcher'))",
        "watcher.location = (2, 3, 1)",
        "bpy.context.scene.collection.objects.link(watcher)",
      ]);
      await done("blender_animate", {
        keys: [
          { object: "Pin", at: 0, location: [0, 3.5, 1] },
          { object: "Pin", at: 1, location: [0, 4, 1], easing: "linear" },
          { object: "Link", at: 0, location: [0, -3, 1] },
          { object: "Link", at: 1, location: [1, -3, 1], easing: "linear" },
          { object: "Peg", at: 0, location: [0, -3.5, 1] },
          { object: "Peg", at: 1, location: [1, -3.5, 1], easing: "linear" },
        ],
        aim: [
          { object: "Rod", at: "Pin" },
          { object: "Link", at: "Peg" },
          { object: "Eye", at: "Pin" },
          { object: "Watcher", at: "Pin" },
        ],
      });
      // The rod, the eye and the camera are still: name them, so their aims are followed.
      const said = await sheet(500, 3, {
        objects: ["Rod", "Pin", "Link", "Peg", "Eye", "Watcher"],
      });
      await remove(["Rod", "Pin", "Link", "Peg", "Eye"]);
      await script([
        "watcher = bpy.data.objects['Watcher']",
        "bpy.data.objects.remove(watcher)",
      ]);

      expect(said).toMatch(
        /Aimed parts whose distance to what they aim at changes, so a rod between them would stretch: Rod and Pin, from 500 mm to 1 m apart\./,
      );
      expect(said).not.toMatch(/would stretch:[^.]*Link/);
      expect(said).not.toMatch(/would stretch:[^.]*Eye/);
      expect(said).not.toMatch(/would stretch:[^.]*Watcher/);
    }, 240_000);

    it("says whether a loop's frame after the last runs on into its first, by place and speed", async () => {
      await done("blender_add_objects", {
        objects: [
          {
            name: "Turntable",
            kind: "cylinder",
            size: [0.4, 0.4, 0.02],
            location: [3, 0, 0.01],
          },
        ],
      });
      await done("blender_animate", {
        keys: [
          { object: "Turntable", at: 0, rotation: [0, 0, 0] },
          {
            object: "Turntable",
            at: 2,
            rotation: [0, 0, 360],
            easing: "linear",
          },
        ],
      });
      // The timeline ends a frame before the turn comes round, so it plays round seamlessly.
      await script(["bpy.context.scene.frame_end = 48"]);
      const seamless = await sheet(1000, 2, { loop: true });
      await done("blender_animate", {
        keys: [
          {
            object: "Turntable",
            at: 2,
            rotation: [0, 0, 180],
            easing: "linear",
          },
        ],
      });
      await script(["bpy.context.scene.frame_end = 48"]);
      const jumping = await sheet(1000, 2, { loop: true });
      await remove(["Turntable"]);

      expect(seamless).toContain(
        "As a loop, 2 s, the frame after the timeline's last, runs on into its first, in place and speed.",
      );
      expect(jumping).toMatch(
        /As a loop, 2 s, the frame after the timeline's last, does not run on into its first: Turntable is 0 mm and 180\.0° from where it starts\./,
      );
    }, 240_000);

    it("finds an object shown for one frame, and a keyed angle that flips", async () => {
      await done("blender_add_objects", {
        objects: [
          {
            name: "Blink",
            kind: "cube",
            size: [0.1, 0.1, 0.1],
            location: [-3, 0, 1],
          },
          {
            name: "Spin",
            kind: "cube",
            size: [0.3, 0.02, 0.02],
            location: [-3, 1, 1],
          },
          {
            name: "Steady",
            kind: "cube",
            size: [0.3, 0.02, 0.02],
            location: [-3, 2, 1],
          },
        ],
      });
      await script([
        "import math",
        "blink = bpy.data.objects['Blink']",
        "for frame, hidden in ((1, True), (12, False), (13, True)):",
        "    blink.hide_render = hidden",
        "    blink.keyframe_insert('hide_render', frame=frame)",
        "for name, angles in (('Spin', (170, 175, 179, -179, -175)), ('Steady', (170, 175, 179, 181, 185))):",
        "    obj = bpy.data.objects[name]",
        "    for frame, angle in enumerate(angles, start=1):",
        "        obj.rotation_euler.z = math.radians(angle)",
        "        obj.keyframe_insert('rotation_euler', index=2, frame=frame)",
      ]);
      const said = await sheet(250, 3);
      await remove(["Blink", "Spin", "Steady"]);

      expect(said).toMatch(/Flickers: Blink shows for one frame at 0\.458 s\./);
      expect(said).toMatch(
        /Flips: Spin's turn around z jumps 358° between 0\.0833 s and 0\.125 s/,
      );
      expect(said).not.toMatch(/Flips:[^.]*Steady/);
    }, 240_000);

    it("finds an object that leaves the camera's picture", async () => {
      await done("blender_add_objects", {
        objects: [
          {
            name: "Runner",
            kind: "cube",
            size: [0.1, 0.1, 0.1],
            location: [0, 0, 0.4],
          },
        ],
      });
      await done("blender_animate", {
        keys: [
          { object: "Runner", at: 0, location: [0, 0, 0.4] },
          { object: "Runner", at: 1, location: [30, 0, 0.4], easing: "linear" },
        ],
      });
      // Framed on the runner where it starts, beside the block.
      await done("blender_set_camera", {
        frame: { objects: ["Block", "Runner"], direction: "front" },
      });
      const said = await sheet(500, 3, { view: "camera" });
      await remove(["Runner"]);

      expect(said).toMatch(
        /Leaving the camera's picture, by their middles: Runner from 0\.\d+ s to 1 s\./,
      );
      expect(said).not.toMatch(/Leaving the camera's picture[^.]*Block/);
    }, 240_000);

    it("says after an animation which values are keyed only once, and nothing once each has a start", async () => {
      await done("blender_add_objects", {
        objects: [
          {
            name: "Plate",
            kind: "cube",
            size: [0.2, 0.2, 0.02],
            location: [0, 4, 0.3],
          },
        ],
      });
      const once = await done("blender_animate", {
        keys: [{ object: "Plate", at: 1, location: [0, 4, 0.3] }],
      });
      const twice = await done("blender_animate", {
        keys: [{ object: "Plate", at: 0, location: [0, 4, 0] }],
      });
      await remove(["Plate"]);

      expect(once).toContain(
        "Keyed once, so held at every time, there from the start: Plate's location at 1 s. Key where each starts too.",
      );
      expect(twice).not.toContain("Keyed once");
    }, 240_000);

    it("says nothing of a door that swings on its hinge where it rests, and finds a box that slides while it turns", async () => {
      await done("blender_add_objects", {
        objects: [
          {
            name: "Hinge",
            kind: "cylinder",
            size: [0.03, 0.03, 1],
            location: [1, -1.5, 0.5],
          },
          {
            name: "Door",
            kind: "cube",
            size: [0.9, 0.04, 1],
            location: [1.45, -1.5, 0.5],
            parent: "Hinge",
          },
          {
            name: "Twister",
            kind: "cube",
            size: [0.1, 0.1, 0.1],
            location: [-1, -1, 0.05],
          },
        ],
      });
      await done("blender_animate", {
        keys: [
          { object: "Hinge", at: 0, rotation: [0, 0, 0] },
          { object: "Hinge", at: 1, rotation: [0, 0, 90] },
          {
            object: "Twister",
            at: 0,
            location: [-1, -1, 0.05],
            rotation: [0, 0, 0],
          },
          {
            object: "Twister",
            at: 1,
            location: [-0.5, -1, 0.05],
            rotation: [0, 0, 30],
            easing: "linear",
          },
        ],
      });
      const said = await sheet(500, 3, {
        objects: ["Door", "Hinge", "Twister"],
      });
      await remove(["Door", "Hinge", "Twister"]);

      expect(said).not.toMatch(/Sliding where they rest:[^.]*Door/);
      expect(said).not.toMatch(/Sliding where they rest:[^.]*Hinge/);
      expect(said).toMatch(
        /Sliding where they rest: [^.]*Twister slides 500 mm along Floor between 0\.0417 s and 1 s while it rests on it/,
      );
    }, 240_000);

    it("says a loop whose last frame is its first again stalls a frame, and a turntable keyed as a loop plays round", async () => {
      await done("blender_add_objects", {
        objects: [
          {
            name: "Platter",
            kind: "cylinder",
            size: [0.4, 0.4, 0.02],
            location: [3, 0, 0.01],
          },
        ],
      });
      const turn = [
        { object: "Platter", at: 0, rotation: [0, 0, 0] },
        { object: "Platter", at: 2, rotation: [0, 0, 360], easing: "linear" },
      ];
      // The skill's turntable: one linear turn, as long as the timeline.
      await done("blender_animate", { keys: turn, duration: 2 });
      const doubled = await sheet(1000, 2, { loop: true });
      await done("blender_animate", { keys: turn, loop: true });
      const looped = await sheet(1000, 2, { loop: true });
      await remove(["Platter"]);

      expect(doubled).toContain(
        "As a loop, 2 s, the timeline's last frame, is its first again, so played round that moment shows twice and the motion stalls a frame each time: end the timeline a frame earlier, at 1.96 s, so the frame after its last is its first.",
      );
      expect(looped).toContain(
        "As a loop, 2 s, the frame after the timeline's last, runs on into its first, in place and speed.",
      );
    }, 240_000);

    it("past the frames a scan steps through, measures a fast turn a frame apart and tells one long overlap as one", async () => {
      await done("blender_add_objects", {
        objects: [
          {
            name: "Prop",
            kind: "cube",
            size: [0.6, 0.05, 0.02],
            location: [-3, -3, 1],
          },
          {
            name: "Sleeve",
            kind: "cube",
            size: [0.4, 0.4, 0.4],
            location: [3, -3, 1],
          },
          {
            name: "Plug",
            kind: "cube",
            size: [0.6, 0.1, 0.1],
            location: [3, -3, 1],
          },
        ],
      });
      // 20 s at 24 frames a second, 481 frames, stepped every 2: the prop
      // turns 100° a frame, 400 turns a minute, and the plug stays through the sleeve.
      await done("blender_animate", {
        duration: 20,
        keys: [
          { object: "Prop", at: 0, rotation: [0, 0, 0] },
          { object: "Prop", at: 20, rotation: [0, 0, 48000], easing: "linear" },
          { object: "Plug", at: 0, location: [3, -3, 1] },
          { object: "Plug", at: 20, location: [3.05, -3, 1], easing: "linear" },
        ],
      });
      const said = await sheet(10_000, 3, { objects: ["Prop", "Plug"] });
      await remove(["Prop", "Sleeve", "Plug"]);
      await done("blender_animate", { duration: 2 });

      expect(said).toContain("Checked every 2 frames from 0 s to 20.0 s");
      expect(said).not.toContain("Flips:");
      expect(said).toMatch(
        /Turning faster than 30° a frame[^.]*: Prop 100° a frame/,
      );
      expect(said).toMatch(/Fastest: [^\n]*Prop [^\n;]*400 turns a minute/);
      expect(said).toMatch(
        /Plug and Sleeve, [^;]*; in each other from 0 s to 20\.0 s[.;]/,
      );
    }, 300_000);
  });
});
