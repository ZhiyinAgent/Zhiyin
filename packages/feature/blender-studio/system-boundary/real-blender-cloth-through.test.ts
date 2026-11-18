/**
 * A cloth that goes through what it meets, against a real Blender: a cloth on
 * a table, a thin plate just above it, the cloth's far edge pinned and yanked
 * out and up. Its points step past the 4 mm plate between frames, so none is
 * ever found inside it; the answer after the bake still says the cloth went
 * through the plate, when, and how much of it, and names what stops it. The
 * same yank with the steps it names goes through nothing, and the plate stays
 * where it was. With the plate laid 2 mm over the table, the cloth starts
 * squeezed between the two, and the answer asks for room instead. A spec's
 * requirement that the cloth pass through no plate fails on the same crossing
 * and holds once the steps stop it.
 *
 *   $env:ZHIYIN_BLENDER = "…\blender.exe"; npx vitest run --project system-boundary packages/feature/blender-studio/system-boundary/real-blender-cloth-through.test.ts
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
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
  content: { type: string; text?: string }[];
};
type Item = { label: string; holds: boolean | null; note?: string };

/**
 * A 0.8 × 0.5 m table whose top is at 750 mm, a 1 × 0.5 m cloth on a 25 mm
 * grid lying over it, and a plate 240 mm across and 4 mm thick held `gap`
 * over the table with the cloth halfway between. The cloth holds still to
 * frame 3, then is moved 0.6 m out and 0.1 m up by frame 15.
 */
const tableScript = (gap: number) =>
  [
    "for o in list(bpy.data.objects): bpy.data.objects.remove(o)",
    "room = bpy.context.scene",
    "room.render.fps = 24",
    "room.frame_start, room.frame_end = 1, 24",
    "bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0.735))",
    "table = bpy.context.active_object",
    "table.name, table.scale = 'Table', (0.8, 0.5, 0.03)",
    "bpy.ops.object.transform_apply(scale=True)",
    `bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=0.12, depth=0.004, location=(0, 0, ${0.75 + gap + 0.002}))`,
    "bpy.context.active_object.name = 'Plate'",
    `bpy.ops.mesh.primitive_grid_add(x_subdivisions=40, y_subdivisions=20, size=1, location=(0, 0, ${0.75 + gap / 2}))`,
    "cloth = bpy.context.active_object",
    "cloth.name, cloth.scale = 'Cloth', (1.0, 0.5, 1)",
    "bpy.ops.object.transform_apply(scale=True)",
    "cloth.keyframe_insert('location', frame=3)",
    `cloth.location = (0.6, 0, ${0.75 + gap / 2 + 0.1})`,
    "cloth.keyframe_insert('location', frame=15)",
  ].join("\n");

const yank = {
  object: "Cloth",
  pinned: { edge: "+x" },
  colliders: ["Table", "Plate"],
};

describe.runIf(blender)(
  "a cloth that goes through a collider, in a real Blender",
  () => {
    const folders = new TemporaryFolders();
    let scenes: ConversationScenes;
    let tools: ReturnType<typeof sceneAutomation>;
    let workspace: string;
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
        failed: result.isError === true,
        said: result.content.map((c) => c.text ?? "").join("\n"),
        verdict: (id: string) =>
          items.find(
            (one) => one.label === id || one.label.startsWith(`${id} ·`),
          ),
      };
    };
    const script = async (code: string) => {
      const ran = await call("blender_run_script", { code });
      expect(ran.failed, ran.said).toBe(false);
      return ran.said;
    };
    const plateAt = async () => {
      const said = await script(
        "p = bpy.data.objects['Plate'].matrix_world.translation\nprint('plate at', round(p.x, 6), round(p.y, 6), round(p.z, 6))",
      );
      return /plate at [-\d.e ]+/.exec(said)?.[0];
    };

    beforeAll(async () => {
      const root = await folders.make("zhiyin-studio-cloth-through-");
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
      tools = sceneAutomation(scenes.scene("through"), {
        workspaceRoot: () => workspace,
        blender: async () => blender,
        directory: scenes.directory("through"),
      });
      await call("blender_open_scene", { path: "through.blend", create: true });
    });

    afterAll(async () => {
      await scenes.forget("through");
      await scenes.closeAll();
      await folders.removeAll();
    });

    it("says a cloth yanked through a thin plate went through it, and the steps it names hold it", async () => {
      await script(tableScript(0.012));
      const before = await plateAt();
      expect(before).toBe("plate at 0.0 0.0 0.764");

      const fast = await call("blender_simulate", { cloth: yank, bake: true });

      expect(fast.failed, fast.said).toBe(false);
      expect(fast.said).toContain(
        "Cloth: cotton cloth (Blender's preset), 861 points 25 mm apart; self-collision on, 20 steps a frame.",
      );
      expect(fast.said).toMatch(
        /Unsound cloth on Cloth after the bake: [^\n]*it went through Plate (at|from) [\d.]+ s[^\n]*\(frames \d+–\d+\), as many as \d+ of its edges at [\d.]+ s, joining \d+ of its 861 points \([\d.]+%\)/,
      );
      expect(fast.said).toMatch(
        /its points there moved up to [\d.]+ m\/s, [\d.]+ mm in each of its 20 steps a frame, against the 5 mm it keeps from Plate, so they stepped past it\. Give cloth\.steps \d+ /,
      );
      const steps = Number(/Give cloth\.steps (\d+)/.exec(fast.said)?.[1]);
      expect(steps).toBeGreaterThan(20);

      const held = await call("blender_simulate", {
        cloth: { ...yank, steps },
        bake: true,
      });

      expect(held.failed, held.said).toBe(false);
      expect(held.said).toContain(
        `self-collision on, ${steps} steps a frame as given.`,
      );
      expect(held.said).toMatch(
        /Sound cloth on Cloth after the bake: [^\n]*through no collider at any frame\./,
      );
      expect(held.said).not.toContain("went through");
      expect(await plateAt()).toBe(before);
    });

    it("asks for room when the cloth starts squeezed between a plate and the table", async () => {
      await script(tableScript(0.002));

      const { failed, said } = await call("blender_simulate", {
        cloth: yank,
        bake: true,
      });

      expect(failed, said).toBe(false);
      expect(said).toMatch(
        /it went through Plate [^\n]*: it starts squeezed, [\d,]+ of its points within what it keeps from both Plate and Table on either side, so each pushes it into the other and more steps do not help\. Leave at least 10 mm between them, what it keeps from each, or give them less thickness \(colliders\.thickness\) and bake again\./,
      );

      await script("bpy.data.objects['Plate'].location.z += 0.01");
      const roomy = await call("blender_simulate", { bake: true });

      expect(roomy.failed, roomy.said).toBe(false);
      expect(roomy.said).not.toContain("starts squeezed");
    });

    it("fails a spec's 'passes through no plate' while the cloth goes through it, and holds it once the steps stop it", async () => {
      await writeFile(
        join(workspace, "requirements.json"),
        JSON.stringify({
          object: "a cloth yanked from under a plate",
          requirements: [
            {
              id: "M1",
              check: "separate_in_motion",
              parts: ["Cloth", "Plate"],
            },
          ],
        }),
      );
      await script(tableScript(0.012));

      const fast = await call("blender_simulate", { cloth: yank, bake: true });

      expect(fast.failed, fast.said).toBe(false);
      expect(fast.verdict("M1")).toMatchObject({
        holds: false,
        note: expect.stringMatching(
          /^Cloth goes through Plate (at|from) [\d.]+ s[^;]*\(frames \d+–\d+\), as many as \d+ of its edges at [\d.]+ s, joining \d+ of its 861 points \([\d.]+%\)[;,] /,
        ),
      });
      const steps = Number(/Give cloth\.steps (\d+)/.exec(fast.said)?.[1]);

      const held = await call("blender_simulate", {
        cloth: { ...yank, steps },
        bake: true,
      });

      expect(held.failed, held.said).toBe(false);
      expect(held.verdict("M1")).toMatchObject({
        holds: true,
        note: expect.stringMatching(
          /^no two of them go into each other at any of the 24 frames measured/,
        ),
      });
    });

    it("says a cloth carried through a floor plane by its pins went through it, and one stopped short did not", async () => {
      await rm(join(workspace, "requirements.json"), { force: true });
      // A floor of one open face, and a sheet pinned all over, moved down
      // by its keys from 200 mm above the floor to `to` m.
      const floor = (to: number) =>
        [
          "for o in list(bpy.data.objects): bpy.data.objects.remove(o)",
          "room = bpy.context.scene",
          "room.render.fps = 24",
          "room.frame_start, room.frame_end = 1, 24",
          "bpy.ops.mesh.primitive_plane_add(size=2, location=(0, 0, 0))",
          "bpy.context.active_object.name = 'Floor'",
          "bpy.ops.mesh.primitive_grid_add(x_subdivisions=10, y_subdivisions=10, size=0.5, location=(0, 0, 0.2))",
          "sheet = bpy.context.active_object",
          "sheet.name = 'Sheet'",
          "every = sheet.vertex_groups.new(name='All')",
          "every.add(list(range(len(sheet.data.vertices))), 1.0, 'REPLACE')",
          "sheet.keyframe_insert('location', frame=3)",
          `sheet.location.z = ${to}`,
          "sheet.keyframe_insert('location', frame=15)",
        ].join("\n");
      const held = {
        object: "Sheet",
        pinned: { group: "All" },
        colliders: ["Floor"],
      };

      await script(floor(-0.2));
      const through = await call("blender_simulate", {
        cloth: held,
        bake: true,
      });

      expect(through.failed, through.said).toBe(false);
      expect(through.said).toMatch(
        /it went through Floor (at|from) [\d.]+ s[^\n]*: its pinned points carry it through Floor, as pins follow what holds them and no collider stops them: move them clear of it\./,
      );

      await script(floor(0.1));
      const short = await call("blender_simulate", { cloth: held, bake: true });

      expect(short.failed, short.said).toBe(false);
      expect(short.said).toMatch(/through no collider at any frame\./);
    });
  },
);
