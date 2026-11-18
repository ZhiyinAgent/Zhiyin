/**
 * Unwrapping against a real Blender: a box laid flat along its sharp edges
 * and scaled to a texel density, a tube whose side is cut open where the
 * camera cannot see it, seams along material boundaries, a mirrored half
 * whose islands stack as mirror twins, each projection method, and what is
 * refused. Each answer says what the layout came to.
 *
 *   $env:ZHIYIN_BLENDER = "…\blender.exe"; npx vitest run --project system-boundary packages/feature/blender-studio/system-boundary/real-blender-unwrap.test.ts
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

describe.runIf(blender)("unwrapping objects in a real Blender", () => {
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
  const fresh = async (objects: Record<string, unknown>[]) => {
    await script(
      "import bpy\nfor o in list(bpy.data.objects): bpy.data.objects.remove(o)",
    );
    const added = await call("blender_add_objects", { objects });
    expect(added.failed, added.said).toBe(false);
    // Each layout goes by the name the answers below give it.
    await script(
      [
        "import bpy",
        "for m in bpy.data.meshes:",
        "    if m.uv_layers.active: m.uv_layers.active.name = 'UVMap'",
      ].join("\n"),
    );
  };

  beforeAll(async () => {
    const root = await folders.make("zhiyin-studio-unwrap-");
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
    tools = sceneAutomation(scenes.scene("unwrap"), {
      workspaceRoot: () => workspace,
      blender: async () => blender,
      directory: scenes.directory("unwrap"),
    });
    await call("blender_open_scene", { path: "unwrap.blend", create: true });
  });

  afterAll(async () => {
    await scenes.forget("unwrap");
    await scenes.closeAll();
    await folders.removeAll();
  });

  it("lays a box flat along its sharp edges at the texel density asked, and says what its layout came to", async () => {
    await fresh([
      {
        name: "Crate",
        kind: "cube",
        size: [0.4, 0.3, 0.2],
        location: [0, 0, 0.1],
      },
    ]);
    // The crate as it came from adding has no seams of its own.
    await script(
      "import bpy\nfor e in bpy.data.objects['Crate'].data.edges: e.use_seam = False",
    );

    const unwrapped = await call("blender_unwrap", {
      objects: ["Crate"],
      texel_density: { px_per_cm: 5, resolution: 1024 },
    });

    expect(unwrapped.failed, unwrapped.said).toBe(false);
    expect(unwrapped.said).toContain(
      "Crate: angle-based unwrapping on UVMap, seams on edges sharper than 60°, as it had none, packed with 4 px margins at 5 px/cm for 1024 px.",
    );
    expect(unwrapped.said).toContain(
      "Crate's layout: 6 islands; angles stretch 0° on average, 0° at most; areas stretch 0% on average, 0% at most; texel density 5 to 5 px/cm, median 5, at 1024 px; no faces turned over; no islands overlap; fills 0.12 of the tile, none outside it; 12 seam edges 3.6 m long, no camera to see it.",
    );
  });

  it("cuts a tube's side open on the side the camera cannot see", async () => {
    await fresh([
      {
        name: "Can",
        kind: "cylinder",
        size: [0.2, 0.2, 0.3],
        location: [0, 0, 0.15],
      },
    ]);
    await call("blender_set_camera", {
      location: [0, -1.5, 0.3],
      look_at: [0, 0, 0.15],
    });

    const unwrapped = await call("blender_unwrap", {
      objects: ["Can"],
      seams: { angle: 60 },
    });
    // Every edge the cut runs along lies on the far side from the camera.
    const cut = await script(
      [
        "import bpy",
        "o = bpy.data.objects['Can']",
        "m = o.data",
        "upright = [e for e in m.edges if e.use_seam and abs(m.vertices[e.vertices[0]].co.z - m.vertices[e.vertices[1]].co.z) > 1e-4]",
        "print('upright seams', len(upright), 'behind', all((o.matrix_world @ m.vertices[e.vertices[0]].co).y > 0.05 for e in upright))",
      ].join("\n"),
    );

    expect(unwrapped.failed, unwrapped.said).toBe(false);
    expect(unwrapped.said).toContain(
      "Can: angle-based unwrapping on UVMap, seams on edges sharper than 60°, 1 cut 300 mm long to lay its closed parts flat, where Camera sees least, packed with 4 px margins for 1024 px.",
    );
    expect(unwrapped.said).toMatch(
      /Can's layout: 3 islands; .*no faces turned over; no islands overlap; .*seam edges .* long, \d+% of it in view of Camera\./,
    );
    expect(cut).toContain("upright seams 1 behind True");
  });

  it("puts seams on the boundaries between materials", async () => {
    await fresh([
      {
        name: "Block",
        kind: "cube",
        size: [0.2, 0.2, 0.2],
        location: [0, 0, 0.1],
      },
    ]);
    // The top face has a material of its own.
    await script(
      [
        "import bpy",
        "o = bpy.data.objects['Block']",
        "o.data.materials.append(bpy.data.materials.new('Body'))",
        "o.data.materials.append(bpy.data.materials.new('Lid'))",
        "for p in o.data.polygons: p.material_index = 1 if p.normal.z > 0.5 else 0",
      ].join("\n"),
    );

    const unwrapped = await call("blender_unwrap", {
      objects: ["Block"],
      seams: { by: "material", hide: false },
    });

    expect(unwrapped.failed, unwrapped.said).toBe(false);
    expect(unwrapped.said).toContain(
      "Block: angle-based unwrapping on UVMap, seams on boundaries between its materials, packed with 4 px margins for 1024 px.",
    );
    expect(unwrapped.said).toMatch(/Block's layout: 2 islands;/);
  });

  it("names a mirror step's islands as mirror twins rather than faces turned over", async () => {
    await fresh([
      {
        name: "Half",
        kind: "cube",
        size: [0.1, 0.2, 0.2],
        location: [0.05, 0, 0.1],
      },
    ]);
    await script(
      [
        "import bpy",
        "o = bpy.data.objects['Half']",
        "m = o.modifiers.new('Mirror', 'MIRROR')",
        "m.mirror_object = None",
        "o.data.transform(__import__('mathutils').Matrix.Translation((0.05, 0, 0)))",
        "o.location.x = 0",
        // The face on the mirror plane would lie on its own mirror image.
        "import bmesh",
        "bm = bmesh.new(); bm.from_mesh(o.data)",
        "bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.normal.x < -0.5], context='FACES')",
        "bm.to_mesh(o.data); bm.free()",
      ].join("\n"),
    );

    const unwrapped = await call("blender_unwrap", {
      objects: ["Half"],
      method: "smart",
    });

    expect(unwrapped.failed, unwrapped.said).toBe(false);
    expect(unwrapped.said).toMatch(
      /Half's layout: 10 islands; .*no faces turned over; 5 pairs of islands stacked as mirror twins, as a mirror step lays them; fills/,
    );
  });

  it("unwraps by every projection, each saying what it laid", async () => {
    await fresh([
      {
        name: "Post",
        kind: "cylinder",
        size: [0.1, 0.1, 0.4],
        location: [0, 0, 0.2],
      },
    ]);
    await call("blender_set_camera", {
      location: [0, -1.5, 0.3],
      look_at: [0, 0, 0.2],
    });
    const said: Record<string, string> = {};
    for (const method of [
      "conformal",
      "minimum_stretch",
      "follow_quads",
      "smart",
      "cube",
      "cylinder",
      "sphere",
      "lightmap",
      "camera",
    ]) {
      const unwrapped = await call("blender_unwrap", {
        objects: ["Post"],
        method,
      });
      expect(unwrapped.failed, `${method}: ${unwrapped.said}`).toBe(false);
      said[method] = unwrapped.said;
    }

    expect(said["conformal"]).toContain("Post: conformal unwrapping on UVMap");
    expect(said["follow_quads"]).toContain(
      "Post: following its quads on UVMap",
    );
    expect(said["follow_quads"]).toContain(
      "faces not of four sides kept from angle-based unwrapping",
    );
    expect(said["lightmap"]).toMatch(/Post's layout: \d+ islands;/);
    expect(said["camera"]).toContain(
      "Post: projection from the camera on UVMap, as Camera sees it.",
    );
    expect(said["camera"]).not.toContain("packed");
    for (const method of ["smart", "cube", "cylinder", "sphere", "lightmap"])
      expect(said[method], method).toContain(
        "packed with 4 px margins for 1024 px",
      );
  });

  it("refuses seams for a projection that takes none, and an object with no mesh", async () => {
    await fresh([
      {
        name: "Box",
        kind: "cube",
        size: [0.2, 0.2, 0.2],
        location: [0, 0, 0.1],
      },
    ]);
    await script(
      [
        "import bpy",
        "path = bpy.data.objects.new('Path', bpy.data.curves.new('Path', 'CURVE'))",
        "bpy.context.scene.collection.objects.link(path)",
      ].join("\n"),
    );

    const seamed = await call("blender_unwrap", {
      objects: ["Box"],
      method: "cube",
      seams: { by: "material" },
    });
    const curve = await call("blender_unwrap", { objects: ["Path"] });
    const grouped = await call("blender_unwrap", {
      objects: ["Box"],
      seams: { by: "surface_group" },
    });

    expect(seamed.failed).toBe(true);
    expect(seamed.said).toContain(
      "cube projection lays the surface out without seams, so seams.by does nothing: leave it out.",
    );
    expect(curve.failed).toBe(true);
    expect(curve.said).toContain("“Path” is a curve, and this needs a mesh.");
    expect(grouped.failed).toBe(true);
    expect(grouped.said).toContain(
      "“Box” has no groups of surfaces: only a part from the CAD studio has them. Use by material, or angle.",
    );
  });
});
