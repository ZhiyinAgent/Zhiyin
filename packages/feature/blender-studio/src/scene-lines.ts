/**
 * The lines of a conversation's scene, for a drawing of it (ADR 0022): the
 * session's Blender finds each view's edges with Line Art and writes them to
 * a file of this conversation's own, which is read and removed here.
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { SceneLines } from "@zhiyin/contract";
import type { SceneSession } from "./scene-session.js";

/** Line Art looks at the whole scene once a view; a large one takes a while. */
const timeoutMs = 10 * 60_000;

/**
 * The scene's lines, drawn by `session`, its files kept in `directory` while
 * they are read; `blender` is the installed Blender, or nothing.
 */
export function sceneLines(
  session: SceneSession,
  directory: string,
  blender: () => Promise<string | undefined>,
): SceneLines {
  return {
    installed: async () => (await blender()) !== undefined,
    open: (workspace) => session.sceneIn(workspace),
    async lines(request, options) {
      if (!(await session.sceneIn(options.workspace)))
        return {
          ok: false,
          reason:
            session.whyNoScene() ??
            "No 3D scene is open in this conversation. Open one with blender_open_scene first.",
        };
      const folder = join(directory, "lines");
      await mkdir(folder, { recursive: true });
      const output = join(folder, `${randomUUID()}.json`);
      try {
        const outcome = await session.run(
          "lines",
          {
            ...(request.objects ? { objects: request.objects } : {}),
            views: request.views,
            output,
          },
          {
            timeoutMs,
            workspace: options.workspace,
            ...(options.signal ? { signal: options.signal } : {}),
          },
        );
        if (!outcome.ok) return { ok: false, reason: outcome.reason };
        const lines = await readFile(output, "utf8").catch(() => undefined);
        return lines === undefined
          ? { ok: false, reason: "Blender wrote no lines for the drawing." }
          : { ok: true, lines };
      } finally {
        await rm(output, { force: true });
      }
    },
  };
}
