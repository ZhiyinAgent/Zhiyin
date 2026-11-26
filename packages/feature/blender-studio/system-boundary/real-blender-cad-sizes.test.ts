/**
 * A CAD part's new shape, against a real Blender: its size is the one the
 * CAD studio measured, written beside its mesh, so a part meshed again more
 * finely or more coarsely is not said to have changed, and one that changed
 * is said to have changed by its exact sizes.
 *
 *   $env:ZHIYIN_BLENDER = "…\blender.exe"; npx vitest run --project "system-boundary*" packages/feature/blender-studio
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { withKeptGlCache } from "../test/kept-gl-cache.js";
import { openProcessContainer } from "@zhiyin/sandbox";
import {
  ConversationScenes,
  containedSessionLaunch,
  sceneAutomation,
} from "../src/index.js";
import { cadLikeGlb } from "./cad-like-glb.js";

const blender = process.env["ZHIYIN_BLENDER"];
const sessionScript = fileURLToPath(
  new URL("../src/session/start.py", import.meta.url),
);
type Result = {
  isError?: boolean;
  content: { type: string; text?: string }[];
};

describe.runIf(blender)("a real Blender, on a CAD part's exact size", () => {
  const folders = new TemporaryFolders();
  let workspace: string;
  let scenes: ConversationScenes;
  let tools: ReturnType<typeof sceneAutomation>;
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = (await tools.callTool(name, args)) as Result;
    return {
      ...result,
      said: result.content.map((c) => c.text ?? "").join("\n"),
    };
  };
  /** A disc as a viewing mesh draws it: its flats a little inside the circle. */
  const disc = (mesh: number, exact: number) => ({
    name: "Disc",
    size: [mesh, mesh, 0.01] as const,
    cadSize: [exact, exact, 0.01] as const,
  });

  beforeAll(async () => {
    const root = await folders.make("zhiyin-studio-cad-sizes-");
    workspace = join(root, "workspace");
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
    tools = sceneAutomation(scenes.scene("cad-sizes"), {
      workspaceRoot: () => workspace,
      blender: async () => blender,
      directory: scenes.directory("cad-sizes"),
    });
    await writeFile(
      join(workspace, "viewing.glb"),
      cadLikeGlb([disc(0.0799, 0.08)]),
    );
    await writeFile(
      join(workspace, "close-up.glb"),
      cadLikeGlb([disc(0.07999, 0.08)]),
    );
    await writeFile(
      join(workspace, "larger.glb"),
      cadLikeGlb([disc(0.0898, 0.09)]),
    );
    await call("blender_open_scene", { path: "sizes.blend", create: true });
    const added = await call("blender_add_objects", {
      objects: [
        {
          name: "Wheel",
          kind: "model",
          path: "viewing.glb",
          location: [0, 0, 0],
        },
      ],
    });
    expect(added.isError, added.said).toBeUndefined();
  }, 120_000);

  afterAll(async () => {
    await scenes.forget("cad-sizes");
    await scenes.closeAll();
    await folders.removeAll();
  });

  it("does not say a part meshed again at another fineness changed", async () => {
    const reshaped = await call("blender_edit_objects", {
      edits: [{ object: "Wheel", shapes_from: "close-up.glb" }],
    });

    expect(reshaped.isError, reshaped.said).toBeUndefined();
    expect(reshaped.said).toContain("new shapes from close-up.glb for Disc");
    expect(reshaped.said).not.toContain("changed from");
  }, 60_000);

  it("says a part that changed size changed by the sizes the CAD measured", async () => {
    const reshaped = await call("blender_edit_objects", {
      edits: [{ object: "Wheel", shapes_from: "larger.glb" }],
    });

    expect(reshaped.isError, reshaped.said).toBeUndefined();
    expect(reshaped.said).toContain(
      "Disc changed from 80 × 80 × 10 mm to 90 × 90 × 10 mm.",
    );
  }, 60_000);
});
