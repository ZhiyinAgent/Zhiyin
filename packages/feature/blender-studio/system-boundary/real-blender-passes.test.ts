/**
 * What follows a change in a real Blender: a sheet of glass is let light
 * through, a wooden object's grain is laid, and a camera focused on an object
 * stays on it, each after the tools that can change what it depends on and
 * after no other. The scenes start from files a script saved before any of
 * these ran, so a tool that did not run one leaves the scene as it was.
 *
 *   $env:ZHIYIN_BLENDER = "…\blender.exe"; npx vitest run --project system-boundary packages/feature/blender-studio/system-boundary/real-blender-passes.test.ts
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

/** The scenes the script saves, one for each check, as no tool has touched them. */
const untouched = [
  "glass",
  "grain-still",
  "grain-laid",
  "focus-still",
  "focus-kept",
];

/**
 * A pane of glass 6 mm thick, a board of wood and a box beside them, and a
 * camera 4 m in front of the board, focused on it but set to focus 0.5 m
 * away; saved as each scene, then taken out of the scene the script ran in.
 */
const madeElsewhere = `
import math
import bpy

def box(name, size, location, material=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = size
    if material is not None:
        obj.data.materials.append(material)
    return obj

glass = bpy.data.materials.new('Glass')
glass.use_nodes = True
glass.node_tree.nodes['Principled BSDF'].inputs['Transmission Weight'].default_value = 1.0
oak = bpy.data.materials.new('Oak')
oak.use_nodes = True
marker = oak.node_tree.nodes.new('ShaderNodeValue')
marker.name = 'Zhiyin wood'
marker.outputs[0].default_value = 1.0
made = [
    box('Pane', (1, 0.006, 2.5), (3, 0, 1.25), glass),
    box('Board', (1.2, 0.2, 0.03), (0, 0, 0.5), oak),
    box('Other', (0.2, 0.2, 0.2), (-3, 0, 0.1)),
]
bpy.ops.object.camera_add(location=(0, -4, 0.5), rotation=(math.radians(90), 0, 0))
camera = bpy.context.active_object
camera.name = 'Camera'
bpy.context.scene.camera = camera
camera.data.dof.use_dof = True
camera.data.dof.focus_distance = 0.5
camera.data['zhiyin_focus'] = 'Board'
made.append(camera)
for name in (${untouched.map((name) => `'${name}'`).join(", ")}):
    bpy.ops.wm.save_as_mainfile(filepath=bpy.path.abspath(f'//{name}.blend'), copy=True)
for obj in made:
    bpy.data.objects.remove(obj)
`;

describe.runIf(blender)(
  "what follows a change in a real Blender, after the tools that need it",
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
    /** What the open scene's file holds, printed by a script, which sees the file as saved. */
    const printed = async (expression: string) => {
      const read = await call("blender_run_script", {
        code: `import bpy\nprint('read', ${expression})`,
      });
      expect(read.failed, read.said).toBe(false);
      return /^read (.*)$/m.exec(read.said)?.[1];
    };
    const open = async (name: string) => {
      const opened = await call("blender_open_scene", {
        path: `${name}.blend`,
      });
      expect(opened.failed, opened.said).toBe(false);
    };
    const paint = (objects: string[]) =>
      call("blender_set_material", {
        objects,
        material: { name: "Paint", color: "#2050c0", roughness: 0.4 },
      });

    beforeAll(async () => {
      const root = await folders.make("zhiyin-studio-passes-");
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
      tools = sceneAutomation(scenes.scene("passes"), {
        workspaceRoot: () => workspace,
        blender: async () => blender,
        directory: scenes.directory("passes"),
      });
      await call("blender_open_scene", { path: "start.blend", create: true });
      const made = await call("blender_run_script", { code: madeElsewhere });
      expect(made.failed, made.said).toBe(false);
    }, 180_000);

    afterAll(async () => {
      await scenes.forget("passes");
      await scenes.closeAll();
      await folders.removeAll();
    });

    it("lets light through a sheet of glass after a material is given, and not after an unwrap, which cannot make one", async () => {
      await open("glass");

      const unwrapped = await call("blender_unwrap", { objects: ["Other"] });
      const before = await call("blender_describe_scene", {});
      const painted = await paint(["Other"]);
      const after = await call("blender_describe_scene", {});

      expect(unwrapped.failed, unwrapped.said).toBe(false);
      expect(unwrapped.said).not.toContain("thin sheet");
      expect(/^- Pane: .*$/m.exec(before.said)?.[0]).not.toMatch(
        /casts no shadow/,
      );
      expect(painted.failed, painted.said).toBe(false);
      expect(painted.said).toContain(
        "Pane is a thin sheet of glass: light goes through it as through real glass, and it casts no shadow.",
      );
      expect(/^- Pane: .*$/m.exec(after.said)?.[0]).toMatch(/casts no shadow/);
    }, 180_000);

    it("lays a wooden object's grain after a material is given, and not after the camera is set, which cannot change it", async () => {
      await open("grain-still");
      const framed = await call("blender_set_camera", {
        frame: { direction: "three-quarter" },
      });
      const still = await printed(
        "'zhiyin_grain' in bpy.data.objects['Board']",
      );

      await open("grain-laid");
      const painted = await paint(["Other"]);
      const laid = await printed("'zhiyin_grain' in bpy.data.objects['Board']");

      expect(framed.failed, framed.said).toBe(false);
      expect(still).toBe("False");
      expect(painted.failed, painted.said).toBe(false);
      expect(laid).toBe("True");
    }, 180_000);

    it("keeps the camera on what it is focused on after that moves, and not after a material is given, which moves nothing", async () => {
      const focus =
        "round(bpy.data.objects['Camera'].data.dof.focus_distance, 3)";
      await open("focus-still");
      const painted = await paint(["Other"]);
      const still = await printed(focus);

      await open("focus-kept");
      const moved = await call("blender_edit_objects", {
        edits: [{ object: "Board", location: [0, 1, 0.5] }],
      });
      const kept = await printed(focus);

      expect(painted.failed, painted.said).toBe(false);
      expect(still).toBe("0.5");
      expect(moved.failed, moved.said).toBe(false);
      // The board's middle is now 5 m in front of the camera.
      expect(kept).toBe("5.0");
    }, 180_000);
  },
);
