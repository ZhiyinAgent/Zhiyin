/**
 * Binding meshes to bones and chains that reach, against a real Blender: a
 * leg bound by automatic weights and turned at its knee in a pose test,
 * bones whose envelopes miss the mesh or crowd it, a robot's loose parts each
 * bound whole to the bone it lies in, the armature found by the mark a rig
 * fitted to the mesh carries, a leg reaching for a target with its knee
 * toward a pole and checked at every frame, and a tail along a curve. Each
 * answer says what the weights, the pose test and the timeline measured.
 *
 *   $env:ZHIYIN_BLENDER = "…\blender.exe"; npx vitest run --project system-boundary packages/feature/blender-studio/system-boundary/real-blender-rig-bind.test.ts
 */

import { mkdir, readFile } from "node:fs/promises";
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

/** Python that empties the scene and gives it the helpers the scenes below are built with. */
const helpers = `
import math
import bmesh
import mathutils
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o)
for a in list(bpy.data.armatures):
    bpy.data.armatures.remove(a)
scene = bpy.context.scene
scene.render.fps = 24
scene.frame_start, scene.frame_end = 1, 49

def tube(name, segments=16, rings=20, radius=0.1, height=1.0):
    """A closed round tube standing on z = 0, in rings along its height."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=segments, radius1=radius, radius2=radius, depth=height)
    bm.transform(mathutils.Matrix.Translation((0, 0, height / 2)))
    sides = [e for e in bm.edges if abs(e.verts[0].co.z - e.verts[1].co.z) > height / 2]
    bmesh.ops.subdivide_edges(bm, edges=sides, cuts=rings - 1, use_grid_fill=True)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    scene.collection.objects.link(obj)
    return obj

def boxes(name, parts):
    """One mesh of separate boxes, each given by its lowest and highest corners."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    for low, high in parts:
        middle = [(a + b) / 2 for a, b in zip(low, high)]
        size = [b - a for a, b in zip(low, high)]
        place = mathutils.Matrix.Translation(middle) @ mathutils.Matrix.Diagonal((*size, 1))
        bmesh.ops.create_cube(bm, size=1, matrix=place)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    scene.collection.objects.link(obj)
    return obj

def armature(name, bones):
    """An armature of bones given as (name, head, tail, parent); a child starting at its parent's tail is connected."""
    data = bpy.data.armatures.new(name)
    obj = bpy.data.objects.new(name, data)
    scene.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    with bpy.context.temp_override(active_object=obj, object=obj):
        bpy.ops.object.mode_set(mode="EDIT")
    made = {}
    for bone, head, tail, parent in bones:
        b = data.edit_bones.new(bone)
        b.head, b.tail = head, tail
        if parent:
            b.parent = made[parent]
            b.use_connect = (made[parent].tail - b.head).length < 1e-6
        made[bone] = b
    with bpy.context.temp_override(active_object=obj, object=obj):
        bpy.ops.object.mode_set(mode="OBJECT")
    return obj

def keyed(obj, frames, interpolation="LINEAR"):
    """Keys an object's place at frames, straight between them or as asked."""
    for frame, place in frames:
        obj.location = place
        obj.keyframe_insert("location", frame=frame)
    for curve in obj.animation_data.action.layers[0].strips[0].channelbag(obj.animation_data.action.slots[0]).fcurves:
        for point in curve.keyframe_points:
            point.interpolation = interpolation

def empty(name, place):
    obj = bpy.data.objects.new(name, None)
    scene.collection.objects.link(obj)
    obj.location = place
    return obj

LEG = [("thigh", (0, 0, 1), (0, -0.03, 0.5), None), ("shin", (0, -0.03, 0.5), (0, 0, 0), "thigh")]
`;

describe.runIf(blender)("binding and reaching limbs in a real Blender", () => {
  const folders = new TemporaryFolders();
  let scenes: ConversationScenes;
  let tools: ReturnType<typeof sceneAutomation>;
  let workspace: string;
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = (await tools.callTool(name, args)) as Result;
    return {
      failed: result.isError === true,
      said: result.content.map((c) => c.text ?? "").join("\n"),
    };
  };
  const build = async (code: string) => {
    const built = await call("blender_run_script", { code: helpers + code });
    expect(built.failed, built.said).toBe(false);
  };
  const printed = async (code: string) =>
    (await call("blender_run_script", { code })).said.split("\n")[0] ?? "";

  beforeAll(async () => {
    const root = await folders.make("zhiyin-studio-rig-bind-");
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
    tools = sceneAutomation(scenes.scene("rig-bind"), {
      workspaceRoot: () => workspace,
      blender: async () => blender,
      directory: scenes.directory("rig-bind"),
    });
    const opened = await call("blender_open_scene", {
      path: "rig.blend",
      create: true,
    });
    expect(opened.failed, opened.said).toBe(false);
  });

  afterAll(async () => {
    await scenes.forget("rig-bind");
    await scenes.closeAll();
    await folders.removeAll();
  });

  it("binds a leg by automatic weights, its Armature step first, and turns its knee in a pose test", async () => {
    await build(`
leg = tube("Leg")
leg.modifiers.new("Subdivision", "SUBSURF")
armature("Rig", LEG)
`);

    const bound = await call("blender_rig", {
      bind: { meshes: ["Leg"], armature: "Rig" },
    });

    expect(bound.failed, bound.said).toBe(false);
    expect(bound.said).toContain(
      "Leg bound to Rig by automatic weights, its Armature step first, preserving volume; 2 bones deform its 336 points.",
    );
    expect(bound.said).toContain(
      "Every point is weighted, by at most 2 bones.",
    );
    expect(bound.said).toContain(
      "Pose test, each joint turned 60° each way about its own x: 1 joint, shin;",
    );
    expect(bound.said).toMatch(
      /- shin at \(0, -30, 500 mm\): 60° loses [\d.]+% of the [\d.]+ L within [\d.]+ mm of it \([\d.]+ L\), [^;]+; -60° (loses|gains) [\d.]+%/,
    );
    expect(
      await printed(
        "leg = bpy.data.objects['Leg']\nstep = leg.modifiers[0]\nprint(leg.parent.name, [m.type for m in leg.modifiers], step.object.name, step.use_deform_preserve_volume)",
      ),
    ).toBe("Rig ['ARMATURE', 'SUBSURF'] Rig True");
  });

  it("measures the knee's volume as the leg's own volume changes", async () => {
    // The pose test's change is the change in the whole closed leg's volume,
    // measured here on its own: the leg turned 60° each way at the knee by hand.
    const measured = await printed(`
import bmesh, math, mathutils
rig, leg = bpy.data.objects['Rig'], bpy.data.objects['Leg']
def volume():
    bpy.context.view_layer.update()
    ev = leg.evaluated_get(bpy.context.evaluated_depsgraph_get())
    me = ev.to_mesh()
    bm = bmesh.new(); bm.from_mesh(me); ev.to_mesh_clear()
    v = bm.calc_volume(signed=True); bm.free(); return v
leg.modifiers['Subdivision'].show_viewport = False
before = volume()
said = []
for degrees in (60, -60):
    rig.pose.bones['shin'].rotation_quaternion = mathutils.Quaternion((1, 0, 0), math.radians(degrees))
    change = volume() - before
    said.append(f"{degrees}° {'loses' if change < 0 else 'gains'} {abs(change) * 1000:.4g}")
rig.pose.bones['shin'].rotation_quaternion = (1, 0, 0, 0)
leg.modifiers['Subdivision'].show_viewport = True
print("|".join(said))
`);
    const bound = await call("blender_rig", {
      bind: { meshes: ["Leg"], armature: "Rig" },
    });

    for (const turned of measured.split("|")) {
      const [angle, word, litres] = turned.split(" ");
      expect(bound.said).toMatch(
        new RegExp(
          `${angle} ${word} [\\d.]+% of the [\\d.]+ L within [\\d.]+ mm of it \\(${litres} L\\)`,
        ),
      );
    }
    expect(bound.said).toContain(
      "Its earlier weights for these bones were replaced.",
    );
  });

  it("says the points no bone's envelope reaches, the bones that move nothing, and crowded points kept to four bones", async () => {
    await build(`
tube("Leg")
rig = armature("Rig", LEG)
rig.data.bones["thigh"].envelope_distance = 0.15
rig.data.bones["shin"].envelope_distance = 0.0
rig.data.bones["shin"].head_radius = rig.data.bones["shin"].tail_radius = 0.001
tube("Spine")
bones = [(f"b{i}", (0, 0, i / 6), (0, 0, (i + 1) / 6), f"b{i - 1}" if i else None) for i in range(6)]
spine = armature("Spine rig", bones)
for b in spine.data.bones:
    b.envelope_distance = 0.6
`);

    const missed = await call("blender_rig", {
      bind: { meshes: ["Leg"], armature: "Rig", how: "envelope" },
    });
    const crowded = await call("blender_rig", {
      bind: { meshes: ["Spine"], armature: "Spine rig", how: "envelope" },
    });
    const kept = await call("blender_rig", {
      bind: {
        meshes: ["Spine"],
        armature: "Spine rig",
        how: "envelope",
        influences: 4,
      },
    });

    expect(missed.failed, missed.said).toBe(false);
    expect(missed.said).toContain(
      "Leg bound to Rig by its bones' envelopes, its Armature step first, preserving volume; 2 bones deform its 336 points.",
    );
    expect(missed.said).toMatch(
      /\n\d+ points have no weight, around \([^)]+\), nearest shin: they stay where they are when the bones move\./,
    );
    expect(missed.said).toContain("Bones that move nothing: shin.");
    expect(crowded.said).toMatch(
      /\n\d+ points are on more than 4 bones, at most 6: a game engine keeps 4; give influences 4 to keep the heaviest\./,
    );
    expect(kept.said).toMatch(
      /\nKept at most 4 bones on each point, the heaviest, their weights summing to 1: \d+ points lost 1 to 2 bones\./,
    );
    expect(kept.said).toContain("Every point is weighted, by at most 4 bones.");
  });

  it("binds a robot's loose parts each whole to the bone it lies in, and says where turned parts go through each other", async () => {
    await build(`
boxes("Arm", [
    ((-0.1, -0.1, 0), (0.1, 0.1, 0.2)),
    ((-0.05, -0.05, 0.2), (0.05, 0.05, 0.7)),
    ((-0.04, -0.04, 0.7), (0.04, 0.04, 1.1)),
    ((0.2, -0.02, 0.9), (0.24, 0.02, 0.94)),
])
armature("Rig", [
    ("base", (0, 0, 0), (0, 0, 0.2), None),
    ("upper", (0, 0, 0.2), (0, 0, 0.7), "base"),
    ("fore", (0, 0, 0.7), (0, 0, 1.1), "upper"),
])
`);

    const bound = await call("blender_rig", {
      bind: { meshes: ["Arm"], armature: "Rig", how: "rigid" },
    });

    expect(bound.failed, bound.said).toBe(false);
    expect(bound.said).toContain(
      "Arm bound to Rig rigidly, its Armature step first; 3 bones deform its 32 points.",
    );
    expect(bound.said).toContain(
      "Each of its 4 loose parts moves whole with one bone:",
    );
    expect(bound.said).toContain(
      "- the part at (0, 0, 100 mm), 8 points: base, which runs inside it for 100% of its length",
    );
    expect(bound.said).toContain(
      "- the part at (0, 0, 450 mm), 8 points: upper, which runs inside it for 100% of its length",
    );
    expect(bound.said).toContain(
      "- the part at (220, 0, 920 mm), 8 points: no bone runs inside it; fore is the nearest, 200 mm away",
    );
    expect(bound.said).toContain("Every point is weighted, by at most 1 bone.");
    // Turned at its foot, the fore part's corner goes into the upper part's side.
    expect(bound.said).toContain(
      "Pose test, each joint turned 60° each way about its own x: 2 joints, upper, fore; 2 of them lose or gain more than 5% of the volume near them or make new self-crossings:",
    );
    expect(bound.said).toContain(
      "- fore at (0, 0, 700 mm): 60° keeps its volume, 4 new self-crossings, one at (-40, -50, 691.3 mm); -60° keeps its volume, 4 new self-crossings, one at (-40, 50, 691.3 mm).",
    );
    expect(
      await printed(
        "vg = bpy.data.objects['Arm'].vertex_groups\nprint(sorted((g.name, sum(1 for v in bpy.data.objects['Arm'].data.vertices for w in v.groups if w.group == g.index and w.weight == 1)) for g in vg))",
      ),
    ).toBe("[('base', 8), ('fore', 16), ('upper', 8)]");
  });

  it("binds to the rig fitted to the mesh when none is named, and refuses to guess between armatures", async () => {
    await build(`
tube("Leg")
armature("Rig A", LEG)
armature("Rig B", LEG)
`);
    const guessed = await call("blender_rig", { bind: { meshes: ["Leg"] } });
    await build(`
tube("Leg")
armature("Rig A", LEG)
armature("Rig B", LEG)["zhiyin_rig_of"] = "Leg"
`);
    const found = await call("blender_rig", { bind: { meshes: ["Leg"] } });

    expect(guessed.failed).toBe(true);
    expect(guessed.said).toContain(
      "Name bind.armature: no rig was fitted to Leg, and the scene has 2 armatures, Rig A and Rig B.",
    );
    expect(found.failed, found.said).toBe(false);
    expect(found.said).toContain(
      "Leg bound to Rig B, the rig fitted to Leg, by automatic weights",
    );
  });

  it("makes a leg reach for a target made at its foot with its knee toward a pole, keeping its pose", async () => {
    await build(`
armature("Rig", LEG)
`);

    const reached = await call("blender_rig", {
      ik: [{ bone: "shin", target: "Foot target", pole: "Knee pole" }],
    });

    expect(reached.failed, reached.said).toBe(false);
    expect(reached.said).toContain(
      "IK on shin of Rig: a chain of 2 bones, thigh to shin, 1.002 m long from (0, 0, 1 m); it reaches for Foot target, made, an empty at the tip (0, 0, 0 mm); its bend points to Knee pole, made at (0, -1.032, 0.5 m) on the side it bends, the pole angle -90°; no stretch.",
    );
    expect(reached.said).toContain(
      "As set, at 0 s the chain keeps its pose, within 0.01°.",
    );
    expect(reached.said).toContain(
      "Over the timeline, from 0 s to 2 s at every frame: the tip reaches its target throughout; the bend keeps its side; no bone stretches.",
    );
    expect(
      await printed(
        "import math\nik = bpy.data.objects['Rig'].pose.bones['shin'].constraints[0]\nprint(ik.type, ik.target.name, ik.pole_target.name, ik.chain_count, round(math.degrees(ik.pole_angle)), ik.target.parent.name, ik.pole_target.parent.name)",
      ),
    ).toBe("IK Foot target Knee pole 2 -90 Rig Rig");
  });

  it("says where a reaching leg falls short, where it stretches instead, and where its knee turns to the other side or jumps there", async () => {
    await build(`
armature("Rig", LEG)
keyed(empty("Foot target", (0, 0, 0)), [(1, (0, 0, 0)), (25, (0, 0, -0.3)), (49, (0, 0, 0))])
keyed(empty("Knee pole", (0, -1, 0.5)), [(1, (0, -1, 0.5)), (21, (1, -0.1, 0.5)), (49, (0, 1, 0.5))])
`);

    const short = await call("blender_rig", {
      ik: [{ bone: "shin", target: "Foot target" }],
    });
    const stretched = await call("blender_rig", {
      ik: [{ bone: "shin", target: "Foot target", stretch: true }],
    });
    await build(`
armature("Rig", LEG)
empty("Foot target", (0, 0, 0))
keyed(empty("Knee pole", (0, -1, 0.5)), [(1, (0, -1, 0.5)), (21, (1, -0.1, 0.5)), (49, (0, 1, 0.5))])
`);
    const flipped = await call("blender_rig", {
      ik: [{ bone: "shin", target: "Foot target", pole: "Knee pole" }],
    });
    await build(`
armature("Rig", LEG)
empty("Foot target", (0, 0, 0))
keyed(empty("Knee pole", (0, -1, 0.5)), [(1, (0, -1, 0.5)), (25, (0, 1, 0.5))], "CONSTANT")
`);
    const jumped = await call("blender_rig", {
      ik: [{ bone: "shin", target: "Foot target", pole: "Knee pole" }],
    });

    expect(short.failed, short.said).toBe(false);
    expect(short.said).toContain(
      "IK on shin of Rig: a chain of 2 bones, thigh to shin, 1.002 m long from (0, 0, 1 m); it reaches for Foot target; no pole, so nothing holds the side it bends to; no stretch.",
    );
    expect(short.said).toContain(
      "the tip falls short from 0.0417 s to 1.96 s, by up to 298.2 mm at 1 s, where Foot target is 1.3 m from the chain's root against its 1.002 m length;",
    );
    expect(stretched.said).toContain("the tip reaches its target throughout;");
    expect(stretched.said).toMatch(
      /thigh and shin stretch past their length from 0\.0417 s to 1\.96 s, up to 1\.29\d× at 1 s\./,
    );
    expect(flipped.said).toMatch(
      /the bend turns to the other side from where it bends at rest from 0\.958 s to 2 s, up to 1[78]\d° at 2 s;/,
    );
    expect(jumped.said).toMatch(
      /the bend turns to the other side from where it bends at rest from 1 s to 2 s, up to 1[78]\d° at 1 s; its bend jumps 1[78]\d° between frames at 1 s;/,
    );
  });

  it("lays a tail along a curve from its start, kept to its length or stretched to fit", async () => {
    await build(`
armature("Tail", [(f"t{i}", (0, 0, i * 0.25), (0, 0, (i + 1) * 0.25), f"t{i - 1}" if i else None) for i in range(4)])
data = bpy.data.curves.new("Path", "CURVE")
data.dimensions = "3D"
spline = data.splines.new("POLY")
spline.points.add(2)
for p, co in zip(spline.points, [(1, 0, 0, 1), (1, 0.5, 0.5, 1), (1, 1, 1, 1)]):
    p.co = co
scene.collection.objects.link(bpy.data.objects.new("Path", data))
`);

    const kept = await call("blender_rig", {
      ik: [{ bone: "t3", curve: "Path" }],
    });
    const fitted = await call("blender_rig", {
      ik: [{ bone: "t3", curve: "Path", stretch: true }],
    });

    expect(kept.failed, kept.said).toBe(false);
    expect(kept.said).toContain(
      "Spline IK on t3 of Tail: a chain of 4 bones, t0 to t3, 1 m long, along Path, 1.414 m long, from its start; each bone keeps its length, so the chain covers the first 70.7% of the curve.",
    );
    expect(kept.said).toContain(
      "the chain lies on its curve throughout; no bone stretches.",
    );
    expect(fitted.said).toContain(
      "each bone stretches to fit the whole curve, to 1.414× its length.",
    );
  });

  it("refuses a chain longer than its bones, a bone no armature has and a pole on a curve", async () => {
    await build(`
armature("Rig", LEG)
data = bpy.data.curves.new("Path", "CURVE")
data.splines.new("POLY").points.add(1)
scene.collection.objects.link(bpy.data.objects.new("Path", data))
`);

    const long = await call("blender_rig", {
      ik: [{ bone: "shin", target: "Foot target", chain: 3 }],
    });
    const missing = await call("blender_rig", {
      ik: [{ bone: "foot", target: "Foot target" }],
    });
    const poled = await call("blender_rig", {
      ik: [{ bone: "shin", curve: "Path", pole: "Knee pole" }],
    });

    expect(long.failed).toBe(true);
    expect(long.said).toContain(
      "shin has 2 bones up to its root, thigh to shin: ik[0].chain is at most 2.",
    );
    expect(missing.failed).toBe(true);
    expect(missing.said).toContain(
      "No armature has a bone named “foot”. Rig has thigh and shin.",
    );
    expect(poled.failed).toBe(true);
    expect(poled.said).toContain(
      "ik[0] lies along a curve, which holds its bend: it takes no pole.",
    );
  });

  it("exports a bound rig to .glb with its bones, the mesh's weights and the bones' keys", async () => {
    await build(`
leg = tube("Leg")
rig = armature("Rig", LEG)
shin = rig.pose.bones["shin"]
shin.rotation_mode = "XYZ"
for frame, angle in ((1, 0), (25, 60)):
    shin.rotation_euler = (math.radians(angle), 0, 0)
    shin.keyframe_insert("rotation_euler", frame=frame)
`);
    const bound = await call("blender_rig", {
      bind: { meshes: ["Leg"], armature: "Rig" },
    });
    expect(bound.failed, bound.said).toBe(false);

    const exported = await call("blender_export", {
      output: "leg.glb",
      objects: ["Rig"],
    });

    expect(exported.failed, exported.said).toBe(false);
    // A .glb starts with a 12-byte header, then its JSON chunk: length, type, text.
    const file = await readFile(join(workspace, "leg.glb"));
    const gltf = JSON.parse(
      file.subarray(20, 20 + file.readUInt32LE(12)).toString("utf8"),
    ) as {
      nodes: { name: string; skin?: number }[];
      skins?: { joints: number[] }[];
      animations?: { channels: { target: { node: number } }[] }[];
    };
    const named = (index: number) => gltf.nodes[index]?.name;
    const skinned = gltf.nodes.find((node) => node.skin !== undefined);
    expect(skinned?.name).toBe("Leg");
    expect(gltf.skins?.[skinned?.skin ?? -1]?.joints.map(named).sort()).toEqual(
      ["shin", "thigh"],
    );
    expect(
      gltf.animations?.flatMap((animation) =>
        animation.channels.map((channel) => named(channel.target.node)),
      ),
    ).toContain("shin");
  });
});
