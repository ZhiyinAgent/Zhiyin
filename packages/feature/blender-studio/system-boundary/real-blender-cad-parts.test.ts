/**
 * The studio against a real Blender, on parts made in the CAD studio and on
 * the checks that see what a picture of the whole hides: a CAD part arrives
 * whole, its surfaces each in a slot of their own and kept through a new
 * shape, its shape changed only in the CAD; a shape torn or crossed by its
 * steps, and a tube that ends on nothing, are said with where; close-ups
 * show each object from two sides; a camera named for a picture is for it
 * alone. The CAD parts are written here as the CAD studio writes them.
 *
 *   $env:ZHIYIN_BLENDER = "…\blender.exe"; npx vitest run --project system-boundary packages/feature/blender-studio
 */

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CadMotionFile } from "@zhiyin/contract";
import { TemporaryFolders } from "@zhiyin/test-support";
import { openProcessContainer } from "@zhiyin/sandbox";
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

describe.runIf(blender)("a real Blender, on CAD parts and close checks", () => {
  const folders = new TemporaryFolders();
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
    root = await folders.make("zhiyin-studio-cad-parts-");
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
    await writeFile(
      join(workspace, "parts-taller.glb"),
      cadLikeGlb([
        {
          name: "Block",
          size: [0.12, 0.08, 0.05],
          at: [0, 0, 0.025],
          surfaces: { machined: ["top"], cut: ["front"] },
          // The groups drawn in another order than before.
          order: ["", "cut", "machined"],
        },
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

  it("brings a CAD part in closed, though its file draws each face apart", async () => {
    expect(await lineOf("Block")).toMatch(/12 faces, flat-shaded, closed/);
    expect(await lineOf("Cover")).toContain("closed");
  }, 60_000);

  it("shades every part of a model smooth when asked, its sharp edges kept", async () => {
    const added = await call("blender_add_objects", {
      objects: [
        {
          name: "Rounded",
          kind: "model",
          path: "parts.glb",
          location: [1, 0, 0],
          smooth: true,
        },
      ],
    });
    expect(added.isError, added.said).toBeUndefined();

    const said = await printed(
      [
        "import bpy",
        "group = bpy.data.objects['Rounded']",
        "for part in sorted(group.children_recursive, key=lambda o: o.name):",
        "    if part.type != 'MESH':",
        "        continue",
        "    smooth = all(p.use_smooth for p in part.data.polygons)",
        "    sharp = sum(1 for e in part.data.edges if e.use_edge_sharp)",
        "    print(part.name.split('.')[0], 'smooth' if smooth else 'flat', sharp, 'sharp')",
      ].join("\n"),
    );

    // A box's twelve edges are all square, so all stay sharp.
    expect(said).toContain("Block smooth 12 sharp");
    expect(said).toContain("Cover smooth 12 sharp");
  }, 60_000);

  it("gives each group of a CAD part's surfaces a slot of its own", async () => {
    const said = await printed(
      [
        "import bpy",
        "block = bpy.data.objects['Block']",
        "names = list(block.data['zhiyin_surfaces'])",
        "for index, slot in enumerate(block.material_slots):",
        "    faces = sum(1 for p in block.data.polygons if p.material_index == index)",
        "    print(names[index] or 'rest', slot.material.name if slot.material else 'none', faces)",
      ].join("\n"),
    );
    expect(said).toContain("machined machined 2");
    expect(said).toContain("cut cut 2");
    expect(said).toContain("rest none 8");
  }, 60_000);

  it("keeps the material each group of surfaces had through a new shape from the CAD", async () => {
    await printed(
      [
        "import bpy",
        "block = bpy.data.objects['Block']",
        "for name, slot in zip(block.data['zhiyin_surfaces'], block.material_slots):",
        "    slot.material = bpy.data.materials.new(f'Paint of {name or \"rest\"}')",
      ].join("\n"),
    );
    const reshaped = await call("blender_edit_objects", {
      edits: [{ object: "Engine", shapes_from: "parts-taller.glb" }],
    });
    expect(reshaped.isError, reshaped.said).toBeUndefined();
    const said = await printed(
      [
        "import bpy",
        "block = bpy.data.objects['Block']",
        "for index, (name, slot) in enumerate(zip(block.data['zhiyin_surfaces'], block.material_slots)):",
        "    faces = sum(1 for p in block.data.polygons if p.material_index == index)",
        "    print(f'{name or \"rest\"}: {slot.material.name}, {faces} faces')",
      ].join("\n"),
    );
    expect(said).toContain("rest: Paint of rest, 8 faces");
    expect(said).toContain("cut: Paint of cut, 2 faces");
    expect(said).toContain("machined: Paint of machined, 2 faces");
    expect(await lineOf("Block")).toContain("closed");
  }, 60_000);

  it("gives a material to one group of a CAD part's surfaces, and says which material each group has", async () => {
    const machined = await call("blender_set_material", {
      objects: ["Block"],
      surface: "machined",
      material: { name: "Bright steel", finish: "machined-metal" },
    });
    expect(machined.isError, machined.said).toBeUndefined();
    expect(machined.said).toContain("on the machined surfaces of Block");
    const rest = await call("blender_set_material", {
      objects: ["Block"],
      surface: "rest",
      material: { name: "Casting", finish: "cast-aluminium" },
    });
    expect(rest.isError, rest.said).toBeUndefined();

    const line = await lineOf("Block");
    expect(line).toMatch(/machined: Bright steel \(/);
    expect(line).toMatch(/cut: Paint of cut/);
    expect(line).toMatch(/rest: Casting \(/);

    const unknown = await call("blender_set_material", {
      objects: ["Block"],
      surface: "polished",
      material: { name: "Chrome", finish: "plated-steel" },
    });
    expect(unknown.isError).toBe(true);
    expect(unknown.said).toContain(
      "Block's surfaces are cut, machined and rest",
    );
    expect(await lineOf("Block")).not.toContain("Chrome");

    await call("blender_add_objects", {
      objects: [
        {
          name: "Plain box",
          kind: "cube",
          size: [0.1, 0.1, 0.1],
          location: [0, -0.4, 0.05],
        },
      ],
    });
    const plain = await call("blender_set_material", {
      objects: ["Plain box"],
      surface: "machined",
      material: { name: "Chrome", finish: "plated-steel" },
    });
    expect(plain.isError).toBe(true);
    expect(plain.said).toContain("“Plain box” has no groups of surfaces");
  }, 60_000);

  it("gives a group of surfaces a material of its own when none is named, leaving the part's other surfaces as they were", async () => {
    const whole = await call("blender_set_material", {
      objects: ["Block"],
      material: { color: "#aaaaaa" },
    });
    expect(whole.isError, whole.said).toBeUndefined();
    const cut = await call("blender_set_material", {
      objects: ["Block"],
      surface: "cut",
      material: { color: "#882222" },
    });
    expect(cut.isError, cut.said).toBeUndefined();
    expect(cut.said).toContain("Material Block cut material (#882222");

    const line = await lineOf("Block");
    expect(line).toMatch(/cut: Block cut material \(#882222/);
    expect(line).toMatch(/rest: Block material \(#aaaaaa/);
    expect(line).toMatch(/machined: Block material \(#aaaaaa/);
  }, 60_000);

  it("says which other objects and surfaces a changed material also shows on", async () => {
    await call("blender_set_material", {
      objects: ["Cover"],
      material: { name: "Shared paint", color: "#222222" },
    });
    const changed = await call("blender_set_material", {
      objects: ["Block"],
      surface: "machined",
      material: { name: "Shared paint", color: "#333333" },
    });
    expect(changed.isError, changed.said).toBeUndefined();
    expect(changed.said).toContain(
      "Shared paint also shows on Cover, which changes with it.",
    );
    expect(await lineOf("Cover")).toMatch(/material Shared paint \(#333333/);

    const alone = await call("blender_set_material", {
      objects: ["Block", "Cover"],
      material: { name: "Shared paint", color: "#444444" },
    });
    expect(alone.said).not.toContain("also shows on");
  }, 60_000);

  it("refuses to round, cut or thicken a CAD part in Blender, and says how to change it in the CAD", async () => {
    for (const operation of [
      { kind: "bevel", width: 0.003 },
      { kind: "subdivision", levels: 1 },
      { kind: "solidify", thickness: 0.002 },
    ]) {
      const refused = await call("blender_shape_objects", {
        object: "Cover",
        operations: [operation],
      });
      expect(refused.isError, operation.kind).toBe(true);
      expect(refused.said).toContain("“Cover” is a part from the CAD studio");
      expect(refused.said).toContain("blender_edit_objects shapes_from");
    }
    const bevel = await call("blender_shape_objects", {
      object: "Cover",
      operations: [{ kind: "bevel", width: 0.003 }],
    });
    expect(bevel.said).toContain("round its edges in the CAD with round_edges");
    expect(
      await printed(
        "import bpy\nprint(len(bpy.data.objects['Cover'].modifiers))",
      ),
    ).toContain("0");
  }, 60_000);

  it("says where a shape's own steps make its faces cross, and that without them it has none", async () => {
    await call("blender_add_objects", {
      objects: [
        {
          name: "Plate",
          kind: "cube",
          size: [0.1, 0.1, 0.01],
          location: [0.3, 0, 0.005],
        },
      ],
    });
    await printed(
      [
        "import bpy",
        "bevel = bpy.data.objects['Plate'].modifiers.new('Too wide', 'BEVEL')",
        "bevel.width = 0.02",
        "bevel.use_clamp_overlap = False",
      ].join("\n"),
    );
    expect(await lineOf("Plate")).toMatch(
      /its faces cross each other in \d+ places?, such as at \(.*its steps make these: without them it has none/,
    );
  }, 60_000);

  it("says where a closed shape with a gap is open, and how wide the gap is", async () => {
    await call("blender_add_objects", {
      objects: [
        {
          name: "Ball",
          kind: "sphere",
          size: [0.1, 0.1, 0.1],
          location: [0, 0.3, 0.05],
        },
      ],
    });
    await printed(
      [
        "import bpy, bmesh",
        "ball = bpy.data.objects['Ball']",
        "bm = bmesh.new()",
        "bm.from_mesh(ball.data)",
        "bm.faces.ensure_lookup_table()",
        "top = max(bm.faces, key=lambda f: f.calc_center_median().z)",
        "bmesh.ops.delete(bm, geom=[top], context='FACES_ONLY')",
        "bm.to_mesh(ball.data)",
      ].join("\n"),
    );
    expect(await lineOf("Ball")).toMatch(
      /open · 1 hole in its surface, [\d.]+ mm across at \(-?[\d.]+, 30\d(\.\d+)?, (99|100)(\.\d+)? mm\)/,
    );
  }, 60_000);

  it("names the end of a tube that meets nothing, and not the end set in what it joins", async () => {
    await call("blender_add_objects", {
      objects: [
        {
          name: "Tank",
          kind: "cube",
          size: [0.1, 0.1, 0.1],
          location: [-0.3, 0, 0.05],
        },
        {
          name: "Hose",
          kind: "tube",
          radius: 0.006,
          points: [
            [-0.3, 0, 0.08],
            [-0.3, 0, 0.16],
            [-0.15, 0, 0.2],
          ],
        },
      ],
    });
    const line = await lineOf("Hose");
    expect(line).toContain("its end at (-150, 0, 200 mm) meets nothing");
    expect(line).not.toContain("(-300, 0, 80 mm) meets");
  }, 60_000);

  it("shows objects close up from two sides, with each one's line", async () => {
    const result = await tools.callTool("blender_close_ups", {
      objects: ["Hose", "Ball"],
      tile_width: 320,
    });
    const content = (result as Result).content;
    const text = content.map((c) => c.text ?? "").join("\n");
    expect((result as Result).isError, text).toBeUndefined();
    expect(text).toContain("Close-ups of 2 objects");
    expect(text).toContain("- Hose:");
    expect(text).toContain("meets nothing");
    expect(content.some((c) => c.type === "image")).toBe(true);
  }, 120_000);

  it("renders through a camera named for one picture and keeps the scene's own", async () => {
    await call("blender_set_camera", { frame: { direction: "three-quarter" } });
    await printed(
      [
        "import bpy",
        "data = bpy.data.cameras.new('Side camera')",
        "side = bpy.data.objects.new('Side camera', data)",
        "bpy.context.scene.collection.objects.link(side)",
        "side.location = (1.2, 0, 0.2)",
        "side.rotation_euler = (1.45, 0, 1.5708)",
      ].join("\n"),
    );
    const cameraNow = async () =>
      /camera is (.+?)\./.exec(
        await printed(
          "import bpy\nprint(f'camera is {bpy.context.scene.camera.name}.')",
        ),
      )?.[1];
    const before = await cameraNow();
    expect(before).toBeTruthy();
    await writeFile(join(workspace, "shot.png"), "an older picture");
    const rendered = await call("blender_render", {
      output: "shot.png",
      engine: "eevee",
      camera: "Side camera",
      resolution: [160, 120],
    });
    expect(rendered.isError, rendered.said).toBeUndefined();
    expect(rendered.said).toContain(
      "through Side camera, the scene's own camera staying",
    );
    expect(await cameraNow()).toBe(before);
    // The older picture is replaced whole by the new one.
    const shot = await readFile(join(workspace, "shot.png"));
    expect(shot.subarray(1, 4).toString("latin1")).toBe("PNG");
    expect((await stat(join(workspace, "shot.png"))).size).toBeGreaterThan(100);
  }, 120_000);

  it("renders one part alone, framed for that picture, and leaves the scene and its camera as they were", async () => {
    const cameraNow = () =>
      printed(
        "import bpy\nc = bpy.context.scene.camera\nprint(f'camera {c.name} at {tuple(round(v, 4) for v in c.location)}')",
      );
    const hiddenNow = () =>
      printed(
        "import bpy\nprint('hidden', sorted(o.name for o in bpy.data.objects if o.hide_render))",
      );
    await call("blender_set_camera", { frame: { direction: "three-quarter" } });
    const before = await cameraNow();
    const hiddenBefore = await hiddenNow();
    const alone = await call("blender_render", {
      output: "cover-alone.png",
      engine: "eevee",
      resolution: [200, 150],
      only: ["Cover"],
      frame: { direction: "front", margin: 0.2 },
    });
    expect(alone.isError, alone.said).toBeUndefined();
    expect(alone.said).toContain("only Cover, the rest left out");
    expect(alone.said).toContain(
      "framed on Cover from the front, the scene's own camera staying where it was",
    );
    const colours =
      alone.said
        .split("\n")
        .find((l) => l.startsWith("Colours in the picture")) ?? "";
    expect(colours).toContain("Cover #");
    expect(colours).not.toContain("Block");
    expect(await cameraNow()).toBe(before);
    expect(await hiddenNow()).toBe(hiddenBefore);

    const both = await call("blender_render", {
      output: "refused.png",
      engine: "eevee",
      only: ["Cover"],
      without: ["Block"],
    });
    expect(both.isError).toBe(true);
    expect(both.said).toContain("only or without, not both");
  }, 120_000);

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

  it("keys a model's parts where the CAD placed them at each position, smoothly between, a spring stretched, and runs the cycle on", async () => {
    await writeFile(
      join(workspace, "motion.glb"),
      cadLikeGlb([
        { name: "Crank", size: [0.06, 0.008, 0.004], at: [0.03, 0, 0.01] },
        {
          name: "Spring",
          size: [0.008, 0.008, 0.02],
          at: [-0.04, -0.04, 0.0125],
        },
      ]),
    );
    // As cad_build writes it: each part's move from the first position, row by row, in mm.
    const turned = (degrees: number) => {
      const [c, s] = [
        Math.cos((degrees * Math.PI) / 180),
        Math.sin((degrees * Math.PI) / 180),
      ];
      return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    };
    const stretched = (factor: number) => [
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      factor,
      2.5 - 2.5 * factor,
      0,
      0,
      0,
      1,
    ];
    await writeFile(
      join(workspace, "motion.json"),
      JSON.stringify({
        motion: 1,
        positions: [["0"], ["90"], ["180"], ["270"]],
        parts: {
          Crank: [turned(0), turned(90), turned(180), turned(270)],
          Spring: [stretched(1), stretched(1.5), stretched(1), stretched(0.5)],
          Ghost: [turned(0), turned(10), turned(20), turned(30)],
        },
        unfitted: {},
        still: 0,
      } satisfies CadMotionFile),
    );
    const added = await call("blender_add_objects", {
      objects: [
        {
          name: "Mechanism",
          kind: "model",
          path: "motion.glb",
          location: [1, 0, 0],
        },
      ],
    });
    const animated = await call("blender_animate", {
      cad_motion: { file: "motion.json", from: 0, to: 2, cycle: true },
    });
    // Each part's middle and the spring's top and foot, from the mesh Blender draws, in mm.
    const placed = await printed(
      [
        "import bpy",
        "s = bpy.context.scene",
        "fps = s.render.fps / s.render.fps_base",
        "for t in (0, 0.25, 0.5, 2.5):",
        "    s.frame_set(round(s.frame_start + t * fps))",
        "    crank, spring = bpy.data.objects['Crank'], bpy.data.objects['Spring']",
        "    c = [crank.matrix_world @ v.co for v in crank.data.vertices]",
        "    z = [(spring.matrix_world @ v.co).z for v in spring.data.vertices]",
        "    mid = [sum(p[i] for p in c) / len(c) * 1000 for i in range(3)]",
        "    print(f'at {t} s: crank ({mid[0]:.1f}, {mid[1]:.1f}, {mid[2]:.1f}) turned {crank.rotation_euler.z * 57.29578:.0f}, spring from {min(z) * 1000:.1f} to {max(z) * 1000:.1f}')",
      ].join("\n"),
    );

    expect(added.isError, added.said).toBeUndefined();
    expect(animated.isError, animated.said).toBeUndefined();
    expect(animated.said).toContain(
      "motion.json: 2 parts keyed at every frame from 0 s to 2 s through its 4 positions, as a cycle that runs on: Crank, Spring; not in the scene, so not keyed: Ghost.",
    );
    expect(placed).toContain(
      "at 0 s: crank (1030.0, 0.0, 10.0) turned 0, spring from 2.5 to 22.5",
    );
    expect(placed).toContain("at 0.25 s: crank (1021.2, 21.2, 10.0) turned 45");
    expect(placed).toContain(
      "at 0.5 s: crank (1000.0, 30.0, 10.0) turned 90, spring from 2.5 to 32.5",
    );
    // A cycle and a quarter on: the crank has kept turning, not wound back.
    expect(placed).toContain(
      "at 2.5 s: crank (1000.0, 30.0, 10.0) turned 450, spring from 2.5 to 32.5",
    );
  }, 180_000);

  it("keys an assembly sequence straight: each part waits where it is until its turn, then goes straight in", async () => {
    await writeFile(
      join(workspace, "sequence.glb"),
      cadLikeGlb([
        { name: "Lid", size: [0.06, 0.04, 0.01], at: [0, 0, 0.015] },
        { name: "Bolt", size: [0.006, 0.006, 0.034], at: [0, 0, 0.01] },
      ]),
    );
    // As cad_build writes it with explode: all out, then the lid in, then the bolt, in mm from as built.
    const up = (z: number) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, z, 0, 0, 0, 1];
    await writeFile(
      join(workspace, "sequence.json"),
      JSON.stringify({
        motion: 1,
        positions: [["all out"], ["Lid in"], ["Bolt in"]],
        parts: { Lid: [up(5), up(0), up(0)], Bolt: [up(44), up(44), up(0)] },
        unfitted: {},
        still: 1,
        straight: true,
      } satisfies CadMotionFile),
    );
    const added = await call("blender_add_objects", {
      objects: [{ name: "Bolted", kind: "model", path: "sequence.glb" }],
    });
    const animated = await call("blender_animate", {
      cad_motion: { file: "sequence.json", from: 0, to: 2 },
    });
    const heights = await printed(
      [
        "import bpy",
        "s = bpy.context.scene",
        "fps = s.render.fps / s.render.fps_base",
        "for t in (0, 0.5, 1, 1.5, 2):",
        "    s.frame_set(round(s.frame_start + t * fps))",
        "    middle = lambda o: sum((o.matrix_world @ v.co).z for v in o.data.vertices) / len(o.data.vertices) * 1000",
        "    print(f\"at {t} s: lid {middle(bpy.data.objects['Lid']):.2f}, bolt {middle(bpy.data.objects['Bolt']):.2f}\")",
      ].join("\n"),
    );

    expect(added.isError, added.said).toBeUndefined();
    expect(animated.isError, animated.said).toBeUndefined();
    expect(animated.said).toContain(
      "the parts go in this order, one step to each position: 0 s to 1 s: Lid 5 mm; 1 s to 2 s: Bolt 44 mm",
    );
    // Built at 15 and 10 mm up; the bolt waits 44 mm up while the lid goes in.
    expect(heights).toContain("at 0 s: lid 20.00, bolt 54.00");
    expect(heights).toContain("at 0.5 s: lid 17.50, bolt 54.00");
    expect(heights).toContain("at 1 s: lid 15.00, bolt 54.00");
    expect(heights).toContain("at 1.5 s: lid 15.00, bolt 32.00");
    expect(heights).toContain("at 2 s: lid 15.00, bolt 10.00");
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

  it("plays a cycle whose length is not whole frames at exactly its period, every frame step even", async () => {
    // One turn round z in 1.7 s at 24 frames a second: 40.8 frames a loop.
    await writeFile(
      join(workspace, "rotor.glb"),
      cadLikeGlb([
        { name: "Rotor", size: [0.04, 0.006, 0.004], at: [0.02, 0, 0] },
      ]),
    );
    const turned = (degrees: number) => {
      const [c, s] = [
        Math.cos((degrees * Math.PI) / 180),
        Math.sin((degrees * Math.PI) / 180),
      ];
      return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    };
    await writeFile(
      join(workspace, "rotor.json"),
      JSON.stringify({
        motion: 1,
        positions: [["0"], ["90"], ["180"], ["270"]],
        parts: { Rotor: [turned(0), turned(90), turned(180), turned(270)] },
        unfitted: {},
        still: 0,
      } satisfies CadMotionFile),
    );
    const added = await call("blender_add_objects", {
      objects: [
        {
          name: "Rotor model",
          kind: "model",
          path: "rotor.glb",
          location: [4, 0, 0],
        },
      ],
    });
    const animated = await call("blender_animate", {
      fps: 24,
      cad_motion: { file: "rotor.json", from: 0, to: 1.7, cycle: true },
    });
    const angles = await printed(
      [
        "import bpy, math",
        "s = bpy.context.scene",
        "rotor = bpy.data.objects['Rotor']",
        "def angle(t):",
        "    f = s.frame_start + t * 24",
        "    s.frame_set(math.floor(f), subframe=f - math.floor(f))",
        "    return math.degrees(rotor.rotation_euler.z)",
        "for t in (0.5, 2.2, 17.5, 170.5):",
        "    print(f'at {t} s: {angle(t):.2f} against {360 * t / 1.7:.2f}')",
        "steps = []",
        "for f in range(s.frame_start + 36, s.frame_start + 46):",
        "    s.frame_set(f)",
        "    a = math.degrees(rotor.rotation_euler.z)",
        "    s.frame_set(f + 1)",
        "    steps.append(math.degrees(rotor.rotation_euler.z) - a)",
        "print(f'steps from {min(steps):.3f} to {max(steps):.3f}')",
        "s.frame_set(s.frame_start)",
      ].join("\n"),
    );

    expect(added.isError, added.said).toBeUndefined();
    expect(animated.isError, animated.said).toBeUndefined();
    for (const [t, expected] of [
      [0.5, 105.88],
      [2.2, 465.88],
      [17.5, 3705.88],
      [170.5, 36105.88],
    ] as const) {
      const at = new RegExp(`at ${t} s: (-?[\\d.]+) against`).exec(angles);
      expect(Number(at?.[1]), angles).toBeCloseTo(expected, 1);
    }
    // 360° in 40.8 frames is 8.824° a frame, across the loop's end as within it.
    expect(angles).toContain("steps from 8.824 to 8.824");
  }, 180_000);

  it("keys no CAD part attached, through another, to what moves by keys of its own, and places one attached through a fixed object to a part it keys", async () => {
    await writeFile(
      join(workspace, "chain.glb"),
      cadLikeGlb([
        { name: "Bracket", size: [0.02, 0.02, 0.02], at: [0, 0, 0.01] },
        { name: "Clip", size: [0.01, 0.01, 0.01], at: [0, 0.03, 0.01] },
        { name: "Base", size: [0.04, 0.04, 0.004], at: [0, -0.05, 0.002] },
        { name: "Lift", size: [0.02, 0.02, 0.02], at: [0.1, 0, 0.01] },
        { name: "Cap", size: [0.01, 0.01, 0.01], at: [0.1, 0, 0.04] },
      ]),
    );
    const still = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const up = (mm: number) => [
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      1,
      mm,
      0,
      0,
      0,
      1,
    ];
    const motion = (parts: Record<string, number[][]>) =>
      JSON.stringify({
        motion: 1,
        positions: [["low"], ["high"]],
        parts,
        unfitted: {},
        still: 0,
      } satisfies CadMotionFile);
    await writeFile(
      join(workspace, "held.json"),
      motion({
        Bracket: [still, still],
        Clip: [still, still],
        Base: [still, up(5)],
      }),
    );
    await writeFile(
      join(workspace, "clip-only.json"),
      motion({ Clip: [still, still], Base: [still, up(5)] }),
    );
    await writeFile(
      join(workspace, "lifted.json"),
      motion({ Lift: [still, up(20)], Cap: [still, still] }),
    );
    const added = await call("blender_add_objects", {
      objects: [
        {
          name: "Linkage",
          kind: "model",
          path: "chain.glb",
          location: [5, 0, 0],
        },
      ],
    });
    // A holder the model keyed itself slides 1 m along x, carrying the
    // bracket, which carries the clip; a spacer outside any motion file
    // sits between the lift and its cap.
    const built = await printed(
      [
        "import bpy",
        "s = bpy.context.scene",
        "model = bpy.data.objects['Linkage']",
        "def attach(child, parent):",
        "    world = child.matrix_world.copy()",
        "    child.parent = parent",
        "    child.matrix_world = world",
        "slider = bpy.data.objects.new('Slider', None)",
        "s.collection.objects.link(slider)",
        "slider.parent = model",
        "slider.location = (0, 0, 0)",
        "bpy.context.view_layer.update()",
        "attach(bpy.data.objects['Bracket'], slider)",
        "attach(bpy.data.objects['Clip'], bpy.data.objects['Bracket'])",
        "slider.keyframe_insert('location', frame=s.frame_start)",
        "slider.location.x = 1",
        "slider.keyframe_insert('location', frame=s.frame_start + 24)",
        "slider.location.x = 0",
        "spacer = bpy.data.objects.new('Spacer', None)",
        "s.collection.objects.link(spacer)",
        "spacer.parent = model",
        "spacer.location = (0.1, 0, 0.03)",
        "bpy.context.view_layer.update()",
        "attach(spacer, bpy.data.objects['Lift'])",
        "attach(bpy.data.objects['Cap'], spacer)",
        "print('built')",
      ].join("\n"),
    );
    const held = await call("blender_animate", {
      cad_motion: { file: "held.json", from: 0, to: 1 },
    });
    const clipOnly = await call("blender_animate", {
      cad_motion: { file: "clip-only.json", from: 0, to: 1 },
    });
    const lifted = await call("blender_animate", {
      cad_motion: { file: "lifted.json", from: 0, to: 1 },
    });
    // Each part's middle, from the mesh Blender draws, in mm.
    const middles = await printed(
      [
        "import bpy",
        "s = bpy.context.scene",
        "fps = s.render.fps / s.render.fps_base",
        "for t in (0, 1):",
        "    s.frame_set(round(s.frame_start + t * fps))",
        "    for name in ('Lift', 'Cap'):",
        "        o = bpy.data.objects[name]",
        "        c = [o.matrix_world @ v.co for v in o.data.vertices]",
        "        mid = [sum(p[i] for p in c) / len(c) * 1000 for i in range(3)]",
        "        print(f'at {t} s: {name} ({mid[0]:.1f}, {mid[1]:.1f}, {mid[2]:.1f})')",
        "s.frame_set(s.frame_start)",
      ].join("\n"),
    );

    expect(added.isError, added.said).toBeUndefined();
    expect(built).toContain("built");
    expect(held.isError, held.said).toBeUndefined();
    expect(held.said).toContain(
      "not keyed: Bracket, attached to Slider, which moves by keys of its own; Clip, attached through Bracket to Slider, which moves by keys of its own",
    );
    expect(held.said).toContain(
      "1 part keyed at every frame from 0 s to 1 s through its 2 positions: Base",
    );
    expect(clipOnly.isError, clipOnly.said).toBeUndefined();
    expect(clipOnly.said).toContain(
      "not keyed: Clip, attached through Bracket to Slider, which moves by keys of its own",
    );
    expect(lifted.isError, lifted.said).toBeUndefined();
    expect(lifted.said).toContain(
      "2 parts keyed at every frame from 0 s to 1 s through its 2 positions: Lift, Cap",
    );
    // The lift rises 20 mm; the cap, held still by the CAD, stays where it was built.
    expect(middles).toContain("at 0 s: Lift (5100.0, 0.0, 10.0)");
    expect(middles).toContain("at 1 s: Lift (5100.0, 0.0, 30.0)");
    expect(middles).toContain("at 0 s: Cap (5100.0, 0.0, 40.0)");
    expect(middles).toContain("at 1 s: Cap (5100.0, 0.0, 40.0)");
  }, 180_000);

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

  it("finds nothing inside a model whose parts touch face to face, below where they touch", async () => {
    // Two plates stacked face on face, and a post that reaches down past a
    // block under them: the block lies within the model's box, in none of
    // its parts. Far from the other objects, so they cross nothing here.
    await writeFile(
      join(workspace, "stack.glb"),
      cadLikeGlb([
        { name: "Lower plate", size: [2, 2, 0.1], at: [5, 0, 0.05] },
        { name: "Upper plate", size: [2, 2, 0.1], at: [5, 0, 0.15] },
        { name: "Post", size: [0.05, 0.05, 0.6], at: [5.9, 0.9, -0.2] },
      ]),
    );
    const added = await call("blender_add_objects", {
      objects: [
        {
          name: "Stack",
          kind: "model",
          path: "stack.glb",
          location: [0, 0, 0],
        },
        {
          name: "Under block",
          kind: "cube",
          size: [0.05, 0.05, 0.05],
          location: [4.8, -0.3, -0.1],
        },
        {
          name: "Sunk pin",
          kind: "cube",
          size: [0.04, 0.04, 0.04],
          location: [5.3, 0.3, 0.15],
        },
      ],
    });
    expect(added.isError, added.said).toBeUndefined();
    expect(await lineOf("Under block")).not.toContain("into");
    expect(await lineOf("Sunk pin")).toMatch(
      /goes [\d.]+ mm into (Stack|Upper plate)/,
    );
  }, 120_000);
});
