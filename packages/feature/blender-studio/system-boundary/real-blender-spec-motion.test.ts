/**
 * A scene's spec measured by a real Blender where a pattern names several
 * parts and where parts move: four legs on the floor by one pattern, one of
 * them lifted; a cube keyed through a still box, and one passing beside it,
 * measured over the frames; and a sheet moved by keyed shape keys through a
 * box, which the motion report follows by its shape.
 *
 *   $env:ZHIYIN_BLENDER = "…\blender.exe"; npx vitest run --project system-boundary packages/feature/blender-studio/system-boundary/real-blender-spec-motion.test.ts
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ActionDetail } from "@zhiyin/contract";
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
  content: { type: string; text?: string; data?: string }[];
};
type Item = { label: string; holds: boolean | null; note?: string };

describe.runIf(blender)(
  "a real Blender, measuring a spec over patterns and motion",
  () => {
    const folders = new TemporaryFolders();
    let workspace: string;
    let scenes: ConversationScenes;
    let tools: ReturnType<typeof sceneAutomation>;
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = (await tools.callTool(name, args)) as Result;
      const details = tools.describeResult(name, args, {
        ok: true,
        value: result,
      }) as readonly ActionDetail[];
      const card = details.find((one) => one.kind === "checks");
      const items =
        card?.kind === "checks" ? (card.items as readonly Item[]) : [];
      return {
        ...result,
        said: result.content.map((c) => c.text ?? "").join("\n"),
        verdict: (id: string) =>
          items.find(
            (one) => one.label === id || one.label.startsWith(`${id} ·`),
          ),
      };
    };
    const spec = (value: unknown) =>
      writeFile(join(workspace, "requirements.json"), JSON.stringify(value));
    const script = (code: string[]) =>
      call("blender_run_script", { code: code.join("\n") });

    beforeAll(async () => {
      const root = await folders.make("zhiyin-studio-spec-motion-");
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
      tools = sceneAutomation(scenes.scene("spec-motion"), {
        workspaceRoot: () => workspace,
        blender: async () => blender,
        directory: scenes.directory("spec-motion"),
      });
      const opened = await call("blender_open_scene", {
        path: "motion.blend",
        create: true,
      });
      expect(opened.isError, opened.said).toBeUndefined();
    }, 180_000);

    afterAll(async () => {
      await scenes.forget("spec-motion");
      await scenes.closeAll();
      await folders.removeAll();
    });

    it("measures each leg a pattern names: four on the floor hold, one lifted 5 mm fails by name", async () => {
      await spec({
        object: "a table's legs",
        requirements: [
          { id: "F1", check: "rests_on", part: "/Leg_.*/" },
          { id: "T1", check: "thickness", part: "/Leg_.*/", range: [45, 55] },
        ],
      });
      const added = await call("blender_add_objects", {
        objects: [0, 1, 2, 3].map((i) => ({
          name: `Leg_${i}`,
          kind: "cube",
          size: [0.05, 0.05, 0.7],
          location: [-10 + (i % 2) * 0.8, (i >> 1) * 0.5, 0.35],
        })),
      });

      expect(added.isError, added.said).toBeUndefined();
      expect(added.verdict("F1")?.holds, added.verdict("F1")?.note).toBe(true);
      expect(added.verdict("F1")?.note).toMatch(
        /^Leg_\d's bottom is on the ground \(the worst of the 4 objects \/Leg_\.\*\/ names; the others: Leg_\d on it, Leg_\d on it and Leg_\d on it\)/,
      );
      expect(added.verdict("T1")?.holds, added.verdict("T1")?.note).toBe(true);

      const lifted = await call("blender_edit_objects", {
        edits: [{ object: "Leg_2", location: [-10, 0.5, 0.355] }],
      });

      expect(lifted.verdict("F1")).toMatchObject({
        holds: false,
        note: expect.stringMatching(
          /^Leg_2's bottom is 5 mm above the ground, where it is to rest on it within 1 mm \(the worst of the 4 objects \/Leg_\.\*\/ names; the others: Leg_\d on it, Leg_\d on it and Leg_\d on it\); 4 mm past the limit$/,
        ),
      });
      expect(lifted.said).toMatch(
        /- F1 fails[^:\n]*: Leg_2's bottom is 5 mm above the ground/,
      );
    }, 180_000);

    it("fails a cube keyed through a still box with how deep and when, and holds one passing beside it", async () => {
      await spec({
        object: "a cube passing a box",
        requirements: [
          {
            id: "M1",
            check: "separate_in_motion",
            parts: ["Mover", "Wall"],
            start: 0,
            end: 1,
          },
          {
            id: "M2",
            check: "separate_in_motion",
            parts: ["Passer", "Wall"],
            start: 0,
            end: 1,
          },
          {
            id: "M3",
            check: "separate_in_motion",
            parts: ["Mover", "Wall"],
            start: 0,
            end: 1,
            max: 200,
            every: 2,
          },
          { id: "S1", check: "separate", parts: ["Mover", "Wall"] },
        ],
      });
      const added = await call("blender_add_objects", {
        objects: [
          {
            name: "Wall",
            kind: "cube",
            size: [0.4, 0.4, 0.4],
            location: [0, 10, 0.2],
          },
          {
            name: "Mover",
            kind: "cube",
            size: [0.1, 0.1, 0.1],
            location: [-1, 10, 0.2],
          },
          {
            name: "Passer",
            kind: "cube",
            size: [0.1, 0.1, 0.1],
            location: [-1, 10.4, 0.2],
          },
        ],
      });
      expect(added.isError, added.said).toBeUndefined();

      const keyed = await call("blender_animate", {
        keys: [
          { object: "Mover", at: 0, location: [-1, 10, 0.2], easing: "linear" },
          { object: "Mover", at: 1, location: [1, 10, 0.2], easing: "linear" },
          {
            object: "Passer",
            at: 0,
            location: [-1, 10.4, 0.2],
            easing: "linear",
          },
          {
            object: "Passer",
            at: 1,
            location: [1, 10.4, 0.2],
            easing: "linear",
          },
        ],
      });

      expect(keyed.isError, keyed.said).toBeUndefined();
      // At the scene's own frame the cube is clear of the box; only the motion goes through it.
      expect(keyed.verdict("S1")?.holds).toBe(true);
      expect(keyed.verdict("M1")).toMatchObject({
        holds: false,
        note: expect.stringMatching(
          // Deepest a frame either side of the middle, where the box's near face is 167 mm from the cube's far one.
          /^Mover and Wall, 16\d(\.\d+)? mm deep at 0\.458 s and 0\.542 s; in each other from 0\.417 s to 0\.583 s, measured at 25 frames from 0 s to 1 s; 16\d(\.\d+)? mm past the limit$/,
        ),
      });
      expect(keyed.verdict("M2")?.holds, keyed.verdict("M2")?.note).toBe(true);
      expect(keyed.verdict("M2")?.note).toBe(
        "no two of them go into each other at any of the 25 frames measured, from 0 s to 1 s",
      );
      expect(keyed.verdict("M3")?.holds, keyed.verdict("M3")?.note).toBe(true);
      // Every other frame skips 0.458 s; at 0.5 s the cube sits in the middle of the box, and every
      // point of its surface is 150 mm inside the box's nearest side (the box's half of 200 mm less
      // the cube's 50), so 50 mm to spare.
      expect(keyed.verdict("M3")?.note).toMatch(
        /^Mover and Wall, 150 mm deep at 0\.5 s; [^\n]*measured at 13 frames from 0 s to 1 s, every 2 frames, where at most 200 mm deep is asked; 50 mm to spare$/,
      );

      const frame = await script([
        "import bpy",
        "print('frame', bpy.context.scene.frame_current)",
      ]);
      expect(frame.said).toContain("frame 1");
    }, 240_000);

    it("follows a sheet moved by keyed shape keys through a box, in the motion report and the spec", async () => {
      await spec({
        object: "a sheet lowered through a block",
        requirements: [
          {
            id: "M4",
            check: "separate_in_motion",
            parts: ["Sheet", "Block"],
            start: 0,
            end: 1,
          },
        ],
      });
      const made = await script([
        "import bpy, bmesh",
        "mesh = bpy.data.meshes.new('Sheet')",
        "shape = bmesh.new()",
        "bmesh.ops.create_grid(shape, x_segments=6, y_segments=6, size=0.15)",
        "shape.to_mesh(mesh)",
        "shape.free()",
        "sheet = bpy.data.objects.new('Sheet', mesh)",
        "sheet.location = (10, 0, 1)",
        "bpy.context.scene.collection.objects.link(sheet)",
        "sheet.shape_key_add(name='Basis', from_mix=False)",
        "down = sheet.shape_key_add(name='Down', from_mix=False)",
        "for point in down.data:",
        "    point.co.z -= 1.0",
        "down.value = 0.0",
        "down.keyframe_insert('value', frame=1)",
        "down.value = 1.0",
        "down.keyframe_insert('value', frame=25)",
        "for key in fcurves_of(sheet.data.shape_keys)[0].keyframe_points:",
        "    key.interpolation = 'LINEAR'",
        "down.value = 0.0",
        "block = bpy.data.objects.new('Block', bpy.data.meshes.new('Block'))",
        "shape = bmesh.new()",
        "bmesh.ops.create_cube(shape, size=0.4)",
        "shape.to_mesh(block.data)",
        "shape.free()",
        "block.location = (10, 0, 0.5)",
        "bpy.context.scene.collection.objects.link(block)",
        "bpy.context.scene.frame_set(1)",
      ]);
      expect(made.isError, made.said).toBeUndefined();

      const report = await call("blender_frame_sheet", {
        pictures: false,
        time: 0,
        end: 1,
      });

      expect(report.isError, report.said).toBeUndefined();
      expect(report.said).toMatch(
        /Deepest overlaps, measured on the parts' surfaces, first and deepest for each pair: [^\n]*Block and Sheet, 200 mm deep at 0\.5 s/,
      );
      expect(made.verdict("M4")).toMatchObject({
        holds: false,
        note: expect.stringMatching(
          /^Block and Sheet, 200 mm deep at 0\.5 s; in each other from 0\.333 s to 0\.667 s, measured at 25 frames from 0 s to 1 s; 200 mm past the limit$/,
        ),
      });
    }, 240_000);

    it("follows a cloth falling through a box, moved by its simulation alone, and measures it in the spec once baked", async () => {
      await spec({
        object: "a cloth dropped through a block",
        requirements: [
          {
            id: "M5",
            check: "separate_in_motion",
            parts: ["Drape", "Probe"],
            start: 0,
            end: 0.5,
          },
        ],
      });
      const made = await script([
        "import bpy, bmesh",
        "mesh = bpy.data.meshes.new('Drape')",
        "shape = bmesh.new()",
        "bmesh.ops.create_grid(shape, x_segments=8, y_segments=8, size=0.15)",
        "shape.to_mesh(mesh)",
        "shape.free()",
        "drape = bpy.data.objects.new('Drape', mesh)",
        "drape.location = (20, 0, 0.6)",
        "bpy.context.scene.collection.objects.link(drape)",
        "drape.modifiers.new('Cloth', 'CLOTH')",
        "probe = bpy.data.objects.new('Probe', bpy.data.meshes.new('Probe'))",
        "shape = bmesh.new()",
        "bmesh.ops.create_cube(shape, size=0.4)",
        "shape.to_mesh(probe.data)",
        "shape.free()",
        "probe.location = (20, 0, 0.3)",
        "bpy.context.scene.collection.objects.link(probe)",
        "bpy.context.scene.frame_set(1)",
      ]);
      expect(made.isError, made.said).toBeUndefined();

      const report = await call("blender_frame_sheet", {
        pictures: false,
        time: 0,
        end: 0.5,
      });

      expect(report.isError, report.said).toBeUndefined();
      // Falling, held back a little by the air, the cloth reaches the block's top about 0.2 s in.
      expect(report.said).toMatch(
        /Deepest overlaps, measured on the parts' surfaces, first and deepest for each pair: [^\n]*Drape and Probe, 1\d\d(\.\d+)? mm deep at 0\.3\d* s; in each other from 0\.2\d* s to 0\.4\d* s/,
      );
      // Unbaked, the spec does not step the cloth from its start after every change.
      expect(made.verdict("M5")).toMatchObject({
        holds: null,
        note: "cloth on Drape is not baked, and stepping a simulation from its start after every change would hold each change up: bake it with blender_simulate first",
      });

      const baked = await call("blender_simulate", { bake: true });

      expect(baked.isError, baked.said).toBeUndefined();
      expect(baked.verdict("M5")).toMatchObject({
        holds: false,
        note: expect.stringMatching(
          /^Drape and Probe, 1\d\d(\.\d+)? mm deep at 0\.3\d* s; in each other from 0\.2\d* s to 0\.4\d* s, measured at 13 frames from 0 s to 0\.5 s; 1\d\d(\.\d+)? mm past the limit$/,
        ),
      });
    }, 240_000);
  },
);
