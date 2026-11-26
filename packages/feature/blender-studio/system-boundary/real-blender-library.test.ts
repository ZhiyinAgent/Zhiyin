/**
 * The zhiyin library scripts reach, against a real Blender: each call acts,
 * then its measured line comes back in the script's answer, a pick that takes
 * nothing is refused with why, a kept pick is taken up by a later script,
 * and the functions are those the catalog lists.
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
import { libraryFunctions } from "../src/library-functions.js";

const blender = process.env["ZHIYIN_BLENDER"];
const sessionScript = fileURLToPath(
  new URL("../src/session/start.py", import.meta.url),
);
type Result = {
  isError?: boolean;
  content: { type: string; text?: string }[];
};

/** A one-metre box standing on the floor, made fresh by each script that needs it. */
const box = [
  "import bmesh, bpy",
  "old = bpy.data.objects.get('Box')",
  "if old: bpy.data.objects.remove(old)",
  "shape = bmesh.new()",
  "bmesh.ops.create_cube(shape, size=1)",
  "mesh = bpy.data.meshes.new('Box')",
  "shape.to_mesh(mesh)",
  "shape.free()",
  "obj = bpy.data.objects.new('Box', mesh)",
  "obj.location = (0, 0, 0.5)",
  "bpy.context.scene.collection.objects.link(obj)",
];

describe.runIf(blender)("the zhiyin library in a real Blender", () => {
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
    const root = await folders.make("zhiyin-studio-library-");
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
    tools = sceneAutomation(scenes.scene("library"), {
      workspaceRoot: () => workspace,
      blender: async () => blender,
      directory: scenes.directory("library"),
    });
    await tools.callTool("blender_open_scene", {
      path: "library.blend",
      create: true,
    });
  });

  afterAll(async () => {
    await scenes.forget("library");
    await scenes.closeAll();
    await folders.removeAll();
  });

  it("offers scripts exactly the functions the catalog lists", async () => {
    const { said } = await run([
      "print(sorted(n for n in dir(zhiyin) if not n.startswith('_')))",
    ]);

    expect(said).toContain(
      `[${libraryFunctions
        .map((fn) => `'${fn.name}'`)
        .sort()
        .join(", ")}]`,
    );
  });

  it("picks faces by the way they face and says how many, their area and where, without the script printing", async () => {
    const { failed, said } = await run([
      ...box,
      "zhiyin.pick(obj, facing='+z')",
    ]);

    expect(failed, said).toBe(false);
    expect(said).toContain("What its zhiyin calls did:");
    expect(said).toContain(
      "- Picked 1 face of Box, facing +z within 15°: 1 m²; x -500 mm to 500 mm, y -500 mm to 500 mm, z 1 m.",
    );
  });

  it("refuses, in any function, a pick an edit has spent by changing the mesh under it", async () => {
    const { failed, said } = await run([
      ...box,
      "top = zhiyin.pick(obj, facing='+z')",
      "zhiyin.extrude(top, 0.1)",
      "zhiyin.panel(top)",
    ]);

    expect(failed).toBe(true);
    expect(said).toContain(
      "This pick of Box was spent by extrude, which changed the mesh: use what extrude returned, or pick again.",
    );
  });

  it("grows a pick by rings of neighbours", async () => {
    const { said } = await run([
      ...box,
      "print(len(zhiyin.pick(obj, facing='up', grow=1)))",
    ]);

    expect(said).toContain("5\n");
    expect(said).toContain(
      "Picked 5 faces of Box, facing up within 15°, grown by 1 ring: 5 m²",
    );
  });

  it("refuses a pick that takes nothing, saying what each condition alone takes and where the faces lie", async () => {
    const { failed, said } = await run([
      ...box,
      "zhiyin.pick(obj, facing='+z', below=0.2)",
    ]);

    expect(failed).toBe(true);
    expect(said).toContain(
      "Nothing of Box's 6 faces is facing +z within 15° and below z 200 mm. Each condition alone takes facing +z within 15°: 1; below z 200 mm: 1.",
    );
    expect(said).toContain(
      "The centres of its faces lie at x -500 mm to 500 mm",
    );
  });

  it("keeps a named pick on the mesh, for a later script to take up", async () => {
    await run([...box, "zhiyin.pick(obj, facing='-z', name='base')"]);

    const later = await run([
      "kept = zhiyin.picked('Box', 'base')",
      "print(kept.kind, len(kept))",
    ]);
    const missing = await run(["zhiyin.picked('Box', 'lid')"]);

    expect(later.said).toContain("faces 1");
    expect(later.said).toContain("- Took up “base” on Box: 1 face.");
    expect(missing.failed).toBe(true);
    expect(missing.said).toContain(
      "Box keeps no pick named “lid”. It keeps: base.",
    );
  });

  it("names what its calls did before a script failed, as undone with it", async () => {
    const { failed, said } = await run([
      ...box,
      "zhiyin.pick(obj, facing='+x')",
      "raise ValueError('stop here')",
    ]);

    expect(failed).toBe(true);
    expect(said).toContain("ValueError: stop here");
    expect(said).toContain("Before it failed, and undone with it:");
    expect(said).toContain("- Picked 1 face of Box, facing +x within 15°");
  });
});
