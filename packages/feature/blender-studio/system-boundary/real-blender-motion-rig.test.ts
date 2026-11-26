/**
 * Animating rigs against a real Blender: bones keyed by their turn, place
 * and IK reach, poses saved and keyed by name, values driven from distances,
 * turns and other values without Python, aims that turn about one axis,
 * stretch to reach their target or keep a part on a curve, and frame sheets
 * that measure the meshes bones bend. Each answer says where things went.
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

/**
 * A rig of its own, made with bpy: an arm of two connected bones standing up
 * from the origin, Upper (0 to 1 m) and Lower (1 to 2 m), a free bone Heel
 * beside it, a cylinder Arm bent by Upper and Lower, and a block Foot on a
 * floor, bent by Heel; nothing keyed.
 */
const rigScene = [
  "import bpy",
  "for o in list(bpy.data.objects): bpy.data.objects.remove(o)",
  "for a in list(bpy.data.actions): bpy.data.actions.remove(a)",
  "s = bpy.context.scene",
  "s.frame_start, s.frame_end, s.render.fps = 1, 25, 24",
  "rig = bpy.data.objects.new('Rig', bpy.data.armatures.new('Rig'))",
  "s.collection.objects.link(rig)",
  "bpy.context.view_layer.objects.active = rig",
  "bpy.ops.object.mode_set(mode='EDIT')",
  "bones = rig.data.edit_bones",
  "up = bones.new('Upper'); up.head, up.tail = (0, 0, 0), (0, 0, 1)",
  "lo = bones.new('Lower'); lo.head, lo.tail = (0, 0, 1), (0, 0, 2); lo.parent = up; lo.use_connect = True",
  "heel = bones.new('Heel'); heel.head, heel.tail = (2, 0, 0.05), (2, 0, 0.25)",
  "bpy.ops.object.mode_set(mode='OBJECT')",
  "bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=0.1, depth=2, location=(0, 0, 1))",
  "arm = bpy.context.active_object; arm.name = 'Arm'",
  "bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.subdivide(number_cuts=5); bpy.ops.object.mode_set(mode='OBJECT')",
  "upper, lower = arm.vertex_groups.new(name='Upper'), arm.vertex_groups.new(name='Lower')",
  "for v in arm.data.vertices:",
  "    (upper if v.co.z < 0 else lower).add([v.index], 1.0, 'REPLACE')",
  "arm.modifiers.new('Armature', 'ARMATURE').object = rig",
  "bpy.ops.mesh.primitive_cube_add(size=0.2, location=(2, 0, 0.1))",
  "foot = bpy.context.active_object; foot.name = 'Foot'",
  "foot.vertex_groups.new(name='Heel').add([v.index for v in foot.data.vertices], 1.0, 'REPLACE')",
  "foot.modifiers.new('Armature', 'ARMATURE').object = rig",
  "bpy.ops.mesh.primitive_plane_add(size=4, location=(2, 0, 0))",
  "bpy.context.active_object.name = 'Floor'",
  "cam = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera'))",
  "s.collection.objects.link(cam); s.camera = cam",
  "cam.location = (8, -8, 4); cam.rotation_euler = (1.25, 0, 0.785)",
].join("\n");

describe.runIf(blender)("a real Blender, animating rigs", () => {
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

  beforeAll(async () => {
    const root = await folders.make("zhiyin-studio-motion-rig-");
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
    tools = sceneAutomation(scenes.scene("rig"), {
      workspaceRoot: () => workspace,
      blender: async () => blender,
      directory: scenes.directory("rig"),
    });
    await call("blender_open_scene", { path: "rig.blend", create: true });
  });

  afterAll(async () => {
    await scenes.forget("rig");
    await scenes.closeAll();
    await folders.removeAll();
  });

  it("turns a bone about its own axes at times, in the rig's own rotation mode, and says where its tip is", async () => {
    await script(rigScene);

    const keyed = await call("blender_animate", {
      keys: [
        { object: "Rig", bone: "Lower", at: 0, rotation: [0, 0, 0] },
        {
          object: "Rig",
          bone: "Lower",
          at: 1,
          rotation: [90, 0, 0],
          easing: "linear",
        },
        { object: "Rig", bone: "Upper", at: 1, rotation: [0, 0, 0] },
      ],
    });
    const modes = await script(
      [
        "import bpy",
        "rig = bpy.data.objects['Rig']",
        "print('modes', [b.rotation_mode for b in rig.pose.bones])",
        "print('keyed', sorted({c.data_path for c in rig.animation_data.action.layers[0].strips[0].channelbags[0].fcurves}))",
      ].join("\n"),
    );

    expect(keyed.failed, keyed.said).toBe(false);
    expect(keyed.said).toContain(
      "Rig: Lower at 0 s: turned (0°, 0°, 0°) from its rest, its tip at (0, 0, 2 m); Lower at 1 s: turned (90°, 0°, 0°) from its rest, reached linear, its tip at (0, -1, 1 m); Upper at 1 s: turned (0°, 0°, 0°) from its rest, its tip at (0, 0, 1 m).",
    );
    // Each bone keeps the quaternions a new bone turns by, keyed as them.
    expect(modes).toContain("modes ['QUATERNION', 'QUATERNION', 'QUATERNION']");
    expect(modes).toContain(
      `keyed ['pose.bones["Lower"].rotation_quaternion', 'pose.bones["Upper"].rotation_quaternion']`,
    );
  });

  it("moves a free bone along its own axes, and refuses to move one connected to the bone before it", async () => {
    const moved = await call("blender_animate", {
      keys: [{ object: "Rig", bone: "Heel", at: 0, location: [0, 0.5, 0] }],
    });
    const connected = await call("blender_animate", {
      keys: [{ object: "Rig", bone: "Lower", at: 0, location: [0, 0.5, 0] }],
    });

    expect(moved.failed, moved.said).toBe(false);
    expect(moved.said).toContain(
      "Heel at 0 s: moved (0, 500, 0 mm) along its own axes from its rest, its tip at (2, 0, 0.75 m)",
    );
    expect(connected.failed).toBe(true);
    expect(connected.said).toContain(
      "Lower is connected to Upper, so it moves only by turning: key its rotation, or move Upper.",
    );
  });

  it("puts a bone's IK target where it reaches for, and says how far the tip falls short", async () => {
    await script(rigScene);
    await script(
      [
        "import bpy",
        "s = bpy.context.scene",
        "target = bpy.data.objects.new('Hand target', None); s.collection.objects.link(target)",
        "target.location = (0, 1, 1)",
        "ik = bpy.data.objects['Rig'].pose.bones['Lower'].constraints.new('IK')",
        "ik.target, ik.chain_count = target, 2",
      ].join("\n"),
    );

    const reached = await call("blender_animate", {
      keys: [
        { object: "Rig", bone: "Lower", at: 0, reach: [0, 1, 1] },
        { object: "Rig", bone: "Lower", at: 1, reach: [0, 3, 1] },
      ],
    });
    const unreaching = await call("blender_animate", {
      keys: [{ object: "Rig", bone: "Upper", at: 0, reach: [0, 1, 1] }],
    });

    expect(reached.failed, reached.said).toBe(false);
    expect(reached.said).toContain(
      "Lower at 0 s: reaching for (0, 1, 1 m), where its IK target Hand target is keyed, its tip at (0, 1, 1 m)",
    );
    expect(reached.said).toMatch(
      /Lower at 1 s: reaching for \(0, 3, 1 m\), where its IK target Hand target is keyed, its tip at \(0, 1\.89\d*, 0\.63\d* m\), 1\.16\d* m from the point it reaches for/,
    );
    expect(unreaching.failed).toBe(true);
    expect(unreaching.said).toContain(
      "Rig's bone Upper has no IK constraint to reach with; its bones with one: Lower. Give it one with blender_rig, or key its rotation.",
    );
  });

  it("saves poses by name, from the bones given or as the rig stands, and keys them by name in a later call", async () => {
    await script(rigScene);

    const saved = await call("blender_animate", {
      poses: [
        {
          object: "Rig",
          name: "Bent",
          bones: [{ bone: "Lower", rotation: [45, 0, 0] }],
        },
      ],
      keys: [{ object: "Rig", at: 1, pose: "Bent" }],
    });
    await script(
      "import bpy, math\nbpy.data.objects['Rig'].pose.bones['Heel'].location = (0, 0.25, 0)",
    );
    const standing = await call("blender_animate", {
      poses: [{ object: "Rig", name: "Stepped" }],
    });
    const later = await call("blender_animate", {
      keys: [{ object: "Rig", at: 2, pose: "Stepped" }],
    });
    const unknown = await call("blender_animate", {
      keys: [{ object: "Rig", at: 2, pose: "Wave" }],
    });

    expect(saved.failed, saved.said).toBe(false);
    expect(saved.said).toContain(
      "Rig: pose Bent saved with 1 bone: Lower turned (45°, 0°, 0°); pose Bent at 1 s, its 1 bone: Lower's tip at (0, -0.7071, 1.707 m).",
    );
    expect(standing.said).toContain(
      "Rig: pose Stepped saved with 2 bones, as it stands now: Lower turned (45°, 0°, 0°), Heel turned (0°, 0°, 0°) moved (0, 250, 0 mm).",
    );
    expect(later.said).toContain(
      "Rig: pose Stepped at 2 s, its 2 bones: Lower's tip at (0, -0.7071, 1.707 m), Heel's tip at (2, 0, 0.5 m).",
    );
    expect(unknown.failed).toBe(true);
    expect(unknown.said).toContain(
      "Rig has no pose named “Wave”; its poses: Bent, Stepped.",
    );
  });

  it("drives a shape from a distance, a bone's turn from the turn between two parts, and a custom value from the most of two, without Python", async () => {
    await script(rigScene);
    await script(
      [
        "import bpy, math",
        "s = bpy.context.scene",
        "a = bpy.data.objects.new('A', None); b = bpy.data.objects.new('B', None)",
        "s.collection.objects.link(a); s.collection.objects.link(b)",
        "b.location = (0, 0, 0); b.keyframe_insert('location', frame=1)",
        "b.location = (0, 5, 0); b.rotation_euler = (0, 0, math.radians(30))",
        "b.keyframe_insert('location', frame=25); b.keyframe_insert('rotation_euler', frame=25)",
        "b.rotation_euler = (0, 0, 0); b.keyframe_insert('rotation_euler', frame=1)",
        "for c in b.animation_data.action.layers[0].strips[0].channelbags[0].fcurves:",
        "    for k in c.keyframe_points: k.interpolation = 'LINEAR'",
        "foot = bpy.data.objects['Foot']",
        "foot.shape_key_add(name='Basis'); foot.shape_key_add(name='Smile')",
      ].join("\n"),
    );

    const driven = await call("blender_animate", {
      drive: [
        {
          object: "Foot",
          path: 'data.shape_keys.key_blocks["Smile"].value',
          variables: [{ name: "d", kind: "distance", object: "A", to: "B" }],
          formula: "d / 5",
        },
        {
          object: "Rig",
          path: 'pose.bones["Upper"].rotation_euler[2]',
          variables: [{ kind: "turn_between", object: "A", to: "B" }],
        },
        {
          object: "A",
          path: '["level"]',
          variables: [
            { object: "B", path: "location[1]" },
            { object: "B", path: "location[0]" },
          ],
          combine: "max",
        },
      ],
    });
    const needsPython = await call("blender_animate", {
      drive: [
        {
          object: "A",
          path: '["level"]',
          variables: [{ name: "d", kind: "distance", object: "A", to: "B" }],
          formula: "d.real",
        },
      ],
    });

    expect(driven.failed, driven.said).toBe(false);
    expect(driven.said).toContain(
      `Foot: its data.shape_keys.key_blocks["Smile"].value is driven by d, the distance from A to B, by d / 5, which Blender works out without Python: 0 at 0 s, from 0 at 0 s to 1 at 1 s over the timeline, which Blender holds within 0 to 1.`,
    );
    expect(driven.said).toContain(
      `Rig: its pose.bones["Upper"].rotation_euler[2] is driven by the turn between A and B, which Blender works out without Python; its rotation set to XYZ angles so the driven turn takes: 0° at 0 s, from 0° at 0 s to 30° at 1 s over the timeline.`,
    );
    expect(driven.said).toContain(
      `A: its ["level"] is driven by a, B's location[1]; b, B's location[0], max, which Blender works out without Python; level made, at 0: 0 at 0 s, from 0 at 0 s to 5 at 1 s over the timeline.`,
    );
    expect(needsPython.failed).toBe(true);
    expect(needsPython.said).toContain(
      'A\'s ["level"] would be driven by d.real, which needs Python, and this Blender runs no Python in a driver.',
    );
  });

  it("turns a turret about one axis only, keeps a camera's axis up, stretches a spring to its pin and keeps a car on its track", async () => {
    await script(
      [
        "import bpy",
        "for o in list(bpy.data.objects): bpy.data.objects.remove(o)",
        "for a in list(bpy.data.actions): bpy.data.actions.remove(a)",
        "s = bpy.context.scene",
        "s.frame_start, s.frame_end, s.render.fps = 1, 25, 24",
        "def empty(name, at):",
        "    o = bpy.data.objects.new(name, None); s.collection.objects.link(o); o.location = at; return o",
        "empty('Turret', (0, 0, 0)); empty('Plane', (3, 4, 5)); empty('Camera rig', (0, -5, 0))",
        "bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0.5, 0)); spring = bpy.context.active_object",
        "spring.name = 'Spring'; spring.scale = (0.05, 1, 0.05)",
        "bpy.ops.object.transform_apply(scale=True, location=True)",
        "pin = empty('Pin', (0, 1, 0)); pin.keyframe_insert('location', frame=1)",
        "pin.location = (0, 1.5, 0); pin.keyframe_insert('location', frame=25)",
        "cu = bpy.data.curves.new('Track', 'CURVE'); cu.dimensions = '3D'",
        "sp = cu.splines.new('POLY'); sp.points.add(2)",
        "for i, p in enumerate([(0, 0, 0), (2, 0, 0), (4, 2, 0)]): sp.points[i].co = (*p, 1)",
        "s.collection.objects.link(bpy.data.objects.new('Track', cu))",
        "car = empty('Car', (0, 3, 0)); car.keyframe_insert('location', frame=1)",
        "car.location = (9, 3, 0); car.keyframe_insert('location', frame=25)",
      ].join("\n"),
    );

    const aimed = await call("blender_animate", {
      aim: [
        { object: "Turret", at: "Plane", locked: "z" },
        { object: "Camera rig", at: "Turret", facing: "y", up: "x" },
        { object: "Spring", at: "Pin", stretch: true },
        { object: "Car", at: "Track", on_curve: true },
      ],
    });
    const wrong = await call("blender_animate", {
      aim: [{ object: "Turret", at: "Plane", locked: "y", facing: "-y" }],
    });
    const notCurve = await call("blender_animate", {
      aim: [{ object: "Car", at: "Plane", on_curve: true }],
    });
    const sideways = await call("blender_animate", {
      aim: [{ object: "Spring", at: "Pin", stretch: true, facing: "z" }],
    });

    expect(aimed.failed, aimed.said).toBe(false);
    expect(aimed.said).toContain(
      "Turret: turns about its own z axis only, to point its -y axis toward Plane wherever either moves; it points 45° off the line to Plane now, which a turn about z alone cannot close.",
    );
    expect(aimed.said).toContain(
      "Camera rig: aims its y axis at Turret wherever either moves; its x axis is kept up as far as that allows.",
    );
    expect(aimed.said).toContain(
      "Spring: stretches along its y axis to reach Pin wherever either moves, keeping its thickness: 1 m from its origin to Pin's at its own length, 1 m; over the timeline 1 m apart at 0 s to 1.5 m at 1 s, ×1 to ×1.5 its length, 1 m to 1.5 m.",
    );
    expect(aimed.said).toContain(
      "Car: is kept on Track, a curve 4.828 m long, as far along it as its own place along x is across the curve's box that way, from -1 m at its start to 5 m at its end: from (804.7, 0, 0 mm) at 0 s to (4, 2, 0 m) at 1 s.",
    );
    expect(wrong.said).toContain(
      "“Turret” cannot turn about its y axis to point that same axis: lock another axis.",
    );
    expect(notCurve.said).toContain(
      "on_curve keeps an object on a curve; “Plane” is not one.",
    );
    expect(sideways.said).toContain(
      "Blender stretches a part along its own y axis to reach what it aims at: leave facing and up out, and lay the part's length along y.",
    );
  });

  it("measures meshes bones bend in a frame sheet: their surfaces pop, a foot skates, and a bone's keyed angle flips", async () => {
    await script(rigScene);
    // Turned by angles, so its keyed angle can flip.
    await script(
      "import bpy\nbpy.data.objects['Rig'].pose.bones['Lower'].rotation_mode = 'XYZ'",
    );
    await call("blender_animate", {
      keys: [
        { object: "Rig", bone: "Lower", at: 0, rotation: [0, 0, 0] },
        {
          object: "Rig",
          bone: "Lower",
          at: 0.5,
          rotation: [200, 0, 0],
          easing: "constant",
        },
        { object: "Rig", bone: "Lower", at: 1, rotation: [200, 0, 0] },
        { object: "Rig", bone: "Heel", at: 0, location: [0, 0, 0] },
        {
          object: "Rig",
          bone: "Heel",
          at: 1,
          location: [-0.5, 0, 0],
          easing: "linear",
        },
      ],
    });

    const sheet = await call("blender_frame_sheet", {
      every_ms: 250,
      count: 5,
      tile_width: 160,
      engine: "solid",
    });

    expect(sheet.failed, sheet.said).toBe(false);
    // Both meshes stay where their origins are while their bones bend them.
    expect(sheet.said).toContain("Where each moving object is at each time");
    expect(sheet.said).toMatch(/0 s: [^\n]*Arm \(/);
    expect(sheet.said).toMatch(/0 s: [^\n]*Foot \(/);
    expect(sheet.said).toMatch(
      /Pops of surfaces bones bend: Arm's surface jumps [0-9.]+ m between 0\.458 s and 0\.5 s, its point moving 0 mm in the frames either side\./,
    );
    expect(sheet.said).toContain(
      "Flips: Rig's bone Lower's turn around x jumps 200° between 0.458 s and 0.5 s",
    );
    expect(sheet.said).toContain(
      "Sliding where bent surfaces rest: Foot's surface slides 500 mm along Floor between 0.0417 s and 1 s where its lowest points rest on it, bent there most by the bone Heel.",
    );
    expect(sheet.said).toMatch(
      /Fastest: [^\n]*Arm's surface [0-9.]+ m\/s at 0\.458 s/,
    );
  });
});
