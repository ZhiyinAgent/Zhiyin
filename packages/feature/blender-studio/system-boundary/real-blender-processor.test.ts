/**
 * A real Blender on a PC whose graphics card cannot draw, as the test switch
 * makes one: every Blender ends the moment it draws on the card, as one does
 * there, and Cycles finds no card either. The session finds that out, with a
 * Blender of its own that ends, and starts on the processor: a shape is
 * added and measured, the view is drawn as a real picture, and a render
 * asked of EEVEE says what drew it.
 *
 *   $env:ZHIYIN_BLENDER = "…\blender.exe"; npx vitest run --project system-boundary packages/feature/blender-studio/system-boundary/real-blender-processor.test.ts
 */

import { mkdir, realpath, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ScenePreview } from "@zhiyin/contract";
import { TemporaryFolders } from "@zhiyin/test-support";
import { withKeptGlCache } from "../test/kept-gl-cache.js";
import { openProcessContainer } from "@zhiyin/sandbox";
import {
  ConversationScenes,
  containedSessionLaunch,
  sceneAutomation,
  type LaunchSession,
  type SessionLaunchOptions,
} from "../src/index.js";

const blender = process.env["ZHIYIN_BLENDER"];
const sessionScript = fileURLToPath(
  new URL("../src/session/start.py", import.meta.url),
);
type Result = {
  isError?: boolean;
  content: { type: string; text?: string; data?: string }[];
};
const onProcessor =
  "This computer's graphics card cannot draw Blender's pictures, so Blender draws them on the processor, which takes longer.";

describe.runIf(blender)(
  "a real Blender on a PC whose graphics card cannot draw",
  () => {
    const folders = new TemporaryFolders();
    let workspace: string;
    let scenes: ConversationScenes;
    let tools: ReturnType<typeof sceneAutomation>;
    /** Each Blender started, and how it ended: still running, or gone. */
    const started: { options: SessionLaunchOptions; ended: boolean }[] = [];
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = (await tools.callTool(name, args)) as Result;
      return {
        ...result,
        said: result.content.map((c) => c.text ?? "").join("\n"),
      };
    };
    /** The middle of a picture of the view, as Blender reads it: red, green and blue. */
    const middleOf = async (preview: ScenePreview, name: string) => {
      await writeFile(
        join(workspace, name),
        Buffer.from(preview.data, "base64"),
      );
      const read = await call("blender_run_script", {
        code: [
          "import bpy",
          `image = bpy.data.images.load(bpy.path.abspath('//${name}'))`,
          "w, h = image.size",
          "p = image.pixels[:]",
          "patch = [(y * w + x) * 4 for x in range(w // 2 - 4, w // 2 + 4) for y in range(h // 2 - 4, h // 2 + 4)]",
          "print('middle', *[sum(p[i + c] for i in patch) / len(patch) for c in range(3)])",
          "bpy.data.images.remove(image)",
        ].join("\n"),
      });
      return (/middle (.+)/.exec(read.said)?.[1] ?? "")
        .split(" ")
        .map(Number) as [number, number, number];
    };

    beforeAll(async () => {
      const root = await realpath(
        await folders.make("zhiyin-studio-processor-"),
      );
      workspace = join(root, "workspace");
      await mkdir(workspace, { recursive: true });
      const contained = withKeptGlCache(containedSessionLaunch)(
        { open: openProcessContainer },
        { scripts: join(root, "session-scripts"), withoutGraphicsCard: true },
      );
      const launch: LaunchSession = async (options) => {
        const process = await contained(options);
        const record = { options, ended: false };
        started.push(record);
        void process.ended.then(() => {
          record.ended = true;
        });
        return process;
      };
      scenes = new ConversationScenes({
        blender: async () => blender,
        directory: join(root, "data"),
        launch,
        script: sessionScript,
      });
      tools = sceneAutomation(scenes.scene("processor"), {
        workspaceRoot: () => workspace,
        blender: async () => blender,
        directory: scenes.directory("processor"),
        protect: [join(root, "data")],
      });
    }, 30_000);

    afterAll(async () => {
      await scenes.forget("processor");
      await scenes.closeAll();
      await folders.removeAll();
    });

    it("finds out with a Blender of its own, which ends drawing, starts on the processor, and says so once", async () => {
      const opened = await call("blender_open_scene", {
        path: "brick.blend",
        create: true,
      });
      const added = await call("blender_add_objects", {
        objects: [{ name: "Brick", kind: "cube", size: [0.2, 0.1, 0.05] }],
      });
      const measured = await call("blender_describe_scene", {
        objects: ["Brick"],
      });

      expect(opened.isError, opened.said).toBeUndefined();
      expect(opened.said).toContain(onProcessor);
      expect(scenes.scene("processor").state()).toMatchObject({
        status: "open",
        note: onProcessor,
      });
      // Two starts that ended drawing their first picture, one started to
      // find out that ended drawing it too, and the session on the processor.
      const how = started.map(({ options }) =>
        options.probe
          ? "to find out"
          : options.processor
            ? "on the processor"
            : "on the graphics card",
      );
      expect(how.slice(0, 4)).toEqual([
        "on the graphics card",
        "on the graphics card",
        "to find out",
        "on the processor",
      ]);
      expect(started.slice(0, 3).every(({ ended }) => ended)).toBe(true);
      expect(started[3]?.ended).toBe(false);
      expect(added.isError, added.said).toBeUndefined();
      expect(added.said).toContain("200 × 100 × 50 mm");
      expect(added.said).not.toContain(onProcessor);
      expect(measured.isError, measured.said).toBeUndefined();
      expect(measured.said).toContain("200 × 100 × 50 mm");
    }, 300_000);

    it("draws the view as a real picture, quick and full, with Cycles", async () => {
      await call("blender_set_material", {
        objects: ["Brick"],
        material: { name: "Brick red", color: "#c81e1e", roughness: 0.6 },
      });
      const session = scenes.scene("processor");
      await call("blender_api", { name: "Object" });
      const pictures: ScenePreview[] = [];
      const known = session.state().preview?.sequence ?? 0;
      const stop = session.onState((state) => {
        const latest = pictures.at(-1)?.sequence ?? known;
        if (state.preview && state.preview.sequence > latest)
          pictures.push(state.preview);
      });
      session.look({ kind: "turn", yaw: 20, pitch: 0 });
      for (let tries = 0; tries < 1_500 && pictures.length < 2; tries++)
        await new Promise((resolve) => setTimeout(resolve, 20));
      stop();
      const [quick, full] = pictures;

      expect(quick?.quick).toBe(true);
      expect(full?.quick).toBeUndefined();
      for (const [picture, name] of [
        [quick, "quick.jpg"],
        [full, "full.jpg"],
      ] as const) {
        const [red, green, blue] = await middleOf(picture!, name);
        expect(red, name).toBeGreaterThan(Math.max(green, blue) * 1.8);
      }
    }, 300_000);

    it("draws a render asked of EEVEE with Cycles, and says so", async () => {
      await call("blender_set_camera", {
        frame: { direction: "three-quarter" },
      });
      const rendered = await call("blender_render", {
        output: "brick.png",
        engine: "eevee",
        resolution: [160, 120],
      });

      expect(rendered.isError, rendered.said).toBeUndefined();
      expect((await stat(join(workspace, "brick.png"))).size).toBeGreaterThan(
        0,
      );
      expect(rendered.said).toContain("with Cycles on the processor");
      expect(rendered.said).toContain(
        "EEVEE cannot draw on this computer, whose graphics card Blender cannot use, so this picture was drawn with Cycles at 16 samples instead, as a draft.",
      );
      // What the picture shows is read from flat drawings Cycles makes too.
      expect(rendered.said).toMatch(/Colours in the picture[^\n]*Brick #/);
    }, 300_000);

    it("draws a plan, a video and EEVEE's own settings asked of EEVEE with Cycles, baking no light probes", async () => {
      const plan = await call("blender_render", {
        output: "plan.png",
        view: "plan",
        resolution: [160, 120],
      });
      const probed = await call("blender_render", {
        output: "probed.png",
        engine: "eevee",
        resolution: [160, 120],
        eevee: { probes: true, shadows: { rays: 2 } },
      });
      const video = await call("blender_render_video", {
        output: "brick.mp4",
        engine: "eevee",
        start: 0,
        end: 0.1,
        resolution: [64, 48],
      });

      expect(plan.isError, plan.said).toBeUndefined();
      expect(plan.said).toContain(
        "so this plan was drawn with Cycles at 16 samples instead",
      );
      expect(probed.isError, probed.said).toBeUndefined();
      expect(probed.said).toContain(
        "The eevee settings given are kept in the scene, and do nothing in Cycles; no light probes were baked, which only EEVEE bakes.",
      );
      expect(video.isError, video.said).toBeUndefined();
      expect(video.said).toContain(
        "with Cycles on the processor at 16 samples, as EEVEE cannot draw on this computer",
      );
      expect((await stat(join(workspace, "brick.mp4"))).size).toBeGreaterThan(
        0,
      );
    }, 300_000);

    it("refuses a script's EEVEE render, which would end its Blender, saying how to render instead", async () => {
      const refused = await call("blender_run_script", {
        code: [
          "import bpy",
          "s = bpy.context.scene",
          "s.render.engine = 'BLENDER_EEVEE'",
          "s.render.filepath = '//scripted.png'",
          "bpy.ops.render.render(write_still=True)",
        ].join("\n"),
      });

      expect(refused.isError).toBe(true);
      expect(refused.said).toContain(
        "bpy.ops.render.render was not run: BLENDER_EEVEE draws on the graphics card, which Blender cannot use on this computer",
      );
      expect(refused.said).not.toContain("stopped while working");
      for (const operator of [
        "bpy.ops.render.opengl()",
        "bpy.ops.object.lightprobe_cache_bake()",
      ]) {
        const drawing = await call("blender_run_script", {
          code: `import bpy\n${operator}`,
        });
        expect(drawing.isError).toBe(true);
        expect(drawing.said).toContain(
          "on the graphics card, which Blender cannot use on this computer",
        );
      }
    }, 300_000);

    it("leaves a Grease Pencil object out of a render, which only a graphics card draws, and names it", async () => {
      const added = await call("blender_run_script", {
        code: [
          "import bpy",
          "ink = bpy.data.objects.new('Ink', bpy.data.grease_pencils.new('Ink'))",
          "bpy.context.scene.collection.objects.link(ink)",
        ].join("\n"),
      });
      const rendered = await call("blender_render", {
        output: "inked.png",
        resolution: [160, 120],
        samples: 4,
      });

      expect(added.isError, added.said).toBeUndefined();
      expect(rendered.isError, rendered.said).toBeUndefined();
      expect(rendered.said).toContain(
        "Ink is a Grease Pencil object, which only a graphics card draws, so it is left out of the pictures on this computer",
      );
      expect((await stat(join(workspace, "inked.png"))).size).toBeGreaterThan(
        0,
      );
    }, 300_000);

    it("looks at the scene shaded and as wires with Cycles", async () => {
      for (const shading of ["shaded", "wireframe", "faces"]) {
        const looked = await call("blender_look", { shading });

        expect(looked.isError, looked.said).toBeUndefined();
        expect(looked.said).toContain("drawn with Cycles");
      }
    }, 300_000);
  },
);
