/**
 * Scattering against a real Blender: copies of objects set over a surface by
 * count or density, kept to where the rules allow, their footprints never
 * touching, made as linked objects or as instances geometry nodes place.
 * Each answer says how many were placed against how many were asked, what
 * each rule and the footprints removed, the least gap left between
 * footprints, what any copy goes into and how many objects and instances
 * the scene now has. A second scatter of the same items onto the same
 * surface replaces the first.
 *
 *   $env:ZHIYIN_BLENDER = "…\blender.exe"; npx vitest run --project system-boundary packages/feature/blender-studio/system-boundary/real-blender-scatter.test.ts
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

const cube = (name: string, size: number[], location: number[]) => ({
  name,
  kind: "cube",
  size,
  location,
});

/**
 * A ground of 10 by 10 m: level where x is below 0 and rising at 45° where
 * it is above, its faces Grass where y is below 0 and Dirt where it is above.
 */
const levelAndSlope = `
import bpy, bmesh
bm = bmesh.new()
n = 20
at = {}
for i in range(n + 1):
    for j in range(n + 1):
        x, y = -5 + 10 * i / n, -5 + 10 * j / n
        at[i, j] = bm.verts.new((x, y, max(0.0, x)))
for i in range(n):
    for j in range(n):
        face = bm.faces.new((at[i, j], at[i + 1, j], at[i + 1, j + 1], at[i, j + 1]))
        face.material_index = 0 if j < n // 2 else 1
mesh = bpy.data.meshes.new("Ground")
bm.to_mesh(mesh)
bm.free()
for name in ("Grass", "Dirt"):
    mesh.materials.append(bpy.data.materials.new(name))
bpy.context.scene.collection.objects.link(bpy.data.objects.new("Ground", mesh))
`;

describe.runIf(blender)("scattering objects in a real Blender", () => {
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
  const scatter = (args: Record<string, unknown>) =>
    call("blender_scatter", args);
  /** Runs a script that prints one line of JSON after RESULT, and reads it. */
  const read = async <T>(code: string): Promise<T> => {
    const ran = await call("blender_run_script", { code });
    expect(ran.failed, ran.said).toBe(false);
    const found = /RESULT (.*)/.exec(ran.said);
    expect(found, ran.said).not.toBeNull();
    return JSON.parse(found![1]!) as T;
  };
  const fresh = async (objects: Record<string, unknown>[], ground = "") => {
    const cleared = await call("blender_run_script", {
      code:
        "import bpy\nfor o in list(bpy.data.objects): bpy.data.objects.remove(o)\n" +
        "for c in list(bpy.data.collections): bpy.data.collections.remove(c)\n" +
        "for m in list(bpy.data.materials): bpy.data.materials.remove(m)\n" +
        ground,
    });
    expect(cleared.failed, cleared.said).toBe(false);
    if (objects.length) {
      const added = await call("blender_add_objects", { objects });
      expect(added.failed, added.said).toBe(false);
    }
  };
  /** Where each copy in a scatter's collection stands: its origin and the bottom of its shape. */
  const copiesOf = (collection: string) =>
    read<{ name: string; x: number; y: number; z: number; low: number }[]>(`
import bpy, json
from mathutils import Vector
found = []
for o in bpy.data.collections[${JSON.stringify(collection)}].objects:
    low = min((o.matrix_world @ Vector(c)).z for c in o.bound_box)
    found.append({"name": o.name, "x": o.location.x, "y": o.location.y, "z": o.location.z, "low": low})
print("RESULT " + json.dumps(found))
`);

  beforeAll(async () => {
    const root = await folders.make("zhiyin-studio-scatter-");
    const workspace = join(root, "workspace");
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
    tools = sceneAutomation(scenes.scene("scatter"), {
      workspaceRoot: () => workspace,
      blender: async () => blender,
      directory: scenes.directory("scatter"),
    });
    await call("blender_open_scene", { path: "scatter.blend", create: true });
  });

  afterAll(async () => {
    await scenes.forget("scatter");
    await scenes.closeAll();
    await folders.removeAll();
  });

  it("scatters linked copies by count, their footprints apart, standing on the ground, and says how they lie", async () => {
    await fresh([
      { name: "Ground", kind: "plane", size: [10, 10] },
      cube("Rock", [0.4, 0.3, 0.2], [20, 0, 0.1]),
      {
        name: "Pebble",
        kind: "sphere",
        size: [0.2, 0.2, 0.2],
        location: [22, 0, 0.1],
      },
    ]);

    const scattered = await scatter({
      items: ["Rock", "Pebble"],
      onto: "Ground",
      count: 40,
      jitter: { seed: 7, scale: [0.8, 1.2] },
    });

    expect(scattered.failed, scattered.said).toBe(false);
    expect(scattered.said).toContain(
      "Scattered 40 of 40 asked over Ground as linked copies in the collection Scatter of Rock and Pebble on Ground:",
    );
    const shares = /: (\d+) of Rock, (\d+) of Pebble\./.exec(scattered.said);
    expect(shares, scattered.said).not.toBeNull();
    expect(Number(shares![1]) + Number(shares![2])).toBe(40);
    expect(scattered.said).toMatch(
      /Tried [\d,]+ points: removed [\d,]+ by collisions between footprints\./,
    );
    expect(scattered.said).toContain("No copy goes into another object.");
    expect(scattered.said).toContain(
      "The scene now has 43 objects and 0 instances.",
    );
    const least = /Least gap between footprints: ([\d.]+) mm,/.exec(
      scattered.said,
    );
    expect(least, scattered.said).not.toBeNull();

    // Measured apart from the answer: each footprint is the circle round the
    // copy's own box seen from above, at its scale, and no two overlap.
    const measured = await read<{
      shared: boolean;
      least: number;
      lowest: number;
      highest: number;
    }>(`
import bpy, json, math
copies = list(bpy.data.collections["Scatter of Rock and Pebble on Ground"].objects)
shared = all(o.data in (bpy.data.objects["Rock"].data, bpy.data.objects["Pebble"].data) for o in copies)
def radius(o):
    xs = [c[0] for c in o.bound_box]; ys = [c[1] for c in o.bound_box]
    return math.hypot((max(xs) - min(xs)) * o.scale.x, (max(ys) - min(ys)) * o.scale.y) / 2
least = min(
    math.hypot(a.location.x - b.location.x, a.location.y - b.location.y) - radius(a) - radius(b)
    for i, a in enumerate(copies) for b in copies[i + 1:]
)
lows = [min((o.matrix_world @ __import__("mathutils").Vector(c)).z for c in o.bound_box) for o in copies]
print("RESULT " + json.dumps({"shared": shared, "least": least, "lowest": min(lows), "highest": max(lows)}))
`);
    expect(measured.shared).toBe(true);
    expect(measured.least).toBeGreaterThanOrEqual(0);
    expect(Number(least![1])).toBeCloseTo(measured.least * 1000, 1);
    expect(measured.lowest).toBeCloseTo(0, 6);
    expect(measured.highest).toBeCloseTo(0, 6);
  });

  it("draws items by their weights, sinks each copy as asked, and says the slopes and the faces drawn against held", async () => {
    await fresh([
      { name: "Ground", kind: "plane", size: [10, 10] },
      cube("Rock A", [0.2, 0.2, 0.2], [20, 0, 0.1]),
      cube("Rock B", [0.2, 0.2, 0.2], [22, 0, 0.1]),
    ]);

    const scattered = await scatter({
      items: ["Rock A", "Rock B"],
      onto: "Ground",
      count: 30,
      weights: { "Rock A": 1, "Rock B": 0 },
      offset: 0.01,
      sink: [0.02, 0.05],
      jitter: { seed: 3 },
    });
    const unknown = await scatter({
      items: ["Rock A"],
      onto: "Ground",
      count: 3,
      weights: { Boulder: 2 },
    });

    expect(scattered.failed, scattered.said).toBe(false);
    expect(scattered.said).toContain(": 30 of Rock A, 0 of Rock B.");
    expect(scattered.said).toContain(
      "The copies stand on faces sloping 0°; each raised 10 mm along its up; each sunk 20 mm to 50 mm into the surface along its up, at random by seed 3.",
    );
    expect(scattered.said).toContain(
      "Faces: 180 drawn by the copies, 6 held in memory in the 1 item mesh the linked copies share.",
    );
    // Measured apart from the answer: each bottom lies 10 mm to 40 mm below the ground.
    const copies = await copiesOf("Scatter of Rock A and Rock B on Ground");
    expect(copies).toHaveLength(30);
    for (const copy of copies) {
      expect(copy.low, copy.name).toBeLessThanOrEqual(-0.01 + 1e-6);
      expect(copy.low, copy.name).toBeGreaterThanOrEqual(-0.04 - 1e-6);
    }
    expect(unknown.failed).toBe(true);
    expect(unknown.said).toContain(
      "weights names “Boulder”, which is not among the items: Rock A.",
    );
  });

  it("keeps copies to the material, slope and heights asked, and counts what each rule removed", async () => {
    await fresh(
      [
        {
          name: "Pebble",
          kind: "sphere",
          size: [0.1, 0.1, 0.1],
          location: [20, 0, 0.05],
        },
      ],
      levelAndSlope,
    );

    const onGrass = await scatter({
      items: ["Pebble"],
      onto: "Ground",
      count: 20,
      where: { material: "Grass", slope: [0, 10] },
      jitter: { seed: 3 },
    });
    const grass = await copiesOf("Scatter of Pebble on Ground");
    const high = await scatter({
      items: ["Pebble"],
      onto: "Ground",
      count: 15,
      where: { height: [1, 2] },
      jitter: { seed: 4 },
    });
    const highUp = await copiesOf("Scatter of Pebble on Ground");

    expect(onGrass.failed, onGrass.said).toBe(false);
    expect(onGrass.said).toContain(
      "Scattered 20 of 20 asked over Ground as linked copies in the collection Scatter of Pebble on Ground: 20 of Pebble.",
    );
    expect(onGrass.said).toMatch(
      /Tried [\d,]+ points: removed [\d,]+ by material, [\d,]+ by slope and [\d,]+ by collisions between footprints\./,
    );
    expect(grass).toHaveLength(20);
    for (const one of grass) {
      expect(one.x).toBeLessThanOrEqual(1e-6);
      expect(one.y).toBeLessThanOrEqual(1e-6);
      expect(one.low).toBeCloseTo(0, 6);
    }
    expect(high.failed, high.said).toBe(false);
    expect(high.said).toContain(
      "Replaced the earlier scatter of Pebble on Ground: its 20 copies are gone.",
    );
    expect(high.said).toMatch(/removed [\d,]+ by height and/);
    // Between 1 m and 2 m high the ground is only its 45° slope.
    expect(high.said).toContain("The copies stand on faces sloping 45°.");
    expect(onGrass.said).toContain("The copies stand on faces sloping 0°.");
    expect(highUp).toHaveLength(15);
    for (const one of highUp) {
      // Upright on the slope, each pebble's middle is straight above where it stands.
      expect(one.z - 0.05).toBeGreaterThanOrEqual(1 - 1e-6);
      expect(one.z - 0.05).toBeLessThanOrEqual(2 + 1e-6);
    }
  });

  it("keeps copies away from one object, near another and clear of a third", async () => {
    await fresh(
      [
        {
          name: "Pebble",
          kind: "sphere",
          size: [0.1, 0.1, 0.1],
          location: [20, 0, 0.05],
        },
        cube("House", [1, 1, 1], [-2.5, 2.5, 0.5]),
        {
          name: "Well",
          kind: "cylinder",
          size: [0.6, 0.6, 0.8],
          location: [-2.5, -2.5, 0.4],
        },
        cube("Path", [10, 0.6, 0.1], [0, -1.2, 0.05]),
      ],
      levelAndSlope,
    );

    const scattered = await scatter({
      items: ["Pebble"],
      onto: "Ground",
      count: 12,
      where: {
        slope: [0, 10],
        away_from: { objects: ["House"], distance: 1 },
        near: { objects: ["Well"], distance: 1.5 },
      },
      keep_clear: ["Path"],
      jitter: { seed: 5 },
    });
    const copies = await copiesOf("Scatter of Pebble on Ground");

    expect(scattered.failed, scattered.said).toBe(false);
    expect(scattered.said).toMatch(
      /removed [\d,]+ by slope, [\d,]+ by away_from, [\d,]+ by near, [\d,]+ by collisions between footprints and [\d,]+ by keep_clear\./,
    );
    expect(scattered.said).toContain("No copy goes into another object.");
    expect(copies).toHaveLength(12);
    for (const one of copies) {
      // House spans -3 to -2 across and 2 to 3 deep; the Well's round side is 0.3 m from its middle.
      const fromHouse = Math.hypot(
        Math.max(-3 - one.x, 0, one.x + 2),
        Math.max(2 - one.y, 0, one.y - 3),
      );
      expect(fromHouse).toBeGreaterThanOrEqual(1 - 1e-6);
      expect(Math.hypot(one.x + 2.5, one.y + 2.5) - 0.3).toBeLessThanOrEqual(
        1.5 + 1e-3,
      );
      // A pebble of 50 mm round is clear of the Path's strip, 0.9 to 1.5 m on the -y side.
      const fromPath = Math.max(-1.5 - one.y, 0, one.y + 0.9);
      expect(fromPath).toBeGreaterThanOrEqual(0.05 - 0.001);
    }
  });

  it("refuses a scatter whose rules leave nowhere, saying what the surface has", async () => {
    await fresh(
      [
        {
          name: "Pebble",
          kind: "sphere",
          size: [0.1, 0.1, 0.1],
          location: [20, 0, 0.05],
        },
      ],
      levelAndSlope,
    );

    const steep = await scatter({
      items: ["Pebble"],
      onto: "Ground",
      count: 5,
      where: { slope: [60, 90] },
    });
    const missing = await scatter({
      items: ["Pebble"],
      onto: "Ground",
      count: 5,
      where: { material: "Sand" },
    });

    expect(steep.failed).toBe(true);
    expect(steep.said).toMatch(
      /Nothing was scattered on Ground: of the [\d,]+ points tried, slope removed every one; Ground's faces slope from 0° to 45°\./,
    );
    expect(missing.failed).toBe(true);
    expect(missing.said).toContain(
      "Ground has no material named “Sand”; its materials are Grass and Dirt.",
    );
  });

  it("says which copies go into the surface, as upright cubes on a slope do, and none when they follow it", async () => {
    await fresh([cube("Rock", [0.2, 0.2, 0.2], [20, 0, 0.1])], levelAndSlope);

    const upright = await scatter({
      items: ["Rock"],
      onto: "Ground",
      count: 8,
      where: { slope: [40, 50], height: [0.5, 4] },
      jitter: { seed: 2, turn: 0 },
    });
    const following = await scatter({
      items: ["Rock"],
      onto: "Ground",
      count: 8,
      where: { slope: [40, 50], height: [0.5, 4] },
      align: "surface",
      jitter: { seed: 2, turn: 0 },
    });

    expect(upright.failed, upright.said).toBe(false);
    expect(upright.said).toContain(
      "8 copies go into another object: 8 into Ground.",
    );
    // The uphill corners of a cube 200 mm across stand 100 mm under a 45° slope: 70.71 mm straight in.
    const deepest = /Deepest: Rock \d+ goes ([\d.]+) mm into Ground/.exec(
      upright.said,
    );
    expect(deepest, upright.said).not.toBeNull();
    expect(Number(deepest![1])).toBeCloseTo(70.71, 0);
    expect(following.failed, following.said).toBe(false);
    expect(following.said).toContain("No copy goes into another object.");
  });

  it("places instances measured as Blender evaluated them, and a second scatter replaces them", async () => {
    await fresh([
      { name: "Ground", kind: "plane", size: [10, 10] },
      cube("Rock", [0.3, 0.2, 0.1], [20, 0, 0.05]),
    ]);

    const placed = await scatter({
      items: ["Rock"],
      onto: "Ground",
      count: 50,
      as: "instances",
      jitter: { seed: 1, scale: [0.5, 1.5] },
    });
    const described = await call("blender_describe_scene", {
      objects: ["Scatter of Rock on Ground"],
    });
    const evaluated = await read<{
      count: number;
      lowest: number;
      highest: number;
      least: number;
    }>(`
import bpy, json, math
from mathutils import Vector
graph = bpy.context.evaluated_depsgraph_get()
rock = bpy.data.objects["Rock"]
found = []
for one in graph.object_instances:
    if one.is_instance and one.parent and one.parent.original.name == "Scatter of Rock on Ground":
        m = one.matrix_world.copy()
        low = min((m @ v.co).z for v in rock.data.vertices)
        found.append((m, low))
def radius(m):
    s = m.to_scale()
    return math.hypot(0.3 * s.x, 0.2 * s.y) / 2
def foot(m):
    return m @ Vector((0, 0, 0))
least = min(
    math.hypot(foot(a)[0] - foot(b)[0], foot(a)[1] - foot(b)[1]) - radius(a) - radius(b)
    for i, (a, _) in enumerate(found) for b, _ in found[i + 1:]
)
print("RESULT " + json.dumps({"count": len(found), "lowest": min(l for _, l in found), "highest": max(l for _, l in found), "least": least}))
`);
    const density = await scatter({
      items: ["Rock"],
      onto: "Ground",
      density: 0.2,
      jitter: { seed: 1 },
    });
    const gone = await read<{
      placer: boolean;
      nodes: boolean;
      copies: number;
    }>(`
import bpy, json
print("RESULT " + json.dumps({
    "placer": bpy.data.objects.get("Scatter of Rock on Ground") is not None,
    "nodes": bpy.data.node_groups.get("Scatter of Rock on Ground") is not None,
    "copies": len(bpy.data.collections["Scatter of Rock on Ground"].objects),
}))
`);

    expect(placed.failed, placed.said).toBe(false);
    expect(placed.said).toContain(
      "Scattered 50 of 50 asked over Ground as instances placed by Scatter of Rock on Ground: 50 of Rock.",
    );
    expect(placed.said).toContain(
      "No copy goes into another object, measured on the 50 instances Blender evaluated.",
    );
    expect(placed.said).toContain(
      "The scene now has 3 objects and 50 instances.",
    );
    expect(described.said).toContain("places 50 instances of Rock");
    expect(described.said).toContain("Objects (1, placing 50 instances):");
    expect(evaluated.count).toBe(50);
    expect(evaluated.lowest).toBeCloseTo(0, 6);
    expect(evaluated.highest).toBeCloseTo(0, 6);
    expect(evaluated.least).toBeGreaterThanOrEqual(-1e-6);
    expect(density.failed, density.said).toBe(false);
    expect(density.said).toContain(
      "Replaced the earlier scatter of Rock on Ground: its 50 instances are gone.",
    );
    expect(density.said).toContain(
      "Scattered 20 of 20 asked, 0.2 per m² over the 100 m² of Ground the rules leave, as linked copies in the collection Scatter of Rock on Ground: 20 of Rock.",
    );
    expect(density.said).toContain(
      "The scene now has 22 objects and 0 instances.",
    );
    expect(gone).toEqual({ placer: false, nodes: false, copies: 20 });
  });

  it("says when no more fit, and refuses more objects than it makes", async () => {
    await fresh([
      { name: "Ground", kind: "plane", size: [1, 1] },
      cube("Rock", [0.3, 0.3, 0.1], [20, 0, 0.05]),
    ]);

    const crowded = await scatter({
      items: ["Rock"],
      onto: "Ground",
      count: 200,
      jitter: { seed: 1 },
    });
    const tooMany = await scatter({
      items: ["Rock"],
      onto: "Ground",
      count: 2000,
    });

    expect(crowded.failed, crowded.said).toBe(false);
    const placed = /Scattered (\d+) of 200 asked over Ground/.exec(
      crowded.said,
    );
    expect(placed, crowded.said).not.toBeNull();
    expect(Number(placed![1])).toBeLessThan(200);
    expect(crowded.said).toContain(
      "No more fit after the 20,000 points tried: ask for fewer, a smaller spacing or looser rules.",
    );
    expect(tooMany.failed).toBe(true);
    expect(tooMany.said).toContain(
      "As objects, a scatter makes at most 1,000 copies; for more, scatter them as instances.",
    );
  });
});
