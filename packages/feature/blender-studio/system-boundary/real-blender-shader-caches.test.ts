/**
 * A new conversation's first 3D call against a real Blender on this PC's
 * NVIDIA graphics card, as the app starts it: the first conversation's
 * Blender compiles its warm-up shaders, a Blender of Zhiyin's own then makes
 * the kept cache in the background, and the next conversation's first
 * session starts on a copy of it, in a fraction of the time. A kept cache the
 * driver cannot read leaves a start as it is without one.
 *
 * Its own kept caches, conversations and containers are new, so the first
 * start is always without a cache. Skipped unless Blender is named in the
 * environment and the PC has an NVIDIA card:
 *
 *   $env:ZHIYIN_BLENDER = "…\blender.exe"; npx vitest run --project "system-boundary*" packages/feature/blender-studio/system-boundary/real-blender-shader-caches.test.ts
 */

import { randomBytes } from "node:crypto";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { openProcessContainer } from "@zhiyin/sandbox";
import {
  ConversationScenes,
  KeptShaderCaches,
  containedSessionLaunch,
  nvidiaDriverVersion,
  sceneAutomation,
} from "../src/index.js";

const blender = process.env["ZHIYIN_BLENDER"];
const sessionScript = fileURLToPath(
  new URL("../src/session/start.py", import.meta.url),
);
const containment = { open: openProcessContainer };
const driver = blender ? await nvidiaDriverVersion(containment)() : undefined;

describe.runIf(blender && driver)(
  "a new conversation's first 3D call on the kept shader cache",
  () => {
    const folders = new TemporaryFolders();
    const conversations: string[] = [];
    let root: string;
    let kept: string;
    let caches: KeptShaderCaches;
    let scenes: ConversationScenes;

    beforeAll(async () => {
      root = await folders.make("zhiyin-studio-shader-caches-");
      kept = join(root, "shader-caches");
      caches = new KeptShaderCaches({
        directory: kept,
        driver: nvidiaDriverVersion(containment),
      });
      scenes = new ConversationScenes({
        blender: async () => blender,
        directory: join(root, "data"),
        launch: containedSessionLaunch(containment, {
          scripts: join(root, "session-scripts"),
          shaderCaches: caches,
        }),
        script: sessionScript,
      });
    });

    afterAll(async () => {
      for (const conversation of conversations)
        await scenes.forget(conversation);
      await scenes.closeAll();
      await caches.settled();
      await folders.removeAll();
    });

    /**
     * A new conversation's first call, which creates its scene; gives the
     * seconds from the call until its session was open.
     */
    const firstCall = async (conversation: string) => {
      conversations.push(conversation);
      const workspace = join(root, "workspaces", conversation);
      await mkdir(workspace, { recursive: true });
      const scene = scenes.scene(conversation);
      const tools = sceneAutomation(scene, {
        workspaceRoot: () => workspace,
        blender: async () => blender,
        directory: scenes.directory(conversation),
      });
      const asked = performance.now();
      let open: number | undefined;
      const stop = scene.onState((state) => {
        if (state.status === "open") open ??= performance.now();
      });
      try {
        const result = (await tools.callTool("blender_open_scene", {
          path: "scene.blend",
          create: true,
        })) as { isError?: boolean; content: { text?: string }[] };
        expect(
          result.isError,
          result.content.map((c) => c.text).join("\n"),
        ).not.toBe(true);
      } finally {
        stop();
      }
      expect(open).toBeDefined();
      return (open! - asked) / 1_000;
    };

    /** Each file in the kept cache, by its path in it. */
    const keptFiles = async () => {
      const [name] = (await readdir(kept)).filter((n) => n !== "making");
      const cache = join(kept, name ?? "none");
      const names = await readdir(cache, { recursive: true }).catch(() => []);
      const files: string[] = [];
      for (const each of names)
        if ((await stat(join(cache, each))).isFile())
          files.push(join(cache, each));
      return files;
    };

    it("starts the next conversation's first session on the cache made after the first, in under half the time", async () => {
      const without = await firstCall("first");
      await caches.settled();
      expect(await keptFiles()).not.toEqual([]);

      const on = await firstCall("second");

      expect(on).toBeLessThan(without / 2);
    }, 300_000);

    it("starts as without one on a kept cache the driver cannot read", async () => {
      for (const file of await keptFiles())
        await writeFile(file, randomBytes((await stat(file)).size));

      expect(await firstCall("third")).toBeGreaterThan(0);
    }, 300_000);
  },
);
