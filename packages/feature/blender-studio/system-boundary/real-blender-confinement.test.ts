/**
 * The container a conversation's Blender runs in, against a real Blender: it
 * is made when the Blender starts and removed with the conversation. The
 * containers are counted in the person's profile, which every other Blender
 * started on the machine adds to, so this file runs with the machine to
 * itself. Skipped unless Blender is named, as the other real-Blender tests
 * are:
 *
 *   $env:ZHIYIN_BLENDER = "…\blender.exe"; npx vitest run --project "system-boundary*" packages/feature/blender-studio/system-boundary/real-blender-confinement.test.ts
 */

import { mkdir, readdir } from "node:fs/promises";
import { homedir } from "node:os";
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
  content: { type: string; text?: string; data?: string }[];
};

describe.runIf(blender)("a real Blender", () => {
  const rootFolders = new TemporaryFolders();
  let workspace: string;
  let scenes: ConversationScenes;

  beforeAll(async () => {
    const root = await rootFolders.make("zhiyin-studio-live-");
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
  });

  afterAll(async () => {
    await scenes.closeAll();
    await rootFolders.removeAll();
  });

  it("removes the container a conversation's Blender ran in when the conversation is deleted", async () => {
    const packages = join(
      process.env["LOCALAPPDATA"] ?? join(homedir(), "AppData", "Local"),
      "Packages",
    );
    const containers = async () =>
      (await readdir(packages)).filter((name) =>
        name.toLowerCase().startsWith("zhiyin.blender."),
      );
    const before = await containers();
    const other = sceneAutomation(scenes.scene("deleted"), {
      workspaceRoot: () => workspace,
      blender: async () => blender,
      directory: scenes.directory("deleted"),
    });

    const opened = (await other.callTool("blender_open_scene", {
      path: "deleted.blend",
      create: true,
    })) as Result;
    const during = await containers();
    await scenes.forget("deleted");

    expect(opened.isError).toBeUndefined();
    expect(during.filter((name) => !before.includes(name))).toHaveLength(1);
    expect(await containers()).toEqual(before);
  });
});
