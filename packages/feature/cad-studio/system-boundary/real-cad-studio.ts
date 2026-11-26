/**
 * The CAD studio over the real harness, as the real-CAD tests open it: a
 * workspace and a data folder of their own, and each call inspected and then
 * made with the identity its approval names, as the agent's are. Beside it, the
 * parts and scenes more than one of those test files draws.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { TemporaryFolders } from "@zhiyin/test-support";
import { cadAutomation } from "../src/index.js";
import { confinedPython, harness } from "./confined-cad-python.js";

export type Result = {
  isError?: boolean;
  content: { type: string; text?: string; data?: string }[];
};

/** One of the studio's tools, inspected and then called. */
export type Call = (args: Record<string, unknown>) => Promise<Result>;

/** A mesh handed over for the person's view, read as it was. */
export type Preview = { model: Buffer; parts: unknown };

type Tools = ReturnType<typeof cadAutomation>;

const caller =
  (tools: Tools, name: string): Call =>
  async (args) => {
    const asked = await tools.inspect(name, args);
    if (!asked.ok) throw new Error(asked.reason);
    return (await tools.callTool(
      name,
      args,
      undefined,
      asked.identity,
    )) as Result;
  };

/**
 * The studio in a new workspace, its builds and drawings, and the meshes it
 * hands over for the person's view pushed onto `previews`.
 */
export async function openStudio(
  folders: TemporaryFolders,
  previews: Preview[] = [],
) {
  const root = await folders.make("zhiyin-real-cad-workspace-");
  const data = await folders.make("zhiyin-real-cad-data-");
  const tools = cadAutomation(await confinedPython(), {
    workspaceRoot: () => root,
    harness,
    directory: join(data, "cad-studio"),
    preview: async (model, parts) => {
      previews.push({ model: await readFile(model), parts });
    },
  });
  return {
    root,
    data,
    build: caller(tools, "cad_build"),
    draw: caller(tools, "cad_draw"),
  };
}

/**
 * The studio drawing a Blender scene whose lines are `scene()` at each call,
 * and `drawIn(ms)`, its drawings given only `ms`, as a slower machine or a
 * larger scene would leave.
 */
export async function busyDrafting(
  folders: TemporaryFolders,
  scene: () => unknown,
) {
  const root = await folders.make("zhiyin-real-cad-busy-");
  const data = await folders.make("zhiyin-real-cad-busy-data-");
  const confined = await confinedPython();
  const drawIn = (ms: number) =>
    caller(
      cadAutomation(confined, {
        workspaceRoot: () => root,
        harness,
        directory: join(data, "cad-studio"),
        buildTimeMs: ms,
        sceneLines: {
          installed: async () => true,
          open: async () => "engine.blend",
          lines: async () => ({ ok: true, lines: JSON.stringify(scene()) }),
        },
      }),
      "cad_draw",
    );
  return { root, drawIn };
}

export const bracket = [
  "from build123d import *",
  "with BuildPart() as bracket:",
  "    Box(80, 50, 10)",
  "    with Locations((-25, -12, 0), (25, -12, 0)):",
  "        Hole(radius=3)",
  "    with Locations((0, 10, 5)):",
  "        CounterBoreHole(radius=4, counter_bore_radius=7, counter_bore_depth=4)",
  "    with Locations((0, 22.5, 20)):",
  "        Box(80, 5, 30)",
  "    fillet(bracket.edges().filter_by(Axis.Z).group_by(Axis.Y)[0], radius=5)",
  'show(bracket.part, name="Bracket")',
].join("\n");

export const lBracket = [
  "from build123d import *",
  "with BuildPart() as b:",
  "    Box(80, 50, 8, align=(Align.MIN, Align.MIN, Align.MIN))",
  "    Box(8, 50, 40, align=(Align.MIN, Align.MIN, Align.MIN))",
  "    with Locations((30, 15, 8), (65, 35, 8)):",
  "        Hole(radius=3)",
  "    with Locations(Location((0, 25, 28), (0, 90, 0))):",
  "        Hole(radius=5, depth=20)",
  "    fillet(b.edges().filter_by(Axis.Y).group_by(Axis.X)[-1].group_by(Axis.Z)[-1], radius=6)",
  'show(b.part, name="Bracket")',
].join("\n");
