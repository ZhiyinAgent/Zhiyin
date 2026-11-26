/**
 * Stylised pictures against a real Blender: outlines by Freestyle, by Line
 * Art and by an inverted hull, each named in the answer and drawn in Cycles
 * and EEVEE; toon shading built onto a material, banded in each engine; and
 * Blender's own compositor effects laid over every render, their inputs read
 * back. Pictures are tiny and few-sampled.
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

/** A white box turned on a white ground, under a sun, with a camera on it. */
const stage = [
  "import bpy, math",
  "for old in list(bpy.data.objects): bpy.data.objects.remove(old)",
  "for old in list(bpy.data.materials): bpy.data.materials.remove(old)",
  "bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0.5))",
  "box = bpy.context.active_object",
  "box.name = 'Box'",
  "box.rotation_euler.z = math.radians(30)",
  "m = bpy.data.materials.new('Paint')",
  "m.use_nodes = True",
  "m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.8, 0.1, 0.1, 1)",
  "box.data.materials.append(m)",
  "cam = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera'))",
  "bpy.context.scene.collection.objects.link(cam)",
  "bpy.context.scene.camera = cam",
  // No post or EEVEE options left from a test before.
  "bpy.context.scene.compositing_node_group = None",
  "bpy.context.scene.pop('zhiyin_post', None)",
  "bpy.context.scene.pop('zhiyin_eevee', None)",
];

/**
 * Measures a picture in the workspace: its share of dark pixels, its
 * corners' and its middle's brightness, and how many flat levels the red box
 * shows, each a level of brightness that a twentieth of it or more holds.
 */
const measure = (path: string) =>
  [
    "import bpy, numpy",
    `image = bpy.data.images.load(bpy.path.abspath('//${path}'), check_existing=False)`,
    "w, h = image.size",
    "px = numpy.empty(w * h * 4, dtype=numpy.float32)",
    "image.pixels.foreach_get(px)",
    "rgb = px.reshape(h, w, 4)[..., :3]",
    "lum = rgb.mean(axis=-1)",
    "corner = float(numpy.mean([lum[1, 1], lum[1, -2], lum[-2, 1], lum[-2, -2]]))",
    "middle = lum[h // 3: 2 * h // 3, w // 3: 2 * w // 3]",
    "red = lum[(rgb[..., 0] - rgb[..., 1]) > 0.15]",
    "values, counts = numpy.unique(numpy.round(red, 2), return_counts=True)",
    "bands = int((counts >= 0.05 * max(len(red), 1)).sum())",
    "print(f'dark {float((lum < 0.25).mean()):.4f} corner {corner:.3f} middle {float(middle.mean()):.3f} bands {bands}')",
  ].join("\n");

const readings = (said: string) => {
  const found =
    /dark ([\d.]+) corner ([\d.]+) middle ([\d.]+) bands (\d+)/.exec(said);
  expect(found, said).not.toBeNull();
  const [, dark, corner, middle, bands] = found!.map(Number);
  return { dark: dark!, corner: corner!, middle: middle!, bands: bands! };
};

describe.runIf(blender)("stylised pictures in a real Blender", () => {
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
  const script = (lines: string[] | string) =>
    done("blender_run_script", {
      code: Array.isArray(lines) ? lines.join("\n") : lines,
    });
  /** A tiny picture and what it measures. */
  const picture = async (
    engine: string,
    name = engine,
    extra: Record<string, unknown> = {},
  ) => {
    const said = await done("blender_render", {
      output: `renders/${name}.png`,
      engine,
      samples: 8,
      resolution: [96, 72],
      noise: false,
      ...extra,
    });
    return {
      said,
      ...readings(await script(measure(`renders/${name}.png`))),
    };
  };
  const fresh = async () => {
    await script(stage);
    await done("blender_set_camera", {
      location: [0, -4, 1.5],
      look_at: [0, 0, 0.5],
      outlines: { method: "none" },
    });
    await done("blender_set_lighting", {
      background: { color: "#ffffff", strength: 1 },
      lights: [{ name: "Sun", kind: "sun", strength: 2 }],
    });
  };

  beforeAll(async () => {
    const root = await folders.make("zhiyin-studio-render-styles-");
    const workspace = join(root, "workspace");
    await mkdir(join(workspace, "renders"), { recursive: true });
    scenes = new ConversationScenes({
      blender: async () => blender,
      directory: join(root, "data"),
      launch: withKeptGlCache(containedSessionLaunch)(
        { open: openProcessContainer },
        { scripts: join(root, "session-scripts") },
      ),
      script: sessionScript,
    });
    tools = sceneAutomation(scenes.scene("render-styles"), {
      workspaceRoot: () => workspace,
      blender: async () => blender,
      directory: scenes.directory("render-styles"),
    });
    await call("blender_open_scene", { path: "styles.blend", create: true });
  });

  afterAll(async () => {
    await scenes.forget("render-styles");
    await scenes.closeAll();
    await folders.removeAll();
  });

  it("outlines with Freestyle, Line Art or a hull, names the method, and draws each in Cycles and EEVEE", async () => {
    await fresh();
    const plain = await picture("cycles", "plain");
    const free = await done("blender_set_camera", {
      outlines: { method: "freestyle", thickness: 2 },
    });
    const freeCycles = await picture("cycles", "freestyle-cycles");
    const freeEevee = await picture("eevee", "freestyle-eevee");
    const freeBox = await done("blender_set_camera", {
      outlines: { method: "freestyle", objects: ["Box"] },
    });
    const freeBoxCycles = await picture("cycles", "freestyle-box");
    const art = await done("blender_set_camera", {
      outlines: { method: "line_art", thickness: 3, color: "#101010" },
    });
    const artEevee = await picture("eevee", "line-art-eevee");
    const shell = await done("blender_set_camera", {
      outlines: { method: "hull", thickness: 3, objects: ["Box"] },
    });
    const shellCycles = await picture("cycles", "hull-cycles");
    const shellEevee = await picture("eevee", "hull-eevee");
    await done("blender_set_camera", {
      outlines: { method: "hull", thickness: 0.1, objects: ["Box"] },
    });
    const thin = await picture("cycles", "hull-thin");
    const removed = await done("blender_set_camera", {
      outlines: { method: "none" },
    });
    const after = await picture("cycles", "after");

    expect(free).toContain(
      "Outlines by Freestyle: 2 px #000000 lines along silhouettes, borders and creases sharper than 134° between faces, of every object shown; Cycles and EEVEE draw them after the picture, which adds to its time.",
    );
    expect(freeBox).toContain(
      "Outlines by Freestyle: 2 px #000000 lines along silhouettes, borders and creases sharper than 134° between faces, of Box;",
    );
    expect(art).toMatch(
      /Outlines by Line Art: the Grease Pencil object Line art, its lines 3 px #101010 \([\d.]+ mm wide at [\d.]+ m, Box's distance from the camera\), along the outlines and creases sharper than 140° of everything shown: [1-9]\d* strokes? now, drawn over the picture in Cycles and EEVEE, in place of Freestyle's lines\./,
    );
    expect(shell).toMatch(
      /Outlines by an inverted hull, 3 px of the picture, #000000: Box [\d.]+ mm wide, at [\d.]+ m from the camera; drawn past each shape's edge in Cycles and EEVEE, its light left as it was, in place of the Line Art object\./,
    );
    expect(removed).toContain("Outlines removed: the hulls round Box.");
    // Each picture says how much of the outlined silhouettes carries the line it drew.
    const lined = (said: string, method: string) => {
      const found = new RegExp(
        `Outlines by ${method} line (\\d+)% of the outlined shapes' silhouettes in the picture`,
      ).exec(said);
      expect(found, said).not.toBeNull();
      return Number(found![1]);
    };
    expect(lined(freeCycles.said, "Freestyle")).toBeGreaterThan(70);
    expect(lined(freeEevee.said, "Freestyle")).toBeGreaterThan(70);
    expect(lined(artEevee.said, "Line Art")).toBeGreaterThan(70);
    expect(lined(shellCycles.said, "an inverted hull")).toBeGreaterThan(70);
    // A line too thin to show is found missing, and the shape named.
    expect(lined(thin.said, "an inverted hull")).toBeLessThan(50);
    expect(thin.said).toMatch(
      /; least Box \d+%, whose lines are missing along part of the edge/,
    );
    expect(plain.said).not.toContain("Outlines by");
    expect(after.said).not.toContain("Outlines by");
    // Each method darkens the picture along the box's edges, in each engine asked.
    for (const [method, outlined] of Object.entries({
      freeCycles,
      freeBoxCycles,
      freeEevee,
      artEevee,
      shellCycles,
      shellEevee,
    }))
      expect(outlined.dark, `${method} against ${plain.dark}`).toBeGreaterThan(
        plain.dark + 0.01,
      );
    expect(after.dark).toBeCloseTo(plain.dark, 2);
  }, 300_000);

  it("outlines from a script with zhiyin.outline, and refuses it with no camera", async () => {
    await fresh();
    const outlined = await script("zhiyin.outline('Box', thickness=2)");
    const refused = await call("blender_run_script", {
      code: "import bpy\nbpy.context.scene.camera = None\nzhiyin.outline('Box')",
    });

    expect(outlined).toMatch(
      /- outline by an inverted hull, 2 px of the picture, #000000: Box [\d.]+ mm wide, at [\d.]+ m from the camera; drawn past each shape's edge in Cycles and EEVEE, its light left as it was/,
    );
    expect(refused.failed).toBe(true);
    expect(refused.said).toContain(
      "Outline widths are in pixels of the camera's picture: set a camera first.",
    );
  }, 240_000);

  it("shades a material as a toon in flat bands, each engine its own way, and says the bands", async () => {
    await fresh();
    // Lit from one side alone, so the box's faces get different light.
    await done("blender_set_lighting", {
      background: { color: "#000000", strength: 0 },
      lights: [
        { name: "Sun", location: [3, -1, 2], look_at: [0, 0, 0], strength: 3 },
      ],
    });
    const smooth = await picture("eevee", "smooth-eevee");
    const tooned = await script("zhiyin.toon('Paint', bands=2, shadow=0.4)");
    const eevee = await picture("eevee", "toon-eevee");
    const cycles = await picture("cycles", "toon-cycles");
    const faceted = await script(
      "zhiyin.toon(bpy.data.materials['Paint'], bands=3, faceted=True)",
    );
    const missing = await call("blender_run_script", {
      code: "zhiyin.toon('Nothing')",
    });

    expect(tooned).toContain(
      "- toon Paint: 2 bands of light, darkest first: #993838 (40%), #e75959 (100%); EEVEE draws them flat from Shader to RGB through a constant ramp, Cycles as Toon BSDFs stepped by the angle to the light; on Box",
    );
    expect(faceted).toContain(
      "- toon Paint: 3 bands of light, darkest first: #903535 (35%), #c24949 (68%), #e75959 (100%), each face shaded flat;",
    );
    expect(missing.said).toContain("There is no material named “Nothing”.");
    // Banded, the box's middle holds a few flat levels where it held a gradient.
    // Its faces, each lit differently, fall into the two bands asked, in each engine.
    expect(smooth.bands).toBeGreaterThan(2);
    expect([eevee.bands, cycles.bands]).toEqual([2, 2]);
    // The render counts the flat colours the toon shape shows itself, and an
    // EEVEE picture of a toon is the one to hand over, not a draft.
    for (const said of [eevee.said, cycles.said])
      expect(said).toMatch(
        /Toon: Box shows 2 flat colours of the 2 bands asked\. The picture's palette: \d+ flat colours, each over 1% of it, cover \d+% of it\./,
      );
    expect(eevee.said).toContain(
      "EEVEE makes this the picture to hand over, for the toon materials it shows, which are drawn for EEVEE:",
    );
    expect(eevee.said).not.toContain("EEVEE is a quick look");
    expect(smooth.said).toContain("EEVEE is a quick look");
    expect(smooth.said).not.toContain("Toon:");
    // The Toon BSDFs feed Cycles' own output, so an EEVEE scene is not told they show only in Cycles.
    const underEevee = await script(
      "bpy.context.scene.render.engine = 'BLENDER_EEVEE'\nzhiyin.toon('Paint', bands=2)",
    );
    expect(underEevee).toContain("- toon Paint: 2 bands of light");
    expect(underEevee).not.toContain("shows only in Cycles");
  }, 240_000);

  it("shades a material as a toon through blender_set_material, with tinted shadows and a rim, and measures fewer bands than asked", async () => {
    await fresh();
    await done("blender_set_lighting", {
      background: { color: "#000000", strength: 0 },
      lights: [
        { name: "Sun", location: [3, -1, 2], look_at: [0, 0, 0], strength: 3 },
      ],
    });
    const typed = await done("blender_set_material", {
      objects: ["Box"],
      material: { name: "Paint" },
      toon: { bands: 2, shadow_color: "#404080" },
    });
    const tinted = await picture("eevee", "toon-tinted");
    const many = await done("blender_set_material", {
      objects: ["Box"],
      material: { name: "Paint" },
      toon: { bands: 6, rim: { color: "#ffeeaa", width: 0.3 } },
    });
    const crowded = await picture("eevee", "toon-many");
    const unknown = await call("blender_set_material", {
      objects: ["Box"],
      material: { name: "Paint" },
      toon: { bands: 2, outline: true },
    });

    expect(typed).toContain(
      "Toon Paint: 2 bands of light, darkest first: #391028 (times #404080), #e75959 (times #ffffff)",
    );
    expect(typed).toContain(
      "render it with EEVEE, which makes it the picture to hand over.",
    );
    expect(tinted.said).toContain(
      "Toon: Box shows 2 flat colours of the 2 bands asked.",
    );
    expect(many).toContain(
      "a #ffeeaa rim over the outer 30% of the turn away from the camera",
    );
    // A box's few faces cannot show six bands and a rim: the render says so.
    expect(crowded.said).toMatch(
      /Toon: Box shows [1-5] flat colours? of the 6 bands asked, with a rim: its light falls in fewer bands than asked/,
    );
    expect(unknown.failed).toBe(true);
    expect(unknown.said).toContain(
      "toon has no outline: it takes bands, shadow, shadow_color, rim and faceted.",
    );
  }, 240_000);

  it("lays a post over this and every later render, reads its inputs back, says it in the render, and meters the light under it", async () => {
    await fresh();
    const plain = await picture("eevee", "effects-plain");
    const eevee = await picture("eevee", "effects-eevee", {
      post: [
        { step: "vignette", inputs: { Feather: 0.2 } },
        {
          step: "film_grain",
          amount: 0.5,
          inputs: { Preset: "Custom", Style: "Custom Style", ISO: 6400 },
        },
      ],
    });
    const cycles = await picture("cycles", "effects-cycles");
    const unknown = await call("blender_render", {
      output: "renders/refused.png",
      post: [{ step: "sepia", inputs: { Strength: 1 } }],
    });
    const badChoice = await call("blender_render", {
      output: "renders/refused.png",
      post: [{ step: "film_grain", inputs: { Preset: "Huge" } }],
    });
    const unused = await call("blender_render", {
      output: "renders/refused.png",
      post: [{ step: "film_grain", inputs: { ISO: 6400 } }],
    });
    const camera = await call("blender_set_camera", {
      effects: [{ effect: "vignette" }],
    });
    const plan = await done("blender_render", {
      output: "renders/plan.png",
      view: "plan",
      resolution: [64, 48],
    });
    const cleared = await picture("eevee", "effects-after", { post: [] });

    expect(eevee.said).toContain(
      "Post, laid over this and every later render and video, in Cycles and EEVEE, in this order: Vignette at 100% (Feather 0.2, Factor 1, Corner Roundness 1, Scale (0.8, 0.8), Offset (0, 0), Angle 0); Film Grain at 50% (Preset Custom, Style Custom Style, ISO 6400, past its range of 50 to 3200, which Blender takes as given,",
    );
    expect(eevee.said).toContain(", composited with Vignette and Film Grain");
    // Kept in the scene: the next render is composited too, without being told.
    expect(cycles.said).toContain(", composited with Vignette and Film Grain");
    expect(cycles.said).not.toContain("Post, laid over");
    // The vignette darkens the corners, in each engine.
    expect(eevee.corner).toBeLessThan(plain.corner - 0.2);
    expect(cycles.corner).toBeLessThan(plain.corner - 0.2);
    // The light is metered as the scene made it, before the post darkened the picture.
    const middle = (said: string) =>
      /the middle of its light ([\d.]+) stops (over|under)/
        .exec(said)
        ?.slice(1);
    expect(middle(eevee.said)).toEqual(middle(plain.said));
    expect(unknown.failed).toBe(true);
    expect(unknown.said).toContain(
      "Sepia has no input Strength: it has Contrast, Tone and Saturation.",
    );
    expect(badChoice.failed).toBe(true);
    expect(badChoice.said).toContain(
      "Film Grain's Preset has no choice “Huge”: it is one of '8 mm Caffenol', '8 mm Home Movie', 'Super 8 mm',",
    );
    // An input the step's choices leave unused is refused, not set to no effect.
    expect(unused.failed).toBe(true);
    expect(unused.said).toContain(
      "Film Grain's ISO is unused with its choices as they are (Preset Super 8 mm): give the choice that uses it in the same call.",
    );
    // The camera takes no picture effects: they are the render's post.
    expect(camera.failed).toBe(true);
    expect(camera.said).toContain(
      "Picture effects are blender_render's post: give them there",
    );
    // A plan is drawn plain, whatever post the scene keeps.
    expect(plan).not.toContain("composited");
    expect(cleared.said).toContain("No post.");
    expect(cleared.said).not.toContain("composited");
    expect(cleared.corner).toBeCloseTo(plain.corner, 1);
  }, 300_000);

  it("blooms highlights past a threshold measured from the picture's light, says the share above it, and builds Blender's own steps", async () => {
    await fresh();
    await script([
      "import bpy",
      "bpy.ops.mesh.primitive_uv_sphere_add(radius=0.15, location=(0.9, 0, 1.2))",
      "lamp = bpy.context.active_object",
      "lamp.name = 'Lamp'",
      "m = bpy.data.materials.new('Glow')",
      "m.use_nodes = True",
      "p = m.node_tree.nodes['Principled BSDF']",
      "p.inputs['Emission Color'].default_value = (1, 0.9, 0.7, 1)",
      "p.inputs['Emission Strength'].default_value = 40",
      "lamp.data.materials.append(m)",
    ]);
    // On a black sky, where a glow shows.
    await done("blender_set_lighting", {
      background: { color: "#000000", strength: 0 },
    });
    const plain = await picture("eevee", "bloom-plain");
    const bloomed = await picture("eevee", "bloom", {
      post: [{ step: "bloom" }],
    });
    const high = await picture("eevee", "bloom-high", {
      post: [{ step: "bloom", threshold: 100000 }],
    });
    const steps = await picture("cycles", "steps", {
      post: [
        { step: "color_balance", inputs: { "Color Gain": [1, 0.5, 0.5, 1] } },
        { step: "sharpen", amount: 0.5 },
        { step: "painterly", inputs: { Size: 3 } },
        { step: "lens_distortion" },
        { step: "streaks", inputs: { Streaks: 6 } },
      ],
    });
    const twice = await call("blender_render", {
      output: "renders/refused.png",
      post: [{ step: "bloom", threshold: 2, inputs: { Threshold: 3 } }],
    });
    const notGlare = await call("blender_render", {
      output: "renders/refused.png",
      post: [{ step: "vignette", threshold: 2 }],
    });
    const onWhite = await done("blender_render", {
      output: "renders/white.png",
      engine: "cycles",
      samples: 4,
      resolution: [48, 36],
      background: "white",
      noise: false,
    });

    expect(bloomed.said).toMatch(
      /Measured from this picture's light: bloom's threshold [\d.]+, a stop under the brightest half-percent of the picture's light \([\d.]+\): [\d.]+% of the picture is brighter\./,
    );
    const above = Number(
      /: ([\d.]+)% of the picture is brighter/.exec(bloomed.said)![1],
    );
    expect(above).toBeGreaterThan(0);
    expect(above).toBeLessThan(5);
    // The glow spreads round the lamp: the picture is brighter than without it.
    expect(bloomed.dark).toBeLessThan(plain.dark);
    expect(high.said).toContain(
      "bloom's threshold 1e+05, as given: 0% of the picture is brighter, so nothing glows: brighten what should glow, or give a lower threshold.",
    );
    expect(steps.said).toMatch(
      /in this order: Color Balance at 100% \(Color Gain \(1, 0\.5, 0\.5, 1\), Factor 1, Type Lift\/Gamma\/Gain,[^;]*; Sharpen at 50% \(Factor 1, Type Diamond Sharpen\); Kuwahara at 100% \(Size 3,[^;]*; Lens Distortion at 100% \(Type Radial, Distortion 0\.03,[^;]*; Streaks at 100% \(Streaks 6,/,
    );
    expect(steps.said).toContain(
      ", composited with Color Balance, Sharpen, Kuwahara, Lens Distortion and Streaks",
    );
    expect(twice.failed).toBe(true);
    expect(twice.said).toContain(
      "Bloom's threshold is given once: as threshold or in its inputs.",
    );
    expect(notGlare.failed).toBe(true);
    expect(notGlare.said).toContain(
      "threshold is a glare's: bloom, glow, streaks, ghosts, star, sun_beams.",
    );
    expect(onWhite).toContain(
      "The post is not laid over a picture on white, which stays exact white.",
    );
  }, 300_000);

  it("lays a post and appends Blender's bundled compositor groups from a script", async () => {
    await fresh();
    const laid = await script(
      'zhiyin.post([{"step": "glow"}, {"step": "vignette", "amount": 0.5}])',
    );
    const group = await script(
      'g = zhiyin.compositor_group("Retime")\nprint(g.name, g.bl_idname)',
    );
    const missing = await call("blender_run_script", {
      code: 'zhiyin.compositor_group("Bloom")',
    });

    expect(laid).toContain(
      "- post, laid over this and every later render and video, in Cycles and EEVEE, in this order: Fog Glow at 100% (",
    );
    expect(laid).toContain(
      "; glow: its threshold is measured from each picture blender_render makes, Blender's 1 until then",
    );
    expect(group).toContain("Retime CompositorNodeTree");
    expect(group).toContain(
      "- compositor group Retime, Blender's own: takes Offset (int), Step (int), Speed (float), Cyclic (bool), Cycle Length (int); gives Frame (int); it goes in a compositor tree as a CompositorNodeGroup node whose node_tree is it",
    );
    expect(missing.failed).toBe(true);
    expect(missing.said).toContain(
      "Blender bundles no compositor group named Bloom: it has 3D to Screen Space, Chromatic Aberration,",
    );
  }, 240_000);

  it("makes EEVEE the engine of the picture to hand over, with its quality kept in the scene and light probes baked", async () => {
    await fresh();
    const final = await picture("eevee", "eevee-final", {
      eevee: {
        final: true,
        shadows: { rays: 2, steps: 8 },
        raytracing: { method: "probe", resolution: 1 },
        volumes: { tile: 4, samples: 32, shadows: true },
        probes: true,
      },
    });
    const again = await picture("eevee", "eevee-again");
    const kept = await script([
      "import bpy",
      "e = bpy.context.scene.eevee",
      "print(e.shadow_ray_count, e.shadow_step_count, e.ray_tracing_method, e.ray_tracing_options.resolution_scale, e.volumetric_tile_size, e.volumetric_samples, e.use_volumetric_shadows)",
      "print([o.name for o in bpy.context.scene.objects if o.type == 'LIGHT_PROBE'])",
    ]);
    const draft = await picture("eevee", "eevee-draft", {
      eevee: { final: false },
    });
    const refused = await call("blender_render", {
      output: "renders/refused.png",
      engine: "cycles",
      eevee: { final: true },
    });

    expect(final.said).toContain(
      "EEVEE makes this the picture to hand over, as asked (eevee final): shadows of 2 rays and 8 steps at 100% resolution, ray tracing by light probes at 1/1 resolution, volumes in 4 px tiles of 32 samples with their shadows, 8 samples.",
    );
    expect(final.said).toMatch(
      /Light probes baked in [\d.]+ s: Light probe volume, a volume fitted round the scene and kept in it, so its rooms keep the sky's light out\./,
    );
    expect(final.said).not.toContain("EEVEE is a quick look");
    expect(again.said).toContain(
      "EEVEE makes this the picture to hand over, as asked (eevee final)",
    );
    expect(kept).toContain("2 8 PROBE 1 4 32 True");
    expect(kept).toContain("['Light probe volume']");
    expect(draft.said).toContain("EEVEE is a quick look");
    expect(refused.failed).toBe(true);
    expect(refused.said).toContain("eevee's options are for engine eevee.");
  }, 240_000);
});
