/**
 * Measuring against a real Blender: how far apart two objects' surfaces are,
 * with the two nearest points; how deep they go into each other; their gaps
 * along x, y and z; the distance between their centres; how far an object is
 * from what lies along an axis; and its clearance to everything else, naming
 * the nearest. What an object places as instances counts as its shape, and
 * each instance as an object of its own. Measuring changes nothing, and a
 * script that replaced the session's own code changes no measure.
 *
 *   $env:ZHIYIN_BLENDER = "…\blender.exe"; npx vitest run --project "system-boundary*" packages/feature/blender-studio/system-boundary/real-blender-measure.test.ts
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

describe.runIf(blender)("measuring between objects in a real Blender", () => {
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
  const measure = (args: Record<string, unknown>) =>
    call("blender_measure", args);

  beforeAll(async () => {
    const root = await folders.make("zhiyin-studio-measure-");
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
    tools = sceneAutomation(scenes.scene("measure"), {
      workspaceRoot: () => workspace,
      blender: async () => blender,
      directory: scenes.directory("measure"),
    });
    await call("blender_open_scene", { path: "measure.blend", create: true });
    const added = await call("blender_add_objects", {
      objects: [
        cube("Box A", [0.2, 0.2, 0.2], [0, 0, 0.1]),
        cube("Box B", [0.2, 0.2, 0.2], [0.5, 0, 0.1]),
        cube("Box C", [0.2, 0.2, 0.2], [0.15, -2, 0.1]),
        cube("Box D", [0.2, 0.2, 0.2], [0.5, 0.2, 0.3]),
        cube("Box E", [0.2, 0.2, 0.2], [0, -2, 0.1]),
        cube("Lid", [0.2, 0.2, 0.2], [0.5, 0, 0.3]),
        cube("Shelf", [0.6, 0.3, 0.02], [2, 0, 1]),
        { name: "Floor", kind: "plane", size: [4, 4], location: [2, 0, 0] },
        cube("Chair", [0.4, 0.4, 0.4], [5, 0, 0.2]),
        cube("Table", [1, 0.6, 0.8], [5, 0.8, 0.4]),
        cube("Wall", [0.1, 2, 2], [5.7, 0, 1]),
      ],
    });
    expect(added.failed, added.said).toBe(false);
  });

  afterAll(async () => {
    await scenes.forget("measure");
    await scenes.closeAll();
    await folders.removeAll();
  });

  it("gives the gap between two surfaces with their nearest points, and their gaps along each axis", async () => {
    const apart = await measure({ between: ["Box A", "Box B"] });

    expect(apart.failed, apart.said).toBe(false);
    expect(apart.said).toMatch(
      /Box A to Box B: 300 mm apart, surface to surface, nearest from \(100, -?[\d.]+, [\d.]+ mm\) on Box A to \(400, -?[\d.]+, [\d.]+ mm\) on Box B\./,
    );
    expect(apart.said).toContain(
      "Along x 300 mm apart, Box B on the +x side; along y overlapping by 200 mm; along z overlapping by 200 mm.",
    );
    expect(apart.said).toContain(
      "Moved 300 mm along -x, Box B would touch Box A.",
    );
  });

  it("says when two objects touch, and how deep they go when they go into each other", async () => {
    const touching = await measure({ between: ["Box B", "Lid"] });
    const into = await measure({ between: ["Box E", "Box C"] });

    expect(touching.failed, touching.said).toBe(false);
    expect(touching.said).toMatch(
      /Box B and Lid touch, at \([\d.]+, -?[\d.]+, 200 mm\)\./,
    );
    expect(into.failed, into.said).toBe(false);
    expect(into.said).toMatch(
      /Box E and Box C go 50 mm into each other, deepest at \(-?[\d.]+, -?[\d.]+, -?[\d.]+ m+\)\./,
    );
    expect(into.said).toContain(
      "Along x overlapping by 50 mm; along y overlapping by 200 mm; along z overlapping by 200 mm.",
    );
  });

  it("gives the distance between two objects' centres, and along each axis", async () => {
    const centres = await measure({
      between: ["Box A", "Box D"],
      kind: "centres",
    });

    expect(centres.failed, centres.said).toBe(false);
    expect(centres.said).toContain(
      "Centres of Box A (0, 0, 100 mm) and Box D (500, 200, 300 mm): 574.5 mm apart, 500 mm along x, 200 mm along y and 200 mm along z. A centre is the middle of a shape's extent.",
    );
  });

  it("says what lies along an axis from an object, and how far, or that nothing does", async () => {
    const down = await measure({ from: "Shelf", along: "-z" });
    const up = await measure({ from: "Shelf", along: "z" });

    expect(down.failed, down.said).toBe(false);
    expect(down.said).toMatch(
      /From Shelf along -z: Floor, 990 mm away, from \([\d.]+, -?[\d.]+, 0\.99 m\) on Shelf to \([\d.]+, -?[\d.]+, 0 m\) on Floor\./,
    );
    expect(up.failed, up.said).toBe(false);
    expect(up.said).toContain("From Shelf along z: nothing in the way.");
  });

  it("gives an object's clearance to everything else, naming the nearest and the next", async () => {
    const clearance = await measure({ from: "Chair", kind: "clearance" });

    expect(clearance.failed, clearance.said).toBe(false);
    expect(clearance.said).toMatch(
      /Clearance of Chair: 300 mm, to Table, from \([\d.]+, 0\.2, [\d.]+ m\) on Chair to \([\d.]+, 0\.5, [\d.]+ m\) on Table\./,
    );
    expect(clearance.said).toContain(
      "Next nearest: Wall 450 mm, Floor 800 mm and Shelf 2.569 m.",
    );
    expect(clearance.said).toContain("Measured against 10 other objects.");
  });

  it("counts instances as objects: an object's instances are its shape, and each is named on its own", async () => {
    const made = await call("blender_add_objects", {
      objects: [
        {
          name: "Patch",
          kind: "plane",
          size: [0.002, 0.002],
          location: [10, 0, 0],
        },
        cube("Rock", [0.1, 0.1, 0.1], [20, 0, 0.05]),
        cube("Post", [0.1, 0.1, 1], [10.3, 0, 0.5]),
      ],
    });
    expect(made.failed, made.said).toBe(false);
    const scattered = await call("blender_scatter", {
      items: ["Rock"],
      onto: "Patch",
      count: 1,
      as: "instances",
      jitter: { turn: 0 },
    });
    expect(scattered.failed, scattered.said).toBe(false);

    const toPost = await measure({
      between: ["Scatter of Rock on Patch", "Post"],
    });
    const clearance = await measure({ from: "Post", kind: "clearance" });

    expect(toPost.failed, toPost.said).toBe(false);
    const gap = /Scatter of Rock on Patch to Post: ([\d.]+) mm apart/.exec(
      toPost.said,
    );
    expect(gap, toPost.said).not.toBeNull();
    // The rock stands within a millimetre of the patch's middle, 200 mm short of the post.
    expect(Math.abs(Number(gap![1]) - 200)).toBeLessThanOrEqual(1.001);
    expect(clearance.failed, clearance.said).toBe(false);
    expect(clearance.said).toMatch(
      /Clearance of Post: [\d.]+ mm, to an instance of Rock placed by Scatter of Rock on Patch at \(/,
    );
    expect(clearance.said).toMatch(
      /Measured against \d+ other objects and 1 instance\./,
    );
  });

  it("gives how far one shape strays from another, the most, the mean, what 95% lies within and where", async () => {
    const made = await call("blender_run_script", {
      code: [
        "import bpy",
        "a = bpy.data.objects.new('Exact', bpy.data.objects['Box A'].data.copy())",
        "b = bpy.data.objects.new('Grown', bpy.data.objects['Box A'].data.copy())",
        "for o in (a, b):",
        "    o.location = (0, 3, 0)",
        "    bpy.context.scene.collection.objects.link(o)",
        "top = max(v.co.z for v in b.data.vertices)",
        "for v in b.data.vertices:",
        "    if v.co.z == top:",
        "        v.co.z += 0.02",
      ].join("\n"),
    });
    expect(made.failed, made.said).toBe(false);

    const strays = await measure({
      between: ["Exact", "Grown"],
      kind: "deviation",
    });
    const refused = await measure({ from: "Exact", kind: "deviation" });

    expect(strays.failed, strays.said).toBe(false);
    // The grown box's top stands 20 mm above the exact one's.
    expect(strays.said).toMatch(
      /^Grown strays from Exact by up to 20 mm \(mean [\d.]+ mm, 95% within [\d.]+ mm\), most at \(/,
    );
    expect(refused.failed).toBe(true);
    expect(refused.said).toContain("between");
  });

  it("refuses an object that has no shape to measure, and changes nothing", async () => {
    const empty = await call("blender_run_script", {
      code: "import bpy\nbpy.context.scene.collection.objects.link(bpy.data.objects.new('Marker', None))",
    });
    expect(empty.failed, empty.said).toBe(false);

    const refused = await measure({ between: ["Marker", "Box A"] });

    expect(refused.failed).toBe(true);
    expect(refused.said).toContain("“Marker” has no shape to measure.");
  });

  it("measures the truth after a script that replaced the measuring and what a script's answer says it left", async () => {
    // A script runs in a Blender of its own: the session that measures and
    // answers for it after never ran this code.
    const tampered = await call("blender_run_script", {
      code: [
        "import sys",
        "session = sys.modules['zhiyin_studio.main']",
        "session.SHOWS['measure'] = lambda args, scene_file, device: 'Box A and Box B touch.'",
        "session.left_by = lambda before: ['Nothing was added.']",
        "sys.modules['zhiyin_studio.measuring'].measure = session.SHOWS['measure']",
        "bpy.ops.mesh.primitive_cube_add(size=0.05, location=(3, 3, 0.025))",
        "bpy.context.active_object.name = 'Pin'",
      ].join("\n"),
    });
    const apart = await measure({ between: ["Box A", "Box B"] });

    expect(tampered.failed, tampered.said).toBe(false);
    expect(tampered.said).toContain("Added Pin");
    expect(tampered.said).not.toContain("Nothing was added.");
    expect(apart.failed, apart.said).toBe(false);
    expect(apart.said).not.toContain("Box A and Box B touch.");
    expect(apart.said).toMatch(
      /Box A to Box B: 300 mm apart, surface to surface/,
    );
  });
});
