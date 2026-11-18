/**
 * Shaping light against a real Blender: which objects a light lights and
 * which cast its shadows, in Cycles and EEVEE; cards the camera does not see
 * and the rays that see an object; fog in a box round the scene or endless;
 * caustics, which only Cycles draws; and the samples a Cycles picture
 * spends. Pictures are tiny and few-sampled.
 *
 *   $env:ZHIYIN_BLENDER = "…\blender.exe"; npx vitest run --project system-boundary packages/feature/blender-studio
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

/** A grey floor with a mug and a box on it, a camera on them and no light. */
const table = [
  "import bpy",
  "for old in list(bpy.data.objects): bpy.data.objects.remove(old)",
  "def add(name, size, at):",
  "    bpy.ops.mesh.primitive_cube_add(size=1, location=at)",
  "    o = bpy.context.active_object",
  "    o.name = name",
  "    o.data.name = name",
  "    o.scale = size",
  "    m = bpy.data.materials.new(name)",
  "    m.use_nodes = True",
  "    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.6, 0.6, 0.6, 1)",
  "    o.data.materials.append(m)",
  "    bpy.ops.object.transform_apply(scale=True)",
  "add('Floor', (4, 4, 0.02), (0, 0, -0.01))",
  "add('Mug', (0.4, 0.4, 0.4), (-0.6, 0, 0.2))",
  "add('Box', (0.4, 0.4, 0.4), (0.6, 0, 0.2))",
  "cam = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera'))",
  "bpy.context.scene.collection.objects.link(cam)",
  "bpy.context.scene.camera = cam",
];

/** The colour each object shows in a render's answer, by name, as brightness 0 to 1. */
function brightness(said: string): Record<string, number> {
  const line =
    said.split("\n").find((l) => l.startsWith("Colours in the picture")) ?? "";
  return Object.fromEntries(
    [...line.matchAll(/(\w+) #([0-9a-f]{6})/g)].map(([, name, hex]) => {
      const [r, g, b] = [0, 2, 4].map(
        (i) => parseInt(hex!.slice(i, i + 2), 16) / 255,
      );
      return [name, 0.2126 * r! + 0.7152 * g! + 0.0722 * b!];
    }),
  );
}

describe.runIf(blender)("shaping light in a real Blender", () => {
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
  /** A tiny picture, quick to draw, with no noise measured. */
  const picture = (engine: string, extra: Record<string, unknown> = {}) =>
    done("blender_render", {
      output: `renders/${engine}.png`,
      engine,
      samples: 8,
      resolution: [64, 48],
      noise: false,
      ...extra,
    });
  const fresh = async () => {
    await done("blender_run_script", { code: table.join("\n") });
    await done("blender_set_camera", {
      location: [0, -3, 1.2],
      look_at: [0, 0, 0.2],
    });
    await done("blender_set_lighting", {
      background: { color: "#000000", strength: 0 },
    });
  };

  beforeAll(async () => {
    const root = await folders.make("zhiyin-studio-render-light-");
    const workspace = join(root, "workspace");
    await mkdir(join(workspace, "renders"), { recursive: true });
    scenes = new ConversationScenes({
      blender: async () => blender,
      directory: join(root, "data"),
      launch: containedSessionLaunch(
        { open: openProcessContainer },
        { scripts: join(root, "session-scripts") },
      ),
      script: sessionScript,
    });
    tools = sceneAutomation(scenes.scene("render-light"), {
      workspaceRoot: () => workspace,
      blender: async () => blender,
      directory: scenes.directory("render-light"),
    });
    await call("blender_open_scene", { path: "light.blend", create: true });
  });

  afterAll(async () => {
    await scenes.forget("render-light");
    await scenes.closeAll();
    await folders.removeAll();
  });

  it("lights only the objects a light is linked to, in Cycles and in EEVEE, and says who gets none", async () => {
    await fresh();
    const lit = await done("blender_set_lighting", {
      lights: [
        {
          name: "Key",
          kind: "point",
          location: [0, -1.5, 2],
          power: 300,
          lights_only: ["Mug"],
        },
      ],
    });
    const cycles = brightness(await picture("cycles"));
    const eevee = brightness(await picture("eevee"));
    const opened = await done("blender_set_lighting", {
      lights: [{ name: "Key", lights_only: [], lights_except: ["Floor"] }],
    });
    const cyclesAll = brightness(await picture("cycles"));

    expect(lit).toContain(
      "Lighting: Key (point light, 300 W) at (0, -1.5, 2 m), aimed at (0, 0, 0 mm), which lights only Mug: Floor and Box get none of its light.",
    );
    expect(lit).toContain(
      "Cycles and EEVEE both keep which objects a light lights and which cast its shadows.",
    );
    expect(opened).toContain(
      "which lights everything but Floor: Floor gets none of its light.",
    );
    // Lit by Key alone, the box it does not light is near black in both engines.
    expect(cycles["Mug"]).toBeGreaterThan(0.2);
    expect(cycles["Box"]).toBeLessThan(0.05);
    expect(eevee["Mug"]).toBeGreaterThan(0.2);
    expect(eevee["Box"]).toBeLessThan(0.05);
    expect(cyclesAll["Box"]).toBeGreaterThan(0.2);
    // Kept out of its light, the floor shows only what the boxes bounce onto it.
    expect(cyclesAll["Floor"]).toBeLessThan(cyclesAll["Box"]! / 2);
  }, 240_000);

  it("lets only the objects named cast a light's shadows, and says which rays see an object", async () => {
    await fresh();
    // A shade over the box, which the camera does not see, in the way of the light.
    await done("blender_run_script", {
      code: [
        "import bpy",
        "bpy.ops.mesh.primitive_plane_add(size=0.8, location=(0.6, 0, 1.0))",
        "bpy.context.active_object.name = 'Shade'",
      ].join("\n"),
    });
    const seen = await done("blender_set_lighting", {
      seen_by: [{ objects: ["Shade"], camera: false }],
      lights: [
        {
          name: "Top",
          kind: "point",
          location: [0.6, 0, 2],
          look_at: [0.6, 0, 0],
          power: 200,
        },
      ],
    });
    const shaded = brightness(await picture("cycles"));
    const unblocked = await done("blender_set_lighting", {
      lights: [{ name: "Top", shadows_except: ["Shade"] }],
    });
    const cycles = brightness(await picture("cycles"));
    const eevee = brightness(await picture("eevee"));

    expect(seen).toContain(
      "Shade: seen by bounced light, reflections, refraction, shadows and fog only; not by the camera.",
    );
    expect(seen).toContain(
      "EEVEE keeps only the camera and shadows of these: something it hides from the camera it neither shows in reflections nor lets light anything, which Cycles does.",
    );
    expect(unblocked).toContain(
      "which everything casts its shadows, never Shade.",
    );
    // The shade casts no shadow once it may not: the box under it is lit as if it were not there.
    expect(cycles["Box"]).toBeGreaterThan(shaded["Box"]! * 1.5);
    expect(eevee["Box"]).toBeGreaterThan(shaded["Box"]! * 1.5);
    // What the camera does not see has no colour in the picture to tell.
    const told = await picture("cycles");
    expect(told).toMatch(/\bBox #[0-9a-f]{6}/);
    expect(told).not.toMatch(/\bShade #[0-9a-f]{6}/);
  }, 240_000);

  it("makes cards the camera does not see, each seen only by its own rays, and says EEVEE leaves them out", async () => {
    await fresh();
    const carded = await done("blender_set_lighting", {
      cards: [
        {
          name: "Strip",
          kind: "reflection",
          location: [0, -1.5, 1.5],
          look_at: [0, 0, 0.2],
          size: [1, 0.25],
        },
        { name: "Bounce", kind: "bounce", location: [1.5, 0, 0.4] },
        { name: "Flag", kind: "flag", location: [-1.5, 0, 1] },
      ],
    });
    const changed = await done("blender_set_lighting", {
      cards: [{ name: "Strip", strength: 8 }],
    });
    const eevee = await picture("eevee");
    const cycles = await picture("cycles");
    // A card the camera sees too, by its own seen_by, keeps it when changed later.
    const seenCard = await done("blender_set_lighting", {
      cards: [
        {
          name: "Panel",
          kind: "reflection",
          location: [1.2, -1, 1.2],
          seen_by: { camera: true, refraction: false },
        },
      ],
    });
    await done("blender_set_lighting", {
      cards: [{ name: "Panel", strength: 2 }],
    });
    const panelRays = await done("blender_run_script", {
      code: "import bpy\np = bpy.data.objects['Panel']\nprint('rays', p.visible_camera, p.visible_glossy, p.visible_transmission)",
    });

    expect(carded).toContain(
      "card Strip (a glowing card seen only in reflections and through glass, 1 × 0.25 m, #ffffff glowing at 4) at (0, -1.5, 1.5 m), facing (0, 0, 200 mm): seen by reflections and refraction only; not by the camera, bounced light, shadows and fog",
    );
    expect(carded).toContain(
      "card Bounce (a white card that only bounces light, 1 × 1 m, #ffffff) at (1.5, 0, 0.4 m), facing (0, 0, 190 mm): seen by bounced light, reflections and refraction only; not by the camera, shadows and fog",
    );
    expect(carded).toContain(
      "card Flag (a black card that only blocks light, 1 × 1 m, #000000) at (-1.5, 0, 1 m), facing (0, 0, 190 mm): seen by bounced light, reflections, refraction and shadows only; not by the camera and fog",
    );
    expect(changed).toContain(
      "card Strip (a glowing card seen only in reflections and through glass, 1 × 0.25 m, #ffffff glowing at 8) at (0, -1.5, 1.5 m)",
    );
    expect(eevee).toContain(
      "EEVEE leaves out what its camera does not see: Strip, Bounce and Flag play their part in reflections and light only in Cycles.",
    );
    expect(cycles).not.toContain("EEVEE leaves out");
    expect(brightness(cycles)["Strip"]).toBeUndefined();
    // With no other light, the glowing strip is all the boxes reflect; the
    // white and black cards have nothing to bounce or block.
    expect(carded).toMatch(
      /Each card against a \d+×\d+ Cycles picture without it, at 16 samples: Strip is seen in [^;]*\bBox \(\+\d+%\)[^;]*; Bounce changes nothing the camera sees by 3% or more; Flag changes nothing the camera sees by 3% or more\./,
    );
    expect(carded).toMatch(/Strip is seen in [^;]*\bMug \(\+\d+%\)/);
    expect(seenCard).toContain(
      "card Panel (a glowing card seen only in reflections and through glass, 1 × 1 m, #ffffff glowing at 4) at (1.2, -1, 1.2 m), facing (0, 0, 190 mm): seen by the camera and reflections only; not by bounced light, refraction, shadows and fog",
    );
    expect(panelRays).toContain("rays True True False");
  }, 240_000);

  it("fills a box round the scene with fog, says how far one sees through it, and warns of endless fog under a sun", async () => {
    await fresh();
    await done("blender_set_lighting", {
      lights: [
        { name: "Key", kind: "spot", location: [0, -1.5, 2], power: 400 },
      ],
    });
    const boxed = await done("blender_set_lighting", {
      fog: { density: 0.1, anisotropy: 0.3 },
    });
    const foggy = await picture("cycles");
    await done("blender_set_lighting", {
      lights: [{ name: "Sun", kind: "sun", strength: 3 }],
    });
    const endless = await done("blender_set_lighting", {
      fog: { density: 0.02, world: true },
    });
    const removed = await done("blender_set_lighting", {
      fog: { density: 0 },
    });

    expect(boxed).toContain(
      "fog of density 0.1 a metre, scattering onward, so shafts show looking toward a light (anisotropy 0.3), #ffffff, in Fog, a 5 × 6.2 × 2.624 m box round the scene, its camera and its lights: 29.96 m of it lets 5% of the light through, and Floor, the farthest shape from the camera at 3.235 m, shows through 72% of it.",
    );
    expect(boxed).toMatch(
      /In a \d+×\d+ Cycles picture at 16 samples, the fog takes \d+% from its mean brightness, and the picture took [\d.]+ s against [\d.]+ s without it, [\d.]+ times as long; fog also needs more samples than a clear scene for its grain to go\. EEVEE draws it with shadows in the fog on, for shafts of light\./,
    );
    expect(foggy).not.toMatch(/Colours in the picture[^\n]*Fog #/);
    expect(endless).toContain(
      "fog of density 0.02 a metre, scattering evenly every way (anisotropy 0), #ffffff, everywhere, endless, in the world: 149.8 m of it lets 5% of the light through",
    );
    expect(endless).toContain(
      "A sun's light never gets through endless fog, in Cycles or EEVEE: Sun lights nothing now; leave world out for a box round the scene, which a sun shines into.",
    );
    expect(removed).toContain("fog removed: the world's fog.");
  }, 240_000);

  it("thins fog with height, so the camera above it sees through more, and measures how much less it adds", async () => {
    await fresh();
    await done("blender_set_lighting", {
      lights: [
        { name: "Key", kind: "point", location: [0, -1.5, 2], power: 400 },
      ],
    });
    const even = await done("blender_set_lighting", {
      fog: { density: 2 },
    });
    const thinning = await done("blender_set_lighting", {
      fog: { density: 2, height_falloff: 0.1 },
    });
    const endless = await done("blender_set_lighting", {
      fog: { density: 2, height_falloff: 0.1, world: true },
    });
    // The world's fog outlasts a new background, so it goes before the next test.
    await done("blender_set_lighting", { fog: { density: 0 } });
    /** What the fog adds to the picture's mean brightness, as a signed share in percent. */
    const lift = (said: string) => {
      const [, way, share] =
        /the fog (adds|takes) (\d+)% (?:to|from) its mean brightness/.exec(
          said,
        ) ?? [];
      return (way === "adds" ? 1 : -1) * Number(share);
    };
    const shows = (said: string) =>
      Number(
        /Floor, the farthest shape[^,]*, shows through (\d+)%/.exec(said)?.[1],
      );

    expect(thinning).toContain(
      ", thinning by half every 100 mm above the scene's lowest point, at -20 mm: 1.498 m of it at its densest lets 5% of the light through",
    );
    // Thinner where the camera looks through it, it lets more of the floor through and lights up less of the picture.
    expect(shows(thinning)).toBeGreaterThan(shows(even) + 20);
    expect(Math.abs(lift(thinning))).toBeLessThan(Math.abs(lift(even)) / 2);
    expect(endless).toContain(
      "Thinning with height, endless fog lets a sun's light through in Cycles; EEVEE draws endless fog even throughout, so there it does not thin and no sun's light gets through.",
    );
  }, 240_000);

  it("sets caustics and shadow caustics through glass, says what is missing, and that EEVEE draws none", async () => {
    await fresh();
    await done("blender_set_lighting", {
      lights: [{ name: "Lamp", kind: "point", location: [0, 0, 2] }],
    });
    await done("blender_run_script", {
      // A smooth glass ball, which focuses the lamp's light into a spot on the floor.
      code: [
        "import bpy, bmesh",
        "mug = bpy.data.objects['Mug']",
        "b = bmesh.new()",
        "bmesh.ops.create_uvsphere(b, u_segments=32, v_segments=16, radius=0.2)",
        "b.to_mesh(mug.data)",
        "b.free()",
        "for p in mug.data.polygons: p.use_smooth = True",
        "shader = mug.active_material.node_tree.nodes['Principled BSDF']",
        "shader.inputs['Transmission Weight'].default_value = 1",
        "shader.inputs['Roughness'].default_value = 0",
      ].join("\n"),
    });
    const partial = await done("blender_set_lighting", {
      caustics: { casters: ["Mug"], lights: ["Lamp"] },
    });
    const whole = await done("blender_set_lighting", {
      caustics: {
        refractive: true,
        reflective: false,
        filter_glossy: 0,
        receivers: ["Floor"],
        casters: ["Mug", "Box"],
      },
    });
    const eevee = await picture("eevee");
    const guided = await done("blender_set_lighting", {
      caustics: { path_guiding: true },
    });
    const kept = await done("blender_run_script", {
      code: "import bpy\nprint('guiding', bpy.context.scene.cycles.use_guiding)",
    });
    // The same caustics with the ball made opaque have no glass to focus light.
    await done("blender_run_script", {
      code: "import bpy\nbpy.data.objects['Mug'].active_material.node_tree.nodes['Principled BSDF'].inputs['Transmission Weight'].default_value = 0",
    });
    const opaque = await done("blender_set_lighting", {
      caustics: { refractive: true },
    });
    const unlit = await done("blender_set_lighting", {
      caustics: { reflective: false, refractive: false, casters: [] },
    });

    // Light the glass focuses onto the floor brightens part of it past a picture without caustics.
    expect(whole).toMatch(
      /Caustics in a \d+×\d+ Cycles picture at 16 samples, against one without them: Floor brighter by a tenth or more over [\d.]+% of it, up to [\d.]+ times, \+[\d.]+% over all of it \([\d.]+ of white with them, [\d.]+ without\); its noise \d+% of its brightness\. So caustic light reaches Floor\./,
    );
    expect(opaque).toMatch(
      /Floor brighter by a tenth or more over 0\.00% of it, \+0\.0% over all of it \([\d.]+ of white with them, [\d.]+ without\); its noise \d+% of its brightness\. So no caustic light was found on Floor at these samples\./,
    );
    expect(guided).toContain(
      "path guiding on: over its first 128 samples Cycles learns where light comes from and sends more paths that way, which finds caustics sooner, on the processor only: a picture drawn on a graphics card goes without it",
    );
    expect(kept).toContain("guiding True");
    // With every caustic off there is nothing to measure.
    expect(unlit).not.toContain("Caustics in a");

    expect(partial).toContain(
      "caustics, which Cycles draws and EEVEE does not: reflective and refractive on, glossy filter 1 (blurring sharp light paths, which cuts their noise; 0 keeps them sharp); shadow caustics (MNEE) need a light, a caster and a receiver, and have no receiver yet.",
    );
    expect(whole).toContain(
      "caustics, which Cycles draws and EEVEE does not: refractive on, glossy filter 0 (caustics kept sharp, and grainy); shadow caustics (MNEE) from Lamp through Mug and Box onto Floor; Box lets no light through, and MNEE draws caustics only through glass that refracts.",
    );
    expect(eevee).toContain(
      "EEVEE draws no caustics: those set through Mug and Box show only in Cycles.",
    );
  }, 240_000);

  it("shapes an area light as a square, a strip, a disk or an ellipse, and refuses a square that is not", async () => {
    await fresh();
    const strip = await done("blender_set_lighting", {
      lights: [
        {
          name: "Strip",
          kind: "area",
          location: [0, -1.5, 1],
          shape: "rectangle",
          size: [0.1, 2],
          power: 200,
        },
      ],
    });
    const oval = await done("blender_set_lighting", {
      lights: [{ name: "Strip", shape: "ellipse" }],
    });
    const disk = await done("blender_set_lighting", {
      lights: [{ name: "Strip", shape: "disk", size: [0.6, 0.6] }],
    });
    // An uneven size given to a round light makes it an ellipse.
    const stretched = await done("blender_set_lighting", {
      lights: [{ name: "Strip", size: [0.6, 0.2] }],
    });
    const refused = await call("blender_set_lighting", {
      lights: [{ name: "Strip", shape: "square", size: [1, 0.5] }],
    });
    const kept = await done("blender_run_script", {
      code: "import bpy\nd = bpy.data.objects['Strip'].data\nprint('light', d.shape, round(d.size, 3), round(d.size_y, 3))",
    });

    expect(strip).toContain(
      "Strip (area light, 200 W, 0.1 × 2 m, rectangle) at (0, -1.5, 1 m)",
    );
    expect(oval).toContain("Strip (area light, 200 W, 0.1 × 2 m, ellipse)");
    expect(disk).toContain("Strip (area light, 200 W, 600 mm across, round)");
    expect(stretched).toContain(
      "Strip (area light, 200 W, 600 × 200 mm, ellipse)",
    );
    expect(refused.failed).toBe(true);
    expect(refused.said).toContain(
      "A square light is as wide as it is high: give size [w, w], or shape rectangle for 1 × 0.5 m.",
    );
    expect(kept).toContain("light ELLIPSE 0.6 0.2");
  }, 240_000);

  it("gives a sun its width in the sky, and says how bright it lights white, as a render shows it", async () => {
    await fresh();
    const sun = await done("blender_set_lighting", {
      lights: [{ name: "Sun", kind: "sun", strength: Math.PI, angle: 5 }],
    });
    await done("blender_set_camera", { tone: "standard" });
    const floor = /Floor #([0-9a-f]{6})/.exec(await picture("cycles"))?.[1];
    const angle = await done("blender_run_script", {
      code: "import bpy, math\nprint('angle', round(math.degrees(bpy.data.objects['Sun'].data.angle), 3))",
    });

    expect(sun).toContain(
      "Sun (sun light, 3.14159 strength, 5° across the sky) at (0, 0, 3 m), aimed at (0, 0, 0 mm), lighting a white matt surface square to it to 1 of white",
    );
    expect(angle).toContain("angle 5");
    // Lit straight down to white, the grey floor shows its own colour, 0.6 as light: #cbcbcb.
    const level = parseInt(floor!.slice(0, 2), 16);
    expect(Math.abs(level - 0xcb), floor).toBeLessThanOrEqual(8);
  }, 240_000);

  it("colours a light by its colour temperature, says the colour it gives, and brightens it by its exposure", async () => {
    await fresh();
    await done("blender_set_camera", { tone: "standard" });
    await done("blender_set_lighting", {
      lights: [
        { name: "Key", kind: "point", location: [0, -1.5, 2], power: 150 },
      ],
    });
    const white = await picture("cycles");
    const warm = await done("blender_set_lighting", {
      lights: [{ name: "Key", kelvin: 3200, exposure: 1 }],
    });
    const warmed = await picture("cycles");
    const plain = await done("blender_set_lighting", {
      lights: [{ name: "Key", kelvin: 0, exposure: 0 }],
    });
    const channels = (said: string) => {
      const hex = /Box #([0-9a-f]{6})/.exec(said)?.[1] ?? "000000";
      return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
    };

    expect(warm).toContain(
      "Key (point light, 150 W at exposure +1, as 300 W, 3200 K, giving light of #ffbe7a) at (0, -1.5, 2 m)",
    );
    expect(plain).toContain("Key (point light, 150 W) at (0, -1.5, 2 m)");
    const [r0, , b0] = channels(white);
    const [r1, , b1] = channels(warmed);
    // Grey under white light, the box turns warm, its red brighter than before.
    expect(Math.abs(r0! - b0!)).toBeLessThan(6);
    expect(r1! - b1!).toBeGreaterThan(60);
    expect(r1!).toBeGreaterThan(r0! + 20);
  }, 240_000);

  it("colours a glow by its colour temperature and keeps it from being sampled as a light when asked", async () => {
    await fresh();
    await done("blender_set_camera", { tone: "standard" });
    const glowing = await done("blender_set_material", {
      objects: ["Box"],
      material: {
        name: "Lamp shade",
        color: "#202020",
        emission: { strength: 2, kelvin: 2700, lights_scene: false },
      },
    });
    const patched = await done("blender_set_material", {
      objects: ["Box"],
      material: { name: "Lamp shade", roughness: 0.4 },
    });
    const settings = await done("blender_run_script", {
      code: "import bpy\nprint('sampling', bpy.data.materials['Lamp shade'].cycles.emission_sampling)",
    });
    const shown = await picture("cycles");
    const hex = /Box #([0-9a-f]{6})/.exec(shown)?.[1] ?? "000000";
    const [r, , b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));

    expect(glowing).toMatch(
      /glowing 2700 K light of #ff[0-9a-f]{4} at 2, not sampled as a light/,
    );
    expect(glowing).toContain(
      "Cycles does not sample its glow as a light: what is round it still takes its light, by bounced rays alone and so more grainily, as suits a screen or a sign seen more than shining; EEVEE draws it the same either way.",
    );
    // Changed in another value, it keeps its colour temperature and its sampling.
    expect(patched).toMatch(
      /glowing 2700 K light of #ff[0-9a-f]{4} at 2, not sampled as a light/,
    );
    expect(patched).toContain("Lamp shade changed: roughness 0.5 to 0.4.");
    expect(settings).toContain("sampling NONE");
    expect(r! - b!).toBeGreaterThan(60);
  }, 240_000);

  it("keeps Cycles's sampling in the scene and says the samples a picture reached and what stopped it", async () => {
    await fresh();
    await done("blender_set_lighting", {
      lights: [
        { name: "Key", kind: "area", location: [0, -1.5, 2], power: 300 },
      ],
    });
    const adaptive = await picture("cycles", {
      samples: 512,
      sampling: {
        noise_threshold: 0.5,
        min_samples: 4,
        seed: 3,
        pattern: "blue_noise",
      },
    });
    const limited = await picture("cycles", {
      samples: 16384,
      resolution: [128, 96],
      sampling: { noise_threshold: 0, time_limit: 0.25 },
    });
    const kept = await done("blender_run_script", {
      code: "import bpy\nc = bpy.context.scene.cycles\nprint(c.adaptive_min_samples, c.seed, c.sampling_pattern, c.time_limit, c.use_adaptive_sampling)",
    });
    const refused = await call("blender_render", {
      output: "renders/eevee.png",
      engine: "eevee",
      sampling: { seed: 1 },
    });

    expect(adaptive).toMatch(
      /Sampling: up to 512 samples, each pixel stopping once its noise is under 0\.5, after at least 4; seed 3, the blue noise pattern: every pixel was under the noise threshold by sample (\d+) of 512, in [\d.]+ s\./,
    );
    expect(limited).toMatch(
      /Sampling: up to 16384 samples, every pixel taking them all; seed 3, the blue noise pattern, at most 0.25 s: the 0.25 s time limit stopped it at sample \d+ of 16384\./,
    );
    expect(kept).toContain("4 3 BLUE_NOISE 0.25 False");
    expect(refused.failed).toBe(true);
    expect(refused.said).toContain(
      "sampling is Cycles's: EEVEE draws a fixed number of samples, which samples sets.",
    );
  }, 240_000);

  it("denoises and clamps as asked, counts fireflies with the clamp and without, says what the denoiser smoothed and what took every sample", async () => {
    await fresh();
    // A fine checker on the floor, and a mirror-like mug a small lamp shines in.
    await done("blender_run_script", {
      code: [
        "import bpy",
        // A fresh table makes its materials while the last table's are still held, so its own may be
        // named Floor.001 and Mug.001: each object's own is taken.
        "floor = bpy.data.objects['Floor'].active_material",
        "nodes = floor.node_tree.nodes",
        "checker = nodes.new('ShaderNodeTexChecker')",
        "checker.inputs['Scale'].default_value = 120",
        "floor.node_tree.links.new(checker.outputs['Color'], nodes['Principled BSDF'].inputs['Base Color'])",
        "mug = bpy.data.objects['Mug'].active_material.node_tree.nodes['Principled BSDF']",
        "mug.inputs['Metallic'].default_value = 1",
        "mug.inputs['Roughness'].default_value = 0.05",
      ].join("\n"),
    });
    await done("blender_set_lighting", {
      lights: [
        {
          name: "Lamp",
          kind: "point",
          location: [-0.2, -0.6, 0.6],
          power: 400,
        },
      ],
    });
    const best = await picture("cycles", {
      samples: 4,
      noise: true,
      sampling: {
        noise_threshold: 0,
        denoise: "best",
        clamp: { direct: 0, indirect: 1 },
      },
    });
    const off = await picture("cycles", {
      samples: 4,
      noise: true,
      sampling: { denoise: "off", clamp: { indirect: 0 } },
    });
    const crowded = await picture("cycles", {
      samples: 8,
      sampling: { noise_threshold: 0.0001, denoise: "fast" },
    });
    const kept = await done("blender_run_script", {
      code: "import bpy\nc = bpy.context.scene.cycles\nprint(c.use_denoising, c.denoising_quality, c.denoising_prefilter, c.sample_clamp_direct, c.sample_clamp_indirect)",
    });

    expect(best).toContain(
      "It was denoised by OpenImageDenoise at high quality with an accurate prefilter from colour, albedo and normals; samples clamped, indirect light at 1.",
    );
    const counts =
      /fireflies? in the light before denoising, and in the first seed's picture (\d+) with the clamp against (\d+) without it\./.exec(
        best,
      );
    expect(counts, best).not.toBeNull();
    expect(Number(counts![2])).toBeGreaterThanOrEqual(Number(counts![1]));
    // The fine checker is what the denoiser smooths: it is named, or said kept.
    expect(best).toMatch(
      /The denoiser (smoothed away fine detail both noisy pictures share: [^.]*Floor keeps \d+% of it|kept the fine detail of the \d+ surfaces? that have it)/,
    );
    expect(off).toContain("It was not denoised; no samples clamped.");
    expect(off).toMatch(/in the light before the tone/);
    expect(off).not.toContain("The denoiser");
    expect(crowded).toMatch(
      /(\d+)% of its pixels took all 8 samples, still over the noise threshold[^;]*; more samples or a higher threshold let them finish\./,
    );
    expect(crowded).toContain(
      "It was denoised by OpenImageDenoise at fast quality with a fast prefilter",
    );
    expect(kept).toContain("True FAST FAST 0.0 0.0");
    // Each plain colour is set against the colour its material gives.
    expect(best).toMatch(
      /How far each object shows from its material's own colour, as CIEDE2000's ΔE: (Floor|Mug|Box) [\d.]+ from #[0-9a-f]{6}/,
    );
  }, 300_000);
});
