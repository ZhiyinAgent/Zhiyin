/**
 * The studio's animation against a real Blender: keys and their easing, a
 * camera on a path aimed at what it follows, a frame sheet the model can see,
 * a still at a moment, and a video for the person, after which the scene's
 * own render settings are as they were.
 *
 * Skipped unless Blender is named in the environment, as the main real-Blender
 * suite is:
 *
 *   $env:ZHIYIN_BLENDER = "…\blender.exe"; npx vitest run --project system-boundary packages/feature/blender-studio
 */

import { mkdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { withKeptGlCache } from "../test/kept-gl-cache.js";
import { openProcessContainer } from "@zhiyin/sandbox";
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

/** A JPEG's width and height, from its first frame header. */
function jpegSize(bytes: Buffer): { width: number; height: number } {
  let at = 2;
  while (at < bytes.length) {
    const marker = bytes[at + 1]!;
    const length = bytes.readUInt16BE(at + 2);
    if (marker >= 0xc0 && marker <= 0xc3)
      return {
        height: bytes.readUInt16BE(at + 5),
        width: bytes.readUInt16BE(at + 7),
      };
    at += 2 + length;
  }
  throw new Error("No frame header in the JPEG.");
}

/** The heights a frame sheet's lines give an object, in millimetres. */
function heightsOf(said: string, name: string): number[] {
  return [
    ...said.matchAll(
      // As "Ball (200 mm across) at (0, 0, 1 m)": the unit is the last one's.
      new RegExp(
        `${name}(?: \\([^)]*\\))? at \\([^,]+, [^,]+, (-?[0-9.]+) (mm|m)\\)`,
        "g",
      ),
    ),
  ].map(([, value, unit]) => Number(value) * (unit === "m" ? 1000 : 1));
}

describe.runIf(blender)("a real Blender, animating", () => {
  const folders = new TemporaryFolders();
  let root: string;
  let workspace: string;
  let scenes: ConversationScenes;
  let tools: ReturnType<typeof sceneAutomation>;
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = (await tools.callTool(name, args)) as Result;
    return {
      ...result,
      // What the tools know the call by, for what it produced.
      result,
      said: result.content.map((c) => c.text ?? "").join("\n"),
      image: result.content.find((c) => c.type === "image")?.data,
    };
  };

  beforeAll(async () => {
    root = await folders.make("zhiyin-studio-motion-");
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
    tools = sceneAutomation(scenes.scene("motion"), {
      workspaceRoot: () => workspace,
      blender: async () => blender,
      directory: scenes.directory("motion"),
    });
    await call("blender_open_scene", { path: "ball.blend", create: true });
    const added = await call("blender_add_objects", {
      objects: [
        {
          name: "Ball",
          kind: "sphere",
          size: [0.2, 0.2, 0.2],
          location: [0, 0, 1],
        },
        { name: "Floor", kind: "plane", size: [4, 4] },
      ],
    });
    const camera = await call("blender_set_camera", {
      location: [0, -5, 1.2],
      look_at: [0, 0, 0.5],
    });
    expect(added.isError).toBeUndefined();
    expect(camera.isError).toBeUndefined();
  }, 180_000);

  afterAll(async () => {
    await scenes.forget("motion");
    await scenes.closeAll();
    await folders.removeAll();
  });

  it("keys a fall eased in, and the frame sheet shows it falling, faster at the end", async () => {
    const animated = await call("blender_animate", {
      duration: 2,
      keys: [
        { object: "Ball", at: 0, location: [0, 0, 1] },
        { object: "Ball", at: 1, location: [0, 0, 0.1], easing: "ease_in" },
      ],
    });
    expect(animated.isError).toBeUndefined();

    const sheet = await call("blender_frame_sheet", {
      time: 0,
      every_ms: 250,
      count: 5,
      tile_width: 160,
      objects: ["Ball"],
    });

    expect(sheet.isError).toBeUndefined();
    expect(sheet.said).toMatch(/A frame sheet of 5 frames, 0 s to 1 s/);
    const size = jpegSize(Buffer.from(sheet.image ?? "", "base64"));
    expect(size.width).toBeGreaterThanOrEqual(160);
    const heights = heightsOf(sheet.said, "Ball");
    // Five places, from 1 m down to 100 mm, each lower than the last, and
    // falling further in each quarter second than in the one before.
    expect(heights).toHaveLength(5);
    expect(heights[0]).toBeCloseTo(1000, -1);
    expect(heights[4]).toBeCloseTo(100, -1);
    const drops = heights.slice(1).map((h, i) => heights[i]! - h);
    for (const [i, drop] of drops.entries()) {
      expect(drop).toBeGreaterThan(0);
      if (i > 0) expect(drop).toBeGreaterThan(drops[i - 1]!);
    }
    // Nothing of the sheet is left in the workspace.
    expect(await readdirNames(workspace)).toEqual(["ball.blend"]);
  }, 180_000);

  it("renders a still at a moment, and says the moment", async () => {
    const still = await call("blender_render", {
      output: "renders/half.png",
      time: 0.5,
      engine: "eevee",
      samples: 1,
      resolution: [160, 90],
    });

    expect(still.isError).toBeUndefined();
    expect(still.said).toMatch(/at 0\.5 s of the animation/);
    // The scene is back at its first frame afterwards.
    const described = await call("blender_describe_scene", {
      objects: ["Ball"],
    });
    expect(described.said).toMatch(/Ball[^\n]*\(0, 0, 1 m\)/);
    expect(described.said).toMatch(
      /Motion: .*Ball: location keyed from 0 s to 1 s/,
    );
  }, 180_000);

  it("moves a camera along a path aimed at the ball, and stops the aim when asked", async () => {
    const pathed = await call("blender_animate", {
      paths: [
        {
          object: "Camera",
          points: [
            [0, -5, 1.2],
            [5, 0, 1.2],
            [0, 5, 1.2],
          ],
          from: 0,
          to: 2,
        },
      ],
      aim: [{ object: "Camera", at: "Ball" }],
    });
    expect(pathed.isError).toBeUndefined();

    const sheet = await call("blender_frame_sheet", {
      time: 0,
      every_ms: 1000,
      count: 3,
      tile_width: 160,
      objects: ["Camera"],
    });
    const described = await call("blender_describe_scene", {
      objects: ["Camera"],
    });
    const stopped = await call("blender_animate", {
      aim: [{ object: "Camera", at: "" }],
    });
    const after = await call("blender_describe_scene", {
      objects: ["Camera"],
    });

    // On the path's points at its start, middle and end, turned to the ball:
    // level with it at first, looking down at it once it has fallen.
    expect(sheet.said).toMatch(
      /0 s: Camera at \(0, -5, 1\.2 m\), turned \(87\.7°, 0°, 0°\)/,
    );
    expect(sheet.said).toMatch(
      /1 s: Camera at \(5, 0, 1\.2 m\), turned \(77\.6°, 0°, 90°\)/,
    );
    expect(sheet.said).toMatch(/2 s: Camera at \(0, 5, 1\.2 m\)/);
    expect(described.said).toMatch(/Camera: [^\n]*aims at Ball/);
    expect(stopped.said).toMatch(/Camera: no longer aims at anything/);
    expect(after.said).not.toMatch(/aims at Ball/);
  }, 180_000);

  it("renders a video for the person, and leaves the scene's render settings as they were", async () => {
    const video = await call("blender_render_video", {
      output: "videos/ball.mp4",
      end: 1,
      engine: "eevee",
      samples: 1,
      resolution: [160, 90],
    });

    expect(video.isError).toBeUndefined();
    expect(video.image).toBeUndefined();
    expect(video.said).toContain(
      "The person can play it beside the conversation; once another document takes its place there, read_document shows it again.",
    );
    const file = await readFile(join(workspace, "videos", "ball.mp4"));
    // An MP4 begins with its file-type box.
    expect(file.subarray(4, 8).toString("latin1")).toBe("ftyp");
    expect(tools.produced("blender_render_video", {}, video.result)).toEqual([
      {
        path: "videos/ball.mp4",
        change: "created",
        bytes: (await stat(join(workspace, "videos", "ball.mp4"))).size,
      },
    ]);
    // A still after it is a picture again, not a video.
    const still = await call("blender_render", {
      output: "renders/after.png",
      engine: "eevee",
      samples: 1,
      resolution: [160, 90],
    });
    expect(still.isError).toBeUndefined();
    const png = await readFile(join(workspace, "renders", "after.png"));
    expect(png.subarray(1, 4).toString("latin1")).toBe("PNG");
  }, 300_000);

  it("keeps keys at their times when the frame rate changes, and clears an object's motion where it stands", async () => {
    const faster = await call("blender_animate", { fps: 50 });
    const described = await call("blender_describe_scene", {
      objects: ["Ball"],
    });
    const cleared = await call("blender_animate", { clear: ["Ball"] });
    const after = await call("blender_describe_scene", { objects: ["Ball"] });

    expect(faster.isError).toBeUndefined();
    expect(described.said).toMatch(/50 frames a second/);
    expect(described.said).toMatch(/Ball: location keyed from 0 s to 1 s/);
    expect(cleared.isError).toBeUndefined();
    expect(after.said).not.toMatch(/Ball: location keyed/);
  }, 180_000);

  it("refuses a frame sheet of an object the scene does not have, and the scene works on", async () => {
    const refused = await call("blender_frame_sheet", {
      time: 0,
      every_ms: 500,
      count: 2,
      objects: ["Nope"],
    });
    const next = await call("blender_describe_scene", {});

    expect(refused.isError).toBe(true);
    expect(refused.said).toMatch(/Nope/);
    expect(next.isError).toBeUndefined();
  }, 180_000);

  it("sizes each of two size keys in one call as asked", async () => {
    await call("blender_add_objects", {
      objects: [
        {
          name: "Grower",
          kind: "sphere",
          size: [0.2, 0.2, 0.2],
          location: [2, 0, 0.5],
        },
      ],
    });

    await call("blender_animate", {
      keys: [
        { object: "Grower", at: 0, size: [0.4, 0.4, 0.4] },
        { object: "Grower", at: 1, size: [0.2, 0.2, 0.2] },
      ],
    });
    const sheet = await call("blender_frame_sheet", {
      time: 0,
      every_ms: 1000,
      count: 2,
      tile_width: 160,
      engine: "solid",
      objects: ["Grower"],
    });

    expect(sheet.said).toMatch(/0 s: Grower \(400 × 400 × 400 mm\)/);
    expect(sheet.said).toMatch(/1 s: Grower \(200 × 200 × 200 mm\)/);
  }, 180_000);

  it("keeps a lens and a colour at their times when the frame rate changes, as it does a place", async () => {
    await call("blender_set_material", {
      objects: ["Grower"],
      material: { name: "Glowing", color: "#2060d0" },
    });
    await call("blender_animate", {
      keys: [
        { object: "Camera", at: 0, lens: 35 },
        { object: "Camera", at: 1, lens: 70 },
        { object: "Grower", at: 0, color: "#2060d0" },
        { object: "Grower", at: 1, color: "#d03020" },
      ],
    });

    await call("blender_animate", { fps: 24 });
    // The times of the lens's keys and of the colour's, read from Blender.
    const times = await call("blender_run_script", {
      code: [
        "import bpy",
        "from bpy_extras import anim_utils",
        "s = bpy.context.scene",
        "def times(owner, part):",
        "    a = owner.animation_data",
        "    bag = anim_utils.action_get_channelbag_for_slot(a.action, a.action_slot)",
        "    keys = [k.co.x for c in bag.fcurves if part in c.data_path for k in c.keyframe_points]",
        "    return sorted({round((f - s.frame_start) / s.render.fps, 3) for f in keys})",
        "print('lens', times(s.camera.data, 'lens'))",
        "print('colour', times(bpy.data.materials['Glowing'].node_tree, 'default_value'))",
      ].join("\n"),
    });

    expect(times.said).toMatch(/lens \[0\.0, 1\.0\]/);
    expect(times.said).toMatch(/colour \[0\.0, 1\.0\]/);
  }, 180_000);

  it("runs a chain round its sprockets at a speed, and with the pulley that drives it, each link carried round the loop", async () => {
    // 45 links, 8 mm cubes, round two sprockets of 50 mm radius 300 mm apart
    // in the x-z plane, turning about y; the first link on the top run at x = 50 mm.
    const made = await call("blender_run_script", {
      code: [
        "import bpy, bmesh, math",
        "L = 2 * 0.3 + 2 * math.pi * 0.05",
        "def at(s):",
        "    s %= L",
        "    if s < 0.3: return (s, 0.55)",
        "    s -= 0.3",
        "    if s < math.pi * 0.05: a = s / 0.05; return (0.3 + 0.05 * math.sin(a), 0.5 + 0.05 * math.cos(a))",
        "    s -= math.pi * 0.05",
        "    if s < 0.3: return (0.3 - s, 0.45)",
        "    s -= 0.3",
        "    a = s / 0.05; return (-0.05 * math.sin(a), 0.5 - 0.05 * math.cos(a))",
        "bm = bmesh.new()",
        "for i in range(45):",
        "    x, z = at(0.05 + i * L / 45)",
        "    bmesh.ops.create_cube(bm, size=0.008, matrix=__import__('mathutils').Matrix.Translation((x, 0, z)))",
        "mesh = bpy.data.meshes.new('Chain')",
        "bm.to_mesh(mesh)",
        "obj = bpy.data.objects.new('Chain', mesh)",
        "bpy.context.scene.collection.objects.link(obj)",
        "drive = bpy.data.objects.new('Drive', None)",
        "drive.location = (0, 0, 0.5)",
        "bpy.context.scene.collection.objects.link(drive)",
        "print('made', len(mesh.vertices))",
      ].join("\n"),
    });
    const sprockets = [
      { at: [0, 0, 0.5], radius: 0.05 },
      { at: [0.3, 0, 0.5], radius: 0.05 },
    ];
    const run = await call("blender_animate", {
      duration: 4,
      belts: [
        { object: "Chain", pulleys: sprockets, axis: [0, 1, 0], speed: 0.1 },
      ],
    });
    // Where the first link's middle is at each time, from the mesh Blender draws.
    const firstLink = (times: number[]) =>
      call("blender_run_script", {
        code: [
          "import bpy",
          "s = bpy.context.scene",
          "fps = s.render.fps / s.render.fps_base",
          `for t in ${JSON.stringify(times)}:`,
          "    s.frame_set(round(s.frame_start + t * fps))",
          "    obj = bpy.data.objects['Chain'].evaluated_get(bpy.context.evaluated_depsgraph_get())",
          "    points = [obj.matrix_world @ v.co for v in obj.data.vertices[:8]]",
          "    x = sum(p.x for p in points) / 8",
          "    z = sum(p.z for p in points) / 8",
          "    print(f'at {t} s: x {x * 1000:.0f} z {z * 1000:.0f}')",
        ].join("\n"),
      });
    const running = await firstLink([0, 1, 3]);
    await call("blender_animate", {
      keys: [
        { object: "Drive", at: 0, rotation: [0, 0, 0], easing: "linear" },
        { object: "Drive", at: 1, rotation: [0, 90, 0], easing: "linear" },
      ],
      belts: [
        {
          object: "Chain",
          pulleys: sprockets,
          axis: [0, 1, 0],
          follows: { object: "Drive", axis: "y", radius: 0.05 },
        },
      ],
    });
    const driven = await firstLink([0, 1]);

    expect(made.said).toContain("made 360");
    expect(run.isError, run.said).toBeUndefined();
    expect(run.said).toContain(
      "Chain: laid onto its path round 2 pulleys, 914 mm long, as Chain path; runs at 0.1 m/s from 0 s, the way its pulleys are listed, and on past 4 s.",
    );
    // Along the top run, then 50 mm round the second sprocket: 1 radian past its top.
    expect(running.said).toContain("at 0 s: x 50 z 550");
    expect(running.said).toContain("at 1 s: x 150 z 550");
    expect(running.said).toContain("at 3 s: x 342 z 527");
    // A quarter turn of a 50 mm pulley runs it 78.5 mm.
    expect(driven.said).toMatch(/at 0 s: x \d+ z 550/);
    const [start, end] = [...driven.said.matchAll(/x (\d+) z 550/g)].map((m) =>
      Number(m[1]),
    );
    expect(end! - start!).toBeGreaterThanOrEqual(78);
    expect(end! - start!).toBeLessThanOrEqual(79);
  }, 180_000);

  it("leaves a laid belt as it was when it cannot be laid round other pulleys", async () => {
    // The chain above is laid round two 50 mm sprockets; round 200 mm ones it
    // would stray from where it is, so it is refused.
    const refused = await call("blender_animate", {
      duration: 4,
      belts: [
        {
          object: "Chain",
          pulleys: [
            { at: [0, 0, 0.5], radius: 0.2 },
            { at: [0.3, 0, 0.5], radius: 0.2 },
          ],
          axis: [0, 1, 0],
          speed: 0.1,
        },
      ],
    });
    const after = await call("blender_run_script", {
      code: [
        "import bpy",
        "s = bpy.context.scene",
        "s.frame_set(s.frame_start)",
        "chain = bpy.data.objects['Chain']",
        "print('parent', chain.parent.name if chain.parent else None)",
        "print('bends', [m.type for m in chain.modifiers], [m.show_viewport for m in chain.modifiers])",
        "print('path', 'Chain path' in bpy.data.objects)",
        "obj = chain.evaluated_get(bpy.context.evaluated_depsgraph_get())",
        "points = [obj.matrix_world @ v.co for v in obj.data.vertices[:8]]",
        "print(f'first link z {sum(p.z for p in points) / 8 * 1000:.0f}')",
      ].join("\n"),
    });

    expect(refused.isError).toBe(true);
    expect(refused.said).toContain("it is left as it was");
    expect(after.said).toContain("parent Chain path");
    expect(after.said).toContain("bends ['CURVE'] [True]");
    expect(after.said).toContain("path True");
    expect(after.said).toContain("first link z 550");
  }, 180_000);

  it("clears an object's own motion only: a material it shares keeps its keys, and says so", async () => {
    await call("blender_add_objects", {
      objects: [
        {
          name: "Twin",
          kind: "cube",
          size: [0.2, 0.2, 0.2],
          location: [-2, 0, 0.1],
        },
      ],
    });
    await call("blender_set_material", {
      objects: ["Twin"],
      material: { name: "Glowing" },
    });

    const cleared = await call("blender_animate", { clear: ["Twin"] });
    const described = await call("blender_describe_scene", {
      objects: ["Grower"],
    });

    expect(cleared.said).toMatch(
      /Twin: [^\n]*its material Glowing, which [^\n]*Grower[^\n]* also [^\n]*, keeps its keys/,
    );
    expect(described.said).toMatch(/Grower: material values[^.]*keyed/);
  }, 180_000);

  it("names the attached parts that keep shown or hidden keys when an object is cleared", async () => {
    await call("blender_add_objects", {
      objects: [
        {
          name: "Chest",
          kind: "cube",
          size: [0.4, 0.3, 0.3],
          location: [0, 2, 0.15],
        },
        {
          name: "Chest lid",
          kind: "cube",
          size: [0.4, 0.3, 0.02],
          location: [0, 2, 0.31],
          parent: "Chest",
        },
      ],
    });
    await call("blender_animate", {
      keys: [
        { object: "Chest", at: 0, hidden: false },
        { object: "Chest", at: 0.5, hidden: true },
      ],
    });

    const cleared = await call("blender_animate", { clear: ["Chest"] });
    const described = await call("blender_describe_scene", {
      objects: ["Chest lid"],
    });

    expect(cleared.said).toMatch(
      /Chest: [^\n]*Chest lid attached to it keeps its shown or hidden keys/,
    );
    expect(described.said).toMatch(/Chest lid: [^\n]*keyed/);
  }, 180_000);

  it("leaves an aimed object turned as it was when its aim is cleared or stopped", async () => {
    await call("blender_set_camera", {
      location: [0, -5, 1.2],
      look_at: [0, 0, 0.5],
    });
    await call("blender_animate", {
      aim: [{ object: "Camera", at: "Chest" }],
    });
    const turnOf = async () => {
      const sheet = await call("blender_frame_sheet", {
        time: 0,
        every_ms: 100,
        count: 1,
        tile_width: 160,
        engine: "solid",
        objects: ["Camera"],
      });
      return /Camera at [^\n]*turned \(([^)]*)\)/.exec(sheet.said)?.[1];
    };
    const aimed = await turnOf();

    await call("blender_animate", { clear: ["Camera"] });
    const cleared = await turnOf();

    expect(aimed).toBeDefined();
    expect(cleared).toBe(aimed);
  }, 180_000);

  it("draws a frame sheet of a wide picture at the narrowest frame width", async () => {
    await call("blender_set_camera", { resolution: [1920, 600] });

    const sheet = await call("blender_frame_sheet", {
      time: 0,
      every_ms: 500,
      count: 2,
      tile_width: 160,
      engine: "solid",
    });
    await call("blender_set_camera", { resolution: [1920, 1080] });

    expect(sheet.isError).toBeUndefined();
    expect(sheet.said).toMatch(/each 205×64/);
  }, 180_000);

  it("moves an attached part's path with what it is attached to", async () => {
    await call("blender_add_objects", {
      objects: [
        {
          name: "Cart",
          kind: "cube",
          size: [0.4, 0.4, 0.2],
          location: [3, 3, 0.1],
        },
        {
          name: "Flag",
          kind: "cube",
          size: [0.02, 0.02, 0.2],
          location: [3, 3, 0.3],
          parent: "Cart",
        },
      ],
    });
    await call("blender_animate", {
      keys: [
        { object: "Cart", at: 0, location: [3, 3, 0.1], easing: "linear" },
        { object: "Cart", at: 2, location: [3, 3, 2.1], easing: "linear" },
      ],
      paths: [
        {
          object: "Flag",
          points: [
            [0, 0, 0.2],
            [1, 0, 0.2],
          ],
          from: 0,
          to: 2,
          easing: "linear",
        },
      ],
    });

    const sheet = await call("blender_frame_sheet", {
      time: 0,
      every_ms: 1000,
      count: 3,
      tile_width: 160,
      engine: "solid",
      objects: ["Flag"],
    });

    // On the cart's axes: half way along the path, and a metre up with it.
    expect(sheet.said).toMatch(/1 s: Flag \([^)]*\) at \(3\.5, 3, 1\.3 m\)/);
  }, 180_000);

  it("leaves the scene's render settings as they were after a video", async () => {
    const settings = async () =>
      (
        await call("blender_run_script", {
          code: [
            "import bpy",
            "s = bpy.context.scene",
            "r = s.render",
            "print(r.use_file_extension, r.filepath, r.image_settings.media_type, r.image_settings.file_format, r.resolution_x, r.resolution_y, r.engine, s.frame_start, s.frame_end, s.frame_current)",
            "print(sorted((p.identifier, str(getattr(r.ffmpeg, p.identifier))) for p in r.ffmpeg.bl_rna.properties if not p.is_readonly))",
          ].join("\n"),
        })
      ).said;
    const before = await settings();

    const video = await call("blender_render_video", {
      output: "videos/check.mp4",
      end: 0.2,
      engine: "eevee",
      samples: 1,
      resolution: [161, 91],
    });
    const after = await settings();

    expect(video.said).toMatch(/160×90/);
    expect(after).toBe(before);
  }, 300_000);
  /** The times, in seconds, of the keys whose path holds `part`, on an owner a script names. */
  const keyTimes = async (owner: string, part: string) =>
    (
      await call("blender_run_script", {
        code: [
          "import bpy",
          "from bpy_extras import anim_utils",
          "s = bpy.context.scene",
          `owner = ${owner}`,
          "a = owner.animation_data",
          "keys = []",
          "if a and a.action and a.action_slot:",
          "    bag = anim_utils.action_get_channelbag_for_slot(a.action, a.action_slot)",
          `    keys = [k.co.x for c in bag.fcurves if ${JSON.stringify(part)} in c.data_path for k in c.keyframe_points]`,
          "print('times', sorted({round((f - s.frame_start) / s.render.fps, 3) for f in keys}))",
        ].join("\n"),
      })
    ).said;

  it("moves a copy of a moving object as the original moves, offset with it, and keeps both at their times when the frame rate changes", async () => {
    await call("blender_add_objects", {
      objects: [
        {
          name: "Runner",
          kind: "cube",
          size: [0.2, 0.2, 0.2],
          location: [0, -2, 0.5],
        },
      ],
    });
    await call("blender_animate", {
      keys: [
        { object: "Runner", at: 0, location: [0, -2, 0.5], easing: "linear" },
        { object: "Runner", at: 1, location: [0, -2, 1.5], easing: "linear" },
      ],
    });
    await call("blender_edit_objects", {
      edits: [{ object: "Runner", duplicate: { offset: [2, 0, 0] } }],
    });

    await call("blender_animate", { fps: 48 });
    const runner = await keyTimes('bpy.data.objects["Runner"]', "location");
    const copy = await keyTimes('bpy.data.objects["Runner 2"]', "location");
    const sheet = await call("blender_frame_sheet", {
      time: 1,
      every_ms: 100,
      count: 1,
      tile_width: 160,
      engine: "solid",
      objects: ["Runner", "Runner 2"],
    });
    await call("blender_animate", { fps: 24 });

    expect(runner).toMatch(/times \[0\.0, 1\.0\]/);
    expect(copy).toMatch(/times \[0\.0, 1\.0\]/);
    expect(sheet.said).toMatch(/Runner \([^)]*\) at \(0, -2, 1\.5 m\)/);
    expect(sheet.said).toMatch(/Runner 2 \([^)]*\) at \(2, -2, 1\.5 m\)/);
  }, 180_000);

  it("keeps a shape's keys at their times when the frame rate changes, describes them, and clears them", async () => {
    await call("blender_add_objects", {
      objects: [
        {
          name: "Blob",
          kind: "cube",
          size: [0.3, 0.3, 0.3],
          location: [-3, 0, 0.15],
        },
      ],
    });
    await call("blender_run_script", {
      code: [
        "import bpy",
        "blob = bpy.data.objects['Blob']",
        "blob.shape_key_add(name='Basis')",
        "blob.shape_key_add(name='Key 1')",
      ].join("\n"),
    });
    const keyed = await call("blender_animate", {
      keys: [
        {
          object: "Blob",
          at: 0,
          property: {
            on: "data",
            path: 'shape_keys.key_blocks["Key 1"].value',
            values: [0],
          },
        },
        {
          object: "Blob",
          at: 1,
          property: {
            on: "data",
            path: 'shape_keys.key_blocks["Key 1"].value',
            values: [1],
          },
        },
      ],
    });
    const shapes = 'bpy.data.objects["Blob"].data.shape_keys';

    await call("blender_animate", { fps: 48 });
    const moved = await keyTimes(shapes, "key_blocks");
    const described = await call("blender_describe_scene", {
      objects: ["Blob"],
    });
    await call("blender_animate", { fps: 24 });
    await call("blender_animate", { clear: ["Blob"] });
    const cleared = await keyTimes(shapes, "key_blocks");

    expect(keyed.isError).toBeUndefined();
    expect(moved).toMatch(/times \[0\.0, 1\.0\]/);
    expect(described.said).toMatch(/Blob: shapes keyed from 0 s to 1 s/);
    expect(cleared).toMatch(/times \[\]/);
  }, 180_000);

  it("leaves an attached part's keys when what it is attached to is cleared, and names it", async () => {
    await call("blender_add_objects", {
      objects: [
        {
          name: "Post",
          kind: "cube",
          size: [0.1, 0.1, 0.5],
          location: [3, -3, 0.25],
        },
        {
          name: "Lamp",
          kind: "sphere",
          size: [0.1, 0.1, 0.1],
          location: [3, -3, 0.55],
          parent: "Post",
        },
      ],
    });
    await call("blender_animate", {
      keys: [
        { object: "Lamp", at: 0, hidden: false },
        { object: "Lamp", at: 1, hidden: true },
        { object: "Post", at: 0, location: [3, -3, 0.25] },
        { object: "Post", at: 1, location: [3, -3, 0.75] },
      ],
    });

    const cleared = await call("blender_animate", { clear: ["Post"] });
    const lamp = await keyTimes('bpy.data.objects["Lamp"]', "hide_render");

    expect(cleared.said).toMatch(
      /Lamp attached to it keeps its shown or hidden keys/,
    );
    expect(lamp).toMatch(/times \[0\.0, 1\.0\]/);
  }, 180_000);

  it("says an object whose turn is keyed turns by its keys again when its aim stops", async () => {
    await call("blender_add_objects", {
      objects: [
        {
          name: "Vane",
          kind: "cube",
          size: [0.3, 0.05, 0.05],
          location: [-3, -3, 1],
        },
      ],
    });
    await call("blender_animate", {
      keys: [
        { object: "Vane", at: 0, rotation: [0, 0, 0], easing: "linear" },
        { object: "Vane", at: 1, rotation: [0, 0, 90], easing: "linear" },
      ],
      aim: [{ object: "Vane", at: "Ball" }],
    });

    const stopped = await call("blender_animate", {
      aim: [{ object: "Vane", at: "" }],
    });

    expect(stopped.said).toMatch(
      /Vane: no longer aims at anything, and its rotation keys turn it again/,
    );
  }, 180_000);

  it("leaves an object where its other constraints put it when its aim stops", async () => {
    await call("blender_add_objects", {
      objects: [
        {
          name: "Follower",
          kind: "cube",
          size: [0.1, 0.1, 0.1],
          location: [-2, -2, 0.5],
        },
      ],
    });
    const placeOf = async () =>
      (
        await call("blender_run_script", {
          code: [
            "import bpy",
            "bpy.context.view_layer.update()",
            "print('at', tuple(round(v, 3) for v in bpy.data.objects['Follower'].matrix_world.translation))",
          ].join("\n"),
        })
      ).said;
    await call("blender_run_script", {
      code: [
        "import bpy",
        "follower = bpy.data.objects['Follower']",
        "c = follower.constraints.new('COPY_LOCATION')",
        "c.target = bpy.data.objects['Floor']",
        "c.use_offset = True",
      ].join("\n"),
    });
    await call("blender_animate", {
      aim: [{ object: "Follower", at: "Ball" }],
    });
    const aimed = await placeOf();

    await call("blender_animate", { aim: [{ object: "Follower", at: "" }] });
    const stopped = await placeOf();

    expect(stopped).toBe(aimed);
  }, 180_000);

  it("faces straight along a path at its middle when the path is the same on both sides", async () => {
    await call("blender_add_objects", {
      objects: [
        {
          name: "Glider",
          kind: "cube",
          size: [0.3, 0.1, 0.05],
          location: [-1, 4, 1],
        },
      ],
    });
    await call("blender_animate", {
      paths: [
        {
          object: "Glider",
          points: [
            [-1, 4, 1],
            [0, 5, 1],
            [1, 4, 1],
          ],
          from: 0,
          to: 2,
          easing: "linear",
          facing: "x",
        },
      ],
    });

    const sheet = await call("blender_frame_sheet", {
      time: 1,
      every_ms: 100,
      count: 1,
      tile_width: 160,
      engine: "solid",
      objects: ["Glider"],
    });
    const turn = /Glider [^\n]*turned \(([^)]*)\)/.exec(sheet.said)?.[1];
    const degrees = (turn ?? "0°, 0°, 0°")
      .split(",")
      .map((part) => Math.abs(Number.parseFloat(part)));

    expect(sheet.said).toMatch(/Glider \([^)]*\) at \(0, 5, 1 m\)/);
    expect(Math.max(...degrees)).toBeLessThan(0.5);
  }, 180_000);

  it("draws a tall picture's frames narrower, and refuses one too tall in words", async () => {
    await call("blender_set_camera", { resolution: [400, 2000] });
    const tall = await call("blender_frame_sheet", {
      time: 0,
      every_ms: 500,
      count: 2,
      tile_width: 320,
      engine: "solid",
    });
    await call("blender_set_camera", { resolution: [100, 4000] });
    const tooTall = await call("blender_frame_sheet", {
      time: 0,
      every_ms: 500,
      count: 2,
      tile_width: 160,
      engine: "solid",
    });
    await call("blender_set_camera", { resolution: [1920, 1080] });

    expect(tall.isError).toBeUndefined();
    expect(tall.said).toMatch(/each 128×640/);
    expect(tooTall.said).toMatch(/too tall to show as frames: 100×4000/);
  }, 180_000);
  /** The times, in seconds, and values of an object's shown or hidden keys. */
  const hiddenKeys = async (name: string) =>
    (
      await call("blender_run_script", {
        code: [
          "import bpy",
          "from bpy_extras import anim_utils",
          "s = bpy.context.scene",
          `o = bpy.data.objects[${JSON.stringify(name)}]`,
          "a = o.animation_data",
          "keys = []",
          "if a and a.action and a.action_slot:",
          "    bag = anim_utils.action_get_channelbag_for_slot(a.action, a.action_slot)",
          "    keys = [(round((k.co.x - s.frame_start) / s.render.fps, 3), int(k.co.y)) for c in bag.fcurves if c.data_path == 'hide_render' for k in c.keyframe_points]",
          "print('hidden', sorted(keys))",
        ].join("\n"),
      })
    ).said;

  it("keeps every shown or hidden key of an attached part when its parent is cleared", async () => {
    await call("blender_add_objects", {
      objects: [
        {
          name: "Pole",
          kind: "cube",
          size: [0.1, 0.1, 1],
          location: [4, 0, 0.5],
        },
        {
          name: "Bulb",
          kind: "sphere",
          size: [0.1, 0.1, 0.1],
          location: [4, 0, 1.05],
          parent: "Pole",
        },
      ],
    });
    await call("blender_animate", {
      keys: [
        { object: "Pole", at: 0, hidden: false },
        { object: "Pole", at: 2, hidden: true },
        { object: "Bulb", at: 0, hidden: false },
        { object: "Bulb", at: 1, hidden: true },
      ],
    });

    await call("blender_animate", { clear: ["Pole"] });
    const bulb = await hiddenKeys("Bulb");

    expect(bulb).toContain("hidden [(0.0, 0), (1.0, 1), (2.0, 1)]");
  }, 180_000);

  it("clears all of an object's own keys, and leaves its parts' keys", async () => {
    await call("blender_add_objects", {
      objects: [
        {
          name: "Ga",
          kind: "cube",
          size: [0.2, 0.2, 0.2],
          location: [5, 0, 0.1],
        },
        {
          name: "Gb",
          kind: "cube",
          size: [0.1, 0.1, 0.1],
          location: [5, 0, 0.3],
          parent: "Ga",
        },
        {
          name: "Gc",
          kind: "cube",
          size: [0.05, 0.05, 0.05],
          location: [5, 0, 0.4],
          parent: "Gb",
        },
      ],
    });
    await call("blender_animate", {
      keys: [
        { object: "Ga", at: 0, hidden: false },
        { object: "Ga", at: 0.5, hidden: true },
        { object: "Gb", at: 1, hidden: true },
        { object: "Gb", at: 1.5, hidden: false },
      ],
    });

    await call("blender_animate", { clear: ["Gb"] });
    const gb = await hiddenKeys("Gb");
    const gc = await hiddenKeys("Gc");

    expect(gb).toContain("hidden []");
    expect(gc).toContain("hidden [(0.0, 0), (0.5, 1), (1.0, 1), (1.5, 0)]");
  }, 180_000);

  it("leaves a scene set to video output as it was after a frame sheet, its camera included", async () => {
    await call("blender_run_script", {
      code: [
        "import bpy",
        "s = bpy.context.scene",
        "s.render.image_settings.media_type = 'VIDEO'",
        "s.render.image_settings.file_format = 'FFMPEG'",
      ].join("\n"),
    });

    const sheet = await call("blender_frame_sheet", {
      time: 0,
      every_ms: 500,
      count: 1,
      tile_width: 160,
      engine: "solid",
      view: "overview",
    });
    const after = await call("blender_run_script", {
      code: [
        "import bpy",
        "s = bpy.context.scene",
        "print('output', s.render.image_settings.media_type, s.render.image_settings.file_format, s.camera.name if s.camera else None)",
        "s.render.image_settings.media_type = 'IMAGE'",
        "s.render.image_settings.file_format = 'PNG'",
      ].join("\n"),
    });

    expect(sheet.isError).toBeUndefined();
    expect(after.said).toContain("output VIDEO FFMPEG Camera");
  }, 180_000);

  it("keeps a scene's camera and video settings through a frame sheet and a video when its codec takes transparency", async () => {
    const alpha = [
      "import bpy",
      "s = bpy.context.scene",
      "s.render.image_settings.media_type = 'VIDEO'",
      "s.render.image_settings.file_format = 'FFMPEG'",
      "s.render.ffmpeg.format = 'QUICKTIME'",
      "s.render.ffmpeg.codec = 'PNG'",
      "s.render.image_settings.color_mode = 'RGBA'",
    ];
    await call("blender_run_script", {
      code: [...alpha, "s.render.ffmpeg.codec = 'H264'"].join("\n"),
    });
    const sheet = await call("blender_frame_sheet", {
      time: 0,
      every_ms: 500,
      count: 1,
      tile_width: 160,
      engine: "solid",
      view: "overview",
    });
    const camera = await call("blender_run_script", {
      code: "import bpy\nprint('camera', bpy.context.scene.camera.name if bpy.context.scene.camera else None)",
    });
    await call("blender_run_script", { code: alpha.join("\n") });

    const video = await call("blender_render_video", {
      output: "videos/alpha.mp4",
      end: 0.1,
      engine: "eevee",
      samples: 1,
      resolution: [160, 90],
    });
    const after = await call("blender_run_script", {
      code: [
        "import bpy",
        "s = bpy.context.scene",
        "print('after', s.render.ffmpeg.format, s.render.ffmpeg.codec, s.render.image_settings.color_mode)",
        "s.render.image_settings.media_type = 'IMAGE'",
        "s.render.image_settings.file_format = 'PNG'",
      ].join("\n"),
    });

    expect(sheet.isError).toBeUndefined();
    expect(camera.said).toContain("camera Camera");
    expect(video.isError).toBeUndefined();
    expect(after.said).toContain("after QUICKTIME PNG RGBA");
  }, 300_000);

  it("films a video through a camera named for it and keeps the scene's own", async () => {
    await call("blender_run_script", {
      code: [
        "import bpy",
        "data = bpy.data.cameras.new('Side camera')",
        "side = bpy.data.objects.new('Side camera', data)",
        "bpy.context.scene.collection.objects.link(side)",
        "side.location = (6, 0, 1)",
        "side.rotation_euler = (1.45, 0, 1.5708)",
      ].join("\n"),
    });
    const before = await call("blender_run_script", {
      code: "import bpy\nprint('camera', bpy.context.scene.camera.name)",
    });

    const video = await call("blender_render_video", {
      output: "videos/side.mp4",
      end: 0.1,
      engine: "eevee",
      samples: 1,
      resolution: [160, 90],
      camera: "Side camera",
    });
    const after = await call("blender_run_script", {
      code: "import bpy\nprint('camera', bpy.context.scene.camera.name)",
    });

    expect(video.isError, video.said).toBeUndefined();
    expect(video.said).toContain("through Side camera");
    expect(after.said).toBe(before.said);
    expect(after.said).not.toContain("Side camera");
  }, 300_000);

  it("shows close-ups at a moment between two frames where a frame sheet at that moment places the part, and says the moment", async () => {
    // 1 m a second along x; at 24 frames a second, 1.27 s is frame 30.48.
    const added = await call("blender_add_objects", {
      objects: [
        {
          name: "Drifter",
          kind: "cube",
          size: [0.2, 0.2, 0.2],
          location: [0, 3, 0.1],
        },
      ],
    });
    const keyed = await call("blender_animate", {
      fps: 24,
      keys: [
        { object: "Drifter", at: 0, location: [0, 3, 0.1], easing: "linear" },
        { object: "Drifter", at: 2, location: [2, 3, 0.1], easing: "linear" },
      ],
    });
    const sheet = await call("blender_frame_sheet", {
      time: 1.27,
      every_ms: 100,
      count: 1,
      tile_width: 160,
      engine: "solid",
      view: "objects",
      objects: ["Drifter"],
    });
    const close = await call("blender_close_ups", {
      objects: ["Drifter"],
      tile_width: 160,
      time: 1.27,
    });
    const placed = (said: string) =>
      /Drifter[^\n]*? at (\([^)]*\))/.exec(said)?.[1];

    expect(added.isError, added.said).toBeUndefined();
    expect(keyed.isError, keyed.said).toBeUndefined();
    expect(sheet.isError, sheet.said).toBeUndefined();
    expect(close.isError, close.said).toBeUndefined();
    expect(close.said).toContain("at 1.27 s of the animation");
    expect(placed(sheet.said)).toBe("(1.27, 3, 0.1 m)");
    expect(placed(close.said)).toBe("(1.27, 3, 0.1 m)");
  }, 300_000);

  it("refuses close-ups at a time that is not a moment of the timeline, in words", async () => {
    const late = await call("blender_close_ups", {
      objects: ["Drifter"],
      time: 900,
    });

    expect(late.isError).toBe(true);
    expect(late.said).toContain("time is at most 600 s");
    expect(late.said).not.toContain("Traceback");
  }, 120_000);
});

describe.runIf(blender)("a real Blender, timing and checking motion", () => {
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
  const done = async (name: string, args: Record<string, unknown>) => {
    const result = await call(name, args);
    expect(result.failed, result.said).toBe(false);
    return result.said;
  };
  const printed = (code: string[]) =>
    done("blender_run_script", { code: code.join("\n") });
  const cube = (name: string, size: number, location: number[]) => ({
    name,
    kind: "cube",
    size: [size, size, size],
    location,
  });

  beforeAll(async () => {
    const root = await folders.make("zhiyin-studio-timing-");
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
    tools = sceneAutomation(scenes.scene("timing"), {
      workspaceRoot: () => workspace,
      blender: async () => blender,
      directory: scenes.directory("timing"),
    });
    await done("blender_open_scene", { path: "timing.blend", create: true });
    await done("blender_add_objects", {
      objects: [
        cube("Door", 0.2, [0, 3, 0.1]),
        cube("Car_1", 0.2, [2, 0, 0.1]),
        cube("Car_2", 0.2, [2, 0, 0.1]),
        cube("Gear_A", 0.2, [-3, 0, 1]),
        cube("Gear_B", 0.2, [-3, 0.15, 1]),
        cube("Foot", 0.1, [-5, 0, 0.04]),
        { name: "Floor", kind: "plane", size: [20, 20] },
      ],
    });
    await done("blender_set_camera", {
      location: [0, -12, 6],
      look_at: [0, 0, 0],
    });
  }, 180_000);

  afterAll(async () => {
    await scenes.forget("timing");
    await scenes.closeAll();
    await folders.removeAll();
  });

  it("keys a custom property, ends a new scene's timeline at the last key, and describes each channel's key times", async () => {
    const keyed = await done("blender_animate", {
      keys: [
        { object: "Door", at: 0, property: { path: '["open"]', values: [0] } },
        { object: "Door", at: 1, property: { path: '["open"]', values: [1] } },
        { object: "Door", at: 0.5, location: [0, 3, 0.1] },
      ],
    });
    const value = await printed([
      "import bpy",
      "s = bpy.context.scene",
      "s.frame_set(13)",
      "print('open', round(bpy.data.objects['Door']['open'], 2), 'end', s.frame_end)",
      "s.frame_set(1)",
    ]);
    const described = await done("blender_describe_scene", {});

    expect(keyed).toContain('["open"] 0, a custom property made for it');
    expect(keyed).toContain(
      "It ends at the last key, at 1 s, rather than holding the last pose for 9.38 s more as a new scene's 250 frames would",
    );
    // Halfway, smoothly eased: half open.
    expect(value).toContain("open 0.5 end 25");
    const item = await call("blender_animate", {
      keys: [
        {
          object: "Door",
          at: 0,
          property: { path: 'modifiers["Array"]', values: [1] },
        },
      ],
    });
    expect(item.failed).toBe(true);
    expect(item.said).toContain(
      'modifiers["Array"] names an item of modifiers, not a value',
    );
    expect(described).toContain(
      'Keys by channel: Door\'s ["open"] at 0 s and 1 s, location at 0.5 s only, so held at every time.',
    );
  }, 180_000);

  it("gives every script fcurves_of, which reads a block's keys from its action slot as Blender 5 keeps them", async () => {
    const said = await printed([
      "import bpy",
      "print(sorted(f'{c.data_path}[{c.array_index}] {len(c.keyframe_points)}' for c in fcurves_of(bpy.data.objects['Door'])))",
      "print('unkeyed', fcurves_of(bpy.data.objects['Floor']))",
    ]);

    expect(said).toContain(
      "['[\"open\"][0] 2', 'location[0] 1', 'location[1] 1', 'location[2] 1']",
    );
    expect(said).toContain("unkeyed []");
  }, 120_000);

  it("sends a train along a closed curve, leaning into the turn, and gives the path's length and top speed", async () => {
    await printed([
      "import bpy",
      "bpy.ops.curve.primitive_bezier_circle_add(radius=2, location=(0, 0, 0.1))",
      "bpy.context.object.name = 'Track'",
    ]);
    const keyed = await done("blender_animate", {
      paths: [
        {
          object: "Car_1",
          curve: "Track",
          from: 0,
          to: 4,
          easing: "linear",
          facing: "x",
          bank: 20,
          train: ["Car_2"],
          spacing: 0.5,
        },
      ],
    });
    const placed = await printed([
      "import bpy",
      "s = bpy.context.scene",
      "s.frame_set(49)",
      "a, b = bpy.data.objects['Car_1'], bpy.data.objects['Car_2']",
      "gap = (a.matrix_world.translation - b.matrix_world.translation).length",
      "inward = -a.matrix_world.translation.copy(); inward.z = 0",
      "top = a.matrix_world.col[2].xyz",
      "print(f'gap {gap:.2f} leans in {top.dot(inward.normalized()) > 0.2} radius {a.matrix_world.translation.xy.length:.2f}')",
      "s.frame_set(1)",
    ]);

    expect(keyed).toMatch(
      /Car_1: along a path along Track, round its loop, 0 s to 4 s, 12\.\d+ m long, linear, its x axis ahead, leaning up to 20° into its turns; at most 3\.\d+ m\/s/,
    );
    expect(keyed).toContain(
      "Car_2: on Car_1's path, 500 mm behind it, round the loop.",
    );
    // 500 mm along a circle of 2 m is a chord of 499 mm.
    expect(placed).toContain("gap 0.50 leans in True radius 2.00");
  }, 180_000);

  it("checks every frame in numbers without pictures: allowed contacts apart, a foot sunk in the floor, the hardest acceleration", async () => {
    await done("blender_animate", {
      keys: [
        { object: "Gear_A", at: 0, location: [-3, 0, 1], easing: "linear" },
        { object: "Gear_A", at: 1, location: [-3, 1, 1], easing: "linear" },
        { object: "Gear_B", at: 0, location: [-3, 0.15, 1], easing: "linear" },
        { object: "Gear_B", at: 1, location: [-3, 1.15, 1], easing: "linear" },
        { object: "Foot", at: 0, location: [-5, 0, 0.04], easing: "linear" },
        { object: "Foot", at: 1, location: [-4, 0, 0.04], easing: "linear" },
      ],
    });
    const report = await done("blender_frame_sheet", {
      pictures: false,
      time: 0,
      end: 1,
      objects: ["Gear_A", "Gear_B", "Foot"],
      allowed: [
        ["Gear_A", "Gear_B"],
        ["Car_1", "Door"],
      ],
    });

    expect(report).toContain("A motion report in numbers, with no pictures");
    expect(report).toContain(
      "Checked at every frame from 0 s to 1 s, 25 frames",
    );
    expect(report).toMatch(
      /Allowed contacts, left out of the overlaps: Gear_A and Gear_B, 50(\.\d+)? mm deep/,
    );
    expect(report).not.toMatch(/Deepest overlaps[^\n]*Gear_A/);
    expect(report).toMatch(
      /Feet and wheels, by their names \(Foot\), going into what they stand on, deepest first: Foot 10(\.\d+)? mm into Floor/,
    );
    expect(report).toMatch(/Hardest accelerations: [^\n]*m\/s² \([\d.]+ g\)/);
    expect(report).toContain(
      "Allowed contacts that never touch in these frames: Car_1 and Door.",
    );
  }, 300_000);

  it("stops a report of every frame once most of its time is spent, and says where to check on from", async () => {
    const said = await printed([
      "from zhiyin_studio.frame_sheet import frame_sheet",
      "print(frame_sheet({'pictures': False, 'time': 0, 'end': 1, 'limit_seconds': 1e-6}, None, None))",
    ]);

    expect(said).toMatch(
      /Checked at every frame from 0 s to 0 s, 1 frames \(stopped there for the call's time, short of 1 s: check on with time 0 s\)/,
    );
  }, 300_000);

  it("renders a draft of every 2nd frame at its real speed, and a slow-motion video", async () => {
    const video = await done("blender_render_video", {
      output: "videos/draft.mp4",
      end: 0.25,
      samples: 1,
      resolution: [64, 36],
      every: 2,
      slow_motion: 2,
    });

    expect(video).toContain("7 frames at 12 a second, which play for 0.583 s");
    expect(video).toContain(
      "Every 2nd frame, at 12 a second, so it plays at its real speed.",
    );
    expect(video).toContain(
      "Slowed 2 times: 0.25 s of the animation plays for 0.583 s.",
    );
    const file = await readFile(join(workspace, "videos", "draft.mp4"));
    expect(file.subarray(4, 8).toString("latin1")).toBe("ftyp");
  }, 300_000);

  it("samples a Cycles video as asked for that video alone, its seed changing each frame, and puts the scene's sampling back", async () => {
    await printed([
      "import bpy",
      "c = bpy.context.scene.cycles",
      "c.use_animated_seed, c.adaptive_threshold, c.seed = False, 0.02, 7",
    ]);
    const video = await done("blender_render_video", {
      output: "videos/sampled.mp4",
      end: 0.08,
      engine: "cycles",
      samples: 2,
      resolution: [64, 36],
      sampling: { noise_threshold: 0.1, seed: 3 },
    });
    const after = await printed([
      "import bpy",
      "c = bpy.context.scene.cycles",
      "print('kept', c.use_animated_seed, round(c.adaptive_threshold, 3), c.seed)",
    ]);

    expect(video).toContain(
      "Cycles sampling as given for this video alone, its seed changing each frame.",
    );
    expect(after).toContain("kept False 0.02 7");
  }, 300_000);

  it("draws a video too long for one call over several, skipping the frames made, and writes it with the last", async () => {
    const said = await printed([
      "import os",
      "import zhiyin_studio.render_video as video",
      "from zhiyin_studio.pictures import Device",
      "args = {'output': os.path.abspath('videos/long.mp4'), 'end': 0.125, 'samples': 1, 'resolution': [64, 36],",
      "        'limit_seconds': 0.001, 'video_key': 'videos/long.mp4'}",
      "device = Device()",
      "for i in range(4):",
      "    print('CALL', i, video.render_video(args, None, device))",
    ]);
    const calls = said.split("CALL ").slice(1);

    expect(calls[0]).toContain(
      "1 of its 4 frames are made (1 in this call, 0 before)",
    );
    expect(calls[0]).toMatch(/the 3 left take about \d+ s more/);
    expect(calls[2]).toContain(
      "3 of its 4 frames are made (1 in this call, 2 before)",
    );
    expect(calls[3]).toContain(
      "Rendered long.mp4, 64×36, from 0 s to 0.125 s of the animation: 4 frames",
    );
    expect(calls[3]).toContain("drawn frame by frame");
    const file = await readFile(join(workspace, "videos", "long.mp4"));
    expect(file.subarray(4, 8).toString("latin1")).toBe("ftyp");
  }, 300_000);
});

async function readdirNames(folder: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  return (await readdir(folder)).sort();
}
