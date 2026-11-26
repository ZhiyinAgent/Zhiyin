// @vitest-environment node
/**
 * A real Blender scene larger than recovery once copied (ADR 0013), changed
 * by a script under the run backup the composition gives it: the scene is
 * copied before the script runs, so Blender can save it, and going back puts
 * it back. Before ADR 0013 such a scene was held read-only and every script's
 * save failed. Skipped unless Blender is named in the environment:
 *
 *   $env:ZHIYIN_BLENDER = "…\blender.exe"
 *   npx vitest run --project system-boundary apps/desktop/system-boundary/large-scene-recovery.test.ts
 */

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ListedFile, ListWorkspace } from "@zhiyin/contract";
import {
  ConversationScenes,
  containedSessionLaunch,
  sceneAutomation,
} from "@zhiyin/blender-studio";
import { withKeptGlCache } from "@zhiyin/blender-studio/testing";
import { replaceFile } from "@zhiyin/files";
import { openProcessContainer, readOnlyHolds } from "@zhiyin/sandbox";
import { FileRecovery, RunBackups } from "@zhiyin/recovery";
import { TemporaryFolders } from "@zhiyin/test-support";

const blender = process.env["ZHIYIN_BLENDER"];
const session = fileURLToPath(
  new URL(
    "../../../packages/feature/blender-studio/src/session/start.py",
    import.meta.url,
  ),
);

type Result = {
  isError?: boolean;
  content: { type: string; text?: string }[];
};

const hash = async (path: string) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");

/** The workspace's own files, as the app lists a folder to copy it. */
const list: ListWorkspace = async (root) => {
  const files = new Map<string, ListedFile>();
  for (const name of await readdir(root)) {
    const found = await stat(join(root, name));
    if (found.isFile())
      files.set(name, { size: found.size, modified: found.mtimeMs });
  }
  return { ok: true, files };
};

describe.runIf(blender)("a real Blender scene past 10 MiB", () => {
  const folders = new TemporaryFolders();
  let workspace: string;
  let data: string;
  let scenes: ConversationScenes;
  let studio: ReturnType<typeof sceneAutomation>;
  const call = async (name: string, args: Record<string, unknown>) => {
    const asked = await studio.inspect(name, args);
    if (!asked.ok) throw new Error(asked.reason);
    const result = (await studio.callTool(
      name,
      args,
      undefined,
      asked.identity,
    )) as Result;
    if (result.isError)
      throw new Error(result.content.map((c) => c.text ?? "").join("\n"));
    return result;
  };

  beforeAll(async () => {
    const root = await folders.make("zhiyin-large-scene-");
    workspace = join(root, "workspace");
    data = join(root, "data");
    await mkdir(workspace, { recursive: true });
    scenes = new ConversationScenes({
      blender: async () => blender,
      directory: join(data, "scenes"),
      launch: withKeptGlCache(containedSessionLaunch)(
        { open: openProcessContainer },
        { scripts: join(root, "session-scripts") },
      ),
      script: session,
    });
    studio = sceneAutomation(scenes.scene("stand"), {
      workspaceRoot: () => workspace,
      blender: async () => blender,
      directory: scenes.directory("stand"),
    });
  });

  afterAll(async () => {
    await scenes.closeAll();
    await folders.removeAll();
  });

  it("is saved by a script and put back by going back", async () => {
    const scene = join(workspace, "stand.blend");
    await call("blender_open_scene", { path: "stand.blend", create: true });
    // A dense grid makes the saved scene tens of megabytes.
    await call("blender_run_script", {
      code: "import bpy\nbpy.ops.mesh.primitive_grid_add(x_subdivisions=700, y_subdivisions=700, size=1)",
    });
    const large = await stat(scene);
    const before = await hash(scene);
    const recovery = new FileRecovery(data, { list });
    const runs = new RunBackups(recovery, {
      holds: readOnlyHolds(data, { replace: replaceFile }),
      programLocations: async () => [],
    });

    const copied = await runs.backUp("run-1", workspace, "conversation-1");
    const started = await runs.start("run-1", { sealed: true, writable: [] });
    await call("blender_run_script", {
      code: "import bpy\nbpy.context.active_object.location.x = 2",
    });
    const changed = await hash(scene);
    await runs.finish("run-1");
    await recovery.restore(
      await recovery.review("review", workspace, [
        {
          id: "run-1",
          action: "Run a Blender script",
          target: "stand.blend",
          status: "completed",
          startedAt: "2026-11-01T10:00:00.000Z",
          sequence: 0,
        },
      ]),
    );

    expect(large.size).toBeGreaterThan(10 * 1024 * 1024);
    expect(copied).toMatchObject({ ok: true, uncopied: [] });
    expect(started).toMatchObject({ ok: true });
    expect(changed).not.toBe(before);
    expect(await hash(scene)).toBe(before);
  }, 240_000);
});
