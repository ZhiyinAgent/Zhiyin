/**
 * An object's heights read as its own in a real Blender: a desk top with a
 * mouse attached on it, a lamp shade with a cord attached below and a finial
 * above, and a group with no shape of its own. The parts attached reach past
 * their holder, which is said apart from the holder's own heights.
 *
 *   $env:ZHIYIN_BLENDER = "…\blender.exe"; npx vitest run --project system-boundary packages/feature/blender-studio/system-boundary/real-blender-own-heights.test.ts
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

const cube = (
  name: string,
  size: number[],
  location: number[],
  parent?: string,
) => ({ name, kind: "cube", size, location, ...(parent ? { parent } : {}) });

describe.runIf(blender)(
  "a real Blender, saying an object's own heights apart from what is attached to it",
  () => {
    const folders = new TemporaryFolders();
    let scenes: ConversationScenes;
    let tools: ReturnType<typeof sceneAutomation>;
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = (await tools.callTool(name, args)) as Result;
      return {
        isError: result.isError,
        said: result.content.map((c) => c.text ?? "").join("\n"),
      };
    };
    const line = async (name: string) =>
      (await call("blender_describe_scene", { objects: [name] })).said
        .split("\n")
        .find((l) => l.startsWith(`- ${name}:`)) ?? "";

    beforeAll(async () => {
      const root = await folders.make("zhiyin-studio-heights-");
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
      tools = sceneAutomation(scenes.scene("heights"), {
        workspaceRoot: () => workspace,
        blender: async () => blender,
        directory: scenes.directory("heights"),
      });
      const opened = await call("blender_open_scene", {
        path: "heights.blend",
        create: true,
      });
      expect(opened.isError, opened.said).toBeUndefined();
      // A desk top 710 to 750 mm high, its mouse on it to 790 mm; a shade
      // 1.4 to 1.6 m high, its cord down to 1 m and its finial up to 1.62 m.
      const added = await call("blender_add_objects", {
        objects: [
          cube("Desk", [1, 0.5, 0.04], [0, 0, 0.73]),
          cube("Mouse", [0.1, 0.06, 0.04], [0.2, 0, 0.77], "Desk"),
          cube("Shade", [0.2, 0.2, 0.2], [3, 0, 1.5]),
          cube("Cord", [0.01, 0.01, 0.4], [3, 0, 1.2], "Shade"),
          cube("Finial", [0.02, 0.02, 0.02], [3, 0, 1.61], "Shade"),
        ],
      });
      expect(added.isError, added.said).toBeUndefined();
      // A group with no shape of its own, holding two boxes 0 to 300 mm high.
      const grouped = await call("blender_run_script", {
        code: [
          "import bpy",
          "kit = bpy.data.objects.new('Kit', None)",
          "bpy.context.scene.collection.objects.link(kit)",
          "kit.location = (6, 0, 0)",
          "for name, z in (('Low', 0.05), ('High', 0.25)):",
          "    bpy.ops.mesh.primitive_cube_add(size=0.1, location=(6, 0, z))",
          "    part = bpy.context.active_object",
          "    part.name = name",
          "    part.parent = kit",
          "    part.matrix_parent_inverse = kit.matrix_world.inverted()",
        ].join("\n"),
      });
      expect(grouped.isError, grouped.said).toBeUndefined();
    }, 180_000);

    afterAll(async () => {
      await scenes.forget("heights");
      await scenes.closeAll();
      await folders.removeAll();
    });

    it("describes a holder by its own heights, then by those with what is attached", async () => {
      const desk = await line("Desk");
      expect(desk).toContain(
        "from 710 mm to 750 mm high (with what is attached, to 790 mm)",
      );
      expect(await line("Shade")).toContain(
        "from 1.4 m to 1.6 m high (with what is attached, from 1 m to 1.62 m)",
      );

      const mouse = await line("Mouse");
      expect(mouse).toContain("from 750 mm to 790 mm high ·");
      expect(mouse).toContain("attached to Desk");
    });

    it("gives a group with no shape of its own the heights of its parts", async () => {
      const kit = await line("Kit");
      expect(kit).toContain("from 0 mm to 300 mm high");
      expect(kit).not.toContain("with what is attached");
    });

    it("says the same where an edit's answer places a holder and its copy", async () => {
      const moved = await call("blender_edit_objects", {
        edits: [
          { object: "Desk", location: [0, 2, 0.73] },
          { object: "Shade", duplicate: { offset: [0, 2, 0] } },
        ],
      });
      expect(moved.isError, moved.said).toBeUndefined();
      expect(moved.said).toMatch(
        /Desk: moved from \(0, 0, 730 mm\); now Desk \(.+\) at \(0, 2, 0\.73 m\), from 710 mm to 750 mm high \(with what is attached, to 790 mm\)/,
      );
      expect(moved.said).toMatch(
        /copied as Shade 2 \(with Cord 2, Finial 2\) at \(3, 2, 1\.5 m\), from 1\.4 m to 1\.6 m high \(with what is attached, from 1 m to 1\.62 m\)/,
      );
    });
  },
);
