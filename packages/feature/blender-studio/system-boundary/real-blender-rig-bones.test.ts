/**
 * Bones and ready rigs against a real Blender: bones made by name and said
 * with their lengths, chains and the mesh they lie in; one side mirrored to
 * the other; bones extruded, subdivided, copied, renamed, removed and
 * gathered into collections; and Rigify's metarigs fitted to a person, a
 * four-legged animal and a bird by the sections of their bodies, each joint
 * said with what it was fitted to, and their rigs generated.
 *
 *   $env:ZHIYIN_BLENDER = "…\blender.exe"; npx vitest run --project system-boundary packages/feature/blender-studio/system-boundary/real-blender-rig-bones.test.ts
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

/**
 * A body of round tubes, each through points with a radius at each, joined
 * into one mesh: where a radius is smaller than its neighbours the body
 * narrows there, as a knee, an ankle, a wrist or a neck does.
 */
const tubesBody = (name: string, tubes: string, boxes = "[]") =>
  [
    "import bpy, bmesh, math",
    "from mathutils import Vector",
    "bm = bmesh.new()",
    "def tube(points, radii, segments=16):",
    "    rings = []",
    "    for k, (p, r) in enumerate(zip(points, radii)):",
    "        d = (Vector(points[min(k + 1, len(points) - 1)]) - Vector(points[max(k - 1, 0)])).normalized()",
    "        a = d.orthogonal().normalized()",
    "        b = d.cross(a)",
    "        rings.append([bm.verts.new(Vector(p) + (a * math.cos(2 * math.pi * i / segments) + b * math.sin(2 * math.pi * i / segments)) * r) for i in range(segments)])",
    "    for r0, r1 in zip(rings, rings[1:]):",
    "        for i in range(segments):",
    "            bm.faces.new((r0[i], r0[(i + 1) % segments], r1[(i + 1) % segments], r1[i]))",
    "    bm.faces.new(list(reversed(rings[0])))",
    "    bm.faces.new(rings[-1])",
    "def box(low, high):",
    "    made = bmesh.ops.create_cube(bm, size=1)['verts']",
    "    for v in made:",
    "        v.co = Vector([low[i] if v.co[i] < 0 else high[i] for i in range(3)])",
    `for points, radii in ${tubes}:`,
    "    tube(points, radii)",
    `for low, high in ${boxes}:`,
    "    box(low, high)",
    "bmesh.ops.recalc_face_normals(bm, faces=bm.faces)",
    `mesh = bpy.data.meshes.new(${JSON.stringify(name)})`,
    "bm.to_mesh(mesh)",
    `bpy.context.scene.collection.objects.link(bpy.data.objects.new(${JSON.stringify(name)}, mesh))`,
  ].join("\n");

/**
 * A person 1.8 m tall facing -y, arms out level: legs narrowing at the
 * ankles (80 mm up) and the knees (480 mm up) on feet that reach 170 mm
 * forward, a body from the crotch (800 mm up) to the shoulders, arms at
 * 1.42 m narrowing at the wrists (660 mm out) but nowhere at the elbows,
 * and a neck narrowest 1.56 m up under a head whose top is at 1.8 m.
 */
const person = tubesBody(
  "Body",
  `[
    *[([(s * 0.1, 0, z) for z in (0.02, 0.08, 0.18, 0.30, 0.40, 0.48, 0.56, 0.70, 0.86)], (0.045, 0.035, 0.05, 0.055, 0.05, 0.042, 0.06, 0.075, 0.085)) for s in (1, -1)],
    ([(0, 0, z) for z in (0.80, 0.95, 1.10, 1.25, 1.40, 1.50)], (0.17, 0.16, 0.14, 0.16, 0.18, 0.12)),
    *[([(s * x, 0, 1.42) for x in (0.12, 0.2, 0.35, 0.5, 0.6, 0.66, 0.74, 0.85)], (0.06, 0.055, 0.047, 0.04, 0.036, 0.026, 0.035, 0.012)) for s in (1, -1)],
    ([(0, 0, z) for z in (1.48, 1.52, 1.56, 1.60, 1.64)], (0.07, 0.06, 0.05, 0.06, 0.08)),
    ([(0, 0, z) for z in (1.62, 1.66, 1.72, 1.77, 1.80)], (0.08, 0.1, 0.1, 0.07, 0.01)),
  ]`,
  `[((s * 0.1 - 0.04, -0.17, 0), (s * 0.1 + 0.04, 0.05, 0.06)) for s in (1, -1)]`,
);

/**
 * A dog 0.6 m tall facing -y: four legs 160 mm apart across, the front pair
 * 220 mm before the middle and the hind pair 250 mm behind it, each
 * narrowing 100 mm up; a body 450 mm up, a neck rising forward to a head
 * whose nose is 610 mm before the middle, and a tail out behind.
 */
const dog = tubesBody(
  "Dog",
  `[
    *[([(sx * 0.08, y, z) for z in (0.0, 0.05, 0.10, 0.18, 0.28, 0.42)], (0.03, 0.028, 0.02, 0.03, 0.035, 0.04)) for sx in (1, -1) for y in (-0.22, 0.25)],
    ([(0, y, 0.45) for y in (-0.32, -0.2, 0.0, 0.2, 0.36)], (0.09, 0.12, 0.12, 0.12, 0.09)),
    ([(0, -0.3, 0.5), (0, -0.37, 0.57), (0, -0.42, 0.62)], (0.06, 0.05, 0.06)),
    ([(0, -0.40, 0.64), (0, -0.48, 0.64), (0, -0.56, 0.62), (0, -0.60, 0.61)], (0.07, 0.07, 0.04, 0.01)),
    ([(0, 0.34, 0.5), (0, 0.45, 0.53), (0, 0.6, 0.55)], (0.025, 0.02, 0.008)),
  ]`,
);

/**
 * A bird 200 mm tall facing -y: two legs 60 mm apart, a body 120 mm up,
 * wings out level to 280 mm either side, narrowing 140 mm out, a neck
 * rising forward to a beak 175 mm before the middle, and a tail behind.
 */
const bird = tubesBody(
  "Bird",
  `[
    *[([(s * 0.03, 0.0, z) for z in (0.0, 0.03, 0.06, 0.09)], (0.006, 0.005, 0.007, 0.01)) for s in (1, -1)],
    ([(0, y, 0.12) for y in (0.1, 0.05, 0.0, -0.05, -0.08)], (0.03, 0.05, 0.055, 0.05, 0.035)),
    *[([(s * x, 0.0, 0.13) for x in (0.02, 0.06, 0.10, 0.14, 0.18, 0.24, 0.28)], (0.02, 0.016, 0.012, 0.006, 0.012, 0.01, 0.003)) for s in (1, -1)],
    ([(0, -0.07, 0.13), (0, -0.09, 0.16), (0, -0.11, 0.19)], (0.025, 0.018, 0.022)),
    ([(0, -0.10, 0.19), (0, -0.13, 0.195), (0, -0.16, 0.19), (0, -0.175, 0.188)], (0.025, 0.022, 0.008, 0.002)),
    ([(0, 0.09, 0.12), (0, 0.15, 0.12), (0, 0.2, 0.12)], (0.02, 0.012, 0.004)),
  ]`,
);

const near = (said: string, start: string) => {
  const line = said.split("\n").find((l) => l.startsWith(start));
  expect(line, `no line starting “${start}” in:\n${said}`).toBeDefined();
  const point = /at \(([-\d.]+), ([-\d.]+), ([-\d.]+) (mm|m)\)/.exec(line!);
  expect(point, line).not.toBeNull();
  const unit = point![4] === "mm" ? 0.001 : 1;
  return {
    line: line!,
    at: [1, 2, 3].map((i) => Number(point![i]) * unit),
  };
};

const within = (found: number[], expected: number[], metres: number) =>
  found.every((v, i) => Math.abs(v - expected[i]!) <= metres);

describe.runIf(blender)("bones and ready rigs in a real Blender", () => {
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
  const script = async (code: string) => {
    const ran = await call("blender_run_script", { code });
    expect(ran.failed, ran.said).toBe(false);
    return ran.said;
  };
  const fresh = () =>
    script(
      "import bpy\nfor o in list(bpy.data.objects): bpy.data.objects.remove(o)\nfor a in list(bpy.data.armatures): bpy.data.armatures.remove(a)",
    );

  beforeAll(async () => {
    const root = await folders.make("zhiyin-studio-rig-bones-");
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
    tools = sceneAutomation(scenes.scene("rig-bones"), {
      workspaceRoot: () => workspace,
      blender: async () => blender,
      directory: scenes.directory("rig-bones"),
    });
    await call("blender_open_scene", { path: "rig.blend", create: true });
  });

  afterAll(async () => {
    await scenes.forget("rig-bones");
    await scenes.closeAll();
    await folders.removeAll();
  });

  it("makes bones by name and says each one's length, ends, parent, chain and the mesh it lies in", async () => {
    await fresh();
    const added = await call("blender_add_objects", {
      objects: [
        {
          name: "Arm",
          kind: "cylinder",
          size: [0.1, 0.1, 0.8],
          location: [0.5, 0, 1.4],
          rotation: [0, 90, 0],
        },
      ],
    });
    expect(added.failed, added.said).toBe(false);

    const made = await call("blender_rig", {
      armature: "Arm rig",
      bones: [
        { name: "upper_arm.L", head: [0.15, 0, 1.4], tail: [0.5, 0, 1.4] },
        {
          name: "forearm.L",
          parent: "upper_arm.L",
          connected: true,
          tail: [0.85, 0, 1.4],
        },
        {
          name: "hand.L",
          parent: "forearm.L",
          connected: true,
          tail: [0.93, 0, 1.4],
          deform: false,
        },
      ],
    });

    expect(made.failed, made.said).toBe(false);
    expect(made.said.split("\n")).toEqual(
      expect.arrayContaining([
        "Made armature Arm rig at (0, 0, 0 mm): 3 bones, 2 deforming.",
        "upper_arm.L: 350 mm long from (0.15, 0, 1.4 m) to (0.5, 0, 1.4 m), roll 0°, a root, deforms; lies in Arm.",
        "forearm.L: 350 mm long from (0.5, 0, 1.4 m) to (0.85, 0, 1.4 m), roll 0°, connected to upper_arm.L, deforms; lies in Arm.",
        "hand.L: 80 mm long from (0.85, 0, 1.4 m) to (0.93, 0, 1.4 m), roll 0°, connected to forearm.L, does not deform; lies in Arm, its tail 30 mm outside.",
        "Chain from the root: upper_arm.L → forearm.L → hand.L, 780 mm.",
        "Named for one side with no bone on the other: upper_arm.L, forearm.L, hand.L.",
      ]),
    );
  });

  it("mirrors the left side onto the right and says the pairs it makes", async () => {
    const mirrored = await call("blender_rig", {
      armature: "Arm rig",
      symmetrize: "L",
    });

    expect(mirrored.failed, mirrored.said).toBe(false);
    expect(mirrored.said.split("\n")).toEqual(
      expect.arrayContaining([
        "On Arm rig: mirrored 3 bones to upper_arm.R, forearm.R, hand.R.",
        "Changed armature Arm rig at (0, 0, 0 mm): 6 bones, 4 deforming.",
        "upper_arm.R: 350 mm long from (-0.15, 0, 1.4 m) to (-0.5, 0, 1.4 m), roll 0°, a root, deforms; lies in no mesh, its middle 425 mm from Arm.",
        "hand.R: 80 mm long from (-0.85, 0, 1.4 m) to (-0.93, 0, 1.4 m), roll 0°, connected to forearm.R, does not deform; lies in no mesh, its middle 990 mm from Arm.",
        "Chain from the root: upper_arm.R → forearm.R → hand.R, 780 mm.",
        "Symmetry across the armature's x = 0: 3 pairs (upper_arm.L/upper_arm.R, forearm.L/forearm.R, hand.L/hand.R), 3 mirroring within 0.1 mm.",
      ]),
    );
  });

  it("extrudes, subdivides, copies, removes and renames bones in order, and gathers them into collections", async () => {
    await fresh();
    const edited = await call("blender_rig", {
      armature: "Tail rig",
      bones: [{ name: "tail", head: [0, 0, 0.5], tail: [0, 0.4, 0.5] }],
      bone_edits: [
        { bone: "tail", kind: "subdivide", count: 4 },
        {
          bone: "tail.003",
          kind: "extrude",
          to: [0, 0.5, 0.55],
          name: "tail_tip",
        },
        {
          bone: "tail",
          kind: "duplicate",
          offset: [0.2, 0, 0],
          replace: ["tail", "fin"],
        },
        { bone: "fin.003", kind: "remove" },
        { bone: "fin_tip", kind: "rename", name: "fin_end" },
      ],
      collections: [
        {
          name: "Tail",
          bones: ["tail", "tail.001", "tail.002", "tail.003", "tail_tip"],
        },
        { name: "Fin", bones: ["fin"], visible: false },
      ],
    });

    expect(edited.failed, edited.said).toBe(false);
    expect(edited.said.split("\n")).toEqual(
      expect.arrayContaining([
        "On Tail rig: subdivided tail into tail, tail.001, tail.002, tail.003; extruded tail_tip from tail.003's tail; copied tail and the bones below it as fin, fin.001, fin.002, fin.003, fin_tip; removed fin.003, its children now under fin.002; renamed fin_tip to fin_end.",
        "Made armature Tail rig at (0, 0, 0 mm): 9 bones, 9 deforming.",
        "tail: 100 mm long from (0, 0, 500 mm) to (0, 100, 500 mm), roll 0°, a root, deforms, in Tail; the scene has no closed mesh for it to lie in.",
        "tail_tip: 111.8 mm long from (0, 400, 500 mm) to (0, 500, 550 mm), roll 0°, connected to tail.003, deforms, in Tail; the scene has no closed mesh for it to lie in.",
        "fin_end: 111.8 mm long from (200, 400, 500 mm) to (200, 500, 550 mm), roll 0°, child of fin.002, 100 mm from its tail, deforms; the scene has no closed mesh for it to lie in.",
        "Chain from the root: tail → tail.001 → tail.002 → tail.003 → tail_tip, 511.8 mm.",
        "Chain from the root: fin → fin.001 → fin.002 → fin_end, 411.8 mm, not connected at fin_end.",
        "Bone collections: Tail (5 bones), Fin (1 bone, hidden).",
      ]),
    );
  });

  it("refuses bones without an armature, an edit of a bone that is not there, an extrusion with nowhere to go and a split into one", async () => {
    const homeless = await call("blender_rig", {
      bones: [{ name: "a", head: [0, 0, 0], tail: [0, 0, 1] }],
    });
    const missing = await call("blender_rig", {
      armature: "Tail rig",
      bone_edits: [{ bone: "nope", kind: "remove" }],
    });
    const nowhere = await call("blender_rig", {
      armature: "Tail rig",
      bone_edits: [{ bone: "tail", kind: "extrude" }],
    });
    const unsplit = await call("blender_rig", {
      armature: "Tail rig",
      bone_edits: [{ bone: "tail", kind: "subdivide", count: 1 }],
    });

    expect(homeless.failed).toBe(true);
    expect(homeless.said).toContain("This call is missing armature.");
    expect(missing.failed).toBe(true);
    expect(missing.said).toContain(
      "Tail rig has no bone named “nope”. It has: tail, tail.001, tail.002, tail.003, tail_tip, fin, fin.001, fin.002, fin_end.",
    );
    expect(nowhere.failed).toBe(true);
    expect(nowhere.said).toContain("This call is missing bone_edits[0].to.");
    expect(unsplit.failed).toBe(true);
    expect(unsplit.said).toContain("bone_edits[0].count must be at least 2.");
  });

  it("fits Rigify's basic human to a person by the narrowings of the body, says each joint, and generates its rig", async () => {
    await fresh();
    await script(person);

    const fitted = await call("blender_rig", {
      from: { kind: "basic_human", fit_to: "Body" },
    });

    expect(fitted.failed, fitted.said).toBe(false);
    const said = fitted.said;
    expect(said).toContain(
      "Fitted Rigify's basic_human metarig to Body (1.8 m tall, its front toward -y) as Body metarig. Its joints, to confirm with blender_look:",
    );
    const knee = near(said, "- knee of the left leg (shin.L's head) at (");
    expect(knee.line).toMatch(
      /: the narrowest section of the left leg there, \d+(\.\d+)? mm across; moved \d+(\.\d+)? mm the way the metarig's knee bends, as Rigify needs a bend to know it\.$/,
    );
    // The leg is straight, so the knee is moved forward (to -y) by 3% of the
    // hip-to-ankle length, the way the metarig's knee bends.
    expect(within(knee.at, [0.1, -0.025, 0.48], 0.012), knee.line).toBe(true);
    const ankle = near(said, "- ankle of the right leg (foot.R's head) at (");
    expect(ankle.line).toMatch(/the narrowest section of the right leg there/);
    expect(within(ankle.at, [-0.1, 0, 0.08], 0.012), ankle.line).toBe(true);
    const toe = near(
      said,
      "- tip of the left leg (past toe.L, its farthest point) at (",
    );
    expect(toe.line).toMatch(
      /: the front of the left leg's foot at the ground\.$/,
    );
    expect(within(toe.at, [0.1, -0.17, 0.0155], 0.012), toe.line).toBe(true);
    const hip = near(said, "- hip of the left leg (thigh.L's head) at (");
    expect(hip.line).toMatch(
      /: 6% of the height above the crotch, which is \d+(\.\d+)? mm up, over the middle of the left leg's top section\.$/,
    );
    expect(within(hip.at, [0.1, 0, 0.9], 0.02), hip.line).toBe(true);
    const wrist = near(said, "- wrist of the left arm (hand.L's head) at (");
    expect(wrist.line).toMatch(/the narrowest section of the left arm there/);
    expect(within(wrist.at, [0.66, 0, 1.42], 0.015), wrist.line).toBe(true);
    const elbow = near(
      said,
      "- elbow of the right arm (forearm.R's head) at (",
    );
    expect(elbow.line).toMatch(
      /: by proportion, \d+% of the way from the shoulder to the tip as the metarig has it: no narrowing there; moved \d+(\.\d+)? mm the way the metarig's elbow bends, as Rigify needs a bend to know it\.$/,
    );
    const shoulder = near(
      said,
      "- shoulder of the left arm (upper_arm.L's head) at (",
    );
    expect(shoulder.line).toMatch(
      /: where the left arm leaves the chest, on its middle line\.$/,
    );
    expect(within(shoulder.at, [0.18, 0, 1.42], 0.03), shoulder.line).toBe(
      true,
    );
    const neck = near(said, "- neck (spine.005's head) at (");
    expect(neck.line).toMatch(
      /: the narrowest section between the shoulders and the top of the head, \d+(\.\d+)? mm across\.$/,
    );
    expect(within(neck.at, [0, 0, 1.56], 0.012), neck.line).toBe(true);
    const top = near(said, "- head top (spine.006's tail) at (");
    expect(top.line).toMatch(/: the body's highest point\.$/);
    expect(within(top.at, [0, 0, 1.8], 0.002), top.line).toBe(true);
    expect(said).toContain(
      "Not found on the body, so placed by the metarig's proportions: elbow of the left arm; elbow of the right arm.",
    );
    expect(said).toMatch(
      /Generated Body rig from Body metarig: \d+ bones, \d+ of them deforming \(the DEF- bones\), in \d+ bone collections; its zhiyin_rig_of is Body\. Body metarig is hidden: move its bones with bones and armature Body metarig, and the rig is generated again\./,
    );

    const scene = await script(
      [
        "import bpy",
        "rig = bpy.data.objects['Body rig']",
        "meta = bpy.data.objects['Body metarig']",
        "print('rig of', rig['zhiyin_rig_of'], 'hidden metarig', meta.hide_get())",
        "print('widgets in the scene', sum(1 for o in bpy.context.scene.objects if o.name.startswith('WGT')))",
        "print('custom shapes', sum(1 for b in rig.pose.bones if b.custom_shape is not None) > 0)",
        "h = rig.matrix_world @ rig.data.bones['DEF-shin.L'].head_local",
        "print('DEF-shin.L head', tuple(round(v, 3) for v in h))",
      ].join("\n"),
    );
    expect(scene).toContain("rig of Body hidden metarig True");
    expect(scene).toContain("widgets in the scene 0");
    expect(scene).toContain("custom shapes True");
    const shin = /DEF-shin\.L head \(([-\d.]+), ([-\d.]+), ([-\d.]+)\)/.exec(
      scene,
    );
    expect(within(shin!.slice(1).map(Number), knee.at, 0.002), scene).toBe(
      true,
    );
  });

  it("generates the rig again when a metarig joint is moved, and refuses changing the generated rig itself", async () => {
    const moved = await call("blender_rig", {
      armature: "Body metarig",
      bones: [{ name: "shin.L", head: [0.1, -0.01, 0.5] }],
    });
    const direct = await call("blender_rig", {
      armature: "Body rig",
      bones: [{ name: "DEF-shin.L", head: [0.1, 0, 0.5] }],
    });

    expect(moved.failed, moved.said).toBe(false);
    expect(moved.said).toMatch(
      /^Generated again Body rig from Body metarig: /m,
    );
    expect(moved.said).toMatch(
      /^shin\.L: [\d.]+ mm long from \(100, -10, 500 mm\) to \(/m,
    );
    const scene = await script(
      [
        "import bpy",
        "rig = bpy.data.objects['Body rig']",
        "h = rig.matrix_world @ rig.data.bones['DEF-shin.L'].head_local",
        "print('DEF-shin.L head', tuple(round(v, 3) for v in h))",
      ].join("\n"),
    );
    expect(scene).toContain("DEF-shin.L head (0.1, -0.01, 0.5)");
    expect(direct.failed).toBe(true);
    expect(direct.said).toContain(
      "Body rig is generated from Body metarig and is made again from it: change the bones of Body metarig instead.",
    );
  });

  it("fits Rigify's quadruped to a dog by its four legs, its back, its nose and its tail, and generates its rig", async () => {
    await fresh();
    await script(dog);

    const fitted = await call("blender_rig", {
      from: { kind: "quadruped", fit_to: "Dog" },
    });

    expect(fitted.failed, fitted.said).toBe(false);
    const said = fitted.said;
    expect(said).toMatch(
      /Fitted Rigify's quadruped metarig to Dog \(\d+(\.\d+)? mm tall, its front toward -y\) as Dog metarig\./,
    );
    const wrist = near(
      said,
      "- wrist of the left front leg (front_foot.L's head) at (",
    );
    expect(wrist.line).toMatch(
      /the narrowest section of the left front leg there/,
    );
    expect(within(wrist.at, [0.08, -0.22, 0.1], 0.015), wrist.line).toBe(true);
    const hock = near(
      said,
      "- hock of the right hind leg (foot.R's head) at (",
    );
    expect(within(hock.at.slice(0, 2), [-0.08, 0.25], 0.012), hock.line).toBe(
      true,
    );
    const shoulder = near(
      said,
      "- shoulder of the left front leg (front_thigh.L's head) at (",
    );
    expect(shoulder.line).toMatch(
      /: 35% of the way from where the left front leg joins the body, \d+(\.\d+)? mm up, to the top of the back over it\.$/,
    );
    const nose = near(said, "- head tip (spine.011's tail) at (");
    expect(nose.line).toMatch(/: the body's frontmost point above the legs\.$/);
    expect(within(nose.at.slice(0, 2), [0, -0.61], 0.012), nose.line).toBe(
      true,
    );
    const tail = near(said, "- tail tip (spine's tail) at (");
    expect(tail.line).toMatch(/: the body's rearmost point\.$/);
    expect(within(tail.at.slice(0, 2), [0, 0.608], 0.012), tail.line).toBe(
      true,
    );
    expect(said).toMatch(
      /Generated Dog rig from Dog metarig: \d+ bones, \d+ of them deforming/,
    );
  });

  it("fits Rigify's bird to a bird by its legs, its wings out past its body and its beak, and generates its rig", async () => {
    await script(bird);

    const fitted = await call("blender_rig", {
      from: { kind: "bird", fit_to: "Bird" },
    });

    expect(fitted.failed, fitted.said).toBe(false);
    const said = fitted.said;
    const tip = near(
      said,
      "- tip of the left wing (past Wing.002.L, its farthest point) at (",
    );
    expect(tip.line).toMatch(
      /: the end of the left wing, on its middle line\.$/,
    );
    expect(within(tip.at, [0.28, 0, 0.13], 0.01), tip.line).toBe(true);
    const wrist = near(
      said,
      "- wrist of the right wing (Wing.002.R's head) at (",
    );
    expect(wrist.line).toMatch(/the narrowest section of the right wing there/);
    expect(within(wrist.at, [-0.14, 0, 0.13], 0.01), wrist.line).toBe(true);
    const beak = near(said, "- head tip (head's tail) at (");
    expect(within(beak.at.slice(0, 2), [0, -0.177], 0.006), beak.line).toBe(
      true,
    );
    expect(said).toMatch(
      /Generated Bird rig from Bird metarig: \d+ bones, \d+ of them deforming/,
    );
  });

  it("fits Rigify's full human, with a face and fingers, under the name asked", async () => {
    await script(person);

    const fitted = await call("blender_rig", {
      armature: "Hero",
      from: { kind: "human", fit_to: "Body" },
    });

    expect(fitted.failed, fitted.said).toBe(false);
    expect(fitted.said).toContain(
      "Fitted Rigify's human metarig to Body (1.8 m tall, its front toward -y) as Hero metarig.",
    );
    expect(fitted.said).toMatch(
      /Generated Hero from Hero metarig: \d+ bones, \d+ of them deforming \(the DEF- bones\), in \d+ bone collections; its zhiyin_rig_of is Body\./,
    );
  });

  it("binds the body to the rig the same call fitted to it", async () => {
    await script(
      "import bpy\nfor name in ('Body', 'Hero', 'Hero metarig'):\n    bpy.data.objects.remove(bpy.data.objects[name])",
    );
    await script(person);

    const rigged = await call("blender_rig", {
      from: { kind: "basic_human", fit_to: "Body" },
      bind: { meshes: ["Body"] },
    });

    expect(rigged.failed, rigged.said).toBe(false);
    expect(rigged.said).toMatch(/^Generated Body rig from Body metarig: /m);
    const bound = await script(
      [
        "import bpy",
        "body = bpy.data.objects['Body']",
        "print('bound to', [m.object.name for m in body.modifiers if m.type == 'ARMATURE'])",
      ].join("\n"),
    );
    expect(bound).toContain("bound to ['Body rig']");
  });

  it("refuses a ready rig fitted to something that is not a mesh, and a body with the wrong number of legs says so", async () => {
    const notMesh = await call("blender_rig", {
      from: { kind: "human", fit_to: "Dog rig" },
    });
    const wrongLegs = await call("blender_rig", {
      armature: "Two legs",
      from: { kind: "basic_human", fit_to: "Dog" },
    });

    expect(notMesh.failed).toBe(true);
    expect(notMesh.said).toContain(
      "“Dog rig” is a armature, and this needs a mesh.",
    );
    expect(wrongLegs.failed, wrongLegs.said).toBe(false);
    expect(wrongLegs.said).toContain(
      "the 2 legs: no level near the ground cuts the body into 2 columns",
    );
  });
});
