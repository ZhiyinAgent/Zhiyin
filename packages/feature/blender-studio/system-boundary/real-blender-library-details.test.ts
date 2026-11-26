/**
 * The zhiyin library's panel gaps and retopology, against a real Blender: a
 * gap cut round picked faces says how wide it came out along its seam and how
 * deep; a panel split from its body says its gap to the body and its
 * thickness; a retopology says its quads, poles and how far the source lies
 * from it; and each refuses what it cannot do, saying why.
 *
 *   $env:ZHIYIN_BLENDER = "…\blender.exe"; npx vitest run --project "system-boundary*" packages/feature/blender-studio
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
/** A 1 m cube whose every side is 4 × 4 faces, standing on the floor. */
const box = [
  ...fresh,
  "bm = bmesh.new()",
  "bmesh.ops.create_cube(bm, size=1)",
  "bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=3, use_grid_fill=True)",
  "mesh = bpy.data.meshes.new('Box'); bm.to_mesh(mesh); bm.free()",
  "obj = bpy.data.objects.new('Box', mesh); obj.location.z = 0.5",
  "bpy.context.scene.collection.objects.link(obj)",
  "top = zhiyin.pick(obj, facing='+z', inside=[[-0.3, -0.3, 0.9], [0.3, 0.3, 1.1]])",
];
/** An open 1 m sheet of 4 × 4 faces, lying flat. */
const sheet = [
  ...fresh,
  "bm = bmesh.new()",
  "bmesh.ops.create_grid(bm, x_segments=4, y_segments=4, size=0.5)",
  "mesh = bpy.data.meshes.new('Sheet'); bm.to_mesh(mesh); bm.free()",
  "obj = bpy.data.objects.new('Sheet', mesh)",
  "bpy.context.scene.collection.objects.link(obj)",
  "middle = zhiyin.pick(obj, inside=[[-0.3, -0.3, -0.1], [0.3, 0.3, 0.1]])",
];
/** A sphere of 1280 triangles, stretched taller than wide. */
const blob = [
  ...fresh,
  "bm = bmesh.new()",
  "bmesh.ops.create_icosphere(bm, subdivisions=4, radius=1.0)",
  "for v in bm.verts: v.co.z *= 1.4",
  "mesh = bpy.data.meshes.new('Blob'); bm.to_mesh(mesh); bm.free()",
  "obj = bpy.data.objects.new('Blob', mesh)",
  "bpy.context.scene.collection.objects.link(obj)",
];

describe.runIf(blender)(
  "the zhiyin library's panel gaps and retopology in a real Blender",
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
      const root = await folders.make("zhiyin-studio-details-");
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
      tools = sceneAutomation(scenes.scene("details"), {
        workspaceRoot: () => workspace,
        blender: async () => blender,
        directory: scenes.directory("details"),
      });
      await tools.callTool("blender_open_scene", {
        path: "details.blend",
        create: true,
      });
    });

    afterAll(async () => {
      await scenes.forget("details");
      await scenes.closeAll();
      await folders.removeAll();
    });

    it("cuts a gap round picked faces and says its width along the seam and its depth", async () => {
      const { failed, said } = await run([
        ...box,
        "zhiyin.panel(top, gap=0.004, depth=0.002)",
        "print('faces', len(obj.data.polygons))",
      ]);

      expect(failed, said).toBe(false);
      expect(said).toContain(
        "- Cut a panel gap round 4 faces of Box: 4 mm wide all along its 2 m seam, 2 mm deep; 96 faces now 120, no open edges.",
      );
      expect(said).toContain("faces 120");
    });

    it("refuses a gap with nothing to run along, or too wide for the panel", async () => {
      const whole = await run([
        ...box,
        "zhiyin.panel(zhiyin.pick(obj), gap=0.004, depth=0.002)",
      ]);
      const wide = await run([
        ...box,
        "zhiyin.panel(top, gap=0.3, depth=0.002)",
      ]);

      expect(whole.failed, whole.said).toBe(true);
      expect(whole.said).toContain(
        "Every face of Box is picked, so no edge runs between the panel and the rest for a gap to follow.",
      );
      expect(wide.failed, wide.said).toBe(true);
      expect(wide.said).toContain(
        "A gap of 300 mm folds Box's panel of 4 faces over itself; a gap must be under half the panel's narrowest width.",
      );
    });

    it("splits a panel from its body, leaving the gap between them, both thickened inward", async () => {
      const { failed, said } = await run([
        ...sheet,
        "door = zhiyin.panel(middle, gap=0.004, depth=0.002, split=True, name='Door')",
        "print(door.name, len(door.data.polygons), [m.type for m in door.modifiers], [m.type for m in obj.modifiers])",
      ]);

      expect(failed, said).toBe(false);
      expect(said).toContain(
        "- Split Door from Sheet: 4 faces, 4 mm from Sheet all along its 2 m seam; both 2 mm thick, thickened inward.",
      );
      expect(said).toContain("Door 4 ['SOLIDIFY'] ['SOLIDIFY']");
    });

    it("retopologises a dense mesh into quads, saying its poles and how far the source lies from it", async () => {
      const { failed, said } = await run([
        ...blob,
        "new = zhiyin.retopo(obj, faces=400)",
        "print(new.name, 300 < len(new.data.polygons) < 600, obj.hide_get(), obj.hide_render)",
      ]);

      expect(failed, said).toBe(false);
      expect(said).toMatch(
        /- Retopologised Blob as Blob retopo: \d+ faces \(asked 400\) from 1280, 100% quads; poles: \d+ of 3 edges, \d+ of 5, \d+ of 6 or more; Blob lies within [\d.]+ mm of it \(mean [\d.]+ mm\); volume [\d.]+% (smaller|larger)\. Blob is hidden\./,
      );
      expect(said).toContain("Blob retopo True True True");
    });

    it("refuses to retopologise a surface that is not closed, saying where it is open", async () => {
      const { failed, said } = await run([...sheet, "zhiyin.retopo(obj)"]);

      expect(failed).toBe(true);
      expect(said).toContain(
        "Sheet is not closed: 16 of its edges are open, at x -500 mm to 500 mm, y -500 mm to 500 mm, z 0 mm. QuadriFlow remeshes only a closed surface; fill its holes first.",
      );
    });
  },
);
