/**
 * Files a real Blender makes for outside the workspace, which the person
 * approves by their real paths: Blender, confined to the workspace as it
 * started, writes them in a folder of the conversation's own, and they arrive
 * where they were approved. A script writes an approved folder the same way,
 * and a direct write there is still refused, saying which folder to use.
 *
 *   $env:ZHIYIN_BLENDER = "…\blender.exe"; npx vitest run --project system-boundary packages/feature/blender-studio
 */

import { mkdir, readFile, readdir, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { openProcessContainer } from "@zhiyin/sandbox";
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

describe.runIf(blender)("a real Blender, writing outside the workspace", () => {
  const folders = new TemporaryFolders();
  let workspace: string;
  let elsewhere: string;
  let scenes: ConversationScenes;
  let tools: ReturnType<typeof sceneAutomation>;
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = (await tools.callTool(name, args)) as Result;
    return {
      ...result,
      said: result.content.map((c) => c.text ?? "").join("\n"),
    };
  };

  beforeAll(async () => {
    const root = await realpath(await folders.make("zhiyin-studio-outside-"));
    workspace = join(root, "workspace");
    elsewhere = join(root, "elsewhere");
    await mkdir(workspace, { recursive: true });
    await mkdir(elsewhere, { recursive: true });
    scenes = new ConversationScenes({
      blender: async () => blender,
      directory: join(root, "data"),
      launch: containedSessionLaunch(
        { open: openProcessContainer },
        { scripts: join(root, "session-scripts") },
      ),
      script: sessionScript,
    });
    tools = sceneAutomation(scenes.scene("outside"), {
      workspaceRoot: () => workspace,
      blender: async () => blender,
      directory: scenes.directory("outside"),
      protect: [join(root, "data")],
    });
    await call("blender_open_scene", { path: "box.blend", create: true });
    const added = await call("blender_add_objects", {
      objects: [{ name: "Box", kind: "cube", size: [0.1, 0.1, 0.1] }],
    });
    const camera = await call("blender_set_camera", {
      frame: { direction: "three-quarter" },
    });
    expect(added.isError, added.said).toBeUndefined();
    expect(camera.isError, camera.said).toBeUndefined();
  }, 180_000);

  afterAll(async () => {
    await scenes.forget("outside");
    await scenes.closeAll();
    await folders.removeAll();
  });

  it("puts an export and a render where they were approved, outside the workspace", async () => {
    const model = join(elsewhere, "prints", "box.glb");
    const picture = join(elsewhere, "box.png");

    const exported = await call("blender_export", { output: model });
    const rendered = await call("blender_render", {
      output: picture,
      engine: "eevee",
      resolution: [64, 48],
    });

    expect(exported.isError, exported.said).toBeUndefined();
    expect((await readFile(model)).subarray(0, 4).toString()).toBe("glTF");
    expect(rendered.isError, rendered.said).toBeUndefined();
    expect((await stat(picture)).size).toBeGreaterThan(0);
    expect(await readdir(workspace)).toEqual(["box.blend"]);
  }, 180_000);

  it("moves what a script writes for an approved folder into it, and refuses a direct write there, saying where to write", async () => {
    const wrote = await call("blender_run_script", {
      code: [
        "import os",
        `target = OUTSIDE_FOLDERS[r'${elsewhere}']`,
        "os.makedirs(os.path.join(target, 'notes'), exist_ok=True)",
        "with open(os.path.join(target, 'notes', 'size.txt'), 'w') as f:",
        "    f.write(str(round(bpy.data.objects['Box'].dimensions.x, 3)))",
      ].join("\n"),
      outside_folders: [elsewhere],
    });
    const direct = await call("blender_run_script", {
      code: `open(r'${join(elsewhere, "direct.txt")}', 'w').write('no')`,
      outside_folders: [elsewhere],
    });

    expect(wrote.isError, wrote.said).toBeUndefined();
    expect(await readFile(join(elsewhere, "notes", "size.txt"), "utf8")).toBe(
      "0.1",
    );
    expect(wrote.said).toContain(`Moved into ${elsewhere}`);
    expect(direct.isError).toBe(true);
    expect(direct.said).toContain(
      `Blender cannot write ${elsewhere} itself: write its files into OUTSIDE_FOLDERS`,
    );
    await expect(stat(join(elsewhere, "direct.txt"))).rejects.toThrow();
  }, 180_000);
});
