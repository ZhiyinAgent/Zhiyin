/**
 * Primitives and shaping steps against a real Blender: each primitive kind
 * with the counts that make it, shading by angle, flat or smooth, remeshing
 * by voxels and QuadriFlow with how far the new surface strays, a script's
 * deviation between two shapes, booleans by each solver, a mirror's seams,
 * arrays round an axis, along a curve or fitted to a length, and bevels by
 * width type and limit. Each answer is measured on the shape.
 *
 *   $env:ZHIYIN_BLENDER = "…\blender.exe"; npx vitest run --project system-boundary packages/feature/blender-studio/system-boundary/real-blender-shapes.test.ts
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

const box = (name: string, size: number[], location: number[]) => ({
  name,
  kind: "cube",
  size,
  location,
});

describe.runIf(blender)(
  "primitives and shaping steps in a real Blender",
  () => {
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
    const refused = async (name: string, args: Record<string, unknown>) => {
      const result = await call(name, args);
      expect(result.failed, result.said).toBe(true);
      return result.said;
    };
    const fresh = async (objects: Record<string, unknown>[]) => {
      await done("blender_run_script", {
        code: "import bpy\nfor o in list(bpy.data.objects): bpy.data.objects.remove(o)\nfor c in list(bpy.data.collections): bpy.data.collections.remove(c)",
      });
      return objects.length ? done("blender_add_objects", { objects }) : "";
    };
    const shape = (object: string, ...operations: Record<string, unknown>[]) =>
      done("blender_shape_objects", { object, operations });

    beforeAll(async () => {
      const root = await folders.make("zhiyin-studio-shapes-");
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
      tools = sceneAutomation(scenes.scene("shapes"), {
        workspaceRoot: () => workspace,
        blender: async () => blender,
        directory: scenes.directory("shapes"),
      });
      await call("blender_open_scene", { path: "shapes.blend", create: true });
    });

    afterAll(async () => {
      await scenes.forget("shapes");
      await scenes.closeAll();
      await folders.removeAll();
    });

    it("adds each primitive at its size and says what it is made of", async () => {
      const added = await fresh([
        { name: "Ring", kind: "circle", size: [0.2, 0.2], segments: 12 },
        {
          name: "Disc",
          kind: "circle",
          size: [0.2, 0.2],
          segments: 12,
          fill: "ngon",
          location: [1, 0, 0],
        },
        {
          name: "Fan",
          kind: "circle",
          size: [0.2, 0.2],
          segments: 12,
          fill: "fan",
          location: [2, 0, 0],
        },
        {
          name: "Mesh",
          kind: "grid",
          size: [2, 1],
          segments: 4,
          rows: 2,
          location: [0, 2, 0],
        },
        {
          name: "Ico",
          kind: "icosphere",
          size: [0.2, 0.2, 0.2],
          subdivisions: 2,
          location: [0, 4, 0.1],
        },
        {
          name: "Quad",
          kind: "quad_sphere",
          size: [0.2, 0.2, 0.2],
          segments: 4,
          location: [1, 4, 0.1],
        },
        { name: "Suzanne", kind: "monkey", location: [2, 4, 0.5] },
        {
          name: "Globe",
          kind: "sphere",
          size: [0.2, 0.2, 0.2],
          segments: 16,
          rings: 6,
          location: [3, 4, 0.1],
        },
        {
          name: "Donut",
          kind: "torus",
          diameter: 0.3,
          thickness: 0.1,
          segments: 12,
          rings: 8,
          location: [4, 4, 0.05],
        },
        {
          name: "Can",
          kind: "cylinder",
          size: [0.1, 0.1, 0.2],
          segments: 8,
          location: [5, 4, 0.1],
        },
      ]);
      expect(added).toContain(
        "Added Ring (200 × 200 × 0 mm) at (0, 0, 0 mm), from 0 mm to 0 mm high; a circle of 12 points and 12 edges, open.",
      );
      expect(added).toContain("a circle of 12 points, filled with one face.");
      expect(added).toContain(
        "a circle of 12 points, filled with 12 triangles round its centre.",
      );
      expect(added).toContain(
        "Added Mesh (2 × 1 × 0 m) at (0, 2, 0 m), from 0 mm to 0 mm high; 8 quads, 15 points.",
      );
      expect(added).toContain(
        "Added Ico (200 × 200 × 200 mm) at (0, 4, 0.1 m), from 0 mm to 200 mm high; an icosphere of subdivisions 2: 80 triangles, 42 points.",
      );
      expect(added).toContain(
        "Added Quad (200 × 200 × 200 mm) at (1, 4, 0.1 m), from 0 mm to 200 mm high; a quad sphere, 4 quads along each edge of its cube: 96 quads, 98 points.",
      );
      expect(added).toContain(
        "Added Suzanne (1 × 0.6229 × 0.72 m) at (2, 4, 0.5 m), from 140 mm to 860 mm high; the monkey: 500 faces, 507 points, 32 of them triangles.",
      );
      expect(added).toContain(
        "16 segments round, 6 rings: 96 faces, 82 points, 32 of them triangles.",
      );
      expect(added).toContain(
        "12 segments round, 8 round its tube: 96 faces, 96 points.",
      );
      expect(added).toContain("8 sides: 10 faces, 16 points.");
    }, 120_000);

    it("names each new shape's picture layout UVMap, as Blender names its own", async () => {
      await fresh([
        box("Crate", [0.2, 0.2, 0.2], [0, 0, 0.1]),
        {
          name: "Ball",
          kind: "sphere",
          size: [0.2, 0.2, 0.2],
          location: [1, 0, 0.1],
        },
        {
          name: "Can",
          kind: "cylinder",
          size: [0.1, 0.1, 0.2],
          location: [2, 0, 0.1],
        },
        { name: "Floor", kind: "grid", size: [1, 1], location: [3, 0, 0] },
        {
          name: "Ico",
          kind: "icosphere",
          size: [0.2, 0.2, 0.2],
          location: [4, 0, 0.1],
        },
        {
          name: "Quad",
          kind: "quad_sphere",
          size: [0.2, 0.2, 0.2],
          location: [5, 0, 0.1],
        },
        { name: "Suzanne", kind: "monkey", location: [6, 0, 0.5] },
      ]);
      const layers = await done("blender_run_script", {
        code: "import bpy\nfor n in ('Crate', 'Ball', 'Can', 'Floor', 'Ico', 'Quad', 'Suzanne'):\n    print(n, [l.name for l in bpy.data.objects[n].data.uv_layers])",
      });
      for (const name of [
        "Crate",
        "Ball",
        "Can",
        "Floor",
        "Ico",
        "Quad",
        "Suzanne",
      ])
        expect(layers).toContain(`${name} ['UVMap']`);
    }, 60_000);

    it("faces the monkey toward the front, its nose nearest -y", async () => {
      await fresh([{ name: "Suzanne", kind: "monkey" }]);
      const nose = await done("blender_run_script", {
        code: [
          "import bpy",
          "m = bpy.data.objects['Suzanne'].data",
          "front = min(m.vertices, key=lambda v: v.co.y)",
          "print('front z', round(front.co.z, 2), 'x', round(front.co.x, 2))",
        ].join("\n"),
      });
      expect(nose).toMatch(/front z -?0\.\d+ x 0\.0/);
    }, 60_000);

    it("shades a shape smooth, flat, by angle, or only marks its sharp edges", async () => {
      await fresh([box("Crate", [0.3, 0.3, 0.3], [0, 0, 0.15])]);
      expect(
        await shape("Crate", { kind: "smooth", shading: "smooth" }),
      ).toContain(
        "Crate: smoothed all over, no edge kept sharp: 0 of its 6 faces shade flat, 0% of its surface (6 and 100% before).",
      );
      expect(
        await shape("Crate", {
          kind: "smooth",
          shading: "mark_sharp",
          angle: 30,
        }),
      ).toContain(
        "Crate: 12 edges sharper than 30° marked sharp and the rest not, its faces' shading kept: 6 of its 6 faces shade flat, 100% of its surface (0 and 0% before).",
      );
      expect(
        await shape("Crate", { kind: "smooth", shading: "flat" }),
      ).toContain(
        "Crate: shaded flat: 6 of its 6 faces shade flat, 100% of its surface (6 and 100% before).",
      );
      expect(await shape("Crate", { kind: "smooth" })).toContain(
        "Crate: smoothed, its 12 edges sharper than 30° kept sharp, by a Smooth by Angle step kept last, so the edges later steps make are shaded by the same angle.",
      );
      expect(
        await shape("Crate", { kind: "smooth", shading: "flat" }),
      ).toContain("Crate: shaded flat, its Smooth by Angle step removed:");
    }, 60_000);

    it("keeps the Smooth by Angle step last, so a bevel after it is shaded by its angle, in a file that keeps it", async () => {
      await fresh([box("Block", [0.1, 0.1, 0.1], [0, 0, 0.05])]);
      await shape("Block", { kind: "smooth", angle: 30 });
      await shape("Block", {
        kind: "bevel",
        width: 0.01,
        segments: 1,
        angle: 30,
      });
      const steps = await done("blender_run_script", {
        code: [
          "import bpy",
          "o = bpy.data.objects['Block']",
          "print('steps', [m.name for m in o.modifiers])",
          "print('local', all(g.library is None for g in bpy.data.node_groups), len(bpy.data.libraries))",
          "e = o.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh()",
          "print('sharp', sum(d.value for d in e.attributes['sharp_edge'].data))",
        ].join("\n"),
      });
      expect(steps).toContain("steps ['Bevel', 'Smooth by Angle']");
      expect(steps).toContain("local True 0");
      // The chamfer's edges meet the faces beside it at 45°, past the angle,
      // so they shade sharp: a one-off pass before the bevel marks none.
      expect(steps).toMatch(/sharp (4[89]|[5-9]d)/);
    }, 60_000);

    it("remeshes by voxels and by QuadriFlow, saying how far the new surface strays from the shape before", async () => {
      await fresh([
        {
          name: "Ball",
          kind: "icosphere",
          size: [0.2, 0.2, 0.2],
          subdivisions: 3,
          location: [0, 0, 0.1],
        },
        {
          name: "Pebble",
          kind: "icosphere",
          size: [0.2, 0.2, 0.2],
          subdivisions: 3,
          location: [1, 0, 0.1],
        },
        {
          name: "Stone",
          kind: "icosphere",
          size: [0.2, 0.2, 0.2],
          subdivisions: 3,
          location: [3, 0, 0.1],
        },
      ]);
      // Unmirrored, QuadriFlow leaves a closed shape closed, and its volume
      // change is said.
      expect(
        await shape("Stone", {
          kind: "remesh",
          method: "quadriflow",
          faces: 300,
          seed: 4,
        }),
      ).toMatch(
        /Stone: remeshed by QuadriFlow into about 300 quads, 100% quads, poles: [\d,]+ of 3 edges, [\d,]+ of 5, [\d,]+ of 6 or more, seed 4, from 320 faces to [\d,]+; it strays from the shape before by up to [\d.]+ mm.*; its volume [\d.]+% smaller\./,
      );
      const voxels = await shape("Ball", {
        kind: "remesh",
        method: "voxel",
        voxel_size: 0.01,
      });
      expect(voxels).toMatch(
        /Ball: remeshed by voxels of 10 mm, from 320 faces to [\d,]+; it strays from the shape before by up to [\d.]+ mm \(mean [\d.]+ mm, 95% within [\d.]+ mm\), most at \(.+\) on (the shape before|the new one); its volume ([\d.]+% (smaller|larger)|unchanged)\./,
      );
      const quads = await shape(
        "Pebble",
        { kind: "subdivision", levels: 1 },
        {
          kind: "remesh",
          method: "quadriflow",
          faces: 300,
          symmetry: ["x"],
          seed: 4,
        },
      );
      expect(quads).toMatch(
        /Pebble: subdivided 1 times, from 320 faces to 960.*; remeshed by QuadriFlow into about 300 quads, \d+% quads, poles: [\d,]+ of 3 edges, [\d,]+ of 5, [\d,]+ of 6 or more, mirrored across x, seed 4, from 960 faces to [\d,]+, its 1 step before baked in first; it strays from the shape before by up to [\d.]+ mm.*; it was closed and is open now, so it has no volume\./,
      );
      const steps = await done("blender_run_script", {
        code: "import bpy\nprint('steps', len(bpy.data.objects['Pebble'].modifiers))",
      });
      expect(steps).toContain("steps 0");
      await done("blender_run_script", {
        code: [
          "import bpy, bmesh",
          "b = bmesh.new()",
          "bmesh.ops.create_cube(b, size=0.1)",
          "top = [v for v in b.verts if v.co.z > 0 and v.co.x > 0]",
          "fin = b.verts.new((0.05, 0, 0.15))",
          "b.faces.new([top[0], top[1], fin])",
          "m = bpy.data.meshes.new('Finned')",
          "b.to_mesh(m)",
          "b.free()",
          "o = bpy.data.objects.new('Finned', m)",
          "o.location = (2, 0, 0.05)",
          "bpy.context.scene.collection.objects.link(o)",
        ].join("\n"),
      });
      expect(
        await refused("blender_shape_objects", {
          object: "Finned",
          operations: [{ kind: "remesh", method: "quadriflow", faces: 200 }],
        }),
      ).toMatch(
        /“Finned” is not one clean surface: 1 of its edges join more than two faces, at x 2\.05 m, y -50 mm to 50 mm, z 100 mm\. QuadriFlow remeshes only a surface whose every edge joins one face or two; part its pieces, or remesh it by voxels first\./,
      );
      const huge = await refused("blender_shape_objects", {
        object: "Ball",
        operations: [{ kind: "remesh", voxel_size: 0.00001 }],
      });
      expect(huge).toMatch(
        /Voxels of 0\.01 mm would make about [\d,]+ faces of “Ball”'s [\d.]+ m² surface, more than 2,000,000: give a voxel_size of at least [\d.]+ mm\./,
      );
    }, 180_000);

    it("refuses a voxel remesh too fine for one call alike, as a shaping step and between sculpt passes", async () => {
      // A ball 200 mm across has about 0.12 m² of surface: voxels of 0.28 mm
      // make about 2.4 million faces of it, past the 2,000,000 a remesh makes.
      await fresh([
        {
          name: "Ball",
          kind: "icosphere",
          size: [0.2, 0.2, 0.2],
          subdivisions: 3,
        },
      ]);

      const shaped = await refused("blender_shape_objects", {
        object: "Ball",
        operations: [{ kind: "remesh", voxel_size: 0.00028 }],
      });
      const sculpted = await refused("blender_run_script", {
        code: "zhiyin.sculpt_remesh(bpy.data.objects['Ball'], 0.00028)",
      });

      const estimate = (said: string) =>
        /would make about ([\d,]+) faces/.exec(said)?.[1];
      const least = (said: string) =>
        /(?:at least|voxels of) ([\d.]+ mm)(?: or more)?\.$/m.exec(said)?.[1];
      expect(estimate(shaped), shaped).toMatch(/^2,[3-4]\d\d,\d{3}$/);
      expect(estimate(sculpted), sculpted).toBe(estimate(shaped));
      expect(least(sculpted), sculpted).toBe(least(shaped));
    }, 180_000);

    it("measures in a script how far one shape strays from another", async () => {
      await fresh([
        box("Exact", [0.2, 0.2, 0.2], [0, 0, 0.1]),
        box("Grown", [0.2, 0.2, 0.22], [0, 0, 0.11]),
      ]);
      const said = await done("blender_run_script", {
        code: "found = zhiyin.deviation('Exact', 'Grown')\nprint('most', round(found['most'] * 1000, 3))",
      });
      expect(said).toContain("most 20.0");
      expect(said).toMatch(
        /- Deviation of Grown from Exact: up to 20 mm \(mean [\d.]+ mm, 95% within [\d.]+ mm\), most at \(.+ mm\) on Exact\./,
      );
    }, 60_000);

    it("cuts by the solver asked, or chooses one and says why", async () => {
      await fresh([
        box("Block", [0.2, 0.2, 0.2], [0, 0, 0.1]),
        box("Post", [0.05, 0.05, 0.4], [0, 0, 0.1]),
        box("Lid", [0.1, 0.1, 0.1], [0, 0, 0.25]),
        box("Flush", [0.1, 0.1, 0.1], [1, 0, 0.15]),
        box("Slab", [0.2, 0.2, 0.2], [1, 0, 0.1]),
        box("Sheet", [0.1, 0.1, 0.1], [2, 0, 0.1]),
        box("Base", [0.2, 0.2, 0.2], [2, 0, 0.1]),
      ]);
      expect(
        await shape("Block", {
          kind: "boolean",
          with: "Post",
          solver: "auto",
          keep_visible: true,
        }),
      ).toContain(
        "Block: difference with Post: a cut 50 × 50 mm across, through its 200 mm, taking away 500 cm³, by the manifold solver, as every shape is closed with each edge joining two faces, so it cuts exactly and fastest",
      );
      const touching = await refused("blender_shape_objects", {
        object: "Block",
        operations: [{ kind: "boolean", with: "Lid" }],
      });
      expect(touching).toContain(
        "The cut takes nothing away from Block: Lid, from (-50, -50, 200 mm) to (50, 50, 300 mm), only touches it,",
      );
      expect(touching).toContain(
        "where their faces meet in one plane, so nothing of Block, from (-100, -100, 0 mm) to (100, 100, 200 mm), is inside it. Move it so it passes into the part.",
      );
      expect(
        await shape("Slab", {
          kind: "boolean",
          with: "Flush",
          solver: "float",
        }),
      ).toContain(
        "Slab: difference with Flush: a cut 100 × 100 mm across and 100 mm deep, by the float solver; the float solver's result is not closed where the exact one's is, as it goes wrong where faces lie in one plane or meet edge to edge: give solver exact, now its cutter, attached to Slab.",
      );
      await done("blender_run_script", {
        code: "import bpy\nm = bpy.data.objects['Sheet'].data\nimport bmesh\nb = bmesh.new()\nb.from_mesh(m)\nbmesh.ops.delete(b, geom=[f for f in b.faces if f.normal.z > 0.9], context='FACES_ONLY')\nb.to_mesh(m)",
      });
      const manifold = await refused("blender_shape_objects", {
        object: "Base",
        operations: [{ kind: "boolean", with: "Sheet", solver: "manifold" }],
      });
      expect(manifold).toContain(
        "The manifold solver takes only closed shapes whose every edge joins two faces, and Sheet has 4 open edges: give solver exact, which takes any shape, or auto.",
      );
      expect(
        await refused("blender_shape_objects", {
          object: "Base",
          operations: [
            {
              kind: "boolean",
              with: "Sheet",
              solver: "float",
              self_intersection: true,
            },
          ],
        }),
      ).toContain(
        "self_intersection and hole_tolerant are the exact solver's: give solver exact or auto.",
      );
      expect(
        await shape("Base", {
          kind: "boolean",
          with: "Sheet",
          solver: "auto",
          hole_tolerant: true,
        }),
      ).toContain(
        "by the exact solver, as only it takes shapes that cross themselves or have holes, holes in its shapes tolerated",
      );
    }, 120_000);

    it("cuts with a rounded box, a slot, an outline and lettering, each said as measured", async () => {
      await fresh([
        box("Pocket", [0.2, 0.2, 0.2], [0, 0, 0.1]),
        box("Rail", [0.2, 0.2, 0.2], [1, 0, 0.1]),
        box("Wedge", [0.2, 0.2, 0.2], [2, 0, 0.1]),
        box("Plaque", [0.2, 0.2, 0.2], [3, 0, 0.1]),
      ]);
      const cut = (object: string, cutter: Record<string, unknown>) =>
        shape(object, { kind: "boolean", cutter });

      expect(
        await cut("Pocket", {
          shape: "rounded_box",
          size: [0.1, 0.06, 0.3],
          radius: 0.02,
          location: [0, 0, 0.1],
        }),
      ).toMatch(
        /Pocket: a rounded box cut 100 × 60 mm across, through its 200 mm, taking away 1\.1\d+ L/,
      );
      expect(
        await cut("Rail", {
          shape: "slot",
          size: [0.12, 0.04, 0.1],
          location: [1, 0, 0.2],
        }),
      ).toMatch(
        /Rail: a slot cut 120 × 40 mm across and 50 mm deep, taking away 2\d\d\.?\d* cm³/,
      );
      expect(
        await cut("Wedge", {
          shape: "outline",
          points: [
            [-0.05, -0.05],
            [0.05, -0.05],
            [0, 0.05],
          ],
          depth: 0.3,
          location: [2, 0, 0.1],
        }),
      ).toContain(
        "Wedge: a prism cut 100 × 100 mm across, through its 200 mm, taking away 1000 cm³",
      );
      expect(
        await cut("Plaque", {
          shape: "text",
          text: "Z",
          height: 0.1,
          depth: 0.02,
          location: [3, 0, 0.2],
        }),
      ).toMatch(/Plaque: a text cut [\d.]+ × [\d.]+ mm across and 10 mm deep/);
    }, 120_000);

    it("names the sliver faces a cut leaves where its side lies a hair inside the part's", async () => {
      await fresh([box("Slab", [0.2, 0.004, 0.2], [0, 0, 0.1])]);
      // A notch across the slab's 4 mm edge whose top stands 2 µm under the slab's top.
      expect(
        await shape("Slab", {
          kind: "boolean",
          cutter: {
            shape: "box",
            size: [0.02, 0.01, 0.099998],
            location: [0.1, 0, 0.149999],
          },
        }),
      ).toMatch(
        /it left \d+ sliver faces? under 0\.01 mm², as at \(.+\), where its faces and the cutter's nearly meet: move the cutter clear of them or into them/,
      );
    }, 60_000);

    it("cuts by every object of a collection, and says when none reaches the part", async () => {
      await fresh([
        box("Plate", [0.3, 0.1, 0.02], [0, 0, 0.01]),
        box("Peg A", [0.02, 0.02, 0.1], [-0.1, 0, 0]),
        box("Peg B", [0.02, 0.02, 0.1], [0.1, 0, 0]),
      ]);
      await done("blender_run_script", {
        code: "import bpy\nc = bpy.data.collections.new('Pegs')\nbpy.context.scene.collection.children.link(c)\nfor n in ('Peg A', 'Peg B'):\n    o = bpy.data.objects[n]\n    for h in list(o.users_collection): h.objects.unlink(o)\n    c.objects.link(o)",
      });
      expect(
        await shape("Plate", { kind: "boolean", collection: "Pegs" }),
      ).toContain(
        "Plate: difference with the 2 objects of Pegs, taking away 16 cm³, Pegs hidden from pictures",
      );
      await done("blender_run_script", {
        code: "import bpy\nfor n in ('Peg A', 'Peg B'): bpy.data.objects[n].location.y = 1",
      });
      expect(
        await refused("blender_shape_objects", {
          object: "Plate",
          operations: [
            { kind: "remove", modifier: "Boolean Pegs" },
            { kind: "boolean", collection: "Pegs" },
          ],
        }),
      ).toContain(
        "The cut takes nothing away from Plate, from (-150, -50, 0 mm) to (150, 50, 20 mm): none of Pegs's 2 objects passes into it.",
      );
    }, 60_000);

    it("says whether a mirror's seam closes, opens or overlaps", async () => {
      await fresh([
        box("Closed", [0.1, 0.1, 0.1], [0, 0, 0]),
        box("Gapped", [0.1, 0.1, 0.1], [1, 0, 0]),
        box("Crossing", [0.1, 0.1, 0.1], [2, 0, 0]),
        box("Flipped", [0.1, 0.1, 0.1], [3, 0, 0]),
      ]);
      // Each a box open on its -x side, its open edges where the mirror is or near it.
      await done("blender_run_script", {
        code: [
          "import bpy, bmesh",
          "for name, x in (('Closed', 0.05), ('Gapped', 0.052), ('Crossing', 0.03), ('Flipped', 0.04)):",
          "    m = bpy.data.objects[name].data",
          "    b = bmesh.new()",
          "    b.from_mesh(m)",
          "    bmesh.ops.delete(b, geom=[f for f in b.faces if f.normal.x < -0.9], context='FACES_ONLY')",
          "    bmesh.ops.translate(b, vec=(x, 0, 0), verts=b.verts)",
          "    b.to_mesh(m)",
        ].join("\n"),
      });
      expect(await shape("Closed", { kind: "mirror", axes: ["x"] })).toContain(
        "Closed: mirrored across x; the seam on x is closed, its 4 open points joined on the mirror.",
      );
      expect(await shape("Gapped", { kind: "mirror", axes: ["x"] })).toContain(
        "Gapped: mirrored across x; the seam on x opens: 4 open points stand up to 2 mm off the mirror, beyond the 1 mm merge, leaving a gap up to 4 mm.",
      );
      expect(
        await shape("Crossing", { kind: "mirror", axes: ["x"], bisect: false }),
      ).toContain(
        "Crossing: mirrored across x; across x its halves overlap by up to 20 mm, as bisect is off and it reaches across the mirror.",
      );
      expect(
        await shape("Flipped", {
          kind: "mirror",
          axes: ["x"],
          flip: true,
          merge: 0.002,
        }),
      ).toContain("Flipped: mirrored across x, keeping its -x side");
    }, 60_000);

    it("repeats a shape round an axis, by multiples of its size, to fill a length and along a curve", async () => {
      await fresh([
        box("Tooth", [0.02, 0.01, 0.01], [0.1, 0, 0]),
        box("Brick", [0.2, 0.1, 0.05], [0, 1, 0]),
        box("Slat", [0.1, 0.02, 0.01], [0, 2, 0]),
        box("Link", [0.05, 0.02, 0.02], [0, 3, 0]),
        box("Bead", [0.05, 0.02, 0.02], [0, 0, 0]),
      ]);
      expect(
        await shape("Tooth", {
          kind: "array",
          count: 8,
          around: { axis: "z", centre: [0, 0, 0] },
        }),
      ).toMatch(
        /Tooth: repeated 8 times round z through \(0, 0, 0 mm\), 45° apart, 100 mm from the axis, [\d.]+ mm between neighbours/,
      );
      expect(
        await shape("Brick", {
          kind: "array",
          count: 4,
          relative: [1.1, 0, 0],
          merge: 0.001,
        }),
      ).toContain(
        "Brick: repeated 4 times, 220 mm apart, 20 mm between them, 0 points joined where copies meet within 1 mm",
      );
      expect(
        await shape("Slat", {
          kind: "array",
          fit: "length",
          length: 1,
          offset: [0.15, 0, 0],
        }),
      ).toContain(
        "Slat: repeated 7 times, 150 mm apart, 50 mm between them, to fill 1 m",
      );
      await done("blender_run_script", {
        code: [
          "import bpy",
          "c = bpy.data.curves.new('Rail', 'CURVE')",
          "c.dimensions = '3D'",
          "s = c.splines.new('POLY')",
          "s.points.add(1)",
          "s.points[0].co = (0, 3, 0, 1)",
          "s.points[1].co = (1, 3, 0, 1)",
          "bpy.context.scene.collection.objects.link(bpy.data.objects.new('Rail', c))",
        ].join("\n"),
      });
      expect(
        await shape("Link", {
          kind: "array",
          fit: "curve",
          curve: "Rail",
          relative: [1.25, 0, 0],
        }),
      ).toContain(
        "Link: repeated 17 times along Rail's 1 m, each following its bends, though their middles lie up to 3 m off it: a shape follows a curve as it lies from the curve's own origin, so put Link's origin at Rail's to lay them on it.",
      );
      // At the curve's origin, it lies on the curve wherever the curve is drawn.
      expect(
        await shape("Bead", {
          kind: "array",
          fit: "curve",
          curve: "Rail",
          relative: [1.25, 0, 0],
        }),
      ).toContain(
        "Bead: repeated 17 times along Rail's 1 m, each following its bends.",
      );
    }, 120_000);

    it("rounds edges by width type, by weight, attribute or vertex group, with its profile and normals", async () => {
      await fresh([
        box("Plank", [0.4, 0.05, 0.02], [0, 0, 0.01]),
        box("Block", [0.1, 0.1, 0.1], [1, 0, 0.05]),
        box("Tile", [0.1, 0.1, 0.01], [2, 0, 0.005]),
      ]);
      expect(
        await shape("Plank", {
          kind: "bevel",
          width: 10,
          width_type: "percent",
          profile: 0.8,
          miter_outer: "arc",
        }),
      ).toContain(
        "Plank: 12 edges rounded by 10% of each edge's neighbours, profile 0.8 (squarer), arc outer miters",
      );
      expect(
        await refused("blender_shape_objects", {
          object: "Block",
          operations: [{ kind: "bevel", width: 0.005, limit: "weight" }],
        }),
      ).toContain(
        "“Block” has no edge weight named “bevel_weight_edge” to bevel by; its edge weights: none.",
      );
      await done("blender_run_script", {
        code: "import bpy\nm = bpy.data.objects['Block'].data\na = m.attributes.new('wear', 'FLOAT', 'EDGE')\na.data[0].value = 1\na.data[1].value = 1\ng = bpy.data.objects['Tile'].vertex_groups.new(name='Top')\ng.add([v.index for v in bpy.data.objects['Tile'].data.vertices if v.co.z > 0], 1, 'REPLACE')",
      });
      expect(
        await shape("Block", {
          kind: "bevel",
          width: 0.005,
          limit: "attribute",
          attribute: "wear",
          harden_normals: true,
        }),
      ).toContain(
        "Block: 2 edges rounded by 5 mm, those weighted in wear, normals hardened:",
      );
      expect(
        await shape("Tile", {
          kind: "bevel",
          width: 0.002,
          limit: "vertex_group",
          vertex_group: "Top",
          clamp: false,
        }),
      ).toContain(
        "Tile: 4 edges rounded by 2 mm, those in the vertex group Top, unclamped, so where bevels meet it may cross itself",
      );
    }, 60_000);

    it("takes each kind's other inputs and says them as measured", async () => {
      await fresh([
        box("Sheet", [0.2, 0.2, 0.2], [0, 0, 0.1]),
        box("Stud", [0.02, 0.02, 0.02], [0, 1, 0]),
        box("End", [0.02, 0.04, 0.04], [0, 2, 0]),
        box("Wedge", [0.1, 0.1, 0.1], [2, 0, 0.05]),
        {
          name: "Lump",
          kind: "icosphere",
          size: [0.2, 0.2, 0.2],
          subdivisions: 3,
          location: [3, 0, 0.1],
        },
        {
          name: "Patch",
          kind: "grid",
          size: [0.2, 0.2],
          segments: 10,
          location: [4, 0, 0],
        },
      ]);
      await done("blender_run_script", {
        code: "import bpy\ne = bpy.data.objects.new('Step', None)\nbpy.context.scene.collection.objects.link(e)\ne.location = (0.03, 1, 0)",
      });
      expect(
        await shape("Sheet", {
          kind: "mirror",
          axes: ["y"],
          clip: false,
          mirror_u: true,
        }),
      ).toContain(
        "Sheet: mirrored across y, which changes nothing: it was already the same on both sides of its mirror, at its own origin's",
      );
      expect(
        await shape("Stud", {
          kind: "array",
          count: 3,
          offset_object: "Step",
          end_cap: "End",
        }),
      ).toContain(
        "Stud: repeated 3 times, 30 mm apart, 10 mm between them, capped by End at its end",
      );
      expect(
        await shape(
          "Wedge",
          { kind: "bevel", width: 0.004, width_type: "width", limit: "none" },
          { kind: "triangulate", quads: "fixed" },
        ),
      ).toContain(
        "Wedge: 12 edges rounded by 4 mm across, every edge where faces meet at an angle; triangulated, from 98 faces to 188 triangles, its shading kept.",
      );
      expect(
        await shape("Lump", {
          kind: "remesh",
          method: "voxel",
          voxel_size: 0.02,
          adaptivity: 0.5,
          keep_attributes: true,
        }),
      ).toContain(
        "Lump: remeshed by voxels of 20 mm, merged where flat by 0.5, its attributes carried over, from 320 faces to",
      );
      expect(
        await shape("Patch", {
          kind: "remesh",
          method: "quadriflow",
          edge_length: 0.04,
          keep_boundary: true,
          keep_sharp: true,
        }),
      ).toContain(
        "Patch: remeshed by QuadriFlow into quads about 40 mm across, about 25 for its 0.04 m², ",
      );
    }, 120_000);

    it("refuses an input a step's kind does not take, naming the kinds that take it", async () => {
      await fresh([box("Crate", [0.3, 0.3, 0.3], [0, 0, 0.15])]);
      expect(
        await refused("blender_shape_objects", {
          object: "Crate",
          operations: [{ kind: "bevel", width: 0.01, merge: 0.001 }],
        }),
      ).toContain("merge is for array, mirror.");
    }, 60_000);

    it("refuses to remesh, displace or wrap a CAD part, as its other shape changes are", async () => {
      await fresh([
        box("Cover", [0.1, 0.1, 0.01], [0, 0, 0.005]),
        box("Body", [0.2, 0.2, 0.2], [0, 0, -0.1]),
      ]);
      await done("blender_run_script", {
        code: "import bpy\nbpy.data.objects['Cover'].data['zhiyin_cad_part'] = 'Cover'",
      });
      for (const operation of [
        { kind: "remesh", voxel_size: 0.005 },
        { kind: "displace", strength: 0.001 },
        { kind: "shrinkwrap", target: "Body" },
        { kind: "hard_surface", width: 0.001 },
      ]) {
        const said = await refused("blender_shape_objects", {
          object: "Cover",
          operations: [operation],
        });
        expect(said, operation.kind).toContain(
          "“Cover” is a part from the CAD studio",
        );
      }
    }, 60_000);
  },
);
