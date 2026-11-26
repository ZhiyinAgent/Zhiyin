/**
 * The zhiyin library's sculpting, against a real Blender: brushes run along a
 * stroke on the mesh itself and say the points they moved, the most, the
 * volume change and any new self-crossings; detail is added where a stroke
 * needs it; filters work on the whole mesh; masks are vertex groups; a voxel
 * remesh, Multires levels sculpted on a copy and baked into maps, and a
 * symmetry measured and restored. Each refuses what it cannot do, saying why.
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

const fresh = [
  "import bmesh, bpy",
  "for old in list(bpy.data.objects): bpy.data.objects.remove(old)",
];
/** A flat 2 m sheet whose points lie 100 mm apart, 21 by 21, facing up. */
const sheet = [
  ...fresh,
  "verts = [(x / 10 - 1, y / 10 - 1, 0) for y in range(21) for x in range(21)]",
  "faces = [(y * 21 + x, y * 21 + x + 1, (y + 1) * 21 + x + 1, (y + 1) * 21 + x) for y in range(20) for x in range(20)]",
  "mesh = bpy.data.meshes.new('Sheet'); mesh.from_pydata(verts, [], faces); mesh.update()",
  "obj = bpy.data.objects.new('Sheet', mesh)",
  "bpy.context.scene.collection.objects.link(obj)",
  "def z_at(x, y): return round(min(obj.data.vertices, key=lambda v: (v.co.x - x) ** 2 + (v.co.y - y) ** 2).co.z * 1000, 3)",
];
/** A ball 1 m in radius of 642 points, closed. */
const ball = [
  ...fresh,
  "bm = bmesh.new()",
  "bmesh.ops.create_icosphere(bm, subdivisions=4, radius=1.0)",
  "mesh = bpy.data.meshes.new('Ball'); bm.to_mesh(mesh); bm.free()",
  "obj = bpy.data.objects.new('Ball', mesh)",
  "bpy.context.scene.collection.objects.link(obj)",
  "def volume():",
  "    bm = bmesh.new(); bm.from_mesh(obj.data); found = bm.calc_volume(); bm.free(); return found",
];

/** A ball 1 m in radius of 32 segments and 16 rings, the same on each side of x = 0. */
const round = [
  ...fresh,
  "bm = bmesh.new()",
  "bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=16, radius=1.0)",
  "mesh = bpy.data.meshes.new('Round'); bm.to_mesh(mesh); bm.free()",
  "obj = bpy.data.objects.new('Round', mesh)",
  "bpy.context.scene.collection.objects.link(obj)",
];

describe.runIf(blender)(
  "the zhiyin library's sculpting in a real Blender",
  () => {
    const folders = new TemporaryFolders();
    let scenes: ConversationScenes;
    let tools: ReturnType<typeof sceneAutomation>;
    const run = async (lines: string[]) => {
      const result = (await tools.callTool("blender_run_script", {
        code: lines.join("\n"),
      })) as Result;
      return {
        failed: result.isError === true,
        said: result.content.map((c) => c.text ?? "").join("\n"),
      };
    };

    beforeAll(async () => {
      const root = await folders.make("zhiyin-studio-sculpt-");
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
      tools = sceneAutomation(scenes.scene("sculpt"), {
        workspaceRoot: () => workspace,
        blender: async () => blender,
        directory: scenes.directory("sculpt"),
      });
      await tools.callTool("blender_open_scene", {
        path: "sculpt.blend",
        create: true,
      });
    });

    afterAll(async () => {
      await scenes.forget("sculpt");
      await scenes.closeAll();
      await folders.removeAll();
    });

    it("draws a bump under a stroke, falling off smoothly to its radius, and says what moved", async () => {
      const { failed, said } = await run([
        ...sheet,
        "zhiyin.sculpt(obj, 'draw', [[0, 0, 0]], radius=0.15, depth=0.01)",
        "print('heights', z_at(0, 0), z_at(0.1, 0), z_at(0.1, 0.1), z_at(0.2, 0))",
      ]);

      expect(failed, said).toBe(false);
      expect(said).toContain(
        "- Sculpted Sheet with draw at (0, 0, 0 mm), radius 150 mm, smooth falloff, depth 10 mm: 9 points moved, the most 10 mm at (0, 0, 10 mm); an open surface, so no volume; no new self-crossings.",
      );
      // Two thirds of the radius out, the smooth falloff keeps 1 − (3t² − 2t³) of the depth.
      expect(said).toContain("heights 10.0 2.593 0.094 0.0");
    });

    it("mirrors a stroke across the object's own x, carving inward with a negative depth", async () => {
      const { failed, said } = await run([
        ...sheet,
        "zhiyin.sculpt(obj, 'draw', [[0.5, 0, 0]], radius=0.15, depth=-0.01, mirror='x')",
        "print('heights', z_at(0.5, 0), z_at(-0.5, 0))",
      ]);

      expect(failed, said).toBe(false);
      expect(said).toContain(
        "- Sculpted Sheet with draw at (500, 0, 0 mm), radius 150 mm, smooth falloff, mirrored in x, depth -10 mm: 18 points moved, the most 10 mm at (-500, 0, -10 mm);",
      );
      expect(said).toContain("heights -10.0 -10.0");
    });

    it("leaves out a mirrored copy of a stroke that falls off the surface, and says so", async () => {
      const { failed, said } = await run([
        ...sheet,
        "half = bmesh.new(); half.from_mesh(mesh)",
        "bmesh.ops.delete(half, geom=[v for v in half.verts if v.co.x < -0.05], context='VERTS')",
        "half.to_mesh(mesh); half.free()",
        "zhiyin.sculpt(obj, 'draw', [[0.5, 0, 0]], radius=0.15, depth=0.01, mirror='x')",
      ]);

      expect(failed, said).toBe(false);
      expect(said).toContain(
        "- Sculpted Sheet with draw at (500, 0, 0 mm), radius 150 mm, smooth falloff, mirrored in x, depth 10 mm: 9 points moved, the most 10 mm at (500, 0, 10 mm); 1 of the stroke's 1 mirrored copy fell further than the radius off Sheet's surface, so it did nothing; an open surface, so no volume; no new self-crossings.",
      );
    });

    it("runs a stroke along several points laid on the surface, and pinches toward it", async () => {
      const drawn = await run([
        ...sheet,
        "zhiyin.sculpt(obj, 'draw', [[0, -0.5, 0.004], [0, 0.5, 0.004]], radius=0.15, depth=0.01)",
      ]);
      const { failed, said } = await run([
        ...sheet,
        "zhiyin.sculpt(obj, 'pinch', [[0, -0.5, 0], [0, 0.5, 0]], radius=0.15, strength=0.5)",
        "near = min(obj.data.vertices, key=lambda v: (v.co.x - 0.1) ** 2 + v.co.y ** 2)",
        "print('pinched x', round(near.co.x * 1000, 2))",
      ]);

      // Three rows of 11 points along it; past each end, one point 100 mm off and two 141 mm off.
      expect(drawn.failed, drawn.said).toBe(false);
      expect(drawn.said).toContain(
        "- Sculpted Sheet with draw along 2 points, 1 m, laid on the surface (the farthest 4 mm off), radius 150 mm, smooth falloff, depth 10 mm: 39 points moved, the most 10 mm at",
      );
      expect(failed, said).toBe(false);
      // A tenth of a metre from the stroke, half of the falloff's 0.2593 of the way to it; the
      // points on the stroke stay, and those past its ends are drawn toward its ends.
      expect(said).toContain(
        "- Sculpted Sheet with pinch along 2 points, 1 m, radius 150 mm, smooth falloff, strength 0.5: 28 points moved, the most 12.96 mm at",
      );
      expect(said).toContain("pinched x 87.04");
    });

    it("grabs the points under a stroke by a distance, and follows a curve as its stroke", async () => {
      const { failed, said } = await run([
        ...sheet,
        "zhiyin.sculpt(obj, 'grab', [[0, 0, 0]], radius=0.15, by=[0, 0, 0.05])",
        "zhiyin.curve('Path', [[-0.5, 0.5, 0], [0.5, 0.5, 0]], kind='poly')",
        "zhiyin.sculpt(obj, 'inflate', 'Path', radius=0.1, depth=0.002)",
        "print('heights', z_at(0, 0), z_at(0, 0.5))",
      ]);

      expect(failed, said).toBe(false);
      expect(said).toContain(
        "- Sculpted Sheet with grab at (0, 0, 0 mm), radius 150 mm, smooth falloff, by [0, 0, 50 mm]: 9 points moved, the most 50 mm at (0, 0, 50 mm); an open surface, so no volume; no new self-crossings.",
      );
      expect(said).toContain(
        "- Sculpted Sheet with inflate along the curve Path, 1 m, radius 100 mm, smooth falloff, depth 2 mm: 11 points moved, the most 2 mm at",
      );
      expect(said).toContain("heights 50.0 2.0");
    });

    it("splits the edges a stroke needs finer, as dynamic topology does, so the bump keeps its shape", async () => {
      const { failed, said } = await run([
        ...sheet,
        "zhiyin.sculpt(obj, 'draw', [[0, 0, 0]], radius=0.15, depth=0.01, detail=0.02)",
        "import math",
        "longest = max((e for e in obj.data.edges if all(math.hypot(obj.data.vertices[i].co.x, obj.data.vertices[i].co.y) < 0.1 for i in e.vertices)), key=lambda e: (obj.data.vertices[e.vertices[0]].co - obj.data.vertices[e.vertices[1]].co).length)",
        "print('longest near the middle', round((obj.data.vertices[longest.vertices[0]].co - obj.data.vertices[longest.vertices[1]].co).length * 1000, 1) <= 20.0)",
      ]);

      expect(failed, said).toBe(false);
      expect(said).toMatch(
        /- Sculpted Sheet with draw at \(0, 0, 0 mm\), radius 150 mm, smooth falloff, depth 10 mm: \d+ points moved, the most 10 mm at \(0, 0, 10 mm\); \d+ edges longer than 20 mm split, faces 400 → \d+; an open surface, so no volume; no new self-crossings\./,
      );
      expect(said).toContain("longest near the middle True");
    });

    it("raises, flattens and smooths a closed ball, saying its volume change", async () => {
      const { failed, said } = await run([
        ...ball,
        "print('volume before', f'{volume():.4g}')",
        "zhiyin.sculpt(obj, 'clay', [[0, 0, 1]], radius=0.3, depth=0.03)",
        "zhiyin.sculpt(obj, 'crease', [[-0.3, -0.95, 0], [0.3, -0.95, 0]], radius=0.1, depth=-0.01)",
        "zhiyin.sculpt(obj, 'flatten', [[1, 0, 0]], radius=0.3, strength=1)",
        "zhiyin.sculpt(obj, 'smooth', [[0, 0, 1]], radius=0.3)",
      ]);

      expect(failed, said).toBe(false);
      expect(said).toMatch(
        /- Sculpted Ball with clay at \(0, 0, 1 m\), radius 300 mm, smooth falloff, depth 30 mm: \d+ points moved, the most [\d.]+ mm at \([^)]+\); volume [\d.]+ m³ → [\d.]+ m³ \(\+[\d.]+%\); no new self-crossings\./,
      );
      expect(said).toMatch(
        /- Sculpted Ball with crease along 2 points, 600 mm, laid on the surface \(the farthest [\d.]+ mm off\), radius 100 mm, sharp falloff, depth -10 mm, strength 0\.5: \d+ points moved, the most [\d.]+ mm at \([^)]+\); volume [\d.]+ m³ → [\d.]+ m³ \(-[\d.]+%\); no new self-crossings\./,
      );
      expect(said).toMatch(
        /- Sculpted Ball with flatten at \(1, 0, 0 m\), radius 300 mm, smooth falloff, strength 1: \d+ points moved, the most [\d.]+ mm at \([^)]+\); volume [\d.]+ m³ → [\d.]+ m³ \(-[\d.]+%\); no new self-crossings\./,
      );
      expect(said).toMatch(
        /- Sculpted Ball with smooth at \(0, 0, 1 m\), laid on the surface \(the farthest [\d.]+ mm off\), radius 300 mm, smooth falloff, strength 0\.5: \d+ points moved, the most [\d.]+ mm at \([^)]+\); volume [\d.]+ m³ → [\d.]+ m³ \(-[\d.]+%\); no new self-crossings\./,
      );
      const before = /volume before ([\d.]+)/.exec(said)?.[1];
      // The first stroke's volume before is the ball's, as the script measured it.
      expect(said).toContain(`volume ${before} m³ →`);
    });

    it("keeps masked points still: a mask is a vertex group made from a pick", async () => {
      const { failed, said } = await run([
        ...sheet,
        "held = zhiyin.pick(obj, 'verts', near=[[0.1, 0, 0], 0.01])",
        "zhiyin.sculpt_mask(held, 'Hold')",
        "zhiyin.sculpt(obj, 'draw', [[0, 0, 0]], radius=0.15, depth=0.01, mask='Hold')",
        "wide = zhiyin.sculpt_mask(zhiyin.pick(obj, 'verts', near=[[-0.5, 0, 0], 0.01]), 'Soft', blur=2)",
        "print('heights', z_at(0.1, 0), z_at(-0.1, 0), [g.name for g in obj.vertex_groups])",
      ]);

      expect(failed, said).toBe(false);
      expect(said).toContain(
        "- Masked 1 point of Sheet as “Hold”, at weight 1; brushes and filters given mask=“Hold” leave it.",
      );
      expect(said).toContain(
        "- Sculpted Sheet with draw at (0, 0, 0 mm), radius 150 mm, smooth falloff, depth 10 mm: 8 points moved, the most 10 mm at (0, 0, 10 mm); the mask “Hold” held back 1 point; an open surface, so no volume; no new self-crossings.",
      );
      expect(said).toContain(
        "- Masked 1 point of Sheet as “Soft”, at weight 1, blurred over 2 rings: 12 more points partly; brushes and filters given mask=“Soft” leave them.",
      );
      expect(said).toContain("heights 0.0 2.593 ['Hold', 'Soft']");
    });

    it("refuses a stroke it cannot run as asked, saying why", async () => {
      const small = await run([
        ...sheet,
        "zhiyin.sculpt(obj, 'draw', [[0.05, 0.05, 0]], radius=0.01, depth=0.01)",
      ]);
      const off = await run([
        ...sheet,
        "zhiyin.sculpt(obj, 'draw', [[0, 0, 0.5]], radius=0.15, depth=0.01)",
      ]);
      const wrong = await run([
        ...sheet,
        "zhiyin.sculpt(obj, 'smooth', [[0, 0, 0]], radius=0.15, depth=0.01)",
      ]);
      const missing = await run([
        ...sheet,
        "zhiyin.sculpt(obj, 'draw', [[0, 0, 0]], radius=0.15)",
      ]);
      const unknown = await run([
        ...sheet,
        "zhiyin.sculpt(obj, 'draw', [[0, 0, 0]], radius=0.15, depth=0.01, mask='Face')",
      ]);

      expect(small.failed, small.said).toBe(true);
      expect(small.said).toContain(
        "A radius of 10 mm reaches no point of Sheet: its point nearest the stroke lies 70.71 mm from it. Give a radius past that, or detail= to add points under the stroke.",
      );
      expect(off.failed, off.said).toBe(true);
      expect(off.said).toContain(
        "The stroke's point (0, 0, 500 mm) lies 500 mm from Sheet's surface, past the brush's radius of 150 mm: give points on the surface, or a curve laid on it.",
      );
      expect(wrong.failed, wrong.said).toBe(true);
      expect(wrong.said).toContain(
        "smooth takes strength, not depth: depth is for draw, clay, crease and inflate.",
      );
      expect(missing.failed, missing.said).toBe(true);
      expect(missing.said).toContain(
        "draw needs depth: how far the surface moves under the stroke's middle, in metres, outward when positive.",
      );
      expect(unknown.failed, unknown.said).toBe(true);
      expect(unknown.said).toContain(
        "Sheet has no vertex group “Face” to mask with; make one with zhiyin.sculpt_mask. It has none.",
      );
    });

    it("filters the whole mesh: inflates, smooths, relaxes, sharpens and adds noise", async () => {
      const { failed, said } = await run([
        ...ball,
        "zhiyin.sculpt_filter(obj, 'inflate', depth=0.01)",
        "zhiyin.sculpt_filter(obj, 'noise', depth=0.005, size=0.2)",
        "zhiyin.sculpt_filter(obj, 'smooth', rounds=3)",
        "zhiyin.sculpt_filter(obj, 'relax')",
        "zhiyin.sculpt_filter(obj, 'sharpen', strength=0.3)",
      ]);

      expect(failed, said).toBe(false);
      expect(said).toContain(
        "- Filtered Ball with inflate, depth 10 mm: 642 points moved, the most 10 mm at",
      );
      expect(said).toMatch(
        /volume [\d.]+ m³ → [\d.]+ m³ \(\+3\.0%\); no new self-crossings\./,
      );
      expect(said).toMatch(
        /- Filtered Ball with noise, depth 5 mm, size 200 mm: \d+ points moved, the most [1-5](\.\d+)? mm at/,
      );
      expect(said).toMatch(
        /- Filtered Ball with smooth, strength 0\.5, 3 rounds: 642 points moved, the most [\d.]+ mm at/,
      );
      expect(said).toMatch(
        /- Filtered Ball with relax, strength 0\.5: \d+ points moved, the most [\d.]+ mm at/,
      );
      expect(said).toMatch(
        /- Filtered Ball with sharpen, strength 0\.3: \d+ points moved, the most [\d.]+ mm at/,
      );
    });

    it("refuses a filter given an option its kind does not take", async () => {
      const { failed, said } = await run([
        ...ball,
        "zhiyin.sculpt_filter(obj, 'smooth', size=0.1)",
      ]);

      expect(failed, said).toBe(true);
      expect(said).toContain("smooth takes no size: size is for noise.");
    });

    it("remeshes in voxels between passes, saying how far it strays and carrying masks over", async () => {
      const { failed, said } = await run([
        ...ball,
        "zhiyin.sculpt_mask(zhiyin.pick(obj, 'verts', above=0.8), 'Top')",
        "zhiyin.sculpt_remesh(obj, 0.05)",
        "top = obj.vertex_groups['Top'].index",
        "print('top held', all(v.co.z > 0.7 for v in obj.data.vertices if any(g.group == top and g.weight > 0.5 for g in v.groups)))",
      ]);

      expect(failed, said).toBe(false);
      expect(said).toMatch(
        /- Remeshed Ball in voxels of 50 mm: faces 1280 → \d+, points 642 → \d+; it strays from its shape before by up to [\d.]+ mm \(mean [\d.]+ mm, 95% within [\d.]+ mm\), most at \([^)]+\) on [^;]+; volume [\d.]+ m³ → [\d.]+ m³ \([+-][\d.]+%\); the mask “Top” carried over by the nearest earlier point\./,
      );
      expect(said).toContain("top held True");
    });

    it("measures a shape's symmetry, and makes one side the mirror of the other while keeping its points", async () => {
      const { failed, said } = await run([
        ...round,
        "zhiyin.symmetry(obj)",
        "zhiyin.sculpt(obj, 'grab', [[1, 0, 0]], radius=0.4, by=[0.2, 0, 0])",
        "zhiyin.symmetry(obj)",
        "zhiyin.sculpt_symmetrize(obj, axis='x', direction='+')",
        "zhiyin.symmetry(obj)",
        "print('points', len(obj.data.vertices), 'reach', round(min(v.co.x for v in obj.data.vertices), 3))",
      ]);

      expect(failed, said).toBe(false);
      const measures = said
        .split("\n")
        .filter((line) => line.startsWith("- Symmetry of Round"));
      expect(measures).toHaveLength(3);
      // Blender's ball is the same on both sides to within what its points' precision holds.
      expect(measures[0]).toMatch(
        /^- Symmetry of Round across its own x = 0: RMS 0 mm, largest (0 mm|0\.00\d+ mm at .*)\.$/,
      );
      expect(measures[1]).toMatch(
        /^- Symmetry of Round across its own x = 0: RMS [\d.]+ mm, largest 200 mm at \(1\.2, 0, 0 m\), 95% within [\d.]+ mm\.$/,
      );
      expect(measures[2]).toBe(
        "- Symmetry of Round across its own x = 0: RMS 0 mm, largest 0 mm.",
      );
      // The 15 points of each of its 15 rings that lie on -x, and the two poles and the points of
      // each ring on x = 0.
      expect(said).toContain(
        "- Symmetrized Round's shape across its own x = 0, its +x side onto -x: 225 points set to their mirror's place, 0 laid onto the mirrored surface, 32 on the seam; the most moved 200 mm at (-1.2, 0, 0 m); symmetry RMS",
      );
      expect(said).toMatch(
        /symmetry RMS [\d.]+ mm → 0 mm, largest 200 mm → 0 mm\./,
      );
      expect(said).toContain("points 482 reach -1.2");
    });

    it("lays a point with no mirror onto the mirrored surface when the two sides' points differ", async () => {
      // A finer ball of 10,242 points, whose points on -x are no mirror of those on +x.
      const { failed, said } = await run([
        ...ball.map((line) => line.replace("subdivisions=4", "subdivisions=6")),
        "zhiyin.sculpt(obj, 'draw', [[0.6, 0, 0.8]], radius=0.3, depth=0.05)",
        "zhiyin.sculpt_symmetrize(obj)",
      ]);

      expect(failed, said).toBe(false);
      const found =
        /- Symmetrized Ball's shape across its own x = 0, its \+x side onto -x: \d+ points set to their mirror's place, ([1-9]\d*) laid onto the mirrored surface, \d+ on the seam; the most moved [\d.]+ mm at \(-[^)]+\); symmetry RMS ([\d.]+) mm → ([\d.]+) mm, largest [\d.]+ mm → [\d.]+ mm\./.exec(
          said,
        );
      expect(found, said).not.toBeNull();
      // Laid onto the surface rather than set point for point, the two sides still come far closer.
      expect(Number(found?.[3])).toBeLessThan(Number(found?.[2]) / 4);
    });

    it("sculpts fine detail on a subdivided copy and puts it back into Multires levels, then bakes them to maps", async () => {
      const { failed, said } = await run([
        ...fresh,
        "bm = bmesh.new()",
        "bmesh.ops.create_cube(bm, size=1)",
        "uv = bm.loops.layers.uv.new('UVMap')",
        "for i, face in enumerate(bm.faces):",
        "    for corner, loop in zip(((0, 0), (1, 0), (1, 1), (0, 1)), face.loops):",
        "        loop[uv].uv = ((i % 3 + corner[0] * 0.9) / 3, (i // 3 + corner[1] * 0.9) / 2)",
        "mesh = bpy.data.meshes.new('Block'); bm.to_mesh(mesh); bm.free()",
        "obj = bpy.data.objects.new('Block', mesh)",
        "bpy.context.scene.collection.objects.link(obj)",
        "copy = zhiyin.sculpt_detail(obj, levels=3)",
        "zhiyin.sculpt(copy, 'draw', [[0, 0, 0.5]], radius=0.2, depth=0.02)",
        "zhiyin.sculpt_reshape(copy)",
        "maps = zhiyin.sculpt_bake(obj, size=64)",
        "import os",
        "print('files', [os.path.exists(p) for p in maps.values()], sorted(maps), [o.name for o in bpy.data.objects], obj.hide_get())",
      ]);

      expect(failed, said).toBe(false);
      expect(said).toContain(
        "- Gave Block 3 Multires levels and made “Block detail”, its 386 points at level 3 (Block has 8): sculpt the copy, then zhiyin.sculpt_reshape(“Block detail”) puts its shape into the levels; Block is hidden meanwhile.",
      );
      expect(said).toMatch(
        /- Reshaped Block's 3 Multires levels from “Block detail”: \d+ of its 386 points moved, the most 20 mm; it strays from the copy by up to 0 mm; removed the copy and shows Block again\./,
      );
      expect(said).toMatch(
        /- Baked Block's 3 Multires levels onto its base at 64 px: a normal map, tangent space, at textures[\\/]Block normal\.png; a displacement map at textures[\\/]Block displacement\.png, mid-grey on the base surface, white and black about [\d.]+ mm out and in; the layout covers \d+% of the texture\./,
      );
      expect(said).toContain(
        "files [True, True] ['displacement', 'normal'] ['Block'] False",
      );
    });

    it("refuses a reshape once the copy's points changed, and a bake with no layout", async () => {
      const block = [
        ...fresh,
        "bm = bmesh.new()",
        "bmesh.ops.create_cube(bm, size=1)",
        "mesh = bpy.data.meshes.new('Block'); bm.to_mesh(mesh); bm.free()",
        "obj = bpy.data.objects.new('Block', mesh)",
        "bpy.context.scene.collection.objects.link(obj)",
        "copy = zhiyin.sculpt_detail(obj, levels=2)",
      ];
      const changed = await run([
        ...block,
        "zhiyin.sculpt(copy, 'draw', [[0, 0, 0.5]], radius=0.2, depth=0.02, detail=0.02)",
        "zhiyin.sculpt_reshape(copy)",
      ]);
      const { failed, said } = await run([
        ...block,
        "zhiyin.sculpt_reshape(copy)",
        "zhiyin.sculpt_bake(obj, size=64)",
      ]);

      expect(changed.failed, changed.said).toBe(true);
      expect(changed.said).toMatch(
        /Block detail has \d+ points, and Block's level 2 has 98: a reshape needs the copy's points as the levels made them, so sculpt the copy without detail= or a remesh\./,
      );
      expect(failed, said).toBe(true);
      expect(said).toContain(
        "Block has no UV layout for the maps to lie in; unwrap it first with blender_unwrap.",
      );
    });
  },
);
